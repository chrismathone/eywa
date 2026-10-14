/**
 * 보는 사람의 배치에 맞춰 **스냅샷의 값을 서버에서** 정리한다 — 순수 함수(서버 `loadOverview` · 편집기 미리보기 공용).
 *
 * 🔴 브라우저에서 가리지 않는다(#77): 값이 클라이언트에 내려가면 이미 샌 것이다. 서버가 영역을 안 읽고(배치에 없는 카드),
 *    읽은 영역도 이 함수가 값을 비운 뒤에야 직렬화된다. 편집기 미리보기만 같은 함수를 브라우저에서 돌린다(원장·총괄만 여는 화면 —
 *    그 화면의 원본 스냅샷은 원장 시점이다).
 * 순서: ① 놓인 카드가 안 읽는 영역은 데이터째 지운다 ② 수납 금액·6개월 이력 ③ 일정 제목 전화번호 ④ 과목 관리자는 담당 과목으로 좁힌다.
 */
import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";
import type { Area, Section, Sections } from "@/features/dashboard/overview/model";
import { maskPhones } from "./mask-phones";
import { narrowBySubject, type GroupOf } from "./narrow";
import { applySlices, sliceKey, type SliceTable } from "./slices";
import { neededAreas, placedOf, type ResolvedView } from "./view";

const zeroMoney = (b: SubjectBillingSummary): SubjectBillingSummary => ({
  ...b, totalBilled: 0, totalCollected: 0, totalDiscount: 0, outstanding: 0, paymentRate: 0,
  ...(b.unclassified ? { unclassified: { ...b.unclassified, billed: 0, outstanding: 0 } } : {}),
});

export type ShapeContext = {
  /** 과목 관리자의 담당 과목 묶음("english"·"math"…). 다른 묶음에선 쓰지 않는다. */
  groups: readonly string[];
  /** 행의 과목 → 묶음. 설정에 없는 과목·빈 과목은 null(= 모든 과목 관리자에게) — 서버·미리보기는 `sliceGroupOf`를 넘긴다. */
  groupOf: GroupOf;
  /** 영역별 과목 값 표(`addSliced`) — 과목 관리자 화면은 학원 전체 값 대신 담당 묶음의 값을 싣는다. */
  slices?: SliceTable;
};

export function shapeSections(full: Sections, view: ResolvedView, ctx: ShapeContext): Sections {
  const needed = neededAreas(view);
  const placed = new Set(placedOf(view));
  let sections: Sections = Object.fromEntries(Object.entries(full).filter(([area]) => needed.has(area as never)));
  const scoped = view.subjectScoped ?? view.bundle === "subject";
  // 과목별로 다시 집계한 값이 있는 영역은 **먼저** 그 값으로 갈아 끼운다(원장 2026-10-14 2단계) — 아래 금액 가림·6개월 자르기·
  // 전화번호 가림이 갈아 끼운 값에도 걸려야 한다(나중에 끼우면 가린 것이 되살아난다).
  const key = scoped && ctx.groups.length ? sliceKey(ctx.groups) : "";
  const sliced = new Set((key && ctx.slices ? Object.keys(ctx.slices) : []).filter((area) => ctx.slices?.[area as Area]?.[key] !== undefined) as Area[]);
  if (key) sections = applySlices(sections, ctx.slices, key);

  const billing = sections.billing;
  if (billing?.data) {
    // 6개월 카드가 없으면 이번 달 한 줄만 — 지난 달 금액 이력은 내려보내지 않는다.
    const rows = placed.has("panel:billing6") ? billing.data : billing.data.slice(-1);
    const next: Section<SubjectBillingSummary[]> = { ...billing, data: view.amounts ? rows : rows.map(zeroMoney) };
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
  if (scoped) {
    // 학년·학교·수준 구성은 과목으로 못 나뉜다 — 그 칸이 놓였을 때만 학원 전체 값을 싣는다(안 쓰는 값을 내려보내지 않는다).
    const keepAcademyWide = ["panel:studentsComp", "panel:grades", "panel:schools"].some((id) => placed.has(id));
    // 이미 과목별 값으로 갈아 끼운 영역은 다시 좁히지 않는다.
    sections = narrowBySubject(sections, ctx.groups, ctx.groupOf, keepAcademyWide, sliced);
  }
  return sections;
}
