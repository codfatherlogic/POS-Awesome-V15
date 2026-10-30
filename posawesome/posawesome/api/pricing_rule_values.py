"""Normalize ERPNext pricing-rule values for POS line updates."""

from __future__ import annotations

import math
from collections.abc import Mapping


def _number(value) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric if math.isfinite(numeric) else 0.0


def _has_number(values: Mapping, key: str) -> bool:
    return key in values and values.get(key) not in (None, "")


def resolve_line_pricing_values(details: Mapping, fallback_price_list_rate=0) -> dict:
    """Return a consistent rate, discount amount, and discount percentage.

    ERPNext returns only the field selected by ``rate_or_discount`` for many
    pricing rules. In particular, a percentage rule commonly has no ``rate``
    or ``discount_amount`` key. The POS reconciliation response must derive
    those missing values instead of treating the absent rate as full price.
    """

    values = details or {}
    price_list_rate = _number(
        values.get("price_list_rate")
        if _has_number(values, "price_list_rate")
        else fallback_price_list_rate
    )

    has_rate = _has_number(values, "rate")
    rate = _number(values.get("rate")) if has_rate else price_list_rate
    discount_amount = _number(values.get("discount_amount"))
    discount_percentage = _number(values.get("discount_percentage"))

    if has_rate:
        # An explicit ERPNext rate is authoritative, including a zero rate.
        discount_amount = price_list_rate - rate
        discount_percentage = (
            (discount_amount / price_list_rate) * 100 if price_list_rate else 0.0
        )
    elif discount_percentage:
        discount_amount = price_list_rate * discount_percentage / 100
        rate = price_list_rate - discount_amount
    elif discount_amount:
        rate = price_list_rate - discount_amount
        discount_percentage = (
            (discount_amount / price_list_rate) * 100 if price_list_rate else 0.0
        )

    return {
        "price_list_rate": price_list_rate,
        "rate": rate,
        "discount_amount": discount_amount,
        "discount_percentage": discount_percentage,
    }
