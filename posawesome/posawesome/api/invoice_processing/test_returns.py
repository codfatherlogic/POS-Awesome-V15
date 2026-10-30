import importlib.util
import pathlib
import sys
import types
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_ORIGINAL_MODULES = dict(sys.modules)


def tearDownModule():
    managed_prefixes = ("frappe", "posawesome")
    for name in list(sys.modules):
        if name.startswith(managed_prefixes) and name not in _ORIGINAL_MODULES:
            sys.modules.pop(name, None)
    for name, module in _ORIGINAL_MODULES.items():
        if name.startswith(managed_prefixes):
            sys.modules[name] = module


def _load_returns_module():
    frappe_module = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.db = types.SimpleNamespace(get_value=lambda *args, **kwargs: None)
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.flt = lambda value, *_args, **_kwargs: float(value or 0)
    frappe_utils.getdate = lambda value: value
    frappe_utils.nowdate = lambda: "2026-09-19"
    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils

    processing_utils = types.ModuleType("posawesome.posawesome.api.invoice_processing.utils")
    processing_utils._get_return_validity_settings = lambda *args, **kwargs: (False, 0)
    sys.modules["posawesome.posawesome.api.invoice_processing.utils"] = processing_utils

    api_utils = types.ModuleType("posawesome.posawesome.api.utils")
    api_utils.log_perf_event = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api.utils"] = api_utils

    module_name = "posawesome.posawesome.api.invoice_processing.returns"
    module_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing" / "returns.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestRefundableCash(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.returns = _load_returns_module()

    def test_sums_prior_returns_without_sql_function_fields(self):
        captured = {}
        self.returns.frappe.db.get_value = lambda *args, **kwargs: {
            "grand_total": 100,
            "outstanding_amount": 20,
        }

        def fake_get_all(doctype, **kwargs):
            captured["doctype"] = doctype
            captured["kwargs"] = kwargs
            return [{"grand_total": -10}, {"grand_total": -15}]

        self.returns.frappe.get_all = fake_get_all

        refundable = self.returns.compute_original_refundable_cash("Sales Invoice", "SINV-0001")

        self.assertEqual(refundable, 55)
        self.assertEqual(captured["doctype"], "Sales Invoice")
        self.assertEqual(captured["kwargs"]["fields"], ["grand_total"])
        self.assertEqual(
            captured["kwargs"]["filters"],
            {
                "return_against": "SINV-0001",
                "docstatus": 1,
                "is_return": 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
