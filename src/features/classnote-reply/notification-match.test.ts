import { describe, expect, it } from "vitest";
import { buildCommentNotificationText } from "../../../scripts/_classnote/parent-comment-filter.mjs";
import { buildNotificationText, classnotePostUrl } from "../../../scripts/_classnote/parent-post-filter.mjs";
import { attachOnlyText } from "../../../scripts/_classnote/parent-comment-filter.mjs";
import { commentIdFromClassnoteLink, commentNotificationAmbiguous, isAttachOnlyContent, notificationBodyMatches, pickMessageForNotification, postIdFromClassnoteLink, type MessageCandidate } from "./notification-match";

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

  it("같은 글에 같은 문구의 댓글이 둘이면 '모호' — 공감은 댓글 단위라 벨에서 세우지 않는다", () => {
    const thanks = { type: "classnote_parent_comment", link: classnotePostUrl(20), body: "감사합니다" };
    expect(commentNotificationAmbiguous(thanks, msgs)).toBe(true);
    expect(commentNotificationAmbiguous({ ...thanks, body: "내일 결석" }, msgs)).toBe(false);
    expect(commentNotificationAmbiguous({ type: "classnote_parent_post", link: classnotePostUrl(10), body: "새 글" }, msgs)).toBe(false);
    expect(commentNotificationAmbiguous({ ...thanks, link: classnotePostUrl(99) }, msgs)).toBe(false);
    expect(commentNotificationAmbiguous({ ...thanks, link: null }, msgs)).toBe(false);
  });

  it("못 찾으면 null — 다른 글·다른 유형·원문 없는 첨부만 댓글", () => {
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(99), body: "감사합니다" }, msgs)).toBeNull();
    expect(pickMessageForNotification({ type: "unsent_report", link: classnotePostUrl(10), body: "새 글" }, msgs)).toBeNull();
    // 첨부만 있는 댓글이 저장돼 있지 않으면(백필 전 옛 알림) 짝이 없다.
    expect(pickMessageForNotification({ type: "classnote_parent_comment", link: classnotePostUrl(20), body: "[사진 1장] (내용 없이 첨부만)" }, msgs)).toBeNull();
  });

  describe("글자 없이 첨부만 있는 글·댓글(2026-10-01)", () => {
    const att: MessageCandidate[] = [
      { id: "post", source: "post", classnotePostId: 30, classnoteCommentId: null, content: "[영상] (내용 없이 첨부만)" },
      { id: "v1", source: "comment", classnotePostId: 30, classnoteCommentId: 11, content: "[영상] (내용 없이 첨부만)" },
      { id: "ph", source: "comment", classnotePostId: 30, classnoteCommentId: 12, content: "[사진 1장] (내용 없이 첨부만)" },
    ];
    const twin: MessageCandidate[] = [...att, { id: "v2", source: "comment", classnotePostId: 30, classnoteCommentId: 15, content: "[영상] (내용 없이 첨부만)" }];
    it("워커가 저장하는 대체 원문 = 알림 본문과 같은 글자(벨 짝짓기의 전제)", () => {
      const post = { id: 1, content: "", attached_video: { id: 9 } };
      expect(attachOnlyText(post)).toBe("[영상] (내용 없이 첨부만)");
      expect(attachOnlyText(post)).toBe(buildNotificationText(post, "홍길동").body);
      const photo = { id: 2, content: "  ", attached_images: [{}], emoticon_content: null };
      expect(attachOnlyText(photo)).toBe(buildCommentNotificationText(photo, "홍길동").body);
      expect(attachOnlyText({ id: 3, content: "숙제 올립니다", attached_video: { id: 9 } })).toBeNull(); // 글자가 있으면 대체 원문 없음
      expect(attachOnlyText({ id: 4, content: "" })).toBeNull(); // 첨부도 없으면 저장하지 않는다
    });
    it("워커 링크(`?comment=`)의 댓글 번호로 정확히 짝짓는다 — 같은 문구여도 모호하지 않다", () => {
      const n = { type: "classnote_parent_comment", link: classnotePostUrl(30, undefined, 11), body: "[영상] (내용 없이 첨부만)" };
      expect(commentIdFromClassnoteLink(n.link)).toBe(11);
      expect(postIdFromClassnoteLink(n.link)).toBe(30);
      expect(pickMessageForNotification(n, twin)).toBe("v1");
      expect(pickMessageForNotification({ ...n, link: classnotePostUrl(30, undefined, 15) }, twin)).toBe("v2");
      expect(commentNotificationAmbiguous(n, twin)).toBe(false);
      // 번호는 있는데 그 댓글이 저장돼 있지 않으면 본문으로 엉뚱한 댓글을 집지 않는다.
      expect(pickMessageForNotification({ ...n, link: classnotePostUrl(30, undefined, 99) }, twin)).toBeNull();
    });
    it("번호 없는 옛 알림 — 같은 글의 첨부만 댓글이 하나면 짝, 표시가 다르면 다른 댓글, 둘 이상이면 모호", () => {
      const old = (body: string) => ({ type: "classnote_parent_comment", link: classnotePostUrl(30), body });
      expect(pickMessageForNotification(old("[영상] (내용 없이 첨부만)"), att)).toBe("v1");
      expect(pickMessageForNotification(old("[사진 1장] (내용 없이 첨부만)"), att)).toBe("ph");
      expect(commentNotificationAmbiguous(old("[영상] (내용 없이 첨부만)"), att)).toBe(false);
      expect(commentNotificationAmbiguous(old("[영상] (내용 없이 첨부만)"), twin)).toBe(true); // 공감은 벨에서 숨김(답글은 같은 글이라 무해)
      expect(pickMessageForNotification(old("[영상] (내용 없이 첨부만)"), twin)).toBe("v2"); // 최근 댓글
    });
    it("🔴 옛 알림은 알림 **뒤에** 쓴 댓글과 짝짓지 않는다 — 옛 댓글은 저장 전이라 없고, 뒤에 온 같은 표시의 댓글에 공감이 눌리면 안 된다", () => {
      const later: MessageCandidate[] = [{ id: "y", source: "comment", classnotePostId: 30, classnoteCommentId: 20, content: "[영상] (내용 없이 첨부만)", postedAt: "2026-10-01T12:00:00Z" }];
      const old = { type: "classnote_parent_comment", link: classnotePostUrl(30), body: "[영상] (내용 없이 첨부만)", createdAt: "2026-10-01T09:00:00Z" };
      expect(pickMessageForNotification(old, later)).toBeNull();
      expect(commentNotificationAmbiguous(old, later)).toBe(false);
      // 그 알림 전에 쓴 댓글(백필로 저장)이면 짝 — 알림 시각·댓글 시각 중 하나라도 모르면 종전처럼 본다.
      expect(pickMessageForNotification({ ...old, createdAt: "2026-10-01T12:00:30Z" }, later)).toBe("y");
      expect(pickMessageForNotification({ ...old, createdAt: null }, later)).toBe("y");
      // 둘 다 알림 전이면 모호(공감 숨김), 하나가 알림 뒤면 모호하지 않다.
      const two: MessageCandidate[] = [...later, { id: "x", source: "comment", classnotePostId: 30, classnoteCommentId: 19, content: "[영상] (내용 없이 첨부만)", postedAt: "2026-10-01T08:00:00Z" }];
      expect(commentNotificationAmbiguous(old, two)).toBe(false);
      expect(pickMessageForNotification(old, two)).toBe("x");
      expect(commentNotificationAmbiguous({ ...old, createdAt: "2026-10-01T13:00:00Z" }, two)).toBe(true);
    });
    it("글 알림 = 그 글 행(첨부만이어도) · 같은 글자를 흉내 낸 일반 문장과 헷갈리지 않는다", () => {
      expect(pickMessageForNotification({ type: "classnote_parent_post", link: classnotePostUrl(30), body: "[영상] (내용 없이 첨부만)" }, att)).toBe("post");
      expect(isAttachOnlyContent("[영상] (내용 없이 첨부만)")).toBe(true);
      expect(isAttachOnlyContent("영상 숙제 올렸어요")).toBe(false);
      expect(notificationBodyMatches("영상 숙제 올렸어요", "[영상] (내용 없이 첨부만)")).toBe(false);
    });
  });
});
