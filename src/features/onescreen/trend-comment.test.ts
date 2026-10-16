import { describe, it, expect } from "vitest";
import {
  buildTrendInput,
  buildTrendPrompt,
  examOutlier,
  findTrendViolations,
  keepExamOfClass,
  normalizeExamInfo,
  trendBody,
  trendFacts,
  trendNews,
  findTrendContradictions,
  TREND_STREAK_ENDED_NOTE,
  HOMEWORK_STREAK_MILESTONES,
  TREND_NEWS_LOOKBACK_DAYS,
  TREND_HISTORY_FETCH_DAYS,
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
    const input = buildTrendInput([row("2026-09-22", null, "100%"), row("2026-09-29", "일일 5/5", "100%"), row("2026-10-13", "일일 1/5", "100%")]);
    expect(input!.examTrend).toBe("");
    expect(input!.assignTrend).toBe("[09-22~10-13] 100%(3회)");
    expect(input!.facts).toEqual(["과제: 최근 3회 연속 빠짐없이 잘 해 옴"]);
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
    // 이름 없는 점수도 만점이 같은 이름 붙은 시험(일일)이 하나뿐이면 그 흐름에 든다.
    expect(input.facts).toEqual(["일일테스트(최근 3회): 그동안은 5문제 중 4~5개였고, 가장 최근 한 번만 5문제 중 3개(한 번은 흐름이 아님)"]);
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
    expect(examOutlier([90, 70, 50])).toBeNull(); // 고르게 세 번 연속 내림 = 흐름(한 번 튄 게 아니다)
    expect(examOutlier([100, 100, 100, 90, 20])).toBe("low"); // 앞이 조금 움직였어도 마지막에 크게 꺾이면 한 번(적대적 리뷰 2026-10-16)
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
    expect(p).toContain("'N문제 중 M개'"); // 숫자 정확 규칙
    expect(p).toContain("원색적인 표현 금지");
    expect(p).toContain("전망('곧 오를 겁니다')");
    // 기록 주입 = 코드가 정리한 사실 문장(날짜 없음, 2026-10-16) — 날짜 붙은 원기록은 싣지 않는다.
    expect(p).toContain("- 일일테스트(최근 3회): 최근 세 번 연속 올랐음(10문제 중 6→8→9개)");
    expect(p).toContain("- 과제: 최근 3회 연속 빠짐없이 잘 해 옴"); // '완료' = 100% → 말로(원장 2026-10-16)
    expect(p).not.toContain("[06-01]");
    expect(p).toContain("날짜·요일·달은 쓰지 마세요");
    expect(p).toContain("새로 달라진 점");
    // 오늘 결과는 본문이 전한다 — 추세에서 되풀이하지 않게 표시
    expect(p).toContain("'오늘'이라 적힌 결과는 알림장 본문이 이미 전합니다");
  });
  it("🔴 학원 계획 예시('집중력을 조금 더 챙겨 보려 합니다')가 프롬프트에서 사라졌다 — 30일 90건 그대로 나갔던 문장", () => {
    const p = buildTrendPrompt(buildTrendInput([row("2026-06-01", null, "100%"), row("2026-06-04", null, "100%"), row("2026-06-08", null, "100%")])!);
    expect(p).not.toContain("챙겨 보려 합니다");
    expect(p).not.toContain("예전만큼 점수가 나오지는 않고");
    expect(p).toContain("한 번만 다른 결과");
    expect(p).toContain("[말투 — 모든 항목 공통]");
  });
});

// 원장 2026-10-16 "코드가 문장을 만들어 넘기는것도 괜찮네" — 날짜는 모델이 아니라 코드가 다룬다.
describe("trendFacts — 코드가 정리한 사실 문장(날짜 없음)", () => {
  const facts = (rows: TrendHistoryRow[], today: string | null = null) => trendFacts(rows, today).map((f) => f.text);
  it("과제 = 최근에 이어진 같은 값 · 날짜 없이 횟수로 · 100%는 말로", () => {
    expect(facts([row("2026-09-16", null, "80%"), row("2026-09-18", null, "100%"), row("2026-09-22", null, "60%"), row("2026-09-23", null, "100%"), row("2026-09-29", null, "100%"), row("2026-10-14", null, "100%")])).toEqual([
      "과제: 최근 3회 연속 빠짐없이 잘 해 옴",
    ]);
    // '완료'와 '100%'는 같은 값 — 섞여도 연속이 끊기지 않는다(적대적 리뷰 2026-10-16: "100~100% 사이").
    expect(facts([row("2026-09-16", null, "완료"), row("2026-09-18", null, "100%"), row("2026-09-22", null, "완료")])).toEqual(["과제: 최근 3회 연속 빠짐없이 잘 해 옴"]);
    // 0%·미제출은 단일 소스(homeworkFactValue)의 말 그대로.
    expect(facts([row("2026-09-16", null, "미제출"), row("2026-09-18", null, "미제출"), row("2026-09-22", null, "미제출")])).toEqual(["과제: 최근 3회 연속 제출하지 않음"]);
    expect(facts([row("2026-09-16", null, "90%"), row("2026-09-18", null, "90%"), row("2026-09-22", null, "90%")])).toEqual(["과제: 최근 3회 연속 90%"]);
  });
  it("과제가 이어지지 않으면 최근 범위만(가장 최근 = 오늘 값은 본문 몫)", () => {
    expect(facts([row("2026-09-10", null, "30%"), row("2026-09-14", null, "10%"), row("2026-10-08", null, "40%")])).toEqual(["과제: 최근 3회 10~40% 사이"]);
    // 숫자로 못 읽는 값이 섞이면 범위를 싣지 않는다(일부만 골라 말하면 사실이 비틀린다).
    expect(facts([row("2026-09-10", null, "30%"), row("2026-09-14", null, "일부 미흡"), row("2026-10-08", null, "60%")])).toEqual([]);
    // 같은 값 2회는 연속이라 부르기엔 짧다.
    expect(facts([row("2026-09-10", null, "100%"), row("2026-09-14", null, "100%")])).toEqual([]);
    // 폭이 넓은 범위("0%에서 100% 사이")는 전할 게 없다 — 40%p 초과면 뺀다(2026-10-16 최종 시험).
    expect(facts([row("2026-09-10", null, "0%"), row("2026-09-14", null, "100%"), row("2026-10-08", null, "60%")])).toEqual([]);
    expect(facts([row("2026-09-10", null, "60%"), row("2026-09-14", null, "100%"), row("2026-10-08", null, "80%")])).toEqual(["과제: 최근 3회 60~100% 사이"]);
  });
  it("연속이 막 끊겼으면 '오늘 전까지 N회 연속'", () => {
    const rows = [row("2026-09-08", null, "50%"), ...Array.from({ length: 7 }, (_, i) => row(`2026-09-${String(i + 10).padStart(2, "0")}`, null, "100%")), row("2026-09-20", null, "60%")];
    expect(facts(rows, "2026-09-20")).toEqual(["과제: 그동안 7회 연속 빠짐없이 잘 해 옴"]);
    // 이번 회차에 과제가 없으면(가장 최근이 오늘이 아님) 그렇게 적는다.
    expect(facts(rows, "2026-09-25")).toEqual(["과제: 가장 최근 한 번 전까지 7회 연속 빠짐없이 잘 해 옴"]);
  });
  it("시험 = 코드가 흐름을 판정(대체로 · 오름 · 덜 맞힘 · 마지막 한 번만 · 모두 다 맞힘)", () => {
    expect(facts([row("2026-09-15", "일일 5/5", null), row("2026-09-18", "일일 4/5", null), row("2026-10-06", "일일 4/5", null), row("2026-10-13", "일일 5/5", null)])).toEqual([
      "일일테스트(최근 4회): 대체로 5문제 중 4~5개",
    ]);
    expect(facts([row("2026-09-01", "확인 9/10", null), row("2026-09-08", "확인 7/10", null), row("2026-09-15", "확인 5/10", null)])).toEqual([
      "확인테스트(최근 3회): 최근 세 번 연속 조금씩 덜 맞힘(10문제 중 9→7→5개)",
    ]);
    // 🔴 권민서A 실례 — 마지막 한 번만 다르면 흐름이 아니라고 적어 넘긴다. 마지막이 오늘이면 '오늘'.
    const out = [row("2026-09-18", "일일 4/5", null), row("2026-09-29", "일일 5/5", null), row("2026-10-13", "일일 1/5", null)];
    expect(facts(out)).toEqual(["일일테스트(최근 3회): 그동안은 5문제 중 4~5개였고, 가장 최근 한 번만 5문제 중 1개(한 번은 흐름이 아님)"]);
    expect(facts(out, "2026-10-13")).toEqual(["일일테스트(최근 3회): 그동안은 5문제 중 4~5개였고, 오늘 한 번만 5문제 중 1개(한 번은 흐름이 아님)"]);
    expect(facts([row("2026-09-01", "일일 5/5", null), row("2026-09-08", "일일 5/5", null), row("2026-09-15", "일일 5/5", null)])).toEqual(["일일테스트(최근 3회): 모두 다 맞힘"]);
  });
  it("🔴 크게 한 번 꺾인 건 '조금씩 덜 맞힘'이 아니다(적대적 리뷰 2026-10-16)", () => {
    expect(facts([row("2026-09-01", "일일 10/10", null), row("2026-09-03", "일일 10/10", null), row("2026-09-05", "일일 10/10", null), row("2026-09-08", "일일 9/10", null), row("2026-09-10", "일일 2/10", null)])).toEqual([
      "일일테스트(최근 5회): 그동안은 10문제 중 9~10개였고, 가장 최근 한 번만 10문제 중 2개(한 번은 흐름이 아님)",
    ]);
    expect(facts([row("2026-09-01", "일일 9/10", null), row("2026-09-03", "일일 7/10", null), row("2026-09-05", "일일 4/10", null)])).toEqual([
      "일일테스트(최근 3회): 최근 세 번 연속 덜 맞힘(10문제 중 9→7→4개)",
    ]);
  });
  it("100점 만점 시험은 점수로(받침: '점이었고')", () => {
    expect(facts([row("2026-06-11", "80/100", null), row("2026-06-18", "84/100", null), row("2026-06-25", "80/100", null)])).toEqual(["테스트(최근 3회): 대체로 100점 만점에 80~84점"]);
    expect(facts([row("2026-06-11", "80/100", null), row("2026-06-18", "84/100", null), row("2026-06-25", "30/100", null)])).toEqual([
      "테스트(최근 3회): 그동안은 100점 만점에 80~84점이었고, 가장 최근 한 번만 100점 만점에 30점(한 번은 흐름이 아님)",
    ]);
  });
  it("🔴 한 회차에 시험이 둘이면 시험마다 따로 줄을 세운다 — 일일 점수가 '확인테스트'로 나가지 않게(적대적 리뷰 2026-10-16)", () => {
    expect(facts([row("2026-07-01", "일일 4/5, 확인 8/10", "100%"), row("2026-07-08", "일일 5/5, 확인 7/10", "100%"), row("2026-07-15", "일일 4/5, 확인 9/10", "100%")])).toEqual([
      "일일테스트(최근 3회): 대체로 5문제 중 4~5개",
      "확인테스트(최근 3회): 대체로 10문제 중 7~9개",
      "과제: 최근 3회 연속 빠짐없이 잘 해 옴",
    ]);
    // 만점이 같아도(실제 저장 형식) 둘로 읽는다.
    const same = facts([row("2026-07-01", "일일 15/20, 확인 18/20", null), row("2026-07-08", "일일 16/20, 확인 12/20", null), row("2026-07-15", "일일 17/20, 확인 19/20", null)]);
    expect(same).toEqual(["일일테스트(최근 3회): 최근 세 번 연속 올랐음(20문제 중 15→16→17개)", "확인테스트(최근 3회): 대체로 20문제 중 12~19개"]);
  });
  it("분모를 못 읽는 시험뿐이면 사실이 없다 → 추세를 만들지 않는다('자료 없음'으로 문장을 요구하지 않게)", () => {
    expect(buildTrendInput([row("2026-09-01", "80점", null), row("2026-09-08", "85점", null), row("2026-09-15", "90점", null)])).toBeNull();
  });
});

// 원장 2026-10-16 "오늘은 7회 연속이라 말했는데, 다음엔 또 8회 연속이라는 같은 말을 반복할거 아냐. 완전 AI 티 팍팍 나네"
describe("trendNews — 지난 보고서와 달라진 것만", () => {
  const days = (n: number, value: string) => Array.from({ length: n }, (_, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`, null, value));
  it("🔴 연속이 이어지기만 하면(7→8회) 말하지 않는다 · 고비(5·10…)에서만 다시 짚는다", () => {
    expect(HOMEWORK_STREAK_MILESTONES).toEqual([5, 10, 15, 20, 30]);
    // 앞에 다른 값 한 줄 — 연속이 기록 창의 첫 과제부터가 아니어야 진짜 횟수다(아래 '창에 잘린 연속').
    const lead = [row("2026-08-31", null, "60%")];
    expect(trendNews([...lead, ...days(8, "100%")], null)).toEqual([]);
    expect(trendNews([...lead, ...days(5, "100%")], null).map((f) => f.text)).toEqual(["과제: 최근 5회 연속 빠짐없이 잘 해 옴"]);
    expect(trendNews([...lead, ...days(10, "100%")], null).map((f) => f.text)).toEqual(["과제: 최근 10회 연속 빠짐없이 잘 해 옴"]);
    // 연속이 처음 3회에 닿은 회차는 새 소식.
    expect(trendNews(days(3, "100%"), null).map((f) => f.text)).toEqual(["과제: 최근 3회 연속 빠짐없이 잘 해 옴"]);
  });
  it("연속이 끊긴 회차는 말하고, 그 뒤 들쭉날쭉으로 돌아온 건 말하지 않는다", () => {
    const broke = [row("2026-08-31", null, "50%"), ...days(7, "100%"), row("2026-09-20", null, "60%")];
    expect(trendNews(broke, "2026-09-20").map((f) => f.text)).toEqual(["과제: 그동안 7회 연속 빠짐없이 잘 해 옴"]);
    expect(trendNews([...broke, row("2026-09-22", null, "100%")], "2026-09-22")).toEqual([]);
  });
  it("시험 흐름이 바뀐 회차만 — '대체로'로 돌아온 건 말하지 않는다", () => {
    const up = [row("2026-09-01", "일일 5/10", null), row("2026-09-03", "일일 5/10", null), row("2026-09-05", "일일 6/10", null), row("2026-09-08", "일일 8/10", null)];
    expect(trendNews(up, null).map((f) => f.text)).toEqual(["일일테스트(최근 4회): 최근 세 번 연속 올랐음(10문제 중 5→6→8개)"]);
    expect(trendNews([...up, row("2026-09-10", "일일 8/10", null)], null)).toEqual([]);
  });
  it("🔴 연속이 끝난 회차 = 주의를 붙이고, 이어지는 말로 쓰면 버린다(2026-10-16 시험 11건 중 6건)", () => {
    const i = buildTrendInput([row("2026-08-31", null, "10%"), ...days(4, "30%"), row("2026-09-20", null, "40%")], { today: "2026-09-20" })!;
    expect(i.facts).toEqual(["과제: 그동안 4회 연속 30%"]);
    expect(i.streakEnded).toBe(true);
    expect(trendBody(i)).toContain(TREND_STREAK_ENDED_NOTE);
    expect(findTrendContradictions(i, "과제는 그동안 4회 연속 30%를 해 오고 있습니다.")).toEqual(["끝난 연속을 이어진다고 씀"]);
    expect(findTrendContradictions(i, "과제는 그동안 네 번 연속 30%를 해 왔습니다.")).toEqual([]);
    // 시험 문장의 '~하고 있습니다'는 과제 대조 밖
    expect(findTrendContradictions(i, "일일테스트는 조금씩 더 맞히고 있습니다. 과제는 그동안 네 번 연속 30%를 해 왔습니다.")).toEqual([]);
    // 적대적 재리뷰 2026-10-16 — 한 문장 안 시험 마디 · 과거형 '계속해서'는 버리지 않는다
    expect(findTrendContradictions(i, "그동안 과제를 네 번 연속 30% 해 왔고, 일일테스트는 꾸준히 잘 하고 있습니다.")).toEqual([]);
    expect(findTrendContradictions(i, "그동안 과제는 계속해서 일곱 번 연속 빠짐없이 해 왔습니다.")).toEqual([]);
    // 놓치던 이어지는 말 — 다른 동사 · '숙제' · '과제'가 없는 연속 문장
    for (const s of ["과제는 그동안 네 번 연속 챙겨 오고 있습니다.", "숙제를 네 번 연속 지켜 오고 있어요.", "과제는 꾸준히 해 오는 중입니다.", "그동안 일곱 번 연속 빠짐없이 해 오고 있습니다.", "과제는 네 번 연속을 이어 가고 있습니다."])
      expect(findTrendContradictions(i, s), s).toEqual(["끝난 연속을 이어진다고 씀"]);
    // 잘린 연속의 '매번' 문구도 · 시험 마디의 '연속 … 이어 가고'는 대조 밖(재리뷰 2026-10-16)
    expect(findTrendContradictions(i, "그동안 매번 빠짐없이 잘 해 오고 있습니다.")).toEqual(["끝난 연속을 이어진다고 씀"]);
    expect(findTrendContradictions(i, "일일테스트는 세 번 연속 맞힌 문제가 늘어 이어 가고 있고, 과제는 그동안 네 번 연속 30%를 해 왔습니다.")).toEqual([]);
    // 이어지는 연속에는 주의도 대조도 없다
    const on = buildTrendInput([row("2026-08-31", null, "60%"), ...days(5, "100%")])!;
    expect(on.streakEnded).toBe(false);
    expect(findTrendContradictions(on, "과제를 다섯 번 연속 빠짐없이 잘 해 오고 있습니다.")).toEqual([]);
  });
  it("🔴 창(30일)에 잘린 연속 — 고비 소식을 내지 않고, 끝난 연속은 횟수 없이 '매번'(적대적 재리뷰 2026-10-16)", () => {
    // 주 1회 수업이면 창에 늘 5회 — "최근 5회 연속"이 매주 새 소식이 되던 것
    expect(trendNews(days(5, "100%"), null)).toEqual([]);
    expect(trendNews(days(10, "100%"), null)).toEqual([]);
    // 처음 3회에 닿은 회차는 여전히 소식
    expect(trendNews(days(3, "100%"), null).map((f) => f.text)).toEqual(["과제: 최근 3회 연속 빠짐없이 잘 해 옴"]);
    expect(trendNews([...days(8, "100%"), row("2026-09-20", null, "60%")], "2026-09-20").map((f) => f.text)).toEqual(["과제: 그동안 매번 빠짐없이 잘 해 옴"]);
  });
  it("🔴 미제출과 0%는 다른 값 — 한 연속·한 범위로 묶지 않는다", () => {
    const f = (rows: TrendHistoryRow[]) => trendFacts(rows, null).map((x) => x.text);
    expect(f([row("2026-09-01", null, "미제출"), row("2026-09-03", null, "미제출"), row("2026-09-05", null, "0%")])).toEqual([]);
    expect(f([row("2026-09-01", null, "0%"), row("2026-09-03", null, "0%"), row("2026-09-05", null, "미제출")])).toEqual([]);
    expect(f([row("2026-09-01", null, "40%"), row("2026-09-03", null, "미제출"), row("2026-09-05", null, "30%")])).toEqual([]);
    expect(f([row("2026-08-30", null, "50%"), row("2026-09-01", null, "0%"), row("2026-09-03", null, "0%"), row("2026-09-05", null, "0%")])).toEqual(["과제: 최근 3회 연속 하나도 해오지 못함"]);
  });
  it("🔴 지난번 실제로 추세가 나간 회차와 견준다 — 고비 회차의 추세가 안 나갔으면 다음 회차가 잇는다", () => {
    const rows: TrendHistoryRow[] = [
      { ...row("2026-08-31", null, "60%"), hadTrend: false },
      { ...row("2026-09-01", null, "100%"), hadTrend: false },
      { ...row("2026-09-02", null, "100%"), hadTrend: false },
      { ...row("2026-09-03", null, "100%"), hadTrend: true }, // 3회 연속 — 나감
      { ...row("2026-09-04", null, "100%"), hadTrend: false },
      { ...row("2026-09-05", null, "100%"), hadTrend: false }, // 5회 = 고비 — 그 회차 추세는 버려짐(안 나감)
      row("2026-09-08", null, "100%"), // 이번 회차(6회)
    ];
    expect(trendNews(rows, null).map((f) => f.text)).toEqual(["과제: 최근 6회 연속 빠짐없이 잘 해 옴"]);
    // 고비 회차의 추세가 나갔으면 6회째는 되풀이
    const sent = rows.map((r, i) => (i === 5 ? { ...r, hadTrend: true } : r));
    expect(trendNews(sent, null)).toEqual([]);
    // 끊긴 회차의 추세가 안 나갔으면, 그 뒤 '범위'로 돌아온 회차가 소식이다(지난번 말한 상태 = 연속)
    const unsaidBreak: TrendHistoryRow[] = [...rows.slice(0, 4), { ...row("2026-09-04", null, "60%"), hadTrend: false }, row("2026-09-05", null, "100%")];
    expect(trendNews(unsaidBreak, null).map((f) => f.state)).toEqual(["range"]);
  });
  it("🔴 운영 흐름 흉내 — 주 1회·매번 100%면 추세가 나간 뒤 60일 가까이 같은 말을 다시 하지 않는다(재리뷰 2026-10-16: 3주마다 되풀이)", () => {
    const all: TrendHistoryRow[] = [];
    const said: string[] = [];
    for (let w = 0; w < 16; w++) {
      const d = new Date(Date.UTC(2026, 5, 1 + 7 * w));
      const date = d.toISOString().slice(0, 10);
      const since = new Date(d.getTime() - TREND_HISTORY_FETCH_DAYS * 86_400_000).toISOString().slice(0, 10);
      // 운영처럼: 그날 전 90일 이력 + 오늘 행 · 추세가 나간 회차에만 hadTrend
      const ti = buildTrendInput([...all.filter((r) => r.date >= since), row(date, null, "100%")], { today: date });
      const sent = !!(ti && ti.facts.length);
      if (sent) said.push(date);
      all.push({ ...row(date, null, "100%"), hadTrend: sent });
    }
    expect(said.length).toBeGreaterThanOrEqual(1);
    expect(said.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < said.length; i++) expect((Date.parse(said[i]!) - Date.parse(said[i - 1]!)) / 86_400_000).toBeGreaterThan(TREND_NEWS_LOOKBACK_DAYS - 7);
  });
  it("옛 묶음 게이트가 이름별 시험 사실을 막지 않는다 — 시험이 둘인 칸이 섞여도", () => {
    const i = buildTrendInput([row("2026-07-01", "일일 4/5", null), row("2026-07-08", "일일 5/5, 확인 8/10", null), row("2026-07-15", "일일 4/5, 확인 9/10", null), row("2026-07-22", "일일 3/5", null)]);
    expect(i).not.toBeNull();
    expect(trendFacts([row("2026-07-01", "일일 4/5", null), row("2026-07-08", "일일 5/5, 확인 8/10", null), row("2026-07-15", "일일 4/5, 확인 9/10", null), row("2026-07-22", "일일 3/5", null)], null)[0]!.text).toBe(
      "일일테스트(최근 4회): 최근 세 번 연속 조금씩 덜 맞힘(5문제 중 5→4→3개)",
    );
  });
  it("소수 점수(사무실 자유 입력)는 읽지 않는다 — '5/5'로 오독하지 않게", () => {
    const f = (e: string) => trendFacts([row("2026-07-01", e, null), row("2026-07-08", e, null), row("2026-07-15", e, null)], null);
    expect(f("일일 4.5/5")).toEqual([]);
    expect(f("3.5/5")).toEqual([]);
  });
  it("이번 회차에 시험·과제가 없으면 새 소식도 없다 → quiet(추세 칸을 비운다)", () => {
    const i = buildTrendInput([row("2026-08-31", null, "60%"), ...days(8, "100%"), row("2026-09-20", null, null)], { today: "2026-09-20" })!;
    expect(i.facts).toEqual([]);
    expect(i.quiet).toBe(true);
    // 8회째 연속도 같은 말이라 quiet.
    expect(buildTrendInput([row("2026-08-31", null, "60%"), ...days(8, "100%")])!.quiet).toBe(true);
  });
});

describe("findTrendViolations — 기록에 있을 수 없는 문장(생성 후 검사)", () => {
  it("🔴 날짜 — [기록]에 날짜가 없으니 문장에 나오면 지어낸 것(2026-10-16)", () => {
    for (const s of [
      "9월 18일부터는 과제를 일곱 번 연속 다 해 왔어요.",
      "지난달 15일부터 어제까지 과제를 다 해 왔습니다.",
      "일일테스트는 14일에 4개였어요.",
      "지난주부터 과제를 다 해 오고 있어요.",
      // 적대적 리뷰 2026-10-16이 찾은 빠져나가는 표현
      "지난 18일 일일테스트에서는 5문제 중 4개를 맞혔어요.",
      "지난달부터 과제를 빠짐없이 해 오고 있어요.",
      "월요일마다 과제를 다 해 와요.",
      "18일 일일테스트에서 4개를 맞혔어요.",
      "최근 2주 동안 과제를 빠짐없이 해 왔어요.",
      "한 달 내내 과제를 해 왔습니다.",
    ])
      expect(findTrendViolations(s), s).toContain("날짜");
    for (const s of ["과제를 3일 연속 해 왔어요.", "주 2회 수업에서 일일테스트를 꾸준히 맞히고 있어요."]) expect(findTrendViolations(s), s).toEqual([]);
  });
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
    expect(findTrendViolations("최근 일곱 번 연속 과제를 빠짐없이 해 오고 있습니다.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 그동안 5문제 중 4~5개를 맞혀 왔어요.")).toEqual([]);
    expect(findTrendViolations("과제는 꾸준히 챙겨 오고 있습니다.")).toEqual([]);
    expect(findTrendViolations("과제를 늘 거르지 않고 해 왔어요.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 10문제 중 8~9개를 맞혀 오다가 최근 한 번은 4개였어요.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 꾸준히 맞히고 있어요.")).toEqual([]); // '일일'은 날짜가 아니다
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
      row("2026-06-15", null, "완료"),
    ])!;
    expect(input.count).toBe(3);
  });
  it("과제 기록만 있어도 추세가 생성된다(예전엔 시험 없으면 표본 부족으로 침묵)", () => {
    const input = buildTrendInput([row("2026-06-01", null, "미제출"), row("2026-06-04", null, "미제출"), row("2026-06-08", null, "미제출")]);
    expect(input).not.toBeNull();
    expect(input!.examTrend).toBe("");
    expect(input!.assignTrend).toBe("[06-01~06-08] 미제출(3회)");
    expect(input!.facts).toEqual(["과제: 최근 3회 연속 제출하지 않음"]);
  });
});

// 2026-07-23 실발송 E2E에서 잡음: 이름 없는 기록(`88/100`)에 모델이 "확인테스트"라는 이름을 지어냈다.
// 이 학원은 확인테스트를 아예 쓰지 않는다(showCheckTest=false) — 학부모에게 없는 시험이 통보된다.
describe("시험 이름 환각 방지", () => {
  it("프롬프트가 이름 없는 점수에 이름을 붙이지 말라고 지시한다", () => {
    const input = buildTrendInput([row("2026-06-25", null, "100%"), row("2026-07-08", null, "100%"), row("2026-07-13", null, "100%")])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain("시험 이름을 지어내지 마세요");
    expect(p).toContain("없으면 '테스트'라고만 쓰세요");
  });
});
