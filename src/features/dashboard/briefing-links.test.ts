import { describe, expect, it } from "vitest";
import { buildBriefingLinks, leftoverBriefingLinks, type BriefingLinkGate } from "./briefing-links";
import type { DailyBriefingPayload } from "./briefing-digest";
import type { TodayActionItem } from "./today-actions";

const allow: BriefingLinkGate = () => true;

function action(over: Partial<TodayActionItem> & Pick<TodayActionItem, "key" | "menuKey" | "href">): TodayActionItem {
  return {
    severity: "amber",
    label: "신호",
    count: null,
    unit: null,
    detail: null,
    note: null,
    bySubject: [],
    requiredAccess: "read",
    ...over,
  } as TodayActionItem;
}

function payload(over: Partial<DailyBriefingPayload> = {}): DailyBriefingPayload {
  return {
    date: "2026-09-03",
    yesterday: "2026-09-02",
    attention: [],
    today: { classSessions: null, leaves: [], pendingLeaveApprovals: 0 },
    followUps: { overdue: 0, dueSoon: 0 },
    absenceRisks: { count: 0, names: [] },
    retention: null,
    spotlights: [],
    sourceIssueLabels: [],
    ...over,
  };
}

describe("buildBriefingLinks", () => {
  it("신호를 menuKey 영역에 놓고 라벨에 건수·단위를 그대로 단다", () => {
    const links = buildBriefingLinks(
      payload({
        attention: [
          action({
            key: "unrecorded",
            label: "어제 출석 미기록",
            count: 12,
            unit: "개 반",
            href: "/attendance/2026-09-02",
            menuKey: "attendance",
          }),
          action({
            key: "textbooks",
            label: "교재 신청 미처리",
            count: 3,
            unit: "건",
            href: "/billing?tab=textbooks&status=requested",
            menuKey: "billing",
            requiredAccess: "write",
          }),
        ],
      }),
      allow,
    );
    expect(links.수업).toEqual([
      { key: "unrecorded", label: "어제 출석 미기록 12개 반", href: "/attendance/2026-09-02" },
    ]);
    expect(links.수납).toEqual([
      { key: "textbooks", label: "교재 신청 미처리 3건", href: "/billing?tab=textbooks&status=requested" },
    ]);
    expect(links.학생).toEqual([]);
  });

  it("열 수 없는 화면은 링크를 만들지 않는다(죽은 링크 금지)", () => {
    const gate: BriefingLinkGate = (menuKey, requiredAccess) =>
      menuKey === "billing" ? requiredAccess !== "write" : menuKey !== "staff";
    const links = buildBriefingLinks(
      payload({
        attention: [
          action({
            key: "textbooks",
            label: "교재 신청 미처리",
            count: 3,
            unit: "건",
            href: "/billing?tab=textbooks",
            menuKey: "billing",
            requiredAccess: "write",
          }),
        ],
        today: { classSessions: null, leaves: [], pendingLeaveApprovals: 2 },
      }),
      gate,
    );
    expect(links.수납).toEqual([]);
    expect(links.운영).toEqual([]);
  });

  it("후속조치·휴가 승인은 attention 밖이라 payload에서 따로 세운다", () => {
    const links = buildBriefingLinks(
      payload({
        followUps: { overdue: 1, dueSoon: 4 },
        today: { classSessions: null, leaves: [], pendingLeaveApprovals: 2 },
      }),
      allow,
    );
    expect(links.상담).toEqual([
      { key: "followup-overdue", label: "후속조치 기한 지남 1건", href: "/consultations?urg=overdue" },
      { key: "followup-due", label: "후속조치 오늘·임박 4건", href: "/consultations" },
    ]);
    expect(links.운영).toEqual([
      { key: "leaves-pending", label: "휴가 승인 대기 2건", href: "/staff/leaves" },
    ]);
  });

  it("href·menuKey가 없는 옛 payload 행은 건너뛴다(목적지 추측 금지)", () => {
    const links = buildBriefingLinks(
      payload({
        attention: [
          { key: "legacy", severity: "amber", label: "옛 신호", count: 1, unit: "건", detail: null, note: null, bySubject: [] } as unknown as TodayActionItem,
        ],
      }),
      allow,
    );
    expect(Object.values(links).every((list) => list.length === 0)).toBe(true);
  });

  it("payload가 없으면 빈 목록", () => {
    const links = buildBriefingLinks(null, allow);
    expect(links).toEqual({ 수업: [], 학생: [], 상담: [], 수납: [], 운영: [] });
  });
});

describe("leftoverBriefingLinks", () => {
  it("보고 문단이 없는 영역의 칩만 모은다(신호가 사라지지 않게)", () => {
    const links = buildBriefingLinks(
      payload({
        attention: [
          action({ key: "unrecorded", label: "어제 출석 미기록", count: 12, unit: "개 반", href: "/attendance", menuKey: "attendance" }),
          action({
            key: "unassigned-enrolled",
            label: "반 미배정 재원생",
            count: 5,
            unit: "명",
            href: "/students",
            menuKey: "students",
            requiredAccess: "write",
          }),
        ],
      }),
      allow,
    );
    expect(leftoverBriefingLinks(links, ["수업"]).map((link) => link.key)).toEqual(["unassigned-enrolled"]);
    expect(leftoverBriefingLinks(links, ["수업", "학생"])).toEqual([]);
    expect(leftoverBriefingLinks(links, []).map((link) => link.key)).toEqual(["unrecorded", "unassigned-enrolled"]);
  });
});
