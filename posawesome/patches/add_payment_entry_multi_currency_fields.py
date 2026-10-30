import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELDS = [
    {
        "fieldname": "posa_payment_currency",
        "label": "Tender Currency",
        "fieldtype": "Link",
        "options": "Currency",
        "insert_after": "mode_of_payment",
    },
    {
        "fieldname": "posa_original_amount",
        "label": "Original Tender Amount",
        "fieldtype": "Currency",
        "options": "posa_payment_currency",
        "precision": "9",
        "read_only": 1,
        "insert_after": "posa_payment_currency",
    },
    {
        "fieldname": "posa_invoice_currency",
        "label": "Settlement Currency",
        "fieldtype": "Link",
        "options": "Currency",
        "read_only": 1,
        "insert_after": "posa_original_amount",
    },
    {
        "fieldname": "posa_exchange_rate",
        "label": "Tender to Settlement Exchange Rate",
        "fieldtype": "Float",
        "read_only": 1,
        "insert_after": "posa_invoice_currency",
    },
    {
        "fieldname": "posa_company_exchange_rate",
        "label": "Tender to Company Exchange Rate",
        "fieldtype": "Float",
        "read_only": 1,
        "insert_after": "posa_exchange_rate",
    },
    {
        "fieldname": "posa_rate_date",
        "label": "Tender Exchange Rate Date",
        "fieldtype": "Date",
        "read_only": 1,
        "insert_after": "posa_company_exchange_rate",
    },
    {
        "fieldname": "posa_rate_source",
        "label": "Tender Exchange Rate Source",
        "fieldtype": "Select",
        "options": "same_currency\ncurrency_exchange\nmanual\noffline_cache\nderived_inverse",
        "read_only": 1,
        "insert_after": "posa_rate_date",
    },
    {
        "fieldname": "posa_account_currency",
        "label": "Payment Account Currency",
        "fieldtype": "Link",
        "options": "Currency",
        "read_only": 1,
        "insert_after": "paid_to_account_currency",
    },
    {
        "fieldname": "posa_account_amount",
        "label": "Payment Account Amount",
        "fieldtype": "Currency",
        "options": "posa_account_currency",
        "read_only": 1,
        "insert_after": "posa_account_currency",
    },
]


def execute():
    for field in FIELDS:
        name = f"Payment Entry-{field['fieldname']}"
        if not frappe.db.exists("Custom Field", name):
            create_custom_field("Payment Entry", field)
        else:
            frappe.db.set_value(
                "Custom Field",
                name,
                {key: value for key, value in field.items() if key != "fieldname"},
                update_modified=False,
            )
    frappe.clear_cache(doctype="Payment Entry")
