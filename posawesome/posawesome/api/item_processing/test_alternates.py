from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe

from posawesome.posawesome.api.item_processing import alternates


class TestAlternateItems(unittest.TestCase):
    def setUp(self):
        self.profile = frappe._dict(
            {
                "name": "Main POS",
                "company": "RetailMind",
                "warehouse": "Main Warehouse",
                "selling_price_list": "Standard Selling",
                "posa_show_template_items": 0,
                "posa_hide_variants_items": 1,
            }
        )
        self.requested_item = frappe._dict(
            {
                "name": "REQ-1",
                "item_code": "REQ-1",
                "item_name": "Requested",
                alternates.GENERIC_CODE_FIELD: "GEN-1",
                alternates.GENERIC_NAME_FIELD: "Paracetamol",
            }
        )
        self.installed_fields = (
            alternates.GENERIC_CODE_FIELD,
            alternates.GENERIC_NAME_FIELD,
            alternates.PACK_FIELD,
            alternates.COMPANY_CODE_FIELD,
            alternates.RACK_FIELD,
            alternates.UNITS_PER_PACK_FIELD,
            alternates.LOCKED_FOR_SALE_FIELD,
            "end_of_life",
            "valuation_rate",
            "last_purchase_rate",
        )

    def _candidate(self, code, **overrides):
        row = {
            "item_code": code,
            "item_name": f"Alternate {code}",
            "item_group": "Medicines",
            "brand": None,
            "stock_uom": "Nos",
            "is_stock_item": 1,
            "has_batch_no": 0,
            "has_serial_no": 0,
            "has_variants": 0,
            "variant_of": None,
            alternates.GENERIC_CODE_FIELD: "GEN-1",
            alternates.GENERIC_NAME_FIELD: "Paracetamol",
            alternates.PACK_FIELD: "10S",
            alternates.COMPANY_CODE_FIELD: "ACME",
            alternates.RACK_FIELD: "R-1",
            alternates.UNITS_PER_PACK_FIELD: 10,
            "valuation_rate": None,
            "last_purchase_rate": None,
        }
        row.update(overrides)
        return frappe._dict(row)

    def _run(self, candidates, *, prices, costs, stock, manager=True, qty=2, limit=20):
        with (
            patch.object(alternates, "get_authorized_pos_profile", return_value=self.profile),
            patch.object(alternates, "get_authorized_pos_item", return_value=self.requested_item),
            patch.object(alternates, "get_active_terminal_cashier", return_value="cashier@test"),
            patch.object(alternates, "user_can_manage_pos", return_value=manager),
            patch.object(alternates, "_resolve_warehouse", return_value=("Main Warehouse", ("Main Warehouse",))),
            patch.object(alternates, "_resolve_price_list", return_value=("Standard Selling", "PKR")),
            patch.object(alternates, "_installed_item_fields", return_value=self.installed_fields),
            patch.object(alternates, "_resolve_item_groups", return_value=("Medicines",)),
            patch.object(alternates, "_get_candidate_item_rows", return_value=candidates),
            patch.object(alternates, "_live_stock_map", return_value=stock),
            patch.object(alternates, "_live_batch_qty", return_value={}),
            patch.object(alternates, "_live_serial_qty", return_value={}),
            patch.object(alternates, "_live_price_map", return_value=prices),
            patch.object(alternates, "_cost_map", return_value=costs),
        ):
            return alternates.get_alternate_items(
                "REQ-1",
                pos_profile="Main POS",
                qty=qty,
                limit=limit,
            )

    def test_rejects_unauthorized_profile_before_item_or_candidate_queries(self):
        item_lookup = Mock(side_effect=AssertionError("must not read item"))
        candidate_lookup = Mock(side_effect=AssertionError("must not query candidates"))
        with (
            patch.object(
                alternates,
                "get_authorized_pos_profile",
                side_effect=frappe.PermissionError("not assigned"),
            ),
            patch.object(alternates, "get_authorized_pos_item", item_lookup),
            patch.object(alternates, "_get_candidate_item_rows", candidate_lookup),
        ):
            with self.assertRaisesRegex(frappe.PermissionError, "not assigned"):
                alternates.get_alternate_items("REQ-1", pos_profile="Other POS")
        item_lookup.assert_not_called()
        candidate_lookup.assert_not_called()

    def test_requires_server_verified_active_cashier_before_candidate_queries(self):
        candidate_lookup = Mock(side_effect=AssertionError("locked terminal must not query"))
        with (
            patch.object(alternates, "get_authorized_pos_profile", return_value=self.profile),
            patch.object(alternates, "get_authorized_pos_item", return_value=self.requested_item),
            patch.object(
                alternates,
                "get_active_terminal_cashier",
                side_effect=frappe.PermissionError("terminal is locked"),
            ),
            patch.object(alternates, "_get_candidate_item_rows", candidate_lookup),
        ):
            with self.assertRaisesRegex(frappe.PermissionError, "terminal is locked"):
                alternates.get_alternate_items("REQ-1", pos_profile="Main POS")
        candidate_lookup.assert_not_called()

    def test_missing_or_placeholder_generic_returns_clear_empty_state(self):
        self.requested_item[alternates.GENERIC_CODE_FIELD] = "0"
        self.requested_item[alternates.GENERIC_NAME_FIELD] = "."
        candidate_lookup = Mock(side_effect=AssertionError("missing generic must not query"))
        with (
            patch.object(alternates, "get_authorized_pos_profile", return_value=self.profile),
            patch.object(alternates, "get_authorized_pos_item", return_value=self.requested_item),
            patch.object(alternates, "get_active_terminal_cashier", return_value="cashier@test"),
            patch.object(alternates, "user_can_manage_pos", return_value=False),
            patch.object(alternates, "_resolve_warehouse", return_value=("Main Warehouse", ("Main Warehouse",))),
            patch.object(alternates, "_resolve_price_list", return_value=("Standard Selling", "PKR")),
            patch.object(alternates, "_installed_item_fields", return_value=self.installed_fields),
            patch.object(alternates, "_get_candidate_item_rows", candidate_lookup),
        ):
            result = alternates.get_alternate_items("REQ-1", pos_profile="Main POS")
        self.assertEqual(result["reason"], "missing_generic")
        self.assertEqual(result["items"], [])
        candidate_lookup.assert_not_called()

    def test_ranks_known_profit_high_to_low_and_unknown_cost_last(self):
        candidates = [self._candidate("HIGH"), self._candidate("LOW"), self._candidate("UNKNOWN")]
        result = self._run(
            candidates,
            prices={"HIGH": 15, "LOW": 20, "UNKNOWN": 100},
            costs={
                "HIGH": {"rate": 5, "source": "buying_price"},
                "LOW": {"rate": 18, "source": "warehouse_valuation"},
            },
            stock={code: {"actual_qty": 25, "valuation_rate": None} for code in ("HIGH", "LOW", "UNKNOWN")},
        )
        self.assertEqual([row["item_code"] for row in result["items"]], ["HIGH", "LOW", "UNKNOWN"])
        self.assertEqual(result["items"][0]["profit_amount"], 20)
        self.assertEqual(result["items"][0]["pack_stock"], 2)
        self.assertEqual(result["items"][0]["loose_stock"], 5)
        self.assertTrue(result["items"][0]["can_fulfill_requested_qty"])

    def test_cashier_projection_hides_cost_and_profit_but_preserves_server_order(self):
        candidates = [self._candidate("HIGH"), self._candidate("LOW")]
        result = self._run(
            candidates,
            prices={"HIGH": 15, "LOW": 20},
            costs={"HIGH": {"rate": 5}, "LOW": {"rate": 18}},
            stock={
                "HIGH": {"actual_qty": 10, "valuation_rate": None},
                "LOW": {"actual_qty": 10, "valuation_rate": None},
            },
            manager=False,
        )
        self.assertFalse(result["profit_display_allowed"])
        self.assertEqual([row["item_code"] for row in result["items"]], ["HIGH", "LOW"])
        for row in result["items"]:
            self.assertNotIn("cost_rate", row)
            self.assertNotIn("cost_source", row)
            self.assertNotIn("profit_per_unit", row)
            self.assertNotIn("profit_amount", row)
            self.assertNotIn("margin_percent", row)

    def test_projection_prefers_brand_and_strips_unsafe_legacy_text(self):
        candidate = self._candidate("CLEAN", brand="GSK", **{alternates.RACK_FIELD: "\x00"})
        row = alternates._project_candidate(
            candidate,
            rate=10,
            available_qty=2,
            requested_qty=1,
            currency="PKR",
            cost=None,
            profit_visible=False,
        )

        self.assertEqual(row["company"], "GSK")
        self.assertEqual(row["company_code"], "ACME")
        self.assertIsNone(row["rack"])

    def test_excludes_zero_stock_unpriced_and_requested_item(self):
        candidates = [
            self._candidate("REQ-1"),
            self._candidate("ZERO"),
            self._candidate("NO-PRICE"),
            self._candidate("VALID"),
        ]
        result = self._run(
            candidates,
            prices={"ZERO": 10, "VALID": 12},
            costs={"VALID": {"rate": 6}},
            stock={
                "ZERO": {"actual_qty": 0, "valuation_rate": None},
                "NO-PRICE": {"actual_qty": 10, "valuation_rate": None},
                "VALID": {"actual_qty": 3, "valuation_rate": None},
            },
        )
        self.assertEqual([row["item_code"] for row in result["items"]], ["VALID"])

    def test_prices_and_costs_only_live_positive_stock_candidates(self):
        candidates = [self._candidate("ZERO"), self._candidate("VALID")]
        price_lookup = Mock(return_value={"VALID": 12})
        cost_lookup = Mock(return_value={"VALID": {"rate": 6}})
        with (
            patch.object(alternates, "get_authorized_pos_profile", return_value=self.profile),
            patch.object(alternates, "get_authorized_pos_item", return_value=self.requested_item),
            patch.object(alternates, "get_active_terminal_cashier", return_value="cashier@test"),
            patch.object(alternates, "user_can_manage_pos", return_value=True),
            patch.object(alternates, "_resolve_warehouse", return_value=("Main Warehouse", ("Main Warehouse",))),
            patch.object(alternates, "_resolve_price_list", return_value=("Standard Selling", "PKR")),
            patch.object(alternates, "_installed_item_fields", return_value=self.installed_fields),
            patch.object(alternates, "_resolve_item_groups", return_value=("Medicines",)),
            patch.object(alternates, "_get_candidate_item_rows", return_value=candidates),
            patch.object(
                alternates,
                "_live_stock_map",
                return_value={
                    "ZERO": {"actual_qty": 0, "valuation_rate": None},
                    "VALID": {"actual_qty": 3, "valuation_rate": 6},
                },
            ),
            patch.object(alternates, "_live_batch_qty", return_value={}),
            patch.object(alternates, "_live_serial_qty", return_value={}),
            patch.object(alternates, "_live_price_map", price_lookup),
            patch.object(alternates, "_cost_map", cost_lookup),
        ):
            result = alternates.get_alternate_items("REQ-1", pos_profile="Main POS")

        self.assertEqual([row["item_code"] for row in result["items"]], ["VALID"])
        self.assertEqual(price_lookup.call_args.args[1], ("VALID",))
        self.assertEqual(tuple(cost_lookup.call_args.args[1]), ("VALID",))

    def test_cost_map_converts_buying_price_into_selling_currency(self):
        candidate = self._candidate("USD-COST")

        def get_value(doctype, name, fieldname):
            if doctype == "Price List":
                return "USD"
            if doctype == "Company":
                return "PKR"
            return None

        fake_frappe = SimpleNamespace(
            db=SimpleNamespace(get_value=get_value),
            log_error=Mock(),
        )
        with (
            patch.object(alternates, "frappe", fake_frappe),
            patch.object(alternates, "_resolve_buying_price_list", return_value="Standard Buying"),
            patch.object(alternates, "_live_price_map", return_value={"USD-COST": 15}),
            patch.object(alternates, "get_exchange_rate", return_value=280),
            patch.object(alternates, "nowdate", return_value="2026-07-13"),
        ):
            costs = alternates._cost_map(
                self.profile,
                {"USD-COST": candidate},
                {"USD-COST": {"actual_qty": 1, "valuation_rate": 3500}},
                "PKR",
            )

        self.assertEqual(costs["USD-COST"], {"rate": 4200, "source": "buying_price"})

    def test_batch_and_serial_candidates_require_sellable_live_units(self):
        batch = self._candidate("BATCH", has_batch_no=1)
        serial = self._candidate("SERIAL", has_serial_no=1)
        with (
            patch.object(alternates, "get_authorized_pos_profile", return_value=self.profile),
            patch.object(alternates, "get_authorized_pos_item", return_value=self.requested_item),
            patch.object(alternates, "get_active_terminal_cashier", return_value="cashier@test"),
            patch.object(alternates, "user_can_manage_pos", return_value=True),
            patch.object(alternates, "_resolve_warehouse", return_value=("Main Warehouse", ("Main Warehouse",))),
            patch.object(alternates, "_resolve_price_list", return_value=("Standard Selling", "PKR")),
            patch.object(alternates, "_installed_item_fields", return_value=self.installed_fields),
            patch.object(alternates, "_resolve_item_groups", return_value=("Medicines",)),
            patch.object(alternates, "_get_candidate_item_rows", return_value=[batch, serial]),
            patch.object(
                alternates,
                "_live_stock_map",
                return_value={
                    "BATCH": {"actual_qty": 10, "valuation_rate": 2},
                    "SERIAL": {"actual_qty": 10, "valuation_rate": 2},
                },
            ),
            patch.object(alternates, "_live_batch_qty", return_value={"BATCH": 0}),
            patch.object(alternates, "_live_serial_qty", return_value={"SERIAL": 2}),
            patch.object(alternates, "_live_price_map", return_value={"BATCH": 10, "SERIAL": 11}),
            patch.object(
                alternates,
                "_cost_map",
                return_value={"BATCH": {"rate": 2}, "SERIAL": {"rate": 2}},
            ),
        ):
            result = alternates.get_alternate_items("REQ-1", pos_profile="Main POS", qty=3)
        self.assertEqual([row["item_code"] for row in result["items"]], ["SERIAL"])
        self.assertEqual(result["items"][0]["available_qty"], 2)
        self.assertFalse(result["items"][0]["can_fulfill_requested_qty"])

    def test_live_batch_qty_uses_exact_warehouses_and_excludes_expired_batches(self):
        batch_lookup = Mock(
            return_value=[
                frappe._dict(item_code="BATCH", batch_qty=2, expiry_date="2026-07-12"),
                frappe._dict(item_code="BATCH", batch_qty=3, expiry_date="2026-07-13"),
                frappe._dict(item_code="BATCH", batch_qty=4, expiry_date="2026-07-14"),
                frappe._dict(item_code="BATCH", batch_qty=1, expiry_date=None),
            ]
        )
        with (
            patch.object(alternates, "_fetch_batches", batch_lookup),
            patch.object(alternates, "nowdate", return_value="2026-07-13"),
        ):
            quantities = alternates._live_batch_qty(("WH-A", "WH-B"), ("BATCH",))

        batch_lookup.assert_called_once_with(("WH-A", "WH-B"), ("BATCH",))
        self.assertEqual(quantities, {"BATCH": 5})

    def test_warehouse_group_scope_contains_only_enabled_concrete_descendants(self):
        profile = frappe._dict(
            name="Group POS",
            company="RetailMind",
            warehouse="All Warehouses",
        )
        captured = {}

        def get_value(doctype, name, fields, as_dict=False):
            return frappe._dict(company="RetailMind", is_group=1, disabled=0)

        def get_all(doctype, **kwargs):
            captured.update(doctype=doctype, **kwargs)
            return ["WH-B", "WH-A"]

        fake_frappe = SimpleNamespace(
            db=SimpleNamespace(
                get_value=get_value,
                get_descendants=lambda doctype, name: ["WH-A", "WH-B", "WH-DISABLED", "WH-GROUP"],
            ),
            get_all=get_all,
        )
        with patch.object(alternates, "frappe", fake_frappe):
            warehouse, concrete = alternates._resolve_warehouse(profile)

        self.assertEqual(warehouse, "All Warehouses")
        self.assertEqual(concrete, ("WH-A", "WH-B"))
        self.assertEqual(captured["filters"]["company"], "RetailMind")
        self.assertEqual(captured["filters"]["disabled"], 0)
        self.assertEqual(captured["filters"]["is_group"], 0)

    def test_public_limit_is_bounded(self):
        candidates = [self._candidate(f"ALT-{index:03}") for index in range(80)]
        prices = {row.item_code: 10 for row in candidates}
        stock = {row.item_code: {"actual_qty": 1, "valuation_rate": None} for row in candidates}
        result = self._run(candidates, prices=prices, costs={}, stock=stock, limit=1000)
        self.assertEqual(len(result["items"]), alternates.ALTERNATE_RESULT_LIMIT_MAX)

    def test_candidate_sql_enforces_generic_sellable_group_variant_and_lock_scope(self):
        captured = {}

        def fake_sql(query, params, as_dict=False):
            captured.update(query=query, params=params, as_dict=as_dict)
            return []

        fake_frappe = SimpleNamespace(db=SimpleNamespace(sql=fake_sql))
        with patch.object(alternates, "frappe", fake_frappe):
            rows = alternates._query_candidate_item_rows(
                alternates.GENERIC_NAME_FIELD,
                "paracetamol",
                ("Medicines",),
                False,
                True,
                self.installed_fields,
            )
        self.assertEqual(rows, [])
        self.assertIn("item.disabled = 0", captured["query"])
        self.assertIn("item.is_sales_item = 1", captured["query"])
        self.assertIn("item.is_stock_item = 1", captured["query"])
        self.assertIn("item.item_group in %(item_groups)s", captured["query"])
        self.assertIn("item.has_variants = 0", captured["query"])
        self.assertIn("item.variant_of is null", captured["query"])
        self.assertIn(alternates.LOCKED_FOR_SALE_FIELD, captured["query"])
        self.assertEqual(captured["params"]["generic_value"], "paracetamol")
        self.assertEqual(captured["params"]["item_groups"], ("Medicines",))

    def test_warehouse_and_price_list_inputs_cannot_escape_profile_scope(self):
        fake_frappe = SimpleNamespace(
            PermissionError=frappe.PermissionError,
            throw=lambda message, exc=None: (_ for _ in ()).throw((exc or Exception)(message)),
            db=SimpleNamespace(
                get_value=lambda doctype, name, fields, as_dict=False: frappe._dict(
                    {
                        "company": "RetailMind",
                        "is_group": 0,
                        "disabled": 0,
                    }
                )
            ),
        )
        with patch.object(alternates, "frappe", fake_frappe):
            with self.assertRaisesRegex(frappe.PermissionError, "not available"):
                alternates._resolve_warehouse(self.profile, "Other Warehouse")

        with (
            patch.object(alternates, "frappe", fake_frappe),
            patch.object(alternates, "_authorize_customer", return_value=None),
        ):
            with self.assertRaises(frappe.PermissionError):
                alternates._resolve_price_list(self.profile, "Private Selling")

    def test_customer_must_be_readable_enabled_and_in_profile_scope(self):
        customer_doc = frappe._dict(
            name="Out of Scope Customer",
            customer_group="Wholesale",
            disabled=0,
        )
        customer_doc.check_permission = Mock()
        fake_frappe = SimpleNamespace(
            PermissionError=frappe.PermissionError,
            get_doc=Mock(return_value=customer_doc),
            throw=lambda message, exc=None: (_ for _ in ()).throw((exc or Exception)(message)),
        )
        with (
            patch.object(alternates, "frappe", fake_frappe),
            patch.object(alternates, "_resolve_customer_groups", return_value=("Retail",)),
        ):
            with self.assertRaisesRegex(frappe.PermissionError, "not available"):
                alternates._authorize_customer(self.profile, customer_doc.name)

        customer_doc.check_permission.assert_called_once_with("read")


if __name__ == "__main__":
    unittest.main()
