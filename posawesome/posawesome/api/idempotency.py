import frappe
from frappe import _


INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")


def _string(value):
    return str(value or "").strip()


def _permission_denied(message):
    frappe.throw(message, getattr(frappe, "PermissionError", PermissionError))


def _document_value(document, fieldname):
    getter = getattr(document, "get", None)
    if callable(getter):
        return getter(fieldname)
    return getattr(document, fieldname, None)


def assert_invoice_request_scope(
    invoice_doc,
    *,
    pos_profile,
    company,
    permission_type="read",
):
    """Authorize an invoice reached through a client-controlled name or request ID."""

    expected_profile = _string(pos_profile)
    expected_company = _string(company)
    if not invoice_doc or not expected_profile or not expected_company:
        _permission_denied(_("This invoice is not available for the selected POS Profile."))

    if (
        _string(_document_value(invoice_doc, "pos_profile")) != expected_profile
        or _string(_document_value(invoice_doc, "company")) != expected_company
    ):
        _permission_denied(_("This invoice is not available for the selected POS Profile."))

    check_permission = getattr(invoice_doc, "check_permission", None)
    if callable(check_permission):
        check_permission(permission_type)
    return invoice_doc


def normalize_client_request_id(value):
    normalized = (value or "").strip()
    return normalized or None


def extract_invoice_client_request_id(invoice=None, data=None):
    invoice = invoice or {}
    data = data or {}
    return normalize_client_request_id(
        invoice.get("posa_client_request_id") or data.get("idempotency_key") or data.get("client_request_id")
    )


def normalize_invoice_request_identity(invoice=None, data=None, client_request_id=None):
    invoice = invoice if isinstance(invoice, dict) else {}
    data = data if isinstance(data, dict) else {}
    request_id = normalize_client_request_id(client_request_id) or extract_invoice_client_request_id(
        invoice, data
    )
    if request_id:
        invoice["posa_client_request_id"] = request_id
        data["idempotency_key"] = request_id
        data["client_request_id"] = request_id
    return request_id


def strip_invoice_client_request_id(payload):
    if isinstance(payload, dict):
        payload.pop("posa_client_request_id", None)
    return payload


def doctype_supports_client_request_id(doctype):
    has_column = getattr(getattr(frappe, "db", None), "has_column", None)
    if not callable(has_column):
        return True
    try:
        return bool(has_column(doctype, "posa_client_request_id"))
    except Exception:
        return False


def set_invoice_client_request_id(invoice_doc, client_request_id):
    if client_request_id and doctype_supports_client_request_id(getattr(invoice_doc, "doctype", None)):
        invoice_doc.posa_client_request_id = client_request_id
    return invoice_doc


def find_invoice_by_client_request_id(
    client_request_id,
    preferred_doctype=None,
    *,
    pos_profile,
    company,
    permission_type="read",
):
    if not client_request_id:
        return None

    if not _string(pos_profile) or not _string(company):
        _permission_denied(_("POS Profile and company are required to replay an invoice request."))

    doctypes = []
    if preferred_doctype:
        doctypes.append(preferred_doctype)
    doctypes.extend(doctype for doctype in INVOICE_DOCTYPES if doctype not in doctypes)

    for doctype in doctypes:
        if not doctype_supports_client_request_id(doctype):
            continue
        existing_name = frappe.db.get_value(
            doctype,
            {"posa_client_request_id": client_request_id},
            "name",
        )
        if existing_name:
            return assert_invoice_request_scope(
                frappe.get_doc(doctype, existing_name),
                pos_profile=pos_profile,
                company=company,
                permission_type=permission_type,
            )

    return None


def find_payment_entries_by_client_request_id(
    client_request_id,
    *,
    company,
    party_type,
    party,
):
    if not client_request_id or not doctype_supports_client_request_id("Payment Entry"):
        return []

    company = _string(company)
    party_type = _string(party_type)
    party = _string(party)
    if not company or not party_type or not party:
        _permission_denied(_("Company and party are required to replay a payment request."))

    fields = [
        "name",
        "company",
        "paid_amount",
        "received_amount",
        "posting_date",
        "mode_of_payment",
        "party",
        "party_type",
        "docstatus",
        "posa_client_request_id",
    ]
    has_column = getattr(frappe.db, "has_column", lambda *_args: False)
    for fieldname in ("posa_payment_currency", "posa_original_amount"):
        if has_column("Payment Entry", fieldname):
            fields.append(fieldname)

    rows = frappe.get_list(
        "Payment Entry",
        filters={
            "posa_client_request_id": client_request_id,
            "company": company,
            "party_type": party_type,
            "party": party,
        },
        fields=fields,
        order_by="creation asc",
    )
    return list(rows or [])
