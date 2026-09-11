import { describe, expect, it } from "vitest";
import { IJW_SHAPES } from "./contract";
import { jjSampleFor } from "./sample";
import { kstMd, periodDays } from "./sheet-model";

describe("jjSampleFor — 템플릿 미리보기 예시 자료", () => {
  it("받을 때와 같은 엄격 검사를 지난다(실제 결과지 부품이 그대로 그린다)", () => {
    const s = jjSampleFor("2026-09-11");
    expect(IJW_SHAPES.examResult.parse(s.exam)).toEqual(s.exam);
    expect(IJW_SHAPES.study.parse(s.study)).toEqual(s.study);
  });

  it("숫자가 서로 맞는다 — 합계·학습한 날·30일·정답", () => {
    const { study, exam } = jjSampleFor("2026-09-11");
    expect(study.daily.reduce((a, d) => a + d.answers, 0)).toBe(study.totals.answers);
    expect(study.daily.reduce((a, d) => a + d.correct, 0)).toBe(study.totals.correct);
    expect(study.daily.filter((d) => d.answers > 0).length).toBe(study.totals.activeDays);
    expect(study.byDeck.reduce((a, d) => a + d.answers, 0)).toBe(study.totals.answers);
    expect(study.byPos.reduce((a, d) => a + d.answers, 0)).toBe(study.totals.answers);
    expect(periodDays(study.from, study.to)).toBe(30);
    expect(study.to).toBe("2026-09-11");
    expect(study.daily.at(-1)?.day).toBe("2026-09-11");
    expect(kstMd(exam.submittedAt)).toBe("9/11");
    expect(kstMd(study.exams[0]!.submittedAt)).toBe("9/11");
    expect(exam.byPos.reduce((a, p) => a + p.correct, 0)).toBe(exam.correct);
    expect(exam.byPos.reduce((a, p) => a + p.total, 0)).toBe(exam.total);
    expect(exam.total - exam.correct).toBe(exam.wrong.length);
  });

  it("날짜가 바뀌면 기간도 따라간다 · 못 읽으면 고정 날짜", () => {
    expect(jjSampleFor("2026-12-01").study.from).toBe("2026-11-02");
    expect(jjSampleFor("아무거나").study.to).toBe("2026-09-11");
  });
});
