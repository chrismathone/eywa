import { beforeEach, describe, expect, it, vi } from "vitest";
type Native = {
  id: string; status: string; classId: string | null; anchorClassId: string | null;
  teacherId: string | null; reportId: string | null;
};
type Read = { table: string; filters: [string, string][]; range: [number, number] | null; limit: number | null };

const bag = vi.hoisted(() => {
  const bag = {
    mode: "on" as "off" | "on" | "draining",
    user: { id: "u", tenantId: "tenant-a" } as { id: string; tenantId: string } | null,
    participants: [] as Native[],
    rows: [] as Record<string, unknown>[],
    reads: [] as Read[],
    attendanceError: null as string | null,
    classError: null as string | null,
    classTeacher: null as string | null,
    createCalls: 0,
    loadCalls: 0,
    settingsCalls: 0,
    chain(table: string) {
      const read: Read = { table, filters: [], range: null, limit: null };
      bag.reads.push(read);
      const api = {
        select() { return api; },
        eq(column: string, value: string) { read.filters.push([column, value]); return api; },
        order() { return api; },
        limit(count: number) { read.limit = count; return api; },
        async range(from: number, to: number) {
          read.range = [from, to];
          if (table === "attendance_records" && bag.attendanceError) {
            return { data: null, error: { message: bag.attendanceError } };
          }
          let rows = bag.rows.filter((row) => read.filters.every(([c, v]) => String(row[c] ?? "") === v));
          if (read.limit != null) rows = rows.slice(0, read.limit);
          return { data: rows.slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          if (bag.classError) return { data: null, error: { message: bag.classError } };
          return { data: { teacher_id: bag.classTeacher }, error: null };
        },
      };
      return api;
    },
  };
  return bag;
});

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => {
    bag.settingsCalls += 1;
    return { makeups: { mode: bag.mode, pilotSubjects: ["math"], allowAdditional: false } };
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => bag.user }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (bag.createCalls += 1, { from: (table: string) => bag.chain(table) }),
}));
vi.mock("./participants", () => ({
  loadNativeParticipants: async () => (bag.loadCalls += 1, {
    status: "ok" as const,
    value: { participants: bag.participants, legacyMaps: [], truncated: false, total: null, nextAfter: null },
  }),
}));

import { makeupReportUpsertBlock } from "./gates";

const MISMATCH = "정규 수업과 보강의 담당이 달라 같은 날에 함께 기록할 수 없습니다";
const LOOKUP = "정규 출결을 확인하지 못해 보강 보고서를 저장하지 않았습니다";
const CONFLICT = "같은 날 정규 수업의 담당이 서로 달라 보강 보고서를 저장하지 않았습니다";
const ONCE = "같은 날 이 과목의 보강 참여는 한 번만 기록합니다";
const base = {
  makeup: true, classId: null, subject: "math", studentId: "s", date: "2026-10-05", creating: true, existingReportId: null,
};

function native(teacherId: string | null, id = "p"): Native {
  return { id, status: "present", classId: "c", anchorClassId: "c", teacherId, reportId: null };
}
function row(index: number, patch: Record<string, unknown> = {}) {
  return {
    id: `id-${index}`, tenant_id: "tenant-a", student_id: "s", class_id: "c", session_date: "2026-10-05",
    slot_start: "16:20:00", recorded_at: new Date(Date.UTC(2026, 9, 5, 0, index)).toISOString(),
    status: "present", taught_by: "teacher-a", ...patch,
  };
}
const reads = (table: string) => bag.reads.filter((read) => read.table === table);
const block = () => makeupReportUpsertBlock(base);

beforeEach(() => {
  Object.assign(bag, {
    mode: "on", user: { id: "u", tenantId: "tenant-a" }, participants: [], rows: [], reads: [],
    attendanceError: null, classError: null, classTeacher: null, createCalls: 0, loadCalls: 0, settingsCalls: 0,
  });
});

describe("보강 보고서의 정규 담당", () => {
  it("같은 교시의 나중 결석은 예전 출석으로 보고서를 막지 않는다", async () => {
    bag.participants = [native("teacher-b")];
    bag.rows = [row(1), row(2, { status: "absent" })];
    expect(await block()).toBeNull();
    expect(reads("classes")).toHaveLength(0);
  });

  it("같은 교시의 나중 담당을 쓰고 예전 담당으로 통과시키지 않는다", async () => {
    bag.participants = [native("teacher-a")];
    bag.rows = [row(1), row(2, { taught_by: "teacher-b" })];
    expect(await block()).toBe(MISMATCH);
    expect(reads("classes")).toHaveLength(0);
  });

  it("현재 교시들의 담당이 다르면 첫 줄을 고르지 않고 막는다", async () => {
    bag.participants = [native("teacher-a")];
    bag.rows = [
      row(1, { id: "slot-b", slot_start: "17:20:00", taught_by: "teacher-b" }),
      row(2, { id: "slot-a", slot_start: "16:20:00", taught_by: "teacher-a" }),
    ];
    expect(await block()).toBe(CONFLICT);
  });

  it("출결과 반 담당은 이 지점의 행만 본다", async () => {
    bag.participants = [native("teacher-b")];
    bag.classTeacher = "teacher-b";
    bag.rows = [row(1, { taught_by: null }), row(2, { tenant_id: "tenant-b", taught_by: "intruder" })];
    expect(await block()).toBeNull();
    expect(reads("attendance_records").map((read) => read.filters)).toEqual([[
      ["tenant_id", "tenant-a"], ["student_id", "s"], ["class_id", "c"], ["session_date", "2026-10-05"],
    ]]);
    expect(reads("classes").map((read) => read.filters)).toEqual([[["tenant_id", "tenant-a"], ["id", "c"]]]);
  });

  it("출결 조회가 실패하거나 지점을 모르면 보강 보고서만 막는다", async () => {
    bag.participants = [native("teacher-a")];
    bag.rows = [row(1)];
    bag.attendanceError = "db down";
    expect(await block()).toBe(LOOKUP);
    bag.attendanceError = null;
    bag.user = null;
    bag.createCalls = 0;
    expect(await block()).toBe(LOOKUP);
    bag.user = { id: "u", tenantId: " " };
    expect(await block()).toBe(LOOKUP);
    expect(bag.createCalls).toBe(0);
  });

  it("최신 담당이 비면 그 반의 담당으로 맞추고 조회 실패는 막는다", async () => {
    bag.participants = [native("teacher-b")];
    bag.classTeacher = "teacher-b";
    bag.rows = [row(1, { taught_by: "teacher-a" }), row(2, { taught_by: null })];
    expect(await block()).toBeNull();
    bag.rows = [row(1, { taught_by: null })];
    bag.classError = "no class";
    expect(await block()).toBe(LOOKUP);
  });

  it("스무 줄을 넘는 정정도 최신 담당으로 본다", async () => {
    bag.participants = [native("teacher-b")];
    bag.rows = Array.from({ length: 22 }, (_, index) => row(index, {
      id: `h-${index}`, taught_by: index === 21 ? "teacher-b" : "teacher-a",
    }));
    expect(await block()).toBeNull();
    const attendance = reads("attendance_records");
    expect(Math.max(...attendance.map((read) => read.range?.[1] ?? -1))).toBeGreaterThan(20);
    expect(attendance.every((read) => read.limit == null)).toBe(true);
  });

  it("운영이 꺼지거나 정규 보고서면 출결을 조회하지 않는다", async () => {
    bag.mode = "off";
    bag.participants = [native("teacher-a")];
    bag.attendanceError = "db down";
    expect(await block()).toBeNull();
    expect(bag.loadCalls).toBe(0);
    expect(bag.createCalls).toBe(0);
    bag.mode = "on";
    expect(await makeupReportUpsertBlock({ ...base, makeup: false })).toBeNull();
    expect(await makeupReportUpsertBlock({ ...base, classId: "c" })).toBeNull();
    expect(bag.settingsCalls).toBe(1);
    expect(bag.loadCalls).toBe(0);
    expect(bag.createCalls).toBe(0);
  });

  it("영어 보강 보고서는 수학 시범 기능의 조회 실패와 관계없이 기존 저장 경로를 쓴다", async () => {
    bag.attendanceError = "db down";
    expect(await makeupReportUpsertBlock({ ...base, subject: "english" })).toBeNull();
    expect(bag.loadCalls).toBe(0);
    expect(bag.createCalls).toBe(0);
  });

  it("둘째 참여와 앵커 없는 참여와 깨진 시각은 출결 성공으로 위장하지 않는다", async () => {
    bag.participants = [native("teacher-a"), native("teacher-b", "p2")];
    bag.attendanceError = "db down";
    expect(await block()).toBe(ONCE);
    bag.participants = [{ ...native("teacher-a"), classId: null, anchorClassId: null }];
    expect(await block()).toBeNull();
    bag.participants = [native("teacher-a")];
    bag.attendanceError = null;
    bag.rows = [row(1, { recorded_at: "not-a-date" })];
    expect(await block()).toBe(LOOKUP);
    expect(bag.createCalls).toBe(1);
  });
});
