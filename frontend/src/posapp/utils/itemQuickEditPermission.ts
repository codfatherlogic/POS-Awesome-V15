const PRIVILEGED_ROLES = new Set([
	"System Manager",
	"Stock Manager",
	"Item Manager",
]);

const parseEnabled = (value: unknown) =>
	value === true || value === 1 || value === "1" || value === "true";

export function canShowItemQuickEdit(
	posProfile: Record<string, any> | null | undefined,
	frappeContext: any = typeof window !== "undefined"
		? (window as any).frappe
		: undefined,
) {
	const user = String(frappeContext?.session?.user || "").trim();
	if (!user || user === "Guest") return false;

	const roles = new Set<string>([
		...(Array.isArray(frappeContext?.boot?.user?.roles)
			? frappeContext.boot.user.roles
			: []),
		...(Array.isArray(frappeContext?.user_roles)
			? frappeContext.user_roles
			: []),
	]);
	if ([...PRIVILEGED_ROLES].some((role) => roles.has(role))) return true;

	return (
		parseEnabled(posProfile?.posa_allow_item_quick_edit) &&
		roles.has("POS Awesome Supervisor")
	);
}
