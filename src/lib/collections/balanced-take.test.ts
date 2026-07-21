import { describe, it, expect } from "vitest";
import { balancedTake, takenPerKey } from "./balanced-take";

const sub = (x: { s: string }) => x.s;

describe("balancedTake", () => {
  it("🔴 회귀 잠금: 정렬 편향이 있어도 소수 카테고리가 전멸하지 않는다", () => {
    // 실데이터 모양 재현 — 영어반(로마자)이 앞을 독점하고 수학반(한글)이 뒤에 몰려 있다.
    const items = [
      ...Array.from({ length: 43 }, (_, i) => ({ s: "english", n: `E${i}` })),
      ...Array.from({ length: 65 }, (_, i) => ({ s: "math", n: `M${i}` })),
    ];
    // 옛 동작: 앞에서 25개 = 100% 영어.
    expect(items.slice(0, 25).every((x) => x.s === "english")).toBe(true);

    const picked = balancedTake(items, sub, 25);
    expect(picked).toHaveLength(25);
    const per = takenPerKey(picked, sub);
    expect(per.get("english")).toBe(13); // 라운드로빈이라 균등 분배(첫 그룹이 홀수분 1개 더)
    expect(per.get("math")).toBe(12);
  });

  it("남는 몫은 다른 그룹이 흡수한다 — 고정 쿼터와의 차이", () => {
    const items = [
      { s: "a", n: 1 },
      { s: "b", n: 2 },
      ...Array.from({ length: 20 }, (_, i) => ({ s: "c", n: 100 + i })),
    ];
    const picked = balancedTake(items, sub, 10);
    expect(picked).toHaveLength(10);
    const per = takenPerKey(picked, sub);
    // 고정 쿼터(10/3=3)면 a·b가 1개씩만 쓰고 4칸이 낭비된다. 라운드로빈은 c가 8개를 가져간다.
    expect(per.get("a")).toBe(1);
    expect(per.get("b")).toBe(1);
    expect(per.get("c")).toBe(8);
  });

  it("그룹 순서·그룹 내 순서는 입력 순서를 보존하고, 결과는 그룹별로 묶여 나온다", () => {
    const items = [
      { s: "x", n: "x1" },
      { s: "y", n: "y1" },
      { s: "x", n: "x2" },
      { s: "y", n: "y2" },
    ];
    expect(balancedTake(items, sub, 2).map((i) => i.n)).toEqual(["x1", "y1"]);
    expect(balancedTake(items, sub, 3).map((i) => i.n)).toEqual(["x1", "x2", "y1"]);
  });

  it("limit 이하면 전부 그대로(복사본) 반환", () => {
    const items = [{ s: "a", n: 1 }, { s: "b", n: 2 }];
    const out = balancedTake(items, sub, 5);
    expect(out).toEqual(items);
    expect(out).not.toBe(items); // 호출부가 mutate해도 원본 불변
  });

  it("경계: 빈 입력·limit 0", () => {
    expect(balancedTake([], sub, 10)).toEqual([]);
    expect(balancedTake([{ s: "a" }], sub, 0)).toEqual([]);
    expect(balancedTake([{ s: "a" }], sub, -1)).toEqual([]);
  });

  it("그룹이 1개뿐이면 단순 상위 N과 같다", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ s: "only", n: i }));
    expect(balancedTake(items, sub, 3).map((i) => i.n)).toEqual([0, 1, 2]);
  });
});
