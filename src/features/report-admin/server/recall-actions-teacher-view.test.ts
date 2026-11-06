// 학부모 게시글 회수 — '다른 강사 뷰'(원장 A가 강사 X 화면)에서는 담당·작성 소유 판정과 회수 명의가 X다(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  canWrite: vi.fn(),
  readonly: vi.fn(),
  owns: vi.fn(),
  log: vi.fn(),
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/onescreen/server/scope", () => ({ teacherOwnsStudent: m.owns }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({}) }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteModuleOn: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; m.updates.push(p); return q; },
        in: (col: string) => {
          // 읽기: .select(...).in("id", ids) 가 곧 결과 · 쓰기: .update().in().in().select() 끝에서 결과
          if (!patch && col === "id") return Promise.resolve({ data: m.rows, error: null });
          return q;
        },
      };
      q.select = () => (patch ? Promise.resolve({ data: m.rows.map((r) => ({ id: r.id })), error: null }) : q);
      return q;
    },
  }),
}));

import { requestReportRecall } from "./recall-actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "김선생" };

beforeEach(() => {
  vi.clearAllMocks();
  m.updates = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.canWrite.mockResolvedValue(false); // 권한표의 A 역할 줄은 X 값(강사: 수업보고서 none)으로 덮여 있다
  m.readonly.mockResolvedValue(null);
  m.owns.mockResolvedValue(true);
});

describe("회수 — 강사뷰 신원", () => {
  it("🔴 담당 판정은 대상 X의 id로 한다(A의 id면 X의 학생이 '담당 아님'으로 막힌다) · revoked_by = X", async () => {
    m.rows = [{ id: "r1", student_id: "s1", report_date: "2026-11-05", classnote_status: "success", share_token: "tok", makeup: false, class_id: "c1", created_by: "x1", teacher_name: "김선생", students: { name: "학생" } }];
    const r = await requestReportRecall(["r1"]);
    expect(r).toMatchObject({ ok: true, recalled: 1 });
    expect(m.owns).toHaveBeenCalledWith(expect.anything(), "x1", "s1", "2026-11-05");
    expect(m.updates[0]).toMatchObject({ revoked_by: "x1" });
  });

  it("🔴 보강(반 없음) 보고서는 X가 쓴 것이면 회수된다 — 작성 소유 판정이 X의 id·이름", async () => {
    m.rows = [{ id: "r2", student_id: "s2", report_date: "2026-11-05", classnote_status: "success", share_token: "tok2", makeup: true, class_id: null, created_by: "x1", teacher_name: "김선생", students: { name: "보강생" } }];
    const r = await requestReportRecall(["r2"]);
    expect(r).toMatchObject({ ok: true, recalled: 1 });
    expect(m.owns).not.toHaveBeenCalled();
  });

  it("A가 쓴 보강은 X 화면에서 'X의 것'이 아니다(실제 계정의 소유로 열리지 않는다)", async () => {
    m.rows = [{ id: "r3", student_id: "s3", report_date: "2026-11-05", classnote_status: "success", share_token: "tok3", makeup: true, class_id: null, created_by: "a1", teacher_name: "원장", students: { name: "학생" } }];
    const r = await requestReportRecall(["r3"]);
    expect(r).toMatchObject({ ok: false, forbidden: 1 });
    expect(m.updates).toEqual([]);
  });

  it("읽기 강사뷰는 맨 앞에서 거절한다", async () => {
    m.readonly.mockResolvedValue("다른 강사 화면은 열람 전용입니다");
    expect(await requestReportRecall(["r1"])).toEqual({ ok: false, error: "다른 강사 화면은 열람 전용입니다" });
    expect(m.updates).toEqual([]);
  });
});
