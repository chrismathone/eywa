import { describe, expect, it } from "vitest";
import {
  buildDailyBriefingPayload,
  buildFallbackNarrative,
  buildNarrativePrompt,
  shouldGenerateNarrative,
  validateNarrative,
  type BuildDailyBriefingInput,
} from "./briefing-digest";
import type { TodayActionsRaw } from "./today-actions";

const EMPTY_RAW: TodayActionsRaw = {
  absentToday: [],
  unrecordedYesterday: [],
  yesterday: "2026-07-15",
  failedAnalysis: { meetings: 0, enrollment: 0, consultations: 0 },
  makeeduIssue: null,
  pendingExpenses: 0,
  requestedTextbooks: 0,
  leavesPending: 0,
  leavesToday: [],
  unwrittenReportsToday: { count: 0, names: [] },
  unassignedEnrolled: [],
  classnoteAttention: { failed: 0, tooOld: 0, humanHold: 0, stuck: 0 },
};

const BASE: BuildDailyBriefingInput = {
  date: "2026-07-16",
  yesterdayRaw: EMPTY_RAW,
  todayRaw: EMPTY_RAW,
  followUps: { overdue: 0, dueSoon: 0 },
  absenceRisks: [],
  retention: null,
  todayClassSessions: 12,
};

describe("buildDailyBriefingPayload", () => {
  it("어제 기준 신호를 리라벨하고(무단결석·미작성) 휴가는 attention에서 분리한다", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: {
        ...EMPTY_RAW,
        absentToday: [{ studentId: "s1", name: "김민준" }],
        unwrittenReportsToday: { count: 2, names: ["김민준", "이서연"] },
        leavesToday: [{ name: "어제휴가자" }], // asOf=어제 수집분 — 버려져야 함
        leavesPending: 9,
      },
      todayRaw: {
        ...EMPTY_RAW,
        unrecordedYesterday: [{ classId: "c1", className: "MS2A" }],
        leavesToday: [{ name: "박강사" }],
        leavesPending: 1,
      },
    });
    const labels = payload.attention.map((item) => item.label);
    expect(labels).toContain("어제 무단결석");
    expect(labels).toContain("어제 미작성 보고서");
    expect(labels).toContain("어제 출석 미기록");
    expect(labels.some((label) => label.includes("휴가"))).toBe(false);
    expect(payload.today.leaves).toEqual(["박강사"]);
    expect(payload.today.pendingLeaveApprovals).toBe(1);
  });

  it("어제 미기록 반은 오늘 수집분을 쓴다(asOf=어제 수집분의 그저께 데이터 무시)", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: { ...EMPTY_RAW, unrecordedYesterday: [{ classId: "old", className: "그저께반" }] },
      todayRaw: { ...EMPTY_RAW, unrecordedYesterday: [{ classId: "c1", className: "어제반" }] },
    });
    const unrecorded = payload.attention.find((item) => item.key === "unrecorded");
    expect(unrecorded?.detail).toBe("어제반");
  });

  it("조회 실패는 attention이 아니라 sourceIssueLabels로('오늘 ' 접두 제거)", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: {
        ...EMPTY_RAW,
        sourceIssues: [
          { key: "attendance-today", label: "오늘 출결", href: "/attendance", menuKey: "attendance", requiredAccess: "read" },
        ],
      },
    });
    expect(payload.sourceIssueLabels).toEqual(["출결"]);
    expect(payload.attention.some((item) => item.key.startsWith("source-issue-"))).toBe(false);
  });

  it("retention 월 수강료는 만원 단위 반올림", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      retention: { total: 380, risk: 4, warn: 9, revenueRisk: 347_000 },
    });
    expect(payload.retention).toEqual({ total: 380, risk: 4, warn: 9, revenueRiskManwon: 35 });
  });
});

describe("shouldGenerateNarrative", () => {
  it("조치 신호가 전혀 없으면 LLM 스킵", () => {
    expect(shouldGenerateNarrative(buildDailyBriefingPayload(BASE))).toBe(false);
  });
  it("attention·후속·결석위험·이탈위험 중 하나라도 있으면 생성", () => {
    expect(shouldGenerateNarrative(buildDailyBriefingPayload({ ...BASE, followUps: { overdue: 1, dueSoon: 0 } }))).toBe(true);
    expect(
      shouldGenerateNarrative(
        buildDailyBriefingPayload({ ...BASE, retention: { total: 10, risk: 1, warn: 0, revenueRisk: 0 } }),
      ),
    ).toBe(true);
  });
});

describe("buildNarrativePrompt", () => {
  it("개인 이름을 프롬프트에 넣지 않는다(라벨+수치만)", () => {
    const prompt = buildNarrativePrompt(
      buildDailyBriefingPayload({
        ...BASE,
        yesterdayRaw: { ...EMPTY_RAW, absentToday: [{ studentId: "s1", name: "김민준" }] },
        absenceRisks: [{ studentName: "이서연", absences: 4 }],
        todayRaw: { ...EMPTY_RAW, leavesToday: [{ name: "박강사" }] },
      }),
    );
    expect(prompt).not.toContain("김민준");
    expect(prompt).not.toContain("이서연");
    expect(prompt).not.toContain("박강사");
    expect(prompt).toContain("어제 무단결석");
    expect(prompt).toContain("JSON");
  });
});

describe("validateNarrative", () => {
  const payload = buildDailyBriefingPayload({
    ...BASE,
    yesterdayRaw: { ...EMPTY_RAW, absentToday: [{ studentId: "s1", name: "김민준" }, { studentId: "s2", name: "박서연" }, { studentId: "s3", name: "정호" }] },
    followUps: { overdue: 2, dueSoon: 1 },
  });

  it("화이트리스트 숫자만 쓴 서술은 통과", () => {
    expect(
      validateNarrative("어제 무단결석 3명을 가장 먼저 확인해 주세요. 상담 후속조치 기한 지남 2건과 임박 1건이 있습니다.", payload),
    ).toEqual({ ok: true });
  });

  it("근거 없는 숫자는 폐기", () => {
    const result = validateNarrative("어제 무단결석 7명을 확인해 주세요. 수납률이 95%로 양호합니다.", payload);
    expect(result.ok).toBe(false);
  });

  it("영문 토큰·과잉 길이 폐기", () => {
    expect(validateNarrative("classnote_status failed 항목을 확인해 주세요. 어제 무단결석 3명이 있습니다.", payload).ok).toBe(false);
    expect(validateNarrative("가".repeat(701), payload).ok).toBe(false);
    expect(validateNarrative("짧음", payload).ok).toBe(false);
  });

  it("날짜(연·월·일) 숫자는 허용", () => {
    expect(validateNarrative("7월 16일 아침 기준, 어제 무단결석 3명을 확인해 주세요.", payload).ok).toBe(true);
  });
});

describe("buildFallbackNarrative", () => {
  it("신호 없음 → 안전 문장 + 오늘 수업 수", () => {
    expect(buildFallbackNarrative(buildDailyBriefingPayload(BASE))).toBe(
      "어제 마감 기준 조치할 운영 신호가 없습니다. 오늘 수업 일정은 12건입니다.",
    );
  });
  it("신호 있음 → 첫 신호 + 나머지 종수", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: {
        ...EMPTY_RAW,
        absentToday: [{ studentId: "s1", name: "a" }],
        pendingExpenses: 2,
      },
    });
    const text = buildFallbackNarrative(payload);
    expect(text).toContain("가장 먼저");
    expect(text).toContain("어제 무단결석 1건");
    expect(text).toContain("1종");
  });
});
