import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATE, OWN, FOREIGN, FOREIGN_NAME, TEACHER, h, db, enableRegularClass, getFakeTeaching,
  inScopes, nativeParticipant, resetFixture, setNative,
} from "./roster-conducted.test-support";

// Keep the real loader, participant adapter/parser, batching, and roster merge; replace server IO only.
vi.mock("@/lib/supabase/server", async () => ({ createClient: (await import("./roster-conducted.test-support")).createFakeClient }));
vi.mock("@/lib/supabase/admin", async () => ({ createAdminClient: (await import("./roster-conducted.test-support")).getFakeAdmin }));
vi.mock("@/lib/auth/current-user", async () => ({ getCurrentUser: (await import("./roster-conducted.test-support")).getFakeUser }));
vi.mock("@/lib/auth/view-mode", async () => ({ viewAsTeacher: (await import("./roster-conducted.test-support")).getFakeView }));
vi.mock("@/features/owner/server/queries", async () => ({ getTenantSettings: (await import("./roster-conducted.test-support")).getFakeSettings }));
vi.mock("@/features/classes/server/delegation", async () => ({ getTeachingClasses: (await import("./roster-conducted.test-support")).getFakeTeaching }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/features/owner/server/lesson-profile", () => ({ getLessonProfile: async () => ({ autoUnits: false }) }));
vi.mock("@/features/billing/server/textbook-queries", () => ({ getTextbookOrdersForStudents: async () => [] }));
vi.mock("@/features/attendance/server/makeup-reservation-queries", () => ({ getReservationsOn: async () => [] }));

const { getTeacherRoster } = await import("./roster");
const NOTICE = "보강 배정을 확인하지 못했습니다. 새로고침해 다시 확인해 주세요.";
beforeEach(() => {
  vi.clearAllMocks(); resetFixture();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function expectForeignMakeup(roster: Awaited<ReturnType<typeof getTeacherRoster>>) {
  const student = roster.students.find(row => row.id === "native");
  expect(student).toMatchObject({ isMakeup: true, tag: FOREIGN_NAME, className: FOREIGN_NAME, tags: [FOREIGN_NAME] });
  expect(student?.subjects).toHaveLength(1);
  expect(student?.subjects[0]).toMatchObject({
    subjectKey: "math", classId: null, makeup: true, makeupClassId: FOREIGN, makeupClassName: FOREIGN_NAME,
  });
  expect(student?.classId).toBeUndefined();
  expect(roster.todayClasses.map(row => row.id)).not.toContain(FOREIGN);
  expect(roster.classTags).not.toContain(FOREIGN_NAME);
  expect(roster.makeupNotice).toBeUndefined();
}

describe("getTeacherRoster — 맡은 보강 참여의 실제 로더 병합", () => {
  it("담당 반 0개여도 남의 반에 기록할 보강 학생 한 명만 세운다", async () => {
    setNative([nativeParticipant()]);
    const roster = await getTeacherRoster(DATE);
    expect(roster.students.map(row => row.id)).toEqual(["native"]);
    expect(roster.todayClasses).toEqual([]);
    expect(roster.noClassesToday).toBe(true);
    expect(roster.showingAll).toBe(false);
    expectForeignMakeup(roster);
    expect(inScopes("enrollments", "class_id")).toEqual([]);
    expect(inScopes("students", "id")).toEqual([["native"]]);
    expect(h.rpc).toHaveBeenCalledWith("makeup_list_participants", { p_filter: expect.objectContaining({ session_date: DATE }) });
    expect(h.rpc).toHaveBeenCalledWith("onescreen_prior_reports", { p_student_ids: ["native"], p_before: DATE });
  });

  it("내 정규반이 있어도 외부 반 전원·남의 참여·취소·반 없는 참여로 넓히지 않는다", async () => {
    enableRegularClass();
    setNative([
      nativeParticipant(), nativeParticipant("native", { id: "second-native" }),
      nativeParticipant("peer", { teacher_id: "other-teacher" }),
      nativeParticipant("cancelled", { status: "cancelled" }),
      nativeParticipant("unanchored", { class_id: null, anchor_class_id: null }),
    ]);
    const roster = await getTeacherRoster(DATE);
    expect(roster.students.map(row => row.id)).toEqual(["regular", "native"]);
    expect(roster.todayClasses).toMatchObject([{ id: OWN, studentCount: 1 }]);
    expect(roster.todayClasses).toHaveLength(1);
    expect(roster.noClassesToday).toBe(false);
    expectForeignMakeup(roster);
    expect(inScopes("enrollments", "class_id")).toEqual([[OWN]]);
    expect(inScopes("class_schedules", "class_id")).toEqual([[OWN]]);
    expect(inScopes("class_sheet_plan_lines", "class_id")).toEqual([[OWN]]);
    expect(getFakeTeaching).toHaveBeenCalledWith(db, TEACHER, DATE);
    expect(h.reads.find(read => read.table === "classes")?.predicates).toContainEqual({ kind: "eq", column: "tenant_id", value: "tenant" });
  });

  it.each([false, true])("빈 날의 native 조회 실패는 안내를 실어 반환한다(담당 반 있음=%s)", async (ownsClasses) => {
    if (ownsClasses) enableRegularClass();
    h.tables.class_schedules = [];
    h.nativeReply = { data: null, error: { code: "XX000", message: "synthetic read failure" } };
    const roster = await getTeacherRoster(DATE);
    expect(roster).toMatchObject({ students: [], todayClasses: [], makeupNotice: NOTICE, showCheckTest: false, noticeMode: "B" });
    expect(roster.noClassesToday).toBe(ownsClasses);
    expect(inScopes("enrollments", "class_id")).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("makeup_list_participants", expect.anything());
  });

  it("native 네트워크 예외도 담당 반 없는 빈 화면을 죽이지 않는다", async () => {
    h.nativeThrow = true;
    await expect(getTeacherRoster(DATE)).resolves.toMatchObject({ students: [], makeupNotice: NOTICE });
  });

  it.each(["off", "schema_missing"] as const)("%s일 때 정규 명단과 기존 출결 보강을 그대로 유지한다", async (mode) => {
    enableRegularClass();
    h.tables.attendance_records = [{ student_id: "legacy", class_id: OWN, session_date: DATE, status: "makeup", recorded_at: `${DATE}T08:00:00Z` }];
    const baseline = await getTeacherRoster(DATE);
    expect(baseline.students.map(row => row.id).sort()).toEqual(["legacy", "regular"]);
    expect(baseline.students.find(row => row.id === "regular")?.subjects[0]).toMatchObject({ classId: OWN, makeup: false });
    expect(baseline.students.find(row => row.id === "legacy")?.subjects[0]).toMatchObject({ classId: null, makeup: true, makeupClassId: OWN });
    h.rpc.mockClear();
    if (mode === "off") {
      h.settings.makeups.mode = "off";
      setNative([nativeParticipant()]); // Latent native data must not leak when the feature is off.
    } else h.nativeReply = { data: null, error: { code: "PGRST202", message: "makeup_list_participants missing" } };
    expect(await getTeacherRoster(DATE)).toEqual(baseline);
    const nativeCalls = h.rpc.mock.calls.filter(([name]) => name === "makeup_list_participants");
    expect(nativeCalls).toHaveLength(mode === "off" ? 0 : 1);
  });

  it.each(["off", "schema_missing"] as const)("%s일 때 수업 없는 날 정규반 전체는 명시 선택에만 보인다", async (mode) => {
    enableRegularClass(); h.tables.class_schedules = [];
    if (mode === "off") h.settings.makeups.mode = "off";
    else h.nativeReply = { data: null, error: { code: "42883", message: "function missing" } };
    const empty = await getTeacherRoster(DATE);
    expect(empty).toMatchObject({ students: [], noClassesToday: true, showingAll: false });
    expect(empty.makeupNotice).toBeUndefined();
    const all = await getTeacherRoster(DATE, true);
    expect(all.students.map(row => row.id)).toEqual(["regular"]);
    expect(all).toMatchObject({ noClassesToday: true, showingAll: true });
    expect(all.students[0].subjects[0]).toMatchObject({ classId: OWN, makeup: false });
  });
});
