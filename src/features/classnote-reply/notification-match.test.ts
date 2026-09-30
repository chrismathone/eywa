import { describe, expect, it } from "vitest";
import { buildCommentNotificationText } from "../../../scripts/_classnote/parent-comment-filter.mjs";
import { buildNotificationText, classnotePostUrl } from "../../../scripts/_classnote/parent-post-filter.mjs";
import { notificationBodyMatches, pickMessageForNotification, postIdFromClassnoteLink, type MessageCandidate } from "./notification-match";

describe("벨 알림 → 학부모 메시지 원문", () => {
  it("링크에서 글 번호(워커 classnotePostUrl과 같은 모양)", () => {
    expect(postIdFromClassnoteLink(classnotePostUrl(123456))).toBe(123456);
    expect(postIdFromClassnoteLink("https://www.classnote.com/service/report/77?x=1")).toBe(77);
    expect(postIdFromClassnoteLink("/students/1")).toBeNull();
    expect(postIdFromClassnoteLink(null)).toBeNull();
  });

  it("알림 본문 = 워커가 원문에서 만든 것(첨부 표시·공백 접기·200자 자르기)", () => {
    const content = "내일  결석합니다\n죄송해요";
    const { body } = buildCommentNotificationText({ id: 1, content, attached_images: [{}] }, "학원이");
    expect(notificationBodyMatches(body, content)).toBe(true);
    const long = "가".repeat(250);
    expect(notificationBodyMatches(buildNotificationText({ content: long }, "학원이").body, long)).toBe(true);
    expect(notificationBodyMatches(buildNotificationText({ content: long }, "학원이").body, "가".repeat(201))).toBe(true); // 앞 200자가 같으면 같은 말
    expect(notificationBodyMatches(body, "다른 말")).toBe(false);
    expect(notificationBodyMatches("학부모님이 댓글을 남겼습니다", "")).toBe(false);
  });

  const msgs: MessageCandidate[] = [
    { id: "p", source: "post", classnotePostId: 10, classnoteCommentId: null, content: "새 글" },
    { id: "c1", source: "comment", classnotePostId: 20, classnoteCommentId: 1, content: "감사합니다" },
    { id: "c2", source: "comment", classnotePostId: 20, classnoteCommentId: 5, content: "감사합니다" },
    { id: "c3", source: "comment", classnotePostId: 20, classnoteCommentId: 3, content: "내일 결석" },
  ];

  it("새 글 알림 = 그 글 · 댓글 알림 = 본문이 맞는 댓글(같은 말이면 최근)", () => {
    expect(pickMessageForNotification({ type: "classnote_parent_post", link: classnotePostUrl(10), body: "새 글" }, msgs)).toBe("p");
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(20), body: "감사합니다" }, msgs)).toBe("c2");
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(20), body: "내일 결석" }, msgs)).toBe("c3");
  });

  it("못 찾으면 null — 다른 글·다른 유형·원문 없는 첨부만 댓글", () => {
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(99), body: "감사합니다" }, msgs)).toBeNull();
    expect(pickMessageForNotification({ type: "unsent_report", link: classnotePostUrl(10), body: "새 글" }, msgs)).toBeNull();
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(20), body: "[사진 1장] (내용 없이 첨부만)" }, msgs)).toBeNull();
  });
});
