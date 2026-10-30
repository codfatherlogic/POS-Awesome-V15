import importlib.util
import json
import pathlib
import sys
import types
import unittest
from datetime import datetime

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda value: value
    frappe_module.as_json = lambda value: json.dumps(value, default=str)
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.db = types.SimpleNamespace(
        get_value=lambda *args, **kwargs: None,
        sql=lambda *args, **kwargs: [],
    )
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda value=0: int(value or 0)
    frappe_utils.cstr = str
    frappe_utils.flt = lambda value=0, *args, **kwargs: float(value or 0)
    frappe_utils.get_datetime = lambda value: value
    frappe_utils.add_days = lambda date_value, days: f"{date_value}:{days}"
    frappe_utils.nowdate = lambda: "2026-07-08"
    sys.modules["frappe.utils"] = frappe_utils

    frappe_cache = types.ModuleType("frappe.utils.caching")
    frappe_cache.redis_cache = lambda ttl=None: (lambda fn: fn)
    sys.modules["frappe.utils.caching"] = frappe_cache

    query_builder = types.ModuleType("frappe.query_builder")
    query_builder.DocType = lambda name: types.SimpleNamespace(name=name)
    query_builder.Order = types.SimpleNamespace(desc="desc", asc="asc")
    sys.modules["frappe.query_builder"] = query_builder

    query_functions = types.ModuleType("frappe.query_builder.functions")
    query_functions.Max = lambda value: value
    query_functions.Sum = lambda value: value
    sys.modules["frappe.query_builder.functions"] = query_functions

    fetchers = types.ModuleType("posawesome.posawesome.api.item_fetchers")
    fetchers.ItemDetailAggregator = object
    sys.modules["posawesome.posawesome.api.item_fetchers"] = fetchers

    utils = types.ModuleType("posawesome.posawesome.api.utils")
    utils.HAS_VARIANTS_EXCLUSION = []
    utils.expand_item_groups = lambda *args, **kwargs: []
    utils.get_active_pos_profile = lambda *args, **kwargs: {}
    utils.get_item_groups = lambda *args, **kwargs: []
    utils._ensure_pos_profile = lambda value: value
    utils.log_perf_event = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api.utils"] = utils

    barcode = types.ModuleType("posawesome.posawesome.api.item_processing.barcode")
    barcode.search_serial_or_batch_or_barcode_number = lambda *args, **kwargs: {}
    sys.modules["posawesome.posawesome.api.item_processing.barcode"] = barcode

    details = types.ModuleType("posawesome.posawesome.api.item_processing.details")
    details.get_items_details = lambda *args, **kwargs: []
    sys.modules["posawesome.posawesome.api.item_processing.details"] = details


def _load_module():
    module_name = "test_item_search_serialization_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "search.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestItemSearchSerialization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def test_run_item_query_serializes_datetime_rows_for_details(self):
        serialized_payloads = []

        def fake_get_all(*args, **kwargs):
            if fake_get_all.calls == 0:
                fake_get_all.calls += 1
                return [
                    {
                        "item_code": "ITEM-001",
                        "item_name": "Item 001",
                        "modified": datetime(2026, 4, 23, 10, 30, 0),
                    }
                ]
            return []

        fake_get_all.calls = 0

        def fake_get_items_details(pos_profile_json, items_json, **kwargs):
            serialized_payloads.append(items_json)
            return [{"item_code": "ITEM-001"}]

        self.module.frappe.get_all = fake_get_all
        self.module.get_items_details = fake_get_items_details
        self.module._build_attribute_maps = lambda *args, **kwargs: ({}, {})
        self.module._shape_item_row = lambda item, detail, plan, **kwargs: item
        self.module._matches_search_words = lambda *args, **kwargs: True

        plan = self.module.SearchPlan(
            filters={},
            or_filters=[],
            fields=["item_code", "item_name", "modified"],
            limit_page_length=1,
            limit_start=0,
            order_by="item_name asc",
            page_size=1,
            initial_page_start=0,
            item_code_for_search=None,
            search_words=[],
            normalized_search_value="",
            word_filter_active=False,
            include_description=False,
            include_image=False,
            posa_display_items_in_stock=False,
            posa_show_template_items=False,
        )

        result = self.module._run_item_query({}, None, None, plan)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["item_code"], "ITEM-001")
        self.assertEqual(len(serialized_payloads), 1)
        self.assertIn("2026-04-23 10:30:00", serialized_payloads[0])

    def test_interactive_query_prepends_an_exact_item_code_candidate(self):
        calls = []

        def fake_get_all(*args, **kwargs):
            calls.append(kwargs)
            if kwargs.get("filters", {}).get("item_code") == "02017":
                return [{"item_code": "02017", "item_name": "Exact Item"}]
            return [{"item_code": "OTHER", "item_name": "Alphabetical First"}]

        self.module.frappe.get_all = fake_get_all
        self.module.get_items_details = lambda _profile, rows, **_kwargs: [
            {"item_code": row["item_code"]} for row in json.loads(rows)
        ]
        self.module._build_attribute_maps = lambda *args, **kwargs: ({}, {})
        self.module._shape_item_row = lambda item, detail, plan, **kwargs: item
        self.module._matches_search_words = lambda *args, **kwargs: True

        plan = self.module.SearchPlan(
            filters={},
            or_filters=[["item_code", "like", "%02017%"]],
            fields=["item_code", "item_name"],
            limit_page_length=2,
            limit_start=0,
            order_by="item_name asc",
            page_size=2,
            initial_page_start=0,
            item_code_for_search="02017",
            search_words=["02017"],
            normalized_search_value="02017",
            word_filter_active=True,
            include_description=False,
            include_image=False,
            posa_display_items_in_stock=False,
            posa_show_template_items=False,
        )

        result = self.module._run_item_query({}, None, None, plan)

        self.assertEqual(
            [row["item_code"] for row in result],
            ["02017", "OTHER"],
        )
        self.assertEqual(calls[1]["filters"]["item_code"], "02017")

    def test_item_code_cursor_uses_keyset_plan_without_offset(self):
        plan = self.module._build_search_plan(
            pos_profile={},
            item_group="",
            search_value="",
            limit=1000,
            offset=5000,
            start_after=None,
            start_after_item_code="ITEM-0500",
            modified_after=None,
            include_description=False,
            include_image=False,
            item_groups=None,
        )

        self.assertEqual(plan.order_by, "item_code asc")
        self.assertIsNone(plan.limit_start)
        self.assertEqual(plan.filters["item_code"], [">", "ITEM-0500"])

    def test_empty_item_code_cursor_orders_first_page_by_item_code(self):
        plan = self.module._build_search_plan(
            pos_profile={},
            item_group="",
            search_value="",
            limit=1000,
            offset=None,
            start_after=None,
            start_after_item_code="",
            modified_after=None,
            include_description=False,
            include_image=False,
            item_groups=None,
        )

        self.assertEqual(plan.order_by, "item_code asc")
        self.assertNotIn("item_code", plan.filters)

    def test_hot_catalog_limit_is_bounded(self):
        self.assertEqual(self.module._coerce_hot_catalog_limit(None), 5000)
        self.assertEqual(self.module._coerce_hot_catalog_limit(50), 100)
        self.assertEqual(self.module._coerce_hot_catalog_limit(20000), 10000)

    def test_search_plan_includes_installed_pharmacy_fields(self):
        self.module.installed_item_search_fields = lambda: [
            "retailmind_old_pos_generic_name",
            "retailmind_old_pos_rack",
        ]

        plan = self.module._build_search_plan(
            pos_profile={"posa_use_limit_search": 1},
            item_group="",
            search_value="paracetamol",
            limit=50,
            offset=0,
            start_after=None,
            start_after_item_code=None,
            modified_after=None,
            include_description=False,
            include_image=False,
            item_groups=None,
        )

        self.assertIn("retailmind_old_pos_generic_name", plan.fields)
        self.assertIn(
            ["retailmind_old_pos_generic_name", "like", "%paracetamol%"],
            plan.or_filters,
        )

    def test_legacy_limit_search_field_uses_the_bounded_search_plan(self):
        plan = self.module._build_search_plan(
            pos_profile={"pose_use_limit_search": 1, "posa_search_limit": 1000},
            item_group="",
            search_value="panadol",
            limit=1000,
            offset=0,
            start_after=None,
            start_after_item_code=None,
            modified_after=None,
            include_description=False,
            include_image=False,
            item_groups=None,
        )

        self.assertEqual(plan.limit_page_length, 100)
        self.assertEqual(plan.page_size, 100)
        self.assertTrue(plan.or_filters)
        self.assertEqual(plan.item_code_for_search, "panadol")

    def test_current_limit_search_field_overrides_the_legacy_alias(self):
        plan = self.module._build_search_plan(
            pos_profile={
                "posa_use_limit_search": 0,
                "pose_use_limit_search": 1,
            },
            item_group="",
            search_value="panadol",
            limit=50,
            offset=0,
            start_after=None,
            start_after_item_code=None,
            modified_after=None,
            include_description=False,
            include_image=False,
            item_groups=None,
        )

        self.assertEqual(plan.or_filters, [])

    def test_word_filter_matches_pharmacy_metadata(self):
        row = {
            "item_code": "ITEM-001",
            "item_name": "Pain Relief",
            "retailmind_old_pos_generic_name": "PARACETAMOL",
            "retailmind_old_pos_rack": "A-12",
        }

        self.assertTrue(self.module._matches_search_words(row, ["paracetamol"], True))
        self.assertTrue(self.module._matches_search_words(row, ["a-12"], True))

    def test_hot_item_search_fills_sales_ranking_with_active_fallback(self):
        calls = []

        self.module._get_hot_sales_item_codes = lambda *args, **kwargs: [
            "ITEM-HOT"
        ]
        self.module._enrich_hot_items = lambda _profile, rows, *args, **kwargs: rows

        def fake_get_all(doctype, **kwargs):
            calls.append((doctype, kwargs))
            if kwargs.get("filters", {}).get("item_code") == ["in", ["ITEM-HOT"]]:
                return [{"item_code": "ITEM-HOT", "item_name": "Hot Item"}]
            return [{"item_code": "ITEM-FALLBACK", "item_name": "Fallback"}]

        self.module.frappe.get_all = fake_get_all

        result = self.module._execute_hot_item_search(
            json.dumps(
                {
                    "name": "POS-1",
                    "company": "Test Co",
                    "selling_price_list": "Retail",
                }
            ),
            price_list=None,
            customer=None,
            limit=2,
            days=120,
            include_description=False,
            include_image=False,
            item_groups=[],
        )

        self.assertEqual(
            [row["item_code"] for row in result],
            ["ITEM-HOT", "ITEM-FALLBACK"],
        )
        fallback_call = calls[-1][1]
        self.assertEqual(
            fallback_call["filters"]["item_code"],
            ["not in", ["ITEM-HOT"]],
        )

    def test_hot_item_search_can_filter_hot_and_fallback_items_by_positive_stock(self):
        sql_calls = []

        self.module._get_hot_sales_item_codes = lambda *args, **kwargs: [
            "ITEM-HOT-IN",
            "ITEM-HOT-ZERO",
        ]
        self.module._enrich_hot_items = lambda _profile, rows, *args, **kwargs: rows
        self.module.frappe.db.get_value = lambda *args, **kwargs: {
            "is_group": 0,
            "lft": 1,
            "rgt": 2,
        }

        def fake_sql(_query, params, **kwargs):
            sql_calls.append(params)
            if params.get("candidate_codes"):
                return [{"item_code": "ITEM-HOT-IN"}]
            return [{"item_code": "ITEM-FALLBACK-IN"}]

        def fake_get_all(doctype, **kwargs):
            if doctype != "Item":
                return []
            filters = kwargs.get("filters", {})
            if filters.get("item_code") == ["in", ["ITEM-HOT-IN"]]:
                return [{"item_code": "ITEM-HOT-IN", "item_name": "Hot Item"}]
            if filters.get("item_code") == ["in", ["ITEM-FALLBACK-IN"]]:
                return [
                    {
                        "item_code": "ITEM-FALLBACK-IN",
                        "item_name": "Fallback Item",
                    }
                ]
            return []

        self.module.frappe.db.sql = fake_sql
        self.module.frappe.get_all = fake_get_all

        result = self.module._execute_hot_item_search(
            json.dumps(
                {
                    "name": "POS-1",
                    "company": "Test Co",
                    "warehouse": "Main WH",
                    "selling_price_list": "Retail",
                    "posa_fast_counter_positive_stock_only": 1,
                }
            ),
            price_list=None,
            customer=None,
            limit=3,
            days=120,
            include_description=False,
            include_image=False,
            item_groups=[],
        )

        self.assertEqual(
            [row["item_code"] for row in result],
            ["ITEM-HOT-IN", "ITEM-FALLBACK-IN"],
        )
        self.assertEqual(
            sql_calls[0]["candidate_codes"],
            ("ITEM-HOT-IN", "ITEM-HOT-ZERO"),
        )
        self.assertEqual(sql_calls[1]["exclude_codes"], ("ITEM-HOT-IN",))


if __name__ == "__main__":
    unittest.main()
