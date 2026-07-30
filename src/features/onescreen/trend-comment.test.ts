import { describe, it, expect } from "vitest";
import {
  buildTrendInput,
  buildTrendPrompt,
  normalizeExamInfo,
  MIN_TREND_RECORDS,
  type TrendHistoryRow,
} from "./trend-comment";

const row = (date: string, examInfo: string | null, homeworkScore: string | null): TrendHistoryRow => ({
  date,
  examInfo,
  homeworkScore,
});

describe("buildTrendInput", () => {
  it("날짜순 시험·과제 흐름을 [MM-DD] 값 -> 규격으로 조립", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "일부 미흡"),
    ]);
    expect(input).not.toBeNull();
    expect(input!.count).toBe(2);
    expect(input!.examTrend).toBe("[06-01] 일일 6/10 -> [06-08] 일일 8/10");
    expect(input!.assignTrend).toBe("[06-01] 완료 -> [06-08] 일부 미흡");
  });

  it("최근 10회만 사용(초과분은 앞에서 잘림)", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      row(`2026-06-${String(i + 1).padStart(2, "0")}`, `일일 ${i}/10`, null),
    );
    const input = buildTrendInput(many);
    expect(input!.count).toBe(10);
    // 앞 3개(01~03)는 잘리고 04부터 시작
    expect(input!.examTrend.startsWith("[06-04]")).toBe(true);
    expect(input!.examTrend.endsWith("[06-13] 일일 12/10")).toBe(true);
  });

  it("유효 데이터 < MIN_TREND_RECORDS면 null(빈데이터 창작 방지)", () => {
    expect(MIN_TREND_RECORDS).toBe(2);
    expect(buildTrendInput([row("2026-06-01", "일일 6/10", null)])).toBeNull(); // 1개뿐
    expect(buildTrendInput([row("2026-06-01", null, null), row("2026-06-08", "  ", "  ")])).toBeNull(); // 전부 공백
    expect(buildTrendInput([])).toBeNull();
  });

  it("시험만 있고 과제 전무여도 조립(과제는 '자료 없음')", () => {
    const input = buildTrendInput([row("2026-06-01", "일일 6/10", null), row("2026-06-08", "일일 8/10", null)]);
    expect(input!.examTrend).not.toBe("");
    expect(input!.assignTrend).toBe("");
  });
});

describe("buildTrendPrompt", () => {
  it("숫자 정확·전망 금지·JSON 계약·기록 주입", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "완료"),
    ])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain('{"trend": "..."}'); // 출력 계약
    expect(p).toContain("Y문제 중 X문제"); // 숫자 정확 규칙
    expect(p).toContain("전망·격려·조언·추측은 넣지 마세요");
    expect(p).toContain("[06-01] 일일 6/10 -> [06-08] 일일 8/10"); // 기록 주입
    expect(p).toContain("과제 흐름(날짜순): [06-01~06-08] 완료(2회)");
  });
});

// 2026-07-22 실측 회귀: 분모 100은 문항 수가 아니라 **100점 만점 시험 점수**인데,
// 프롬프트의 "'X/Y'는 'Y문제 중 X문제'" 규칙에 걸려 "100문제 중 88개"라는 없는 사실이 학부모에게 나갔다.
describe("normalizeExamInfo — 100점 만점 점수를 문항 수로 오독하지 않게", () => {
  it("분모 100은 점수 표기로 바뀐다", () => {
    expect(normalizeExamInfo("88/100")).toBe("88점(100점 만점)");
    expect(normalizeExamInfo("일일 96/100")).toBe("일일 96점(100점 만점)");
    expect(normalizeExamInfo("100/100")).toBe("100점(100점 만점)");
  });
  it("문항 수 분모(5·10·20…)는 그대로 둔다", () => {
    expect(normalizeExamInfo("일일 5/10")).toBe("일일 5/10");
    expect(normalizeExamInfo("일일 3/10, 확인 8/20")).toBe("일일 3/10, 확인 8/20");
    expect(normalizeExamInfo("11/15")).toBe("11/15");
  });
  it("1000·100x 같은 더 큰 분모를 오탐하지 않는다", () => {
    expect(normalizeExamInfo("50/1000")).toBe("50/1000");
    expect(normalizeExamInfo("50/1001")).toBe("50/1001");
  });
  it("혼합 기록에서 100점 만점만 골라 바꾼다", () => {
    const input = buildTrendInput([
      row("2026-06-25", "88/100", "0%"),
      row("2026-06-28", "14/21", "0%"),
    ])!;
    expect(input.examTrend).toBe("[06-25] 88점(100점 만점) -> [06-28] 14/21");
  });
  it("프롬프트가 점수/문항 구분 규칙을 담는다", () => {
    const input = buildTrendInput([row("2026-06-25", "88/100", null), row("2026-06-28", "14/21", null)])!;
    expect(buildTrendPrompt(input)).toContain("100점 만점에 X점");
  });
});

// 2026-07-22: 과제-only 행을 표본에 들이면서 생긴 잠식 위험 방어.
describe("흐름별 독립 윈도 — 과제-only 행이 시험 기록을 밀어내지 않음", () => {
  it("과제만 있는 행이 12개 앞서도 시험 기록은 전부 남는다", () => {
    const rows: TrendHistoryRow[] = [];
    for (let i = 1; i <= 12; i++) rows.push(row(`2026-06-${String(i).padStart(2, "0")}`, null, "0%"));
    rows.push(row("2026-06-20", "일일 6/10", null));
    rows.push(row("2026-06-27", "일일 8/10", null));
    const input = buildTrendInput(rows)!;
    expect(input.examTrend).toBe("[06-20] 일일 6/10 -> [06-27] 일일 8/10");
    // 과제 흐름은 최근 10개로 잘린 뒤 **연속 같은 값이 한 덩이로 묶인다**(compressRuns, 2026-07-30).
    // 예전엔 "0% -> 0% -> …" 10개가 그대로 프롬프트에 들어가 모델이 날짜를 전부 나열했다.
    expect(input.assignTrend).toBe("[06-03~06-12] 0%(10회)");
  });
  it("count는 실제 인용 날짜 수(중복 날짜 이중계상 없음)", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "완료"),
    ])!;
    expect(input.count).toBe(2);
  });
  it("과제 기록만 2회여도 추세가 생성된다(예전엔 시험 없으면 표본 부족으로 침묵)", () => {
    const input = buildTrendInput([row("2026-06-01", null, "미제출"), row("2026-06-08", null, "미제출")]);
    expect(input).not.toBeNull();
    expect(input!.examTrend).toBe("");
    expect(input!.assignTrend).toBe("[06-01~06-08] 미제출(2회)");
  });
});

// 2026-07-23 실발송 E2E에서 잡음: 이름 없는 기록(`88/100`)에 모델이 "확인테스트"라는 이름을 지어냈다.
// 이 학원은 확인테스트를 아예 쓰지 않는다(showCheckTest=false) — 학부모에게 없는 시험이 통보된다.
describe("시험 이름 환각 방지", () => {
  it("프롬프트가 이름 없는 점수에 이름을 붙이지 말라고 지시한다", () => {
    const input = buildTrendInput([
      row("2026-06-25", "88/100", null),
      row("2026-07-13", "6/10", null),
    ])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain("시험 이름을 지어내지 마세요");
    expect(p).toContain("이름 없이 점수만 있으면 '테스트'라고만 쓰세요");
  });
});
