import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORWARD_EVENT_OPTIONS, forwardEventLabel, sanitizeForwardEventTypes } from "./events";

/**
 * 🔴 슬랙으로 보낼 수 있는 알림 = `notifyUsers()`를 거치는 것만. 거치지 않는 알림을 목록에 올리면
 *    "골랐는데 안 온다"는 거짓 약속이 된다. 새 알림 종류가 생기면 여기서 둘 중 하나로 **결정**하게 만든다.
 */
const NOT_VIA_NOTIFY_USERS = [
  "classnote_parent_post",
  "classnote_parent_comment",
  "makeedu_login_failed",
  "report_send_failed",
  "notice_send_failed",
  "student_attendance_notice",
  "daily_briefing",
];

function allNotificationTypes(): string[] {
  const src = readFileSync(join(process.cwd(), "src/features/notifications/types.ts"), "utf8");
  const start = src.indexOf("export type NotificationType =");
  const end = src.indexOf(";", start);
  return [...src.slice(start, end).matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("슬랙 알림 종류 목록", () => {
  it("모든 알림 종류가 '보낼 수 있음' 또는 '못 보냄(직접 insert)' 중 하나로 분류돼 있다", () => {
    const all = allNotificationTypes();
    expect(all.length).toBeGreaterThan(20);
    const listed = new Set(FORWARD_EVENT_OPTIONS.map((o) => o.type as string));
    const unclassified = all.filter((t) => !listed.has(t) && !NOT_VIA_NOTIFY_USERS.includes(t));
    expect(unclassified, "새 알림 종류 — notifyUsers를 거치면 events.ts에, 아니면 이 테스트의 제외 목록에").toEqual([]);
  });

  it("직접 insert되는 알림은 목록에 없다", () => {
    const listed = new Set(FORWARD_EVENT_OPTIONS.map((o) => o.type as string));
    expect(NOT_VIA_NOTIFY_USERS.filter((t) => listed.has(t))).toEqual([]);
  });

  it("저장 전 정리 — 모르는 값·중복은 버리고 목록 순서로", () => {
    expect(sanitizeForwardEventTypes(["help_answer", "bogus", "approval_requested", "help_answer"])).toEqual([
      "approval_requested",
      "help_answer",
    ]);
    expect(forwardEventLabel("bogus")).toBe("알림");
  });
});
