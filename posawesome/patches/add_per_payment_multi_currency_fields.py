import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELDS_BY_DOCTYPE = {
    "POS Profile": [
        {
            "fieldname": "posa_enable_multi_currency_payments",
            "label": "Enable Multi-Currency Payments",
            "fieldtype": "Check",
            "default": "0",
            "depends_on": "eval:doc.posa_allow_multi_currency==1",
            "insert_after": "posa_allow_multi_currency",
        },
        {
            "fieldname": "posa_allowed_currencies",
            "label": "Allowed POS Currencies",
            "fieldtype": "Table",
            "options": "POS Allowed Currency",
            "depends_on": "eval:doc.posa_allow_multi_currency==1",
            "insert_after": "posa_enable_multi_currency_payments",
        },
        {
            "fieldname": "posa_allow_payment_currency_selection",
            "label": "Allow Payment Currency Selection",
            "fieldtype": "Check",
            "default": "1",
            "depends_on": "eval:doc.posa_enable_multi_currency_payments==1",
            "insert_after": "posa_allowed_currencies",
        },
        {
            "fieldname": "posa_allow_manual_payment_exchange_rate",
            "label": "Allow Manual Payment Exchange Rate",
            "fieldtype": "Check",
            "default": "0",
            "depends_on": "eval:doc.posa_enable_multi_currency_payments==1",
            "insert_after": "posa_allow_payment_currency_selection",
        },
        {
            "fieldname": "posa_default_payment_currency",
            "label": "Default Payment Currency",
            "fieldtype": "Link",
            "options": "Currency",
            "depends_on": "eval:doc.posa_enable_multi_currency_payments==1",
            "insert_after": "posa_allow_manual_payment_exchange_rate",
        },
        {
            "fieldname": "posa_enable_multi_currency_change",
            "label": "Enable Multi-Currency Change Helper",
            "fieldtype": "Check",
            "default": "1",
            "depends_on": "eval:doc.posa_enable_multi_currency_payments==1",
            "insert_after": "posa_default_payment_currency",
        },
    ],
    "POS Payment Method": [
        {
            "fieldname": "posa_default_payment_currency",
            "label": "Default Payment Currency",
            "fieldtype": "Link",
            "options": "Currency",
            "insert_after": "mode_of_payment",
        }
    ],
    "Sales Invoice Payment": [
        {
            "fieldname": "posa_payment_currency",
            "label": "Payment Currency",
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
            "insert_after": "posa_payment_currency",
        },
        {
            "fieldname": "posa_exchange_rate",
            "label": "Payment to Invoice Exchange Rate",
            "fieldtype": "Float",
            "insert_after": "posa_original_amount",
        },
        {
            "fieldname": "posa_company_exchange_rate",
            "label": "Payment to Company Exchange Rate",
            "fieldtype": "Float",
            "insert_after": "posa_exchange_rate",
        },
        {
            "fieldname": "posa_rate_date",
            "label": "Payment Exchange Rate Date",
            "fieldtype": "Date",
            "insert_after": "posa_company_exchange_rate",
        },
        {
            "fieldname": "posa_rate_source",
            "label": "Payment Exchange Rate Source",
            "fieldtype": "Select",
            "options": "same_currency\ncurrency_exchange\nmanual\noffline_cache\nderived_inverse",
            "insert_after": "posa_rate_date",
        },
        {
            "fieldname": "posa_account_currency",
            "label": "Payment Account Currency",
            "fieldtype": "Link",
            "options": "Currency",
            "read_only": 1,
            "insert_after": "account",
        },
        {
            "fieldname": "posa_account_amount",
            "label": "Payment Account Amount",
            "fieldtype": "Currency",
            "options": "posa_account_currency",
            "read_only": 1,
            "insert_after": "posa_account_currency",
        },
    ],
    "Sales Invoice": [
        {
            "fieldname": "posa_change_returns",
            "label": "Physical Change Returned",
            "fieldtype": "Table",
            "options": "POS Currency Change Return",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "change_amount",
        },
        {
            "fieldname": "posa_change_returned",
            "label": "Physical Change Returned Total",
            "fieldtype": "Currency",
            "options": "currency",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "posa_change_returns",
        },
        {
            "fieldname": "posa_remaining_change",
            "label": "Remaining Physical Change",
            "fieldtype": "Currency",
            "options": "currency",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "posa_change_returned",
        },
    ],
    "POS Invoice": [
        {
            "fieldname": "posa_change_returns",
            "label": "Physical Change Returned",
            "fieldtype": "Table",
            "options": "POS Currency Change Return",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "change_amount",
        },
        {
            "fieldname": "posa_change_returned",
            "label": "Physical Change Returned Total",
            "fieldtype": "Currency",
            "options": "currency",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "posa_change_returns",
        },
        {
            "fieldname": "posa_remaining_change",
            "label": "Remaining Physical Change",
            "fieldtype": "Currency",
            "options": "currency",
            "read_only": 1,
            "allow_on_submit": 1,
            "insert_after": "posa_change_returned",
        },
    ],
}


def execute():
    for doctype, fields in FIELDS_BY_DOCTYPE.items():
        for field in fields:
            name = f"{doctype}-{field['fieldname']}"
            if not frappe.db.exists("Custom Field", name):
                create_custom_field(doctype, field)
            else:
                frappe.db.set_value(
                    "Custom Field",
                    name,
                    {key: value for key, value in field.items() if key != "fieldname"},
                    update_modified=False,
                )
        frappe.clear_cache(doctype=doctype)
