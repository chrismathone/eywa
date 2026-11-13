import { describe, expect, it } from "vitest";
import { cellItemCounts, cellItemState, cellItemTitle, cellItemWhen, isJudgedItem } from "./cell-items";

const NOW = Date.parse("2026-11-10T03:00:00Z");
const it0 = (o: object) => ({ kind: "attendance", period: "daily", status: "done", voidReason: null, dueAt: "2026-11-09T15:00:00Z", doneAt: "2026-11-09T10:00:00Z", ...o });

describe("칸 목록의 한 줄", () => {
  it("🔴 상태는 집계와 같다 — 때가 된 업무: 기한 안 완료 = 기한 내 완료 · 넘겨 완료 = 기한 후 완료 / 때가 안 된 업무를 끝냄 = 미리 완료 / 열린 것은 기한으로(지났으면 미처리) · 미처리 확정", () => {
    expect(cellItemState(it0({}), NOW)).toBe("ontime");
    expect(cellItemState(it0({ doneAt: null }), NOW)).toBe("ontime");
    expect(cellItemState(it0({ doneAt: "2026-11-09T16:00:00Z" }), NOW)).toBe("late_done");
    // 기한 전의 월간(말일 기한)을 미리 끝냈다 — 아직 칸의 분자에 안 든다.
    expect(cellItemState(it0({ kind: "counsel_monthly", period: "monthly", dueAt: "2026-11-30T15:00:00Z" }), NOW)).toBe("early");
    // 🔴 수업은 끝났고(기한 − 24시간 ≤ 지금) 기한 안에 보낸 보고서 — '미리 완료'가 아니라 기한 내 완료(칸의 분자에 든다).
    expect(cellItemState(it0({ kind: "report_send", dueAt: "2026-11-10T09:00:00Z", doneAt: "2026-11-09T10:00:00Z" }), NOW)).toBe("ontime");
    expect(cellItemState(it0({ status: "open", doneAt: null }), NOW)).toBe("late");
    expect(cellItemState(it0({ kind: "report_send", status: "open", doneAt: null, dueAt: "2026-11-10T15:00:00Z" }), NOW)).toBe("upcoming");
    expect(cellItemState(it0({ status: "void", voidReason: "expired" }), NOW)).toBe("expired");
  });
  it("🔴 때가 된 업무인가 = 칸의 분모에 드는 줄 — 일간은 수업이 끝난 뒤 · 월간 · 건별은 기한이 지난 뒤 / 제목 건수는 그 수를 먼저, 기한 전 · 면제는 따로", () => {
    expect(isJudgedItem({ kind: "report_send", period: "daily", dueAt: "2026-11-10T09:00:00Z" }, NOW)).toBe(true);   // 수업 끝 = 11/9 09:00Z
    expect(isJudgedItem({ kind: "attendance", period: "daily", dueAt: "2026-11-10T09:00:00Z" }, NOW)).toBe(false);   // 수업이 아직 안 끝났다
    expect(isJudgedItem({ kind: "counsel_monthly", period: "monthly", dueAt: "2026-11-30T15:00:00Z" }, NOW)).toBe(false);
    expect(isJudgedItem({ kind: "newcomer_call", period: "case", dueAt: "2026-11-09T15:00:00Z" }, NOW)).toBe(true);
    expect(cellItemCounts([{ state: "ontime", judged: true }, { state: "late", judged: true }, { state: "upcoming", judged: false }, { state: "waived", judged: true }])).toBe("2건 · 진행 1건 · 면제 1건");
    expect(cellItemCounts([{ state: "upcoming", judged: false }, { state: "early", judged: false }])).toBe("진행 2건");
    expect(cellItemCounts([])).toBe("0건");
  });
  it("🔴 결석으로 빠진 보고서 업무 — 목록에 '결석'으로 보이고 건수 · 때가 된 업무에는 들지 않는다(출결만 있고 보고서가 없는 까닭이 겉으로 보이게)", () => {
    expect(cellItemState(it0({ kind: "report_send", status: "void", voidReason: "absent", doneAt: null }), NOW)).toBe("absent");
    expect(cellItemState(it0({ status: "void", voidReason: "waived", doneAt: null }), NOW)).toBe("waived");
    expect(cellItemCounts([{ state: "ontime", judged: true }, { state: "absent", judged: false }, { state: "absent", judged: false }])).toBe("1건 · 결석 2건");
    expect(cellItemCounts([{ state: "absent", judged: false }])).toBe("0건 · 결석 1건");
    expect(cellItemWhen({ state: "absent", period: "daily", dueAt: "2026-11-08T09:00:00Z", doneAt: null })).toBe("업무 없음");
  });
  it("무엇 · 언제 — 일간은 수업일 · 월간은 달 · 신규생 정착은 항목 · 건별은 날짜만(시각을 지어내지 않는다) · 기한은 사람 눈의 그날", () => {
    expect(cellItemTitle({ kind: "attendance", period: "daily", cycle: "2026-11-07" })).toBe("11/7 출결");
    expect(cellItemTitle({ kind: "counsel_monthly", period: "monthly", cycle: "2026-10" })).toBe("10월 학생 상담");
    expect(cellItemTitle({ kind: "newcomer_call", period: "case", cycle: "month1_call" })).toBe("신규생 관리 — 1개월 콜");
    expect(cellItemWhen({ state: "late_done", period: "daily", dueAt: "2026-11-07T15:00:00Z", doneAt: "2026-11-08T09:42:00Z" })).toBe("11/8 18:42 완료");
    expect(cellItemWhen({ state: "ontime", period: "case", dueAt: "2026-11-07T15:00:00Z", doneAt: "2026-10-23T00:00:00Z" })).toBe("10/23 완료");
    expect(cellItemWhen({ state: "late", period: "daily", dueAt: "2026-11-07T15:00:00Z", doneAt: null })).toBe("기한 11/7");
  });
});

describe("면제한 업무", () => {
  it("목록에는 '면제'로 보인다(미처리 확정과 가른다)", () => {
    const base = { kind: "attendance", period: "daily", dueAt: "2026-11-09T15:00:00Z", doneAt: null };
    expect(cellItemState({ ...base, status: "void", voidReason: "waived" }, Date.parse("2026-11-10T03:00:00Z"))).toBe("waived");
    expect(cellItemState({ ...base, status: "void", voidReason: "expired" }, Date.parse("2026-11-10T03:00:00Z"))).toBe("expired");
  });
});
