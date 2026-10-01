/**
 * 보는 사람의 배치에 맞춰 **스냅샷의 값을 서버에서** 정리한다 — 순수 함수(서버 `loadOverview` · 편집기 미리보기 공용).
 *
 * 🔴 브라우저에서 가리지 않는다(#77): 값이 클라이언트에 내려가면 이미 샌 것이다. 서버가 영역을 안 읽고(배치에 없는 카드),
 *    읽은 영역도 이 함수가 값을 비운 뒤에야 직렬화된다. 편집기 미리보기만 같은 함수를 브라우저에서 돌린다(원장·총괄만 여는 화면 —
 *    그 화면의 원본 스냅샷은 원장 시점이다).
 * 순서: ① 놓인 카드가 안 읽는 영역은 데이터째 지운다 ② 수납 금액·6개월 이력 ③ 일정 제목 전화번호 ④ 과목 관리자는 담당 과목으로 좁힌다.
 */
import type { BillingSummary } from "@/features/billing/calc";
import type { Section, Sections } from "@/features/dashboard/overview/model";
import { maskPhones } from "./mask-phones";
import { narrowBySubject, type GroupOf } from "./narrow";
import { neededAreas, placedOf, type ResolvedView } from "./view";

const zeroMoney = (b: BillingSummary): BillingSummary => ({ ...b, totalBilled: 0, totalCollected: 0, totalDiscount: 0, outstanding: 0, paymentRate: 0 });

export type ShapeContext = {
  /** 과목 관리자의 담당 과목 묶음("english"·"math"…). 다른 묶음에선 쓰지 않는다. */
  groups: readonly string[];
  groupOf: GroupOf;
};

export function shapeSections(full: Sections, view: ResolvedView, ctx: ShapeContext): Sections {
  const needed = neededAreas(view);
  const placed = new Set(placedOf(view));
  let sections: Sections = Object.fromEntries(Object.entries(full).filter(([area]) => needed.has(area as never)));

  const billing = sections.billing;
  if (billing?.data) {
    // 6개월 카드가 없으면 이번 달 한 줄만 — 지난 달 금액 이력은 내려보내지 않는다.
    const rows = placed.has("panel:billing6") ? billing.data : billing.data.slice(-1);
    const next: Section<BillingSummary[]> = { ...billing, data: view.amounts ? rows : rows.map(zeroMoney) };
    sections = { ...sections, billing: next };
  }
  const calendar = sections.calendar;
  if (calendar?.data && !view.phones) {
    const events = calendar.data.map((e) => ({
      ...e,
      title: maskPhones(e.title),
      ...(e.displayTitle ? { displayTitle: maskPhones(e.displayTitle) } : {}),
    }));
    sections = { ...sections, calendar: { ...calendar, data: events } };
  }
  if (view.subjectScoped ?? view.bundle === "subject") {
    // 학년·학교·수준 구성은 과목으로 못 나뉜다 — 그 칸이 놓였을 때만 학원 전체 값을 싣는다(안 쓰는 값을 내려보내지 않는다).
    const keepAcademyWide = ["panel:studentsComp", "panel:grades", "panel:schools"].some((id) => placed.has(id));
    sections = narrowBySubject(sections, ctx.groups, ctx.groupOf, keepAcademyWide);
  }
  return sections;
}
