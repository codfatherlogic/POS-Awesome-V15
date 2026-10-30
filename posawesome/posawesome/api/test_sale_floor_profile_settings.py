import json
import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES_PATH = REPO_ROOT / "posawesome" / "fixtures" / "custom_field.json"
PATCH_PATH = REPO_ROOT / "posawesome" / "patches" / "add_below_cost_sale_policy.py"


def _load_custom_field(name):
    fields = json.loads(FIXTURES_PATH.read_text())
    for field in fields:
        if field.get("name") == name:
            return field
    raise AssertionError(f"Missing fixture field {name}")


class TestSaleFloorProfileSettings(unittest.TestCase):
    def test_default_policy_preserves_existing_hard_block(self):
        enabled = _load_custom_field("POS Profile-posa_enable_below_cost_guard")
        action = _load_custom_field("POS Profile-posa_below_cost_action")
        missing = _load_custom_field("POS Profile-posa_missing_cost_action")

        self.assertEqual(enabled.get("default"), "1")
        self.assertEqual(action.get("default"), "Block")
        self.assertIn("POS Supervisor Override", action.get("options"))
        self.assertEqual(missing.get("default"), "Allow")

    def test_override_audit_fields_exist_on_both_invoice_types(self):
        for doctype in ("Sales Invoice", "POS Invoice"):
            for fieldname in (
                "posa_below_cost_override",
                "posa_below_cost_override_by",
                "posa_below_cost_override_reason",
                "posa_below_cost_override_details",
            ):
                self.assertEqual(
                    _load_custom_field(f"{doctype}-{fieldname}").get("print_hide"),
                    1,
                )

    def test_migration_patch_uses_pos_supervisor_policy(self):
        source = PATCH_PATH.read_text()

        self.assertIn("POS Supervisor Override", source)
        self.assertIn('"default": "1"', source)


if __name__ == "__main__":
    unittest.main()
