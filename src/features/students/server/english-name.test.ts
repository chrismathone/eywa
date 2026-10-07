import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), access: vi.fn(), canRead: vi.fn(), scope: vi.fn(), session: vi.fn(), save: vi.fn(), log: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.access, canAccessTenant: m.canRead }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.session }));
vi.mock("./english-name-store", () => ({ saveEnglishName: m.save }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("./read-scope", () => ({ READ_GRACE_DAYS: 60, teacherClassScopeStrict: m.scope }));
import { updateStudentEnglishName } from "./english-name";

const id = "11111111-2222-4333-8444-555555555555";
const input = { studentId: id, englishName: "  Lucy  ", previousEnglishName: null };
function query(result: object) {
  const q = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), update: vi.fn(),
    or: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
  };
  for (const method of [q.select, q.eq, q.in, q.is, q.update]) method.mockReturnValue(q);
  return q;
}
let enrollments: ReturnType<typeof query>;
let student: ReturnType<typeof query>;
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "teacher", tenantId: "branch", systemRole: "teacher" });
  m.access.mockResolvedValue("full"); m.canRead.mockResolvedValue(true);
  m.scope.mockResolvedValue({ own: ["own"], slots: [{ classId: "slot" }], delegated: ["delegated"] });
  enrollments = query({ count: 1, error: null });
  student = query({ data: { id, name: "김학생", english_name: null }, error: null });
  m.session.mockResolvedValue({ from: vi.fn((table) => table === "students" ? student : enrollments) });
  m.save.mockResolvedValue("saved");
});

describe("학생 영문 이름 전용 저장", () => {
  it.each(["none", "readonly"])("전용 권한 %s이면 학생 전체 수정 권한과 무관하게 거절", async (level) => {
    m.access.mockResolvedValue(level);
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "denied" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("로그인 없이 저장할 수 없다", async () => {
    m.user.mockResolvedValue(null);
    expect((await updateStudentEnglishName(input)).ok).toBe(false);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("영어 시트 접근이 없으면 저장하지 않는다", async () => {
    m.canRead.mockResolvedValue(false);
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "denied" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("강사의 담당 범위와 지점을 확인하고 영문 이름 한 필드만 갱신한다", async () => {
    expect(await updateStudentEnglishName({ ...input, status: "withdrawn" } as typeof input)).toEqual({ ok: true, englishName: "Lucy" });
    expect(m.access).toHaveBeenCalledWith("teacher", "student_english_name");
    expect(enrollments.in).toHaveBeenCalledWith("class_id", ["own", "slot", "delegated"]);
    expect(enrollments.eq).toHaveBeenCalledWith("student_id", id);
    expect(student.eq).toHaveBeenCalledWith("tenant_id", "branch");
    expect(m.save).toHaveBeenCalledWith({ tenantId: "branch", studentId: id, englishName: "Lucy", previousEnglishName: null });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { studentId: id, before: null, after: "Lucy" } }));
  });
  it("담당 밖 학생을 거절한다", async () => {
    enrollments.or.mockResolvedValue({ count: 0, error: null });
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "denied" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("담당 범위 조회 오류를 권한 허용으로 처리하지 않는다", async () => {
    m.scope.mockRejectedValue(new Error("unavailable"));
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "failed" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("수강 조회 오류 시에도 저장하지 않는다", async () => {
    enrollments.or.mockResolvedValue({ count: null, error: { message: "offline" } });
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "failed" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("현재 지점에 없는 학생은 저장하지 않는다", async () => {
    student.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "missing" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("먼저 바뀐 이름을 덮어쓰지 않는다", async () => {
    student.maybeSingle.mockResolvedValue({ data: { id, english_name: "Elsa" }, error: null });
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "conflict" });
    expect(m.save).not.toHaveBeenCalled();
  });
  it("조회 직후의 경쟁 수정도 저장 조건으로 보호한다", async () => {
    m.save.mockResolvedValue("conflict");
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "conflict" });
    expect(m.log).not.toHaveBeenCalled();
  });
  it("영문 이름 지우기는 null로 저장한다", async () => {
    student.maybeSingle.mockResolvedValue({ data: { id, name: "김학생", english_name: "Lucy" }, error: null });
    expect(await updateStudentEnglishName({ ...input, englishName: "  ", previousEnglishName: "Lucy" })).toEqual({ ok: true, englishName: null });
    expect(m.save).toHaveBeenCalledWith({ tenantId: "branch", studentId: id, englishName: null, previousEnglishName: "Lucy" });
  });
  it("같은 지점의 중복 이름은 오류를 반환하고 감사 로그를 남기지 않는다", async () => {
    m.save.mockResolvedValue("duplicate");
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "duplicate" });
    expect(m.log).not.toHaveBeenCalled();
  });
  it("트랜잭션 실패는 저장 성공으로 표시하지 않는다", async () => {
    m.save.mockRejectedValue(new Error("unavailable"));
    expect(await updateStudentEnglishName(input)).toEqual({ ok: false, error: "failed" });
    expect(m.log).not.toHaveBeenCalled();
  });
  it.each(["A".repeat(81), "Lucy\nKim"])("잘못된 이름은 저장하지 않는다", async (englishName) => {
    expect(await updateStudentEnglishName({ ...input, englishName })).toEqual({ ok: false, error: "invalid" });
    expect(m.save).not.toHaveBeenCalled();
  });
});
