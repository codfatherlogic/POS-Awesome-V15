type Translate = (value: string) => string;

type ResourceState = {
	resourceId?: string;
	status?: string;
	lastSyncedAt?: string | null;
	lastError?: string | null;
};

type CapabilitySummary = {
	id?: string;
	status?: string;
	severity?: string;
	message?: string;
};

export type CounterGridHealthItem = {
	id: "connectivity" | "pending" | "pricing" | "stock" | "catalog";
	label: string;
	tone: "success" | "warning" | "error" | "info";
	icon: string;
	detail: string;
};

type CounterGridHealthInput = {
	connectivityLabel: string;
	connectivityTone: string;
	pendingInvoices: number;
	capabilitySummaries: CapabilitySummary[];
	resourceStates: ResourceState[];
	itemsLoaded: boolean;
	totalItemCount: number;
	translate?: Translate;
};

const toneFromStatus = (status: string) => {
	if (["error", "blocked", "unavailable"].includes(status))
		return "error" as const;
	if (
		[
			"stale",
			"limited",
			"degraded",
			"override_required",
			"syncing",
		].includes(status)
	) {
		return "warning" as const;
	}
	if (["fresh", "ready"].includes(status)) return "success" as const;
	return "info" as const;
};

const worstResourceState = (states: ResourceState[]) => {
	const rank: Record<string, number> = {
		error: 6,
		limited: 5,
		stale: 4,
		syncing: 3,
		idle: 2,
		fresh: 1,
	};
	return [...states].sort(
		(left, right) =>
			(rank[right.status || ""] || 0) - (rank[left.status || ""] || 0),
	)[0];
};

const capabilityHealth = (
	id: string,
	capabilities: CapabilitySummary[],
	readyLabel: string,
	reviewLabel: string,
	blockedLabel: string,
) => {
	const capability = capabilities.find((entry) => entry.id === id);
	if (!capability) return null;
	const status = String(capability.status || "");
	const tone = toneFromStatus(status);
	return {
		label:
			tone === "success"
				? readyLabel
				: tone === "error"
					? blockedLabel
					: reviewLabel,
		tone,
		detail: String(capability.message || ""),
	};
};

const resourceHealth = (
	resourceIds: string[],
	resources: ResourceState[],
	labels: Record<string, string>,
) => {
	const state = worstResourceState(
		resources.filter((resource) =>
			resourceIds.includes(String(resource.resourceId || "")),
		),
	);
	if (!state) return null;
	const status = String(state.status || "idle");
	return {
		label: labels[status] || labels.idle || status,
		tone: toneFromStatus(status),
		detail: String(state.lastError || state.lastSyncedAt || ""),
	};
};

export function buildCounterGridHealthItems({
	connectivityLabel,
	connectivityTone,
	pendingInvoices,
	capabilitySummaries,
	resourceStates,
	itemsLoaded,
	totalItemCount,
	translate = (value) => value,
}: CounterGridHealthInput): CounterGridHealthItem[] {
	const t = translate;
	const pending = Math.max(0, Number(pendingInvoices || 0));
	const pricing = capabilityHealth(
		"pricing_offline",
		capabilitySummaries,
		t("Pricing ready"),
		t("Pricing review"),
		t("Pricing blocked"),
	) ||
		resourceHealth(
			["price_list_meta", "item_prices", "pricing_rules"],
			resourceStates,
			{
				fresh: t("Pricing ready"),
				syncing: t("Pricing syncing"),
				stale: t("Pricing stale"),
				limited: t("Pricing limited"),
				error: t("Pricing error"),
				idle: t("Pricing pending"),
			},
		) || { label: t("Pricing pending"), tone: "info" as const, detail: "" };
	const stock = capabilityHealth(
		"stock_confidence_offline",
		capabilitySummaries,
		t("Stock ready"),
		t("Stock review"),
		t("Stock blocked"),
	) ||
		resourceHealth(["stock"], resourceStates, {
			fresh: t("Stock ready"),
			syncing: t("Stock syncing"),
			stale: t("Stock stale"),
			limited: t("Stock limited"),
			error: t("Stock error"),
			idle: t("Stock pending"),
		}) || { label: t("Stock pending"), tone: "info" as const, detail: "" };
	const catalog = resourceHealth(["items"], resourceStates, {
		fresh: `${Number(totalItemCount || 0).toLocaleString()} ${t("items")}`,
		syncing: t("Catalog syncing"),
		stale: t("Catalog stale"),
		limited: t("Catalog limited"),
		error: t("Catalog error"),
		idle: itemsLoaded
			? `${Number(totalItemCount || 0).toLocaleString()} ${t("items")}`
			: t("Catalog loading"),
	}) || {
		label: itemsLoaded
			? `${Number(totalItemCount || 0).toLocaleString()} ${t("items")}`
			: t("Catalog loading"),
		tone: itemsLoaded ? ("success" as const) : ("warning" as const),
		detail: "",
	};

	return [
		{
			id: "connectivity",
			label: t(connectivityLabel || "Checking"),
			tone:
				connectivityTone === "danger"
					? "error"
					: connectivityTone === "success"
						? "success"
						: "warning",
			icon:
				connectivityLabel === "Online"
					? "mdi-lan-connect"
					: "mdi-lan-disconnect",
			detail: t("Open offline and sync status"),
		},
		{
			id: "pending",
			label: pending ? `${pending} ${t("pending")}` : t("Sales synced"),
			tone: pending ? "warning" : "success",
			icon: pending
				? "mdi-cloud-upload-outline"
				: "mdi-cloud-check-outline",
			detail: pending
				? t("Invoices waiting to sync")
				: t("No invoices are waiting to sync"),
		},
		{ id: "pricing", icon: "mdi-tag-check-outline", ...pricing },
		{ id: "stock", icon: "mdi-warehouse", ...stock },
		{ id: "catalog", icon: "mdi-database-check-outline", ...catalog },
	];
}
