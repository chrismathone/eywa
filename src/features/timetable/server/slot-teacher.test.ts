import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  schedules: [] as Record<string, unknown>[],
  selects: [] as string[],
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-09-21", kstMinutesOfDay: () => 0 }));
vi.mock("@/features/classes/server/lab-separate", () => ({ loadLabSeparateIds: async () => new Set() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const data = () => table === "class_schedules" ? h.schedules : [];
      for (const key of ["eq", "lte", "not", "or", "order"]) q[key] = () => q;
      q.select = (columns: string) => { if (table === "class_schedules") h.selects.push(columns); return q; };
      q.range = (from: number) => Promise.resolve({ data: from === 0 ? data() : [], error: null });
      q.then = (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: data(), error: null }));
      return q;
    },
  }),
}));

import { getWeeklySchedule, getTeacherLabelsBySubject } from "./queries";

const klass = { id: "class", class_name: "중등E_중1 정규 B", subject: "english", teacher: { display_name: "송지혜" } };
const slot = {
  id: "new", class_id: "class", day_of_week: "tue", start_time: "19:20:00", end_time: "20:10:00",
  valid_from: "2026-09-07", valid_to: null, slot_teacher_label: null,
  slotTeacher: { display_name: "추민아" }, class: klass,
};

beforeEach(() => { h.schedules = [slot]; h.selects = []; });

describe("시간표 조회의 교시 담당자", () => {
  it("저장된 교시 FK를 조회하고, 담당자와 담임을 따로 유지한다", async () => {
    const rows = await getWeeklySchedule();
    expect(h.selects[0]).toContain("slotTeacher:teacher_id ( display_name )");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teacherName: "송지혜", slotTeacherLabel: "추민아" });
  });

  it("종료된 배치를 제외하고 JJ 자리와 담임 상속을 보존한다", async () => {
    h.schedules.push(
      { ...slot, id: "old", valid_from: "2026-09-01", valid_to: "2026-09-06", slotTeacher: { display_name: "송지혜" } },
      { ...slot, id: "seat", day_of_week: "thu", slot_teacher_label: "JJ", slotTeacher: null },
      { ...slot, id: "inherit", day_of_week: "fri", slotTeacher: null },
    );
    const rows = await getWeeklySchedule();
    expect(rows.map((r) => r.id)).toEqual(["new", "seat", "inherit"]);
    expect(rows[1]?.slotTeacherLabel).toBe("JJ");
    expect(rows[2]).toMatchObject({ slotTeacherLabel: null, teacherName: "송지혜" });
  });

  it("강사 선택지에도 담임 대신 실제 교시 담당자를 포함한다", async () => {
    expect(await getTeacherLabelsBySubject()).toEqual({ english: ["추민아"] });
    expect(h.selects[0]).toContain("slotTeacher:teacher_id ( display_name )");
  });
});
