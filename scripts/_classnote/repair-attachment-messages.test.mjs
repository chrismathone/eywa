import { describe, expect, it } from "vitest";
import { attachmentRecoveryItems } from "./repair-attachment-messages.mjs";

const post = { id: 123, child: 7, class_name: "(수학)예시", content: "", author: { type: "parent" }, attached_video: { id: 1 } };
describe("첨부 전용 원문 복구", () => {
  it("영상만 있는 학부모 글을 실제 글·원아·보드 번호 그대로 복구한다", () => {
    expect(attachmentRecoveryItems(post, [], 123)).toEqual([expect.objectContaining({ source: "post", postId: 123, childId: 7, className: "(수학)예시", content: "", attachOnly: "[영상] (내용 없이 첨부만)" })]);
  });
  it("다른 글·원아 미확정·보드 미확정은 추측해 저장하지 않는다", () => {
    for (const changed of [{ id: 124 }, { child: null }, { child: -1 }, { class_name: "" }]) expect(attachmentRecoveryItems({ ...post, ...changed }, [], 123)).toEqual([]);
  });
  it("강사 글의 첨부 댓글은 학부모가 쓴 것만 정확한 댓글 번호로 복구한다", () => {
    const comments = [{ id: 2, author: { type: "parent" }, content: "", attached_video: {} }, { id: 3, author: { type: "teacher" }, content: "", attached_video: {} }];
    expect(attachmentRecoveryItems({ ...post, author: { type: "teacher" } }, comments, 123)).toEqual([expect.objectContaining({ source: "comment", commentId: 2, postId: 123, childId: 7 })]);
  });
  it("글자 있는 옛 글은 분류 큐에 다시 넣지 않는다", () => {
    expect(attachmentRecoveryItems({ ...post, content: "결석합니다" }, [], 123)).toEqual([]);
  });
});
