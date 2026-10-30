import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELD = {
    "fieldname": "posa_fast_counter_positive_stock_only",
    "label": "Fast Counter Positive Stock Only",
    "fieldtype": "Check",
    "default": "0",
    "depends_on": "posa_fast_counter_mode",
    "description": "Only load items with positive stock in the POS Profile warehouse into the Fast Counter hot catalog.",
    "insert_after": "posa_hot_catalog_limit",
}


def execute():
    custom_field_name = f"POS Profile-{FIELD['fieldname']}"
    if not frappe.db.exists("Custom Field", custom_field_name):
        create_custom_field("POS Profile", FIELD)
    else:
        updates = {key: value for key, value in FIELD.items() if key != "insert_after"}
        frappe.db.set_value(
            "Custom Field",
            custom_field_name,
            updates,
            update_modified=False,
        )
        frappe.db.set_value(
            "Custom Field",
            custom_field_name,
            "insert_after",
            FIELD["insert_after"],
            update_modified=False,
        )

    if frappe.db.exists("Custom Field", "POS Profile-posa_force_reload_items"):
        frappe.db.set_value(
            "Custom Field",
            "POS Profile-posa_force_reload_items",
            "insert_after",
            FIELD["fieldname"],
            update_modified=False,
        )
