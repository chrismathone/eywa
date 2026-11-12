export const MODULE_BASELINE_V1: readonly [
  "ecs", "mcs", "makeups", "seat_attendance", "textbooks", "shuttle", "inventory", "kiosk", "newcomers", "retention",
  "approvals", "class_review", "calendar", "classnote", "makeedu", "sheet_sync", "eie", "session_billing", "payroll", "staff_leaves",
];
export const MODULE_IDS: typeof MODULE_BASELINE_V1;
export function normalizeModuleIds(raw: unknown, moduleIds?: readonly string[]): string[];
export function normalizeKnownModuleIds(raw: unknown, moduleIds?: readonly string[]): string[];
export function effectiveDisabledModulesFromStored(stored: unknown, moduleIds?: readonly string[]): string[];
export function knownModulesFromStored(stored: unknown, moduleIds?: readonly string[]): string[];
