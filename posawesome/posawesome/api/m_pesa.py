# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe, requests
from frappe import _
from requests.auth import HTTPBasicAuth
import json
from frappe.utils import cint
from frappe.utils import flt
import hmac
from urllib.parse import quote

from posawesome.posawesome.api.pos_access import get_authorized_pos_profile
from posawesome.posawesome.api.terminal_state import get_active_terminal_cashier


MPESA_ADMIN_ROLES = frozenset({"System Manager", "Accounts Manager"})


def _permission_denied(message):
    frappe.throw(message, getattr(frappe, "PermissionError", PermissionError))


def _doc_value(doc, key, default=None):
    if isinstance(doc, dict):
        return doc.get(key, default)
    getter = getattr(doc, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(doc, key, default)


def _profile_payment_methods(profile_doc):
    return {
        str(_doc_value(row, "mode_of_payment") or "").strip()
        for row in (_doc_value(profile_doc, "payments") or [])
        if str(_doc_value(row, "mode_of_payment") or "").strip()
    }


def build_mpesa_callback_urls(site_url, callback_secret):
    callback_secret = str(callback_secret or "").strip()
    if not callback_secret:
        raise ValueError("M-Pesa callback secret is required.")
    callback_query = "?callback_token=" + quote(callback_secret, safe="")
    method_root = (
        str(site_url or "").rstrip("/")
        + "/api/method/posawesome.posawesome.api.m_pesa."
    )
    return {
        "validation_url": method_root + "validation" + callback_query,
        "confirmation_url": method_root + "confirmation" + callback_query,
    }


def _mpesa_callback_readiness(company=None, allowed_methods=None):
    filters = {"register_status": "Success"}
    if company:
        filters["company"] = company
    rows = frappe.get_all(
        "Mpesa C2B Register URL",
        filters=filters,
        fields=[
            "name",
            "company",
            "mode_of_payment",
            "business_shortcode",
            "till_number",
            "register_status",
        ],
        order_by="company asc, mode_of_payment asc, name asc",
    )
    allowed_methods = {
        str(value or "").strip()
        for value in (allowed_methods or [])
        if str(value or "").strip()
    }
    if allowed_methods:
        rows = [row for row in rows if row.get("mode_of_payment") in allowed_methods]

    registrations = []
    missing = []
    for row in rows:
        registration_doc = frappe.get_doc("Mpesa C2B Register URL", row.get("name"))
        configured = bool(
            registration_doc.get_password("callback_secret", raise_exception=False)
        )
        public_row = {
            "name": row.get("name"),
            "company": row.get("company"),
            "mode_of_payment": row.get("mode_of_payment"),
            "business_shortcode": row.get("business_shortcode"),
            "till_number": row.get("till_number"),
            "register_status": row.get("register_status"),
            "callback_secret_configured": configured,
        }
        registrations.append(public_row)
        if not configured:
            missing.append(row.get("name"))

    return {
        "ready": bool(registrations) and not missing,
        "successful_registration_count": len(registrations),
        "missing_callback_secret_count": len(missing),
        "missing_callback_secret_registrations": missing,
        "registrations": registrations,
    }


def _assert_mpesa_callback_ready(profile_doc, mode_of_payment=None):
    allowed_methods = _profile_payment_methods(profile_doc)
    if mode_of_payment:
        allowed_methods = {str(mode_of_payment).strip()}
    readiness = _mpesa_callback_readiness(
        company=str(profile_doc.get("company") or "").strip(),
        allowed_methods=allowed_methods,
    )
    if not readiness["successful_registration_count"]:
        frappe.throw(
            _(
                "M-Pesa is not ready: no successful callback registration exists for "
                "this company and payment mode."
            )
        )
    if readiness["missing_callback_secret_count"]:
        frappe.throw(
            _(
                "M-Pesa is not ready: successful callback registrations are missing a "
                "Callback Secret. Configure and re-register them before using M-Pesa."
            )
        )
    return readiness


def _require_mpesa_admin():
    user = str(getattr(getattr(frappe, "session", None), "user", "") or "").strip()
    roles = set(frappe.get_roles(user) or [])
    if user != "Administrator" and not roles.intersection(MPESA_ADMIN_ROLES):
        _permission_denied(_("System Manager or Accounts Manager access is required."))


@frappe.whitelist()
def get_mpesa_callback_readiness(company=None):
    _require_mpesa_admin()
    return _mpesa_callback_readiness(company=company)


def get_authorized_mpesa_payment(
    mpesa_payment,
    customer,
    profile_doc,
    allow_submitted=False,
):
    doc = frappe.get_doc("Mpesa Payment Register", mpesa_payment)
    doc.check_permission("read")
    company = str(_doc_value(profile_doc, "company") or "").strip()
    customer = str(customer or "").strip()
    if str(_doc_value(doc, "company") or "").strip() != company:
        _permission_denied(_("M-Pesa payment does not belong to the authorized company."))

    _assert_mpesa_callback_ready(
        profile_doc,
        mode_of_payment=str(_doc_value(doc, "mode_of_payment") or "").strip(),
    )

    allowed_methods = _profile_payment_methods(profile_doc)
    if not allowed_methods or str(_doc_value(doc, "mode_of_payment") or "").strip() not in allowed_methods:
        _permission_denied(_("M-Pesa payment is not configured for this POS Profile."))

    linked_customer = str(_doc_value(doc, "customer") or "").strip()
    if linked_customer and linked_customer != customer:
        _permission_denied(_("M-Pesa payment belongs to another customer."))

    docstatus = cint(_doc_value(doc, "docstatus"))
    payment_entry_name = str(_doc_value(doc, "payment_entry") or "").strip()
    if docstatus == 0:
        if payment_entry_name:
            _permission_denied(_("Draft M-Pesa payment already has a linked Payment Entry."))
        return doc
    if not allow_submitted or docstatus != 1 or not payment_entry_name or linked_customer != customer:
        _permission_denied(_("M-Pesa payment is not eligible for this request."))

    payment_entry = frappe.get_doc("Payment Entry", payment_entry_name)
    payment_entry.check_permission("read")
    if (
        cint(_doc_value(payment_entry, "docstatus")) != 1
        or str(_doc_value(payment_entry, "company") or "").strip() != company
        or str(_doc_value(payment_entry, "party_type") or "").strip() != "Customer"
        or str(_doc_value(payment_entry, "party") or "").strip() != str(customer or "").strip()
        or str(_doc_value(payment_entry, "payment_type") or "").strip() != "Receive"
    ):
        _permission_denied(_("Linked M-Pesa Payment Entry is outside the authorized scope."))
    return doc


def get_token(app_key, app_secret, base_url):
    authenticate_uri = "/oauth/v1/generate?grant_type=client_credentials"
    authenticate_url = "{0}{1}".format(base_url, authenticate_uri)

    r = requests.get(authenticate_url, auth=HTTPBasicAuth(app_key, app_secret))

    return r.json()["access_token"]


def _callback_value(args, *keys):
    for key in keys:
        value = args.get(key)
        if value not in (None, ""):
            return value
    return None


def _callback_result(accepted):
    return {
        "ResultCode": 0 if accepted else 1,
        "ResultDesc": "Accepted" if accepted else "Rejected",
    }


def _verified_callback_context(args):
    transaction_id = str(_callback_value(args, "TransID", "transid") or "").strip()
    shortcode = str(
        _callback_value(args, "BusinessShortCode", "businessshortcode") or ""
    ).strip()
    amount = flt(_callback_value(args, "TransAmount", "transamount"))
    callback_token = str(
        _callback_value(args, "callback_token", "CallbackToken")
        or getattr(getattr(frappe, "form_dict", None), "callback_token", "")
        or ""
    ).strip()
    if not transaction_id or not shortcode or amount <= 0 or not callback_token:
        raise frappe.PermissionError("Invalid M-Pesa callback.")

    registrations = []
    seen_registrations = set()
    for shortcode_field in ("business_shortcode", "till_number"):
        for registration in frappe.get_all(
            "Mpesa C2B Register URL",
            filters={shortcode_field: shortcode, "register_status": "Success"},
            fields=["name", "company", "mode_of_payment"],
        ):
            if registration.get("name") not in seen_registrations:
                registrations.append(registration)
                seen_registrations.add(registration.get("name"))
    for registration in registrations:
        registration_doc = frappe.get_doc(
            "Mpesa C2B Register URL", registration.get("name")
        )
        expected = registration_doc.get_password(
            "callback_secret", raise_exception=False
        )
        if expected and hmac.compare_digest(str(expected), callback_token):
            return {
                "transaction_id": transaction_id,
                "amount": amount,
                "shortcode": shortcode,
                "company": registration.get("company"),
                "mode_of_payment": registration.get("mode_of_payment"),
            }
    raise frappe.PermissionError("Invalid M-Pesa callback.")


@frappe.whitelist(allow_guest=True)
def confirmation(**kwargs):
    try:
        args = frappe._dict(kwargs)
        context = _verified_callback_context(args)
        if frappe.db.exists(
            "Mpesa Payment Register", {"transid": context["transaction_id"]}
        ):
            return _callback_result(True)
        doc = frappe.new_doc("Mpesa Payment Register")
        doc.transactiontype = args.get("TransactionType")
        doc.transid = context["transaction_id"]
        doc.transtime = args.get("TransTime")
        doc.transamount = context["amount"]
        doc.businessshortcode = context["shortcode"]
        doc.billrefnumber = args.get("BillRefNumber")
        doc.invoicenumber = args.get("InvoiceNumber")
        doc.orgaccountbalance = args.get("OrgAccountBalance")
        doc.thirdpartytransid = args.get("ThirdPartyTransID")
        doc.msisdn = args.get("MSISDN")
        doc.firstname = args.get("FirstName")
        doc.middlename = args.get("MiddleName")
        doc.lastname = args.get("LastName")
        doc.company = context["company"]
        doc.mode_of_payment = context["mode_of_payment"]
        doc.insert(ignore_permissions=True)
        # Persist the webhook receipt before acknowledging M-Pesa.
        frappe.db.commit()
        return _callback_result(True)
    except frappe.DuplicateEntryError:
        frappe.db.rollback()
        transaction_id = str(kwargs.get("TransID") or kwargs.get("transid") or "").strip()
        return _callback_result(
            bool(
                transaction_id
                and frappe.db.exists(
                    "Mpesa Payment Register", {"transid": transaction_id}
                )
            )
        )
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            "M-Pesa callback rejected or failed without persisting payload data.",
            "M-Pesa Callback Error",
        )
        return _callback_result(False)


@frappe.whitelist(allow_guest=True)
def validation(**kwargs):
    try:
        _verified_callback_context(frappe._dict(kwargs))
        return _callback_result(True)
    except Exception:
        return _callback_result(False)


@frappe.whitelist()
def get_mpesa_mode_of_payment(company, pos_profile=None):
    profile_doc = get_authorized_pos_profile(pos_profile, company=company)
    get_active_terminal_cashier(profile_doc.get("name"))
    company = str(profile_doc.get("company") or "").strip()
    allowed_methods = _profile_payment_methods(profile_doc)
    readiness = _mpesa_callback_readiness(
        company=company,
        allowed_methods=allowed_methods,
    )
    if not readiness["ready"]:
        return []
    modes = frappe.get_list(
        "Mpesa C2B Register URL",
        filters={"company": company, "register_status": "Success"},
        fields=["mode_of_payment"],
    )
    modes_of_payment = []
    for mode in modes:
        if (
            mode.mode_of_payment in allowed_methods
            and mode.mode_of_payment not in modes_of_payment
        ):
            modes_of_payment.append(mode.mode_of_payment)
    return modes_of_payment


@frappe.whitelist()
def get_mpesa_draft_payments(
    company,
    mode_of_payment=None,
    mobile_no=None,
    full_name=None,
    payment_methods_list=None,
    pos_profile=None,
):
    profile_doc = get_authorized_pos_profile(pos_profile, company=company)
    get_active_terminal_cashier(profile_doc.get("name"))
    company = str(profile_doc.get("company") or "").strip()
    allowed_methods = _profile_payment_methods(profile_doc)
    if not allowed_methods:
        _permission_denied(_("No payment methods are configured for this POS Profile."))
    _assert_mpesa_callback_ready(profile_doc)

    requested_methods = set()
    if mode_of_payment:
        requested_methods.add(str(mode_of_payment).strip())
    if payment_methods_list:
        try:
            decoded_methods = json.loads(payment_methods_list)
            if not isinstance(decoded_methods, list):
                raise ValueError
            requested_methods.update(
                str(value or "").strip()
                for value in decoded_methods
                if str(value or "").strip()
            )
        except (TypeError, ValueError):
            frappe.throw(_("Invalid payment method filter."))
    if requested_methods and not requested_methods.issubset(allowed_methods):
        _permission_denied(_("A payment method is not configured for this POS Profile."))

    filters = {
        "company": company,
        "docstatus": 0,
        "mode_of_payment": ["in", sorted(requested_methods or allowed_methods)],
    }
    if mobile_no:
        filters["msisdn"] = ["like", f"%{mobile_no}%"]
    if full_name:
        filters["full_name"] = ["like", f"%{full_name}%"]

    payments = frappe.get_list(
        "Mpesa Payment Register",
        filters=filters,
        fields=[
            "name",
            "transid",
            "msisdn as mobile_no",
            "full_name",
            "posting_date",
            "transamount as amount",
            "currency",
            "mode_of_payment",
            "company",
        ],
        order_by="posting_date desc",
    )
    return payments


@frappe.whitelist()
def submit_mpesa_payment(mpesa_payment, customer, pos_profile=None):
    profile_doc = get_authorized_pos_profile(pos_profile)
    get_active_terminal_cashier(profile_doc.get("name"))
    doc = get_authorized_mpesa_payment(
        mpesa_payment,
        customer,
        profile_doc,
        allow_submitted=False,
    )
    doc.check_permission("write")
    doc.check_permission("submit")
    doc.customer = customer
    doc.submit_payment = 1
    doc.submit()
    doc.reload()
    return frappe.get_doc("Payment Entry", doc.payment_entry)
