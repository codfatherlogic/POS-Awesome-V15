import frappe


def _available_legacy_id(candidate, row_name):
    candidate = str(candidate)[:140]
    counter = 1
    while frappe.db.exists(
        "Mpesa Payment Register",
        {"transid": candidate, "name": ["!=", row_name]},
    ):
        suffix = f"-{counter}"
        candidate = str(candidate)[: 140 - len(suffix)] + suffix
        counter += 1
    return candidate


def execute():
    if not frappe.db.table_exists("Mpesa Payment Register"):
        return

    missing_ids = frappe.db.sql(
        """
        select name
        from `tabMpesa Payment Register`
        where transid is null or transid = ''
        """,
        pluck=True,
    )
    for name in missing_ids:
        replacement = _available_legacy_id(f"legacy-missing-{name}", name)
        frappe.db.set_value(
            "Mpesa Payment Register",
            name,
            "transid",
            replacement,
            update_modified=False,
        )

    duplicates = frappe.db.sql(
        """
        select transid
        from `tabMpesa Payment Register`
        where coalesce(transid, '') != ''
        group by transid
        having count(*) > 1
        """,
        as_dict=True,
    )
    for duplicate in duplicates:
        rows = frappe.get_all(
            "Mpesa Payment Register",
            filters={"transid": duplicate.transid},
            fields=["name", "docstatus", "payment_entry", "creation"],
            order_by="docstatus desc, payment_entry desc, creation asc, name asc",
        )
        for row in rows[1:]:
            suffix = f"#duplicate-{row.name}"
            original = str(duplicate.transid)
            replacement = _available_legacy_id(
                original[: max(1, 140 - len(suffix))] + suffix,
                row.name,
            )
            frappe.db.set_value(
                "Mpesa Payment Register",
                row.name,
                "transid",
                replacement,
                update_modified=False,
            )
