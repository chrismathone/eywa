"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { useEmbed } from "@/components/workspace/embed-context";
import { ExploreDonut, type Leaving } from "./donut";
import { ExploreSidePanel } from "./side-panel";
import { ExploreSearch } from "./explore-search";
import { AsideColumn } from "./aside-column";
import styles from "./explore.module.css";
import {
  KIND_LABEL,
  KIND_TITLE,
  exploreHref,
  exploreLandingHref,
  nextTrail,
  type ExploreKind,
  type ExploreModel,
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

/** 접히는 모션이 끝난 뒤에 주소를 옮긴다 — 그 사이 새 중심을 읽기 시작해도 되지만, 옛 화면이 사라지기 전에 모션이 끝나야 자연스럽다. */
const LEAVE_MS = 560;

/**
 * 연결 탐색 본체 — 중심 전환은 **주소 이동**이다(`/explore/<종류>/<id>?t=<경로>`): 새로고침·직접 접근·브라우저 뒤로 가기가 그대로 된다.
 * 고르면 ① 조각들이 가운데로 접히고 가운데 원이 고른 이름을 받는다(`leaving`) → ② `startTransition` 안의 `router.push`로 새 중심을 읽어
 * 이름·조각·패널이 **한 번에** 바뀐다(옛 정보가 새 이름 아래 잠깐 보이지 않는다) → ③ 새 화면이 뜨며 조각이 차례로 펼쳐진다(donut.tsx).
 * 빠르게 연속으로 골라도 마지막 주소가 이긴다(타이머를 덮어쓴다). 고른 조각은 `?sector=`로 남긴다(서버를 다시 부르지 않는 `replaceState` —
 * 이동 중엔 손대지 않는다, Next 16).
 */
export function ExploreView({ model, trail, initialSector }: Props) {
  const router = useRouter();
  const embed = useEmbed();
  const [, startTransition] = useTransition();
  // 🔴 처음엔 **아무 조각도 고르지 않은 상태**다(원장 2026-11-03 *"12시는 선택 안 했는데도 항상 선택된 것처럼 위로 나와 있네"*) —
  //    패널은 기본 조각(수업·수강 원생·담당 수업)을 펼쳐 두되, 도넛은 사람이 올리거나 누른 조각만 띄운다. 주소에 `?sector=`가 있으면 그 조각.
  const [selected, setSelected] = useState<string | null>(() =>
    initialSector && model.sectors.some((s) => s.key === initialSector) ? initialSector : null,
  );
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const current: TrailItem = { kind: model.center.kind, id: model.center.id };
  const sector = model.sectors.find((s) => s.key === (selected ?? model.defaultSector)) ?? model.sectors[0];

  /** 접힘 → 주소 이동. 모션을 끄는 설정이면 바로 간다. */
  const leaveTo = (href: string, next: Leaving) => {
    setLeaving(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(() => startTransition(() => router.push(href)), reduce ? 0 : LEAVE_MS);
  };
  const navigate = (target: ExploreTarget | TrailLabel, viaSector: string | null = sector.key) =>
    leaveTo(exploreHref(target, { trail: nextTrail(trail, current, target), embed }), { key: viaSector, kind: target.kind, label: target.label });
  const selectSector = (key: string) => {
    if (leaving) return;
    setSelected(key);
    syncSectorParam(key);
  };
  /**
   * 확대(더블클릭·Enter, 원장 2026-11-03 *"더블 클릭하게 되면 확대되는식 · 번거로운 동작은 배제"*) — 한 번에 간다:
   * 연결 대상이 하나면 그 대상이 중심으로, 아니면 그 조각의 업무 화면(패널의 첫 링크)을 연다. 여러 대상이면 패널에서 고른다(이미 펼쳐져 있다).
   */
  const zoom = (key: string) => {
    if (leaving) return;
    const s = model.sectors.find((x) => x.key === key);
    if (!s) return;
    setSelected(key);
    const only = s.targets?.length === 1 && !(s.groups?.length) ? s.targets[0] : null;
    if (only) {
      navigate(only, key);
      return;
    }
    if (!s.targets?.length && s.links?.[0]) openPanelLink(s.links[0].href);
  };
  /** 가운데 원 더블클릭 = 지금 중심의 상세 화면(패널 아래 같은 링크를 누른 것과 같다 — 창 규약을 그 링크가 안다). */
  const centerZoom = () => {
    if (model.center.detailHref) openPanelLink(model.center.detailHref);
  };

  const kind: ExploreKind = model.center.kind;
  const areas = model.sectors.map((s) => s.label).join(", ");
  return (
    <div className="space-y-4">
      <nav aria-label="탐색 경로" className="flex flex-wrap items-center gap-1 px-1 text-sm">
        <EmbedLink href={exploreLandingHref()} className="text-text-dim hover:text-primary inline-flex items-center" aria-label="연결 탐색 처음으로">
          <EyIcon name="home" size={16} />
        </EmbedLink>
        {trail.map((t, i) => (
          <Fragment key={`${t.kind}:${t.id}`}>
            <ChevronRight className="text-text-dim size-3.5" aria-hidden="true" />
            <button
              type="button"
              onClick={() => leaveTo(exploreHref(t, { trail: trail.slice(0, i), embed }), { key: null, kind: t.kind, label: t.label })}
              className="text-foreground hover:text-primary rounded px-0.5 font-medium hover:underline"
            >
              {t.label}
            </button>
          </Fragment>
        ))}
        <ChevronRight className="text-text-dim size-3.5" aria-hidden="true" />
        <span className="text-foreground px-0.5 font-bold" aria-current="page">
          {model.center.name}
        </span>
      </nav>

      <PageHeader
        title={KIND_TITLE[kind]}
        description={`${KIND_LABEL[kind]} '${model.center.name}'${withGwa(model.center.name)} 연결된 ${areas}를 한눈에 탐색하세요.`}
        embedLabel={`${model.center.name} · ${KIND_TITLE[kind]}`}
        actions={<ExploreSearch onPick={(t) => navigate(t, null)} />}
      />

      {/* 자리: lg~2xl = [도넛 / 그 아래 왼쪽 열 카드] | [패널(두 줄 걸침)] · 2xl(≥1,536px) = [왼쪽 열] | [도넛] | [패널] — 왼쪽 열이 전체 폭을 먹지 않는다. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:items-start 2xl:grid-cols-[20rem_minmax(0,1fr)_minmax(20rem,25rem)]">
        <section aria-label="연결 도넛" className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1 2xl:col-start-2">
          <p className="bg-primary-soft text-primary inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-medium">
            <EyIcon name="sparkle" size={14} />
            항목을 선택하면 오른쪽에 펼쳐지고, 실제 대상을 고르면 그 대상이 중심이 됩니다
          </p>
          <ExploreDonut center={model.center} sectors={model.sectors} selected={selected} onSelect={selectSector} onZoom={zoom} onCenterZoom={centerZoom} leaving={leaving} />
          <p className="text-text-dim px-1 text-xs break-keep">
            클릭 = 오른쪽에 펼치기 · 더블클릭 = 확대(중심 전환·화면 열기) · 가운데 더블클릭 = 상세 열기 · 기준일 <span className="num">{model.asOf}</span>
          </p>
        </section>
        <div
          key={sector.key}
          data-explore-panel=""
          className={`lg:col-start-2 lg:row-start-1 lg:row-span-2 2xl:col-start-3 2xl:row-span-1 ${styles.panelEnter} transition-opacity ${leaving ? "opacity-50" : ""}`}
        >
          <ExploreSidePanel sector={sector} center={model.center} onNavigate={(t) => navigate(t)} pending={!!leaving} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 2xl:col-start-1 2xl:row-start-1">
          <AsideColumn center={model.center} aside={model.aside} />
        </div>
      </div>
    </div>
  );
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

/** 지금 고른 조각을 주소에 남긴다(새로고침·뒤로 가기 복원). */
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
