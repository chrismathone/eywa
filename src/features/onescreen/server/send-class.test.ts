import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let rows = h.tables[table] ?? [];
  let single = false;
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
    in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
    is: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
    maybeSingle: () => { single = true; return q; },
    update: () => { h.writes.push(table); return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length }).then(resolve),
  };
  return q;
} }) }));
vi.mock("@/features/report-admin/server/classnote-sync-actions", () => ({ requestClassnoteBoardSync: vi.fn() }));
vi.mock("@/features/report-admin/server/classnote-sync-auto", () => ({ runAsAutoSyncRequest: vi.fn() }));
vi.mock("@/features/report-admin/server/classnote-sync-core", () => ({ loadSyncRows: vi.fn() }));

const { resolveMakeupSendClass, blockedForNoSendClass } = await import("./send-class");
const date = "2026-11-12";
beforeEach(() => {
  const common = { tenant_id: "t", subject: "math", is_active: true, closed_at: null };
  h.tables = {
    classes: [{ ...common, id: "JJ", class_name: "JJ1A", report_optout: true }, { ...common, id: "MS", class_name: "MS1A", report_optout: false }],
    enrollments: ["JJ", "MS"].map(class_id => ({ tenant_id: "t", student_id: "s", class_id, start_date: "2026-01-01", end_date: null, on_hold: false })),
    classnote_class_boards: [{ tenant_id: "t", class_id: "MS" }],
    classnote_class_board_members: [{ tenant_id: "t", class_id: "MS", student_id: "s", status: "ok" }],
    classnote_workers: [{ tenant_id: "t", last_seen: new Date().toISOString(), last_results: { postMode: true, caps: { makeupDelivery: true } } }],
    lesson_reports: [{ id: "r", tenant_id: "t", classnote_class_id: "MS", makeup_class_id: "JJ", classnote_sent_at: null, report_date: date, subject: "math" }],
  };
  h.writes = [];
});

describe("미발송 반 결석분의 대신 보강", () => {
  it("담임·부담임·다른 강사 누구든 같은 학생의 검증된 반을 제안하며 자동으로 보내지 않는다", async () => {
    const result = await resolveMakeupSendClass("t", "s", date, "math", "JJ");
    expect(result).toMatchObject({ ok: false, reason: "choose", candidates: [{ id: "MS", name: "MS1A" }], makeupClass: { id: "JJ" } });
    expect(h.writes).toEqual([]);
  });
  it("MS 전달을 선택해도 JJ 출결을 이동하거나 보고서 반을 바꾸지 않는다", async () => {
    expect(await resolveMakeupSendClass("t", "s", date, "math", "JJ", "MS")).toEqual({ ok: true, classId: "MS", via: "delivery" });
    expect(h.writes).toEqual([]);
  });
  it.each(["student", "subject", "hold", "ended", "tenant"])("%s 조건이 어긋나면 보낼 수 없다", async condition => {
    if (condition === "student") h.tables.classnote_class_board_members[0].student_id = "other";
    if (condition === "subject") h.tables.classes[1].subject = "english";
    if (condition === "hold") h.tables.classnote_class_board_members[0].status = "hold";
    if (condition === "ended") h.tables.enrollments[1].end_date = "2026-11-01";
    if (condition === "tenant") h.tables.classes[1].tenant_id = "other";
    await expect(resolveMakeupSendClass("t", "s", date, "math", "JJ", "MS")).rejects.toThrow();
    expect(h.writes).toEqual([]);
  });
  it("일괄 발송도 출결 반을 보존한 채 저장된 전달 반을 검증한다", async () => {
    expect(await blockedForNoSendClass("t", [{ id: "r", studentId: "s", classId: null }])).toEqual(new Set());
    expect(h.writes).toEqual([]);
    h.tables.enrollments[1].on_hold = true;
    expect(await blockedForNoSendClass("t", [{ id: "r", studentId: "s", classId: null }])).toEqual(new Set(["r"]));
  });
});
