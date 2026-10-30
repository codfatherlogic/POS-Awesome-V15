import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from posawesome.posawesome.api.items import get_item_sales_history, get_items


class TestNumericItemCodes(FrappeTestCase):
    def setUp(self):
        items = [
            ("ALPHA-TEST", "Alpha"),
            ("BETA-TEST", "Beta"),
            ("002", "Gamma"),
        ]
        for code, name in items:
            if frappe.db.exists("Item", code):
                item = frappe.get_doc("Item", code)
                item.item_name = name
                item.is_sales_item = 1
                item.is_fixed_asset = 0
                item.save(ignore_permissions=True)
            else:
                frappe.get_doc(
                    {
                        "doctype": "Item",
                        "item_code": code,
                        "item_name": name,
                        "stock_uom": "Nos",
                        "is_stock_item": 0,
                        "item_group": "All Item Groups",
                        "is_sales_item": 1,
                        "is_fixed_asset": 0,
                    }
                ).insert(ignore_permissions=True, ignore_mandatory=True)

    def test_numeric_code_appears_without_search(self):
        pos_profile = json.dumps({"name": "TestProfile"})
        with patch("posawesome.posawesome.api.items.get_items_details", return_value=[]):
            first_page = get_items(pos_profile, limit=2)
            last_name = first_page[-1]["item_name"]
            second_page = get_items(pos_profile, limit=2, start_after=last_name)
        codes = [i["item_code"] for i in second_page]
        self.assertIn("002", codes)

    def test_item_search_with_whitespace(self):
        # Create an item with a barcode
        item_code = "TEST-ITEM-123"
        barcode = "123456789"

        if not frappe.db.exists("Item", item_code):
            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": item_code,
                    "item_name": "Test Item Whitespace",
                    "stock_uom": "Nos",
                    "item_group": "All Item Groups",
                    "is_sales_item": 1,
                    "barcodes": [{"barcode": barcode}],
                }
            ).insert(ignore_permissions=True)

        pos_profile = json.dumps({"name": "TestProfile"})

        # Search with leading/trailing whitespace
        items = get_items(pos_profile, search_value=f"  {barcode}  ")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["item_code"], item_code)


class TestItemSalesHistory(unittest.TestCase):
    def test_item_sales_history_uses_submitted_non_return_sales_and_pos_invoices(self):
        calls = []

        def fake_sql(query, params=None, as_dict=False):
            calls.append((query, params, as_dict))
            if "limit %s offset %s" in query:
                return [
                    {
                        "doctype": "Sales Invoice",
                        "invoice": "SINV-0002",
                        "customer": "CUST-0001",
                        "customer_name": "Walk-in Customer",
                        "posting_date": "2026-07-10",
                        "posting_time": "10:30:00",
                        "currency": "PKR",
                        "qty": 2,
                        "avg_rate": 90,
                        "discount_amount": 10,
                        "discount_percentage": 5,
                        "amount": 180,
                    },
                    {"invoice": "PINV-0001"},
                ]
            return [
                {
                    "invoice_count": 2,
                    "total_qty": 3,
                    "total_amount": 270,
                    "avg_rate": 90,
                    "last_sold": "2026-07-10",
                }
            ]

        fake_frappe = SimpleNamespace(db=SimpleNamespace(sql=fake_sql))
        profile = {"name": "POS-1", "company": "RetailMind"}
        with (
            patch("posawesome.posawesome.api.items.frappe", fake_frappe),
            patch(
                "posawesome.posawesome.api.items.get_authorized_pos_profile",
                return_value=profile,
            ),
            patch("posawesome.posawesome.api.items.get_authorized_pos_item"),
            patch("posawesome.posawesome.api.items.assert_doctype_read_permission"),
        ):
            result = get_item_sales_history(
                item_code="ITEM-0001",
                company="RetailMind",
                limit_page_length=1,
            )

        self.assertTrue(result["has_more"])
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["summary"]["invoice_count"], 2)

        history_query = calls[0][0]
        self.assertIn("`tabSales Invoice`", history_query)
        self.assertIn("`tabPOS Invoice`", history_query)
        self.assertIn("inv.docstatus = 1", history_query)
        self.assertIn("ifnull(inv.is_return, 0) = 0", history_query)
        self.assertIn("item.item_code = %s", history_query)

    def test_item_sales_history_respects_pos_invoice_filter(self):
        calls = []

        def fake_sql(query, params=None, as_dict=False):
            calls.append(query)
            if "limit %s offset %s" in query:
                return []
            return [{}]

        fake_frappe = SimpleNamespace(db=SimpleNamespace(sql=fake_sql))
        profile = {"name": "POS-1", "company": "RetailMind"}
        with (
            patch("posawesome.posawesome.api.items.frappe", fake_frappe),
            patch(
                "posawesome.posawesome.api.items.get_authorized_pos_profile",
                return_value=profile,
            ),
            patch("posawesome.posawesome.api.items.get_authorized_pos_item"),
            patch("posawesome.posawesome.api.items.assert_doctype_read_permission"),
        ):
            get_item_sales_history(
                item_code="ITEM-0001",
                company="RetailMind",
                doctype_filter="POS Invoice",
            )

        self.assertIn("`tabPOS Invoice`", calls[0])
        self.assertNotIn("`tabSales Invoice`", calls[0])

    def test_item_sales_history_rejects_profile_before_running_sql(self):
        fake_sql = Mock(side_effect=AssertionError("unauthorized history must not query SQL"))
        fake_frappe = SimpleNamespace(db=SimpleNamespace(sql=fake_sql))

        with (
            patch("posawesome.posawesome.api.items.frappe", fake_frappe),
            patch(
                "posawesome.posawesome.api.items.get_authorized_pos_profile",
                side_effect=PermissionError("not assigned"),
            ),
        ):
            with self.assertRaisesRegex(PermissionError, "not assigned"):
                get_item_sales_history(
                    item_code="ITEM-0001",
                    company="RetailMind",
                    pos_profile="OTHER-POS",
                )

        fake_sql.assert_not_called()

    def test_item_sales_history_rejects_unreadable_invoice_doctype_before_sql(self):
        fake_sql = Mock(side_effect=AssertionError("unauthorized history must not query SQL"))
        fake_frappe = SimpleNamespace(db=SimpleNamespace(sql=fake_sql))
        profile = {"name": "POS-1", "company": "RetailMind"}

        with (
            patch("posawesome.posawesome.api.items.frappe", fake_frappe),
            patch(
                "posawesome.posawesome.api.items.get_authorized_pos_profile",
                return_value=profile,
            ),
            patch("posawesome.posawesome.api.items.get_authorized_pos_item"),
            patch(
                "posawesome.posawesome.api.items.assert_doctype_read_permission",
                side_effect=PermissionError("cannot read Sales Invoice"),
            ),
        ):
            with self.assertRaisesRegex(PermissionError, "cannot read Sales Invoice"):
                get_item_sales_history(
                    item_code="ITEM-0001",
                    company="RetailMind",
                    pos_profile="POS-1",
                )

        fake_sql.assert_not_called()
