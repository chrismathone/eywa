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
  /** 그 요청서를 다시 읽을 때의 오류(리뷰 r2 D-8). */
  existingError: null as { message: string } | null,
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
      select: rec("select"), eq: rec("eq"), update: rec("update"), delete: rec("delete"), insert: rec("insert"), order: rec("order"), range: rec("range"), // range = 목록이 fetchAllPaged로 읽는다(수정 계획 P1-M 3c)
      maybeSingle: async () => ({ data: m.existing, error: m.existingError }),
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
  m.existingError = null;
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
    // 원문 대신 한글(42501 = 권한, explainDbError — P1-E)
    expect((await saveRefundRequest(undefined, form()))?.error).toBe("이 작업을 할 권한이 없습니다 — 계정 권한을 확인해 주세요");
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
    // 이어진 요청서는 고치는 것 자체가 담당 데스크·원장만(원장 결정 2026-11-09 · 리뷰 r2 I6) — 완료일자 입력보다 먼저 막힌다.
    expect(res?.error).toContain("고치는 것은 담당 데스크(데스크)와 원장만");
    expect(writes()).toEqual([]);
    expect(m.link).toHaveBeenCalledWith("t1", "doc1");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ documentId: "doc1", attempted: "요청서 수정", deskName: "데스크" }) }));
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
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ viaTeacherView: true }) }));
    expect(m.release).not.toHaveBeenCalled();
    // 실제 계정이 원장이면(강사뷰로 데스크 화면) 연다 — 행위자(데스크)와 실제 계정(원장) 둘 다 통과
    m.calls = []; m.log.mockClear();
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? desk : actual));
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
  });

  it("🔴 담당 아닌 사람은 다른 칸만 고쳐도 막는다 · 완료일자 비우기는 원장만(담당 데스크도 못 비운다 — 리뷰 r2 B1·D-13)", async () => {
    m.existing = { form_data: { student: { name: "학생" }, result: { completedDate: "2026-11-05" } } };
    m.link.mockResolvedValue({ deskId: "desk", deskName: null });
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    expect((await saveRefundRequest(undefined, edit("2026-11-05")))?.error).toContain("고치는 것은 담당 데스크와 원장만");
    expect(writes()).toEqual([]);
    // 담당 데스크 — 완료일자를 지우려 하면 원장만
    m.user.mockResolvedValue(desk); m.log.mockClear();
    m.link.mockResolvedValue({ deskId: "desk", deskName: null, deskActive: true });
    expect((await saveRefundRequest(undefined, edit("")))?.error).toBe("이어진 환불 요청서의 환불완료일자를 비우는 것은 원장만 할 수 있습니다(요청서의 환불 완료 표시가 사라집니다).");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_complete_denied", metadata: expect.objectContaining({ attempted: "환불완료일자 지움" }) }));
    expect(writes()).toEqual([]);
    // 원장은 비운다
    m.user.mockResolvedValue(actual);
    expect(await saveRefundRequest(undefined, edit(""))).toMatchObject({ ok: true });
    // 퇴사한 담당 데스크는 고치지 못한다(DB 트리거와 같다)
    m.calls = [];
    m.user.mockResolvedValue(desk);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", deskActive: false });
    // 퇴사한 사람 이름을 할 수 있는 사람으로 적지 않는다(리뷰 r3 R2-m7)
    expect((await saveRefundRequest(undefined, edit("2026-11-05")))?.error).toContain("고치는 것은 원장만(담당 데스크 퇴사)");
    expect(writes()).toEqual([]);
  });

  it("🔴 환불완료일자 꼴 — 빈칸 또는 YYYY-MM-DD만(리뷰 r3 R-9 · DB 트리거와 같다 — '확인 중' 같은 글이 완료로 읽혀 데스크 대기가 풀렸다)", async () => {
    m.user.mockResolvedValue(desk); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", deskActive: true });
    for (const bad of ["확인 중", "2026.11.09", "11/09"]) {
      m.calls = []; m.log.mockClear();
      expect((await saveRefundRequest(undefined, edit(bad)))?.error, bad).toBe("환불완료일자는 날짜(예: 2026-11-09)로 넣어 주세요.");
      expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ reason: "날짜 꼴 아님" }) }));
      expect(writes()).toEqual([]);
      expect(m.release).not.toHaveBeenCalled();
    }
    expect(await saveRefundRequest(undefined, edit("2026-11-09"))).toMatchObject({ ok: true });
  });

  it("🔴 상한(원장 승인 줄 낸 돈 합) — 넘는 총 환불금액은 막는다 · 상한을 모르면 금액 칸을 바꾸는 저장만 막고 완료일자는 받는다(리뷰 r2 I6)", async () => {
    m.user.mockResolvedValue(desk); m.viewAs.mockResolvedValue(null);
    m.existing = { form_data: { student: { name: "학생" }, refund: { totalAmount: "100,000원", paymentDetails: "결제" }, result: { completedDate: "" } } };
    const amount = (total: string, payment = "결제", done = "") => { const fd = edit(done); fd.set("r_totalAmount", total); fd.set("r_paymentDetails", payment); return fd; };
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", deskActive: true, cap: 100000, capLines: 1 });
    expect(await saveRefundRequest(undefined, amount("90,000원"))).toMatchObject({ ok: true });
    m.calls = [];
    expect((await saveRefundRequest(undefined, amount("100,001원")))?.error).toBe("총 환불금액 100,001원이 원장이 승인한 줄의 낸 돈 합계 100,000원(상한)을 넘습니다.");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ reason: "상한 100,000원" }) }));
    expect(writes()).toEqual([]);
    // 상한 모름(옛 연결 · paid_net 없음) — 금액 칸 변경은 막고 · 같은 금액에 완료일자만 넣는 것은 받는다(막으면 그 묶음이 영원히 기다린다)
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", deskActive: true, cap: null, capLines: 0 });
    expect((await saveRefundRequest(undefined, amount("1원")))?.error).toContain("상한)을 알 수 없어");
    expect((await saveRefundRequest(undefined, amount("100,000원", "고친 결제")))?.error).toContain("상한)을 알 수 없어");
    expect(await saveRefundRequest(undefined, amount("100,000원", "결제", "2026-11-09"))).toMatchObject({ ok: true });
  });

  it("🔴 요청서를 다시 읽지 못하면 저장하지 않는다(리뷰 r2 D-8 — 완료 처리자가 이번 저장자로 바뀌던 길)", async () => {
    m.user.mockResolvedValue(actual); m.viewAs.mockResolvedValue(null);
    m.existingError = { message: "timeout" };
    expect((await saveRefundRequest(undefined, edit("2026-11-06")))?.error).toBe("요청서를 다시 불러오지 못해 저장하지 않았습니다. 잠시 후 다시 시도해 주세요.");
    expect(writes()).toEqual([]);
  });

  it("이어지지 않은 요청서는 종전대로(수납 쓰기 권한이면 된다) — 연결은 늘 본다(고치기 잠금)", async () => {
    m.user.mockResolvedValue(target); m.viewAs.mockResolvedValue(null);
    m.link.mockResolvedValue(null);
    expect(await saveRefundRequest(undefined, edit("2026-11-06"))).toMatchObject({ ok: true });
    expect(await saveRefundRequest(undefined, edit(""))).toMatchObject({ ok: true });
    expect(m.link).toHaveBeenCalledTimes(2);
  });

  it("🔴 이어진 요청서 지우기(리뷰 r2 B1) — 완료된 것은 누구도 · 미완료는 담당 데스크·원장만 · 0행 삭제는 실패로", async () => {
    m.viewAs.mockResolvedValue(null);
    m.existing = { title: "환불", form_data: { student: { name: "학생" }, result: { completedDate: "2026-11-05" } } };
    m.link.mockResolvedValue({ deskId: "desk", deskName: "데스크", deskActive: true });
    m.user.mockResolvedValue(actual);
    // 🔴 '완료일자를 비우고 지우라'고 안내하지 않는다(리뷰 r3 R2-I2 — 이미 돌려준 돈까지 다시 담긴다) · 늘어난 몫은 '따로 환불'
    expect((await deleteRefundRequest("doc1")).error).toBe("환불완료일자가 들어간(돈을 돌려준) 이어진 환불 요청서는 지울 수 없습니다. 그 뒤 늘어난 몫은 따로 환불로 처리합니다(수납의 일반 환불 요청서).");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ attempted: "요청서 삭제", reason: "환불완료일자 있음" }) }));
    m.existing = { title: "환불", form_data: { student: { name: "학생" }, result: { completedDate: "" } } };
    m.user.mockResolvedValue(target);
    expect((await deleteRefundRequest("doc1")).error).toContain("지우는 것은 담당 데스크(데스크)와 원장만");
    expect(writes()).toEqual([]);
    m.user.mockResolvedValue(desk);
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    expect(m.release).toHaveBeenCalledWith({ tenantId: "t1", documentId: "doc1", actorId: "desk" });
    // 세션이 0행을 지웠고 강사뷰가 아니면(관리 키로 내려가지 않음) 실패 — 지운 것으로 알고 다시 승인하지 않게
    m.sessionRows = [];
    expect((await deleteRefundRequest("doc1")).error).toBe("지워지지 않았습니다 — 이 요청서를 지울 권한이 없거나 이미 지워졌습니다.");
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

  it("상세 조회가 실패하면 '없는 요청서'(null)로 돌리지 않고 던진다(수정 계획 P1-M 3c)", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    m.existingError = { message: "db down" };
    await expect(getRefundRequestById("doc1")).rejects.toThrow("환불 요청서를 불러오지 못했습니다");
  });

  it("평소(사무 역할 본인)에는 필터를 더하지 않는다 — DB와 같은 결과", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    await getRefundRequests();
    expect(m.calls.some((c) => c[2] === "eq" && c[3] === "restricted")).toBe(false);
  });
});
