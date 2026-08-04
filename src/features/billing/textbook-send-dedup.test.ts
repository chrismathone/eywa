/**
 * 교재요청서 중복 발송 차단 — 순수 규칙 고정.
 * 틀리면 **학부모 게시판에 같은 글이 두세 번 붙는다**(ClassNote는 게시글 삭제가 앱에서 안 되므로 회수 불가).
 */
import { describe, expect, it } from "vitest";
import { partitionAlreadySent, textbookSendKey, type DedupCandidate } from "./textbook-send-dedup";

const row = (over: Partial<DedupCandidate> & { id: string }): DedupCandidate => ({
  studentId: "s1",
  studentName: "김도연",
  bookName: "가우스 중1-1 2권",
  classnoteNoticeId: null,
  ...over,
});

describe("textbookSendKey", () => {
  it("공백·대소문자 흔들림은 같은 교재로 본다", () => {
    expect(textbookSendKey("s1", "가우스  중1-1 2권")).toBe(textbookSendKey("s1", "가우스 중1-1 2권"));
    expect(textbookSendKey("s1", " RPM 중2 ")).toBe(textbookSendKey("s1", "rpm 중2"));
  });

  it("학생이 다르면 다른 키(같은 교재라도 학생별로 나가야 한다)", () => {
    expect(textbookSendKey("s1", "쎈")).not.toBe(textbookSendKey("s2", "쎈"));
  });
});

describe("partitionAlreadySent", () => {
  it("이미 나간 요청서는 거른다 — 수업보고서 success 차단과 같은 규약", () => {
    const { sendable, skipped } = partitionAlreadySent([row({ id: "a", classnoteNoticeId: "n1" })], new Set());
    expect(sendable).toHaveLength(0);
    expect(skipped[0]).toEqual({ name: "김도연", reason: "already_sent" });
  });

  it("같은 학생·같은 교재가 **다른 요청서로** 이미 나갔으면 거른다", () => {
    // 실측: `김도연 · 가우스 중1-1 2권`이 행 3개로 중복 등록돼 있었다. 행 단위 차단만으론 못 막는다.
    const sent = new Set([textbookSendKey("s1", "가우스 중1-1 2권")]);
    const { sendable, skipped } = partitionAlreadySent([row({ id: "b" })], sent);
    expect(sendable).toHaveLength(0);
    expect(skipped[0]?.reason).toBe("same_book_sent");
  });

  it("한 번의 발송 안 중복은 **첫 건만** 보낸다(결정적 — 순서 유지)", () => {
    const { sendable, skipped } = partitionAlreadySent(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })],
      new Set(),
    );
    expect(sendable.map((r) => r.id)).toEqual(["a"]);
    expect(skipped).toHaveLength(2);
    expect(skipped.every((s) => s.reason === "dup_in_batch")).toBe(true);
  });

  it("학생·교재가 다르면 전부 보낸다(정상 발송을 막지 않는다)", () => {
    const { sendable, skipped } = partitionAlreadySent(
      [row({ id: "a" }), row({ id: "b", studentId: "s2", studentName: "박지호" }), row({ id: "c", bookName: "쎈" })],
      new Set(),
    );
    expect(sendable.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(skipped).toHaveLength(0);
  });

  it("학생/교재를 모르면 중복 판정을 하지 않는다 — 막는 쪽이 아니라 보내는 쪽으로", () => {
    const { sendable } = partitionAlreadySent(
      [row({ id: "a", studentId: null }), row({ id: "b", studentId: null })],
      new Set([textbookSendKey(null, "가우스 중1-1 2권")]),
    );
    expect(sendable.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("거른 건에도 학생 이름을 실어 화면이 누가 왜 빠졌는지 말할 수 있게 한다", () => {
    const { skipped } = partitionAlreadySent(
      [row({ id: "a", studentName: null, classnoteNoticeId: "n1" })],
      new Set(),
    );
    expect(skipped[0]?.name).toBe("(학생)"); // 이름이 없어도 raw null이 화면에 뜨지 않는다
  });
});
