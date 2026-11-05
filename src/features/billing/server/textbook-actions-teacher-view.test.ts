// 교재 요청 — '다른 강사 뷰'(원장 A가 강사 X 화면, 전체 권한)에서 X 명의로 저장·수정·삭제된다(원장 2026-11-05 강사뷰 전수).
// DB의 auth.uid()는 A라 세션 클라이언트는 RLS(created_by = auth.uid() 등)에 막힌다 → 강사뷰일 때만 관리 클라이언트 + tenant_id 명시.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { client: "session" | "admin"; table: string; op: string; args: unknown[] };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  canWrite: vi.fn(),
  teacherId: vi.fn(),
  viewAs: vi.fn(),
  readonly: vi.fn(),
  scope: vi.fn(),
  log: vi.fn(),
  calls: [] as Call[],
  row: null as Record<string, unknown> | null,
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
      q.single = async () => {
        if (table === "students") return { data: { name: "학생" }, error: null };
        if (op === "insert") return { data: { id: "o1" }, error: null };
        return { data: m.row, error: null };
      };
      q.then = (res: (v: unknown) => unknown) => {
        if (table === "students") return Promise.resolve({ data: [{ id: "s1", name: "학생" }], error: null }).then(res);
        if (op === "insert") return Promise.resolve({ data: [{ id: "o1", student_name: "학생" }], error: null }).then(res);
        if (op === "delete") return Promise.resolve({ data: [{ id: "o1", student_id: "s1", book_name: "책", request_date: "2026-11-05", classnote_notice_id: null }], error: null }).then(res);
        return Promise.resolve({ data: null, error: null }).then(res);
      };
      return q;
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId, viewAsTeacher: m.viewAs }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
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

import { deleteTextbookRequest, requestTextbook } from "./textbook-actions";
import { saveMyTextbookMent } from "./textbook-notice-actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "김선생" };

const writes = () => m.calls.filter((c) => c.table === "textbook_orders" && ["insert", "update", "delete"].includes(c.op));
const tenantScoped = (table: string) =>
  m.calls.filter((c) => c.table === table && c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === "t1").length;

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.canWrite.mockResolvedValue(true);
  m.teacherId.mockResolvedValue("x1");
  m.viewAs.mockResolvedValue({ ...X, access: "full" });
  m.readonly.mockResolvedValue(null);
  m.scope.mockResolvedValue(["s1"]);
  m.row = { created_by: "x1", registered_at: null, ordered_at: null, paid_at: null, student_id: "s1", student_name: "학생", teacher_name: "김선생", book_name: "책", book_detail: null, price: 10000, request_date: "2026-11-05", notes: null };
});

function requestForm() {
  const fd = new FormData();
  fd.append("studentId", "s1");
  fd.set("bookName", "책");
  return fd;
}

describe("교재 요청 — 강사뷰 신원", () => {
  it("🔴 새 요청은 X 명의(created_by·담임 이름 기본값) — 강사뷰라 관리 클라이언트로, 지점을 명시해 저장한다", async () => {
    const r = await requestTextbook(undefined, requestForm());
    expect(r).toMatchObject({ ok: true });
    const insert = writes().find((c) => c.op === "insert")!;
    expect(insert.client).toBe("admin");
    expect((insert.args[0] as Record<string, unknown>[])[0]).toMatchObject({ tenant_id: "t1", created_by: "x1", teacher_name: "김선생", status_by_name: "김선생" });
    expect(tenantScoped("students")).toBeGreaterThan(0);
  });

  it("강사뷰가 아니면 종전처럼 세션 클라이언트(RLS)", async () => {
    m.viewAs.mockResolvedValue(null);
    m.user.mockResolvedValue(A);
    await requestTextbook(undefined, requestForm());
    expect(writes().every((c) => c.client === "session")).toBe(true);
  });

  it("🔴 X의 요청 삭제 — 소유 판정은 X, 조회·삭제 모두 관리 클라이언트 + 지점 명시", async () => {
    const fd = new FormData();
    fd.set("id", "o1");
    expect(await deleteTextbookRequest(undefined, fd)).toEqual({ ok: true });
    const del = writes().find((c) => c.op === "delete")!;
    expect(del.client).toBe("admin");
    expect(tenantScoped("textbook_orders")).toBe(2); // 조회 1 + 삭제 1
  });

  it("A가 낸 요청은 X 화면에서 'X의 것'이 아니다 — 지우지 않는다", async () => {
    m.row = { ...m.row!, created_by: "a1", teacher_name: "원장" };
    const fd = new FormData();
    fd.set("id", "o1");
    const r = await deleteTextbookRequest(undefined, fd);
    expect(r?.error).toContain("본인이 낸 요청만");
    expect(writes()).toEqual([]);
  });

  it("쓰기 권한이 없으면(읽기 강사뷰 — canWriteTenant 캡) 아무것도 쓰지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect((await requestTextbook(undefined, requestForm()))?.error).toBe("교재 요청 권한이 없습니다");
    expect(writes()).toEqual([]);
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
