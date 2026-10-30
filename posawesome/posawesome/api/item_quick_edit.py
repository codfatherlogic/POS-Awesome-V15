import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from posawesome.posawesome.api.employees import _get_user_doc, _is_pos_supervisor
from posawesome.posawesome.api.item_sale_controls import (
    CONTROLLED_FIELD,
    LOCKED_FIELD,
    NON_DISCOUNTABLE_FIELD,
    SHORT_NAME_FIELD,
    installed_item_control_fields,
    item_has_field,
)
from posawesome.posawesome.api.pos_access import get_authorized_pos_item, get_authorized_pos_profile


QUICK_EDIT_FLAG = "posa_allow_item_quick_edit"
PRIVILEGED_ROLES = {"System Manager", "Stock Manager", "Item Manager"}
SUPPLIER_BRAND_MAPPING_DOCTYPE = "RetailMind Supplier Brand Mapping"
STANDARD_QUICK_EDIT_FIELDS = frozenset(
    {
        "item_name",
        "description",
        "item_group",
        "brand",
        "max_discount",
        "standard_rate",
    }
)
OPTIONAL_QUICK_EDIT_FIELDS = (
    SHORT_NAME_FIELD,
    CONTROLLED_FIELD,
    NON_DISCOUNTABLE_FIELD,
    LOCKED_FIELD,
    "retailmind_units_per_pack",
    "retailmind_old_pos_company_code",
    "retailmind_old_pos_generic_code",
    "retailmind_old_pos_generic_name",
    "retailmind_old_pos_pack",
    "retailmind_old_pos_rack",
)


def _as_dict(data):
    if isinstance(data, str):
        return json.loads(data)
    return data or {}


def _meta_has(doctype, fieldname):
    try:
        return bool(frappe.get_meta(doctype).has_field(fieldname))
    except Exception:
        return False


def _item_fields():
    fields = [
        "name",
        "item_code",
        "item_name",
        "description",
        "item_group",
        "stock_uom",
        "brand",
        "max_discount",
        "standard_rate",
    ]
    for field in OPTIONAL_QUICK_EDIT_FIELDS:
        if item_has_field(field):
            fields.append(field)
    return fields


def _resolve_item_code(item_code=None, barcode=None):
    code = str(item_code or "").strip()
    if code and frappe.db.exists("Item", code):
        return code

    barcode = str(barcode or "").strip()
    if barcode:
        barcode_item = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
        if barcode_item:
            return barcode_item

    if code:
        barcode_item = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
        if barcode_item:
            return barcode_item

    frappe.throw(_("Item was not found."))


def _get_first_barcode(item_code):
    return frappe.db.get_value(
        "Item Barcode",
        {"parent": item_code, "parenttype": "Item", "parentfield": "barcodes"},
        "barcode",
        order_by="idx asc",
    )


def _doctype_exists(doctype):
    return bool(frappe.db.exists("DocType", doctype))


def _get_brand_mapped_supplier(brand):
    brand = str(brand or "").strip()
    if not brand or not _doctype_exists(SUPPLIER_BRAND_MAPPING_DOCTYPE):
        return None

    rows = frappe.get_all(
        SUPPLIER_BRAND_MAPPING_DOCTYPE,
        filters={"brand": brand},
        fields=["supplier", "mapping_type", "confidence"],
        order_by="mapping_type asc, confidence desc, modified desc",
        limit_page_length=1,
    )
    return rows[0].get("supplier") if rows else None


def _get_primary_supplier(item_code, brand=None):
    item_supplier = frappe.db.get_value(
        "Item Supplier",
        {"parent": item_code, "parenttype": "Item", "parentfield": "supplier_items"},
        "supplier",
        order_by="idx asc",
    )
    return item_supplier or _get_brand_mapped_supplier(brand)


def _resolve_price_list(profile, price_list=None, buying=False):
    if price_list:
        return price_list
    if not buying:
        return profile.get("selling_price_list")
    profile_buying = profile.get("buying_price_list")
    if profile_buying:
        return profile_buying
    return (
        frappe.db.get_single_value("Buying Settings", "buying_price_list")
        or frappe.db.get_value("Price List", {"buying": 1}, "name")
        or ("Standard Buying" if frappe.db.exists("Price List", "Standard Buying") else None)
    )


def _get_item_price(item_code, price_list, uom=None, buying=False, selling=False):
    if not price_list:
        return None
    filters = {"item_code": item_code, "price_list": price_list}
    if uom:
        filters["uom"] = uom
    price = frappe.db.get_value("Item Price", filters, "price_list_rate")
    if price is not None:
        return price

    filters.pop("uom", None)
    filters["uom"] = ["in", ["", None]]
    if buying:
        filters["buying"] = 1
    if selling:
        filters["selling"] = 1
    return frappe.db.get_value("Item Price", filters, "price_list_rate")


def _upsert_item_price(item_code, price_list, rate, uom=None, buying=False, selling=False):
    if not price_list or rate is None:
        return None

    filters = {"item_code": item_code, "price_list": price_list}
    if uom:
        filters["uom"] = uom
    else:
        filters["uom"] = ["in", ["", None]]

    existing = frappe.db.exists("Item Price", filters)
    if existing:
        doc = frappe.get_doc("Item Price", existing)
        doc.check_permission("write")
        doc.price_list_rate = flt(rate)
        doc.buying = 1 if buying else cint(doc.buying)
        doc.selling = 1 if selling else cint(doc.selling)
        doc.flags.ignore_permissions = True
        doc.save()
        return doc.name

    doc = frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": price_list,
            "uom": uom,
            "price_list_rate": flt(rate),
            "buying": 1 if buying else 0,
            "selling": 1 if selling else 0,
        }
    )
    doc.check_permission("create")
    doc.flags.ignore_permissions = True
    doc.insert()
    return doc.name


def _is_user_privileged(user):
    roles = set(frappe.get_roles(user) or [])
    return bool(roles.intersection(PRIVILEGED_ROLES))


def _can_save(profile):
    user = str(frappe.session.user or "").strip()
    if not user or user == "Guest":
        return False
    if _is_user_privileged(user):
        return True
    if not cint(profile.get(QUICK_EDIT_FLAG)):
        return False
    try:
        return bool(_is_pos_supervisor(_get_user_doc(user)))
    except Exception:
        return False


def _assert_can_save(profile):
    if not _can_save(profile):
        frappe.throw(_("A POS supervisor with Item Quick Edit enabled is required."))


def _get_options():
    return {
        "item_groups": frappe.get_all(
            "Item Group",
            filters={"is_group": 0},
            pluck="name",
            order_by="name asc",
            limit_page_length=500,
        ),
        "brands": frappe.get_all(
            "Brand",
            pluck="name",
            order_by="name asc",
            limit_page_length=500,
        ),
        "suppliers": frappe.get_all(
            "Supplier",
            filters={"disabled": 0},
            pluck="name",
            order_by="name asc",
            limit_page_length=500,
        ),
    }


def _get_item_quick_edit_item(resolved_item_code, profile):
    item = frappe.db.get_value("Item", resolved_item_code, _item_fields(), as_dict=True)
    if not item:
        frappe.throw(_("Item was not found."))

    selling_price_list = _resolve_price_list(profile, buying=False)
    buying_price_list = _resolve_price_list(profile, buying=True)
    stock_uom = item.get("stock_uom")

    item.update(
        {
            "barcode": _get_first_barcode(resolved_item_code) or "",
            "primary_supplier": _get_primary_supplier(resolved_item_code, item.get("brand")) or "",
            "selling_price_list": selling_price_list,
            "buying_price_list": buying_price_list,
            "retail_price": _get_item_price(
                resolved_item_code,
                selling_price_list,
                uom=stock_uom,
                selling=True,
            ),
            "trade_price": _get_item_price(
                resolved_item_code,
                buying_price_list,
                uom=stock_uom,
                buying=True,
            ),
        }
    )
    return item


def _build_pos_item_row(item):
    if not item:
        return None

    row = dict(item)
    item_code = row.get("item_code") or row.get("name")
    if item_code:
        row["item_code"] = item_code

    retail_price = row.get("retail_price")
    if retail_price in (None, ""):
        retail_price = row.get("standard_rate")
    if retail_price not in (None, ""):
        row["price_list_rate"] = flt(retail_price)
        row["rate"] = flt(retail_price)

    stock_uom = row.get("stock_uom")
    if stock_uom and not row.get("uom"):
        row["uom"] = stock_uom
    return row


@frappe.whitelist()
def get_item_quick_edit(item_code=None, barcode=None, pos_profile=None):
    profile = get_authorized_pos_profile(pos_profile)
    resolved_item_code = _resolve_item_code(item_code=item_code, barcode=barcode)
    get_authorized_pos_item(resolved_item_code, profile)
    item = _get_item_quick_edit_item(resolved_item_code, profile)

    return {
        "item": item,
        "options": _get_options(),
        "can_save": _can_save(profile),
        "missing_fields": [
            field for field in (SHORT_NAME_FIELD, CONTROLLED_FIELD, NON_DISCOUNTABLE_FIELD, LOCKED_FIELD)
            if field not in installed_item_control_fields()
        ],
    }


def _sync_barcode(item_doc, barcode):
    barcode = str(barcode or "").strip()
    existing_row_name = None
    if item_doc.get("barcodes"):
        existing_row_name = item_doc.barcodes[0].name

    if barcode:
        existing_parent = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
        if existing_parent and existing_parent != item_doc.name:
            frappe.throw(_("Barcode {0} already belongs to item {1}.").format(barcode, existing_parent))
        if existing_row_name:
            item_doc.barcodes[0].barcode = barcode
        else:
            item_doc.append("barcodes", {"barcode": barcode})
        return

    if existing_row_name:
        item_doc.remove(item_doc.barcodes[0])


def _sync_primary_supplier(item_doc, supplier):
    supplier = str(supplier or "").strip()
    if supplier and not frappe.db.exists("Supplier", supplier):
        resolved = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
        if not resolved:
            frappe.throw(_("Supplier {0} was not found.").format(supplier))
        supplier = resolved

    existing = list(item_doc.get("supplier_items") or [])
    if supplier:
        if existing:
            existing[0].supplier = supplier
        else:
            item_doc.append("supplier_items", {"supplier": supplier})
    elif existing:
        item_doc.remove(existing[0])


@frappe.whitelist()
def save_item_quick_edit(data):
    payload = _as_dict(data)
    profile = get_authorized_pos_profile(payload.get("pos_profile"))
    _assert_can_save(profile)

    item_code = _resolve_item_code(payload.get("item_code"), payload.get("barcode"))
    item_doc = get_authorized_pos_item(item_code, profile)
    item_doc.check_permission("write")
    item_doc.flags.ignore_permissions = True

    allowed_fields = STANDARD_QUICK_EDIT_FIELDS.union(OPTIONAL_QUICK_EDIT_FIELDS)
    for field in allowed_fields:
        if field not in payload or (
            field not in STANDARD_QUICK_EDIT_FIELDS and not item_has_field(field)
        ):
            continue
        setattr(item_doc, field, payload.get(field))

    _sync_barcode(item_doc, payload.get("barcode"))
    _sync_primary_supplier(item_doc, payload.get("primary_supplier"))
    item_doc.save()

    selling_price_list = _resolve_price_list(profile, buying=False)
    buying_price_list = _resolve_price_list(profile, buying=True)
    uom = item_doc.stock_uom

    if payload.get("retail_price") not in (None, ""):
        _upsert_item_price(item_doc.name, selling_price_list, payload.get("retail_price"), uom=uom, selling=True)
        for fallback_price_list in ("Retail Selling", "Standard Selling"):
            if fallback_price_list != selling_price_list and frappe.db.exists("Price List", fallback_price_list):
                _upsert_item_price(item_doc.name, fallback_price_list, payload.get("retail_price"), uom=uom, selling=True)
        item_doc.db_set("standard_rate", flt(payload.get("retail_price")), update_modified=False)

    if payload.get("trade_price") not in (None, ""):
        _upsert_item_price(item_doc.name, buying_price_list, payload.get("trade_price"), uom=uom, buying=True)

    frappe.clear_cache(doctype="Item")

    item = _get_item_quick_edit_item(item_doc.name, profile)
    return {"item": item, "pos_item": _build_pos_item_row(item)}
