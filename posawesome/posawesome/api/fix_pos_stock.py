"""One-off fix: create Delivery Notes for POS Sales Invoices that were
submitted with update_stock = 0 (so stock was never reduced).

Run dry-run first:
    bench --site erp.designationqatar.com execute \
        posawesome.posawesome.api.fix_pos_stock.create_missing_delivery_notes \
        --kwargs "{'dry_run': True}"

Then live:
    bench --site erp.designationqatar.com execute \
        posawesome.posawesome.api.fix_pos_stock.create_missing_delivery_notes \
        --kwargs "{'dry_run': False}"

Optional kwargs:
    from_date: 'YYYY-MM-DD'  - only invoices on/after this posting_date
    to_date:   'YYYY-MM-DD'  - only invoices on/before this posting_date
    invoice:   'SI-NAME'     - process a single invoice
    allow_negative_stock: True/False (default False)
"""

import frappe
from frappe.utils import getdate
from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_delivery_note


def _get_candidate_invoices(from_date=None, to_date=None, invoice=None):
    filters = {
        "docstatus": 1,
        "update_stock": 0,
        "is_return": 0,
        "posa_pos_opening_shift": ["is", "set"],
    }
    if invoice:
        if isinstance(invoice, (list, tuple, set)):
            filters["name"] = ["in", list(invoice)]
        else:
            filters["name"] = invoice
    if from_date:
        filters["posting_date"] = [">=", getdate(from_date)]
    if to_date:
        existing = filters.get("posting_date")
        if existing:
            filters["posting_date"] = ["between", [existing[1], getdate(to_date)]]
        else:
            filters["posting_date"] = ["<=", getdate(to_date)]

    return frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=["name", "posting_date", "posting_time", "customer", "grand_total"],
        order_by="posting_date asc, name asc",
    )


def _has_existing_delivery_note(invoice_name):
    return frappe.db.exists(
        "Delivery Note Item",
        {"against_sales_invoice": invoice_name, "docstatus": ["<", 2]},
    )


def create_missing_delivery_notes(
    dry_run=True,
    from_date=None,
    to_date=None,
    invoice=None,
    allow_negative_stock=False,
    submit_dn=True,
):
    """Create a Delivery Note (same posting_date as the invoice) for every
    POS-created submitted Sales Invoice whose update_stock = 0 and which has
    no existing Delivery Note. Each invoice is processed in its own
    transaction; failures are logged and skipped.

    Set submit_dn=False to leave each Delivery Note as a Draft (docstatus=0)
    so it can be reviewed/edited and submitted manually. Drafts do not affect
    stock until submitted, so this also works for invoices whose current
    stock balance can't cover the historical sale.
    """
    dry_run = bool(dry_run)
    allow_negative_stock = bool(allow_negative_stock)
    submit_dn = bool(submit_dn)

    candidates = _get_candidate_invoices(from_date=from_date, to_date=to_date, invoice=invoice)

    summary = {
        "total_candidates": len(candidates),
        "skipped_already_delivered": 0,
        "would_create": 0,
        "created": [],
        "failed": [],
    }

    print(
        f"[fix_pos_stock] dry_run={dry_run} candidates={len(candidates)} "
        f"from_date={from_date} to_date={to_date} invoice={invoice} "
        f"allow_negative_stock={allow_negative_stock}"
    )

    for row in candidates:
        si_name = row["name"]
        try:
            if _has_existing_delivery_note(si_name):
                summary["skipped_already_delivered"] += 1
                continue

            if dry_run:
                summary["would_create"] += 1
                print(
                    f"[DRY-RUN] would create DN for {si_name} "
                    f"(posting_date={row['posting_date']}, customer={row['customer']}, "
                    f"grand_total={row['grand_total']})"
                )
                continue

            savepoint = f"sp_{si_name}".replace("-", "_")
            frappe.db.savepoint(savepoint)
            try:
                dn = make_delivery_note(si_name)
                dn.posting_date = row["posting_date"]
                dn.posting_time = row["posting_time"]
                dn.set_posting_time = 1
                dn.ignore_pricing_rule = 1
                if allow_negative_stock:
                    dn.flags.allow_negative_stock = True
                dn.flags.ignore_permissions = True
                dn.insert()
                if submit_dn:
                    dn.submit()
                frappe.db.commit()
                state = "submitted" if submit_dn else "draft"
                summary["created"].append(
                    {"sales_invoice": si_name, "delivery_note": dn.name, "state": state}
                )
                print(f"[OK] {si_name} -> {dn.name} ({state})")
            except Exception as exc:
                frappe.db.rollback(save_point=savepoint)
                summary["failed"].append({"sales_invoice": si_name, "error": str(exc)})
                frappe.log_error(
                    title=f"fix_pos_stock failed for {si_name}",
                    message=frappe.get_traceback(),
                )
                print(f"[FAIL] {si_name}: {exc}")
        except Exception as outer:
            summary["failed"].append({"sales_invoice": si_name, "error": str(outer)})
            print(f"[FAIL-OUTER] {si_name}: {outer}")

    print("\n[fix_pos_stock] summary:")
    print(f"  total_candidates           = {summary['total_candidates']}")
    print(f"  skipped_already_delivered  = {summary['skipped_already_delivered']}")
    if dry_run:
        print(f"  would_create               = {summary['would_create']}")
    else:
        print(f"  created                    = {len(summary['created'])}")
        print(f"  failed                     = {len(summary['failed'])}")
    return summary
