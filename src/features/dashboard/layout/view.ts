/**
 * 저장된 배치(설정) + 보는 사람의 역할·권한 → **그 사람이 실제로 보는 배치**(`ResolvedView`). 순수 함수.
 *
 * 서버(`loadOverview`)가 이 결과로 (1) 조회할 영역을 정하고 (2) 값을 가리고(`shape.ts`) (3) 스냅샷에 실어 보낸다 — 화면은 받은 `view`만 그린다.
 * 편집기 미리보기도 같은 함수를 부른다(그 역할이 못 보는 칸은 여기서 빠진다).
 *
 * 🔴 메뉴 권한이 **상한**이다 — 배치에 넣어도 그 사람이 카드의 메뉴 권한이 없으면 빠진다(`canSeeCard`).
 * 🔴 저장값이 없으면 코드의 기본 배치(`defaults.ts`). 원장 기본만 옛 CSS 격자(`classic`)로 그린다 — 지금 운영실과 한 픽셀도 다르지 않게.
 */
import { KPI_KEYS, type OverviewLayout } from "@/features/dashboard/overview/layout";
import type { Area } from "@/features/dashboard/overview/model";
import type { MenuKey } from "@/lib/permissions";
import { defaultItems, optionDefault } from "./defaults";
import { dropEmptyHeadings, sanitizeItems } from "./engine";
import { AREA_MENUS, canSeeCard, cardDef } from "./registry";
import { isCoreId, isHeadingId, isStructuralId, type Bundle, type DashboardSettings, type Item } from "./types";

/**
 * 핵심 업무 칸을 이 사람이 열 수 있는가 — 칸이 데려가는 화면의 문과 같은 판정(열 수 없는 칸은 세우지 않는다).
 * 신입생 90일 = 신규생 관리 메뉴 · 경영 분석 = 원장·관리자(`requireManagementSample` — 원장·과목 운영형·경영지원형) · 업무 작성센터 = 대시보드를 여는 사람 모두.
 */
export function canOpenCore(id: string, bundle: Bundle, menus: ReadonlySet<MenuKey>): boolean {
  if (id === "core:newcomers") return menus.has("newcomers");
  if (id === "core:management") return bundle === "owner" || bundle === "super" || bundle === "subject" || bundle === "desk";
  return id === "core:workRecords";
}

export type ResolvedView = {
  bundle: Bundle;
  /** classic = 지금 운영실의 옛 CSS 격자(`classic`) · grid = 흐름 배치(`items`). */
  mode: "classic" | "grid";
  classic?: OverviewLayout;
  items?: Item[];
  /** 과목 관리자 — 담당 과목 이름(맨 위 제목 뒤 "(수학)"). */
  scopeLabel?: string;
  subjectScoped?: boolean;
  activeSubject?: string;
  subjectChoices?: { key: string; label: string }[];
  /** 학원 전체 값이 섞인 카드 id(과목 관리자 화면에서 '(학원 전체)'를 붙인다). */
  academyWide: string[];
  /** 수납 영역에 금액이 실리는가(데이터) — 6개월 카드가 있거나 이번 달 카드의 금액 옵션이 켜졌을 때. */
  amounts: boolean;
  /** 이번 달 수납 카드가 금액(미수 잔액)을 그리는가 — 꺼지면 건수만. */
  monthAmounts: boolean;
  /** 일정 제목의 전화번호를 그대로 두는가(일정을 읽는 카드가 모두 켰을 때만). */
  phones: boolean;
  /** 배치가 바뀌면 달라지는 짧은 값 — 스냅샷 scope에 섞여 갱신이 옛 배치를 안 붙들게 한다. */
  rev: string;
};

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** 놓인 카드 id(머리줄 제외) — 옛 격자면 그 배치의 KPI·패널. */
export function placedOf(view: Pick<ResolvedView, "mode" | "items" | "classic">): string[] {
  if (view.mode === "grid") return (view.items ?? []).filter((i) => !isHeadingId(i.id) && !isCoreId(i.id)).map((i) => i.id);
  const layout = view.classic;
  const kpis = (layout?.kpis ?? KPI_KEYS).map((k) => `kpi:${k}`);
  const panels = (layout?.sections ?? []).flatMap((s) =>
    s.panels.flatMap((p) => (p === "followup" ? ["panel:reports", "panel:studentConsult"] : [`panel:${p}`])),
  );
  return [...kpis, ...panels];
}

/** 놓인 카드가 읽는 영역 — 서버는 이 영역만 조회한다. */
export function neededAreas(view: Pick<ResolvedView, "mode" | "items" | "classic">): Set<Area> {
  const areas = new Set<Area>();
  for (const id of placedOf(view)) for (const a of cardDef(id)?.areas ?? []) areas.add(a);
  return areas;
}

/**
 * 서버가 **실제로 조회할 영역** — 놓인 카드가 읽는 영역 ∩ 그 사람이 메뉴 권한으로 읽을 수 있는 영역.
 * 🔴 `loadOverview`의 `add()`가 이 집합에 없는 영역은 조회 자체를 하지 않는다(배치에 없으면 미조회 · 메뉴 권한이 상한).
 */
export function loadPlan(view: Pick<ResolvedView, "mode" | "items" | "classic">, allowed: ReadonlySet<MenuKey>): Set<Area> {
  return new Set([...neededAreas(view)].filter((a) => AREA_MENUS[a].every((m) => allowed.has(m))));
}

export type ResolveInput = {
  stored: DashboardSettings;
  bundle: Bundle;
  /** 이 사람이(또는 편집기가 가정한 역할이) 열 수 있는 메뉴. */
  menus: ReadonlySet<MenuKey>;
  /** 과목 관리자의 담당 과목 라벨(표시용). */
  subjectLabels?: readonly string[];
  subjectScoped?: boolean;
  subject?: string;
};

export function resolveView({ stored, bundle, menus, subjectLabels = [], subjectScoped = bundle === "subject", subject }: ResolveInput): ResolvedView {
  const role = (bundle === "subject" && subject ? stored.layouts.find((l) => l.role === bundle && l.subject === subject) : undefined)
    ?? stored.layouts.find((l) => l.role === bundle && !l.subject);
  // 옛 CSS 격자(원장 기본)는 2026-11-09 새 대시보드로 끝났다 — 모든 역할이 배치 목록으로 그린다(옛 렌더러 호환으로 칸만 남긴다).
  const classic: OverviewLayout | null = null;
  let items: Item[] | undefined;
  if (!classic) {
    const base = role ? sanitizeItems(role.items) : defaultItems(bundle);
    // 권한 상한 — 못 보는 카드는 빠지고(흐름이라 뒤 카드가 앞으로 당겨진다), 카드가 없어진 구역의 머리줄도 뺀다.
    // 과목 관리자도 원장이 넣은 카드는 다 본다(원장 2026-10-14 *"위젯은 똑같이 넣어주고 내가 커스텀"*) — 아직 과목으로
    // 못 나누는 카드는 숨기지 않고 아래 `academyWide`로 '(학원 전체)'를 붙인다.
    // 🔴 과목 범위를 받은 **다른 역할**(실장·경영지원 등)은 종전대로 그 카드를 숨긴다 — 원장이 그 역할 배치를 고칠 때 편집기에
    //    '학원 전체 값' 꼬리표가 안 서서, 열면 원장 모르게 학원 전체 카드가 새로 뜬다(리뷰 2026-10-14). 과목으로 나누면(2단계) 함께 연다.
    const hideAcademy = subjectScoped && bundle !== "subject";
    items = dropEmptyHeadings(base.filter((i) => isStructuralId(i.id) || (isCoreId(i.id) ? canOpenCore(i.id, bundle, menus) : cardDef(i.id) && canSeeCard(cardDef(i.id)!, menus)
      && !(hideAcademy && cardDef(i.id)!.subjectScope === "academy"))));
    // 미지정은 학원 전체 집계로 폴백하지 않는다. 범위를 정할 때까지 공지만 표시한다.
    if (subjectScoped && !subjectLabels.length) items = items.filter((i) => cardDef(i.id)?.subjectScope === "none");
  }
  const placed = (items ?? []).filter((i) => !isHeadingId(i.id));
  const flag = (key: "amounts" | "phones", it: Item) => it[key] ?? optionDefault(bundle);
  const month = placed.find((i) => i.id === "panel:billingMonth");
  const monthAmounts = classic ? true : month ? flag("amounts", month) : false;
  const amounts = classic ? true : placed.some((i) => i.id === "panel:billing6") || monthAmounts;
  const phoneCards = placed.filter((i) => cardDef(i.id)?.options.includes("phones"));
  const phones = classic ? true : phoneCards.length > 0 && phoneCards.every((i) => flag("phones", i));
  const scopeLabel = subjectScoped ? subjectLabels.join("·") || "담당 범위 미지정" : undefined;
  const academyWide = subjectScoped ? placed.filter((i) => cardDef(i.id)?.subjectScope === "academy").map((i) => i.id) : [];
  const body = { bundle, mode: classic ? ("classic" as const) : ("grid" as const), amounts, monthAmounts, phones, academyWide, subjectScoped };
  return {
    ...body,
    ...(classic ? { classic } : { items }),
    ...(scopeLabel ? { scopeLabel } : {}),
    rev: hash(JSON.stringify([body, items ?? null, scopeLabel ?? "", subject ?? ""])),
  };
}
