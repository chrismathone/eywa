import { describe, expect, it } from "vitest";
import { ASSISTANT_SUGGESTIONS } from "./protocol";
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  haveKey,
  newSuggestionTexts,
  nextSuggestionCache,
  parseSuggestionCache,
  scoreSignals,
  wonLabel,
  type SuggestionSignals,
} from "./suggestions";

const TODAY = "2026-11-06";

describe("추천 질문 — 신호 → 질문", () => {
  it("신호가 없으면 고정 문장 6개 그대로", () => {
    expect(buildSuggestions({}, TODAY)).toEqual(ASSISTANT_SUGGESTIONS.map((text) => ({ text, key: `static:${text}` })));
  });

  it("심한 신호부터 · 같은 주제의 고정 문장은 빼고 나머지로 채운다", () => {
    const signals: SuggestionSignals = {
      absence: { recent: 30, before: 20, students: 5 },
      unpaid: { count: 10, won: 948_750, old: 2 },
      classDrop: { className: "중등M 중2 EL3N", n0: 30, p0: 28, n1: 45, p1: 32 },
    };
    const out = buildSuggestions(signals, TODAY);
    expect(out).toHaveLength(6);
    expect(out[0]!.text).toBe("'중등M 중2 EL3N' 출석률이 93%에서 71%로 떨어졌어 — 원인을 분석해 줘");
    expect(out[1]!.text).toBe("최근 2주 결석이 3번 이상인 원생 5명 — 누구이고 왜 그런지 분석해 줘");
    expect(out[1]!.reason).toBe("최근 2주 결석 30번 · 그 전 2주 20번(빠진 수업 단위)");
    expect(out[2]!.text).toBe("미납 10건(합계 95만 원) — 반별·청구 달별로 정리하고 오래된 것부터 알려 줘");
    expect(out[2]!.reason).toBe("2달 넘은 미납 2건");
    // 결석·미납 신호가 있으니 그 주제의 고정 문장은 없다 — 나머지 고정 문장이 순서대로 채운다.
    expect(out.slice(3).map((s) => s.text)).toEqual(["이번 달 신규·퇴원 추이를 지난 6개월과 비교해 줘", "강사별 이번 달 수업보고서 작성률", "과목·학년별 재원생 구성"]);
    expect(out.map((s) => s.text)).not.toContain("미납 현황을 반별로 정리해 줘");
    expect(out.map((s) => s.text)).not.toContain("최근 2주 결석이 늘어난 원생은?");
  });

  it("심하지 않은 신호는 내지 않는다(출석률 5%p 미만 · 결석 원생 적고 줄어듦 · 상담 5건 미만 · 미납 0건)", () => {
    const signals: SuggestionSignals = {
      classDrop: { className: "A반", n0: 40, p0: 38, n1: 40, p1: 37 },
      absence: { recent: 5, before: 9, students: 2 },
      conversion: { consulted: 4, enrolled: 1 },
      unpaid: { count: 0, won: 0, old: 0 },
      consult: { noRecent: 3, overdue: 0 },
      exams: { schools: 0, earliest: null },
    };
    expect(scoreSignals(signals, TODAY)).toEqual([]);
  });

  it("퇴원이 평소보다 많으면 위로 · 평소 수준이면 낮은 점수로 뒤에 · 퇴원일 이번 달 1일~오늘", () => {
    const high = scoreSignals({ withdrawals: { thisMonth: 6, prev6: 12, scheduled: 1 } }, TODAY)[0]!;
    const low = scoreSignals({ withdrawals: { thisMonth: 2, prev6: 30, scheduled: 0 } }, TODAY)[0]!;
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.text).toBe("이번 달 퇴원 6명 — 지난 6개월 평균(월 2명)과 비교해 사유와 공통점을 분석해 줘");
    expect(high.reason).toBe("퇴원 예정 1명 더 있음 · 퇴원일이 이번 달 1일~오늘 · 실제 퇴원만");
    expect(high.key).toBe("withdrawals");
  });

  it("내신이 가까우면 D-day를 근거에 · 적어 둔 시험 일정 기준임을 밝힌다", () => {
    const [exam] = scoreSignals({ exams: { schools: 3, earliest: "2026-11-12" } }, TODAY);
    expect(exam!.text).toBe("3주 안에 내신이 시작하는 학교 3곳 — 해당 학생들의 출석·숙제·진도 준비 상태를 점검해 줘");
    expect(exam!.reason).toBe("가장 이른 시험 11월 12일(D-6) · 학원 설정에 적어 둔 시험 일정 기준");
  });

  it("후속조치·오래 상담 안 한 재원생 · 신규 상담 등록률", () => {
    const out = scoreSignals({ consult: { noRecent: 72, overdue: 4 }, conversion: { consulted: 20, enrolled: 6 } }, TODAY);
    expect(out.map((s) => s.text)).toEqual([
      "기한이 지난 상담 후속조치 4건 — 누구 것이고 무엇이 남았는지 정리해 줘",
      "석 달 넘게 상담 기록이 없는 재원생 72명 — 누구부터 상담하면 좋을지 정리해 줘",
      "최근 한 달 신규 상담 20건 중 등록 6건 — 등록하지 않은 상담의 공통점을 분석해 줘",
    ]);
    expect(out.map((s) => s.key)).toEqual(["consult.overdue", "consult.noRecent", "conversion"]);
  });

  it("금액 표기 — 만 원 단위", () => {
    expect(wonLabel(9_500)).toBe("9,500원");
    expect(wonLabel(948_750)).toBe("95만 원");
    expect(wonLabel(12_345_678)).toBe("1,235만 원");
  });
});

describe("추천 질문 — 브라우저 묶음 · NEW(주제 열쇠 · 바뀐 그날만)", () => {
  const A = [{ text: "미납 10건(합계 95만 원) — …", key: "unpaid" }, { text: "과목·학년별 재원생 구성", key: "static:과목·학년별 재원생 구성" }];
  const A2 = [{ text: "미납 11건(합계 99만 원) — …", key: "unpaid" }, { text: "과목·학년별 재원생 구성", key: "static:과목·학년별 재원생 구성" }];
  const B = [{ text: "'중2 A반' 출석률이 …", key: "classDrop:중2 A반" }, { text: "미납 11건(합계 99만 원) — …", key: "unpaid" }];
  const NEXT = "2026-11-07";

  it("처음이면 직전 묶음 = 고정 문장 → 신호 질문만 NEW(고정 문장엔 안 붙는다)", () => {
    const c = nextSuggestionCache(null, "s1", TODAY, A);
    expect(c.prev).toEqual(FALLBACK_SUGGESTIONS.map((f) => f.key));
    expect(c.newDay).toBe(TODAY);
    expect([...newSuggestionTexts(c, TODAY)]).toEqual(["미납 10건(합계 95만 원) — …"]);
  });

  it("숫자만 바뀌면 NEW가 아니다 · NEW는 묶음이 바뀐 그날에만", () => {
    const first = nextSuggestionCache(null, "s1", TODAY, A);
    const numbersOnly = nextSuggestionCache(first, "s1", NEXT, A2);
    expect(numbersOnly.prev).toEqual(first.prev);
    expect(numbersOnly.newDay).toBe(TODAY);
    expect([...newSuggestionTexts(numbersOnly, NEXT)]).toEqual([]);
    // 같은 날에는 그대로 보인다
    expect([...newSuggestionTexts(first, TODAY)]).toEqual(["미납 10건(합계 95만 원) — …"]);
  });

  it("새 주제가 오면 그것만 NEW(그날)", () => {
    const first = nextSuggestionCache(null, "s1", TODAY, A);
    const changed = nextSuggestionCache(first, "s1", NEXT, B);
    expect(changed.prev).toEqual(["unpaid", "static:과목·학년별 재원생 구성"]);
    expect(changed.newDay).toBe(NEXT);
    expect([...newSuggestionTexts(changed, NEXT)]).toEqual(["'중2 A반' 출석률이 …"]);
  });

  it("다른 사람(scope)의 묶음은 이어 쓰지 않는다", () => {
    const mine = nextSuggestionCache(null, "s1", TODAY, A);
    const other = nextSuggestionCache(mine, "s2", TODAY, A);
    expect(other.prev).toEqual(FALLBACK_SUGGESTIONS.map((f) => f.key));
  });

  it("저장된 글 읽기 — 모양이 틀리면 버린다(옛 판 v1 포함)", () => {
    const c = nextSuggestionCache(null, "s1", TODAY, A);
    expect(parseSuggestionCache(JSON.stringify(c))).toEqual(c);
    expect(parseSuggestionCache(null)).toBeNull();
    expect(parseSuggestionCache("{")).toBeNull();
    expect(parseSuggestionCache(JSON.stringify({ ...c, v: 1 }))).toBeNull();
    expect(parseSuggestionCache(JSON.stringify({ ...c, items: [{ text: "" }] }))).toBeNull();
    expect(parseSuggestionCache(JSON.stringify({ ...c, prev: [1] }))).toBeNull();
  });

  it("have 표 = 사람.날짜", () => {
    expect(haveKey("s1", TODAY)).toBe("s1.2026-11-06");
  });
});
