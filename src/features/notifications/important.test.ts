import { describe, it, expect } from "vitest";
import { isImportantNotification, pickAlertTargets, mergeAlerted, ALERTED_CAP } from "./important";
import type { NotificationItem } from "./types";

const n = (over: Partial<NotificationItem> & { id: string }): NotificationItem => ({
  type: "classnote_parent_post",
  title: "학부모 새 글",
  body: null,
  link: null,
  read: false,
  createdAt: "2026-07-15T00:00:00Z",
  ...over,
});

describe("isImportantNotification", () => {
  it("학부모 새 글·발송 실패가 중요(강하게 알림)", () => {
    expect(isImportantNotification("classnote_parent_post")).toBe(true);
    // 발송 실패는 "학부모에게 안 갔는데 아무도 모르는" 상태 — 담당이 초대·재발송을 해야 끝난다(0143a).
    expect(isImportantNotification("report_send_failed")).toBe(true);
    expect(isImportantNotification("notice_send_failed")).toBe(true);
    // 나머지는 벨 배지로만 — 수업 중 중앙 팝업 방해 방지(원장 결정).
    expect(isImportantNotification("enrollment_assigned")).toBe(false);
    expect(isImportantNotification("teacher_handover")).toBe(false);
    // ⚠️ 학부모 **댓글**은 일부러 중요 아님 — 하루 ~12건(새 글의 3배)에 절반이 인사라 중앙 팝업하면 경보 피로.
    //    벨 배지로만. 이 기대를 바꾸려면 먼저 "인사성 댓글 거르기"가 있어야 한다(important.ts 주석 참조).
    expect(isImportantNotification("classnote_parent_comment")).toBe(false);
    expect(isImportantNotification(null)).toBe(false);
    expect(isImportantNotification("")).toBe(false);
  });
});

describe("pickAlertTargets", () => {
  it("안 읽음 + 중요 + 아직 안 알림만 고른다", () => {
    const items = [
      n({ id: "a" }), // 대상
      n({ id: "b", read: true }), // 읽음 → 제외
      n({ id: "c", type: "enrollment_assigned" }), // 중요 아님 → 제외
      n({ id: "d" }), // 이미 알림 → 제외
    ];
    const got = pickAlertTargets(items, new Set(["d"]));
    expect(got.map((x) => x.id)).toEqual(["a"]);
  });

  it("입력 순서(최신순)를 유지 — 호출부가 [0]을 대표로 띄운다", () => {
    const got = pickAlertTargets([n({ id: "new" }), n({ id: "old" })], new Set());
    expect(got.map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("대상 없으면 빈 배열", () => {
    expect(pickAlertTargets([n({ id: "a", read: true })], new Set())).toEqual([]);
    expect(pickAlertTargets([], new Set())).toEqual([]);
  });
});

describe("mergeAlerted", () => {
  it("새 id를 앞에 넣고 중복 제거", () => {
    expect(mergeAlerted(["b", "c"], ["a", "b"])).toEqual(["a", "b", "c"]);
  });

  it("상한을 넘으면 오래된 것부터 버린다(최신 보존)", () => {
    const prev = Array.from({ length: ALERTED_CAP }, (_, i) => `old${i}`);
    const got = mergeAlerted(prev, ["new"]);
    expect(got).toHaveLength(ALERTED_CAP);
    expect(got[0]).toBe("new");
    expect(got).not.toContain(`old${ALERTED_CAP - 1}`); // 가장 오래된 것이 밀려남
  });
});
