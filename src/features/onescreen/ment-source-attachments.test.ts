import { describe, expect, it } from "vitest";
import { computeClientMentSource, resolveMentSource } from "./ment-source";

describe("작성 방식 — 영어 글 속 첨부 자리 줄은 문장이 아니다", () => {
  it("자동 글에 사진 줄만 넣었으면 여전히 '자동 그대로' · 문장을 고치면 '수정'", () => {
    expect(computeClientMentSource("가나다\n[첨부: a.jpg]", "가나다")).toBe("auto");
    expect(computeClientMentSource("가나다 고침\n[첨부: a.jpg]", "가나다")).toBe("auto_edited");
  });

  it("사진만 있는 글은 멘트가 없는 것 — '직접 작성'으로 치지 않는다", () => {
    expect(computeClientMentSource("[첨부: a.jpg]", "")).toBeUndefined();
    expect(resolveMentSource({ client: "manual", prevSource: null, prevNotes: null, nextNotes: "[첨부: a.jpg]" })).toBeNull();
  });

  it("서버 — 사진 줄만 더한 재저장은 기존 라벨 유지", () => {
    expect(
      resolveMentSource({ client: "manual", prevSource: "auto", prevNotes: "가나다", nextNotes: "가나다\n[첨부: a.jpg]" }),
    ).toBe("auto");
    expect(
      resolveMentSource({ client: "manual", prevSource: "auto", prevNotes: "가나다", nextNotes: "가나다라\n[첨부: a.jpg]" }),
    ).toBe("auto_edited");
  });
});
