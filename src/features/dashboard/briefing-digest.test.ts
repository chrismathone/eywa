import { describe, expect, it } from "vitest";
import {
  buildDailyBriefingPayload,
  narrativeNumberWhitelist,
  shouldGenerateNarrative,
  type BuildDailyBriefingInput,
} from "./briefing-digest";
import type { TodayActionsRaw } from "./today-actions";

const EMPTY_RAW: TodayActionsRaw = {
  absentToday: [],
  unrecordedYesterday: [],
  yesterday: "2026-07-15",
  failedAnalysis: { meetings: 0, enrollment: 0, consultations: 0 },
  makeeduIssue: null,
  pendingExpenses: { total: 0, recent: 0 },
  requestedTextbooks: 0,
  leavesPending: 0,
  leavesToday: [],
  unwrittenReportsToday: { count: 0, names: [] },
  unassignedEnrolled: [],
  unassignedEnrolledTotal: 0,
  classnoteAttention: { failed: 0, tooOld: 0, humanHold: 0, stuck: 0 },
};

const BASE: BuildDailyBriefingInput = {
  date: "2026-07-16",
  yesterdayRaw: EMPTY_RAW,
  todayRaw: EMPTY_RAW,
  followUps: { overdue: 0, dueSoon: 0 },
  absenceRisks: [],
  retention: null,
  retentionTop: [],
  todayClassSessions: 12,
};

describe("buildDailyBriefingPayload", () => {
  it("어제 기준 신호를 리라벨하고(결석·미작성) 휴가는 attention에서 분리한다", () => {
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
        unrecordedYesterday: [{ classId: "c1", className: "MS2A", subject: "math" }],
        leavesToday: [{ name: "박강사" }],
        leavesPending: 1,
      },
    });
    const labels = payload.attention.map((item) => item.label);
    expect(labels).toContain("어제 결석");
    expect(labels).toContain("어제 미작성 보고서");
    expect(labels).toContain("어제 출석 미기록");
    expect(labels.some((label) => label.includes("휴가"))).toBe(false);
    expect(payload.today.leaves).toEqual(["박강사"]);
    expect(payload.today.pendingLeaveApprovals).toBe(1);
  });

  it("어제 미기록 반은 오늘 수집분을 쓴다(asOf=어제 수집분의 그저께 데이터 무시)", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: { ...EMPTY_RAW, unrecordedYesterday: [{ classId: "old", className: "그저께반", subject: "math" }] },
      todayRaw: { ...EMPTY_RAW, unrecordedYesterday: [{ classId: "c1", className: "어제반", subject: "math" }] },
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

describe("spotlights (매니저 팀 보고 재료)", () => {
  it("retention 상위 + 반복 결석을 이름 중복 없이 병합(최대 6명)", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      retentionTop: [
        { studentId: "r1", name: "김보민", reasons: ["성적 15점 하락", "상담 공백 45일"], action: "학부모 상담 예약" },
        { studentId: "r2", name: "박지율", reasons: ["결석 2회"], action: null },
      ],
      absenceRisks: [
        { studentId: "a1", studentName: "박지율", absences: 3 }, // retention과 중복 — 스킵
        { studentId: "a2", studentName: "정호준", absences: 4 },
      ],
    });
    expect(payload.spotlights).toEqual([
      { studentId: "r1", name: "김보민", reasons: ["성적 15점 하락", "상담 공백 45일"], action: "학부모 상담 예약" },
      { studentId: "r2", name: "박지율", reasons: ["결석 2회"], action: null },
      { studentId: "a2", name: "정호준", reasons: ["최근 14일 결석 4회"], action: null },
    ]);
  });

  it("6명 상한 — retention 5명 + 결석 학생은 남는 자리만", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      retentionTop: Array.from({ length: 5 }, (_, i) => ({ studentId: `r${i}`, name: `학생${i}`, reasons: ["사유"], action: null })),
      absenceRisks: [
        { studentName: "결석1", absences: 3 },
        { studentName: "결석2", absences: 3 },
      ],
    });
    expect(payload.spotlights).toHaveLength(6);
    expect(payload.spotlights[5].name).toBe("결석1");
  });

  it("스포트라이트 사유 속 숫자가 화이트리스트에 들어간다(LLM 인용 허용)", () => {
    const payload = buildDailyBriefingPayload({
      ...BASE,
      retentionTop: [{ studentId: "r1", name: "김보민", reasons: ["성적 15점 하락", "상담 공백 45일"], action: null }],
    });
    const allowed = narrativeNumberWhitelist(payload);
    expect(allowed.has("15")).toBe(true);
    expect(allowed.has("45")).toBe(true);
  });
});

describe("shouldGenerateNarrative", () => {
  it("조치 신호가 전혀 없으면 LLM 스킵", () => {
    expect(shouldGenerateNarrative(buildDailyBriefingPayload(BASE))).toBe(false);
  });
  it("attention·후속·결석위험·스포트라이트 중 하나라도 있으면 생성", () => {
    expect(shouldGenerateNarrative(buildDailyBriefingPayload({ ...BASE, followUps: { overdue: 1, dueSoon: 0 } }))).toBe(true);
    expect(
      shouldGenerateNarrative(
        buildDailyBriefingPayload({ ...BASE, retentionTop: [{ studentId: "r1", name: "a", reasons: ["r"], action: null }] }),
      ),
    ).toBe(true);
  });
});
