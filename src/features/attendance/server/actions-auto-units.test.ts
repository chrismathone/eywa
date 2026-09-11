/**
 * 수학 자동 시수(원장 2026-09-11) — 서버 액션 **행동** 테스트(가짜 supabase).
 *
 * 배선 가드(`auto-units-wiring.test.ts`)는 소스 문자열을 본다. 여기는 **실제로 무엇이 저장되나**를 본다 — 돈 값인데
 * 적대 리뷰(2026-09-11)에서 판정 인자 한 토큰 변이("1"·"2"가 1.5로 저장)가 202개 테스트 파일을 전부 통과했다.
 *   · 친 숫자는 쓴 그대로 — "1" = null(=1) · "2" = 2 (원장 2026-09-01 *"입력된 숫자가 입력되도록"*)
 *   · 빈 칸(원문 없음·공백)만 수학 자동 시수 · 영어·결석·교시별 행은 없다
 *   · 있는 행을 고치는 저장엔 자동값이 없다(강사가 고친 값 보존) · 응답의 자동값 = 저장값
 * ⚠️ 수업 길이 조회(`resolveAutoUnits`)는 흉내 낸다(수학 반 = 1.5) — 조회·규칙 자체는 `auto-units.test.ts`·
 *    `server/auto-units.test.ts`가 잠근다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    /** attendance_records 조회가 돌려줄 행 — 있으면 갱신 경로를 탄다. */
    existing: [] as Record<string, unknown>[],
    autoCalls: [] as { classId: string; date: string }[][],
  };
  const MATH = "11111111-1111-1111-1111-111111111111";
  const ENG = "22222222-2222-2222-2222-222222222222";
  /** PostgREST 빌더 흉내 — 체인은 자기 자신, await 하면 조회 결과. insert·update는 받은 값을 적어 둔다. */
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "or", "order", "range", "lte", "gte", "limit", "maybeSingle", "delete"]) {
        b[m] = () => b;
      }
      b.insert = (payload: unknown) => {
        for (const r of Array.isArray(payload) ? payload : [payload]) state.inserts.push(r as Record<string, unknown>);
        return b;
      };
      b.update = (patch: Record<string, unknown>) => {
        state.updates.push(patch);
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === "attendance_records" ? state.existing : [], error: null, count: 0 }).then(
          resolve,
          reject,
        );
      return b;
    },
  };
  return { state, client, MATH, ENG };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => h.client) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user-1", tenantId: "tenant-1", systemRole: "master" })),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canWriteTenant: vi.fn(async () => true),
  accessLevelTenant: vi.fn(async () => "full"),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn(async () => {}) }));
vi.mock("./complete-notify", () => ({ notifyIfClassAttendanceComplete: vi.fn() }));
vi.mock("@/features/attendance/live/server/absent-notify", () => ({ notifyDeskOfAbsences: vi.fn() }));
vi.mock("@/features/attendance/live/server/cross-notify", () => ({ notifyUnmarkedToPresent: vi.fn() }));
vi.mock("./makeup-note-action", () => ({ noteMakeupAgainstAbsence: vi.fn() }));
vi.mock("./absence-cell", () => ({ fetchAbsenceCells: vi.fn(), pickAbsenceNoteTarget: vi.fn() }));
vi.mock("@/features/attendance/live/server/write-policy", () => ({
  assertDeskMayWrite: vi.fn(async () => ({ ok: true })),
  isMissingViaColumn: () => false,
  lookupPeriodPhase: vi.fn(async () => "before"),
  resolveWriteVia: vi.fn(async () => "teacher"),
  userTaughtClassSet: vi.fn(async () => new Set<string>()),
  withVia: (row: Record<string, unknown>, via: string) => ({ ...row, recorded_via: via }),
}));
/** 수업 길이 조회 — 수학 반만 165분(= 1.5). 영어 반은 키가 없다(= 자동값 없음). */
vi.mock("./auto-units", () => ({
  resolveAutoUnits: vi.fn(async (_client: unknown, cells: { classId: string; date: string }[]) => {
    h.state.autoCalls.push(cells);
    return new Map(cells.filter((c) => c.classId === h.MATH).map((c) => [`${c.classId}|${c.date}`, 1.5] as const));
  }),
}));

import { saveAttendance, setAttendanceBulk, setAttendanceCell, setAttendanceRange } from "./actions";

const D = "2026-09-10";
const S1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const unitsOf = () => h.state.inserts.map((r) => r.session_units);

beforeEach(() => {
  h.state.inserts.length = 0;
  h.state.updates.length = 0;
  h.state.existing = [];
  h.state.autoCalls.length = 0;
});

describe("setAttendanceCell — 단건(격자 타이핑·팝오버·원스크린 알약·출결 모드)", () => {
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: S1, classId: h.MATH, sessionDate: D, status: "present", quiet: true, ...over });

  it("🔴 빈 칸 + 숫자 안 고름(없음·\"\"·공백) = 수학 자동 시수 1.5 — 응답도 저장값 그대로", async () => {
    for (const units of [undefined, "", "  "]) {
      h.state.inserts.length = 0;
      const res = await cell(units === undefined ? {} : { units });
      expect(unitsOf(), String(units)).toEqual([1.5]);
      expect(res, String(units)).toEqual({ ok: true, autoUnits: 1.5 });
    }
  });

  it("🔴 친 숫자는 쓴 그대로 — \"1\" = null(=1) · \"2\" = 2, 응답에 자동값 없음", async () => {
    expect(await cell({ units: "1" })).toEqual({ ok: true });
    expect(await cell({ units: "2" })).toEqual({ ok: true });
    expect(unitsOf()).toEqual([null, 2]);
  });

  it("영어 반·결석·교시별 행엔 자동값이 없다", async () => {
    expect(await cell({ classId: h.ENG })).toEqual({ ok: true, autoUnits: null });
    await cell({ status: "absent" });
    await cell({ slotStart: "16:20" });
    expect(unitsOf()).toEqual([null, null, null]);
  });

  it("🔴 있는 행을 고치는 저장엔 자동값이 없다 — 상태만이면 시수를 안 건드리고, 빈 시수는 1로 되돌린다", async () => {
    h.state.existing = [
      { id: "r1", slot_start: null, recorded_at: "2026-09-10T08:00:00Z", status: "absent", note: null, session_units: 2 },
    ];
    expect(await cell({})).toEqual({ ok: true });
    expect(await cell({ units: "" })).toEqual({ ok: true });
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.updates[0]).not.toHaveProperty("session_units");
    expect(h.state.updates[1]).toHaveProperty("session_units", null);
    expect(h.state.autoCalls).toHaveLength(0);
  });
});

describe("setAttendanceRange — 격자 범위 채우기·붙여넣기", () => {
  const range = (units?: string) =>
    setAttendanceRange({
      cells: [{ studentId: S1, classId: h.MATH, sessionDate: D }],
      status: "present",
      quiet: true,
      ...(units === undefined ? {} : { units }),
    });

  it("🔴 빈 칸 = 1.5 · 응답 autoUnits도 저장값", async () => {
    const res = await range();
    expect(unitsOf()).toEqual([1.5]);
    expect(res).toMatchObject({ ok: true, autoUnits: [{ studentId: S1, classId: h.MATH, sessionDate: D, units: 1.5 }] });
    await range("");
    expect(unitsOf()).toEqual([1.5, 1.5]);
  });

  it("🔴 \"1\" = null · \"2\" = 2 — 자동값 목록도 없다", async () => {
    const one = await range("1");
    const two = await range("2");
    expect(unitsOf()).toEqual([null, 2]);
    for (const res of [one, two]) expect(res).not.toHaveProperty("autoUnits");
  });
});

describe("setAttendanceBulk — 전원 출석·일괄", () => {
  const bulk = (units?: string) =>
    setAttendanceBulk({
      sessionDate: D,
      status: "present",
      cells: [{ studentId: S1, classId: h.MATH }],
      ...(units === undefined ? {} : { units }),
    });

  it("🔴 빈 칸 = 1.5 · 응답 applied에 created·autoUnits", async () => {
    expect(await bulk()).toEqual({
      ok: true,
      applied: [{ studentId: S1, classId: h.MATH, created: true, autoUnits: 1.5 }],
      blocked: 0,
    });
    await bulk("");
    expect(unitsOf()).toEqual([1.5, 1.5]);
  });

  it("🔴 \"1\" = null · \"2\" = 2 — 응답에 자동값 없음", async () => {
    const one = await bulk("1");
    const two = await bulk("2");
    expect(unitsOf()).toEqual([null, 2]);
    for (const res of [one, two]) {
      expect(res).toEqual({ ok: true, applied: [{ studentId: S1, classId: h.MATH, created: true }], blocked: 0 });
    }
  });
});

describe("saveAttendance — 일별 입력 폼", () => {
  const form = (units: string) => {
    const fd = new FormData();
    fd.set("classId", h.MATH);
    fd.set("date", D);
    fd.set(`status:${S1}`, "present");
    fd.set(`units:${S1}`, units);
    return saveAttendance(undefined, fd);
  };

  it("🔴 시수 칸을 비우면 1.5 · \"1\" = null · \"2\" = 2", async () => {
    await form("");
    await form("1");
    await form("2");
    expect(unitsOf()).toEqual([1.5, null, 2]);
  });
});
