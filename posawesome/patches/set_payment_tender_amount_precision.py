import frappe


def execute():
    for doctype in ("Sales Invoice Payment", "Payment Entry"):
        name = f"{doctype}-posa_original_amount"
        if frappe.db.exists("Custom Field", name):
            frappe.db.set_value(
                "Custom Field",
                name,
                "precision",
                "9",
                update_modified=False,
            )
        frappe.clear_cache(doctype=doctype)
