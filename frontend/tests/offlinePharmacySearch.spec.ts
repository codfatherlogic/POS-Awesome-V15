import { describe, expect, it } from "vitest";

import { deriveItemSearchFields } from "../src/offline/cache";

describe("offline pharmacy search indexing", () => {
	it("indexes generic, company, pack, rack, group, and short-name metadata", () => {
		const item = deriveItemSearchFields({
			item_code: "AI167",
			item_name: "PANADOL TAB 500MG",
			retailmind_short_name: "Panadol 500",
			brand: "GSK",
			item_group: "Medicines",
			retailmind_old_pos_pack: "200'S",
			retailmind_old_pos_generic_name: "PARACETAMOL",
			retailmind_old_pos_rack: "R-12",
		});

		expect(item.search_text).toContain("paracetamol");
		expect(item.search_text).toContain("gsk");
		expect(item.search_text).toContain("r-12");
		expect(item.name_keywords_lc).toContain("medicines");
	});
});
