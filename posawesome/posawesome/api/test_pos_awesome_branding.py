import ast
import json
import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
PACKAGE_PATH = REPO_ROOT / "package.json"
MANIFEST_PATH = REPO_ROOT / "posawesome" / "www" / "manifest.json"
WORKSPACE_PATH = (
    REPO_ROOT
    / "posawesome"
    / "posawesome"
    / "workspace"
    / "pos_awesome"
    / "pos_awesome.json"
)
HOOKS_PATH = REPO_ROOT / "posawesome" / "hooks.py"
PATCHES_PATH = REPO_ROOT / "posawesome" / "patches.txt"
RESTORE_PATCH_PATH = (
    REPO_ROOT / "posawesome" / "patches" / "restore_pos_awesome_branding.py"
)
RESTORE_PATCH_MODULE = "posawesome.patches.restore_pos_awesome_branding"


class TestPosAwesomeBrandingContract(unittest.TestCase):
    def test_desktop_brand_preserves_installed_identity_and_protocol(self):
        package = json.loads(PACKAGE_PATH.read_text())
        build = package["build"]
        protocol = next(
            entry for entry in build["protocols"] if "posawesome" in entry["schemes"]
        )

        self.assertEqual(package["name"], "posawesome")
        self.assertEqual(build["appId"], "com.posawesome.desktop")
        self.assertEqual(build["productName"], "POS Awesome Desktop")
        self.assertEqual(protocol["name"], "POS Awesome Links")

    def test_pwa_and_workspace_keep_pos_awesome_as_the_canonical_brand(self):
        manifest = json.loads(MANIFEST_PATH.read_text())
        workspace = json.loads(WORKSPACE_PATH.read_text())

        self.assertEqual(manifest["name"], "POS Awesome")
        self.assertEqual(manifest["short_name"], "POS Awesome")
        self.assertEqual(workspace["name"], "POS Awesome")
        self.assertEqual(workspace["module"], "POSAwesome")
        self.assertEqual(workspace["label"], "POS Awesome")
        self.assertEqual(workspace["title"], "POS Awesome")

    def test_restore_patch_and_profile_branding_options_are_registered(self):
        hooks = HOOKS_PATH.read_text()
        patches = PATCHES_PATH.read_text().splitlines()
        patch_tree = ast.parse(RESTORE_PATCH_PATH.read_text())
        assignments = {
            target.id: ast.literal_eval(node.value)
            for node in patch_tree.body
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
            and target.id in {"CANONICAL_FIELD_UPDATES", "BRANDING_FIELDS"}
        }

        self.assertIn('app_name = "posawesome"', hooks)
        self.assertIn('app_title = "POS Awesome"', hooks)
        self.assertIn(RESTORE_PATCH_MODULE, patches)
        self.assertNotIn("posawesome.patches.rebrand_retailmind_pos_labels", patches)
        self.assertEqual(
            assignments["CANONICAL_FIELD_UPDATES"][
                "POS Profile-posa_section_awesome_dashboard"
            ]["label"],
            "Awesome Dashboard",
        )
        self.assertEqual(
            [field["fieldname"] for field in assignments["BRANDING_FIELDS"]],
            [
                "posa_branding_section",
                "posa_enable_custom_branding",
                "posa_brand_name",
                "posa_brand_short_name",
                "posa_brand_logo",
            ],
        )


if __name__ == "__main__":
    unittest.main()
