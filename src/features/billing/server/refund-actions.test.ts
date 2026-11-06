import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 환불 요청서 — '다른 강사 뷰'면 **대상 직원**이 작성자(uploaded_by)·환불완료 처리자(completedBy)다(원장 2026-11-05 강사뷰 전수).
 * 쓰기는 **세션 먼저**(실제 계정 A의 RLS — 활동 기록·환불 데스크 할 일 닫기의 행위자가 auth.uid()라서), RLS에 막힐 때만 관리 클라이언트.
 * 요청서는 restricted(계좌·환불금액)라 DB 백스톱(0170a)처럼 **사무 역할**만 쓰고 본다 — 강사뷰면 대상 X의 역할로(적대 리뷰 2026-11-05).
 */
const m = vi.hoisted(() => ({
  user: vi.fn(), canWrite: vi.fn(), viewAs: vi.fn(), calls: [] as unknown[][], log: vi.fn(),
  /** 세션 클라이언트의 쓰기 결과(RLS 흉내) — insert 에러 · update/delete 반환 행. */
  sessionInsertError: null as { code: string; message: string } | null,
  sessionRows: [{ id: "doc1" }] as unknown[],
  listRows: [] as unknown[],
  /** 퇴원보고서 연결(원장 2026-11-06) — 이어진 요청서면 데스크 담당. 기본 = 이어지지 않음. */
  link: vi.fn(),
  release: vi.fn(),
  /** 고치기 전 저장돼 있던 요청서(form_data) — 기본 = 없음. */
  existing: null as unknown,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/students/server/queries", () => ({ getStudentEnrollments: vi.fn() }));
// 퇴원보고서 쪽(이어진 요청서 · 이어서 처리)은 그쪽 시험이 본다 — 여기서는 부르는지와 판정만.
vi.mock("@/features/withdrawal-reports/server/refund-steps", () => ({ loadRefundLink: m.link }));
vi.mock("@/features/withdrawal-reports/server/release", () => ({ releaseWithdrawalRefunds: m.release }));
/** 어느 클라이언트(`via`)로 무엇을 했는지 적는다. */
const db = (via: "session" | "admin") => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let op = "select";
    const rec = (name: string) => (...args: unknown[]) => {
      if (["insert", "update", "delete"].includes(name)) op = name;
      m.calls.push([via, table, name, ...args]);
      return q;
    };
    Object.assign(q, {
      select: rec("select"), eq: rec("eq"), update: rec("update"), delete: rec("delete"), insert: rec("insert"), order: rec("order"),
      maybeSingle: async () => ({ data: m.existing, error: null }),
      single: async () =>
        via === "session" && op === "insert" && m.sessionInsertError
          ? { data: null, error: m.sessionInsertError }
          : { data: { id: "doc1" }, error: null },
      then: (resolve: (v: unknown) => unknown) => {
        if (op === "select") return Promise.resolve({ data: m.listRows, error: null }).then(resolve);
        return Promise.resolve({ data: via === "session" ? m.sessionRows : [{ id: "doc1" }], error: null }).then(resolve);
      },
    });
    return q;
  },
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db("session") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db("admin") }));
import { deleteRefundRequest, saveRefundRequest } from "./refund-actions";
import { getRefundRequestById, getRefundRequests } from "./refund-queries";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" };
const target = { id: "target", tenantId: "t1", systemRole: "accountant", displayName: "회계" };
const counselor = { id: "coun", tenantId: "t1", systemRole: "counselor", displayName: "상담실장" };
const form = () => {
  const fd = new FormData();
  fd.set("s_name", "학생");
  fd.set("res_completedDate", "2026-11-05");
  return fd;
};
const writes = () => m.calls.filter((c) => ["insert", "update", "delete"].includes(c[2] as string));
const inserted = () => writes().find((c) => c[2] === "insert" && c[0] === "admin")?.[3] ?? writes().find((c) => c[2] === "insert")?.[3];
const asTeacherView = (who: typeof target) => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? who : actual));
  m.viewAs.mockResolvedValue({ ...who, access: "full" });
};

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.canWrite.mockResolvedValue(true);
  m.sessionInsertError = null;
  m.sessionRows = [{ id: "doc1" }];
  m.listRows = [];
  m.link.mockResolvedValue(null);
  m.release.mockResolvedValue({ released: 0, blocked: 0, failed: 0 });
  m.existing = null;
});

describe("saveRefundRequest — 대상 직원 명의 · 세션 먼저", () => {
  it("🔴 강사뷰여도 A의 세션이 통과하면 세션으로 쓴다(활동 기록의 행위자가 남는다) — 작성자·완료 처리자는 X", async () => {
    asTeacherView(target);
    expect(await saveRefundRequest(undefined, form())).toMatchObject({ ok: true, id: "doc1" });
    expect(m.canWrite).toHaveBeenCalledWith("accountant", "billing");
    expect(writes().map((c) => c[0])).toEqual(["session"]);
    const row = inserted() as Record<string, unknown>;
    expect(row).toMatchObject({ tenant_id: "t1", uploaded_by: "target", restricted: true });
    expect((row.form_data as { result: { completedBy: string; completedByName: string } }).result).toMatchObject({ completedBy: "target", completedByName: "회계" });
  });

  it("🔴 A의 세션이 RLS(42501)에 막히면 그때만 관리 클라이언트로 같은 행을 다시 쓴다", async () => {
    asTeacherView(target);
    m.sessionInsertError = { code: "42501", message: "new row violates row-level security policy" };
    expect(await saveRefundRequest(undefined, form())).toMatchObject({ ok: true, id: "doc1" });
    expect(writes().map((c) => c[0])).toEqual(["session", "admin"]);
    expect(inserted()).toMatchObject({ tenant_id: "t1", uploaded_by: "target" });
  });

  it("강사뷰가 아니면 세션 클라이언트·본인 명의 그대로(막혀도 관리 클라이언트로 내려가지 않는다)", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    m.sessionInsertError = { code: "42501", message: "rls" };
    expect((await saveRefundRequest(undefined, form()))?.error).toContain("저장 실패");
    expect(writes().map((c) => c[0])).toEqual(["session"]);
    expect(inserted()).toMatchObject({ uploaded_by: "actual" });
  });

  it("대상 직원에게 수납 쓰기 권한이 없으면(읽기 강사뷰 포함) 아무것도 쓰지 않는다", async () => {
    asTeacherView(target);
    m.canWrite.mockResolvedValue(false);
    expect(await saveRefundRequest(undefined, form())).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(m.calls).toEqual([]);
  });

  it("🔴 수납 쓰기 예외가 있어도 사무 역할이 아니면(상담) restricted 요청서를 못 쓴다 — DB 백스톱(0170a)과 같은 역할 목록", async () => {
    asTeacherView(counselor);
    expect(await saveRefundRequest(undefined, form())).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(await deleteRefundRequest("doc1")).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(m.calls).toEqual([]);
  });
});

describe("deleteRefundRequest — 읽기는 강사뷰 관리 클라이언트, 지우기는 세션 먼저", () => {
  it("읽기·지우기 모두 tenant_id를 걸고, 세션이 지우면 관리 클라이언트로 내려가지 않는다", async () => {
    asTeacherView(target);
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    const tenantFilters = m.calls.filter((c) => c[2] === "eq" && c[3] === "tenant_id");
    expect(tenantFilters.map((c) => [c[0], c[4]])).toEqual([["admin", "t1"], ["session", "t1"]]);
    expect(writes().map((c) => c[0])).toEqual(["session"]);
  });

  it("🔴 세션이 RLS로 0행을 지우면(에러 없음) 관리 클라이언트로 같은 조건을 다시", async () => {
    asTeacherView(target);
    m.sessionRows = [];
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    expect(writes().map((c) => c[0])).toEqual(["session", "admin"]);
    const adminEqs = m.calls.filter((c) => c[0] === "admin" && c[2] === "eq").map((c) => c[3]);
    expect(adminEqs).toEqual(expect.arrayContaining(["tenant_id", "id", "form_type"]));
  });
});

describe("퇴원보고서에 이어진 요청서의 환불완료일자 — 담당 데스크와 원장급만(원장 2026-11-06)", () => {
  const edit = (completedDate: string) => { const fd = form(); fd.set("id", "doc1"); fd.set("res_completedDate", completedDate); return fd; };
  const desk = { id: "desk", tenantId: "t1", systemRole: "accountant", displayName: "데스크" };

  it("🔴 담당 데스크가 아닌 수납 쓰기 권한자는 넣지 못한다 — 쓰지 않고 · 사유 · 감사로그(거절) · 처리도 부르지 않는다", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크" });
    const res = await saveRefundRequest(undefined, edit("2026-11-06"));
    expect(res?.error).toContain("담당 데스크(데스크)와 원장만");
    expect(writes()).toEqual([]);
    expect(m.link).toHaveBeenCalledWith("t1", "doc1");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_complete_denied", metadata: expect.objectContaining({ documentId: "doc1", attempted: "환불완료일자 2026-11-06 입력", deskName: "데스크" }) }));
    expect(m.release).not.toHaveBeenCalled();
  });

  it("담당 데스크는 넣는다 → 기다리던 퇴원보고서를 이어서 처리(release)", async () => {
    m.user.mockResolvedValue(desk); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크" });
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
    expect(writes().map((c) => c[2])).toEqual(["update"]);
    expect(m.release).toHaveBeenCalledWith({ tenantId: "t1", documentId: "doc1", actorId: "desk" });
  });

  it("원장급은 넣는다 · 강사뷰로 남의 화면에 들어간 원장은 원장 몫이 아니다(대상 직원 기준)", async () => {
    m.user.mockResolvedValue(actual); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크" });
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
    m.calls = [];
    asTeacherView(target);
    expect((await saveRefundRequest(undefined, edit("2026-11-06")))?.error).toContain("담당 데스크");
    expect(writes()).toEqual([]);
  });

  it("🔴 원장 결정 C.3 — 같은 청구 줄에 새 퇴원 요청의 요청서가 있는 옛 요청서(취소된 요청)는 담당 데스크·원장도 완료일자를 넣지 못한다", async () => {
    m.user.mockResolvedValue(desk); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", superseded: true });
    const res = await saveRefundRequest(undefined, edit("2026-11-06"));
    expect(res?.error).toBe("같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.");
    expect(writes()).toEqual([]);
    expect(m.release).not.toHaveBeenCalled();
  });

  it("🔴 강사뷰로 담당 데스크 화면에 들어가도 실제 로그인 계정이 그 데스크·원장급이 아니면 막는다(DB 트리거 = 실제 계정 · 관리 키 재쓰기로 지나가지 않게)", async () => {
    const admin = { id: "office", tenantId: "t1", systemRole: "admin", displayName: "관리" };
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? desk : admin));
    m.viewAs.mockResolvedValue({ teacherId: "desk" });
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크" });
    const res = await saveRefundRequest(undefined, edit("2026-11-06"));
    expect(res?.error).toContain("실제 로그인한 계정이 담당 데스크(데스크)이거나 원장일 때만");
    expect(writes()).toEqual([]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_complete_denied", metadata: expect.objectContaining({ viaTeacherView: true }) }));
    expect(m.release).not.toHaveBeenCalled();
    // 실제 계정이 원장이면(강사뷰로 데스크 화면) 연다 — 행위자(데스크)와 실제 계정(원장) 둘 다 통과
    m.calls = []; m.log.mockClear();
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? desk : actual));
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
  });

  it("지우는 것도 같다(완료 해제) · 저장돼 있던 값과 같으면(다른 칸만 고침) 막지 않는다", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: null });
    m.existing = { form_data: { student: { name: "학생" }, result: { completedDate: "2026-11-05" } } };
    const res = await saveRefundRequest(undefined, edit(""));
    expect(res?.error).toContain("담당 데스크와 원장만");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_complete_denied", metadata: expect.objectContaining({ attempted: "환불완료일자 지움" }) }));
    expect(writes()).toEqual([]);
    expect(await saveRefundRequest(undefined, edit("2026-11-05"))).toMatchObject({ ok: true });
  });

  it("이어지지 않은 요청서는 종전대로 · 완료일자가 그대로면 연결을 보지도 않는다", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue(null);
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
    m.link.mockClear();
    expect(await saveRefundRequest(undefined, edit(""))).toMatchObject({ ok: true });
    expect(m.link).not.toHaveBeenCalled();
  });

  it("🔴 연결을 못 읽으면 막는다(풀리는 쪽으로 넘어가지 않는다)", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    m.link.mockRejectedValue(new Error("db down"));
    expect((await saveRefundRequest(undefined, edit("2026-11-06")))?.error).toContain("퇴원보고서 연결을 확인하지 못해");
    expect(writes()).toEqual([]);
  });

  it("요청서를 지우면 이어진 퇴원보고서를 다시 계산하게 부른다(release — 결정 안 됨으로 돌아가는지는 DB가 센다)", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    expect(m.release).toHaveBeenCalledWith({ tenantId: "t1", documentId: "doc1", actorId: "target" });
  });
});

describe("환불 요청서 조회 — 대상 X의 역할로 restricted를 거른다", () => {
  it("🔴 강사뷰 대상이 사무 역할이 아니면 목록·상세 모두 restricted = false로 좁힌다", async () => {
    asTeacherView(counselor);
    m.listRows = [];
    await getRefundRequests();
    await getRefundRequestById("doc1");
    expect(m.calls.filter((c) => c[2] === "eq" && c[3] === "restricted").map((c) => c[4])).toEqual([false, false]);
  });

  it("평소(사무 역할 본인)에는 필터를 더하지 않는다 — DB와 같은 결과", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    await getRefundRequests();
    expect(m.calls.some((c) => c[2] === "eq" && c[3] === "restricted")).toBe(false);
  });
});
