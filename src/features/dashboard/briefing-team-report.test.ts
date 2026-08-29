import { describe, expect, it } from "vitest";
import { buildDailyBriefingPayload, type BuildDailyBriefingInput } from "./briefing-digest";
import { buildFallbackTeamReport, buildTeamPrompt, validateTeamReport } from "./briefing-team-report";
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
  unwrittenReportsToday: { count: 0, names: [], bySubject: [] },
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

const RICH = buildDailyBriefingPayload({
  ...BASE,
  yesterdayRaw: {
    ...EMPTY_RAW,
    absentToday: [
      { studentId: "s1", name: "김민준", subject: "math" },
      { studentId: "s2", name: "박서연", subject: "math" },
      { studentId: "s3", name: "정호", subject: "math" },
    ],
    pendingExpenses: { total: 18, recent: 5 },
  },
  followUps: { overdue: 2, dueSoon: 1 },
  retentionTop: [{ studentId: "r1", name: "김보민", reasons: ["성적 15점 하락", "상담 공백 45일"], action: "학부모 상담 예약" }],
});

/** 과목 분해가 붙은 결석 스포트라이트(injaewon 실데이터 모양 — 하은결 8회 = 수학 6 · 영어 2). */
const SUBJECT_SPOTLIGHT = buildDailyBriefingPayload({
  ...BASE,
  absenceRisks: [
    {
      studentId: "a1",
      studentName: "하은결",
      absences: 8,
      bySubject: [
        { subject: "math", count: 6 },
        { subject: "english", count: 2 },
      ],
    },
  ],
  subjectLabel: (key) => ({ math: "수학", english: "영어" })[key] ?? key,
});

describe("buildTeamPrompt", () => {
  it("위험 학생 명단(이름·사유·권장 조치)을 프롬프트에 포함한다", () => {
    const prompt = buildTeamPrompt(RICH);
    expect(prompt).toContain("김보민");
    expect(prompt).toContain("성적 15점 하락");
    expect(prompt).toContain("학부모 상담 예약");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("매니저");
  });
  it("스포트라이트가 없으면 명단 섹션을 생략한다", () => {
    expect(buildTeamPrompt(buildDailyBriefingPayload(BASE))).not.toContain("[위험 학생");
  });

  // 원장 2026-08-29 "운영실 보고시에 과목별 표기되도록 과목 라벨".
  it("결석 위험 학생 줄에 과목 분해를 대괄호로 싣는다", () => {
    const prompt = buildTeamPrompt(SUBJECT_SPOTLIGHT);
    expect(prompt).toContain("하은결 [수학 6 · 영어 2]");
  });

  // 🔴 회귀: 프롬프트가 사실로 준 숫자를 인용한 정상 보고가 후검증에서 탈락하면 안 된다(#89 계열).
  it("프롬프트에 실린 과목별 수치를 인용해도 검증을 통과한다", () => {
    const result = validateTeamReport(
      {
        headline: "하은결 학생 수학 결석부터 확인해 주세요",
        managers: [{ area: "학생", report: "하은결 학생이 수학 6회 · 영어 2회 결석했습니다. 수학부터 연락을 권합니다." }],
      },
      SUBJECT_SPOTLIGHT,
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateTeamReport", () => {
  it("정상 팀 보고는 통과하고 값이 정규화된다", () => {
    const result = validateTeamReport(
      {
        headline: "어제 결석 3명 확인이 최우선입니다",
        managers: [
          { area: "수업", report: "어제 결석 3명이 있었습니다. 오늘 등원 시 학부모 연락을 권합니다." },
          { area: "학생", report: "김보민 학생은 성적 15점 하락과 상담 공백 45일이 겹쳤습니다. 학부모 상담 예약을 권합니다." },
        ],
      },
      RICH,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.managers).toHaveLength(2);
  });

  it("근거 없는 숫자는 폐기", () => {
    const result = validateTeamReport(
      { headline: "수납률 95% 달성", managers: [{ area: "수납", report: "수납률이 95%로 양호합니다." }] },
      RICH,
    );
    expect(result.ok).toBe(false);
  });

  it("알 수 없는 영역·근거 없는 영문·형식 오류 폐기", () => {
    expect(
      validateTeamReport({ headline: "오늘의 보고입니다", managers: [{ area: "마케팅", report: "보고입니다 열 자 이상." }] }, RICH).ok,
    ).toBe(false);
    // payload에 없는 영문(코드·키 이름 환각)은 그대로 차단 — RICH에는 classnote 신호가 없다.
    expect(
      validateTeamReport({ headline: "오늘의 보고입니다", managers: [{ area: "수업", report: "classnote failed 상태를 확인하세요." }] }, RICH).ok,
    ).toBe(false);
    expect(validateTeamReport("문자열", RICH).ok).toBe(false);
    expect(validateTeamReport({ headline: "짧", managers: [] }, RICH).ok).toBe(false);
  });

  // 🔴 회귀: 아래 3종은 실제로 프로덕션 보고를 폐기시켰던 사유다(2026-07-31 재현 — 3회 시도 3회 탈락).
  it("영역이 중복되면 폐기하지 말고 한 줄로 병합한다", () => {
    const result = validateTeamReport(
      {
        headline: "오늘의 보고입니다",
        managers: [
          { area: "수업", report: "보고입니다 열 자 이상 하나." },
          { area: "학생", report: "보고입니다 열 자 이상 둘." },
          { area: "수업", report: "보고입니다 열 자 이상 셋." },
        ],
      },
      RICH,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.managers).toHaveLength(2);
    expect(result.value.managers[0]).toEqual({
      area: "수업",
      report: "보고입니다 열 자 이상 하나. 보고입니다 열 자 이상 셋.",
    });
  });

  it("payload 라벨에 있는 영문(makeedu)은 인용해도 통과한다", () => {
    const withMakeedu = buildDailyBriefingPayload({
      ...BASE,
      yesterdayRaw: { ...EMPTY_RAW, makeeduIssue: { kind: "stale", detail: "교재 단가표 30시간째 미동기" } },
    });
    const result = validateTeamReport(
      {
        headline: "makeedu 동기화부터 확인해 주세요",
        managers: [{ area: "운영", report: "makeedu 동기화 이상이 확인돼 먼저 점검이 필요합니다." }],
      },
      withMakeedu,
    );
    expect(result.ok).toBe(true);
  });

  it("note에 실린 수치도 근거로 인정한다(범위가 붙은 숫자)", () => {
    const result = validateTeamReport(
      { headline: "지출 결재를 확인해 주세요", managers: [{ area: "수납", report: "최근 7일에만 5건이 새로 쌓였습니다." }] },
      RICH,
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildFallbackTeamReport", () => {
  it("신호를 영역별로 묶고 스포트라이트를 학생 매니저 보고로", () => {
    const report = buildFallbackTeamReport(RICH);
    expect(report.headline).toContain("어제 결석");
    const areas = report.managers.map((m) => m.area);
    expect(areas).toContain("수업"); // 결석
    expect(areas).toContain("수납"); // 지출 결재
    expect(areas).toContain("학생"); // 스포트라이트
    expect(areas).toContain("상담"); // 후속조치
    const student = report.managers.find((m) => m.area === "학생");
    expect(student?.report).toContain("김보민");
  });

  it("신호 없음 → 안전 헤드라인 + 빈 매니저", () => {
    const report = buildFallbackTeamReport(buildDailyBriefingPayload(BASE));
    expect(report.headline).toBe("어제 마감 기준 조치할 운영 신호가 없습니다.");
    expect(report.managers).toEqual([]);
  });
});
