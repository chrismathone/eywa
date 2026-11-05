/**
 * 역할별 **기본 배치** — 코드에 있다(원장 2026-10-01 *"기본 디폴트 세팅을 만들어두고"*).
 *
 * · 원장 = 지금 운영실 그대로(`DEFAULT_LAYOUT` — 저장값이 없으면 옛 CSS 격자 렌더러가 그린다, 화면이 한 픽셀도 안 바뀐다).
 * · 실장·데스크·그 밖의 직책 = 지금 배치에서 **민감 칸을 뺀 뒤** 앙상해진 구역을 합친(`pack.ts`) 흐름 배치(줄 채우기로 빈 칸 없음).
 * · 과목 관리자 = 담당 과목으로 좁혀지는 칸 중심(오늘 수업·수강·결석) + 공지.
 * 🔴 저장값이 없는 역할은 이 기본을 **그대로 따른다** — 기본을 코드로 개선하면 안 건드린 역할은 자동으로 따라온다
 *    (저장할 때 기본과 같은 역할은 저장값을 만들지 않는다 — `normalize.ts`).
 * 🔴 민감 기본: 원장 밖 역할은 6개월 청구·지출·직원 구성이 **빠져 있고**(과목 관리자는 강사 시트·퇴원 명단·수납도),
 *    금액(`amounts`)·전화번호(`phones`)는 **가림이 기본**이다 — 원장이 편집기에서 켜야 열린다(`optionDefault`).
 */
import { DEFAULT_LAYOUT, type LayoutSection, type OverviewLayout, type PanelId, type PanelSlot } from "@/features/dashboard/overview/layout";
import { classicToItems, newItem } from "./engine";
import { packLayout } from "./pack";
import type { Bundle, Item } from "./types";

/** 저장값이 없을 때 옛 CSS 격자(지금 운영실)로 그리는 역할 — 원장뿐. */
export const usesClassicDefault = (bundle: Bundle) => bundle === "owner" || bundle === "super";

/** 민감 옵션(금액·전화번호)의 역할 기본 — 원장만 보임, 나머지는 가림(원장이 카드마다 켠다). */
export const optionDefault = (bundle: Bundle): boolean => bundle === "owner" || bundle === "super";

/** 원장 밖 역할에서 기본으로 빼는 칸 — 금액 내역·직원(원장 전용 정보). */
export const SENSITIVE_PANELS: readonly PanelId[] = ["billing6", "expenses", "staff"];
/** 데스크는 여기에 학습 운영(교사 평가 성격) 칸도 뺀다(시안 A안). */
const DESK_DROP: readonly PanelId[] = [...SENSITIVE_PANELS, "reports", "studentConsult", "sheets"];

function without(drop: readonly PanelId[]): OverviewLayout {
  const dropped = new Set<PanelSlot>(drop);
  const sections: LayoutSection[] = DEFAULT_LAYOUT.sections.map((s) => ({
    ...s,
    panels: s.panels.flatMap((p): PanelSlot[] => {
      if (p !== "followup") return dropped.has(p) ? [] : [p];
      const keep = (["reports", "studentConsult"] as const).filter((x) => !dropped.has(x));
      return keep.length === 2 ? ["followup"] : keep;
    }),
  }));
  return { sections };
}

/**
 * 과목 관리자 — KPI 셋(담당 과목으로 좁혀지는 칸, 1×1이라 한 줄을 채운다) + 오늘 수업(넓게) · 반복 결석 학생 · 공지 · 강사별 업무 현황.
 * KPI를 ½×1로 두면 오늘 수업 카드가 같은 줄로 올라와 KPI 칸이 카드 높이만큼 길어진다.
 */
const SUBJECT_ITEMS: readonly Item[] = [
  { id: "kpi:students", w: 6, h: 1 },
  { id: "kpi:withdrawals", w: 6, h: 1 },
  { id: "kpi:firstClass", w: 6, h: 1 },
  { id: "kpi:absent", w: 6, h: 1 },
  { id: "panel:nowClasses", w: 12, h: 1 },
  // 과목별 수강 → 반복 결석 학생(원장 2026-10-15) — 과목이 하나인 관리자에겐 과목별 수강이 재원생 칸의 보조 숫자와 같은 숫자였다.
  newItem("panel:repeatAbsence"),
  newItem("panel:notices"),
];

/** 편집기가 시작하는 값이자 저장값이 없는 역할의 배치 — 모든 역할에 있다. */
export function defaultItems(bundle: Bundle): Item[] {
  switch (bundle) {
    case "super":
    case "owner":
      return classicToItems(DEFAULT_LAYOUT);
    case "subject":
      return SUBJECT_ITEMS.map((i) => ({ ...i }));
    case "desk":
      return classicToItems(packLayout(without(DESK_DROP)));
    case "manager":
      return classicToItems(packLayout(without(SENSITIVE_PANELS)));
    case "counselor":
      return ["kpi:intake", "kpi:calendar", "kpi:enrolledToday", "panel:admissions", "panel:newcomerStages", "panel:consultProgress", "panel:admissionsSchedule", "panel:notices"].map((id) => newItem(id));
    case "accountant":
      return ["panel:billingMonth", "panel:operations", "panel:notices"].map((id) => newItem(id));
    case "viewer":
      return ["kpi:students", "panel:subjects", "panel:nowClasses", "panel:notices"].map((id) => newItem(id));
    case "teacher":
      return ["panel:nowClasses", "panel:reports", "panel:notices"].map((id) => newItem(id));
    case "parttime":
    case "student":
      return [newItem("panel:notices")];
  }
}

/** 기본 배치의 옛 CSS 격자 표현 — 원장 기본만. */
export const classicDefault = (bundle: Bundle): OverviewLayout | null => (usesClassicDefault(bundle) ? DEFAULT_LAYOUT : null);
