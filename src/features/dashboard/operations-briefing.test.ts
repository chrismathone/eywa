import { describe, expect, it } from "vitest";
import { buildOperationsBriefing } from "./operations-briefing";
import type {
  BriefingItem,
  BriefingLane,
  BuildOperationsBriefingInput,
  OperationsBriefing,
} from "./operations-briefing";
import type { TodayActionItem } from "./today-actions";

const EMPTY: BuildOperationsBriefingInput = {
  actions: [],
  followUps: [],
  absenceRisks: [],
  attendanceFreshness: null,
};

function action(overrides: Partial<TodayActionItem> & Pick<TodayActionItem, "key" | "severity">): TodayActionItem {
  return {
    label: overrides.key,
    count: 1,
    unit: "건",
    detail: null,
    note: null,
    bySubject: [],
    href: `/${overrides.key}`,
    menuKey: "dashboard",
    requiredAccess: "read",
    ...overrides,
  };
}

function itemByKey(items: BriefingItem[], key: string): BriefingItem | undefined {
  return items.find((item) => item.key === key);
}

function itemsForLane(briefing: OperationsBriefing, lane: BriefingLane): BriefingItem[] {
  return briefing.groups.find((group) => group.lane === lane)?.items ?? [];
}

describe("buildOperationsBriefing", () => {
  it("신호가 없으면 빈 groups와 고정된 lane counts, 정상 headline을 반환한다", () => {
    const result = buildOperationsBriefing(EMPTY);

    expect(result.groups).toEqual([]);
    expect(result.counts).toEqual({ urgent: 0, today: 0, approval: 0, notice: 0 });
    expect(result.attentionSignalCount).toBe(0);
    expect(result.headline).toBe("오늘 확인할 운영 신호가 없습니다");
    expect(result.focus).toBeNull();
    expect(result.queue).toEqual([]);
    expect(result.watchList).toEqual([]);
    expect(result.assistantState).toBe("steady");
    expect(result.summary).toBe("긴급하거나 오늘 처리할 운영 신호가 없습니다.");
  });

  it("기존 action을 심각도에 따른 lane으로 옮기고 사용자용 단위를 붙인다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [
        action({ key: "absent", severity: "danger", count: 2, unit: "명", label: "오늘 결석" }),
        action({ key: "unrecorded", severity: "amber", count: 3, unit: "개 반", label: "어제 출석 미기록" }),
        action({ key: "unwritten-reports", severity: "amber", count: 4, unit: "명" }),
        action({ key: "leaves-today", severity: "info", count: 2, unit: "명" }),
        action({ key: "makeedu", severity: "amber", count: null }),
      ],
    });

    expect(itemByKey(itemsForLane(result, "urgent"), "absent")).toMatchObject({
      lane: "urgent",
      countLabel: "2명",
    });
    expect(itemByKey(itemsForLane(result, "today"), "unrecorded")).toMatchObject({
      lane: "today",
      countLabel: "3개 반",
    });
    expect(itemByKey(itemsForLane(result, "today"), "unwritten-reports")?.countLabel).toBe("4명");
    expect(itemByKey(itemsForLane(result, "notice"), "leaves-today")?.countLabel).toBe("2명");
    expect(itemByKey(itemsForLane(result, "today"), "makeedu")?.countLabel).toBeNull();
  });

  it("반 미배정 재원생은 사람 단위로 표시한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [action({ key: "unassigned-enrolled", severity: "amber", count: 2, unit: "명" })],
    });

    expect(result.focus?.countLabel).toBe("2명");
  });

  it("상담 후속 조회 실패를 0건이나 운영 안정으로 위장하지 않는다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      followUpsUnavailable: true,
    });

    expect(result.focus).toMatchObject({
      key: "followup-data-unavailable",
      lane: "today",
      href: "/consultations",
    });
    expect(result.assistantState).toBe("attention");
  });

  it("지출과 휴가 결재 action은 severity보다 승인 lane을 우선한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [
        action({ key: "expenses", severity: "danger", count: 9 }),
        action({ key: "leaves-pending", severity: "amber", count: 2 }),
        action({ key: "textbooks", severity: "amber", count: 7 }),
      ],
    });

    expect(itemsForLane(result, "approval").map((item) => item.key)).toEqual(["expenses", "leaves-pending"]);
    expect(itemsForLane(result, "approval").map((item) => item.countLabel)).toEqual(["9건", "2건"]);
    expect(itemsForLane(result, "today").map((item) => item.key)).toEqual(["textbooks"]);
  });

  it("후속조치는 레코드를 lane별 하나의 preview 신호로 묶고 같은 학생도 건수로 유지한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      followUps: [
        { id: "f1", studentId: "s1", studentName: "김민준", urgency: "overdue" },
        { id: "f2", studentId: "s1", studentName: "김민준", urgency: "overdue" },
        { id: "f3", studentId: "s2", studentName: "이서연", urgency: "today" },
        { id: "f4", studentId: "s3", studentName: "박지호", urgency: "soon" },
        { id: "f5", studentId: "s4", studentName: "최유진", urgency: "later" },
      ],
    });

    expect(itemByKey(itemsForLane(result, "urgent"), "followup-overdue")).toMatchObject({
      lane: "urgent",
      countLabel: "2건 표시",
      detail: "김민준·김민준",
      href: "/consultations",
    });
    expect(itemByKey(itemsForLane(result, "today"), "followup-due")).toMatchObject({
      lane: "today",
      countLabel: "2건 표시",
      detail: "이서연·박지호",
    });
    expect(result.counts).toEqual({ urgent: 1, today: 1, approval: 0, notice: 0 });
  });

  it("반복 결석은 최근 출결 기록 기준임을 밝히고 사람 수가 아닌 하나의 신호로 세다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      absenceRisks: [
        { studentId: "s1", studentName: "김민준", absences: 3 },
        { studentId: "s2", studentName: "이서연", absences: 5 },
      ],
      attendanceFreshness: { referenceDate: "2026-07-16", staleDays: 0 },
    });
    const absence = itemByKey(itemsForLane(result, "urgent"), "repeated-absence");

    expect(absence).toMatchObject({
      label: "최근 출결 기록 기준 반복 결석",
      countLabel: "2명",
      detail: "김민준 3회 · 이서연 5회",
      href: "/students",
    });
    expect(absence?.label).not.toContain("이탈 위험");
    expect(result.counts.urgent).toBe(1);
  });

  it("출결 원천이 7일 넘게 오래되면 낡은 반복 결석을 숨기고 데이터 갱신 신호를 낸다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      absenceRisks: [
        { studentId: "s1", studentName: "김민준", absences: 3 },
        { studentId: "s2", studentName: "이서연", absences: 5 },
      ],
      attendanceFreshness: { referenceDate: "2026-06-09", staleDays: 37 },
    });

    expect(itemByKey(itemsForLane(result, "urgent"), "repeated-absence")).toBeUndefined();
    expect(itemByKey(itemsForLane(result, "urgent"), "attendance-data-stale")).toMatchObject({
      label: "출결 데이터 갱신 필요",
      countLabel: "37일 지연",
      detail:
        "6월 9일 이후 새 기록이 없습니다. 반복 결석 신호는 최신 출결이 들어올 때까지 숨겼습니다.",
      href: "/attendance",
    });
    expect(result.counts.urgent).toBe(1);
  });

  it("출결 권한은 있지만 기록이 없으면 정상 상태로 위장하지 않고 확인 신호를 낸다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      attendanceFreshness: { referenceDate: null, staleDays: null },
    });

    expect(itemByKey(itemsForLane(result, "today"), "attendance-data-missing")).toMatchObject({
      label: "출결 기록 확인 필요",
      countLabel: null,
      detail: "최근 출결 기록을 찾지 못해 반복 결석 신호를 계산하지 못했습니다.",
      href: "/attendance",
    });
    expect(result.headline).toBe("지금 확인할 신호 1종");
  });

  it("출결 조회가 실패하면 기록 없음과 구분해 확인 불가 신호를 낸다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      attendanceFreshness: { referenceDate: null, staleDays: null, unavailable: true },
    });

    expect(itemByKey(itemsForLane(result, "today"), "attendance-data-unavailable")).toMatchObject({
      label: "출결 현황 확인 불가",
      detail: "처리 현황을 불러오지 못했습니다. 원본 출결 화면에서 다시 확인해 주세요.",
    });
    expect(itemByKey(itemsForLane(result, "today"), "attendance-data-missing")).toBeUndefined();
  });

  it("출결 기준일이 정확히 7일 전이면 반복 결석 신호를 유지한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      absenceRisks: [{ studentId: "s1", studentName: "김민준", absences: 3 }],
      attendanceFreshness: { referenceDate: "2026-07-09", staleDays: 7 },
    });

    expect(itemByKey(itemsForLane(result, "urgent"), "attendance-data-stale")).toBeUndefined();
    expect(itemByKey(itemsForLane(result, "urgent"), "repeated-absence")).toBeDefined();
  });

  it("counts·attention·headline은 원시 count가 아닌 브리핑 신호 종수를 사용한다", () => {
    const result = buildOperationsBriefing({
      actions: [
        action({ key: "absent", severity: "danger", count: 17 }),
        action({ key: "expenses", severity: "amber", count: 12 }),
        action({ key: "leaves-today", severity: "info", count: 5 }),
      ],
      followUps: Array.from({ length: 4 }, (_, index) => ({
        id: `f${index}`,
        studentId: `s${index}`,
        studentName: `학생${index}`,
        urgency: "overdue" as const,
      })),
      absenceRisks: [
        { studentId: "a1", studentName: "A", absences: 3 },
        { studentId: "a2", studentName: "B", absences: 4 },
      ],
      attendanceFreshness: { referenceDate: "2026-07-16", staleDays: 0 },
    });

    expect(result.counts).toEqual({ urgent: 3, today: 0, approval: 1, notice: 1 });
    expect(result.attentionSignalCount).toBe(4);
    expect(result.headline).toBe("지금 확인할 신호 4종");
  });

  it("참고 신호만 있으면 attention에서 제외하고 자동처리 완료 항목을 만들지 않는다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [action({ key: "leaves-today", severity: "info", count: 3, label: "오늘 휴가" })],
    });

    expect(result.attentionSignalCount).toBe(0);
    expect(result.headline).toBe("참고할 운영 신호 1종");
    expect(result.groups.flatMap((group) => group.items)).toHaveLength(1);
    expect(result.focus).toBeNull();
    expect(result.queue).toEqual([]);
    expect(result.watchList.map((item) => item.key)).toEqual(["leaves-today"]);
    expect(result.assistantState).toBe("steady");
    expect(result.summary).toBe("즉시 처리할 항목은 없습니다. 참고할 운영 신호 1종을 확인해 주세요.");
    expect(JSON.stringify(result)).not.toContain("자동 처리");
  });

  it("focus와 queue를 긴급 → 승인 → 오늘 순서로 만들고 lane 안의 입력 순서를 유지한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [
        action({ key: "textbooks", severity: "amber", count: 4 }),
        action({ key: "expenses", severity: "amber", count: 2 }),
        action({ key: "absent", severity: "danger", count: 1, unit: "명", label: "오늘 결석" }),
        action({ key: "failed-analysis-meetings", severity: "danger", count: 3 }),
        action({ key: "leaves-pending", severity: "amber", count: 1 }),
        action({ key: "unrecorded", severity: "amber", count: 5 }),
        action({ key: "leaves-today", severity: "info", count: 2, unit: "명" }),
      ],
      followUps: [{ id: "f1", studentId: "s1", studentName: "김민준", urgency: "overdue" }],
    });

    expect(result.focus?.key).toBe("absent");
    expect(result.queue.map((item) => item.key)).toEqual([
      "failed-analysis-meetings",
      "followup-overdue",
      "expenses",
      "leaves-pending",
      "textbooks",
      "unrecorded",
    ]);
    expect(result.watchList.map((item) => item.key)).toEqual(["leaves-today"]);
    expect(result.groups.map((group) => group.lane)).toEqual(["urgent", "today", "approval", "notice"]);
    expect(result.assistantState).toBe("critical");
    expect(result.summary).toBe(
      "오늘 결석부터 확인해 주세요. 긴급 3종을 처리한 뒤 승인 대기 2종과 오늘 할 일 2종이 있습니다.",
    );
  });

  it("긴급이 없으면 승인 항목을 오늘 항목보다 먼저 focus로 선택한다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [
        action({ key: "unrecorded", severity: "amber", count: 3 }),
        action({ key: "expenses", severity: "amber", count: 1, label: "지출 결재 대기" }),
      ],
    });

    expect(result.focus?.key).toBe("expenses");
    expect(result.queue.map((item) => item.key)).toEqual(["unrecorded"]);
    expect(result.assistantState).toBe("attention");
    expect(result.summary).toBe(
      "지출 결재 대기부터 확인해 주세요. 승인 대기 1종과 오늘 할 일 1종이 있습니다.",
    );
  });

  it("신호 종류별 고정 CTA와 lane 기반 priority를 붙인다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      actions: [
        action({ key: "failed-analysis-consultations", severity: "danger", count: 1 }),
        action({ key: "expenses", severity: "amber", count: 2 }),
        action({ key: "unwritten-reports", severity: "amber", count: 3 }),
        action({ key: "leaves-today", severity: "info", count: 1 }),
        action({ key: "custom-signal", severity: "info", count: 1 }),
      ],
    });
    const items = result.groups.flatMap((group) => group.items);

    expect(itemByKey(items, "failed-analysis-consultations")).toMatchObject({
      actionLabel: "다시 분석",
      priority: "critical",
    });
    expect(itemByKey(items, "expenses")).toMatchObject({
      actionLabel: "결재 확인",
      priority: "high",
    });
    expect(itemByKey(items, "unwritten-reports")).toMatchObject({
      actionLabel: "보고서 작성",
      priority: "medium",
    });
    expect(itemByKey(items, "leaves-today")).toMatchObject({
      actionLabel: "휴가 일정 확인",
      priority: "low",
    });
    expect(itemByKey(items, "custom-signal")?.actionLabel).toBe("확인하기");
  });

  it("집계로 추가한 출결·상담 신호에도 고정 CTA metadata를 붙인다", () => {
    const result = buildOperationsBriefing({
      ...EMPTY,
      followUps: [
        { id: "f1", studentId: "s1", studentName: "김민준", urgency: "overdue" },
        { id: "f2", studentId: "s2", studentName: "이서연", urgency: "today" },
      ],
      attendanceFreshness: { referenceDate: "2026-06-09", staleDays: 37 },
    });
    const items = result.groups.flatMap((group) => group.items);

    expect(itemByKey(items, "followup-overdue")).toMatchObject({
      actionLabel: "후속조치 확인",
      priority: "critical",
    });
    expect(itemByKey(items, "attendance-data-stale")).toMatchObject({
      actionLabel: "출결 갱신",
      priority: "critical",
    });
    expect(itemByKey(items, "followup-due")).toMatchObject({
      actionLabel: "후속조치 확인",
      priority: "medium",
    });
  });

  it.each([
    {
      name: "긴급만 있음",
      actions: [action({ key: "absent", severity: "danger", count: 2, unit: "명", label: "오늘 결석" })],
      state: "critical",
      summary: "오늘 결석부터 확인해 주세요. 긴급 신호 1종이 있습니다.",
    },
    {
      name: "오늘 할 일만 있음",
      actions: [action({ key: "textbooks", severity: "amber", count: 2, label: "교재 신청 미처리" })],
      state: "attention",
      summary: "교재 신청 미처리부터 확인해 주세요. 오늘 처리할 항목 1종이 있습니다.",
    },
  ])("$name이면 자연어 요약과 assistant state를 고정 규칙으로 만든다", ({ actions, state, summary }) => {
    const result = buildOperationsBriefing({ ...EMPTY, actions });

    expect(result.assistantState).toBe(state);
    expect(result.summary).toBe(summary);
  });

  it("입력을 변경하지 않고 같은 입력에 항상 같은 결과를 낸다", () => {
    const input: BuildOperationsBriefingInput = {
      actions: [action({ key: "absent", severity: "danger", count: 1 })],
      followUps: [{ id: "f1", studentId: "s1", studentName: "김민준", urgency: "today" }],
      absenceRisks: [{ studentId: "s2", studentName: "이서연", absences: 3 }],
      attendanceFreshness: { referenceDate: "2026-07-16", staleDays: 0 },
    };
    const before = structuredClone(input);

    const first = buildOperationsBriefing(input);
    const second = buildOperationsBriefing(input);

    expect(input).toEqual(before);
    expect(second).toEqual(first);
  });

  it("동결된 입력도 변경하지 않고 처리한다", () => {
    const frozenAction = Object.freeze(action({ key: "absent", severity: "danger", count: 1 }));
    const frozenFollowUp = Object.freeze({
      id: "f1",
      studentId: "s1",
      studentName: "김민준",
      urgency: "today" as const,
    });
    const input: BuildOperationsBriefingInput = Object.freeze({
      actions: Object.freeze([frozenAction]),
      followUps: Object.freeze([frozenFollowUp]),
      absenceRisks: Object.freeze([]),
      attendanceFreshness: Object.freeze({ referenceDate: "2026-07-16", staleDays: 0 }),
    });

    expect(() => buildOperationsBriefing(input)).not.toThrow();
    expect(buildOperationsBriefing(input).focus?.key).toBe("absent");
  });
});
