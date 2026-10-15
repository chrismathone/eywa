// 반영 실행 — 쓰는 순서·되돌리기 기록의 모양·실패했을 때 남기는 것.
// 진짜 DB 대신 "무엇을 썼는지 적어 두는" 가짜 클라이언트로 돌린다(쓰기 경로라 운영 DB로 시험하지 않는다).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GridApplyPlan } from "@/features/timetable/import/math-grid/apply-plan";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/features/students/server/status-access", () => ({ canManageStudentStatusNow: async () => access.allowed }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn(async () => {}) }));

const { executeGridPlan } = await import("./math-grid-apply");
const { keptClassesText, removeGridCreatedClasses } = await import("./math-grid-cancel");
const { logAction } = await import("@/features/audit/server/log");

type Call = { table: string; op: string; value?: unknown; where?: Record<string, unknown> };

/** supabase-js 흉내 — insert/update/delete/rpc를 순서대로 적고, 표마다 정해 둔 답을 돌려준다. */
function fakeDb(opts: { fail?: (c: Call) => boolean; enrollmentCount?: number; moveFails?: string[] } = {}) {
  const calls: Call[] = [];
  let seq = 0;
  const from = (table: string) => {
    const call: Call = { table, op: "select" };
    const result = () => {
      if (opts.fail?.(call)) return { data: null, error: { code: "XX000", message: "boom" }, count: null };
      if (call.op === "insert") {
        const rows = (Array.isArray(call.value) ? call.value : [call.value]).map(() => ({ id: `${table}-${++seq}` }));
        return { data: rows, error: null, count: null };
      }
      return { data: [], error: null, count: opts.enrollmentCount ?? 0 };
    };
    const chain: Record<string, unknown> = {
      insert: (value: unknown) => ((call.op = "insert"), (call.value = value), calls.push(call), chain),
      update: (value: unknown) => ((call.op = "update"), (call.value = value), calls.push(call), chain),
      delete: () => ((call.op = "delete"), calls.push(call), chain),
      select: () => chain,
      eq: (k: string, v: unknown) => ((call.where = { ...call.where, [k]: v }), chain),
      single: async () => {
        const r = result();
        return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
    };
    return chain;
  };
  const rpc = async (name: string, args: { p_moves: { enrollmentId: string }[] }) => {
    const call: Call = { table: name, op: "rpc", value: args };
    calls.push(call);
    if (opts.fail?.(call)) return { data: null, error: { code: "XX000", message: "boom" } };
    const ok = (id: string) => !opts.moveFails?.includes(id);
    return { data: args.p_moves.map((m) => ({ enrollmentId: m.enrollmentId, newEnrollmentId: ok(m.enrollmentId) ? `new-${m.enrollmentId}` : undefined, ok: ok(m.enrollmentId) })), error: null };
  };
  return { db: { from, rpc } as never, calls };
}

const USER = { id: "u1", tenantId: "t1" };
const target = { classId: null, key: "new:jj2o", name: "초등M 개별 JJ2O" };
const PLAN: GridApplyPlan = {
  classes: [
    {
      key: "new:jj2o", name: "초등M 개별 JJ2O", teacherId: "t-heo", teacherName: "허주연", classroomId: "r-202", room: "본원202",
      slots: [{ day: "wed", startTime: "16:20", endTime: "17:15" }, { day: "wed", startTime: "17:15", endTime: "18:10" }],
      when: ["수 16:20~18:10 (2교시)"],
    },
  ],
  moves: [{ enrollmentId: "e1", studentId: "s1", label: "박지호/6달성초", fromName: "초등M 개별 JJ2I", to: target, attendanceDays: ["wed"] }],
  adds: [{ studentId: "s4", label: "나휴원/5옥산초", to: target, attendanceDays: [], onHold: true }],
  removes: [{ enrollmentId: "e9", label: "김하늘/5옥산초", className: "초등M 개별 JJ2N" }],
  skipped: [], notes: [], warnings: [],
};
const seen = (calls: Call[]) => calls.map((c) => `${c.op} ${c.table}`);

describe("수학 격자 반영 실행", () => {
  it("반 → 수업 시간 → 되돌리기 기록 → 이동 → 종료 → 추가 순으로 쓰고, 전부 적용일을 쓴다", async () => {
    const { db, calls } = fakeDb();
    const res = await executeGridPlan(db, USER, PLAN, "2026-10-14");
    expect(seen(calls)).toEqual([
      "insert classes",
      "insert class_schedules",
      "insert timetable_snapshots",
      "rpc move_enrollments_batch",
      "update enrollments",
      "insert enrollments",
      "update timetable_snapshots",
      "insert timetable_import_logs",
    ]);
    expect(calls[0]!.value).toEqual({ tenant_id: "t1", class_name: "초등M 개별 JJ2O", subject: "math", teacher_id: "t-heo", classroom_id: "r-202", is_active: true });
    expect(calls[1]!.value).toEqual([
      { tenant_id: "t1", class_id: "classes-1", day_of_week: "wed", start_time: "16:20", end_time: "17:15", valid_from: "2026-10-14" },
      { tenant_id: "t1", class_id: "classes-1", day_of_week: "wed", start_time: "17:15", end_time: "18:10", valid_from: "2026-10-14" },
    ]);
    // 이동은 새로 만든 반의 id로 — 적용일을 명시한다(안 넘기면 DB 시각이 기본값이 된다)
    expect(calls[3]!.value).toEqual({ p_effective_date: "2026-10-14", p_moves: [{ enrollmentId: "e1", newClassId: "classes-1", attendanceDays: ["wed"] }] });
    expect(calls[4]).toMatchObject({ value: { end_date: "2026-10-14", withdrawal_reason: "엑셀 import 삭제" }, where: { id: "e9" } });
    expect(calls[5]!.value).toEqual({ tenant_id: "t1", student_id: "s4", class_id: "classes-1", start_date: "2026-10-14", on_hold: true, attendance_days: [] });
    expect(res).toEqual({ applied: { classes: 1, moved: 1, added: 1, removed: 1 }, heldAdds: 1, failed: 0, effectiveDate: "2026-10-14", snapshotId: "timetable_snapshots-4" });
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "timetable_import_apply", metadata: expect.objectContaining({ source: "sheet_grid", createdClasses: ["초등M 개별 JJ2O"] }) }));
  });

  it("되돌리기 기록은 수강 되돌리기 함수가 읽는 모양이다(kind 없음 · 새 수강 id · 만든 반)", async () => {
    const { db, calls } = fakeDb();
    await executeGridPlan(db, USER, PLAN, "2026-10-14");
    const snapshot = calls.find((c) => c.op === "insert" && c.table === "timetable_snapshots")!.value as { reference_date: string; payload: Record<string, unknown> };
    const patched = calls.find((c) => c.op === "update" && c.table === "timetable_snapshots")!.value as { payload: Record<string, unknown> };
    expect(snapshot.reference_date).toBe("2026-10-14");
    expect("kind" in patched.payload).toBe(false);
    expect(patched.payload).toMatchObject({
      moves: [{ enrollmentId: "e1", toClassId: "classes-1", newEnrollmentId: "new-e1" }],
      removes: [{ enrollmentId: "e9" }],
      adds: [{ studentId: "s4", classId: "classes-1", enrollmentId: "enrollments-5" }],
      gridClasses: [{ classId: "classes-1", name: "초등M 개별 JJ2O", scheduleIds: ["class_schedules-2", "class_schedules-3"] }],
    });
  });

  it("수업 시간이나 되돌리기 기록을 못 쓰면 만든 반을 지우고 멈춘다(학생은 건드리지 않는다)", async () => {
    for (const table of ["class_schedules", "timetable_snapshots"]) {
      const { db, calls } = fakeDb({ fail: (c) => c.op === "insert" && c.table === table });
      const res = await executeGridPlan(db, USER, PLAN, "2026-10-14");
      expect(res.error).toContain("변경은 적용되지 않았습니다");
      expect(seen(calls).at(-1)).toBe("delete classes");
      expect(calls.some((c) => c.op === "rpc" || c.table === "enrollments")).toBe(false);
    }
  });

  it("이동이 실패하면 반은 만들어졌다고 정확히 알리고 흔적(이력·감사로그)을 남긴다", async () => {
    const { db, calls } = fakeDb({ fail: (c) => c.op === "rpc" });
    const res = await executeGridPlan(db, USER, PLAN, "2026-10-14");
    expect(res.error).toContain("반 1개는 만들어졌습니다");
    expect(res.snapshotId).toBeTruthy();
    expect(seen(calls).slice(-2)).toEqual(["update timetable_snapshots", "insert timetable_import_logs"]);
    expect(calls.some((c) => c.table === "enrollments")).toBe(false);
    // 감사로그·이력에는 실제로 된 건수(0)를 적는다 — 계획 건수를 적으면 "이동 1건"으로 남는다
    expect(vi.mocked(logAction).mock.lastCall![0].metadata).toMatchObject({ moved: 0, removed: 0, added: 0, abortedAt: "move" });
    expect(calls.at(-1)!.value).toMatchObject({ result: { classes: 1, moves: 0, removes: 0, adds: 0, abortedAt: "move" } });
  });

  it("일부만 된 이동·종료·추가는 된 만큼만 세고 나머지는 실패로 알린다", async () => {
    const { db } = fakeDb({ moveFails: ["e1"], fail: (c) => c.table === "enrollments" && c.op === "update" });
    const res = await executeGridPlan(db, USER, PLAN, "2026-10-14");
    expect(res).toMatchObject({ applied: { classes: 1, moved: 0, removed: 0, added: 1 }, failed: 2 });
  });

  it("예약 취소: 수강이 붙어 있는 반은 지우지 않고 이름을 돌려준다", async () => {
    const empty = fakeDb({ enrollmentCount: 0 });
    expect(await removeGridCreatedClasses(empty.db, [{ classId: "c1", name: "JJ2O", scheduleIds: [] }])).toEqual([]);
    expect(seen(empty.calls)).toEqual(["delete classes"]);
    const used = fakeDb({ enrollmentCount: 2 });
    expect(await removeGridCreatedClasses(used.db, [{ classId: "c1", name: "JJ2O", scheduleIds: [] }])).toEqual([{ name: "JJ2O", why: "enrolled" }]);
    expect(used.calls).toEqual([]);
    // 수강은 없는데 DB가 삭제를 막으면(보강 건 등이 그 반을 가리킨다) 까닭을 다르게 말한다
    const linked = fakeDb({ fail: (c) => c.op === "delete" });
    const kept = await removeGridCreatedClasses(linked.db, [{ classId: "c1", name: "JJ2O", scheduleIds: [] }]);
    expect([kept, keptClassesText([...kept, { name: "JJ2P", why: "enrolled" }])]).toEqual([
      [{ name: "JJ2O", why: "linked" }],
      "새로 만든 반(JJ2P)은 수강이 붙어 있어 지우지 않았습니다 · 새로 만든 반(JJ2O)은 다른 기록이 연결되어 있어 지우지 못했습니다 — 수업목록에서 확인해 주세요.",
    ]);
  });
});

describe("배선 — 예약 취소·되돌리기와의 약속", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

  it("종료 사유 문구가 되돌리기 함수(0236a)가 대조하는 문구와 같다", () => {
    const sql = read("supabase", "migrations", "0236a_rollback_enrollment_import_by_id.sql");
    expect(sql).toContain("withdrawal_reason = '엑셀 import 삭제'");
    expect(read("src", "features", "timetable", "server", "math-grid-apply.ts")).toContain('withdrawal_reason: "엑셀 import 삭제"');
  });

  it("예약 취소가 이 가져오기가 만든 반을 지운다 — 수강을 전부 되돌린 뒤에만", () => {
    const src = read("src", "features", "timetable", "server", "scheduled-import-actions.ts");
    expect(src).toMatch(/skipped === 0 && Array\.isArray\(gridClasses\)/);
    expect(src).toContain("removeGridCreatedClasses(supabase, gridClasses)");
  });

  it("영어 시트 예약과 같은 날짜로 묶여 한꺼번에 취소될 때도 만든 반을 지운다 · 반을 지우는 취소는 반 만들기 자격을 요구하고 기록한다", () => {
    const src = read("src", "features", "timetable", "server", "scheduled-import-actions.ts");
    const master = src.slice(src.indexOf("cancelMasterDate(sql, user, date)"), src.indexOf("let done = 0;"));
    expect(master).toContain("removeGridCreatedClasses(supabase, allGridClasses)");
    // 게이트는 어느 경로로 갈리기 전에 선다
    const gate = src.indexOf('canManageTenant(user.systemRole, "classes")');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf("masterRows?.some((r) => r.source)"));
    expect(src.match(/await logCancel\(/g)!.length).toBe(3); // 영어와 묶인 경로 · 보통 경로 · 중간에 멈춘 경우
    expect(read("src", "features", "audit", "server", "log.ts")).toContain('timetable_import_cancel: "시간표 가져오기 예약 취소"');
  });

  it("적용 액션은 적용일을 서버에서 다시 검증하고, 다시 세운 계획의 해시를 대조한 뒤에만 쓴다", () => {
    const src = read("src", "features", "timetable", "server", "math-grid-import-actions.ts");
    expect(src).toMatch(/normalizeEffectiveDate\(effectiveDateRaw, kstToday\(\)\)/);
    expect(src).toMatch(/hash !== expectedHash/);
    expect(src).toMatch(/executeGridPlan\(supabase, user, fresh\.plan, eff\.date\)/);
    // 반 만들기 자격 — 수업목록의 '새 반'과 같은 조건
    expect(src).toMatch(/canManageTenant\(user\.systemRole, "classes"\)/);
    // 종강 예정 반은 적용일이 정해진 여기서 막는다(계획은 날짜를 모른다)
    expect(src).toMatch(/x\.to\.closesOn && x\.to\.closesOn <= eff\.date/);
  });

  it("학원 자료는 수학 반의 수강만 싣는다(다른 과목 수강은 이 가져오기가 볼 일이 없다)", () => {
    const src = read("src", "features", "timetable", "server", "math-grid-context.ts");
    expect(src).toMatch(/\.filter\(\(e\) => mathIds\.has\(e\.class_id\)\)/);
  });
});


it("denied status removals stop before class creation, snapshots, or enrollment writes", async () => {
  access.allowed = false;
  const { db, calls } = fakeDb();
  try { expect((await executeGridPlan(db, USER, PLAN, "2099-01-01")).error).toBeTruthy(); expect(calls).toEqual([]); }
  finally { access.allowed = true; }
});
