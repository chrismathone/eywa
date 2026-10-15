import { describe, it, expect } from "vitest";
import {
  buildTrendInput,
  buildTrendPrompt,
  examOutlier,
  findTrendViolations,
  keepExamOfClass,
  normalizeExamInfo,
  trendBody,
  MIN_EXAM_TREND_POINTS,
  MIN_TREND_RECORDS,
  TREND_LAST_OUTLIER_NOTE,
  type TrendHistoryRow,
} from "./trend-comment";

const row = (date: string, examInfo: string | null, homeworkScore: string | null, classId?: string | null): TrendHistoryRow => ({
  date,
  examInfo,
  homeworkScore,
  ...(classId !== undefined ? { classId } : {}),
});

describe("buildTrendInput", () => {
  it("날짜순 시험·과제 흐름을 [MM-DD] 값 -> 규격으로 조립", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "일부 미흡"),
      row("2026-06-15", "일일 9/10", "완료"),
    ]);
    expect(input).not.toBeNull();
    expect(input!.count).toBe(3);
    expect(input!.examTrend).toBe("[06-01] 일일 6/10 -> [06-08] 일일 8/10 -> [06-15] 일일 9/10");
    expect(input!.assignTrend).toBe("[06-01] 완료 -> [06-08] 일부 미흡 -> [06-15] 완료");
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
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", null),
      row("2026-06-08", "일일 8/10", null),
      row("2026-06-15", "일일 9/10", null),
    ]);
    expect(input!.examTrend).not.toBe("");
    expect(input!.assignTrend).toBe("");
  });
});

// 원장 2026-10-15 "프롬프트 전체적으로 손봐" — 시험 2회는 흐름이 아니다(그 비교는 알림장 본문이 '지난 회차 대비'로 이미 전한다).
describe("시험 줄은 같은 만점 3회 이상일 때만", () => {
  it("🔴 시험이 2회뿐이면 시험 줄을 싣지 않는다(과제가 있으면 과제만으로 추세)", () => {
    expect(MIN_EXAM_TREND_POINTS).toBe(3);
    const input = buildTrendInput([row("2026-09-29", "일일 5/5", "100%"), row("2026-10-13", "일일 1/5", "100%")]);
    expect(input!.examTrend).toBe("");
    expect(input!.assignTrend).toBe("[09-29~10-13] 100%(2회)");
  });

  it("🔴 만점이 다른 회차는 넘기지 않는다 — 가장 최근 시험과 만점이 같은 것만(30일 261건 '직접 비교하기는 어렵지만')", () => {
    const input = buildTrendInput([
      row("2026-09-01", "일일 4/5", null),
      row("2026-09-08", "일일 6/7", null),
      row("2026-09-15", "일일 5/5", null),
      row("2026-09-22", "일일 5/7", null),
      row("2026-09-29", "일일 3/5", null),
    ])!;
    expect(input.examTrend).toBe("[09-01] 일일 4/5 -> [09-15] 일일 5/5 -> [09-29] 일일 3/5");
    expect(input.scaleMixed).toBe(false);
  });

  it("🔴 묶음 = 3회 이상 쌓인 가장 최근 만점 — 한 번뿐인 월말평가(/25)가 마지막이어도 /5 일일테스트 흐름은 남는다", () => {
    const input = buildTrendInput([
      row("2026-09-01", "일일 4/5", null),
      row("2026-09-08", "일일 5/5", null),
      row("2026-09-15", "일일 4/5", null),
      row("2026-09-30", "21/25", null),
    ])!;
    expect(input.examTrend).toBe("[09-01] 일일 4/5 -> [09-08] 일일 5/5 -> [09-15] 일일 4/5");
  });

  it("화면 문장 표기('5문제 중 4개 맞음')도 같은 만점으로 묶인다", () => {
    const input = buildTrendInput([
      row("2026-09-01", "일일 4/5", null),
      row("2026-09-08", "5문제 중 5개 맞음", null),
      row("2026-09-15", "일일 3/5", null),
    ])!;
    expect(input.examTrend).toContain("[09-08] 5문제 중 5개 맞음");
    expect(input.examTrend.split(" -> ")).toHaveLength(3);
  });

  it("만점이 같은 시험이 3회가 안 되면 시험 줄 없음 → 과제도 없으면 추세 자체가 없다", () => {
    expect(
      buildTrendInput([row("2026-09-01", "일일 6/7", null), row("2026-09-08", "일일 5/5", null), row("2026-09-15", "일일 4/5", null)]),
    ).toBeNull();
  });
});

describe("마지막 한 번만 다른 시험 — 흐름으로 일반화하지 않게(권민서A 클레임)", () => {
  it("🔴 실례: 4/5 · 5/5 뒤 1/5 → 'low' + 코드 측 주의가 붙는다", () => {
    const input = buildTrendInput([
      row("2026-09-18", "일일 4/5", "100%"),
      row("2026-09-29", "일일 5/5", "100%"),
      row("2026-10-13", "일일 1/5", "100%"),
    ])!;
    expect(input.lastExamOutlier).toBe("low");
    expect(trendBody(input)).toContain(TREND_LAST_OUTLIER_NOTE);
  });
  it("꾸준히 오르거나 앞부터 들쭉날쭉하면 판정하지 않는다(흐름 판단은 [기록] 그대로)", () => {
    expect(examOutlier([60, 80, 90])).toBeNull(); // 앞 회차 폭 20 · 마지막 90은 평균 70에서 20 차이
    expect(examOutlier([20, 90, 40])).toBeNull(); // 앞부터 들쭉날쭉
    expect(examOutlier([20, 20, 100])).toBe("high");
    expect(examOutlier([80, 100])).toBeNull(); // 2회는 판정 안 함
  });
  it("평범한 기록에는 주의가 붙지 않는다", () => {
    const input = buildTrendInput([row("2026-06-01", "일일 8/10", null), row("2026-06-08", "일일 9/10", null), row("2026-06-15", "일일 8/10", null)])!;
    expect(input.lastExamOutlier).toBeNull();
    expect(trendBody(input)).not.toContain(TREND_LAST_OUTLIER_NOTE);
  });
});

// 원장 2026-10-15 — 수요일 반 보고서의 추세가 화·금 반 시험을 인용했다. 시험은 그 보고서 반의 기록만(과제는 그대로).
describe("keepExamOfClass — 시험은 그 반 기록만", () => {
  const A = "aaaaaaaa-1111-2222-3333-444444444444";
  const B = "bbbbbbbb-1111-2222-3333-444444444444";
  it("🔴 다른 반·반 모름 행의 시험 칸만 비우고 과제는 남긴다", () => {
    const rows = keepExamOfClass(
      [row("2026-09-18", "일일 4/5", "100%", B), row("2026-10-07", null, "100%", A), row("2026-10-13", "일일 1/5", "100%", B), row("2026-09-01", "일일 3/5", null, null)],
      A,
    );
    expect(rows.map((r) => r.examInfo)).toEqual([null, null, null, null]);
    expect(rows.map((r) => r.homeworkScore)).toEqual(["100%", "100%", "100%", null]);
    // 실례: 그 반엔 시험이 없으니 추세는 과제 흐름만.
    const input = buildTrendInput(rows)!;
    expect(input.examTrend).toBe("");
  });
  it("기준 반을 모르면 손대지 않는다(종전 동작)", () => {
    const rows = [row("2026-09-18", "일일 4/5", null, B)];
    expect(keepExamOfClass(rows, null)).toEqual(rows);
    expect(keepExamOfClass(rows, "  ")).toEqual(rows);
  });
  it("같은 반 시험은 그대로", () => {
    expect(keepExamOfClass([row("2026-09-18", "일일 4/5", null, A)], A)[0]!.examInfo).toBe("일일 4/5");
  });
  it("보강 행(반 없음)은 보강 반으로 판정한다 — 그 반 수업에서 본 보강 시험은 그 반 기록", () => {
    const rows = keepExamOfClass(
      [
        { ...row("2026-09-18", "일일 4/5", null, null), makeupClassId: A },
        { ...row("2026-09-19", "일일 2/5", null, null), makeupClassId: B },
      ],
      A,
    );
    expect(rows.map((r) => r.examInfo)).toEqual(["일일 4/5", null]);
  });
});

describe("buildTrendPrompt", () => {
  it("숫자 정확·전망 금지·JSON 계약·기록 주입", () => {
    const input = buildTrendInput(
      [row("2026-06-01", "일일 6/10", "완료"), row("2026-06-08", "일일 8/10", "완료"), row("2026-06-15", "일일 9/10", "완료")],
      { today: "2026-06-15" },
    )!;
    const p = buildTrendPrompt(input);
    expect(p).toContain('{"trend": "..."}'); // 출력 계약
    expect(p).toContain("Y문제 중 X개"); // 숫자 정확 규칙
    expect(p).toContain("날짜와 점수를 차례로 늘어놓지 마세요");
    expect(p).toContain("원색적인 표현 금지");
    expect(p).toContain("전망('곧 오를 겁니다')");
    expect(p).toContain("[06-01] 일일 6/10 -> [06-08] 일일 8/10 -> [06-15] 일일 9/10"); // 기록 주입
    expect(p).toContain("과제 흐름(날짜순): [06-01~06-15] 완료(3회)");
    // 오늘 결과는 본문이 전한다 — 추세에서 되풀이하지 않게 표시
    expect(p).toContain("오늘 수업: 06-15");
  });
  it("🔴 학원 계획 예시('집중력을 조금 더 챙겨 보려 합니다')가 프롬프트에서 사라졌다 — 30일 90건 그대로 나갔던 문장", () => {
    const p = buildTrendPrompt(buildTrendInput([row("2026-06-01", null, "100%"), row("2026-06-08", null, "100%")])!);
    expect(p).not.toContain("챙겨 보려 합니다");
    expect(p).not.toContain("예전만큼 점수가 나오지는 않고");
    expect(p).toContain("한 번만 다른 결과");
    expect(p).toContain("[말투 — 모든 항목 공통]");
  });
});

describe("findTrendViolations — 기록에 있을 수 없는 문장(생성 후 검사)", () => {
  it("🔴 실제로 나간 문장들을 잡는다", () => {
    expect(findTrendViolations("다만 과제는 꾸준히 챙겨 오고 있어 수업 중 집중력을 조금 더 챙겨 보려 합니다.")).toEqual(
      expect.arrayContaining(["원인 짐작", "정해지지 않은 계획"]),
    );
    expect(findTrendViolations("일일테스트는 만점이 일정하지 않아 직접 비교하기 어렵지만, 최근 5개를 맞혔습니다.")).toContain("기록 사정 설명");
    expect(findTrendViolations("최근에는 점수가 떨어졌습니다.")).toContain("원색적인 표현");
    expect(findTrendViolations("다음에는 오를 것으로 보입니다.")).toContain("전망");
    expect(findTrendViolations("복습 분량을 나눠서 관리해 보겠습니다.")).toContain("정해지지 않은 계획");
    expect(findTrendViolations("과제는 아직 안정적이지 못한 상태입니다.")).toContain("평가");
  });
  it("🔴 해요체도 잡는다 — 말투 바닥이 '~했어요'를 허용하므로(적대적 리뷰 2026-10-15)", () => {
    expect(findTrendViolations("복습 분량을 나눠서 관리해 볼게요.")).toContain("정해지지 않은 계획");
    expect(findTrendViolations("수업 시간에 한 번 더 챙길게요.")).toContain("정해지지 않은 계획");
    expect(findTrendViolations("다음 시간엔 오답을 다시 보려고 해요.")).toContain("정해지지 않은 계획");
    expect(findTrendViolations("곧 점수가 오를 거예요.")).toContain("전망");
    expect(findTrendViolations("곧 오를 겁니다.")).toContain("전망");
    expect(findTrendViolations("앞으로가 기대됩니다.")).toContain("전망");
    expect(findTrendViolations("최근에는 실수가 조금 있었습니다.")).toContain("원인 짐작");
    expect(findTrendViolations("기록이 많지 않아 흐름을 말하기는 이르지만")).toContain("기록 사정 설명");
    // 받침 판정 — 낱자 목록이면 빠져나가던 것들(적대적 재리뷰)
    for (const s of ["수업 때 더 가르칠게요.", "과제 관리에 신경 쓸게요.", "오답을 함께 살필게요."]) expect(findTrendViolations(s), s).toContain("정해지지 않은 계획");
    for (const s of ["다음엔 잘할 거예요.", "곧 좋을 거예요.", "금방 회복될 거예요.", "점수가 좋아질 것으로 보입니다."]) expect(findTrendViolations(s), s).toContain("전망");
  });
  it("✅ 평범한 추세 문장은 통과", () => {
    expect(findTrendViolations("9월 말부터 과제를 빠짐없이 해 오고 있습니다.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 그동안 5문제 중 4~5개를 맞혀 왔어요.")).toEqual([]);
    expect(findTrendViolations("과제는 꾸준히 챙겨 오고 있습니다.")).toEqual([]);
    expect(findTrendViolations("과제를 늘 거르지 않고 해 왔어요.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 10문제 중 8~9개를 맞혀 오다가 14일에는 4개였어요.")).toEqual([]);
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
  it("추세 입력에서도 100점 만점은 점수 표기로", () => {
    const input = buildTrendInput([row("2026-06-11", "80/100", "0%"), row("2026-06-18", "84/100", "0%"), row("2026-06-25", "88/100", "0%")])!;
    expect(input.examTrend).toBe("[06-11] 80점(100점 만점) -> [06-18] 84점(100점 만점) -> [06-25] 88점(100점 만점)");
  });
  it("프롬프트가 점수/문항 구분 규칙을 담는다", () => {
    const input = buildTrendInput([row("2026-06-11", "80/100", null), row("2026-06-18", "84/100", null), row("2026-06-25", "88/100", null)])!;
    expect(buildTrendPrompt(input)).toContain("100점 만점에 X점");
  });
});

// 2026-07-22: 과제-only 행을 표본에 들이면서 생긴 잠식 위험 방어.
describe("흐름별 독립 윈도 — 과제-only 행이 시험 기록을 밀어내지 않음", () => {
  it("과제만 있는 행이 12개 앞서도 시험 기록은 전부 남는다", () => {
    const rows: TrendHistoryRow[] = [];
    for (let i = 1; i <= 12; i++) rows.push(row(`2026-06-${String(i).padStart(2, "0")}`, null, "0%"));
    rows.push(row("2026-06-20", "일일 6/10", null));
    rows.push(row("2026-06-24", "일일 7/10", null));
    rows.push(row("2026-06-27", "일일 8/10", null));
    const input = buildTrendInput(rows)!;
    expect(input.examTrend).toBe("[06-20] 일일 6/10 -> [06-24] 일일 7/10 -> [06-27] 일일 8/10");
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
    const input = buildTrendInput([row("2026-06-25", null, "100%"), row("2026-07-13", null, "100%")])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain("시험 이름을 지어내지 마세요");
    expect(p).toContain("없으면 '테스트'라고만 쓰세요");
  });
});
