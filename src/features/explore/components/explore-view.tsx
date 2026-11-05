"use client";

import { Fragment, use, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// `router.prefetch`의 `kind`는 Next 내부 enum 타입만 받는다 — 타입만 빌리고 값은 그 enum의 문자열("full")을 그대로 적는다(런타임 import 없음).
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { useEmbed } from "@/components/workspace/embed-context";
import { ExploreDonut, type Leaving } from "./donut";
import { ExploreSidePanel } from "./side-panel";
import { ExploreSearch } from "./explore-search";
import { AsideColumn } from "./aside-column";
import { beginHandoff, endHandoff, takeHandoffFor } from "./transition-handoff";
import styles from "./explore.module.css";
import {
  KIND_LABEL,
  KIND_TITLE,
  LEAVE_STAGGER_MS,
  centerTrailItem,
  exploreHref,
  exploreLandingHref,
  nextTrail,
  splitSelKey,
  wedgesOf,
  zoomPlan,
  type ExploreKind,
  type ExploreModel,
  type ExploreSector,
  type ExploreTarget,
  type TrailItem,
  type TrailLabel,
} from "../model";

type Props = {
  model: ExploreModel;
  /** 이전 중심들(이름 포함) — 주소 `?t=`에서 온 것. 지금 중심은 들어 있지 않다. */
  trail: TrailLabel[];
  initialSector: string | null;
};

/**
 * 고른 조각이 가운데로 들어가는 모션의 길이(`sector-leave-chosen`) — 새 화면은 이것이 **끝난 뒤에** 뜬다(그 사이 새 중심을 읽는다 ·
 * [`transition-handoff.ts`](./transition-handoff.ts)). 조각은 `LEAVE_STAGGER_MS`씩 벌려 시작하므로 붙드는 시간은 조각 수만큼 더한다
 * (프로덕션 실측: 미리 받아 둔 전환이 접힘 끝보다 ~100ms 일찍 떠서 꼬리가 잘렸다).
 */
const LEAVE_MS = 560;

/**
 * 연결 탐색 본체 — 중심 전환은 **주소 이동**이다(`/explore/<종류>/<id>[/<영역>]?t=<경로>`): 새로고침·직접 접근·브라우저 뒤로 가기가 그대로 된다.
 * 고르면 ① 쐐기들이 접히고 고른 쐐기가 가운데로 들어와 원이 된다(`leaving`) — **동시에** `startTransition` 안의 `router.push`로 새 중심을
 * 읽기 시작한다 → ② 새 화면은 접힘이 끝날 때까지 그리기를 미룬다(`use(handoff.ready)` — 트랜지션 안이라 옛 화면이 그대로) →
 * ③ 이름·조각·패널이 **한 번에** 바뀌며 조각이 차례로 펼쳐진다(donut.tsx). 한 번 클릭(고르기) 때 흡수 목적지를 미리 받아 두므로(prefetch)
 * 더블클릭 땐 대개 서버를 기다리지 않는다. 고른 쐐기는 `?sector=`로 남긴다(서버를 다시 부르지 않는 `replaceState` — 이동 중엔 손대지 않는다, Next 16).
 */
export function ExploreView({ model, trail, initialSector }: Props) {
  const router = useRouter();
  const embed = useEmbed();
  const [, startTransition] = useTransition();
  // 🔴 처음엔 **아무 쐐기도 고르지 않은 상태**(원장 2026-11-03 *"12시는 선택 안 했는데도 항상 선택된 것처럼 위로 나와 있네"*) —
  //    패널은 기본 영역을 펼쳐 두되, 도넛은 사람이 올리거나 누른 쐐기만 띄운다. 주소에 `?sector=`가 있으면 그 쐐기.
  const [selected, setSelected] = useState<string | null>(() => (initialSector && isValidSel(model, initialSector) ? initialSector : null));
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const current = centerTrailItem(model.center);
  // 이어달리기 — 떠난 화면이 접히는 동안 도착했으면 접힘이 끝날 때까지 그리기를 미룬다(트랜지션 안이라 옛 화면이 그대로 남는다).
  const [handoff] = useState(() => takeHandoffFor(current));
  if (handoff) use(handoff.ready);
  useEffect(() => {
    if (handoff) endHandoff(handoff);
  }, [handoff]);
  const sector = panelSectorOf(model, selected);

  /** 접힘 시작 + **바로** 새 중심 읽기 — 서버가 접히는 동안 돈다. 모션을 끄는 설정이면 바로 뜬다. */
  const leaveTo = (href: string, to: TrailItem, next: Leaving) => {
    setLeaving(next);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hold = LEAVE_MS + (wedgesOf(model.sectors).length - 1) * LEAVE_STAGGER_MS + 16;
    beginHandoff(to, reduce ? 0 : hold);
    startTransition(() => router.push(href));
  };
  /**
   * 한 번 클릭 때 흡수 목적지를 미리 받아 둔다 — 동적 페이지라 `full`(기본 `auto`는 정적 껍데기만 받는다). 바로 더블클릭해도 `router.push`가
   * 진행 중인 이 요청을 이어받는다(프로덕션 실측: 요청 1회분 · 접힘이 끝나자마자 새 도넛). 같은 주소는 라우터 캐시가 한 번만.
   * ⚠️ Next는 **개발 모드에서 prefetch를 하지 않는다**(`createPrefetchURL` — 컴파일 성능 때문) — dev에선 요청이 안 보이는 게 정상, 프로덕션에서만 돈다.
   */
  const warm = (href: string) => router.prefetch(href, { kind: "full" as PrefetchKind });
  const navigate = (target: ExploreTarget | TrailLabel, viaSel: string | null = selected ?? sector.key) => {
    const to: TrailItem = "sector" in target && target.sector ? { kind: target.kind, id: target.id, sector: target.sector } : { kind: target.kind, id: target.id };
    leaveTo(exploreHref(to, { trail: nextTrail(trail, current, to), embed }), to, { key: viaSel, kind: target.kind, label: target.label });
  };
  const selectSector = (key: string) => {
    if (leaving) return;
    setSelected(key);
    syncSectorParam(key);
    const plan = zoomPlan(model, key, trail, embed);
    if (plan && "go" in plan) warm(plan.go);
  };
  /**
   * 흡수(더블클릭·Enter — 원장 2026-11-03 *"전부 다 더블클릭 흡수 동작"*): 쐐기가 가운데로 들어와 새 중심이 된다 — 갈 곳은 `zoomPlan`이
   * 정한다(한 번 클릭의 prefetch와 같은 함수 · 같은 주소). 대상이 없는 항목(영역 중심의 통계 줄 등)은 그 영역의 업무 화면을 연다.
   */
  const zoom = (sel: string) => {
    if (leaving) return;
    const plan = zoomPlan(model, sel, trail, embed);
    if (!plan) return;
    setSelected(sel);
    if ("go" in plan) leaveTo(plan.go, plan.to, plan.leaving);
    else if (plan.link) openPanelLink(plan.link);
  };
  /** 가운데 원 더블클릭 = 지금 중심의 상세 화면(패널 아래 같은 링크를 누른 것과 같다 — 창 규약을 그 링크가 안다). */
  const centerZoom = () => {
    if (model.center.detailHref) openPanelLink(model.center.detailHref);
  };

  const kind: ExploreKind = model.center.kind;
  const title = model.center.group ? `${KIND_TITLE[kind]} · 영역` : KIND_TITLE[kind];
  const description = model.center.group
    ? `'${model.center.name}'의 항목을 조각으로 펼쳤습니다. 더블클릭하면 그 항목이 중심이 됩니다.`
    : `${KIND_LABEL[kind]} '${model.center.name}'${withGwa(model.center.name)} 연결된 ${model.sectors.map((s) => s.label).join(", ")}를 한눈에 탐색하세요.`;
  return (
    <div className="space-y-3">
      <nav aria-label="탐색 경로" className="flex flex-wrap items-center gap-1 px-1 text-sm">
        <EmbedLink href={exploreLandingHref()} className="text-text-dim hover:text-primary inline-flex items-center" aria-label="연결 탐색 처음으로">
          <EyIcon name="home" size={16} />
        </EmbedLink>
        {trail.map((t, i) => (
          <Fragment key={`${t.kind}:${t.id}:${t.sector ?? ""}`}>
            <ChevronRight className="text-text-dim size-3.5" aria-hidden="true" />
            <button
              type="button"
              onMouseEnter={() => warm(exploreHref(t, { trail: trail.slice(0, i), embed }))}
              onClick={() => leaveTo(exploreHref(t, { trail: trail.slice(0, i), embed }), t, { key: null, kind: t.kind, label: t.label })}
              className="text-foreground hover:text-primary rounded px-0.5 font-medium hover:underline"
            >
              {crumbLabel(t, trail[i - 1])}
            </button>
          </Fragment>
        ))}
        <ChevronRight className="text-text-dim size-3.5" aria-hidden="true" />
        <span className="text-foreground px-0.5 font-bold" aria-current="page">
          {crumbLabel({ ...current, label: model.center.name }, trail[trail.length - 1])}
        </span>
      </nav>

      <PageHeader title={title} description={description} embedLabel={`${model.center.name} · ${KIND_TITLE[kind]}`} actions={<ExploreSearch onPick={(t) => navigate(t, null)} />} />

      {/* 자리: lg~2xl = [도넛 / 그 아래 왼쪽 열 카드] | [패널(두 줄 걸침)] · 2xl(≥1,536px) = [왼쪽 열] | [도넛] | [패널] — 왼쪽 열이 전체 폭을 먹지 않는다. */}
      {/* 1920×1080 기준(원장 2026-11-03 *"스크롤 안 생기게"*): 도넛은 화면 높이에 맞춰 줄고(donut.tsx max-width), 패널·왼쪽 열은 제 안에서 스크롤. 위쪽 안내 알약은 뺐다(세로 낭비). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:items-start 2xl:grid-cols-[20rem_minmax(0,1fr)_minmax(20rem,25rem)]">
        <section aria-label="연결 도넛" className="min-w-0 space-y-2 lg:col-start-1 lg:row-start-1 2xl:col-start-2">
          <ExploreDonut
            center={model.center}
            sectors={model.sectors}
            selected={selected}
            onSelect={selectSector}
            onZoom={zoom}
            onCenterZoom={centerZoom}
            leaving={leaving}
            arrived={!!handoff}
          />
          <p className="text-text-dim px-1 text-center text-xs break-keep">
            클릭 = 오른쪽에 펼치기 · 더블클릭 = 흡수(그 조각이 중심) · 가운데 더블클릭 = 상세 열기 · 기준일 <span className="num">{model.asOf}</span>
          </p>
        </section>
        <div
          key={sector.key}
          data-explore-panel=""
          className={`lg:col-start-2 lg:row-start-1 lg:row-span-2 2xl:col-start-3 2xl:row-span-1 ${styles.panelEnter} transition-opacity ${leaving ? "opacity-50" : ""}`}
        >
          <ExploreSidePanel sector={sector} center={model.center} onNavigate={(t) => navigate(t)} pending={!!leaving} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 2xl:col-start-1 2xl:row-start-1 2xl:max-h-[calc(100dvh-13rem)] 2xl:overflow-y-auto">
          <AsideColumn center={model.center} aside={model.aside} />
        </div>
      </div>
    </div>
  );
}

/** 경로 한 칸의 글자 — 영역 중심("김민서G · 출결")이 바로 앞 칸과 같은 대상의 것이면 영역 이름만("출결"), 되풀이를 줄인다. */
function crumbLabel(t: TrailLabel, prev: TrailLabel | undefined): string {
  if (!t.sector || !prev || prev.kind !== t.kind || prev.id !== t.id) return t.label;
  const at = t.label.lastIndexOf(" · ");
  return at >= 0 ? t.label.slice(at + 3) : t.label;
}

/** 주소의 `?sector=`가 지금 모델의 쐐기(조각 또는 작은 조각)인가. */
function isValidSel(model: ExploreModel, sel: string): boolean {
  const { sectorKey, partKey } = splitSelKey(sel);
  const s = model.sectors.find((x) => x.key === sectorKey);
  if (!s) return false;
  return partKey === null || !!s.parts?.some((p) => p.key === partKey);
}

/** 패널에 펼칠 것 — 고른 쐐기(작은 조각이면 그 반 하나짜리 패널), 아무것도 안 골랐으면 모델의 기본(영역 전체 또는 첫 조각). */
function panelSectorOf(model: ExploreModel, sel: string | null): ExploreSector {
  const fallback = model.panelDefault ?? model.sectors.find((s) => s.key === model.defaultSector) ?? model.sectors[0];
  if (!sel) return fallback;
  const { sectorKey, partKey } = splitSelKey(sel);
  const s = model.sectors.find((x) => x.key === sectorKey) ?? fallback;
  if (!partKey) return s;
  const p = s.parts?.find((x) => x.key === partKey);
  if (!p) return s;
  // 패널 제목이 곧 이 반 — 이름을 되풀이하지 않고(원장 2026-11-03) 그 반 요약 + '중심으로 보기'.
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
 * 패널에 그려진 창 링크(`WindowLink`)를 대신 누른다 — 더블클릭·Enter가 **같은 링크를 지나** 같은 창 규약(최상위=창 · 창 안=부모 창 · 폰=이동)을 탄다.
 * 링크가 아직 안 그려졌으면(패널이 다른 조각) 그 주소로 이동한다.
 */
function openPanelLink(href: string) {
  if (typeof document === "undefined") return;
  const anchor = [...document.querySelectorAll<HTMLAnchorElement>("[data-explore-panel] a[href]")].find((a) => (a.getAttribute("href") ?? "").startsWith(href));
  if (anchor) anchor.click();
  else window.open(href, "_blank", "noopener");
}

/** 지금 고른 쐐기를 주소에 남긴다(새로고침·뒤로 가기 복원). */
function syncSectorParam(key: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("sector", key);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
}

/** 이름 뒤 조사 — 받침 있으면 '과', 없거나 한글이 아니면 '와'. */
function withGwa(name: string): "과" | "와" {
  const code = name.charCodeAt(name.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return hangul && (code - 0xac00) % 28 !== 0 ? "과" : "와";
}
