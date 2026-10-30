"""ERPNext v16 Sales Invoice subcontracting compatibility guards."""


class SalesInvoiceSubcontractingGuardMixin:
    """Avoid ERPNext's invalid Sales Order lookup when no order is linked."""

    def is_subcontracted(self):
        if not getattr(self, "has_subcontracted", False):
            sales_orders = [
                getattr(item, "sales_order", None)
                for item in (getattr(self, "items", None) or [])
                if getattr(item, "sales_order", None)
            ]
            if not sales_orders:
                self.has_subcontracted = False
                return False

        return super().is_subcontracted()
