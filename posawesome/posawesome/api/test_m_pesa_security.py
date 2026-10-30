import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock


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


class FakeDoc(AttrDict):
    def __init__(self, **kwargs):
        super().__init__(kwargs)
        self.permission_checks = []
        self.submitted = False

    def check_permission(self, permission_type):
        self.permission_checks.append(permission_type)

    def submit(self):
        self.submitted = True
        self.docstatus = 1

    def reload(self):
        return self


def _load_module():
    frappe = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.flt = lambda value: float(value or 0)
    frappe._ = lambda text: text
    frappe.PermissionError = PermissionError
    class DuplicateEntryError(Exception):
        pass
    frappe.DuplicateEntryError = DuplicateEntryError
    frappe.throw = lambda message, *args, **kwargs: (_ for _ in ()).throw(
        PermissionError(message)
    )
    frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe.get_doc = lambda *args, **kwargs: None
    frappe.get_list = lambda *args, **kwargs: []
    frappe.get_all = lambda *args, **kwargs: []
    frappe._dict = lambda value=None: AttrDict(value or {})
    frappe.form_dict = AttrDict()
    frappe.session = types.SimpleNamespace(user="Administrator")
    frappe.get_roles = lambda *_args, **_kwargs: ["System Manager"]
    frappe.new_doc = lambda *args, **kwargs: None
    frappe.log_error = lambda *args, **kwargs: None
    frappe.db = types.SimpleNamespace(
        exists=lambda *args, **kwargs: False,
        commit=lambda: None,
        rollback=lambda: None,
    )
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

    pos_access = types.ModuleType("posawesome.posawesome.api.pos_access")
    pos_access.get_authorized_pos_profile = lambda profile=None, company=None: AttrDict(
        name=profile or "Main POS",
        company=company or "Test Company",
        payments=[AttrDict(mode_of_payment="M-Pesa")],
    )
    sys.modules["posawesome.posawesome.api.pos_access"] = pos_access

    terminal_state = types.ModuleType("posawesome.posawesome.api.terminal_state")
    terminal_state.get_active_terminal_cashier = lambda profile: "cashier@example.com"
    sys.modules["posawesome.posawesome.api.terminal_state"] = terminal_state

    module_name = "posawesome.posawesome.api.m_pesa"
    spec = importlib.util.spec_from_file_location(
        module_name,
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "m_pesa.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestMpesaAuthorization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mpesa = _load_module()
        cls.real_assert_callback_ready = staticmethod(
            cls.mpesa._assert_mpesa_callback_ready
        )

    def setUp(self):
        self.profile = AttrDict(
            name="Main POS",
            company="Test Company",
            payments=[AttrDict(mode_of_payment="M-Pesa")],
        )
        self.mpesa._assert_mpesa_callback_ready = lambda *_args, **_kwargs: {
            "ready": True
        }

    def _install_callback_config(self, token="callback-secret", duplicate=False):
        registration = AttrDict(
            name="MPESA-CONFIG-0001",
            company="Test Company",
            mode_of_payment="M-Pesa",
        )
        config_doc = AttrDict(
            get_password=lambda fieldname, raise_exception=False: token
        )
        callback_doc = FakeDoc()
        callback_doc.inserted = False

        def insert(ignore_permissions=False):
            if duplicate:
                self.mpesa.frappe.db.exists = lambda *_args, **_kwargs: True
                raise self.mpesa.frappe.DuplicateEntryError()
            callback_doc.inserted = ignore_permissions
            return callback_doc

        callback_doc.insert = insert
        self.mpesa.frappe.get_all = lambda *_args, **_kwargs: [registration]
        self.mpesa.frappe.get_doc = lambda *_args, **_kwargs: config_doc
        self.mpesa.frappe.new_doc = lambda *_args, **_kwargs: callback_doc
        self.mpesa.frappe.db.exists = lambda *_args, **_kwargs: False
        return callback_doc

    def _capture_reregistered_urls(self, callback_secret):
        document_module = types.ModuleType("frappe.model.document")

        class Document:
            pass

        document_module.Document = Document
        model_module = types.ModuleType("frappe.model")
        model_module.__path__ = []
        sys.modules["frappe.model"] = model_module
        sys.modules["frappe.model.document"] = document_module
        frappe_utils = sys.modules["frappe.utils"]
        frappe_utils.get_request_site_address = lambda *_args: "https://pos.example.test"
        settings = AttrDict(
            sandbox=1,
            business_shortcode="123456",
            till_number="654321",
            consumer_key="consumer-key",
            get_password=lambda *_args, **_kwargs: "consumer-secret",
        )
        self.mpesa.frappe.get_doc = lambda *_args, **_kwargs: settings
        self.mpesa.frappe.msgprint = lambda *_args, **_kwargs: None
        posted = {}

        class Response:
            def json(self):
                return {"ResponseDescription": "Success"}

        module_name = "test_mpesa_c2b_register_url_upgrade"
        spec = importlib.util.spec_from_file_location(
            module_name,
            REPO_ROOT
            / "posawesome"
            / "posawesome"
            / "doctype"
            / "mpesa_c2b_register_url"
            / "mpesa_c2b_register_url.py",
        )
        controller = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = controller
        spec.loader.exec_module(controller)
        controller.get_token = lambda **_kwargs: "provider-token"
        original_requests_post = controller.requests.post
        self.addCleanup(setattr, controller.requests, "post", original_requests_post)
        controller.requests.post = lambda url, headers=None, json=None: (
            posted.update(url=url, headers=headers, payload=json) or Response()
        )
        registration = controller.MpesaC2BRegisterURL()
        registration.mpesa_settings = "MPESA-SETTINGS-0001"
        registration.get_password = lambda *_args, **_kwargs: callback_secret
        registration.validate()
        self.assertEqual(registration.register_status, "Success")
        return posted["payload"]

    def test_guest_callback_rejects_missing_or_invalid_auth(self):
        self._install_callback_config(token="expected-secret")

        for supplied in (None, "wrong-secret"):
            with self.subTest(supplied=supplied):
                result = self.mpesa.confirmation(
                    callback_token=supplied,
                    TransID="MPESA-TXN-INVALID",
                    BusinessShortCode="123456",
                    TransAmount="10",
                )
                self.assertEqual(result["ResultCode"], 1)

    def test_legacy_registration_upgrade_gate_and_verified_callback(self):
        registration = AttrDict(
            name="MPESA-LEGACY-0001",
            company="Test Company",
            mode_of_payment="M-Pesa",
            business_shortcode="123456",
            till_number="654321",
            register_status="Success",
        )
        secret_state = {"value": None}
        config_doc = AttrDict(
            get_password=lambda fieldname, raise_exception=False: secret_state["value"]
        )
        self.mpesa.frappe.get_all = lambda *_args, **_kwargs: [registration]
        self.mpesa.frappe.get_doc = lambda *_args, **_kwargs: config_doc
        self.mpesa._assert_mpesa_callback_ready = self.real_assert_callback_ready

        legacy = self.mpesa.get_mpesa_callback_readiness(company="Test Company")
        self.assertFalse(legacy["ready"])
        self.assertEqual(
            legacy["missing_callback_secret_registrations"],
            ["MPESA-LEGACY-0001"],
        )
        self.assertNotIn("callback_secret", legacy["registrations"][0])
        with self.assertRaisesRegex(PermissionError, "missing a Callback Secret"):
            self.mpesa._assert_mpesa_callback_ready(self.profile)

        secret_state["value"] = "strong/legacy+upgrade token"
        ready = self.mpesa.get_mpesa_callback_readiness(company="Test Company")
        self.assertTrue(ready["ready"])
        self.assertEqual(ready["missing_callback_secret_count"], 0)
        self.assertNotIn(secret_state["value"], json.dumps(ready))

        payload = self._capture_reregistered_urls(secret_state["value"])
        self.assertIn(
            "callback_token=strong%2Flegacy%2Bupgrade%20token",
            payload["ValidationURL"],
        )
        self.assertIn(
            "callback_token=strong%2Flegacy%2Bupgrade%20token",
            payload["ConfirmationURL"],
        )
        self.assertEqual(payload["ShortCode"], "654321")

        callback_doc = self._install_callback_config(token=secret_state["value"])
        result = self.mpesa.confirmation(
            callback_token=secret_state["value"],
            TransID="MPESA-TXN-UPGRADED",
            BusinessShortCode="123456",
            TransAmount="75",
        )
        self.assertEqual(result["ResultCode"], 0)
        self.assertTrue(callback_doc.inserted)

    def test_readiness_inventory_requires_manager_access(self):
        original_user = self.mpesa.frappe.session.user
        original_get_roles = self.mpesa.frappe.get_roles
        original_get_all = self.mpesa.frappe.get_all
        query = Mock(side_effect=AssertionError("unauthorized readiness query"))
        self.mpesa.frappe.session.user = "cashier@example.com"
        self.mpesa.frappe.get_roles = lambda *_args: ["POS User"]
        self.mpesa.frappe.get_all = query
        self.addCleanup(setattr, self.mpesa.frappe.session, "user", original_user)
        self.addCleanup(setattr, self.mpesa.frappe, "get_roles", original_get_roles)
        self.addCleanup(setattr, self.mpesa.frappe, "get_all", original_get_all)

        with self.assertRaisesRegex(PermissionError, "Manager access is required"):
            self.mpesa.get_mpesa_callback_readiness()
        query.assert_not_called()

    def test_guest_callback_rejects_missing_id_or_nonpositive_amount(self):
        callback_doc = self._install_callback_config()

        for transaction_id, amount in (("", "10"), ("MPESA-TXN-ZERO", "0")):
            with self.subTest(transaction_id=transaction_id, amount=amount):
                result = self.mpesa.confirmation(
                    callback_token="callback-secret",
                    TransID=transaction_id,
                    BusinessShortCode="123456",
                    TransAmount=amount,
                )
                self.assertEqual(result["ResultCode"], 1)
        self.assertFalse(callback_doc.inserted)

    def test_guest_callback_accepts_verified_bound_transaction(self):
        callback_doc = self._install_callback_config()

        result = self.mpesa.confirmation(
            callback_token="callback-secret",
            TransID="MPESA-TXN-0001",
            BusinessShortCode="123456",
            TransAmount="125.50",
            FirstName="Jane",
        )

        self.assertEqual(result, {"ResultCode": 0, "ResultDesc": "Accepted"})
        self.assertTrue(callback_doc.inserted)
        self.assertEqual(callback_doc.transid, "MPESA-TXN-0001")
        self.assertEqual(callback_doc.transamount, 125.5)
        self.assertEqual(callback_doc.company, "Test Company")
        self.assertEqual(callback_doc.mode_of_payment, "M-Pesa")

    def test_guest_callback_duplicate_is_idempotently_accepted(self):
        callback_doc = self._install_callback_config()
        self.mpesa.frappe.db.exists = lambda *_args, **_kwargs: True

        result = self.mpesa.confirmation(
            callback_token="callback-secret",
            TransID="MPESA-TXN-DUPLICATE",
            BusinessShortCode="123456",
            TransAmount="50",
        )

        self.assertEqual(result["ResultCode"], 0)
        self.assertFalse(callback_doc.inserted)

        callback_doc = self._install_callback_config(duplicate=True)
        result = self.mpesa.confirmation(
            callback_token="callback-secret",
            TransID="MPESA-TXN-RACE",
            BusinessShortCode="123456",
            TransAmount="50",
        )
        self.assertEqual(result["ResultCode"], 0)
        self.assertFalse(callback_doc.inserted)

    def test_migration_preserves_duplicate_history_with_unique_surrogate_ids(self):
        updates = []
        duplicate_rows = [
            AttrDict(
                name="MPRE-CANONICAL",
                docstatus=1,
                payment_entry="ACC-PAY-0001",
                creation="2026-01-01",
            ),
            AttrDict(
                name="MPRE-DUPLICATE",
                docstatus=0,
                payment_entry=None,
                creation="2026-01-02",
            ),
        ]

        def sql(query, **kwargs):
            if "where transid is null" in query:
                return ["MPRE-MISSING"]
            return [AttrDict(transid="TXN-EXISTING")]

        original_db = self.mpesa.frappe.db
        original_get_all = self.mpesa.frappe.get_all
        self.mpesa.frappe.db = types.SimpleNamespace(
            table_exists=lambda *_args: True,
            sql=sql,
            exists=lambda *_args, **_kwargs: False,
            set_value=lambda doctype, name, fieldname, value, **kwargs: updates.append(
                (name, value)
            ),
        )
        self.mpesa.frappe.get_all = lambda *_args, **_kwargs: duplicate_rows
        self.addCleanup(setattr, self.mpesa.frappe, "db", original_db)
        self.addCleanup(setattr, self.mpesa.frappe, "get_all", original_get_all)

        module_name = "posawesome.patches.secure_mpesa_callback_transactions"
        spec = importlib.util.spec_from_file_location(
            module_name,
            REPO_ROOT / "posawesome" / "patches" / "secure_mpesa_callback_transactions.py",
        )
        patch_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(patch_module)
        patch_module.execute()

        self.assertIn(("MPRE-MISSING", "legacy-missing-MPRE-MISSING"), updates)
        self.assertIn(
            ("MPRE-DUPLICATE", "TXN-EXISTING#duplicate-MPRE-DUPLICATE"),
            updates,
        )

    def test_cross_company_register_is_rejected_before_mutation(self):
        register = FakeDoc(
            name="MPRE-OTHER-0001",
            company="Other Company",
            customer=None,
            mode_of_payment="M-Pesa",
            docstatus=0,
            payment_entry=None,
        )
        original_get_doc = self.mpesa.frappe.get_doc
        self.mpesa.frappe.get_doc = lambda *_args: register
        self.addCleanup(setattr, self.mpesa.frappe, "get_doc", original_get_doc)

        with self.assertRaisesRegex(PermissionError, "authorized company"):
            self.mpesa.submit_mpesa_payment(
                register.name,
                "CUST-0001",
                pos_profile="Main POS",
            )

        self.assertEqual(register.permission_checks, ["read"])
        self.assertIsNone(register.customer)
        self.assertFalse(register.submitted)

    def test_draft_search_rejects_cross_company_before_query(self):
        original_authorize = self.mpesa.get_authorized_pos_profile
        original_get_list = self.mpesa.frappe.get_list
        query = Mock(side_effect=AssertionError("cross-company search must not query"))
        self.mpesa.get_authorized_pos_profile = Mock(
            side_effect=PermissionError("company not authorized")
        )
        self.mpesa.frappe.get_list = query
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_authorized_pos_profile",
            original_authorize,
        )
        self.addCleanup(setattr, self.mpesa.frappe, "get_list", original_get_list)

        with self.assertRaisesRegex(PermissionError, "company not authorized"):
            self.mpesa.get_mpesa_draft_payments("Other Company")

        query.assert_not_called()

    def test_draft_search_uses_profile_company_modes_and_permission_safe_query(self):
        profile = AttrDict(
            name="Main POS",
            company="Test Company",
            payments=[
                AttrDict(mode_of_payment="M-Pesa"),
                AttrDict(mode_of_payment="M-Pesa Till"),
            ],
        )
        authorize = Mock(return_value=profile)
        terminal = Mock(return_value="cashier@example.com")
        query = Mock(return_value=[])
        original_authorize = self.mpesa.get_authorized_pos_profile
        original_terminal = self.mpesa.get_active_terminal_cashier
        original_get_list = self.mpesa.frappe.get_list
        self.mpesa.get_authorized_pos_profile = authorize
        self.mpesa.get_active_terminal_cashier = terminal
        self.mpesa.frappe.get_list = query
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_authorized_pos_profile",
            original_authorize,
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_active_terminal_cashier",
            original_terminal,
        )
        self.addCleanup(setattr, self.mpesa.frappe, "get_list", original_get_list)

        self.mpesa.get_mpesa_draft_payments(
            "Test Company",
            mobile_no="0700",
            payment_methods_list='["M-Pesa"]',
        )

        authorize.assert_called_once_with(None, company="Test Company")
        terminal.assert_called_once_with("Main POS")
        filters = query.call_args.kwargs["filters"]
        self.assertEqual(filters["company"], "Test Company")
        self.assertEqual(filters["docstatus"], 0)
        self.assertEqual(filters["mode_of_payment"], ["in", ["M-Pesa"]])
        self.assertEqual(filters["msisdn"], ["like", "%0700%"])

    def test_mode_search_returns_only_profile_configured_modes(self):
        profile = AttrDict(
            name="Main POS",
            company="Test Company",
            payments=[AttrDict(mode_of_payment="M-Pesa")],
        )
        original_authorize = self.mpesa.get_authorized_pos_profile
        original_terminal = self.mpesa.get_active_terminal_cashier
        original_readiness = self.mpesa._mpesa_callback_readiness
        original_get_list = self.mpesa.frappe.get_list
        self.mpesa.get_authorized_pos_profile = Mock(return_value=profile)
        self.mpesa.get_active_terminal_cashier = Mock(
            return_value="cashier@example.com"
        )
        self.mpesa._mpesa_callback_readiness = Mock(return_value={"ready": True})
        self.mpesa.frappe.get_list = Mock(
            return_value=[
                AttrDict(mode_of_payment="M-Pesa"),
                AttrDict(mode_of_payment="Other Company's Mode"),
            ]
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_authorized_pos_profile",
            original_authorize,
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_active_terminal_cashier",
            original_terminal,
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "_mpesa_callback_readiness",
            original_readiness,
        )
        self.addCleanup(setattr, self.mpesa.frappe, "get_list", original_get_list)

        result = self.mpesa.get_mpesa_mode_of_payment("Test Company")

        self.assertEqual(result, ["M-Pesa"])
        self.mpesa._mpesa_callback_readiness.assert_called_once_with(
            company="Test Company",
            allowed_methods={"M-Pesa"},
        )
        self.mpesa.frappe.get_list.assert_called_once_with(
            "Mpesa C2B Register URL",
            filters={"company": "Test Company", "register_status": "Success"},
            fields=["mode_of_payment"],
        )

    def test_mode_discovery_is_silent_when_mpesa_is_not_ready(self):
        profile = AttrDict(
            name="Main POS",
            company="Test Company",
            payments=[AttrDict(mode_of_payment="Cash")],
        )
        original_authorize = self.mpesa.get_authorized_pos_profile
        original_terminal = self.mpesa.get_active_terminal_cashier
        original_readiness = self.mpesa._mpesa_callback_readiness
        original_get_list = self.mpesa.frappe.get_list
        self.mpesa.get_authorized_pos_profile = Mock(return_value=profile)
        self.mpesa.get_active_terminal_cashier = Mock(
            return_value="cashier@example.com"
        )
        self.mpesa._mpesa_callback_readiness = Mock(return_value={"ready": False})
        self.mpesa.frappe.get_list = Mock(
            side_effect=AssertionError("unready M-Pesa modes must not be queried")
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_authorized_pos_profile",
            original_authorize,
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "get_active_terminal_cashier",
            original_terminal,
        )
        self.addCleanup(
            setattr,
            self.mpesa,
            "_mpesa_callback_readiness",
            original_readiness,
        )
        self.addCleanup(setattr, self.mpesa.frappe, "get_list", original_get_list)

        result = self.mpesa.get_mpesa_mode_of_payment(
            "Test Company",
            pos_profile="Main POS",
        )

        self.assertEqual(result, [])
        self.mpesa._mpesa_callback_readiness.assert_called_once_with(
            company="Test Company",
            allowed_methods={"Cash"},
        )
        self.mpesa.frappe.get_list.assert_not_called()

    def test_draft_register_requires_profile_mode_and_matching_customer(self):
        register = FakeDoc(
            name="MPRE-0001",
            company="Test Company",
            customer="CUST-OTHER",
            mode_of_payment="M-Pesa",
            docstatus=0,
            payment_entry=None,
        )
        self.mpesa.frappe.get_doc = lambda *_args: register

        with self.assertRaisesRegex(PermissionError, "another customer"):
            self.mpesa.get_authorized_mpesa_payment(
                register.name,
                "CUST-0001",
                self.profile,
            )

        register.customer = None
        register.mode_of_payment = "Unconfigured Mobile Money"
        with self.assertRaisesRegex(PermissionError, "not configured"):
            self.mpesa.get_authorized_mpesa_payment(
                register.name,
                "CUST-0001",
                self.profile,
            )

    def test_submitted_replay_requires_canonical_linked_payment_entry(self):
        register = FakeDoc(
            name="MPRE-0002",
            company="Test Company",
            customer="CUST-0001",
            mode_of_payment="M-Pesa",
            docstatus=1,
            payment_entry="ACC-PAY-0002",
        )
        payment_entry = FakeDoc(
            name="ACC-PAY-0002",
            company="Test Company",
            party_type="Customer",
            party="CUST-OTHER",
            payment_type="Receive",
            docstatus=1,
        )

        def get_doc(doctype, _name):
            return register if doctype == "Mpesa Payment Register" else payment_entry

        self.mpesa.frappe.get_doc = get_doc
        with self.assertRaisesRegex(PermissionError, "outside the authorized scope"):
            self.mpesa.get_authorized_mpesa_payment(
                register.name,
                "CUST-0001",
                self.profile,
                allow_submitted=True,
            )

        self.assertEqual(register.permission_checks, ["read"])
        self.assertEqual(payment_entry.permission_checks, ["read"])

    def test_submit_uses_server_loaded_register_and_permission_checks(self):
        register = FakeDoc(
            name="MPRE-0003",
            company="Test Company",
            customer=None,
            mode_of_payment="M-Pesa",
            docstatus=0,
            payment_entry="ACC-PAY-0003",
        )
        payment_entry = FakeDoc(name="ACC-PAY-0003", docstatus=1)
        register.payment_entry = None

        def get_doc(doctype, _name):
            if doctype == "Mpesa Payment Register":
                return register
            return payment_entry

        self.mpesa.frappe.get_doc = get_doc
        terminal = Mock(return_value="cashier@example.com")
        self.mpesa.get_active_terminal_cashier = terminal

        result = self.mpesa.submit_mpesa_payment(
            register.name,
            "CUST-0001",
            pos_profile="Main POS",
        )

        terminal.assert_called_once_with("Main POS")
        self.assertEqual(register.permission_checks, ["read", "write", "submit"])
        self.assertEqual(register.customer, "CUST-0001")
        self.assertEqual(register.submit_payment, 1)
        self.assertTrue(register.submitted)
        self.assertIs(result, payment_entry)


if __name__ == "__main__":
    unittest.main()
