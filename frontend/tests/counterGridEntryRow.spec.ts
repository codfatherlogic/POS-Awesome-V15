// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

describe("CounterGridEntryRow", () => {
	it("edits inline, submits the typed query, and supports reverse navigation", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const { default: CounterGridEntryRow } = await import(
			"../src/posapp/components/pos/invoice/CounterGridEntryRow.vue"
		);
		const wrapper = mount(
			{
				components: { CounterGridEntryRow },
				data: () => ({
					query: "",
					submitted: "",
					navigationMethod: "",
				}),
				template: `
				<table><tbody>
					<CounterGridEntryRow
						v-model="query"
						:columns="[{ key: 'data-table-expand' }, { key: 'item_name' }, { key: 'qty' }]"
						:row-number="3"
						@submit="submitted = $event"
						@navigate-back="navigationMethod = $event"
					/>
				</tbody></table>
			`,
			},
			{
				global: {
					stubs: {
						VIcon: { template: "<span />" },
					},
				},
			},
		);
		const input = wrapper.get<HTMLInputElement>(
			'[data-testid="counter-grid-item-entry"]',
		);
		await input.setValue("panadol");
		expect((wrapper.vm as any).query).toBe("panadol");

		await input.trigger("keydown", { key: "Enter" });
		expect((wrapper.vm as any).submitted).toBe("panadol");

		await input.trigger("keydown", { key: "Tab", shiftKey: true });
		expect((wrapper.vm as any).navigationMethod).toBe("shift-tab");

		await input.trigger("keydown", { key: "ArrowUp" });
		expect((wrapper.vm as any).navigationMethod).toBe("arrow-up");
	});

	it("does not open an unscoped search for an empty value", async () => {
		vi.stubGlobal("__", (value: string) => value);
		const { default: CounterGridEntryRow } = await import(
			"../src/posapp/components/pos/invoice/CounterGridEntryRow.vue"
		);
		const wrapper = mount(
			{
				components: { CounterGridEntryRow },
				data: () => ({ query: "", submitted: "" }),
				template: `
				<table><tbody>
					<CounterGridEntryRow
						v-model="query"
						:columns="[{ key: 'item_name' }]"
						:row-number="1"
						@submit="submitted = $event"
					/>
				</tbody></table>
			`,
			},
			{
				global: { stubs: { VIcon: { template: "<span />" } } },
			},
		);
		await wrapper
			.get('[data-testid="counter-grid-item-entry"]')
			.trigger("keydown", {
				key: "Enter",
			});
		expect((wrapper.vm as any).submitted).toBe("");
	});
});
