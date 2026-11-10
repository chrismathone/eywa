import { describe, expect, it } from "vitest";
import { buildFlowPrompt, latestAt, parseFlowInsight, splitNewRecords, type FlowInsight } from "./flow-insight";

const prior: FlowInsight = {
  headline: "학습 습관 상담이 이어지고 있습니다.",
  direction: "stable",
  themes: ["숙제 이행", "어휘"],
  recentChange: "",
  watch: ["시험 뒤 상담 요청"],
  nextSteps: ["다음 상담에서 숙제 이행 확인"],
  basis: "2026-03~2026-09 상담 5건",
};

/** 판단 기준일·지금 상태·최근성 재료(원장 2026-11-06) — 시험은 날짜를 고정한다. */
const NOW = { today: "2026-11-06", standing: "재원 — 수강 중 PL6", latest: "2026-09-29T10:00:00+09:00", recent: 1 };

describe("합산 — 이전 분석 뒤의 기록만 새 기록", () => {
  const records = [
    { at: "2026-05-13T10:00:00+09:00", text: "중간고사 상담" },
    { at: "2026-07-28T10:00:00+09:00", text: "기말 상담" },
    { at: "2026-09-29T10:00:00+09:00", text: "9월 상담" },
  ];
  it("coveredThrough 뒤의 것만, 같은 시각은 이미 반영", () => {
    expect(splitNewRecords(records, "2026-07-28T10:00:00+09:00").map((r) => r.at.slice(0, 10))).toEqual(["2026-09-29"]);
    expect(splitNewRecords(records, null)).toHaveLength(3);
    expect(latestAt(records)).toBe("2026-09-29T10:00:00+09:00");
    expect(latestAt([])).toBeNull();
  });

  it("첫 분석은 전체, 그 뒤는 이전 분석 + 새 기록 + 합산 지시", () => {
    const first = buildFlowPrompt("consultations", { studentLabel: "김민준(중2)", prior: null, priorThrough: null, records, totalCount: 3, ...NOW });
    expect(first.prompt).toContain("처음 분석");
    expect(first.prompt).not.toContain("이전 분석");
    expect(first.system).toContain("JSON");
    const next = buildFlowPrompt("timeline", { studentLabel: "김민준(중2)", prior, priorThrough: "2026-07-28T10:00:00+09:00", records: records.slice(2), totalCount: 3, ...NOW });
    expect(next.prompt).toContain("이전 분석(2026-07-28까지 반영)");
    expect(next.prompt).toContain(JSON.stringify(prior));
    expect(next.prompt).toContain("합산");
    expect(next.prompt).toContain("[2026-09-29 · 38일 전] 9월 상담");
    expect(next.system).toContain("타임라인");
  });
});

describe("응답 검증 — 모양이 틀리면 저장하지 않는다", () => {
  it("정상 응답은 그대로, 방향 값이 어긋나거나 항목이 넘치면 거절", () => {
    expect(parseFlowInsight(prior)).toEqual(prior);
    expect(() => parseFlowInsight({ ...prior, direction: "great" })).toThrow();
    expect(() => parseFlowInsight({ ...prior, headline: "" })).toThrow();
    expect(() => parseFlowInsight({ ...prior, themes: "숙제" })).toThrow();
    expect(() => parseFlowInsight({ ...prior, watch: [3] })).toThrow();
    expect(() => parseFlowInsight(null)).toThrow();
  });
  it("넘친 길이·개수는 다듬어 받는다(2026-11-11 운영 — 주제 60자 초과로 갱신이 통째로 실패) · 손댄 칸 이름만 알린다", () => {
    const long = "가".repeat(61);
    const seen: string[][] = [];
    const out = parseFlowInsight({ ...prior, themes: [...Array(7).fill("주제"), long], watch: ["", "  상담 이어 보기  "] }, (f) => seen.push(f));
    expect(out.themes).toEqual(Array(6).fill("주제"));
    expect(out.watch).toEqual(["상담 이어 보기"]);
    expect(seen).toEqual([["themes", "watch"]]);
    const quiet: string[][] = [];
    expect(parseFlowInsight(prior, (f) => quiet.push(f))).toEqual(prior);
    expect(quiet).toEqual([]);
  });
});

describe("‘지금’의 재료와 규칙 — 오래된 기록으로 지금을 단정하지 않는다(원장 2026-11-06)", () => {
  const april = [
    { at: "2026-03-12T07:00:00+00:00", text: "앞부분 빠진 내용 보강 요청" },
    { at: "2026-04-27T16:30:00+00:00", text: "쓰기·문장읽기 칭찬 · 어머니 감사" }, // KST 2026-04-28 01:30 — UTC 날짜(04-27)로 적으면 안 된다
  ];
  it("오늘 · 지금 상태 · 마지막 기록과 석 달 건수 · 기록마다 경과를 넘기고, 날짜는 KST로 적는다", () => {
    const { prompt } = buildFlowPrompt("consultations", { studentLabel: "김상민(중1)", prior: null, priorThrough: null, records: april, totalCount: 2,
      today: "2026-11-06", standing: "재원 — 수강 중 PL6, LE2", latest: april[1]!.at, recent: 0 });
    expect(prompt).toContain("오늘(판단 기준일): 2026-11-06");
    expect(prompt).toContain("지금 상태: 재원 — 수강 중 PL6, LE2");
    expect(prompt).toContain("가장 최근 상담: 2026-04-28 · 약 6개월 전 · 최근 90일 상담 0건");
    expect(prompt).toContain("- [2026-04-28 · 약 6개월 전] 쓰기·문장읽기 칭찬");
    expect(prompt).not.toContain("[2026-04-27");
  });
  it("규칙 — direction은 오늘 기준 · 먼저 맞는 규칙 하나(퇴원 → 90일 공백 → 그 밖) · 옛 걱정은 '그때의 판단' · 칭찬 한 번은 흐름이 아니다", () => {
    const { system, prompt } = buildFlowPrompt("timeline", { studentLabel: "김상민", prior: null, priorThrough: null, records: april, totalCount: 2, ...NOW });
    expect(system).toContain("direction은 오늘(판단 기준일) 기준의 방향입니다");
    expect(system).toContain("먼저 맞는 규칙 하나");
    expect(system).toContain(
      "① 지금 상태가 퇴원: 지금 다니지 않아 지금의 흐름은 없습니다 — direction은 퇴원 전 기록에 걱정 신호가 있었으면 concern(그때의 판단), 아니면 unknown입니다",
    );
    expect(system).toContain("퇴원일이 없으면 날짜를 만들지 않습니다");
    expect(system).toContain(
      "② 90일 안에 기록이 하나도 없음: 지금 흐름은 판단하지 않습니다 — direction은 그때 기록에 걱정 신호가 있었으면 concern(그때의 판단), 아니면 unknown입니다",
    );
    expect(system).toContain("'최근 90일 새 기록 없음 — 마지막 기록 YYYY-MM-DD'로 시작");
    expect(system).toContain("그때의 걱정 신호는 watch에 그 날짜와 함께 적습니다");
    expect(system).toContain("오래된 기록의 좋고 나쁨을 지금의 일처럼 쓰지 않습니다");
    expect(system).toContain("칭찬·감사 한 번은 흐름이 아닙니다");
    expect(system).toContain("최근 90일 안의 퇴원·휴원 언급");
    // 퇴원 규칙이 90일 규칙보다 앞(퇴원생은 대개 90일 넘게 기록이 없다 — 두 headline 지시가 부딪히지 않게).
    expect(system.indexOf("① 지금 상태가 퇴원")).toBeLessThan(system.indexOf("② 90일 안에"));
    expect(system).not.toContain("걱정 신호만 있었다면 concern");
    expect(system).not.toContain("'퇴원(YYYY-MM-DD)'");
    expect(system).not.toContain("3개월"); // 달력 석 달과 90일 경계가 어긋나지 않게 — 날수로만
    // 지금 휴원 = 원생 전체만 · 반 하나 쉬는 것은 과목 대기(원장 2026-09-16) · 휴원 시작일은 재료에 없다(짐작 금지).
    expect(system).toContain("지금 휴원은 지금 상태 줄의 '휴원(원생 전체)'뿐입니다");
    expect(system).toContain("'대기 중인 반'은 그 반만 쉬는 것(과목 대기)이라 휴원이라 부르지 않고");
    expect(system).toContain("휴원을 시작한 날은 재료에 없으니 짐작해 적지 않습니다");
    expect(system).not.toContain("휴원 전 기록과 휴원 뒤 기록을 구분");
    // '달라진 점' 지시는 한 곳(90일 안 · 합산이면 새 기록) — 첫 분석 문구가 따로 말하지 않는다.
    expect(system).toContain("recentChange는 최근 90일 안의 기록(합산이면 그중 이번에 더한 새 기록)에서 보이는 변화만");
    expect(prompt).toContain("전체 기록을 처음 분석합니다.");
    expect(prompt).not.toContain("recentChange");
  });
  it("합산할 때도 이전 분석의 방향을 그대로 옮기지 않는다", () => {
    const { prompt } = buildFlowPrompt("consultations", { studentLabel: "김상민", prior, priorThrough: "2026-04-27T16:30:00+00:00", records: [{ at: "2026-11-05T09:00:00+09:00", text: "11월 상담" }], totalCount: 3, ...NOW });
    expect(prompt).toContain("이전 분석(2026-04-28까지 반영)");
    expect(prompt).toContain("이전 분석의 방향을 그대로 옮기지 않습니다");
  });
});
