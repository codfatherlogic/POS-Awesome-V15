import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


PROFILE_FIELDS = [
    {
        "fieldname": "posa_enable_below_cost_guard",
        "label": "Prevent Sales Below Cost Floor",
        "fieldtype": "Check",
        "default": "1",
        "description": "Validate the final item rate against the authoritative buying floor.",
        "insert_after": "posa_max_discount_allowed",
    },
    {
        "fieldname": "posa_below_cost_action",
        "label": "Below Cost Action",
        "fieldtype": "Select",
        "options": "Block\nPOS Supervisor Override\nWarning Only",
        "default": "Block",
        "depends_on": "eval:doc.posa_enable_below_cost_guard==1",
        "insert_after": "posa_enable_below_cost_guard",
    },
    {
        "fieldname": "posa_minimum_margin_percentage",
        "label": "Minimum Margin Percentage",
        "fieldtype": "Percent",
        "default": "0",
        "non_negative": 1,
        "depends_on": "eval:doc.posa_enable_below_cost_guard==1",
        "insert_after": "posa_below_cost_action",
    },
    {
        "fieldname": "posa_missing_cost_action",
        "label": "Missing Cost Action",
        "fieldtype": "Select",
        "options": "Allow\nBlock",
        "default": "Allow",
        "depends_on": "eval:doc.posa_enable_below_cost_guard==1",
        "insert_after": "posa_minimum_margin_percentage",
    },
]


def _invoice_fields():
    return [
        {
            "fieldname": "posa_below_cost_override",
            "label": "Below Cost Override",
            "fieldtype": "Check",
            "default": "0",
            "hidden": 1,
            "no_copy": 1,
            "read_only": 1,
            "print_hide": 1,
            "insert_after": "posa_cashier",
        },
        {
            "fieldname": "posa_below_cost_override_by",
            "label": "Below Cost Override By",
            "fieldtype": "Link",
            "options": "User",
            "hidden": 1,
            "no_copy": 1,
            "read_only": 1,
            "print_hide": 1,
            "insert_after": "posa_below_cost_override",
        },
        {
            "fieldname": "posa_below_cost_override_reason",
            "label": "Below Cost Override Reason",
            "fieldtype": "Small Text",
            "hidden": 1,
            "no_copy": 1,
            "print_hide": 1,
            "insert_after": "posa_below_cost_override_by",
        },
        {
            "fieldname": "posa_below_cost_override_details",
            "label": "Below Cost Override Details",
            "fieldtype": "Long Text",
            "hidden": 1,
            "no_copy": 1,
            "read_only": 1,
            "print_hide": 1,
            "insert_after": "posa_below_cost_override_reason",
        },
    ]


def _upsert_custom_field(doctype, field):
    name = f"{doctype}-{field['fieldname']}"
    if not frappe.db.exists("Custom Field", name):
        create_custom_field(doctype, field)
        return
    frappe.db.set_value(
        "Custom Field",
        name,
        field,
        update_modified=False,
    )


def execute():
    for field in PROFILE_FIELDS:
        _upsert_custom_field("POS Profile", field)
    for doctype in ("Sales Invoice", "POS Invoice"):
        for field in _invoice_fields():
            _upsert_custom_field(doctype, field)
    for doctype in ("POS Profile", "Sales Invoice", "POS Invoice"):
        frappe.clear_cache(doctype=doctype)
