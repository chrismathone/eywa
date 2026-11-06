import { beforeEach, describe, expect, it, vi } from "vitest";
import { careDocumentSchema, transitionCare, type CareContent } from "../model";
import { CareAccessError } from "./errors";

const m = vi.hoisted(() => ({ access: vi.fn(), rows: vi.fn(), menu: vi.fn(), users: vi.fn(), intake: vi.fn() }));
vi.mock("./access", () => ({ careAccess: m.access }));
vi.mock("./queries", () => ({
  readStudentCareRows: m.rows,
  careRow: (r: { id: string; student_id: string; version: number; document: unknown }) => ({ id: r.id, studentId: r.student_id, version: r.version, document: careDocumentSchema.parse(r.document), updatedAt: "now" }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.menu }));
function chain(result: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "not", "neq", "order", "limit"]) q[k] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result());
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => chain(m.users) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain(m.intake) }) }));
import { getStudentCareForExplore } from "./explore";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student = uid(3);
const manager = { id: uid(1), canManage: true, canContribute: true, proxy: false };
const teacher = { id: uid(2), canManage: false, canContribute: true, proxy: false };
const at = "2026-11-01T01:00:00.000Z";
const content: CareContent = { need: "중3 선행 희망", promise: "중2 진도 완료", criterion: "단원 평가 확인", dueOn: "2026-11-30", ownerId: teacher.id, subject: "수학", sourceId: null };
const evidence = { kind: "lesson_report" as const, recordId: uid(7), note: "마지막 단원" };

beforeEach(() => {
  vi.clearAllMocks();
  m.access.mockResolvedValue({ user: { id: manager.id, tenantId: uid(9), systemRole: "master" }, readAll: true, actor: manager });
  m.menu.mockImplementation(async (_: string, key: string) => key !== "ecs" && key !== "enrollment");
  m.users.mockReturnValue({ data: [{ id: teacher.id, display_name: "담당 강사" }, { id: manager.id, display_name: "원장" }], error: null });
  m.intake.mockReturnValue({ data: null, error: null });
});

describe("연결 탐색 '약속·할 일' 경계", () => {
  it("권한 밖·표 없음·조회 실패를 서로 다른 상태로 돌려주고 0건으로 꾸미지 않는다", async () => {
    m.access.mockRejectedValueOnce(new CareAccessError("약속을 열람할 권한이 없습니다", "denied"));
    expect(await getStudentCareForExplore(student)).toMatchObject({ state: "denied", commitments: [], careHref: `/students/${student}/care` });
    m.rows.mockResolvedValueOnce({ data: null, error: { code: "PGRST205" } });
    expect((await getStudentCareForExplore(student)).state).toBe("unavailable");
    m.rows.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await getStudentCareForExplore(student)).state).toBe("error");
    m.access.mockRejectedValueOnce(new Error("조회 실패"));
    expect((await getStudentCareForExplore(student)).state).toBe("error");
    expect((await getStudentCareForExplore("not-a-uuid")).state).toBe("error");
  });

  it("진행 중 먼저 · 목표일 순 · 이번 버전의 기록만 · 메뉴를 못 여는 종류는 링크 없이", async () => {
    const open = transitionCare(transitionCare(transitionCare(null, { kind: "create", content: { ...content, dueOn: "2026-12-31" } }, manager, at), { kind: "acknowledge" }, teacher, at),
      { kind: "evidence", evidence }, teacher, at);
    const withSheet = transitionCare(open, { kind: "evidence", evidence: { kind: "english_sheet", recordId: uid(8), note: "Unit 3" } }, teacher, at);
    const done = transitionCare(transitionCare(withSheet, { kind: "revise", content: { ...content, dueOn: "2026-11-15" }, reason: "일정 변경" }, manager, at), { kind: "cancel", reason: "진학" }, manager, "2026-11-04T16:00:00.000Z");
    m.rows.mockResolvedValueOnce({ data: [
      { id: uid(11), student_id: student, version: 5, document: done },
      { id: uid(12), student_id: student, version: 3, document: withSheet },
    ], error: null });
    const view = await getStudentCareForExplore(student);
    expect(view).toMatchObject({ state: "ready", canManage: true, canContribute: true, intake: null });
    expect(view.commitments.map((c) => c.id)).toEqual([uid(12), uid(11)]);
    const [first, second] = view.commitments;
    expect(first).toMatchObject({ version: 3, revision: 1, state: "open", ownerName: "담당 강사", acknowledged: true, closedOn: null });
    expect(first.evidence.map((e) => [e.kindLabel, e.href])).toEqual([["수업보고서", `/lesson_reports/${uid(7)}/print`], ["영어 강사 시트", null]]);
    // 취소된 v2 — v1의 기록은 v2의 기록이 아니다 · 닫은 날은 한국 날짜(UTC 16시 = 다음 날).
    expect(second).toMatchObject({ state: "cancelled", revision: 2, acknowledged: false, closedOn: "2026-11-05", closedByName: "원장", evidence: [] });
  });

  it("학부모 요구는 신규 콜&상담을 열 수 있는 사람에게만 · 담당자 이름을 못 읽어도 약속은 보인다", async () => {
    m.menu.mockResolvedValue(true);
    m.intake.mockReturnValue({ data: { id: uid(20), parent_request: "중3 선행", consultation_date: "2026-08-01", created_at: "2026-08-01T01:00:00Z" }, error: null });
    m.users.mockReturnValue({ data: null, error: { message: "boom" } });
    m.rows.mockResolvedValueOnce({ data: [{ id: uid(12), student_id: student, version: 1, document: transitionCare(null, { kind: "create", content }, manager, at) }], error: null });
    const view = await getStudentCareForExplore(student);
    expect(view.intake).toEqual({ id: uid(20), title: "신규 콜&상담 · 학부모 요구", date: "2026-08-01", body: "중3 선행", href: `/enrollment/${uid(20)}` });
    expect(view.commitments[0]).toMatchObject({ ownerName: null, state: "open" });
  });
});
