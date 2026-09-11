import { describe, expect, it } from "vitest";
import {
  attachmentLineIndex,
  carryAttachmentLines,
  hasTextBesidesAttachments,
  insertAttachmentLine,
  removeAttachmentLines,
  withoutAttachmentLines,
} from "./attachment-lines";

describe("attachmentLineIndex · insertAttachmentLine · withoutAttachmentLines", () => {
  const TEXT = "가나다\n\n라마바\n사아";

  it("커서가 줄 가운데·끝이면 그 줄 다음, 줄 맨 앞·빈 줄이면 그 줄 앞 — 모르면 글 끝", () => {
    expect(attachmentLineIndex(TEXT, 1)).toBe(1);
    expect(attachmentLineIndex(TEXT, 3)).toBe(1);
    expect(attachmentLineIndex(TEXT, 4)).toBe(1);
    expect(attachmentLineIndex(TEXT, 5)).toBe(2);
    expect(attachmentLineIndex(TEXT, null)).toBe(4);
    expect(attachmentLineIndex(TEXT, 999)).toBe(4);
    expect(attachmentLineIndex("", 0)).toBe(0);
  });

  it("🔑 끼우고 빼면 글자 하나 다르지 않다", () => {
    const withA = insertAttachmentLine(TEXT, attachmentLineIndex(TEXT, 3), "a.jpg");
    expect(withA).toBe("가나다\n[첨부: a.jpg]\n\n라마바\n사아");
    expect(withoutAttachmentLines(withA)).toBe(TEXT);
    expect(removeAttachmentLines(withA, "a.jpg")).toBe(TEXT);
    expect(removeAttachmentLines(withA, "b.jpg")).toBe(withA);
  });

  it("빈 글이면 그 줄 하나 · 범위 밖이면 가장자리", () => {
    expect(insertAttachmentLine("", 0, "a.jpg")).toBe("[첨부: a.jpg]");
    expect(insertAttachmentLine(TEXT, 99, "a.jpg")).toBe(`${TEXT}\n[첨부: a.jpg]`);
    expect(insertAttachmentLine(TEXT, -3, "a.jpg")).toBe(`[첨부: a.jpg]\n${TEXT}`);
  });

  it("첨부 줄이 없으면 받은 글 그대로(CRLF도)", () => {
    expect(withoutAttachmentLines("가\r\n나")).toBe("가\r\n나");
    expect(withoutAttachmentLines(null)).toBe("");
  });

  it("사진만 있는 글은 '글 없음'", () => {
    expect(hasTextBesidesAttachments("[첨부: a.jpg]")).toBe(false);
    expect(hasTextBesidesAttachments("\n[첨부: a.jpg]\n  \n")).toBe(false);
    expect(hasTextBesidesAttachments("가\n[첨부: a.jpg]")).toBe(true);
    expect(hasTextBesidesAttachments(null)).toBe(false);
  });
});

describe("carryAttachmentLines — 다시 짠 글에 강사가 둔 사진 자리를 옮겨 심는다", () => {
  const OLD = "안녕하세요\n\n📍 진도\nUnit 3\n\n테스트 : 18개 맞음\n\n💌 코멘트\n잘했어요";

  it("바로 위 글 줄을 새 글에서 찾아 그 아래로", () => {
    const prev = insertAttachmentLine(OLD, 4, "시험지.jpg");
    const next = OLD.replace("18개", "15개");
    expect(carryAttachmentLines(prev, next)).toBe(insertAttachmentLine(next, 4, "시험지.jpg"));
  });

  it("위 글 줄이 바뀌었으면 아래 글 줄로 · 둘 다 없으면 같은 줄 번호(넘으면 글 끝)", () => {
    const prev = insertAttachmentLine(OLD, 6, "a.pdf");
    const next = OLD.replace("18개", "15개");
    expect(carryAttachmentLines(prev, next)).toBe(insertAttachmentLine(next, 6, "a.pdf"));
    expect(carryAttachmentLines(prev, "짧은 글")).toBe("짧은 글\n[첨부: a.pdf]");
  });

  it("🔴 빈 줄 **다음**에 둔 자리는 저장해도 빈 줄 위로 올라가지 않는다", () => {
    const prev = "A\n\n[첨부: x.jpg]\nB";
    expect(carryAttachmentLines(prev, "A\n\nB")).toBe(prev);
    expect(carryAttachmentLines(prev, "A2\n\nB")).toBe("A2\n\n[첨부: x.jpg]\nB");
    expect(carryAttachmentLines("A\n[첨부: x.jpg]\n\nB", "A\n\nB")).toBe("A\n[첨부: x.jpg]\n\nB");
  });

  it("같은 자리 여러 장은 옛 순서 그대로 · 새 글에 이미 있는 이름은 한 번만", () => {
    const prev = insertAttachmentLine(insertAttachmentLine(OLD, 4, "a.jpg"), 5, "b.jpg");
    expect(carryAttachmentLines(prev, OLD)).toBe(prev);
    const already = insertAttachmentLine(OLD, 0, "a.jpg");
    expect(carryAttachmentLines(prev, already)).toBe(insertAttachmentLine(already, 5, "b.jpg"));
  });

  it("글 맨 앞 첨부 줄(위 글 줄 없음)은 아래 글 줄 → 같은 줄 번호", () => {
    expect(carryAttachmentLines(insertAttachmentLine(OLD, 0, "a.jpg"), "새 글\n둘째")).toBe("[첨부: a.jpg]\n새 글\n둘째");
    expect(carryAttachmentLines(insertAttachmentLine(OLD, 0, "a.jpg"), `머리\n${OLD}`)).toBe(
      insertAttachmentLine(`머리\n${OLD}`, 1, "a.jpg"),
    );
  });

  it("`only` — 방금 올린 한 줄만(올리는 동안 강사가 쓰거나 지운 것은 건드리지 않는다)", () => {
    const placed = insertAttachmentLine("첫 줄\n둘째 줄", 1, "x.jpg");
    expect(carryAttachmentLines(placed, "새로 쓴 줄\n첫 줄\n둘째 줄", { only: "x.jpg" })).toBe(
      "새로 쓴 줄\n첫 줄\n[첨부: x.jpg]\n둘째 줄",
    );
    expect(carryAttachmentLines("가\n[첨부: a.jpg]\n나\n[첨부: b.jpg]", "가\n나", { only: "b.jpg" })).toBe(
      "가\n나\n[첨부: b.jpg]",
    );
    expect(carryAttachmentLines("[첨부: x.jpg]", "", { only: "x.jpg" })).toBe("[첨부: x.jpg]");
  });

  it("사진부터 넣은 빈 행에 나중에 글을 짜면 사진은 글 **끝**으로(인사말 위가 아니다) · 여러 장이면 옛 순서", () => {
    expect(carryAttachmentLines("[첨부: x.jpg]", "안녕하세요\n본문")).toBe("안녕하세요\n본문\n[첨부: x.jpg]");
    // 두 번째 사진도 빈 행에 이어 넣고(글 줄이 없어 끝으로) → 자동작성 뒤에도 두 장이 순서대로 끝에.
    const two = carryAttachmentLines(insertAttachmentLine("[첨부: a.jpg]", 1, "b.jpg"), "[첨부: a.jpg]", { only: "b.jpg" });
    expect(two).toBe("[첨부: a.jpg]\n[첨부: b.jpg]");
    expect(carryAttachmentLines(two, "안녕하세요")).toBe("안녕하세요\n[첨부: a.jpg]\n[첨부: b.jpg]");
  });

  it("옛 글에 첨부 줄이 없으면 새 글 그대로 · 결과에서 첨부 줄을 빼면 늘 새 글", () => {
    expect(carryAttachmentLines(OLD, "새 글")).toBe("새 글");
    const prev = insertAttachmentLine(insertAttachmentLine(OLD, 9, "z.pdf"), 2, "a.jpg");
    const next = `${OLD}\n추가 문단`;
    expect(withoutAttachmentLines(carryAttachmentLines(prev, next))).toBe(next);
  });
});
