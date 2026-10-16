/**
 * 영상 숙제 취소(원장 2026-10-16 *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"*) — 보고서를 보낸 숙제도 거둔다.
 * 칸 상태는 장부와 같은 판정(`pairRounds`)으로 보고, 지우는 일은 DB 함수 한 거래(`cancel_video_homework`).
 * 🔴 그날 보고서의 영상 과제는 그 줄을 처음 쓴 선생님 것이다 — 남이 쓴 보고서면 따로 낸 표시만 지운다(적대적 리뷰 2026-10-16).
 */
import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import type { PairRoundMaterials } from "@/features/video-submit/server/site-homework";
import type { VideoArrival, VideoHomeworkMark } from "../types";

const m = vi.hoisted(() => ({
  db: null as unknown as FakeDb, denied: null as string | null, readonly: null as string | null, materials: null as unknown,
  level: "scoped", acting: null as string | null, log: vi.fn(), reconcile: vi.fn(), today: "2026-10-16",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => m.today }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "teacher", tenantId: "tenant", systemRole: "teacher" }) }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => m.readonly, effectiveTeacherId: async () => m.acting }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.level }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./mark-write", () => ({
  ledgerRoundWriteError: async () => m.denied,
  loadVideoHomeworkTarget: async () => ({ error: null, className: "수학 A", studentName: "김민준", enabled: true }),
}));
vi.mock("./reconcile-outcomes", () => ({ reconcileVideoHomework: m.reconcile }));
vi.mock("@/features/video-submit/server/site-homework", async (load) => ({
  ...(await load<typeof import("@/features/video-submit/server/site-homework")>()), loadPairRoundMaterials: async () => m.materials,
}));
import { cancelVideoHomework } from "./cancel-homework";

const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const D = "2026-10-06";
const input = { classId: C, studentId: S, homeworkDate: D };
const mark = (patch: Partial<VideoHomeworkMark>): VideoHomeworkMark => ({ classId: C, studentId: S, checkDate: "2026-10-07", homeworkDate: D, status: "missing", ...patch });
const video = (patch: Partial<VideoArrival> = {}): VideoArrival =>
  ({ id: "v1", studentId: S, classId: C, postedAt: "2026-10-07T12:00:00+09:00", playback: { preview: "p", thumbnail: "t", uploadedAt: null }, ...patch });
const materials = (extra: Partial<PairRoundMaterials> = {}): PairRoundMaterials => ({
  pairs: [{ classId: C, studentId: S }], from: D, today: m.today, assigned: new Map([[`${C}:${S}`, new Set([D])]]), marks: [], videos: [],
  rejected: new Map(), ...extra,
});
const report = (createdBy: string | null) => ({ tenant_id: "tenant", class_id: C, student_id: S, report_date: D, video_homework: true, created_by: createdBy });
const called = () => m.db.rpcCalls.filter((c) => c.name === "cancel_video_homework");
const reset = (rows: Record<string, unknown>[] = [report("teacher")], answer = "cancelled_report") => {
  m.db = createFakeDb({ lesson_reports: rows });
  m.db.defineRpc("cancel_video_homework", () => answer);
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(m, { denied: null, readonly: null, level: "scoped", acting: null, today: "2026-10-16", materials: materials() });
  reset();
});

it("내가 쓴 보고서의 미확인 숙제는 거둔다 — DB 함수 한 번(읽기 시작한 시각 · 보고서도 끈다) · 감사로그 · 응답 전에 재판정", async () => {
  expect(await cancelVideoHomework(input)).toEqual({ ok: true });
  expect(called()).toHaveLength(1);
  expect(called()[0]!.args).toEqual({ p_tenant: "tenant", p_class: C, p_student: S, p_date: D, p_legacy_check: null, p_touch_report: true,
    p_observed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_cancel", targetLabel: "김민준 · 수학 A",
    metadata: expect.objectContaining({ classId: C, studentId: S, homeworkDate: D, status: "unchecked", fromReport: true }) }));
  expect(m.reconcile).toHaveBeenCalledWith("tenant", { studentId: S });
});

it("미수행(손으로 찍은 기록 포함)도 거둔다 — 원장 '미확인이나 미제출'", async () => {
  m.materials = materials({ marks: [mark({ status: "missing", updatedAt: "2026-10-14T00:00:00Z" })] });
  expect(await cancelVideoHomework(input)).toEqual({ ok: true });
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: "missing" }) }));
});

it("보고서 없이 따로 낸 숙제만 있으면 보고서를 건드리지 않았다고 남긴다(fromReport 없음)", async () => {
  reset([], "cancelled");
  expect(await cancelVideoHomework(input)).toEqual({ ok: true });
  expect(m.log.mock.calls[0]![0].metadata).not.toHaveProperty("fromReport");
});

it("🔴 남이 쓴 보고서면(전체 권한 아님) 보고서는 그대로 · 따로 낸 표시만 — DB에 그렇게 넘기고 그 결과를 알린다", async () => {
  reset([report("other")], "kept");
  // 따로 낸 숙제가 완료여도 보고서 숙제는 그 선생님 것이라 표시만 지운다(상태 거절은 보고서를 끌 때만).
  m.materials = materials({ marks: [mark({ status: "submitted", submittedDate: "2026-10-07" })] });
  expect(await cancelVideoHomework(input)).toEqual({ ok: true, kept: true });
  expect(called()[0]!.args.p_touch_report).toBe(false);
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ keptReport: true }) }));
  // 따로 낸 표시도 없으면(남의 보고서 숙제뿐) 그 선생님이나 관리자만 거둔다고 알린다.
  reset([report("other")], "missing");
  expect(await cancelVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("그 선생님이나 관리자만") });
  // 전체 권한 · 다른 강사 편집으로 그 선생님 화면이면 보고서까지 끈다.
  for (const patch of [{ level: "full" }, { acting: "other" }]) {
    Object.assign(m, { level: "scoped", acting: null, ...patch });
    reset([report("other")]);
    m.materials = materials();
    expect(await cancelVideoHomework(input)).toEqual({ ok: true });
    expect(called()[0]!.args.p_touch_report).toBe(true);
  }
});

it("완료로 찍힌 숙제 · 영상이 붙은 숙제는 DB 함수를 부르지 않고 까닭을 말한다", async () => {
  m.materials = materials({ marks: [mark({ status: "submitted", submittedDate: "2026-10-07" })] });
  expect(await cancelVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("완료로 기록된") });
  m.materials = materials({ videos: [video({ homeworkDate: D })] });
  expect(await cancelVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("영상이 붙은") });
  expect(called()).toHaveLength(0);
  expect(m.log).not.toHaveBeenCalled();
});

it("숙제가 없는 칸 · 남의 숙제 · 열람 전용 · 미래 · 모양이 틀린 값은 쓰지 않는다", async () => {
  m.materials = materials({ assigned: new Map() });
  expect(await cancelVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("찾지 못했습니다") });
  m.materials = materials();
  m.denied = "내가 낸 숙제만 기록할 수 있습니다.";
  expect(await cancelVideoHomework(input)).toEqual({ ok: false, error: "내가 낸 숙제만 취소할 수 있습니다." });
  m.denied = null; m.readonly = "열람 전용입니다.";
  expect(await cancelVideoHomework(input)).toEqual({ ok: false, error: "열람 전용입니다." });
  m.readonly = null;
  expect(await cancelVideoHomework({ ...input, homeworkDate: "2026-10-17" })).toMatchObject({ ok: false, error: expect.stringContaining("아직 나가지") });
  expect(await cancelVideoHomework({ ...input, classId: "x" })).toMatchObject({ ok: false });
  expect(called()).toHaveLength(0);
});

it("DB가 거절하면(받는 중 · 그사이 바뀜 · 완료 · 영상) 아무것도 남기지 않고 까닭을 말한다", async () => {
  for (const [answer, words] of [["uploading", "받는 중"], ["changed", "새로고침"], ["submitted", "완료로 기록된"], ["has_video", "영상이 붙은"]] as const) {
    m.db.defineRpc("cancel_video_homework", () => answer);
    expect(await cancelVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining(words) });
  }
  expect(m.log).not.toHaveBeenCalled();
  expect(m.reconcile).not.toHaveBeenCalled();
});

it("SQL 적용 전(함수 없음)에는 쓸 수 없다고만 알린다(#95)", async () => {
  m.db = createFakeDb({ lesson_reports: [report("teacher")] });
  expect(await cancelVideoHomework(input)).toEqual({ ok: false, error: expect.stringContaining("아직 사용할 수 없는") });
});

it("그 칸에 붙은 숙제일 없는 옛 기록은 검사일을 함께 넘긴다 — 남기면 숙제가 사라진 뒤 따로 칸으로 선다", async () => {
  m.materials = materials({ marks: [mark({ homeworkDate: null, checkDate: "2026-10-08", status: "missing" })] });
  expect(await cancelVideoHomework(input)).toEqual({ ok: true });
  expect(called()[0]!.args.p_legacy_check).toBe("2026-10-08");
});
