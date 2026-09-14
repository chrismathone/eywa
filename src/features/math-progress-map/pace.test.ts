import { describe, expect, it } from "vitest";
import { chapterOfPage, paceDelta, paceLabel, paceStatusOf, planVsActual } from "./pace";
import { buildSampleProgress } from "./sample";

describe("progress-map pace", () => {
  it("임계값 — +7 빠름 · −6~+6 계획대로 · −7 느림", () => {
    expect(paceStatusOf(7)).toBe("ahead");
    expect(paceStatusOf(6)).toBe("normal");
    expect(paceStatusOf(-6)).toBe("normal");
    expect(paceStatusOf(-7)).toBe("delayed");
  });

  it("라벨은 글자로도 갈린다(색만이 아니다)", () => {
    expect(paceLabel({ differenceDays: 12, status: "ahead" })).toBe("↑ 12일 빠름");
    expect(paceLabel({ differenceDays: 0, status: "normal" })).toBe("● 계획대로");
    expect(paceLabel({ differenceDays: -8, status: "delayed" })).toBe("↓ 8일 느림");
    expect(paceDelta(3)).toBe("+3일");
    expect(paceDelta(-3)).toBe("−3일");
  });

  it("샘플 — 계획 위치는 Ⅱ. 그래프, 실제는 Ⅲ. 일차함수, 약 11일 빠름", () => {
    const p = buildSampleProgress();
    const r = planVsActual(p);
    expect(r.plannedPage).toBe(41);
    expect(r.plannedChapter).toBe("Ⅱ. 좌표평면과 그래프");
    expect(r.actualPage).toBe(57);
    expect(r.actualChapter).toBe("Ⅲ. 일차함수");
    expect(r.differenceDays).toBe(11);
    expect(r.status).toBe("ahead");
  });

  it("쪽 → 대단원 — 범위 밖은 양 끝 단원으로", () => {
    const chapters = buildSampleProgress().curriculum.chapters;
    expect(chapterOfPage(chapters, 0)).toBe("Ⅰ. 기본도형");
    expect(chapterOfPage(chapters, 99)).toBe("Ⅳ. 통계");
    expect(chapterOfPage(chapters, 999)).toBe("Ⅳ. 통계");
  });

  it("목표일이 지나면 계획 쪽은 목표 쪽에서 멈춘다", () => {
    const p = buildSampleProgress();
    const r = planVsActual({ ...p, asOf: "2027-03-01" });
    expect(r.plannedPage).toBe(180);
  });

  it("계획이 비었거나 시작 전이면 판정하지 않는다 — 폭주·거짓 재촉 없음", () => {
    const p = buildSampleProgress();
    const empty = planVsActual({ ...p, plan: { ...p.plan, targetPage: p.plan.startPage } });
    expect(empty).toMatchObject({ differenceDays: 0, status: "normal", pagesPerDay: 0 });
    const before = planVsActual({ ...p, asOf: "2026-08-01", curriculum: { ...p.curriculum, currentPage: 0 } });
    expect(before).toMatchObject({ differenceDays: 0, status: "normal", plannedPage: 1 });
  });
});
