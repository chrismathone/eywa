import { describe, expect, it } from "vitest";
import { incomingVideo } from "./video-inbox.mjs";
const post = { id: 20, child: 30, cls: 40, class_name: "(수학)학생", author: { type: "parent" }, attached_video: { id: 50 } };
describe("[영상] 글·댓글 보관 대상", () => {
  it("텍스트가 없고 영상 변환이 끝나지 않아도 영상 ID를 큐에 남긴다", () => {
    expect(incomingVideo(post, 10)).toMatchObject({ videoId: "50", childId: "30", sources: [], commentId: null });
  });
  it("댓글 ID와 원글의 학생·반 번호를 분리한다", () => {
    expect(incomingVideo({ ...post, id: 60 }, 10, post)).toMatchObject({ postId: "20", commentId: "60", childId: "30", boardId: "40" });
  });
  it("[영상]이라는 텍스트만 쓰거나 강사가 올린 영상은 제외한다", () => {
    expect(incomingVideo({ ...post, attached_video: null, content: "[영상]" }, 10)).toBeNull();
    expect(incomingVideo({ ...post, author: { type: "teacher" } }, 10)).toBeNull();
  });
});
