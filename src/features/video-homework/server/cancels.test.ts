/**
 * 장부에서 취소한 영상 숙제의 기록(0431a `video_homework_cancels`, 원장 2026-10-16 *"약점은 수정해"*) —
 * 원스크린 세션 초안이 쥔 옛 '있음'이 취소한 숙제를 되살리지 않게 하는 판정 셋.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/features/video-submit/server/fake-db.test-util";

vi.mock("server-only", () => ({}));
import { cancelledAfterSeen, getVideoHomeworkCancels, isCancelledHomework } from "./cancels";

const C = "c1", S = "s1", D = "2026-10-06";
const key = { classId: C, studentId: S, date: D };
const cancel = (at = "2026-10-16T05:00:00Z") => ({ tenant_id: "t", class_id: C, student_id: S, homework_date: D, cancelled_at: at });

describe("장부 취소 기록", () => {
  it("원스크린 첫 화면 — 그날 취소 기록을 `학생|날짜|반`으로 · 표가 없는 DB(SQL 적용 전)는 빈 지도(종전 동작)", async () => {
    const db = createFakeDb({ video_homework_cancels: [cancel(), { ...cancel(), homework_date: "2026-10-05" }] });
    expect([...(await getVideoHomeworkCancels(db as never, "t", [S], D))]).toEqual([[`${S}|${D}|${C}`, "2026-10-16T05:00:00Z"]]);
    const missing = createFakeDb({});
    missing.dropTable("video_homework_cancels");
    expect((await getVideoHomeworkCancels(missing as never, "t", [S], D)).size).toBe(0);
  });

  it("화면이 취소를 모른 채 보낸 '있음' = 값을 맞춘 시각이 취소보다 이르다(시각을 안 보낸 옛 화면도 모른 것) · 기록이 없으면 아니다", async () => {
    const db = createFakeDb({ video_homework_cancels: [cancel()] });
    expect(await cancelledAfterSeen(db as never, "t", key, "2026-10-16T04:59:00Z")).toBe(true);
    expect(await cancelledAfterSeen(db as never, "t", key, null)).toBe(true);
    expect(await cancelledAfterSeen(db as never, "t", key, "2026-10-16T05:01:00Z")).toBe(false); // 취소 뒤에 연 화면에서 다시 켰다
    expect(await cancelledAfterSeen(createFakeDb({ video_homework_cancels: [] }) as never, "t", key, null)).toBe(false);
  });

  it("취소한 뒤 다시 내지 않은 숙제 — 그날 보고서 '있음'이나 따로 낸 숙제가 다시 생겼으면 아니다", async () => {
    const base = { video_homework_cancels: [cancel()], lesson_reports: [] as Record<string, unknown>[], video_homework_extra_issues: [] as Record<string, unknown>[] };
    expect(await isCancelledHomework(createFakeDb(base) as never, "t", key)).toBe(true);
    const reissued = { ...base, lesson_reports: [{ tenant_id: "t", class_id: C, student_id: S, report_date: D, video_homework: true, id: "r" }] };
    expect(await isCancelledHomework(createFakeDb(reissued) as never, "t", key)).toBe(false);
    const issued = { ...base, video_homework_extra_issues: [{ tenant_id: "t", class_id: C, student_id: S, homework_date: D }] };
    expect(await isCancelledHomework(createFakeDb(issued) as never, "t", key)).toBe(false);
    expect(await isCancelledHomework(createFakeDb({ ...base, video_homework_cancels: [] }) as never, "t", key)).toBe(false);
  });
});
