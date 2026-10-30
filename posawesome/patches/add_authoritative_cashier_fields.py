import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELD = {
    "fieldname": "posa_cashier",
    "label": "POS Cashier",
    "fieldtype": "Link",
    "options": "User",
    "insert_after": "posa_pos_opening_shift",
    "read_only": 1,
    "no_copy": 1,
    "in_standard_filter": 1,
    "description": "Authoritative cashier verified by the server for this terminal sale.",
}


def execute():
    for doctype in ("Sales Invoice", "POS Invoice"):
        custom_field_name = f"{doctype}-{FIELD['fieldname']}"
        if not frappe.db.exists("Custom Field", custom_field_name):
            create_custom_field(doctype, FIELD)
        else:
            frappe.db.set_value(
                "Custom Field",
                custom_field_name,
                {key: value for key, value in FIELD.items() if key != "fieldname"},
                update_modified=False,
            )
        frappe.clear_cache(doctype=doctype)
