"""Accounting hooks for POS invoice rows carrying an original tender currency."""

class MultiCurrencyPOSPaymentsMixin:
    def before_save(self):
        """Reapply authoritative tender values after ERPNext's POS service.

        ERPNext v16 calculates payment ``base_amount`` in ``before_save`` from
        the rounded invoice-currency amount.  That loses value for tenders whose
        own currency has a different precision or rate (for example PKR 30 ->
        USD 0.11 -> PKR 31.35).  Run the standard hook first, then restore the
        original-tender-derived company values.
        """

        parent_before_save = getattr(super(), "before_save", None)
        if callable(parent_before_save):
            parent_before_save()
        self.set_paid_amount()
        self.set_multi_currency_change_amounts()

    def set_paid_amount(self):
        from frappe.utils import flt

        paid_amount = 0.0
        base_paid_amount = 0.0
        for payment in self.payments:
            if (
                payment.get("posa_payment_currency")
                and payment.get("posa_original_amount") not in (None, "")
                and flt(payment.get("posa_company_exchange_rate")) > 0
            ):
                payment.base_amount = flt(
                    payment.get("posa_original_amount")
                    * payment.get("posa_company_exchange_rate"),
                    self.precision("base_paid_amount"),
                )
            else:
                payment.base_amount = flt(
                    payment.amount * self.conversion_rate,
                    self.precision("base_paid_amount"),
                )
            paid_amount += payment.amount
            base_paid_amount += payment.base_amount

        self.paid_amount = paid_amount
        self.base_paid_amount = base_paid_amount

    def set_multi_currency_change_amounts(self):
        from posawesome.posawesome.api.payment_currency import (
            set_multi_currency_change_amounts,
        )

        return set_multi_currency_change_amounts(self)

    def make_pos_gl_entries(self, gl_entries):
        import frappe
        from frappe.utils import cint, flt
        from erpnext.accounts.utils import get_account_currency

        if not cint(self.is_pos):
            return

        # ``post_change_gl_entries`` is not available in every supported
        # ERPNext schema.  A direct read makes invoice submission fail on those
        # versions before any GL entry can be posted.  Absence of the opt-in
        # field is equivalent to its legacy/default disabled state.
        accounts_settings_meta = frappe.get_meta("Accounts Settings")
        post_change_field = accounts_settings_meta.has_field(
            "post_change_gl_entries"
        )
        skip_change_gl_entries = not (
            post_change_field
            and cint(
                frappe.db.get_single_value(
                    "Accounts Settings", "post_change_gl_entries"
                )
            )
        )
        remaining_base_change = flt(self.base_change_amount) if skip_change_gl_entries else 0
        remaining_invoice_change = flt(self.change_amount) if skip_change_gl_entries else 0
        for payment_mode in self.payments:
            payment_base_amount = flt(payment_mode.base_amount)
            payment_invoice_amount = flt(payment_mode.amount)
            original_base_amount = payment_base_amount
            deduct_change = bool(
                skip_change_gl_entries
                and payment_mode.account == self.account_for_change_amount
                and (remaining_base_change > 0 or remaining_invoice_change > 0)
            )
            if deduct_change:
                base_deduction = min(
                    max(payment_base_amount, 0),
                    remaining_base_change,
                )
                invoice_deduction = min(
                    max(payment_invoice_amount, 0),
                    remaining_invoice_change,
                )
                payment_base_amount -= base_deduction
                payment_invoice_amount -= invoice_deduction
                remaining_base_change -= base_deduction
                remaining_invoice_change -= invoice_deduction

            against_voucher = self.name
            if self.is_return and self.return_against and not self.update_outstanding_for_self:
                against_voucher = self.return_against

            if not payment_base_amount:
                continue

            gl_entries.append(
                self.get_gl_dict(
                    {
                        "account": self.debit_to,
                        "party_type": "Customer",
                        "party": self.customer,
                        "against": payment_mode.account,
                        "credit": payment_base_amount,
                        "credit_in_account_currency": payment_base_amount
                        if self.party_account_currency == self.company_currency
                        else payment_invoice_amount,
                        "credit_in_transaction_currency": payment_invoice_amount,
                        "against_voucher": against_voucher,
                        "against_voucher_type": self.doctype,
                        "cost_center": self.cost_center,
                    },
                    self.party_account_currency,
                    item=self,
                )
            )

            account_currency = get_account_currency(payment_mode.account)
            account_amount = payment_mode.get("posa_account_amount")
            if not account_amount:
                account_amount = (
                    original_base_amount
                    if account_currency == self.company_currency
                    else payment_mode.amount
                )
            if deduct_change and original_base_amount:
                account_amount = flt(
                    flt(account_amount)
                    * payment_base_amount
                    / original_base_amount
                )
            gl_entries.append(
                self.get_gl_dict(
                    {
                        "account": payment_mode.account,
                        "against": self.customer,
                        "debit": payment_base_amount,
                        "debit_in_account_currency": account_amount,
                        "debit_in_transaction_currency": payment_invoice_amount,
                        "cost_center": self.cost_center,
                    },
                    account_currency,
                    item=self,
                )
            )

        if not skip_change_gl_entries:
            self.make_gle_for_change_amount(gl_entries)
