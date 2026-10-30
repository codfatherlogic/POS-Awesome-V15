import importlib.util
import json
import pathlib
import sys
import types
import unittest
from contextlib import contextmanager


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_ORIGINAL_MODULES = dict(sys.modules)


def tearDownModule():
    for name in list(sys.modules):
        if name.startswith(("frappe", "posawesome")) and name not in _ORIGINAL_MODULES:
            sys.modules.pop(name, None)
    for name, module in _ORIGINAL_MODULES.items():
        if name.startswith(("frappe", "posawesome")):
            sys.modules[name] = module


class AttrDict(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__


class FakeInvoice(AttrDict):
    def check_permission(self, permission_type):
        self.permission_checked = permission_type

    def cancel(self):
        self.cancelled = True

    def db_update(self):
        self.updated = True

    def as_dict(self):
        return dict(self)


def _load_module(captured):
    frappe = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    frappe._ = lambda text: text
    frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe.throw = lambda message, *args, **kwargs: (_ for _ in ()).throw(Exception(message))
    frappe.flags = types.SimpleNamespace()
    frappe.db = types.SimpleNamespace(
        has_column=lambda *args: True,
        exists=lambda *args, **kwargs: False,
        get_value=lambda *args, **kwargs: None,
        savepoint=lambda *args: None,
        sql=lambda *args, **kwargs: None,
        rollback=lambda *args, **kwargs: None,
    )
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.flt = lambda value: float(value or 0)
    frappe_utils.get_datetime = lambda value: value
    frappe_utils.now_datetime = lambda: 0
    sys.modules["frappe"] = frappe
    sys.modules["frappe.utils"] = frappe_utils

    for package, path in {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
    }.items():
        module = types.ModuleType(package)
        module.__path__ = [str(path)]
        sys.modules[package] = module

    idempotency = types.ModuleType("posawesome.posawesome.api.idempotency")
    idempotency.doctype_supports_client_request_id = lambda *_args: True
    idempotency.find_invoice_by_client_request_id = lambda *_args, **_kwargs: None
    idempotency.set_invoice_client_request_id = lambda doc, value: doc.update(
        posa_client_request_id=value
    )
    sys.modules["posawesome.posawesome.api.idempotency"] = idempotency

    creation = types.ModuleType("posawesome.posawesome.api.invoice_processing.creation")
    creation._reapply_incoming_payment_amounts = lambda *_args: None

    @contextmanager
    def trusted_shift(payload, data, source):
        captured["source"] = source
        captured["original_shift"] = payload.get("posa_pos_opening_shift")
        payload["posa_pos_opening_shift"] = "POS-OPEN-CURRENT"
        data["posa_pos_opening_shift"] = "POS-OPEN-CURRENT"
        yield

    def submit_invoice(invoice, data, submit_in_background=False):
        captured["submitted_invoice"] = json.loads(invoice)
        captured["submitted_data"] = json.loads(data)
        return {
            "name": "ACC-SINV-AMENDED-0001",
            "doctype": "Sales Invoice",
            "docstatus": 1,
        }

    creation.trusted_invoice_shift_reassignment = trusted_shift
    creation.submit_invoice = submit_invoice
    sys.modules["posawesome.posawesome.api.invoice_processing.creation"] = creation

    api_utils = types.ModuleType("posawesome.posawesome.api.utils")
    api_utils.assert_pos_profile_write_allowed = lambda *_args, **_kwargs: None
    sys.modules["posawesome.posawesome.api.utils"] = api_utils

    pos_access = types.ModuleType("posawesome.posawesome.api.pos_access")
    pos_access.get_authorized_pos_profile = lambda *_args, **_kwargs: AttrDict(
        name="Main POS", company="Test Company"
    )
    sys.modules["posawesome.posawesome.api.pos_access"] = pos_access

    module_name = "posawesome.posawesome.api.submitted_invoice_edits"
    spec = importlib.util.spec_from_file_location(
        module_name,
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "submitted_invoice_edits.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module, frappe


class TestSubmittedInvoiceShiftSecurity(unittest.TestCase):
    def test_amendment_reassigns_closed_original_shift_before_cancel(self):
        captured = {}
        module, frappe = _load_module(captured)
        original = FakeInvoice(
            doctype="Sales Invoice",
            name="ACC-SINV-ORIGINAL-0001",
            docstatus=1,
            pos_profile="Main POS",
            company="Test Company",
            posa_pos_opening_shift="POS-OPEN-CLOSED",
            creation="2026-07-13",
            flags=types.SimpleNamespace(),
        )
        amended = FakeInvoice(
            doctype="Sales Invoice",
            name="ACC-SINV-AMENDED-0001",
            docstatus=1,
            pos_profile="Main POS",
            company="Test Company",
            creation="2026-07-13",
        )
        frappe.get_doc = lambda _doctype, name: (
            original if name == original.name else amended
        )
        module.assert_submitted_invoice_edit_allowed = lambda *_args, **_kwargs: {
            "can_edit_submitted_invoice": True
        }
        module.get_submitted_invoice_edit_metadata = lambda *_args: {}
        module.build_submitted_invoice_amendment_payload = lambda *_args, **_kwargs: {
            "doctype": "Sales Invoice",
            "_force_invoice_doctype": "Sales Invoice",
            "amended_from": original.name,
            "pos_profile": "Main POS",
            "company": "Test Company",
            "posa_pos_opening_shift": "POS-OPEN-CLOSED",
        }

        result = module.submit_submitted_invoice_edit(
            "Sales Invoice",
            original.name,
            client_request_id="submitted-amendment-001",
            pos_profile="Main POS",
            company="Test Company",
        )

        self.assertEqual(captured["source"], "submitted_amendment")
        self.assertEqual(captured["original_shift"], "POS-OPEN-CLOSED")
        self.assertEqual(
            captured["submitted_invoice"]["posa_pos_opening_shift"],
            "POS-OPEN-CURRENT",
        )
        self.assertEqual(
            captured["submitted_data"]["posa_pos_opening_shift"],
            "POS-OPEN-CURRENT",
        )
        self.assertTrue(original.cancelled)
        self.assertEqual(result["name"], amended.name)


if __name__ == "__main__":
    unittest.main()
