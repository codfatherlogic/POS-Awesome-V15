import json
import uuid
import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase


DOCTYPE = "POS Invoice Submission Ledger"


class TestPosInvoiceSubmissionLedger(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.test_user = f"test-pos-ledger-{uuid.uuid4().hex[:10]}@example.com"
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": self.test_user,
                "first_name": "POS Ledger Test",
                "enabled": 1,
                "send_welcome_email": 0,
            }
        ).insert(ignore_permissions=True)
        user.add_roles("POS User")
        self.manager_user = f"test-pos-manager-ledger-{uuid.uuid4().hex[:10]}@example.com"
        manager = frappe.get_doc(
            {
                "doctype": "User",
                "email": self.manager_user,
                "first_name": "POS Manager Ledger Test",
                "enabled": 1,
                "send_welcome_email": 0,
            }
        ).insert(ignore_permissions=True)
        manager.add_roles("POS Manager")
        frappe.clear_cache(user=self.test_user)
        frappe.clear_cache(user=self.manager_user)

    def tearDown(self):
        frappe.set_user("Administrator")
        for user in (self.test_user, self.manager_user):
            if frappe.db.exists("User", user):
                frappe.delete_doc("User", user, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDown()

    def _scope(self):
        profile = frappe.db.get_value("POS Profile", {}, ["name", "company"], as_dict=True)
        if not profile:
            self.skipTest("A POS Profile is required for ledger database tests")
        return profile

    def _insert_ledger(self, state="SUBMITTED", invoice_name=None):
        profile = self._scope()
        request_id = f"test-ledger-{uuid.uuid4().hex}"
        ledger = frappe.get_doc(
            {
                "doctype": DOCTYPE,
                "ledger_key": request_id,
                "client_request_id": request_id,
                "state": state,
                "company": profile.company,
                "pos_profile": profile.name,
                "document_type": "Sales Invoice",
                "invoice_name": invoice_name,
                "request_data": json.dumps({}),
                "payment_context": json.dumps({}),
            }
        ).insert(ignore_permissions=True)
        return ledger

    def test_pos_users_and_managers_have_no_direct_ledger_crud_permissions(self):
        ledger = self._insert_ledger(state="RECEIVED")

        for user in (self.test_user, self.manager_user):
            for permission_type in ("create", "read", "write", "delete"):
                with self.subTest(user=user, permission_type=permission_type):
                    self.assertFalse(
                        frappe.has_permission(
                            DOCTYPE,
                            permission_type,
                            doc=ledger,
                            user=user,
                        )
                    )

            frappe.set_user(user)
            with self.assertRaises(frappe.PermissionError):
                frappe.get_doc(
                    {
                        "doctype": DOCTYPE,
                        "ledger_key": f"forbidden-{uuid.uuid4().hex}",
                        "client_request_id": f"forbidden-{uuid.uuid4().hex}",
                        "state": "RECEIVED",
                        "company": ledger.company,
                        "pos_profile": ledger.pos_profile,
                        "document_type": "Sales Invoice",
                    }
                ).insert()

        frappe.set_user("Administrator")
        frappe.delete_doc(DOCTYPE, ledger.name, force=True, ignore_permissions=True)

    def test_failed_repair_state_survives_real_database_rollback(self):
        invoice_name = frappe.db.get_value(
            "Sales Invoice",
            {"docstatus": 1},
            "name",
        )
        if not invoice_name:
            self.skipTest("A submitted Sales Invoice is required for repair durability test")

        ledger = self._insert_ledger(state="SUBMITTED", invoice_name=invoice_name)
        frappe.db.commit()

        from posawesome.posawesome.api.invoice_processing import creation

        invoice_doc = frappe.get_doc("Sales Invoice", invoice_name)
        with patch.object(
            creation,
            "_process_post_submit_payments",
            side_effect=RuntimeError("durable repair failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "durable repair failure"):
                creation._repair_submitted_invoice_post_submit(ledger, invoice_doc)

        persisted = frappe.db.get_value(
            DOCTYPE,
            ledger.name,
            ["state", "error_message"],
            as_dict=True,
        )
        self.assertEqual(persisted.state, "FAILED")
        self.assertIn("durable repair failure", persisted.error_message)

        frappe.delete_doc(DOCTYPE, ledger.name, force=True, ignore_permissions=True)
        frappe.db.commit()


def run_site_assertions():
    """Run the focused DB assertions without ERPNext's global test-record bootstrap."""

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(
        TestPosInvoiceSubmissionLedger
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise AssertionError(
            f"Ledger site assertions failed: {len(result.failures)} failures, "
            f"{len(result.errors)} errors"
        )
    return {
        "tests_run": result.testsRun,
        "skipped": len(result.skipped),
    }
