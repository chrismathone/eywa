/**
 * 편집기 카드의 꼬리표 + 설정 칸의 설명 — 순수 함수(Vitest). 원장이 고르는 **민감 6가지**(원장 2026-10-01 확정, 기본 모두 가림)를
 * 카드 옵션으로 보여 준다: ① 데스크 미납 금액 ② 과목 관리자 수납 금액 = 이번 달 수납 카드의 '금액 보이기' ·
 * ③ 과목 관리자 강사 시트 ④ 과목 관리자 퇴원 명단 ⑥ 직원 구성 = 그 카드를 **넣는 것 자체**(넣으면 '민감' 꼬리표) ·
 * ⑤ 일정 제목 전화번호 = 일정 카드의 '전화번호 그대로'.
 */
import type { MenuKey } from "@/lib/permissions";
import { optionDefault } from "@/features/dashboard/layout/defaults";
import { cardDef, missingMenuLabel } from "@/features/dashboard/layout/registry";
import { DASHBOARD_VERSION, type Bundle, type Item } from "@/features/dashboard/layout/types";
import { resolveView } from "@/features/dashboard/layout/view";
/** 편집기 꼬리표 한 개. */
export type FaceBadge = { tone: "danger" | "warn" | "info"; text: string };

/** 원장 밖 역할에 넣으면 '민감'인 카드 — 이유 한 줄(설정 칸에 그대로 적는다). */
export function sensitiveReason(id: string, role: Bundle): string | null {
  if (role === "owner") return null;
  if (id === "panel:billing6") return "6개월 청구·수납 금액이 그대로 보입니다";
  if (id === "panel:expenses") return "이번 달 지출 금액 내역이 보입니다";
  if (id === "panel:staff") return "직원 구성(역할·과목별 인원)이 보입니다";
  if (role === "subject" && id === "panel:sheets") return "담당 과목 강사 시트의 작성률이 보입니다";
  if (role === "subject" && id === "kpi:withdrawals") return "담당 과목 퇴원 학생 명단이 보입니다";
  // ④ 과목 관리자 퇴원 명단과 같은 성격 — 등록 후 3개월 안에 그만둔 학생 이름이 보인다(2026-10-15).
  if (role === "subject" && id === "panel:earlyExits") return "담당 과목 조기 퇴원 학생 명단이 보입니다";
  return null;
}

/** 카드 옵션의 지금 값(없으면 역할 기본 — 원장만 보임). */
export const optionOn = (item: Pick<Item, "amounts" | "phones">, key: "amounts" | "phones", role: Bundle) => item[key] ?? optionDefault(role);

/**
 * 이 배치에서 금액·전화번호가 **실제로** 어떻게 나가는가 — 서버와 같은 함수(`resolveView`)로 판정한다.
 * 🔴 카드 옵션만 보고 꼬리표를 달면 거짓말이 된다: 6개월 청구·수납 카드가 있으면 이번 달 금액이 그 카드로 내려가고,
 *    일정 카드가 둘이면 **둘 다** 켜야 번호가 그대로 나간다(한쪽이라도 가리면 가린다 — 적대 리뷰 2026-10-01).
 */
export type Exposure = { amounts: boolean; monthAmounts: boolean; phones: boolean; billing6: boolean };
export function exposureOf(items: readonly Item[], role: Bundle, menus: ReadonlySet<MenuKey>): Exposure {
  const view = resolveView({ stored: { version: DASHBOARD_VERSION, layouts: [{ role, items: [...items] }] }, bundle: role, menus });
  return { amounts: view.amounts, monthAmounts: view.monthAmounts, phones: view.phones, billing6: (view.items ?? []).some((i) => i.id === "panel:billing6") };
}

export function badgesFor(item: Item, role: Bundle, menus: ReadonlySet<MenuKey>, ex?: Exposure): FaceBadge[] {
  const def = cardDef(item.id);
  if (!def) return [];
  const out: FaceBadge[] = [];
  if (missingMenuLabel(def, menus)) out.push({ tone: "danger", text: "권한 없어 안 보임" });
  if (sensitiveReason(item.id, role)) out.push({ tone: "warn", text: "민감" });
  if (role !== "owner" && def.options.includes("amounts")) {
    const shown = ex ? ex.monthAmounts : optionOn(item, "amounts", role);
    out.push(shown ? { tone: "warn", text: "금액 보임" } : ex?.billing6 ? { tone: "warn", text: "금액 일부 보임" } : { tone: "info", text: "금액 가림" });
  }
  if (role !== "owner" && def.options.includes("phones")) {
    const shown = ex ? ex.phones : optionOn(item, "phones", role);
    out.push(shown ? { tone: "warn", text: "번호 보임" } : { tone: "info", text: "번호 가림" });
  }
  if (role === "subject" && def.subjectScope === "academy") out.push({ tone: "info", text: "학원 전체 값" });
  return out;
}

/** 설정 칸의 '보이는 범위' 한 줄. */
export function scopeLine(id: string, role: Bundle): string | null {
  const def = cardDef(id);
  if (!def || role !== "subject") return null;
  if (def.subjectScope === "subject") return "담당 과목 데이터로 좁혀서 보여 줍니다.";
  if (def.subjectScope === "academy") return "아직 과목으로 나눠 보여 주지 못하는 카드라 담당 과목 화면에는 학원 전체 값으로 보입니다(제목에 '(학원 전체)').";
  return null;
}
