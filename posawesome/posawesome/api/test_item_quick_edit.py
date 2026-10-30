import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from posawesome.posawesome.api import item_quick_edit


class TestItemQuickEditSupplierMapping(unittest.TestCase):
    def test_primary_supplier_prefers_item_supplier(self):
        fake_frappe = SimpleNamespace(
            db=SimpleNamespace(
                get_value=lambda *args, **kwargs: "ITEM SUPPLIER",
                exists=lambda *args, **kwargs: True,
            ),
            get_all=lambda *args, **kwargs: [{"supplier": "BRAND SUPPLIER"}],
        )

        with patch.object(item_quick_edit, "frappe", fake_frappe):
            self.assertEqual(
                item_quick_edit._get_primary_supplier("ITEM-001", "BRAND-001"),
                "ITEM SUPPLIER",
            )

    def test_primary_supplier_falls_back_to_brand_mapping(self):
        def get_value(doctype, *args, **kwargs):
            if doctype == "Item Supplier":
                return None
            return None

        fake_frappe = SimpleNamespace(
            db=SimpleNamespace(get_value=get_value, exists=lambda *args, **kwargs: True),
            get_all=lambda *args, **kwargs: [{"supplier": "BRAND SUPPLIER"}],
        )

        with patch.object(item_quick_edit, "frappe", fake_frappe):
            self.assertEqual(
                item_quick_edit._get_primary_supplier("ITEM-001", "BRAND-001"),
                "BRAND SUPPLIER",
            )


class TestItemQuickEditPosRow(unittest.TestCase):
    def test_item_fields_include_all_installed_pharmacy_metadata(self):
        with patch.object(item_quick_edit, "item_has_field", return_value=True):
            fields = item_quick_edit._item_fields()

        for field in (
            "retailmind_old_pos_company_code",
            "retailmind_old_pos_generic_code",
            "retailmind_old_pos_generic_name",
            "retailmind_old_pos_pack",
            "retailmind_old_pos_rack",
            "retailmind_units_per_pack",
        ):
            self.assertIn(field, fields)
            self.assertIn(field, item_quick_edit.OPTIONAL_QUICK_EDIT_FIELDS)

    def test_build_pos_item_row_uses_retail_rate_without_catalog_search(self):
        row = item_quick_edit._build_pos_item_row(
            {
                "name": "ITEM-001",
                "item_code": "ITEM-001",
                "item_name": "Test Item",
                "stock_uom": "Nos",
                "retail_price": 10,
            }
        )

        self.assertEqual(row["item_code"], "ITEM-001")
        self.assertEqual(row["uom"], "Nos")
        self.assertEqual(row["rate"], 10)
        self.assertEqual(row["price_list_rate"], 10)


class FakeItem(dict):
    def __init__(self):
        super().__init__(barcodes=[], supplier_items=[])
        self.name = "ITEM-001"
        self.item_code = "ITEM-001"
        self.stock_uom = "Nos"
        self.barcodes = []
        self.supplier_items = []
        self.flags = SimpleNamespace(ignore_permissions=False)
        self.permission_checks = []
        self.saved = False

    def check_permission(self, permission_type):
        self.permission_checks.append(permission_type)

    def save(self):
        self.saved = True

    def db_set(self, *args, **kwargs):
        return None


class TestItemQuickEditAuthorization(unittest.TestCase):
    def test_client_cashier_and_forged_profile_flag_cannot_authorize_save(self):
        canonical_profile = {
            "name": "POS-1",
            "company": "RetailMind",
            item_quick_edit.QUICK_EDIT_FLAG: 0,
        }

        def throw(message, *args, **kwargs):
            raise PermissionError(message)

        fake_frappe = SimpleNamespace(
            session=SimpleNamespace(user="cashier@example.com"),
            get_roles=lambda user: ["Sales User"],
            throw=throw,
        )
        forged_payload = {
            "pos_profile": {
                "name": "POS-1",
                item_quick_edit.QUICK_EDIT_FLAG: 1,
            },
            "cashier": "Administrator",
            "item_code": "ITEM-001",
        }

        with (
            patch.object(item_quick_edit, "frappe", fake_frappe),
            patch.object(
                item_quick_edit,
                "get_authorized_pos_profile",
                return_value=canonical_profile,
            ) as profile_authorization,
            patch.object(item_quick_edit, "_is_pos_supervisor", return_value=False),
            patch.object(item_quick_edit, "_get_user_doc", return_value=SimpleNamespace()),
            patch.object(
                item_quick_edit,
                "get_authorized_pos_item",
                side_effect=AssertionError("item must not load before authorization"),
            ) as item_loader,
        ):
            with self.assertRaisesRegex(PermissionError, "POS supervisor"):
                item_quick_edit.save_item_quick_edit(json.dumps(forged_payload))

        profile_authorization.assert_called_once_with(forged_payload["pos_profile"])
        item_loader.assert_not_called()

    def test_item_write_permission_is_checked_before_save(self):
        profile = {
            "name": "POS-1",
            "company": "RetailMind",
            item_quick_edit.QUICK_EDIT_FLAG: 1,
        }
        item = FakeItem()
        item.check_permission = Mock(side_effect=PermissionError("missing write permission"))
        fake_frappe = SimpleNamespace(session=SimpleNamespace(user="cashier@example.com"))

        with (
            patch.object(item_quick_edit, "frappe", fake_frappe),
            patch.object(item_quick_edit, "get_authorized_pos_profile", return_value=profile),
            patch.object(item_quick_edit, "_assert_can_save"),
            patch.object(item_quick_edit, "_resolve_item_code", return_value=item.name),
            patch.object(item_quick_edit, "get_authorized_pos_item", return_value=item),
        ):
            with self.assertRaisesRegex(PermissionError, "missing write permission"):
                item_quick_edit.save_item_quick_edit({"pos_profile": "POS-1", "item_code": item.name})

        item.check_permission.assert_called_once_with("write")
        self.assertFalse(item.saved)
        self.assertFalse(item.flags.ignore_permissions)

    def test_authorized_supervisor_save_uses_canonical_price_list(self):
        profile = {
            "name": "POS-1",
            "company": "RetailMind",
            "selling_price_list": "Canonical Selling",
            item_quick_edit.QUICK_EDIT_FLAG: 1,
        }
        item = FakeItem()
        upserts = []

        def resolve_price_list(_profile, price_list=None, buying=False):
            return "Canonical Buying" if buying else "Canonical Selling"

        fake_frappe = SimpleNamespace(
            session=SimpleNamespace(user="cashier@example.com"),
            db=SimpleNamespace(
                exists=lambda doctype, name: False,
                commit=Mock(),
            ),
            clear_cache=Mock(),
        )

        with (
            patch.object(item_quick_edit, "frappe", fake_frappe),
            patch.object(item_quick_edit, "get_authorized_pos_profile", return_value=profile),
            patch.object(item_quick_edit, "_assert_can_save"),
            patch.object(item_quick_edit, "_resolve_item_code", return_value=item.name),
            patch.object(item_quick_edit, "get_authorized_pos_item", return_value=item),
            patch.object(item_quick_edit, "item_has_field", return_value=False),
            patch.object(item_quick_edit, "_sync_barcode"),
            patch.object(item_quick_edit, "_sync_primary_supplier"),
            patch.object(item_quick_edit, "_resolve_price_list", side_effect=resolve_price_list),
            patch.object(
                item_quick_edit,
                "_upsert_item_price",
                side_effect=lambda *args, **kwargs: upserts.append((args, kwargs)),
            ),
            patch.object(
                item_quick_edit,
                "_get_item_quick_edit_item",
                return_value={"item_code": item.name},
            ),
        ):
            result = item_quick_edit.save_item_quick_edit(
                {
                    "pos_profile": "POS-1",
                    "item_code": item.name,
                    "retail_price": 125,
                    "selling_price_list": "Attacker Selling",
                }
            )

        self.assertEqual(item.permission_checks, ["write"])
        self.assertTrue(item.saved)
        self.assertTrue(item.flags.ignore_permissions)
        self.assertEqual(upserts[0][0][1], "Canonical Selling")
        self.assertEqual(result["item"]["item_code"], item.name)
        fake_frappe.db.commit.assert_not_called()

    def test_item_price_create_permission_is_checked_before_ignored_insert(self):
        price_doc = SimpleNamespace(
            flags=SimpleNamespace(ignore_permissions=False),
            check_permission=Mock(side_effect=PermissionError("missing create permission")),
            insert=Mock(),
        )
        fake_frappe = SimpleNamespace(
            db=SimpleNamespace(exists=lambda *args, **kwargs: False),
            get_doc=lambda payload: price_doc,
        )

        with patch.object(item_quick_edit, "frappe", fake_frappe):
            with self.assertRaisesRegex(PermissionError, "missing create permission"):
                item_quick_edit._upsert_item_price(
                    "ITEM-001",
                    "Canonical Selling",
                    125,
                    uom="Nos",
                    selling=True,
                )

        price_doc.check_permission.assert_called_once_with("create")
        price_doc.insert.assert_not_called()
        self.assertFalse(price_doc.flags.ignore_permissions)


if __name__ == "__main__":
    unittest.main()
