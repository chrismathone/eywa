import { describe, expect, it } from "vitest";
import { isImageAttachment, visibleAttachments } from "./attachment-utils";

const A = (name: string) => ({ name, path: `t/report-attachments/x.${name.split(".").pop()}` });

describe("isImageAttachment", () => {
  it("이미지 확장자만 true", () => {
    expect(isImageAttachment("a.jpg")).toBe(true);
    expect(isImageAttachment("a.PNG")).toBe(true);
    expect(isImageAttachment("워크시트.xlsx")).toBe(false);
    expect(isImageAttachment("안내.pdf")).toBe(false);
    expect(isImageAttachment("확장자없음")).toBe(false);
  });
});

describe("visibleAttachments", () => {
  const list = [A("풀이.jpg"), A("워크시트.xlsx"), A("안내.pdf"), A("칠판.png")];

  it("학부모가 /r을 직접 열 때는 전부 보인다(다운로드 링크가 실제로 동작)", () => {
    expect(visibleAttachments(list, { forScreenshot: false }).map((a) => a.name)).toEqual([
      "풀이.jpg",
      "워크시트.xlsx",
      "안내.pdf",
      "칠판.png",
    ]);
  });

  it("워커 스크린샷에선 파일이 빠지고 사진만 남는다(눌리지 않는 '받기' 오해 방지 · 사진은 스샷에 크게)", () => {
    expect(visibleAttachments(list, { forScreenshot: true }).map((a) => a.name)).toEqual([
      "풀이.jpg",
      "칠판.png",
    ]);
  });

  it("파일만 첨부된 보고서는 스크린샷에서 첨부 영역이 통째로 사라진다", () => {
    expect(visibleAttachments([A("워크시트.xlsx")], { forScreenshot: true })).toEqual([]);
  });
});
