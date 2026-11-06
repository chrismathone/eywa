// 교재 요청 — '다른 강사 뷰'(원장 A가 강사 X 화면, 전체 권한)에서 X 명의로 저장·수정·삭제된다(원장 2026-11-05 강사뷰 전수).
// 쓰기는 세션 먼저(실제 계정 A의 RLS — 활동 기록의 행위자가 auth.uid()), RLS에 막힐 때만 관리 클라이언트(teacher-view-db.ts).
// 관리 클라이언트·A의 세션은 DB 규칙(0168a·0174a)을 X 기준으로 보지 않으므로 앱이 X 기준으로 다시 본다(적대 리뷰 2026-11-05).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { client: "session" | "admin"; table: string; op: string; args: unknown[] };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  canWrite: vi.fn(),
  canAccess: vi.fn(),
  teacherId: vi.fn(),
  viewAs: vi.fn(),
  readonly: vi.fn(),
  scope: vi.fn(),
  log: vi.fn(),
  calls: [] as Call[],
  row: null as Record<string, unknown> | null,
  /** 세션 쓰기의 RLS 흉내 — insert 에러 · update/delete 반환 행. */
  sessionInsertError: { code: "42501", message: "new row violates row-level security policy" } as { code: string; message: string } | null,
  sessionMutateRows: [{ id: "o1", student_id: "s1", book_name: "책", request_date: "2026-11-05", classnote_notice_id: null }] as unknown[],
}));

function client(kind: "session" | "admin") {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let op = "select";
      for (const k of ["select", "eq", "in", "insert", "update", "delete", "not"]) {
        q[k] = (...args: unknown[]) => {
          if (k === "insert" || k === "update" || k === "delete") op = k;
          m.calls.push({ client: kind, table, op: k, args });
          return q;
        };
      }
      const insertResult = () =>
        kind === "session" && m.sessionInsertError ? { data: null, error: m.sessionInsertError } : null;
      q.single = async () => {
        if (table === "students") return { data: { name: "학생" }, error: null };
        if (op === "insert") return insertResult() ?? { data: { id: "o1" }, error: null };
        return { data: m.row, error: null };
      };
      q.then = (res: (v: unknown) => unknown) => {
        if (table === "students") return Promise.resolve({ data: [{ id: "s1", name: "학생" }], error: null }).then(res);
        if (op === "insert") return Promise.resolve(insertResult() ?? { data: [{ id: "o1", student_name: "학생" }], error: null }).then(res);
        if (op === "update" || op === "delete") {
          const rows = kind === "session" ? m.sessionMutateRows : [{ id: "o1", student_id: "s1", book_name: "책", request_date: "2026-11-05", classnote_notice_id: null }];
          return Promise.resolve({ data: rows, error: null }).then(res);
        }
        return Promise.resolve({ data: null, error: null }).then(res);
      };
      return q;
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: m.canAccess }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId, viewAsTeacher: m.viewAs }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly, viewAsTeacher: m.viewAs }));
vi.mock("./textbook-scope", () => ({ textbookRequestStudentIds: m.scope }));
vi.mock("./textbook-notice-handover", () => ({ handOverTextbookNoticeLink: async () => null }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client("session") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client("admin") }));
// 멘트 저장(textbook-notice-actions)이 끌어오는 무거운 모듈 — 이 테스트는 가드만 본다.
vi.mock("@/features/onescreen/server/notice-actions", () => ({ sendOnescreenNotice: vi.fn() }));
vi.mock("./textbook-notice-data", () => ({
  getMyTextbookMent: vi.fn(), getNoticeAttachmentWorkerGate: vi.fn(), getStudentBoardSubjects: vi.fn(),
  loadNoticeOwners: vi.fn(), loadScopedOrders: vi.fn(),
}));

import { deleteTextbookOrder, deleteTextbookRequest, requestTextbook, toggleTextbookCheck, updateTextbookOrder } from "./textbook-actions";
import { saveMyTextbookMent } from "./textbook-notice-actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "김선생" };

const writes = () => m.calls.filter((c) => c.table === "textbook_orders" && ["insert", "update", "delete"].includes(c.op));
const tenantScoped = (table: string, client?: "session" | "admin") =>
  m.calls.filter((c) => c.table === table && c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === "t1" && (!client || c.client === client)).length;

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.canWrite.mockResolvedValue(true);
  m.canAccess.mockResolvedValue(true);
  m.teacherId.mockResolvedValue("x1");
  m.viewAs.mockResolvedValue({ ...X, access: "full" });
  m.readonly.mockResolvedValue(null);
  m.scope.mockResolvedValue(["s1"]);
  m.sessionInsertError = { code: "42501", message: "new row violates row-level security policy" };
  m.sessionMutateRows = [{ id: "o1", student_id: "s1", book_name: "책", request_date: "2026-11-05", classnote_notice_id: null }];
  m.row = { created_by: "x1", registered_at: null, ordered_at: null, paid_at: null, student_id: "s1", student_name: "학생", teacher_name: "김선생", book_name: "책", book_detail: null, price: 10000, request_date: "2026-11-05", notes: null };
});

function requestForm() {
  const fd = new FormData();
  fd.append("studentId", "s1");
  fd.set("bookName", "책");
  return fd;
}
function idForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("id", "o1");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("교재 요청 — 강사뷰 신원 · 세션 먼저", () => {
  it("🔴 새 요청은 X 명의(created_by·담임 이름 기본값) — 세션은 0168a(created_by = auth.uid())에 막혀 관리 클라이언트로 다시 쓴다", async () => {
    const r = await requestTextbook(undefined, requestForm());
    expect(r).toMatchObject({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session", "admin"]);
    const insert = writes().find((c) => c.client === "admin")!;
    expect((insert.args[0] as Record<string, unknown>[])[0]).toMatchObject({ tenant_id: "t1", created_by: "x1", teacher_name: "김선생", status_by_name: "김선생" });
    expect(tenantScoped("students")).toBeGreaterThan(0);
  });

  it("강사뷰가 아니면 세션 클라이언트(RLS) 그대로 — 막혀도 관리 클라이언트로 내려가지 않는다", async () => {
    m.viewAs.mockResolvedValue(null);
    m.user.mockResolvedValue(A);
    m.sessionInsertError = null;
    await requestTextbook(undefined, requestForm());
    expect(writes().every((c) => c.client === "session")).toBe(true);
  });

  it("🔴 X의 요청 삭제 — 소유 판정은 X, A의 세션이 지우면 세션으로 끝난다(활동 기록의 행위자)", async () => {
    expect(await deleteTextbookRequest(undefined, idForm())).toEqual({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session"]);
    expect(tenantScoped("textbook_orders", "admin")).toBe(1); // 조회(강사뷰 관리 클라이언트)
    expect(tenantScoped("textbook_orders", "session")).toBe(1); // 삭제
  });

  it("🔴 A의 세션이 0174a로 0행을 지우면 관리 클라이언트로 같은 조건을 다시", async () => {
    m.sessionMutateRows = [];
    expect(await deleteTextbookRequest(undefined, idForm())).toEqual({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session", "admin"]);
    expect(tenantScoped("textbook_orders", "admin")).toBe(2); // 조회 + 다시 쓴 삭제
  });

  it("A가 낸 요청은 X 화면에서 'X의 것'이 아니다 — 지우지 않는다", async () => {
    m.row = { ...m.row!, created_by: "a1", teacher_name: "원장" };
    const r = await deleteTextbookRequest(undefined, idForm());
    expect(r?.error).toContain("본인이 낸 요청만");
    expect(writes()).toEqual([]);
  });

  it("쓰기 권한이 없으면(읽기 강사뷰 — canWriteTenant 캡) 아무것도 쓰지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect((await requestTextbook(undefined, requestForm()))?.error).toBe("교재 요청 권한이 없습니다");
    expect(writes()).toEqual([]);
  });
});

describe("교재 사무 처리 — DB 규칙(0174a)을 대상 X 기준으로", () => {
  it("🔴 X(강사 + 수납 쓰기 예외)는 남의 강사 요청의 교재 주문을 고치지 못한다 — 수정·체크·삭제 모두", async () => {
    m.row = { ...m.row!, teacher_name: "박선생", created_by: "p1" };
    expect((await updateTextbookOrder(undefined, idForm({ bookName: "바뀐책", teacherName: "박선생" })))?.error).toContain("본인이 낸 요청만");
    expect((await toggleTextbookCheck(undefined, idForm({ field: "paid", checked: "true" })))?.error).toContain("본인이 낸 요청만");
    expect((await deleteTextbookOrder(undefined, idForm()))?.error).toContain("본인이 낸 요청만");
    expect(writes()).toEqual([]);
  });

  it("🔴 이름으로만 본인 것인 요청(created_by 없음)의 담임 이름을 남의 것으로 바꾸는 수정은 막는다(WITH CHECK와 같은 뜻)", async () => {
    m.row = { ...m.row!, created_by: null };
    expect((await updateTextbookOrder(undefined, idForm({ bookName: "책", teacherName: "박선생" })))?.error).toContain("본인이 낸 요청만");
    expect(writes()).toEqual([]);
  });

  it("🔴 교재 요청 메뉴 접근이 없으면(auth_textbook_can_use) 사무 처리도 못 한다", async () => {
    m.canAccess.mockResolvedValue(false);
    expect((await toggleTextbookCheck(undefined, idForm({ field: "paid", checked: "true" })))?.error).toBe("교재 요청 권한이 없습니다");
    expect(writes()).toEqual([]);
  });

  it("본인 요청은 처리된다 — 세션 먼저", async () => {
    expect(await toggleTextbookCheck(undefined, idForm({ field: "paid", checked: "true" }))).toEqual({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session"]);
  });

  it("X가 강사가 아니면(사무 역할) 소유 규칙은 걸지 않는다 — DB도 강사에게만 건다", async () => {
    const office = { ...X, systemRole: "accountant", displayName: "회계" };
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? office : A));
    m.viewAs.mockResolvedValue({ ...office, access: "full" });
    m.row = { ...m.row!, teacher_name: "박선생", created_by: "p1" };
    expect(await toggleTextbookCheck(undefined, idForm({ field: "paid", checked: "true" }))).toEqual({ ok: true });
  });

  it("강사뷰가 아니면 앱이 따로 보지 않는다(DB가 로그인 계정으로 본다)", async () => {
    m.viewAs.mockResolvedValue(null);
    m.user.mockResolvedValue(X);
    m.row = { ...m.row!, teacher_name: "박선생", created_by: "p1" };
    expect(await toggleTextbookCheck(undefined, idForm({ field: "paid", checked: "true" }))).toEqual({ ok: true });
    expect(m.canAccess).not.toHaveBeenCalled();
  });
});

describe("교재 안내 멘트 저장 — 관리 클라이언트 쓰기의 읽기 강사뷰 가드", () => {
  it("🔴 열람 전용 강사뷰면 X의 멘트를 바꾸지 않는다", async () => {
    m.readonly.mockResolvedValue("다른 강사 화면은 열람 전용입니다");
    expect(await saveMyTextbookMent("안녕하세요")).toEqual({ ok: false });
    expect(m.calls.filter((c) => c.table === "users")).toEqual([]);
  });

  it("전체 강사뷰면 X의 멘트로 저장(본인 행·지점 명시)", async () => {
    expect(await saveMyTextbookMent("안녕하세요")).toEqual({ ok: true });
    const eqs = m.calls.filter((c) => c.table === "users" && c.op === "eq").map((c) => c.args);
    expect(eqs).toEqual([["id", "x1"], ["tenant_id", "t1"]]);
  });
});
