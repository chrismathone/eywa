import { describe, expect, it } from "vitest";
import { FLOW_STALE_DAYS, daysBetween, elapsedLabel, flowCardState, flowRecency, isFutureBasis, recentCount, recordDay, settleDirection, upToToday } from "./flow-recency";

/** 원장 2026-11-06 — 4월 28일 상담만 보고 11월 6일에 '좋아지는 중'. 날짜는 고정한다. */
const TODAY = "2026-11-06";

describe("날짜 — 기록 시각은 KST 날짜로 · 경과 표기", () => {
  it("시각은 KST 날짜(새벽 상담이 하루 앞당겨지지 않는다) · 날짜는 그대로", () => {
    expect(recordDay("2026-04-27T16:30:00+00:00")).toBe("2026-04-28");
    expect(recordDay("2026-04-28")).toBe("2026-04-28");
  });
  it("날수와 경과 표기(앞날은 'N일 뒤')", () => {
    expect(daysBetween("2026-04-28", TODAY)).toBe(192);
    expect(daysBetween("bad", TODAY)).toBeNull();
    expect(elapsedLabel(0)).toBe("오늘");
    expect(elapsedLabel(38)).toBe("38일 전");
    expect(elapsedLabel(192)).toBe("약 6개월 전");
    expect(elapsedLabel(-25)).toBe("25일 뒤");
  });
  it("석 달(90일)까지는 최근, 하루라도 넘으면 오래됨 · 기록이 없으면 판정 없음", () => {
    expect(FLOW_STALE_DAYS).toBe(90);
    expect(flowRecency("2026-08-08", TODAY)).toEqual({ lastOn: "2026-08-08", days: 90, stale: false });
    expect(flowRecency("2026-08-07", TODAY)).toEqual({ lastOn: "2026-08-07", days: 91, stale: true });
    expect(flowRecency(null, TODAY)).toBeNull();
  });
  it("최근 석 달 건수 — 오늘 이후(미래 날짜)와 석 달 밖은 세지 않는다", () => {
    const records = [{ at: "2026-04-28T10:00:00+09:00" }, { at: "2026-09-01" }, { at: "2026-11-06T08:00:00+09:00" }, { at: "2026-11-10" }];
    expect(recentCount(records, TODAY)).toBe(2);
  });
  it("예정 기록(오늘 뒤 — 시간표 가져오기 적용일 등)은 흐름에 넣지 않는다 · 오늘은 넣는다(KST)", () => {
    const records = [{ at: "2026-04-28" }, { at: "2026-11-06T14:59:59+00:00" }, { at: "2026-11-06T15:00:00+00:00" }, { at: "2026-12-01" }];
    expect(upToToday(records, TODAY).map((r) => r.at)).toEqual(["2026-04-28", "2026-11-06T14:59:59+00:00"]);
  });
});

describe("앞날 반영 시점(11-06 전 분석 — 예정 수강을 기록으로 셌다)", () => {
  it("반영 시점이 오늘(KST) 뒤면 앞날 · 오늘·과거·없음은 아니다", () => {
    expect(isFutureBasis("2026-12-01T00:00:00+00:00", TODAY)).toBe(true);
    expect(isFutureBasis("2026-11-06T14:59:59+00:00", TODAY)).toBe(false);
    expect(isFutureBasis("2026-11-06T15:00:00+00:00", TODAY)).toBe(true);
    expect(isFutureBasis(null, TODAY)).toBe(false);
  });
});

describe("저장 직전 바로잡기 — 오래됨·퇴원이면 판단 보류(걱정은 그때의 판단으로 남김) · 최근 기록 하나로 '좋아지는 중' 금지", () => {
  it.each([
    ["improving", { stale: true, withdrawn: false, recent: 0 }, "unknown"],
    ["stable", { stale: true, withdrawn: false, recent: 0 }, "unknown"],
    ["concern", { stale: true, withdrawn: false, recent: 0 }, "concern"],
    ["mixed", { stale: false, withdrawn: true, recent: 3 }, "unknown"],
    ["concern", { stale: false, withdrawn: true, recent: 3 }, "concern"],
    ["improving", { stale: false, withdrawn: false, recent: 2 }, "improving"],
    ["improving", { stale: false, withdrawn: false, recent: 1 }, "unknown"],
    ["stable", { stale: false, withdrawn: false, recent: 1 }, "stable"],
    ["concern", { stale: false, withdrawn: false, recent: 1 }, "concern"],
  ] as const)("%s · %o → %s", (direction, ctx, want) => {
    expect(settleDirection(direction, ctx)).toBe(want);
  });
});

describe("카드 — 보는 날 기준 배지·안내(저장된 분석이 오래됐어도)", () => {
  const enrolled = { status: "enrolled", withdrawnOn: null };
  const base = { unit: "상담", coveredThrough: "2026-04-27T16:30:00+00:00", today: TODAY, standing: enrolled };
  const april = ["2026-03-12T07:00:00+00:00", "2026-04-27T16:30:00+00:00"];
  const OLD = "이 분석은 2026-04-28(약 6개월 전)까지의 상담을 본 것이라 지금 흐름은 판단하지 않습니다.";
  it("재원생 · 4월 상담까지 본 분석 · '좋아지는 중' → 판단 보류 + 분석이 본 날짜(원장 제보)", () => {
    expect(flowCardState({ ...base, direction: "improving", actualAts: april })).toEqual({ badge: "unknown", notice: OLD });
  });
  it("🔴 '새 상담이 없다'고 단정하지 않는다 — 빈 목록은 강사 범위·조회 오류일 수 있다 · 실제 기록을 모르면(타임라인) 같은 문장", () => {
    expect(flowCardState({ ...base, direction: "improving", actualAts: [] }).notice).toBe(OLD);
    expect(flowCardState({ ...base, unit: "기록", direction: "stable", actualAts: null })).toEqual({
      badge: "unknown",
      notice: "이 분석은 2026-04-28(약 6개월 전)까지의 기록을 본 것이라 지금 흐름은 판단하지 않습니다.",
    });
  });
  it("오래된 걱정(concern)도 배지는 판단 보류 — 그때 판단은 안내에 남긴다", () => {
    expect(flowCardState({ ...base, direction: "concern", actualAts: april })).toEqual({
      badge: "unknown",
      notice: "이 분석은 2026-04-28(약 6개월 전)까지의 상담을 본 것이라 지금 흐름은 판단하지 않습니다(그때 판단: 주의).",
    });
  });
  it("분석 뒤 상담이 보이면(분석 갱신을 안 부르는 저장 경로) '아직 반영 전' · 앞날 상담은 세지 않는다", () => {
    const s = flowCardState({
      ...base,
      direction: "improving",
      actualAts: [...april, "2026-10-20T01:00:00+00:00", "2026-10-28T05:00:00+00:00", "2026-11-20T01:00:00+00:00"],
    });
    expect(s).toEqual({ badge: "unknown", notice: `${OLD} 그 뒤 상담 2건(마지막 2026-10-28)은 아직 분석에 반영되지 않았습니다.` });
    const recent = flowCardState({
      ...base,
      coveredThrough: "2026-10-01T01:00:00+00:00",
      direction: "improving",
      actualAts: ["2026-10-01T01:00:00+00:00", "2026-11-05T15:30:00+00:00"],
    });
    expect(recent).toEqual({ badge: null, notice: "그 뒤 상담 1건(마지막 2026-11-06)은 아직 분석에 반영되지 않았습니다." });
  });
  it("퇴원생 = 원생 상태 배지 + 이 분석이 언제까지의 흐름인지 · 퇴원일이 없으면 날짜 없이 · 걱정은 '분석 판단'/'그때 판단'으로", () => {
    const w = { status: "withdrawn", withdrawnOn: "2026-11-03" };
    expect(flowCardState({ ...base, coveredThrough: "2026-11-01", direction: "improving", standing: w, actualAts: null })).toEqual({
      badge: "status",
      notice: "퇴원(2026-11-03) — 이 분석은 2026-11-01(5일 전)까지의 상담 흐름입니다.",
    });
    expect(flowCardState({ ...base, coveredThrough: "2026-11-01", direction: "concern", standing: w, actualAts: null }).notice).toBe(
      "퇴원(2026-11-03) — 이 분석은 2026-11-01(5일 전)까지의 상담 흐름입니다(분석 판단: 주의).",
    );
    expect(flowCardState({ ...base, direction: "concern", standing: { status: "withdrawn", withdrawnOn: null }, actualAts: null }).notice).toBe(
      "퇴원 — 이 분석은 2026-04-28(약 6개월 전)까지의 상담 흐름입니다(그때 판단: 주의).",
    );
  });
  it("휴원생(원생 전체) = 원생 상태 배지 + 안내 · 지금의 걱정(최근 분석의 concern)을 지우지 않는다", () => {
    const h = { status: "on_hold", withdrawnOn: null };
    expect(flowCardState({ ...base, coveredThrough: "2026-10-20", direction: "improving", standing: h, actualAts: null })).toEqual({
      badge: "status",
      notice: "지금 휴원 중입니다 — 이 분석은 2026-10-20(17일 전)까지의 상담 흐름입니다.",
    });
    expect(flowCardState({ ...base, coveredThrough: "2026-10-30", direction: "concern", standing: h, actualAts: null }).notice).toBe(
      "지금 휴원 중입니다 — 이 분석은 2026-10-30(7일 전)까지의 상담 흐름입니다(분석 판단: 주의).",
    );
  });
  it("반영 시점이 앞날인 옛 분석 = 판단 보류 + '아직 오지 않은 날'(‘N일 뒤까지의 흐름’이라 말하지 않는다)", () => {
    expect(flowCardState({ ...base, unit: "기록", coveredThrough: "2026-12-01T00:00:00+00:00", direction: "improving", actualAts: null })).toEqual({
      badge: "unknown",
      notice: "이 분석은 2026-12-01(아직 오지 않은 날)까지의 기록을 본 것이라 지금 흐름은 판단하지 않습니다.",
    });
  });
  it("최근 기록이 있는 재원생 · 반영 전 기록 없음 = 그대로(바로잡을 것 없음 — 지금의 걱정도 배지 그대로)", () => {
    expect(flowCardState({ ...base, coveredThrough: "2026-10-30", direction: "improving", actualAts: ["2026-10-30"] })).toEqual({ badge: null, notice: null });
    expect(flowCardState({ ...base, coveredThrough: "2026-10-30", direction: "concern", actualAts: null })).toEqual({ badge: null, notice: null });
  });
});
