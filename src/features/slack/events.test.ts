import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORWARD_EVENT_OPTIONS, forwardEventLabel, forwardEventOptionsFor, sanitizeForwardEventTypes } from "./events";
import { SAMPLE_NOTIFICATIONS } from "./samples";

/** 🔴 알림 표의 모든 종류는 보낼 수 있다(0298a 인박스 트리거) — 빠지는 건 생성 중단된 브리핑뿐. 새 종류는 분류를 강제한다. */
const EXCLUDED = ["daily_briefing"];

function allNotificationTypes(): string[] {
  const src = readFileSync(join(process.cwd(), "src/features/notifications/types.ts"), "utf8");
  const start = src.indexOf("export type NotificationType =");
  const end = src.indexOf(";", start);
  return [...src.slice(start, end).matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("슬랙 알림 종류 목록", () => {
  it("모든 스위치가 켜진 지점은 기존 목록을 그대로 보고, 꺼진 종류만 숨긴다", () => {
    const allOn = { approvals: true, classnote: true, makeedu: true, todaysMath: true, videoReview: true };
    expect(forwardEventOptionsFor(allOn)).toEqual(FORWARD_EVENT_OPTIONS);

    const visible = forwardEventOptionsFor({ approvals: false, classnote: false, makeedu: false, todaysMath: false, videoReview: false });
    expect(visible.map((option) => option.type)).not.toEqual(expect.arrayContaining([
      "approval_requested",
      "classnote_parent_post",
      "makeedu_login_failed",
      "todays_math_exam_report",
      "video_homework_submitted",
    ]));
    expect(visible.map((option) => option.type)).toContain("attendance_complete");
  });

  it("모든 알림 종류가 목록에 있거나 명시적으로 제외돼 있다", () => {
    const all = allNotificationTypes();
    expect(all.length).toBeGreaterThan(20);
    const listed = new Set(FORWARD_EVENT_OPTIONS.map((o) => o.type as string));
    const unclassified = all.filter((t) => !listed.has(t) && !EXCLUDED.includes(t));
    expect(unclassified, "새 알림 종류 — events.ts와 samples.ts에 한 줄씩").toEqual([]);
  });

  it("제외한 종류는 목록에 없다", () => {
    const listed = new Set(FORWARD_EVENT_OPTIONS.map((o) => o.type as string));
    expect(EXCLUDED.filter((t) => listed.has(t))).toEqual([]);
  });

  it("저장 전 정리 — 모르는 값·중복은 버리고 목록 순서로", () => {
    expect(sanitizeForwardEventTypes(["help_answer", "bogus", "approval_requested", "help_answer"])).toEqual([
      "approval_requested",
      "help_answer",
    ]);
    expect(forwardEventLabel("bogus")).toBe("알림");
  });
});

describe("샘플 알림", () => {
  it("고를 수 있는 모든 알림 종류에 가상 데이터 샘플이 있다(없으면 샘플 버튼이 그 종류를 조용히 건너뛴다)", () => {
    const missing = FORWARD_EVENT_OPTIONS.filter((o) => !SAMPLE_NOTIFICATIONS[o.type]).map((o) => o.type);
    expect(missing).toEqual([]);
  });
});
