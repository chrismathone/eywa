/**
 * 실제 운영실 스냅샷(원장 시점 전체) → 역할에 보이는 스냅샷. 순수 함수 — 서버·DB·네트워크 없음.
 *
 * 순서가 중요하다: ① 놓을 카드가 읽지 않는 영역은 **데이터째** 지운다(카드만 숨기는 게 아니다 — #77) ② 남는 영역 안의
 * 민감 필드를 비운다(금액·6개월 이력·전화번호) ③ 과목 관리자는 담당 과목으로 좁힌다.
 * 시안은 이 함수를 브라우저에서 돌리지만(원장만 여는 화면이라 전체 스냅샷이 이미 원장 것), 실제 적용 땐 같은 규칙을
 * 서버가 스냅샷을 만들 때 걸어 **클라이언트에 아예 안 내려보낸다**(설계 메모).
 */
import type { BillingSummary } from "@/features/billing/calc";
import { KPI_KEYS, type OverviewLayout } from "@/features/dashboard/overview/layout";
import type { OverviewSnapshot, Section, Sections } from "@/features/dashboard/overview/model";
import { noticesForRole } from "@/features/notices/audience";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/program";
import type { MenuKey } from "@/lib/permissions";
import { maskPhones } from "./mask";
import { narrowBySubject } from "./narrow";
import { PANEL_AREAS, billingAmountsFor, buildLayout, toggleParam, type LayoutId, type RoleId, type Toggles } from "./roles";

export type RoleViewInput = { role: RoleId; layout: LayoutId; subject: string; toggles: Toggles };
export type RoleView = { snapshot: OverviewSnapshot; layout: OverviewLayout; billingAmounts: boolean };

/**
 * 역할 화면에서 링크로 열 수 없는 메뉴 — 직원관리·학원설정은 원장 전용, 퇴원관리는 사유 원문이 있어 원장만
 * (카드의 퇴원 명단 자체는 이름·날짜뿐이라 ④로 따로 정한다), 수납은 금액이 열린 역할만.
 */
const ALWAYS_DENIED: readonly MenuKey[] = ["staff", "owner", "withdrawals"];

function neededAreas(layout: OverviewLayout): Set<string> {
  const areas = new Set<string>(layout.kpis ?? KPI_KEYS);
  for (const section of layout.sections) {
    for (const slot of section.panels) {
      const panels = slot === "followup" ? (["reports", "studentConsult"] as const) : ([slot] as const);
      for (const p of panels) for (const a of PANEL_AREAS[p]) areas.add(a);
    }
  }
  return areas;
}

const zeroMoney = (b: BillingSummary): BillingSummary => ({
  ...b,
  totalBilled: 0,
  totalCollected: 0,
  totalDiscount: 0,
  outstanding: 0,
  paymentRate: 0,
});

/** 수납 영역 — 6개월 칸이 안 놓이면 이력은 지금 달만 남기고, 금액이 안 열렸으면 금액을 0으로 비운다. */
function trimBilling(section: Section<BillingSummary[]>, keepSixMonths: boolean, amounts: boolean): Section<BillingSummary[]> {
  if (!section.data) return section;
  const rows = keepSixMonths ? section.data : section.data.slice(-1);
  return { ...section, data: amounts ? rows : rows.map(zeroMoney) };
}

export function applyRoleView(full: OverviewSnapshot, input: RoleViewInput): RoleView {
  const { role, toggles } = input;
  const layout = buildLayout(role, input.layout, toggles);
  const scope = `${full.scope}:draft:${role}:${input.layout}:${input.subject}:${toggleParam(toggles)}`;
  if (role === "owner") return { snapshot: { ...full, scope }, layout, billingAmounts: true };

  const needed = neededAreas(layout);
  const billingAmounts = billingAmountsFor(role, toggles);
  const sixMonths = layout.sections.some((s) => s.panels.includes("billing6"));
  let sections: Sections = Object.fromEntries(Object.entries(full.sections).filter(([key]) => needed.has(key)));

  if (sections.billing) sections = { ...sections, billing: trimBilling(sections.billing, sixMonths, billingAmounts) };
  if (sections.calendar?.data && !toggles.showPhones) {
    const events = sections.calendar.data.map((e) => ({
      ...e,
      title: maskPhones(e.title),
      displayTitle: e.displayTitle ? maskPhones(e.displayTitle) : e.displayTitle,
    }));
    sections = { ...sections, calendar: { ...sections.calendar, data: events } };
  }
  if (sections.operations?.data) {
    // '내 결재 대기'는 **로그인한 사람(원장)의** 결재함 건수라 다른 역할 화면에 남으면 원장 개인 수치가 샌다 — 뺀다.
    // (실제 적용 땐 서버가 보는 사람 기준으로 다시 센다.)
    sections = { ...sections, operations: { ...sections.operations, data: sections.operations.data.filter((r) => r.href !== "/approvals") } };
  }
  if (sections.notices?.data) {
    // 공지는 '원장 시점 4건'이라 그 안에서 역할 대상만 거른다(실제 적용은 서버가 역할 기준으로 4건을 다시 뽑는다).
    const rows = noticesForRole(sections.notices.data, role === "manager" ? "manager" : "admin", 4);
    sections = { ...sections, notices: { ...sections.notices, data: rows } };
  }
  if (role === "subject") {
    const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programSubjectsOf(full.subjects));
    sections = narrowBySubject(sections, groupOf(input.subject), groupOf);
  }

  const denied = new Set<MenuKey>([...ALWAYS_DENIED, ...(billingAmounts ? [] : (["billing"] as const))]);
  const allowed = full.allowed.filter((menu) => !denied.has(menu));
  return { snapshot: { ...full, scope, allowed, sections }, layout, billingAmounts };
}
