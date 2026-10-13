import { describe, expect, it } from "vitest";
import { firstCompletedAt, type ChecklistArea } from "./checklist";

/** 처음 완료 시각 — 직원 포트폴리오가 한 평가를 그 달에 한 번만 세는 근거. */
const areas: ChecklistArea[] = [{ key: "a", title: "영역", items: ["문항1", "문항2"] }];

describe("firstCompletedAt", () => {
  it("처음 다 채운 저장에서 정해지고, 다시 저장해도 바뀌지 않는다", () => {
    expect(firstCompletedAt(undefined, [4, 3], areas, "2026-09-20")).toBe("2026-09-20");
    expect(firstCompletedAt({ scores: [4, 3], submittedAt: "2026-09-20", completedAt: "2026-09-20" }, [2, 3], areas, "2026-10-05")).toBe("2026-09-20");
  });
  it("미완성으로 저장했다가 나중에 채우면 채운 때가 처음 완료 시각이다", () => {
    expect(firstCompletedAt(undefined, [4, 0], areas, "2026-09-28")).toBeUndefined();
    expect(firstCompletedAt({ scores: [4, 0], submittedAt: "2026-09-28" }, [4, 2], areas, "2026-10-03")).toBe("2026-10-03");
  });
  it("이 칸이 생기기 전에 이미 완료돼 있던 장은 그때의 제출 시각을 쓴다", () => {
    expect(firstCompletedAt({ scores: [4, 4], submittedAt: "2026-08-30" }, [3, 4], areas, "2026-10-05")).toBe("2026-08-30");
  });
});
