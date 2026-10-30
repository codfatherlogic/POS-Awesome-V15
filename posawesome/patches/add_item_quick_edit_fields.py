import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELDS = {
    "Item": [
        {
            "fieldname": "retailmind_short_name",
            "label": "POS Short Name",
            "fieldtype": "Data",
            "insert_after": "item_name",
            "description": "Short pharmacy display name used by POS Awesome item maintenance.",
        },
        {
            "fieldname": "retailmind_controlled_item",
            "label": "Controlled Item",
            "fieldtype": "Check",
            "default": "0",
            "insert_after": "max_discount",
            "description": "Flags steroid, narcotic, or controlled products for POS warning/logging.",
        },
        {
            "fieldname": "retailmind_non_discountable",
            "label": "Non Discountable",
            "fieldtype": "Check",
            "default": "0",
            "insert_after": "retailmind_controlled_item",
            "description": "Prevents POS line discounts for this item.",
        },
        {
            "fieldname": "retailmind_locked_for_sale",
            "label": "Locked For Sale",
            "fieldtype": "Check",
            "default": "0",
            "insert_after": "retailmind_non_discountable",
            "description": "Keeps the item searchable but blocks adding it to POS sales.",
        },
    ],
    "POS Profile": [
        {
            "fieldname": "posa_allow_item_quick_edit",
            "label": "Allow Item Quick Edit",
            "fieldtype": "Check",
            "default": "0",
            "insert_after": "posa_allow_create_purchase_items",
            "description": "Allow POS supervisors on this profile to update item master data and prices from POS.",
        },
    ],
}


def _upsert_custom_field(doctype, field):
    custom_field_name = f"{doctype}-{field['fieldname']}"
    if not frappe.db.exists("Custom Field", custom_field_name):
        create_custom_field(doctype, field)
        return

    updates = {key: value for key, value in field.items() if key != "insert_after"}
    frappe.db.set_value("Custom Field", custom_field_name, updates, update_modified=False)
    frappe.db.set_value(
        "Custom Field",
        custom_field_name,
        "insert_after",
        field["insert_after"],
        update_modified=False,
    )


def execute():
    for doctype, fields in FIELDS.items():
        for field in fields:
            _upsert_custom_field(doctype, field)
        frappe.clear_cache(doctype=doctype)
