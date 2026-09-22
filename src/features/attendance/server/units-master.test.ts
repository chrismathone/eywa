import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ access: vi.fn(), scope: vi.fn(), from: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]>, reads: [] as { table: string; filters: [string, unknown][] }[], fail: "" }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: h.access }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: h.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { holidays: [] } }) }));
vi.mock("@/features/periods/server/queries", () => ({ getPeriodDefs: async () => [] }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { canViewUnitsMaster, loadUnitsMaster } from "./units-master";

beforeEach(() => {
  vi.clearAllMocks(); h.reads = []; h.fail = "";
  h.access.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" }); h.scope.mockResolvedValue(null);
  h.tables = {
    classes: [{ id: "c", class_name: "영어반", subject: "english", teacher_id: "t", english_track: "injaewon" }],
    invoices: [{ id: "i", student_id: "s", period: "2026-09", status: "paid" }],
    invoice_session_terms: [{ id: "term", invoice_id: "i", class_id: "c", confirmed_sessions: 1, quantity_basis: "attendance_units", pricing_mode: "unit" }],
    enrollments: [{ id: "e", class_id: "c", student_id: "s", start_date: "2026-09-01", end_date: null, attendance_days: null, is_transferred: false, on_hold: false }],
    class_schedules: [], makeup_reservations: [],
    students: [{ id: "s", name: "학생", school: "학교", grade: "중2" }], users: [{ id: "t", display_name: "선생님" }],
    attendance_records: [{ id: "r", class_id: "c", student_id: "s", session_date: "2026-09-01", slot_start: "09:00", status: "present", session_units: null, recorded_at: "2026-09-01T12:00:00Z", seat_label: null, recorded_via: null }],
  };
  for (const rows of Object.values(h.tables)) for (const row of rows) row.tenant_id = "tenant";
  h.from.mockImplementation((table: string) => {
    let rows = [...(h.tables[table] ?? [])];
    const entry = { table, filters: [] as [string, unknown][] }; h.reads.push(entry);
    const q = {
      select: () => q, order: () => q, or: () => q,
      eq: (key: string, value: unknown) => { entry.filters.push([key, value]); rows = rows.filter((r) => r[key] === value); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return q; },
      gte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) >= value); return q; },
      lte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) <= value); return q; },
      range: (f: number, t: number) => Promise.resolve({ data: rows.slice(f, t + 1), error: h.fail === table ? { message: "read failed" } : null }),
    };
    return q;
  });
});

it("rejects teachers and teacher-view sessions before any admin read", async () => {
  expect(canViewUnitsMaster("teacher", null)).toBe(false);
  h.access.mockResolvedValue({ systemRole: "teacher", tenantId: "tenant" });
  await expect(loadUnitsMaster("2026-09")).rejects.toThrow("redirect:/attendance"); expect(h.from).not.toHaveBeenCalled();
  h.access.mockResolvedValue({ systemRole: "admin", tenantId: "tenant" }); h.scope.mockResolvedValue("t");
  await expect(loadUnitsMaster("2026-09")).rejects.toThrow("redirect:/attendance"); expect(h.from).not.toHaveBeenCalled();
});
it("uses actual data, tenant scope on every query, and returns no financial fields", async () => {
  const data = await loadUnitsMaster("2026-09");
  expect(data.classes[0].students[0]).toMatchObject({ target: 1, actual: 1, remaining: 0, status: "complete" });
  expect(h.reads.length).toBeGreaterThan(8);
  for (const read of h.reads) expect(read.filters).toContainEqual(["tenant_id", "tenant"]);
  expect(JSON.stringify(data)).not.toMatch(/unit_price|line_items|commission_rate/);
});
it("does not count void invoices or partial confirmations as a complete target", async () => {
  h.tables.invoice_session_terms.push({ ...h.tables.invoice_session_terms[0], id: "pending", confirmed_sessions: null });
  expect((await loadUnitsMaster("2026-09")).classes[0].students[0].target).toBeNull();
  h.tables.invoices[0].status = "void";
  const row = (await loadUnitsMaster("2026-09")).classes[0].students[0];
  expect(row.target).toBeNull(); expect(row.invoice).toBe("void"); expect(row.actual).toBe(1);
});
it("fails instead of displaying partial attendance or missing *LAB data", async () => {
  h.fail = "attendance_records";
  await expect(loadUnitsMaster("2026-09")).rejects.toThrow();
  h.fail = "class_schedules";
  await expect(loadUnitsMaster("2026-09")).rejects.toThrow();
});
