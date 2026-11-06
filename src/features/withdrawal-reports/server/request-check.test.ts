import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 서버가 작성 요청의 승인자를 **다시 정하는지**(화면이 보낸 명단을 믿지 않는다) — `decideReportApprovals` + 실물 `reportStaff`.
 * DB·인증·학원 설정만 바꿔 끼운다(직원 표 · 학생 수강 · 운영자 계정 · '퇴원보고서 승인자' 명단).
 * 원장 2026-11-05 *"관리자 승인에 '원일' 넣지 말것. 항상 '정유진' 혹은 '허은진'. 지정된 사람으로"* · 리뷰 2026-11-06(조건부 통과 — 서버 재계산·운영자 거름·직급 시험).
 */
type UserRow = { id: string; display_name: string; system_role: string; subjects: string[] | null; job_title: string | null };
const state = vi.hoisted(() => ({
  users: [] as UserRow[],
  student: null as unknown,
  approverIds: undefined as string[] | undefined,
  scopes: [] as { userId: string; subjects: string[] }[],
  protectedIds: new Set<string>(),
  folded: false,
  foldedWithList: false,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "requester", tenantId: "tn", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => true, canWriteTenant: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => true }));
vi.mock("@/features/staff/department/server/subject-scope", () => ({ getViewerStaffScope: async () => null }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => null }));
vi.mock("@/lib/auth/protected-accounts", () => ({ protectedAccountIds: async () => ({ protectedIds: state.protectedIds, lookupFailed: false }) }));
vi.mock("@/features/owner/server/queries", async () => {
  // 실물 규약: 조회 실패 → 침산 기본값(resolveSettings({})) + 접힘 표식(markFolded) — 기본값의 '퇴원보고서 승인자'는 빈 명단이다.
  const { resolveSettings } = await vi.importActual<typeof import("@/features/owner/resolve")>("@/features/owner/resolve");
  const { markFolded } = await vi.importActual<typeof import("@/lib/folded-read")>("@/lib/folded-read");
  return {
    getTenantSettings: async () => {
      const plain = { operations: { subjects: [] }, permissions: { specialAccess: { withdrawalApproverIds: state.approverIds, staffSubjectScopes: state.scopes } } };
      // foldedWithList — 접힌 값에 명단이 실려 있는 경우(접힌 값은 믿지 않는다는 방어를 지킨다).
      if (state.foldedWithList) return markFolded(plain, "학원 설정을 읽지 못했습니다");
      return state.folded ? markFolded(resolveSettings({}, { name: "" }), "학원 설정을 읽지 못했습니다") : plain;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = () => (table === "users" ? { data: state.users, error: null } : { data: state.student, error: null });
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "is", "not", "range", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => result();
      q.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail);
      return q;
    },
  }),
}));
import { decideReportApprovals } from "./request-check";
import { reportStaff } from "./queries";
import { APPROVER_SETTINGS_UNAVAILABLE, NO_DESIGNATED_APPROVER, WRITER_ONLY_APPROVER, missingApproverNotice, reportApprovalPlan } from "../request-options";

const user = (id: string, system_role: string, subjects: string[], job_title: string | null = null): UserRow => ({ id, display_name: id, system_role, subjects, job_title });
// 침산 모양(운영 읽기 조회 2026-11-05) — 원일 = 대표(원장급) · 허은진·정유진 = 부원장(지정 승인자) · 김그린 = 영어 관리자(지정 밖) · t = 평강사.
const chimsan = () => [user("원일", "master", ["english", "math"], "대표"), user("허은진", "admin", ["math"], "부원장"), user("정유진", "admin", ["english"], "부원장"),
  user("김그린", "admin", ["english"]), user("t", "teacher", ["english", "science"])];
const course = (id: string, subject: string, teacherId: string) => ({ id, start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false,
  classes: { id: `c-${id}`, class_name: id, subject, english_track: null, is_active: true, closed_at: null, report_optout: false, teacher_id: teacherId, teacher: { display_name: teacherId } } });
const studentWith = (...courses: ReturnType<typeof course>[]) => ({ name: "학생", school: null, grade: null, enrolled_at: "2026-01-01", status: "enrolled", withdrawn_at: null, enrollments: courses });
const ask = (input: { teacherIds: string[]; managerIds: string[]; reportManagerIds?: Record<string, string[]>; enrollmentIds?: string[]; subjects?: string[] }) =>
  decideReportApprovals("tn", { studentId: "s", subjects: input.subjects ?? ["english"], ...input });

beforeEach(() => {
  state.users = chimsan(); state.approverIds = ["허은진", "정유진"]; state.scopes = []; state.protectedIds = new Set(); state.folded = false; state.foldedWithList = false;
});

describe("decideReportApprovals — 서버가 승인자를 다시 정한다(화면 명단을 믿지 않는다)", () => {
  it("김그린 영어 보고서에 화면이 원일만 보내면 거절", async () => {
    state.student = studentWith(course("e1", "english", "김그린"));
    expect(await ask({ teacherIds: ["김그린"], enrollmentIds: ["e1"], managerIds: ["원일"], reportManagerIds: { 김그린: ["원일"] } })).toMatchObject({ ok: false });
  });
  it("원일·김그린·정유진을 함께 보내면 정유진만 남긴다", async () => {
    state.student = studentWith(course("e1", "english", "t"));
    expect(await ask({ teacherIds: ["t"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { t: ["원일", "김그린", "정유진"] } }))
      .toMatchObject({ ok: true, managerIds: ["정유진"], byTeacher: { t: ["정유진"] } });
  });
  it("작성 강사가 정유진이면 화면이 원일을 보내도 생략(빈 목록)", async () => {
    state.student = studentWith(course("e1", "english", "정유진"));
    expect(await ask({ teacherIds: ["정유진"], enrollmentIds: ["e1"], managerIds: ["원일"], reportManagerIds: { 정유진: ["원일"] } }))
      .toMatchObject({ ok: true, managerIds: [], byTeacher: { 정유진: [] } });
  });
  it("화면이 작성 강사를 바꿔 보내도(teacherIds=[정유진]) 서버는 반 담임(김그린)으로 정한다 — 생략 위조 불가", async () => {
    state.student = studentWith(course("e1", "english", "김그린"));
    expect(await ask({ teacherIds: ["정유진"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { 정유진: [] } })).toMatchObject({ ok: false });
  });
  it("옛 화면(보고서별 목록 없음) — managerIds에 원일 · 정유진 → 정유진만", async () => {
    state.student = studentWith(course("e1", "english", "t"));
    expect(await ask({ teacherIds: ["t"], managerIds: ["원일", "정유진"] })).toMatchObject({ ok: true, managerIds: ["정유진"] });
  });
  it("명단이 비어 있는 학원은 종전대로 과목 관리자 전원 — 원장급은 보내도 빠진다", async () => {
    state.approverIds = []; state.student = studentWith(course("e1", "english", "t"));
    expect(await ask({ teacherIds: ["t"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { t: ["원일", "정유진", "김그린"] } }))
      .toMatchObject({ ok: true, byTeacher: { t: ["정유진", "김그린"] } });
  });
});

describe("지정 명단이 무효면 '승인자 없음'(리뷰 2026-11-06) · 지정자가 맡지 않은 과목은 생략하지 않는다", () => {
  it.each([["퇴사·비활성(직원 목록에 없음)", ["퇴사자"]], ["평강사만", ["t"]], ["원장급만", ["원일"]], ["운영자 계정만", ["ops"]]])("%s — 지정 밖 관리자로 돌아가지 않고 막는다", async (_label, ids) => {
    state.users = [...chimsan(), user("ops", "master", [], "대리")]; state.protectedIds = new Set(["ops"]); state.approverIds = ids;
    state.student = studentWith(course("e1", "english", "t"));
    expect(await ask({ teacherIds: ["t"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { t: ["김그린", "정유진"] } })).toEqual({ ok: false, error: NO_DESIGNATED_APPROVER });
    // 김그린이 쓴 영어 보고서도 생략되지 않는다.
    state.student = studentWith(course("e1", "english", "김그린"));
    expect(await ask({ teacherIds: ["김그린"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { 김그린: [] } })).toEqual({ ok: false, error: NO_DESIGNATED_APPROVER });
  });
  it("지정자가 아무도 맡지 않은 과목(과학) — 평강사 보고서는 지정자 전원 · 지정자가 써도 생략 없이 다른 지정자", async () => {
    state.student = studentWith(course("s1", "science", "t"));
    expect(await ask({ teacherIds: ["t"], enrollmentIds: ["s1"], subjects: ["science"], managerIds: [], reportManagerIds: { t: ["허은진", "정유진", "원일"] } }))
      .toMatchObject({ ok: true, byTeacher: { t: ["허은진", "정유진"] } });
    state.student = studentWith(course("s1", "science", "허은진"));
    expect(await ask({ teacherIds: ["허은진"], enrollmentIds: ["s1"], subjects: ["science"], managerIds: [], reportManagerIds: { 허은진: [] } })).toMatchObject({ ok: false });
    expect(await ask({ teacherIds: ["허은진"], enrollmentIds: ["s1"], subjects: ["science"], managerIds: [], reportManagerIds: { 허은진: ["정유진"] } }))
      .toMatchObject({ ok: true, byTeacher: { 허은진: ["정유진"] } });
    // 지정자가 작성 강사 한 명뿐이면 승인할 사람이 없다 → '승인자 없음'과 구분한 안내(리뷰 2026-11-06 2차).
    state.approverIds = ["허은진"];
    expect(await ask({ teacherIds: ["허은진"], enrollmentIds: ["s1"], subjects: ["science"], managerIds: [], reportManagerIds: { 허은진: [] } })).toEqual({ ok: false, error: WRITER_ONLY_APPROVER });
  });
});

describe("reportStaff — 운영자 계정 거름 · 직급(job_title)", () => {
  it("운영자 계정은 '퇴원보고서 승인자' 명단에 있어도 지정되지 않는다(표시 역할 admin · 승인 과목 없음)", async () => {
    state.users = [...chimsan(), user("ops", "master", ["english"], "대리")]; state.protectedIds = new Set(["ops"]); state.approverIds = ["ops", "정유진"];
    const staff = await reportStaff();
    expect(staff.find(u => u.id === "ops")).toMatchObject({ role: "admin", approvalSubjects: [], withdrawalApprover: false });
    expect(staff.find(u => u.id === "정유진")).toMatchObject({ withdrawalApprover: true });
    // 운영자 계정만 있으면 명단은 '있음'(무효) — 모두 지정 아님.
    state.approverIds = ["ops"];
    expect((await reportStaff()).map(u => u.withdrawalApprover)).toEqual(Array(6).fill(false));
  });
  it("원장급은 명단에 있어도 지정되지 않고 · 명단이 없으면 지정 표시도 없다", async () => {
    state.approverIds = ["원일", "허은진"];
    const staff = await reportStaff();
    expect(staff.find(u => u.id === "원일")?.withdrawalApprover).toBe(false);
    expect(staff.find(u => u.id === "허은진")?.withdrawalApprover).toBe(true);
    state.approverIds = undefined;
    expect((await reportStaff()).every(u => u.withdrawalApprover === undefined)).toBe(true);
  });
  it("직급은 앞뒤 공백을 걷어 싣고, 비었거나 공백뿐이면 없음", async () => {
    state.users = [user("a", "admin", ["math"], "  부원장 "), user("b", "admin", ["math"], "   "), user("c", "teacher", ["math"], null)];
    const staff = await reportStaff();
    expect(staff.map(u => [u.id, u.jobTitle])).toEqual([["a", "부원장"], ["b", null], ["c", null]]);
  });
  it("과목 범위(staffSubjectScopes)가 있으면 승인 과목은 그 범위", async () => {
    state.scopes = [{ userId: "김그린", subjects: ["math"] }]; state.approverIds = [];
    expect((await reportStaff()).find(u => u.id === "김그린")?.approvalSubjects).toEqual(["math"]);
  });
});

describe('학원 설정을 못 읽으면(접힌 기본값) 승인자를 정하지 않는다 — 요청을 막는다(리뷰 2026-11-06 2차)', () => {
  const FAIL = "승인 관리자를 확인하지 못했습니다";
  it("정상 읽기 — 김그린 영어 보고서는 정유진 승인(생략 아님)", async () => {
    state.student = studentWith(course("e1", "english", "김그린"));
    expect(await ask({ teacherIds: ["김그린"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { 김그린: ["정유진"] } })).toMatchObject({ ok: true, byTeacher: { 김그린: ["정유진"] } });
  });
  it("못 읽은 순간 — 같은 요청이 '승인 생략'으로 저장되지 않는다(거절)", async () => {
    state.folded = true; state.student = studentWith(course("e1", "english", "김그린"));
    await expect(ask({ teacherIds: ["김그린"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { 김그린: ["정유진"] } })).rejects.toThrow(FAIL);
  });
  it("못 읽은 순간 — 평강사 영어 보고서에 지정 밖 김그린을 보내도 받아들이지 않는다", async () => {
    state.folded = true; state.student = studentWith(course("e1", "english", "t"));
    await expect(ask({ teacherIds: ["t"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { t: ["김그린"] } })).rejects.toThrow(FAIL);
  });
  it("원장급은 설정을 못 읽어도 들어가지 않는다 · 작성 요청 자리의 직원 목록 조회는 멈춘다", async () => {
    state.folded = true; state.student = studentWith(course("e1", "english", "t"));
    await expect(ask({ teacherIds: ["t"], enrollmentIds: ["e1"], managerIds: [], reportManagerIds: { t: ["원일"] } })).rejects.toThrow(FAIL);
    await expect(reportStaff({ forRequest: true })).rejects.toThrow(FAIL);
  });
  it("목록·상세 자리는 설정을 못 읽어도 열린다 — 직원 목록(이름·직급)은 나오고 아무도 지정 아님 → 승인자가 나오지 않는다(3차 재리뷰)", async () => {
    state.folded = true;
    const staff = await reportStaff();
    expect(staff.map(u => u.id)).toEqual(["원일", "허은진", "정유진", "김그린", "t"]);
    expect(staff.find(u => u.id === "정유진")).toMatchObject({ name: "정유진", jobTitle: "부원장", withdrawalApprover: false });
    expect(staff.every(u => u.withdrawalApprover === false)).toBe(true);
    // 이 목록으로 승인 계획을 세우면 후보도 생략도 없다(요청 창이 막는다).
    const [p] = reportApprovalPlan(staff, [{ subject: "english", teacherId: "김그린" }], ["김그린"]);
    expect(p).toMatchObject({ skip: false, candidates: [] });
    expect(missingApproverNotice(staff, p!, true)).toBe(APPROVER_SETTINGS_UNAVAILABLE);
    // 접힌 값에 명단이 실려 있어도 믿지 않는다 — 여전히 아무도 지정 아님.
    state.folded = false; state.foldedWithList = true;
    expect((await reportStaff()).every(u => u.withdrawalApprover === false)).toBe(true);
    await expect(reportStaff({ forRequest: true })).rejects.toThrow(FAIL);
    state.foldedWithList = false;
    // 설정을 제대로 읽으면 종전대로(지정 표시가 붙는다).
    state.folded = false;
    expect((await reportStaff()).find(u => u.id === "정유진")?.withdrawalApprover).toBe(true);
  });
});
