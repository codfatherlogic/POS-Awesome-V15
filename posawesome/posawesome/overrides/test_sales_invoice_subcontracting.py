import importlib
import sys
import types
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from posawesome import hooks
from posawesome.posawesome.overrides.sales_invoice_subcontracting import (
    SalesInvoiceSubcontractingGuardMixin,
)


class _ERPNextInvoice:
    def is_subcontracted(self):
        self.erpnext_calls += 1
        if self.has_subcontracted:
            self.update_stock = 0
        return self.has_subcontracted


class _Invoice(SalesInvoiceSubcontractingGuardMixin, _ERPNextInvoice):
    def __init__(self, items=None, has_subcontracted=False):
        self.items = items or []
        self.has_subcontracted = has_subcontracted
        self.update_stock = 1
        self.erpnext_calls = 0


class TestSalesInvoiceSubcontractingGuard(TestCase):
    def test_sales_invoice_guard_is_registered_as_controller_extension(self):
        extension = (
            "posawesome.posawesome.overrides.sales_invoice_subcontracting."
            "SalesInvoiceSubcontractingGuardMixin"
        )
        payment_extension = (
            "posawesome.posawesome.overrides.multi_currency_payments."
            "MultiCurrencyPOSPaymentsMixin"
        )

        self.assertNotIn("Sales Invoice", hooks.override_doctype_class)
        self.assertEqual(
            hooks.extend_doctype_class["Sales Invoice"],
            [payment_extension, extension],
        )

    def test_pos_invoice_concrete_controller_is_registered(self):
        self.assertEqual(
            hooks.override_doctype_class["POS Invoice"],
            "posawesome.posawesome.overrides.pos_invoice.CustomPOSInvoice",
        )

    def test_sales_invoice_extension_composes_after_an_existing_override(self):
        class OtherAppSalesInvoice(_ERPNextInvoice):
            pass

        extended_controller = type(
            "ExtendedSalesInvoice",
            (SalesInvoiceSubcontractingGuardMixin, OtherAppSalesInvoice),
            {},
        )
        invoice = extended_controller()
        invoice.items = []
        invoice.has_subcontracted = False
        invoice.update_stock = 1
        invoice.erpnext_calls = 0

        self.assertFalse(invoice.is_subcontracted())
        self.assertEqual(invoice.erpnext_calls, 0)
        self.assertIn(OtherAppSalesInvoice, extended_controller.__mro__)

    def test_pos_invoice_controller_places_guard_before_erpnext(self):
        module_stubs = {}
        for name in (
            "erpnext",
            "erpnext.accounts",
            "erpnext.accounts.doctype",
            "erpnext.accounts.doctype.sales_invoice",
            "erpnext.accounts.doctype.pos_invoice",
        ):
            module = types.ModuleType(name)
            module.__path__ = []
            module_stubs[name] = module

        sales_invoice_module = types.ModuleType(
            "erpnext.accounts.doctype.sales_invoice.sales_invoice"
        )
        sales_invoice_module.SalesInvoice = _ERPNextInvoice
        module_stubs[sales_invoice_module.__name__] = sales_invoice_module

        class _ERPNextPOSInvoice(_ERPNextInvoice):
            def validate_pos_opening_entry(self):
                return None

        pos_invoice_module = types.ModuleType(
            "erpnext.accounts.doctype.pos_invoice.pos_invoice"
        )
        pos_invoice_module.POSInvoice = _ERPNextPOSInvoice
        module_stubs[pos_invoice_module.__name__] = pos_invoice_module

        invoice_api_module = types.ModuleType("posawesome.posawesome.api.invoice")
        invoice_api_module.validate_shift = lambda _doc: None
        module_stubs[invoice_api_module.__name__] = invoice_api_module

        controller_module = "posawesome.posawesome.overrides.pos_invoice"
        with patch.dict(sys.modules, module_stubs):
            sys.modules.pop(controller_module, None)
            pos_controller = importlib.import_module(controller_module)
            self.assertLess(
                pos_controller.CustomPOSInvoice.__mro__.index(
                    SalesInvoiceSubcontractingGuardMixin
                ),
                pos_controller.CustomPOSInvoice.__mro__.index(_ERPNextPOSInvoice),
            )

        sys.modules.pop(controller_module, None)

    def test_skips_erpnext_lookup_when_no_sales_order_is_linked(self):
        invoice = _Invoice(
            items=[
                SimpleNamespace(sales_order=None),
                SimpleNamespace(sales_order=""),
            ]
        )

        self.assertFalse(invoice.is_subcontracted())
        self.assertEqual(invoice.erpnext_calls, 0)
        self.assertEqual(invoice.update_stock, 1)

    def test_delegates_when_a_sales_order_is_linked(self):
        invoice = _Invoice(items=[SimpleNamespace(sales_order="SO-0001")])

        self.assertFalse(invoice.is_subcontracted())
        self.assertEqual(invoice.erpnext_calls, 1)

    def test_preserves_erpnext_handling_for_known_subcontracting(self):
        invoice = _Invoice(has_subcontracted=True)

        self.assertTrue(invoice.is_subcontracted())
        self.assertEqual(invoice.erpnext_calls, 1)
        self.assertEqual(invoice.update_stock, 0)
