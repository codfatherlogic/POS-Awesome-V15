import unittest

from posawesome.posawesome.api.pricing_rule_values import resolve_line_pricing_values


class TestPricingRuleValues(unittest.TestCase):
    def test_derives_rate_and_amount_from_percentage_only_response(self):
        values = resolve_line_pricing_values(
            {"price_list_rate": 100, "discount_percentage": 10},
            100,
        )

        self.assertEqual(values["rate"], 90)
        self.assertEqual(values["discount_amount"], 10)
        self.assertEqual(values["discount_percentage"], 10)

    def test_percentage_wins_over_zero_default_discount_amount(self):
        values = resolve_line_pricing_values(
            {
                "price_list_rate": 250,
                "discount_percentage": 20,
                "discount_amount": 0,
            },
            250,
        )

        self.assertEqual(values["rate"], 200)
        self.assertEqual(values["discount_amount"], 50)

    def test_derives_rate_and_percentage_from_amount_only_response(self):
        values = resolve_line_pricing_values(
            {"discount_amount": "15"},
            "100",
        )

        self.assertEqual(values["rate"], 85)
        self.assertEqual(values["discount_percentage"], 15)

    def test_explicit_rate_is_authoritative_and_zero_is_preserved(self):
        values = resolve_line_pricing_values(
            {"price_list_rate": 100, "rate": 0},
            100,
        )

        self.assertEqual(values["rate"], 0)
        self.assertEqual(values["discount_amount"], 100)
        self.assertEqual(values["discount_percentage"], 100)

    def test_no_discount_response_keeps_full_price(self):
        values = resolve_line_pricing_values({}, "75")

        self.assertEqual(values["price_list_rate"], 75)
        self.assertEqual(values["rate"], 75)
        self.assertEqual(values["discount_amount"], 0)
        self.assertEqual(values["discount_percentage"], 0)


if __name__ == "__main__":
    unittest.main()
