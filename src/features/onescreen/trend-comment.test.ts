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
    expect(input!.facts).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]);
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
    expect(input.facts).toEqual(["일일테스트: 그동안은 거의 다 맞히는 편이었음(가장 최근 한 번은 평소와 달랐지만 한 번은 흐름이 아님)"]);
  });

  it("만점이 같은 시험이 3회가 안 되면 시험 줄 없음 → 과제도 없으면 말할 것이 없다(quiet)", () => {
    const i = buildTrendInput([row("2026-09-01", "일일 6/7", null), row("2026-09-08", "일일 5/5", null), row("2026-09-15", "일일 4/5", null)])!;
    expect(i.facts).toEqual([]);
    expect(i.quiet).toBe(true);
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
    expect(p).toContain("숫자를 쓰지 마세요"); // 정도로만(원장 2026-10-16 "어차피 추세선에 나옴")
    expect(p).toContain("원색적인 표현 금지");
    expect(p).toContain("전망('곧 오를 겁니다')");
    // 기록 주입 = 코드가 정리한 사실 문장(날짜 없음, 2026-10-16) — 날짜 붙은 원기록은 싣지 않는다.
    expect(p).toContain("- 일일테스트: 최근 들어 맞히는 문제가 늘고 있음");
    expect(p).toContain("- 과제: 최근 빠짐없이 잘 해 오고 있음"); // '완료' = 100% → 말로(원장 2026-10-16)
    // [기록]에 숫자가 없다 — 머리말 지시 줄을 빼고 사실 줄만 본다.
    const facts = p.slice(p.indexOf("분석 대상:")).split("\n").filter((l) => l.startsWith("- "));
    expect(facts.join("\n")).not.toMatch(/\d/);
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
// 원장 2026-10-16 저녁 "최근에는 과제를 잘해오고 있는 편입니다. 정도로 할것. 너무 정확하게 100% 80% 할 필요 없음. 어차피 추세선에 나옴"
//   · "못한다 이런 말들은 쓰지 말것" — 숫자·횟수 없이 정도로만, 부정어로만 말할 수 있는 흐름은 줄을 만들지 않는다.
describe("trendFacts — 코드가 정리한 사실 문장(날짜·숫자 없음)", () => {
  const facts = (rows: TrendHistoryRow[], today: string | null = null) => trendFacts(rows, today).map((f) => f.text);
  it("🔴 과제 = 최근에 이어진 같은 정도 · 횟수·퍼센트 없이 — 100·100·80은 '잘 해 오고 있는 편'(원장 화면의 실례)", () => {
    expect(facts([row("2026-10-06", null, "100%"), row("2026-10-09", null, "100%"), row("2026-10-13", null, "80%")])).toEqual(["과제: 최근 잘 해 오고 있는 편"]);
    // 전부 100%(완료)면 '빠짐없이' — '완료'와 '100%'는 같은 값(적대적 리뷰 2026-10-16)
    expect(facts([row("2026-09-16", null, "완료"), row("2026-09-18", null, "100%"), row("2026-09-22", null, "완료")])).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]);
    expect(facts([row("2026-09-16", null, "60%"), row("2026-09-18", null, "70%"), row("2026-09-22", null, "50%")])).toEqual(["과제: 최근 절반 이상 해 오는 편"]);
    expect(facts([row("2026-09-16", null, "30%"), row("2026-09-18", null, "10%"), row("2026-09-22", null, "40%")])).toEqual(["과제: 최근 조금씩 해 오고 있는 편"]);
  });
  it("0%·미제출도 사실대로 — 막는 것은 나빠지는 흐름으로 묶는 말뿐('점점 못해진다. 이런거 정도가 아니면 되는거지')", () => {
    expect(facts([row("2026-09-16", null, "미제출"), row("2026-09-18", null, "미제출"), row("2026-09-22", null, "미제출")])).toEqual(["과제: 최근 제출하지 않고 있음"]);
    expect(facts([row("2026-09-16", null, "0%"), row("2026-09-18", null, "0%"), row("2026-09-22", null, "0%")])).toEqual(["과제: 최근 해 오지 못하고 있음"]);
  });
  it("정도가 이어지지 않으면 최근 '대체로'(폭 40%p 이내 · 미제출·옛 표기가 섞이면 없음)", () => {
    expect(facts([row("2026-09-10", null, "60%"), row("2026-09-14", null, "100%"), row("2026-10-08", null, "80%")])).toEqual(["과제: 최근 잘 해 오고 있는 편"]);
    expect(facts([row("2026-09-10", null, "30%"), row("2026-09-14", null, "60%"), row("2026-10-08", null, "40%")])).toEqual(["과제: 최근 조금씩 해 오고 있는 편"]);
    // 숫자로 못 읽는 값이 섞이면 싣지 않는다(일부만 골라 말하면 사실이 비틀린다).
    expect(facts([row("2026-09-10", null, "30%"), row("2026-09-14", null, "일부 미흡"), row("2026-10-08", null, "60%")])).toEqual([]);
    // 같은 값 2회는 이어졌다고 하기엔 짧다.
    expect(facts([row("2026-09-10", null, "100%"), row("2026-09-14", null, "100%")])).toEqual([]);
    // 0%와 100%를 오감 = 정도라 할 게 없다(40%p 초과).
    expect(facts([row("2026-09-10", null, "0%"), row("2026-09-14", null, "100%"), row("2026-10-08", null, "60%")])).toEqual([]);
    // 0%가 이어지면 '대체로'가 아니라 이어짐이다.
    expect(facts([row("2026-09-10", null, "0%"), row("2026-09-14", null, "0%"), row("2026-10-08", null, "0%"), row("2026-10-09", null, "0%")])).toEqual(["과제: 최근 해 오지 못하고 있음"]);
  });
  it("🔴 이어지던 모습이 막 끝난 회차엔 과제 줄이 없다 — 본문 '지난 과제는 70%' 뒤 '그동안 과제도 잘 해 왔습니다'가 헷갈렸다(Codex c1·c29·c63)", () => {
    const rows = [row("2026-09-08", null, "50%"), ...Array.from({ length: 7 }, (_, i) => row(`2026-09-${String(i + 10).padStart(2, "0")}`, null, "100%")), row("2026-09-20", null, "60%")];
    expect(facts(rows, "2026-09-20")).toEqual([]);
    expect(facts(rows, "2026-09-25")).toEqual([]);
    // 같은 정도 안의 출렁임(100 → 90)은 끝난 게 아니다 — 여전히 '잘 해 옴'.
    expect(facts([...rows.slice(0, 8), row("2026-09-20", null, "90%")], "2026-09-20")).toEqual(["과제: 최근 잘 해 오고 있는 편"]);
    // 0%가 끝나 해 온 날에 지난 부정만 말하지 않는다(재리뷰).
    expect(facts([row("2026-09-01", null, "0%"), row("2026-09-03", null, "0%"), row("2026-09-05", null, "0%"), row("2026-09-08", null, "100%")], "2026-09-08")).toEqual([]);
  });
  it("시험 = 코드가 흐름을 판정해 말로(대체로 · 늘고 있음 · 마지막 한 번만 · 모두 다 맞힘) — 숫자 없음", () => {
    expect(facts([row("2026-09-15", "일일 5/5", null), row("2026-09-18", "일일 4/5", null), row("2026-10-06", "일일 4/5", null), row("2026-10-13", "일일 5/5", null)])).toEqual([
      "일일테스트: 거의 다 맞히는 편",
    ]);
    expect(facts([row("2026-09-01", "확인 5/10", null), row("2026-09-08", "확인 7/10", null), row("2026-09-15", "확인 9/10", null)])).toEqual(["확인테스트: 최근 들어 맞히는 문제가 늘고 있음"]);
    // 🔴 권민서A 실례 — 마지막 한 번만 아래로 다르면 그동안의 모습만(그 한 번은 본문·그래프 몫). 마지막이 오늘이면 '오늘'.
    const out = [row("2026-09-18", "일일 4/5", null), row("2026-09-29", "일일 5/5", null), row("2026-10-13", "일일 1/5", null)];
    expect(facts(out)).toEqual(["일일테스트: 그동안은 거의 다 맞히는 편이었음(가장 최근 한 번은 평소와 달랐지만 한 번은 흐름이 아님)"]);
    expect(facts(out, "2026-10-13")).toEqual(["일일테스트: 그동안은 거의 다 맞히는 편이었음(오늘 한 번은 평소와 달랐지만 한 번은 흐름이 아님)"]);
    // 위로 한 번 튐도 그동안의 모습만(그 한 번은 본문 몫 · 주의 문구와 맞물린다 — 적대적 리뷰 2026-10-16)
    expect(facts([row("2026-09-01", "일일 1/5", null), row("2026-09-08", "일일 1/5", null), row("2026-09-15", "일일 5/5", null)], "2026-09-15")).toEqual([
      "일일테스트: 그동안은 절반 아래로 맞히는 편이었음(오늘 한 번은 평소와 달랐지만 한 번은 흐름이 아님)",
    ]);
    // 🔴 오가는 기록의 평균은 정도가 아니다(폭 40%p 초과면 싣지 않는다) — 0개·5개를 오간 아이를 "절반 넘게"로 쓰지 않게(적대적 리뷰)
    expect(facts([row("2026-09-01", "일일 0/5", null), row("2026-09-03", "일일 5/5", null), row("2026-09-05", "일일 0/5", null), row("2026-09-08", "일일 5/5", null), row("2026-09-10", "일일 5/5", null)])).toEqual([]);
    expect(facts([row("2026-09-01", "일일 5/5", null), row("2026-09-08", "일일 5/5", null), row("2026-09-15", "일일 5/5", null)])).toEqual(["일일테스트: 모두 다 맞힘"]);
  });
  it("🔴 덜 맞히는 흐름은 줄을 만들지 않는다 — '덜 맞힘·줄었음'은 '점점 못해진다'로 읽힌다 · 정도(절반 아래)는 사실이라 싣는다", () => {
    expect(facts([row("2026-09-01", "확인 9/10", null), row("2026-09-08", "확인 7/10", null), row("2026-09-15", "확인 5/10", null)])).toEqual([]);
    expect(facts([row("2026-09-01", "일일 2/10", null), row("2026-09-03", "일일 3/10", null), row("2026-09-05", "일일 2/10", null)])).toEqual(["일일테스트: 절반 아래로 맞히는 편"]);
    expect(facts([row("2026-09-01", "일일 4/10", null), row("2026-09-03", "일일 4/10", null), row("2026-09-05", "일일 0/10", null)])).toEqual([
      "일일테스트: 그동안은 절반 아래로 맞히는 편이었음(가장 최근 한 번은 평소와 달랐지만 한 번은 흐름이 아님)",
    ]);
  });
  it("100점 만점 시험은 점수로 말한다(문항 수로 읽지 않는다)", () => {
    expect(facts([row("2026-06-11", "80/100", null), row("2026-06-18", "84/100", null), row("2026-06-25", "80/100", null)])).toEqual(["테스트: 대부분 맞히는 편"]);
    expect(facts([row("2026-06-11", "70/100", null), row("2026-06-18", "80/100", null), row("2026-06-25", "90/100", null)])).toEqual(["테스트: 최근 들어 점수가 오르고 있음"]);
    expect(facts([row("2026-06-11", "100/100", null), row("2026-06-18", "100/100", null), row("2026-06-25", "100/100", null)])).toEqual(["테스트: 모두 만점"]);
  });
  it("🔴 한 회차에 시험이 둘이면 시험마다 따로 줄을 세운다 — 일일 점수가 '확인테스트'로 나가지 않게(적대적 리뷰 2026-10-16)", () => {
    expect(facts([row("2026-07-01", "일일 4/5, 확인 8/10", "100%"), row("2026-07-08", "일일 5/5, 확인 7/10", "100%"), row("2026-07-15", "일일 4/5, 확인 9/10", "100%")])).toEqual([
      "일일테스트: 대부분 맞히는 편", // 4·5·4개 = 평균 87%
      "확인테스트: 대부분 맞히는 편",
      "과제: 최근 빠짐없이 잘 해 오고 있음",
    ]);
    // 만점이 같아도(실제 저장 형식) 둘로 읽는다.
    const same = facts([row("2026-07-01", "일일 15/20, 확인 18/20", null), row("2026-07-08", "일일 16/20, 확인 12/20", null), row("2026-07-15", "일일 17/20, 확인 19/20", null)]);
    expect(same).toEqual(["일일테스트: 최근 들어 맞히는 문제가 늘고 있음", "확인테스트: 대부분 맞히는 편"]);
  });
  it("사실 줄이 하나도 없으면(분모를 못 읽는 시험뿐) 새 소식도 없다 → quiet(자동작성 추세 칸만 비운다 · [기록]이 빈 채 문장을 요구하지 않는다)", () => {
    const i = buildTrendInput([row("2026-09-01", "80점", null), row("2026-09-08", "85점", null), row("2026-09-15", "90점", null)])!;
    expect(i.facts).toEqual([]);
    expect(i.quiet).toBe(true);
  });
});

// 원장 2026-10-16 "오늘은 7회 연속이라 말했는데, 다음엔 또 8회 연속이라는 같은 말을 반복할거 아냐. 완전 AI 티 팍팍 나네"
describe("trendNews — 지난 보고서와 달라진 것만", () => {
  const days = (n: number, value: string) => Array.from({ length: n }, (_, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`, null, value));
  it("🔴 같은 정도가 이어지기만 하면 말하지 않는다 — 횟수를 말하지 않으니 고비(5·10회)도 같은 문장이다", () => {
    // 앞 회차가 다른 정도여야 처음 이어진 회차가 소식이다(60%면 앞 회차가 이미 '대체로 잘 해 옴' — 같은 말).
    const lead = [row("2026-08-31", null, "20%")];
    expect(trendNews([row("2026-08-31", null, "60%"), ...days(3, "100%")], null)).toEqual([]);
    // 처음 3회에 닿은 회차는 새 소식.
    expect(trendNews([...lead, ...days(3, "100%")], null).map((f) => f.text)).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]);
    for (const n of [4, 5, 8, 10]) expect(trendNews([...lead, ...days(n, "100%")], null), String(n)).toEqual([]);
    // 100 → 90 → 80(같은 '잘 해 옴' 안의 출렁임)도 되풀이하지 않는다.
    expect(trendNews([...lead, ...days(5, "100%"), row("2026-09-08", null, "90%")], null)).toEqual([]);
  });
  it("정도가 바뀐 회차는 말한다 — '조금씩' → '잘 해 옴'", () => {
    const rows = [...days(4, "30%"), row("2026-09-08", null, "90%"), row("2026-09-10", null, "100%"), row("2026-09-12", null, "80%")];
    expect(trendNews(rows, null).map((f) => f.text)).toEqual(["과제: 최근 잘 해 오고 있는 편"]);
  });
  it("끝난 회차도, 그 뒤 '대체로'로 돌아온 회차도 말하지 않는다 · 경계 출렁임(80 ↔ 78)이 끝남·다시 이어짐으로 같은 말을 되풀이하지 않는다(재리뷰)", () => {
    const broke = [row("2026-08-31", null, "50%"), ...days(7, "100%"), row("2026-09-20", null, "60%")];
    expect(trendNews(broke, "2026-09-20")).toEqual([]);
    expect(trendNews([...broke, row("2026-09-22", null, "100%")], "2026-09-22")).toEqual([]);
    const vals = ["80%", "85%", "80%", "78%", "82%", "85%", "80%"];
    const said: TrendHistoryRow[] = [];
    const out: string[][] = [];
    vals.forEach((v, i) => {
      const r = row(`2026-09-${String(i + 1).padStart(2, "0")}`, null, v);
      const news = trendNews([...said, r], null).map((f) => f.text);
      out.push(news);
      said.push({ ...r, hadTrend: news.length > 0 });
    });
    expect(out.filter((n) => n.length)).toEqual([["과제: 최근 잘 해 오고 있는 편"]]);
  });
  it("시험 흐름이 바뀐 회차만 — '대체로'로 돌아온 건 말하지 않는다", () => {
    const up = [row("2026-09-01", "일일 5/10", null), row("2026-09-03", "일일 5/10", null), row("2026-09-05", "일일 6/10", null), row("2026-09-08", "일일 8/10", null)];
    expect(trendNews(up, null).map((f) => f.text)).toEqual(["일일테스트: 최근 들어 맞히는 문제가 늘고 있음"]);
    expect(trendNews([...up, row("2026-09-10", "일일 8/10", null)], null)).toEqual([]);
  });
  it("🔴 과제 '대체로'가 경계(80·50) 언저리에서 출렁여도 회차마다 뒤집어 말하지 않는다(적대적 리뷰 2026-10-16)", () => {
    const vals = ["80%", "80%", "70%", "90%", "70%", "90%", "70%", "90%"];
    const rows = vals.map((v, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`, null, v));
    for (let n = 4; n <= rows.length; n++) expect(trendNews(rows.slice(0, n), null), String(n)).toEqual([]);
    // 지난번이 '대체로 잘'이었어도 같다 — '대체로'끼리는 소식이 아니다.
    const said = rows.map((r, i) => ({ ...r, hadTrend: i === 3 }));
    expect(trendNews(said.slice(0, 5), null)).toEqual([]);
  });
  it("🔴 과제 '대체로'는 3회 이상 · 가장 최근 값도 같은 정도일 때만(본문의 오늘 값과 어긋나지 않게 — 적대적 리뷰 2026-10-16)", () => {
    const f = (vals: string[]) => trendFacts(vals.map((v, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`, null, v)), null).map((x) => x.text);
    expect(f(["40%", "0%"])).toEqual([]); // 본문 "하나도 해오지 못함"인데 추세 "조금씩"이면 어긋난다
    expect(f(["100%", "100%", "60%"])).toEqual([]); // 평균은 '잘'이지만 오늘은 '절반 이상'
    expect(f(["60%", "100%", "80%"])).toEqual(["과제: 최근 잘 해 오고 있는 편"]);
  });
  it("🔴 시험 '대체로'의 정도가 확연히 바뀌면 소식이다(지난번 말한 정도와 15%p 이상 — 경계 출렁임은 아님)", () => {
    const low: TrendHistoryRow[] = [
      { ...row("2026-08-01", "일일 2/5", null), hadTrend: false },
      { ...row("2026-08-03", "일일 3/5", null), hadTrend: false },
      { ...row("2026-08-05", "일일 2/5", null), hadTrend: true }, // "절반 아래로 맞히는 편" — 나감
    ];
    const high = ["2026-09-10", "2026-09-12", "2026-09-15"].map((d, i) => ({ ...row(d, `일일 ${i % 2 ? 5 : 4}/5`, null), hadTrend: false }));
    expect(trendNews([...low, ...high, row("2026-09-17", "일일 5/5", null)], null).map((f) => f.text)).toEqual(["일일테스트: 거의 다 맞히는 편"]);
    // 경계 언저리(대부분 ↔ 거의 다, 평균 차이 15%p 미만)는 뒤집어 말하지 않는다.
    const near: TrendHistoryRow[] = [
      { ...row("2026-09-01", "일일 8/10", null), hadTrend: false },
      { ...row("2026-09-03", "일일 9/10", null), hadTrend: false },
      { ...row("2026-09-05", "일일 8/10", null), hadTrend: true }, // 평균 83 '대부분'
      row("2026-09-08", "일일 10/10", null), // 평균 88 → 아직 '대부분'
    ];
    expect(trendNews(near, null)).toEqual([]);
    expect(trendNews([...near.slice(0, 3), { ...near[3]!, hadTrend: false }, row("2026-09-10", "일일 9/10", null)], null)).toEqual([]); // 평균 88 '대부분'
  });
  it("끝난 흐름을 이어진다고 쓴 글을 거르는 대조(findTrendContradictions)는 그대로 — 지금은 '막 끝남' 줄이 없어 운영에선 켜지지 않는다", () => {
    const ended = buildTrendInput([row("2026-08-31", null, "60%"), ...days(4, "30%"), row("2026-09-20", null, "90%")], { today: "2026-09-20" })!;
    expect(ended.facts).toEqual([]);
    expect(ended.streakEnded).toBe(false);
    expect(trendBody({ ...ended, facts: ["과제: 최근 잘 해 오고 있는 편"] })).not.toContain(TREND_STREAK_ENDED_NOTE);
    const i = { streakEnded: true };
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
    const on = buildTrendInput([row("2026-08-31", null, "60%"), ...days(3, "100%")])!;
    expect(on.streakEnded).toBe(false);
    expect(findTrendContradictions(on, "과제를 다섯 번 연속 빠짐없이 잘 해 오고 있습니다.")).toEqual([]);
  });
  it("🔴 주 1회 수업 — 창(30일)에 늘 같은 횟수가 들어와도 같은 정도면 매주 말하지 않는다(적대적 재리뷰 2026-10-16)", () => {
    expect(trendNews(days(5, "100%"), null)).toEqual([]);
    expect(trendNews(days(10, "100%"), null)).toEqual([]);
    expect(trendNews(days(3, "100%"), null).map((f) => f.text)).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]);
    expect(trendNews([...days(8, "100%"), row("2026-09-20", null, "60%")], "2026-09-20")).toEqual([]);
  });
  it("🔴 항목마다 그 항목을 말할 수 있었던 회차와 견준다 — 마지막 추세 회차에 과제 줄이 없었다고 같은 말을 다시 하지 않는다(재리뷰)", () => {
    const rows: TrendHistoryRow[] = [
      { ...row("2026-09-01", null, "100%"), hadTrend: false },
      { ...row("2026-09-03", null, "100%"), hadTrend: false },
      { ...row("2026-09-05", null, "100%"), hadTrend: true }, // "최근 빠짐없이 잘 해 오고 있음" — 나감
      { ...row("2026-09-08", "일일 5/10", "60%"), hadTrend: false },
      { ...row("2026-09-10", "일일 6/10", "100%"), hadTrend: false },
      { ...row("2026-09-12", "일일 8/10", "60%"), hadTrend: true }, // 시험 '늘고 있음'만 나감 — 그날 과제 줄은 없었다
      row("2026-09-15", null, "100%"),
      row("2026-09-17", null, "100%"),
    ];
    const news = trendNews(rows, null).map((f) => f.text);
    expect(news.some((t) => t.startsWith("과제:"))).toBe(false);
  });
  it("🔴 미제출과 0%는 다른 값 — 한 묶음·한 '대체로'로 묶지 않는다(학부모 글에선 '안 내 옴'과 '못 해 옴'이 갈린다)", () => {
    const f = (rows: TrendHistoryRow[]) => trendFacts(rows, null).map((x) => x.text);
    expect(f([row("2026-09-01", null, "미제출"), row("2026-09-03", null, "미제출"), row("2026-09-05", null, "0%")])).toEqual([]);
    expect(f([row("2026-09-01", null, "40%"), row("2026-09-03", null, "미제출"), row("2026-09-05", null, "30%")])).toEqual([]);
    // 미제출 사이에 낀 '조금씩'이 그 앞뒤와 이어져 연속이 되지 않는다.
    expect(f([row("2026-09-01", null, "30%"), row("2026-09-03", null, "미제출"), row("2026-09-05", null, "30%"), row("2026-09-07", null, "30%")])).toEqual([]);
  });
  it("🔴 지난번 실제로 추세가 나간 회차와 견준다 — 정도가 바뀐 회차의 추세가 안 나갔으면 다음 회차가 잇는다", () => {
    const rows: TrendHistoryRow[] = [
      { ...row("2026-08-31", null, "60%"), hadTrend: false },
      { ...row("2026-09-01", null, "30%"), hadTrend: false },
      { ...row("2026-09-02", null, "30%"), hadTrend: false },
      { ...row("2026-09-03", null, "30%"), hadTrend: true }, // '조금씩' — 나감
      { ...row("2026-09-04", null, "100%"), hadTrend: false },
      { ...row("2026-09-05", null, "100%"), hadTrend: false },
      { ...row("2026-09-07", null, "100%"), hadTrend: false }, // '잘 해 옴'이 처음 이어진 회차 — 그 회차 추세는 버려짐(안 나감)
      row("2026-09-08", null, "100%"), // 이번 회차
    ];
    expect(trendNews(rows, null).map((f) => f.text)).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]);
    // 그 회차의 추세가 나갔으면 이번엔 되풀이
    const sent = rows.map((r, i) => (i === 6 ? { ...r, hadTrend: true } : r));
    expect(trendNews(sent, null)).toEqual([]);
    // 끝난 회차의 추세가 안 나갔으면, 그 뒤 '대체로'(같은 정도)로 돌아온 회차는 지난번 말한 정도와 같아 되풀이하지 않는다
    const unsaid: TrendHistoryRow[] = [...rows.slice(0, 4), { ...row("2026-09-04", null, "60%"), hadTrend: false }, row("2026-09-05", null, "30%")];
    expect(trendNews(unsaid, null)).toEqual([]);
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
    // 일일테스트는 덜 맞히는 흐름이라 줄이 없고(부정어), 확인테스트는 2회라 흐름이 아니다 — 시험 줄이 없어 추세 입력은 quiet.
    expect(trendFacts([row("2026-07-01", "일일 4/5", null), row("2026-07-08", "일일 5/5, 확인 8/10", null), row("2026-07-15", "일일 4/5, 확인 9/10", null), row("2026-07-22", "일일 5/5", null)], null)[0]!.text).toBe(
      "일일테스트: 거의 다 맞히는 편",
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
    // 같은 정도가 이어지기만 하면 quiet.
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
    // '3일 연속'·'주 2회'는 날짜가 아니다(숫자로는 걸린다 — 아래).
    for (const s of ["과제를 3일 연속 해 왔어요.", "주 2회 수업에서 일일테스트를 꾸준히 맞히고 있어요."]) expect(findTrendViolations(s), s).not.toContain("날짜");
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
  it("🔴 숫자·횟수 — [기록]에 없으니 문장에 나오면 지어냈거나 본문에서 끌어온 것(원장 2026-10-16 '어차피 추세선에 나옴')", () => {
    for (const s of [
      "과제는 최근에 100%를 두 번 해 왔고, 한 번은 80%였어요.", // 원장 화면의 실례
      "일일테스트는 그동안 5문제 중 4~5개를 맞혀 왔어요.",
      "최근 일곱 번 연속 과제를 빠짐없이 해 오고 있습니다.",
      "과제를 세 번 연속 잘 해 왔습니다.",
      "과제를 팔십 퍼센트 정도 해 오고 있습니다.",
    ])
      expect(findTrendViolations(s), s).toContain("숫자");
    // '한 번은'(한 번 튐)은 횟수가 아니다
    expect(findTrendViolations("일일테스트는 그동안 대부분 맞혀 왔고, 한 번은 평소와 달랐습니다.")).toEqual([]);
  });
  it("🔴 나빠지는 흐름으로 묶는 말 — '점점 못해진다. 이런거 정도가 아니면 되는거지'(원장 2026-10-16)", () => {
    for (const s of [
      "과제를 점점 못해 오고 있습니다.",
      "갈수록 덜 맞히고 있습니다.",
      "예전만큼 맞히지 못하고 있습니다.",
      "예전보다 과제를 덜 해 옵니다.",
      "최근 맞히는 문제가 조금씩 줄고 있습니다.",
      "점수가 조금씩 낮아지고 있습니다.",
      "지난번보다 적게 맞혔습니다.",
    ])
      expect(findTrendViolations(s), s).toContain("나빠지는 흐름");
    // 사실 그대로의 부정·긍정의 '~지 않고'·나아지는 비교는 통과
    for (const s of [
      "그동안 과제를 해 오지 못했습니다.",
      "최근 과제를 제출하지 않고 있습니다.",
      "일일테스트는 절반 아래로 맞히는 편입니다.",
      "과제를 늘 거르지 않고 해 왔어요.",
      "한 번도 빠지지 않고 과제를 해 왔습니다.",
      "예전보다 과제를 잘 해 오고 있습니다.",
      "점점 더 많이 맞히고 있습니다.",
      // 줄어드는 것이 틀린 것이면 좋아지는 말이다(재리뷰 2026-10-16)
      "틀리는 문제가 점점 줄고 있습니다.",
      "전보다 덜 틀리고 있습니다.",
      "오답이 갈수록 줄어들고 있습니다.",
      "점수가 내려가지 않고 꾸준합니다.",
      "점수가 낮아도 끝까지 풀어 냅니다.",
    ])
      expect(findTrendViolations(s), s).toEqual([]);
    // 같은 글이라도 다른 마디의 '틀린'은 나빠지는 말을 덮지 않는다
    expect(findTrendViolations("틀린 문제는 다시 풀었지만, 점점 덜 맞히고 있습니다.")).toContain("나빠지는 흐름");
  });
  it("✅ 평범한 추세 문장은 통과", () => {
    expect(findTrendViolations("최근에는 과제를 잘 해 오고 있는 편입니다.")).toEqual([]);
    expect(findTrendViolations("그동안 과제는 빠짐없이 잘 해 왔습니다.")).toEqual([]);
    expect(findTrendViolations("과제는 꾸준히 챙겨 오고 있습니다.")).toEqual([]);
    expect(findTrendViolations("확인테스트에서 맞히는 문제가 늘고 있습니다.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 그동안 대부분의 문제를 꾸준히 맞혀 왔습니다.")).toEqual([]);
    expect(findTrendViolations("일일테스트는 꾸준히 맞히고 있어요.")).toEqual([]); // '일일'은 날짜가 아니다
    expect(findTrendViolations("과제를 절반 이상 해 오는 편입니다.")).toEqual([]);
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
  it("100점 만점 시험은 [기록]에 '점수'로 — 문항 수('100문제')로 읽지 않는다", () => {
    const input = buildTrendInput([row("2026-06-11", "80/100", null), row("2026-06-18", "84/100", null), row("2026-06-25", "88/100", null)])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain("- 테스트: 최근 들어 점수가 오르고 있음");
    expect(p).not.toContain("100문제");
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
    expect(input!.facts).toEqual(["과제: 최근 제출하지 않고 있음"]);
    expect(buildTrendInput([row("2026-05-28", null, "20%"), row("2026-06-01", null, "100%"), row("2026-06-04", null, "90%"), row("2026-06-08", null, "100%")])!.facts).toEqual([
      "과제: 최근 잘 해 오고 있는 편",
    ]);
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
