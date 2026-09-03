import { describe, expect, it } from "vitest";
import { BUILTIN_CATEGORIES } from "./category";
import {
  confirmMatchesPlan,
  deriveCategoryKey,
  planNewCategories,
  planToCategories,
  similarCategoryLabel,
} from "./category-plan";

const EXISTING = BUILTIN_CATEGORIES;

describe("키 도출 — 작은 사전 → category_N", () => {
  it("사전에 있으면 표준 키", () => {
    expect(deriveCategoryKey("헤드셋", new Set())).toBe("headset");
    expect(deriveCategoryKey(" 웹 캠 ", new Set())).toBe("webcam");
  });
  it("사전에 없으면 category_N — 빈 번호를 고른다", () => {
    expect(deriveCategoryKey("냉장고", new Set())).toBe("category_1");
    expect(deriveCategoryKey("냉장고", new Set(["category_1", "category_2"]))).toBe("category_3");
  });
  it("표준 키가 이미 쓰이고 있으면 폴백(조용히 겹치지 않는다)", () => {
    expect(deriveCategoryKey("헤드셋", new Set(["headset"]))).toBe("category_1");
  });
});

describe("비슷한 라벨 — 알리기만, 병합은 안 한다", () => {
  it("한 글자 오타를 잡는다", () => {
    expect(similarCategoryLabel("헤드셑", ["헤드셋", "노트북"])).toBe("헤드셋");
  });
  it("한쪽이 다른 쪽을 품으면 알린다", () => {
    expect(similarCategoryLabel("노트북PC", ["노트북"])).toBe("노트북");
  });
  it("정말 다른 이름은 안 걸린다", () => {
    expect(similarCategoryLabel("프로젝터", ["노트북", "모니터"])).toBeUndefined();
  });
});

describe("새 분류 계획", () => {
  it("접두를 파일의 자산ID에서 뽑는다(사람이 이미 고른 값)", () => {
    const plan = planNewCategories(
      [
        { label: "헤드셋", assetCode: "HS-001" },
        { label: "헤드셋", assetCode: "HS-002" },
      ],
      EXISTING,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ label: "헤드셋", key: "headset", codePrefix: "HS", prefixFromFile: true, rowCount: 2 });
  });
  it("못 뽑거나 이미 쓰이면 C1·C2 폴백", () => {
    const plan = planNewCategories(
      [
        { label: "냉장고", assetCode: "1234" },
        // NB는 내장 '노트북'이 이미 쓰는 접두 → 뺏지 않는다
        { label: "정수기", assetCode: "NB-050" },
      ],
      EXISTING,
    );
    expect(plan.map((p) => p.codePrefix)).toEqual(["C1", "C2"]);
    expect(plan.map((p) => p.prefixFromFile)).toEqual([false, false]);
    expect(plan.map((p) => p.key)).toEqual(["category_1", "category_2"]);
  });
  it("같은 라벨은 공백 무시로 묶고 첫 등장 순서를 지킨다", () => {
    const plan = planNewCategories(
      [
        { label: "헤드셋", assetCode: "HS-001" },
        { label: "웹캠", assetCode: "WC-001" },
        { label: "헤드 셋", assetCode: "HS-002" },
      ],
      EXISTING,
    );
    expect(plan.map((p) => p.label)).toEqual(["헤드셋", "웹캠"]);
    expect(plan[0]!.rowCount).toBe(2);
  });
  it("🔴 오탈자는 새 분류가 되지만 similarTo로 알린다(자동 병합 금지)", () => {
    const plan = planNewCategories(
      [
        { label: "헤드셋", assetCode: "HS-001" },
        { label: "헤드셑", assetCode: "HS-009" },
      ],
      EXISTING,
    );
    expect(plan).toHaveLength(2);
    // 같은 파일 안의 앞선 새 분류와도 대조한다
    expect(plan[1]!.similarTo).toBe("헤드셋");
  });
  it("이미 있는 분류(내장 7종)와 겹치는 접두·키를 뺏지 않는다", () => {
    const plan = planNewCategories([{ label: "노트북PC", assetCode: "NB-500" }], EXISTING);
    expect(plan[0]!.codePrefix).not.toBe("NB");
    expect(plan[0]!.similarTo).toBe("노트북");
  });
  it("빈 라벨은 계획에 안 들어간다", () => {
    expect(planNewCategories([{ label: "  ", assetCode: "X-1" }], EXISTING)).toEqual([]);
  });
  it("sortOrder는 기존 뒤에 붙는다(칩 자리가 안 흔들리게)", () => {
    const plan = planNewCategories(
      [
        { label: "헤드셋", assetCode: "HS-001" },
        { label: "웹캠", assetCode: "WC-001" },
      ],
      EXISTING,
    );
    expect(planToCategories(plan, EXISTING).map((c) => c.sortOrder)).toEqual([80, 90]);
  });
});

describe("🔴 서버 재검증 — 확인 목록이 계획과 정확히 같을 때만 통과([[#77]])", () => {
  const plan = planNewCategories(
    [
      { label: "헤드셋", assetCode: "HS-001" },
      { label: "웹캠", assetCode: "WC-001" },
    ],
    EXISTING,
  );
  it("같으면 통과(순서·공백은 안 본다)", () => {
    expect(confirmMatchesPlan(["웹캠", " 헤드셋 "], plan)).toBe(true);
  });
  it("빠지거나·더 있거나·비면 거절", () => {
    expect(confirmMatchesPlan(["헤드셋"], plan)).toBe(false);
    expect(confirmMatchesPlan(["헤드셋", "웹캠", "스피커"], plan)).toBe(false);
    expect(confirmMatchesPlan([], plan)).toBe(false);
  });
  it("계획이 비면 빈 확인만 통과(확인 창을 안 띄우는 경우)", () => {
    expect(confirmMatchesPlan([], [])).toBe(true);
    expect(confirmMatchesPlan(["헤드셋"], [])).toBe(false);
  });
});
