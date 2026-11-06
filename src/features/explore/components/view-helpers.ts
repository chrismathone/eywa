import type { MouseEvent } from "react";
import { splitSelKey, type ExploreAnalysisBlock, type ExploreModel, type ExploreSector, type TrailLabel } from "../model";
import type { NetAnalysis } from "./network/types";

/** 연결 탐색 화면([`explore-view.tsx`](./explore-view.tsx))의 보조 함수 — 화면 상태를 갖지 않는다. */

/** 도넛 바깥 빈 곳 클릭 = 선택 해제(원장 2026-11-05) — 조각·글자·가운데·설명줄·버튼 위는 제외. */
export function clearOnBackground(e: MouseEvent, selected: string | null, clear: () => void) {
  if (!selected) return;
  const t = e.target as HTMLElement;
  if (t.closest("[role='button'], button, a, input, label, p, [data-explore-center]")) return;
  clear();
}

/** 경로 한 칸의 글자 — 영역 중심("김민서G · 출결")이 바로 앞 칸과 같은 대상의 것이면 영역 이름만("출결"), 되풀이를 줄인다. */
export function crumbLabel(t: TrailLabel, prev: TrailLabel | undefined): string {
  if (!t.sector || !prev || prev.kind !== t.kind || prev.id !== t.id) return t.label;
  const at = t.label.lastIndexOf(" · ");
  return at >= 0 ? t.label.slice(at + 3) : t.label;
}

/** 주소의 `?sector=`가 지금 모델의 쐐기(조각 또는 작은 조각)인가. */
export function isValidSel(model: ExploreModel, sel: string): boolean {
  const { sectorKey, partKey } = splitSelKey(sel);
  const s = model.sectors.find((x) => x.key === sectorKey);
  if (!s) return false;
  return partKey === null || !!s.parts?.some((p) => p.key === partKey);
}

/** 패널에 펼칠 것 — 고른 쐐기(작은 조각이면 그 반 하나짜리 패널), 아무것도 안 골랐으면 모델의 기본(영역 전체 또는 첫 조각). */
export function panelSectorOf(model: ExploreModel, sel: string | null): ExploreSector {
  const fallback = model.panelDefault ?? model.sectors.find((s) => s.key === model.defaultSector) ?? model.sectors[0];
  if (!sel) return fallback;
  const { sectorKey, partKey } = splitSelKey(sel);
  const s = model.sectors.find((x) => x.key === sectorKey) ?? fallback;
  if (!partKey) return s;
  const p = s.parts?.find((x) => x.key === partKey);
  if (!p) return s;
  return {
    key: sel,
    label: p.label,
    icon: s.icon,
    tone: s.tone,
    summary: p.summary,
    state: "ready",
    focus: p.target,
    rows: p.rows ?? [{ id: "about", title: p.target.detail || s.label, detail: p.target.meta ?? null }],
    links: s.links,
    note: (s.parts?.length ?? 0) > 1 ? `${s.label} 수강 중 ${s.parts?.length}개 중 하나` : null,
  };
}

/**
 * 분석·판단 블록 → 네트워크 '분석' 점. 내용이 있는 블록만(빈 분석을 점으로 세우지 않는다) · 근거 = 그 블록이 이어진 조각
 * (`subject:*` = 지금 모델의 과목 조각 전부) — 그래프가 영역 점에 '근거' 선을 잇는다.
 */
export function netAnalysesOf(blocks: readonly ExploreAnalysisBlock[] | undefined, model: ExploreModel): NetAnalysis[] | undefined {
  const withText = (blocks ?? []).filter((b) => !!b.headline);
  if (withText.length === 0) return undefined;
  const subjects = model.sectors.filter((s) => s.key.startsWith("subject:")).map((s) => s.key);
  return withText.map((b) => ({
    id: b.id,
    title: b.title,
    // 카드의 안내(퇴원·휴원 · 석 달 넘은 분석 · 반영 전 기록)를 함께 — 점만 보는 사람도 옛 분석을 지금으로 읽지 않게.
    detail: [b.notice, b.headline].filter(Boolean).join(" "),
    kind: b.kind,
    evidence: b.related.flatMap((k) => (k === "subject:*" ? subjects : [k])),
  }));
}

/** 패널·왼쪽 열에 그려진 창 링크(`WindowLink`)를 대신 누른다 — 더블클릭·Enter가 같은 링크를 지나 같은 창 규약을 탄다. */
export function openPanelLink(href: string) {
  if (typeof document === "undefined") return;
  const anchor = [...document.querySelectorAll<HTMLAnchorElement>("[data-explore-panel] a[href], [aria-label='원생 정보'] a[href]")].find((a) => (a.getAttribute("href") ?? "").startsWith(href));
  if (anchor) anchor.click();
  else window.open(href, "_blank", "noopener");
}

/** 지금 고른 쐐기를 주소에 남긴다(새로고침·뒤로 가기 복원). 선택 해제면 지운다. */
export function syncSectorParam(key: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (key) url.searchParams.set("sector", key);
  else url.searchParams.delete("sector");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
}
