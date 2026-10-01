import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ParentMessage } from "./reply-data";
import { classnoteLinkForHomeroom } from "./classnote-link";

const mock = vi.hoisted(() => ({ board: vi.fn(), student: vi.fn() }));
vi.mock("./reply-data", () => ({ resolveBoard: mock.board, confirmedStudentOf: mock.student }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-10-02" }));
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let failed: boolean;
const db = { from: (table: string) => {
  const filters: ((r: Row) => boolean)[] = [];
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { filters.push((r) => r[key] === value); return q; },
    in: (key: string, values: unknown[]) => { filters.push((r) => values.includes(r[key])); return q; },
    order: () => q,
    range: () => q,
    then: (resolve: (v: unknown) => unknown) => {
      const data = (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data, count: data.length, error: failed ? new Error("offline") : null }).then(resolve);
    },
  };
  return q;
} } as unknown as ReturnType<typeof createAdminClient>;
const user = { id: "homeroom", tenantId: "t", systemRole: "teacher" } as CurrentUser;
const message: ParentMessage = { id: "m", source: "post", classnotePostId: 123, classnoteCommentId: null, childId: 1, studentId: "s", boardName: "(수학)학생", content: "안녕하세요", postedAt: null };
beforeEach(() => {
  failed = false;
  mock.board.mockResolvedValue({ keys: ["math", "subject_1"], classId: null });
  mock.student.mockResolvedValue({ studentId: "s" });
  rows = {
    enrollments: [{ id: "e", tenant_id: "t", student_id: "s", class_id: "c", start_date: "2026-09-01", end_date: null, is_transferred: false }],
    classes: [{ id: "c", tenant_id: "t", subject: "math", is_active: true, teacher_id: "homeroom" }],
  };
});
it("현재 수강·같은 과목의 실제 담임에게만 원문 주소를 제공한다", async () => {
  expect(await classnoteLinkForHomeroom(db, user, message)).toBe("https://www.classnote.com/service/report/123");
  expect(await classnoteLinkForHomeroom(db, user, { ...message, source: "comment", classnoteCommentId: 7 })).toMatch(/123\?comment=7$/);
});
it.each(["teacher", "master", "admin", "manager"])("%s 직급도 실제 담임 배정이 없으면 이동하지 못한다", async (role) => {
  expect(await classnoteLinkForHomeroom(db, { ...user, id: "other", systemRole: role } as CurrentUser, message)).toBeNull();
});
it.each([
  { teacher_id: null }, { subject: "english" }, { is_active: false }, { tenant_id: "other" },
])("잘못된 반 배정은 제외한다: %j", async (patch) => {
  Object.assign(rows.classes[0], patch);
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
});
it.each([
  { start_date: "2026-10-03" }, { end_date: "2026-10-01" },
  { end_date: "2026-10-02", is_transferred: true }, { tenant_id: "other" }, { student_id: "other" },
])("오늘 수강하지 않는 반은 제외한다: %j", async (patch) => {
  Object.assign(rows.enrollments[0], patch);
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
});
it("퇴원 예약 수강은 종료 전까지 현재 담임이다", async () => {
  rows.enrollments[0].end_date = "2026-11-01";
  expect(await classnoteLinkForHomeroom(db, user, message)).not.toBeNull();
});
it("반 보드는 연결된 바로 그 반 담임만 허용한다", async () => {
  mock.board.mockResolvedValue({ keys: ["math"], classId: "c" });
  expect(await classnoteLinkForHomeroom(db, user, message)).not.toBeNull();
  mock.board.mockResolvedValue({ keys: ["math"], classId: "different" });
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
});
it("원아 연결 불일치·조회 실패·과목 미확정이면 버튼을 숨긴다", async () => {
  mock.student.mockResolvedValue({ studentId: "other" });
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
  mock.student.mockResolvedValue({ studentId: "s" });
  failed = true;
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
  mock.board.mockResolvedValue({ keys: [], classId: null });
  expect(await classnoteLinkForHomeroom(db, user, message)).toBeNull();
});
