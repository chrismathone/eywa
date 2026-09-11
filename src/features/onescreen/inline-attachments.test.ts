import { describe, expect, it } from "vitest";
import { attachmentMarker, attachmentNameOfLine } from "@/features/report-templates/image-slots";
import { pickInlineAttachments, uniqueAttachmentName } from "./attachment-utils";

const A = (name: string, path = `p/${name}`) => ({ name, path });

describe("pickInlineAttachments — 글 속 자리 줄이 가리키는 첨부", () => {
  it("이름이 글자까지 같은 **첫** 첨부만 · 없는 이름은 빠진다", () => {
    const list = [A("a.jpg", "p1"), A("a.jpg", "p2"), A("b.pdf")];
    const m = pickInlineAttachments("가\n[첨부: a.jpg]\n[첨부: c.jpg]\n[첨부: b.pdf]", list);
    expect([...m.keys()]).toEqual(["a.jpg", "b.pdf"]);
    expect(m.get("a.jpg")?.path).toBe("p1");
  });

  it("자리 줄이 없으면 빈 지도 · 문장 속 표식은 자리가 아니다", () => {
    expect(pickInlineAttachments("가나다", [A("a.jpg")]).size).toBe(0);
    expect(pickInlineAttachments("사진 [첨부: a.jpg] 참고", [A("a.jpg")]).size).toBe(0);
  });
});

describe("uniqueAttachmentName — 자리 줄이 가리킬 겹치지 않는 이름", () => {
  it("겹치면 확장자 앞에 (2)·(3)", () => {
    expect(uniqueAttachmentName("image.jpg", [])).toBe("image.jpg");
    expect(uniqueAttachmentName("image.jpg", ["image.jpg"])).toBe("image (2).jpg");
    expect(uniqueAttachmentName("image.jpg", ["image.jpg", "image (2).jpg"])).toBe("image (3).jpg");
    expect(uniqueAttachmentName("README", ["README"])).toBe("README (2)");
  });

  it("대괄호·줄바꿈을 다듬고, 비면 기본 이름", () => {
    expect(uniqueAttachmentName("scan[1].pdf", [])).toBe("scan(1).pdf");
    expect(uniqueAttachmentName("시험\n지.jpg", [])).toBe("시험 지.jpg");
    expect(uniqueAttachmentName("", [])).toBe("첨부");
    expect(uniqueAttachmentName("  ", ["첨부"])).toBe("첨부 (2)");
  });

  it("🔑 만든 이름은 자리 줄로 다시 읽힌다", () => {
    for (const raw of ["사진 1.jpg", "scan[1].pdf", "a:b.png", "  공백  많은   이름.webp "]) {
      const name = uniqueAttachmentName(raw, []);
      expect(attachmentNameOfLine(attachmentMarker(name))).toBe(name);
    }
  });
});
