import { describe, expect, it } from "vitest";
import {
  categoryLabelOf,
  linkHostLabel,
  linkServiceLabel,
  nextCategoryKey,
  normalizeLinkUrl,
  SYSTEM_CATEGORY_OPTIONS,
  type DocumentCategoryOption,
} from "./categories";

const opts: DocumentCategoryOption[] = [
  ...SYSTEM_CATEGORY_OPTIONS,
  { key: "cat_1", label: "기출시험", isSystem: false },
];

describe("categoryLabelOf", () => {
  it("학원장이 추가한 분류의 이름을 그대로 쓴다", () => {
    expect(categoryLabelOf(opts, "cat_1")).toBe("기출시험");
  });

  it("삭제된 분류의 잔여 키도 raw로 새지 않는다 — 화면엔 한글만", () => {
    // UI에 raw 코드 노출 금지: 목록에도 시스템 사전에도 없는 키는 '미분류'로 접힌다.
    expect(categoryLabelOf(opts, "cat_99")).toBe("미분류");
  });

  it("목록에서 빠진 시스템 키는 시스템 라벨로 폴백한다", () => {
    expect(categoryLabelOf([], "hr")).toBe("인사·직원");
  });
});

describe("nextCategoryKey", () => {
  it("cat_ 접두사를 붙여 연동 폴더(textbooks·quotes)·시스템 키와 절대 안 겹치게 한다", () => {
    // 겹치면 같은 ?cat= 네임스페이스에서 연동 분기가 먼저 이겨 엉뚱한 폴더가 열린다.
    const key = nextCategoryKey(SYSTEM_CATEGORY_OPTIONS.map((o) => o.key));
    expect(key.startsWith("cat_")).toBe(true);
    expect(["textbooks", "quotes", ...SYSTEM_CATEGORY_OPTIONS.map((o) => o.key)]).not.toContain(key);
  });

  it("이미 쓰는 키는 건너뛴다(삭제 후 재추가에도 충돌 없음)", () => {
    const existing = ["other", "cat_1", "cat_2", "cat_3"];
    expect(existing).not.toContain(nextCategoryKey(existing));
  });
});

describe("normalizeLinkUrl", () => {
  it("스킴이 없으면 https를 붙인다", () => {
    expect(normalizeLinkUrl("drive.google.com/drive/folders/abc")).toEqual({
      url: "https://drive.google.com/drive/folders/abc",
    });
  });

  it("http/https는 그대로 통과", () => {
    expect(normalizeLinkUrl("https://docs.google.com/document/d/abc/edit")).toEqual({
      url: "https://docs.google.com/document/d/abc/edit",
    });
    expect(normalizeLinkUrl("  http://example.com/a  ")).toEqual({ url: "http://example.com/a" });
  });

  it("javascript:·data: 등 위험 스킴은 거부 — 목록의 링크는 클릭 가능한 앵커가 된다(저장형 XSS 차단)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///C:/secret.txt",
      "vbscript:msgbox(1)",
    ]) {
      const res = normalizeLinkUrl(bad);
      expect("error" in res, `${bad} 는 거부돼야 한다`).toBe(true);
    }
  });

  it("빈 값·주소 아닌 문자열은 거부", () => {
    expect("error" in normalizeLinkUrl("")).toBe(true);
    expect("error" in normalizeLinkUrl("   ")).toBe(true);
    expect("error" in normalizeLinkUrl("그냥 메모")).toBe(true);
    expect("error" in normalizeLinkUrl("localhost")).toBe(true); // 점 없는 호스트
  });
});

describe("linkServiceLabel", () => {
  it("구글 계열은 문서 종류까지 구분한다", () => {
    expect(linkServiceLabel("https://drive.google.com/drive/folders/x")).toBe("구글 드라이브");
    expect(linkServiceLabel("https://docs.google.com/document/d/x/edit")).toBe("구글 문서");
    expect(linkServiceLabel("https://docs.google.com/spreadsheets/d/x/edit")).toBe("구글 시트");
    expect(linkServiceLabel("https://docs.google.com/presentation/d/x")).toBe("구글 슬라이드");
    expect(linkServiceLabel("https://docs.google.com/forms/d/x")).toBe("구글 폼");
  });

  it("모르는 사이트는 '웹 링크', 값이 없으면 '링크' — 호스트명을 유형 칸에 흘리지 않는다", () => {
    expect(linkServiceLabel("https://some-random-site.co.kr/a")).toBe("웹 링크");
    expect(linkServiceLabel(null)).toBe("링크");
    expect(linkServiceLabel("깨진값")).toBe("링크");
  });
});

describe("linkHostLabel", () => {
  it("www를 떼고 호스트만 보여준다", () => {
    expect(linkHostLabel("https://www.notion.so/abc")).toBe("notion.so");
    expect(linkHostLabel("https://drive.google.com/x")).toBe("drive.google.com");
    expect(linkHostLabel("깨진값")).toBe("");
  });
});
