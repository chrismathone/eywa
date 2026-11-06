"use client";

import { Fragment, use, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
// `router.prefetch`의 `kind`는 Next 내부 enum 타입만 받는다 — 타입만 빌리고 값은 그 enum의 문자열("full")을 그대로 적는다(런타임 import 없음).
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { useEmbed } from "@/components/workspace/embed-context";
import { ExploreDonut, type Leaving } from "./donut";
import { ExploreSidePanel } from "./side-panel";
import { ExploreSearch } from "./explore-search";
import { AsideColumn } from "./aside-column";
import { AnalysisCard } from "./analysis-card";
import { RecordPanel } from "./record-panel";
import { ExploreNetwork, netNeighbors, prepareNetworkLeave, type NetFact, type NetInput, type NetRecordInfo } from "./network/explore-network";
import { fullGraphOf, netRecordInfo } from "./network/graph";
import { beginHandoff, endHandoff, takeHandoffFor } from "./transition-handoff";
import { clearOnBackground, crumbLabel, isValidSel, netAnalysesOf, openPanelLink, panelSectorOf, syncSectorParam } from "./view-helpers";
import { saveExplorePrefs } from "../server/prefs-actions";
import type { ExploreMode, ExploreNetView, ExplorePrefs } from "../view-prefs";
import styles from "./layout.module.css";
import {
  LEAVE_STAGGER_MS,
  analysisFocus,
  centerTrailItem,
  exploreHref,
  exploreLandingHref,
  nextTrail,
  sameCenter,
  wedgesOf,
  zoomPlan,
  type ExploreContribution,
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
  /** 계정에 저장된 보기 설정(전환 효과 생략 · 도넛/네트워크 · 네트워크 보기·색상·이름). */
  prefs: ExplorePrefs;
  /** 왼쪽 '기여도·기록' 카드의 점수(무거운 조회 — 기다리지 않고 넘긴 약속). 원생이 아니거나 기여도가 꺼졌으면 null. */
  contribution: Promise<ExploreContribution> | null;
  /** 네트워크 '온톨로지 사실'(형제 등 — 기다리지 않고 넘긴 약속). 원생 중심이 아니면 null. */
  facts: Promise<NetFact[]> | null;
};

/**
 * 고른 조각이 가운데로 들어가는 모션의 길이(`sector-leave-chosen`) — 새 화면은 이것이 **끝난 뒤에** 뜬다(그 사이 새 중심을 읽는다 ·
 * [`transition-handoff.ts`](./transition-handoff.ts)). 조각은 `LEAVE_STAGGER_MS`씩 벌려 시작하므로 붙드는 시간은 조각 수만큼 더한다.
 */
const LEAVE_MS = 560;

/** 머리글 설명 — 종류마다 한 줄(원장 2026-11-05 시안: 이름·나열 없이 짧게). */
const DESCRIPTION: Record<ExploreKind, string> = {
  student: "이어진 수업·출결·성적·진도·상담·수납·약속을 한눈에",
  class: "이어진 원생·강사·시간표·강의실·출석부·시트를 한눈에",
  teacher: "이어진 수업·시간표·원생·시트·보고서·직원 정보를 한눈에",
  room: "이 강의실에서 도는 수업·강사·시간표를 한눈에",
};

/** 네트워크 판 높이 = 도넛 칸(도넛 + 설명줄)과 같게 — 보기를 바꿔도 좌우 열 높이가 그대로다(도넛 폭 상한 `min(48rem, 100dvh - 15rem)`). */
const NET_HEIGHT = "calc(min(48rem, 100dvh - 15rem) + 1.75rem)";

/**
 * 이 문서에서 방금 바꾼 보기 설정 — 저장(서버 액션)이 끝나기 전에 중심을 바꿔도 새 화면이 옛 값으로 돌아가지 않게 덮어 쓴다.
 * 🔴 이벤트 처리에서만 바꾼다(서버 렌더에선 늘 빈 값 — 요청 사이에 새지 않는다). 넓게 보기는 계정에 남기지 않고 이 문서에서만 잇는다.
 */
const sessionPrefs: Partial<ExplorePrefs> & { wide?: boolean } = {};

/**
 * 연결 탐색 본체(원장 2026-11-05 시안 :3978과 같은 구조) — [왼쪽 '원생 정보'] [가운데 도넛 · 네트워크] [오른쪽 '펼친 영역' : '분석·판단' = 1:1].
 * 중심 전환은 **주소 이동**이다(`/explore/<종류>/<id>[/<영역>]?t=<경로>`): 새로고침·직접 접근·브라우저 뒤로 가기가 그대로 된다.
 * 도넛 = 쐐기가 접히는 동안(되돌아가면 흡수의 역재생) `router.push`로 새 중심을 읽고 새 화면은 접힘이 끝날 때까지 미룬다(`use(handoff.ready)`).
 * 네트워크 = 떠나기 직전 판을 맡기고(`prepareNetworkLeave`) 새 판이 그 모습에서 이어 보간한다. 우클릭 = 한 칸 뒤로 · 전환 효과 생략이면 모두 즉시.
 */
export function ExploreView({ model, trail, initialSector, prefs, contribution, facts: factsPromise }: Props) {
  const router = useRouter();
  const embed = useEmbed();
  const [, startTransition] = useTransition();
  const init = { ...prefs, ...sessionPrefs };
  const [selected, setSelected] = useState<string | null>(() => (initialSector && isValidSel(model, initialSector) ? initialSector : null));
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [instant, setInstant] = useState(init.instant);
  const [mode, setMode] = useState<ExploreMode>(init.mode);
  const [netView, setNetView] = useState<ExploreNetView>(init.netView);
  const [colored, setColored] = useState(init.colored);
  const [labels, setLabels] = useState(init.labels);
  const [wide, setWide] = useState(init.mode === "network" && sessionPrefs.wide === true);
  const [record, setRecord] = useState<NetRecordInfo | null>(null);
  const [facts, setFacts] = useState<NetFact[] | undefined>(undefined);
  const current = centerTrailItem(model.center);
  const [handoff] = useState(() => takeHandoffFor(current));
  if (handoff) use(handoff.ready);
  useEffect(() => {
    if (handoff) endHandoff(handoff);
  }, [handoff]);
  useEffect(() => {
    if (!factsPromise) return;
    let live = true;
    factsPromise.then(
      (f) => {
        if (live && f.length > 0) setFacts(f);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [factsPromise]);
  const sector = panelSectorOf(model, selected);
  // 되돌아온 화면의 역재생 표식 — 화면 하나에 한 번(렌더마다 새 객체면 도넛의 타이머가 다시 걸린다).
  const back = useMemo(() => (handoff?.dir === "out" ? { from: handoff.from } : null), [handoff]);
  const analyses = useMemo(() => netAnalysesOf(model.analysis?.blocks, model), [model]);
  const netInput = useMemo<NetInput>(() => ({ model, analyses, facts }), [model, analyses, facts]);
  const neighbors = useMemo(() => (record ? netNeighbors(netInput, record.id) : []), [netInput, record]);

  // 좌우 열의 높이 = 가운데 요소(도넛 + 설명줄 · 네트워크 판) 높이(원장 2026-11-05 *"가운데 요소 기준으로 펼쳐져 있어야함"*).
  const gridRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const grid = gridRef.current;
    if (!stage || !grid) return;
    const sync = () => grid.style.setProperty("--stage-h", `${Math.round(stage.offsetHeight)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(stage);
    return () => ro.disconnect();
    // 보기를 바꾸면 가운데 칸(section)이 새 요소다 — 새 요소를 다시 잰다.
  }, [mode]);

  const savePref = (patch: Partial<ExplorePrefs>) => {
    Object.assign(sessionPrefs, patch);
    // 실패해도 이 문서에선 바뀐 대로 보인다 — 다음 방문에 되돌아가지 않게 저장 실패는 알린다.
    void saveExplorePrefs(patch)
      .then((r) => {
        if (!r.ok) toast("보기 설정을 저장하지 못했습니다. 다음에 열면 이전 설정으로 보일 수 있습니다.");
      })
      .catch(() => toast("보기 설정을 저장하지 못했습니다. 다음에 열면 이전 설정으로 보일 수 있습니다."));
  };

  /**
   * 떠나기 시작 + **바로** 새 중심 읽기 — 서버가 도는 동안 도넛은 접히고 네트워크는 판을 맡긴다. 전환 효과 생략·모션 끔 설정이면 바로 뜬다.
   * `pivotId` = 네트워크에서 더블클릭한 점(새 판의 가운데로 이어질 축).
   */
  const leaveTo = (href: string, to: TrailItem, next: Leaving, pivotId: string | null = null) => {
    setLeaving(next);
    const reduce = instant || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hold =
      mode === "network"
        ? prepareNetworkLeave(to, { dir: next.dir ?? "in", pivotId })
        : reduce
          ? 0
          : LEAVE_MS + (wedgesOf(model.sectors).length - 1) * LEAVE_STAGGER_MS + 16;
    beginHandoff(to, hold, { from: current, dir: next.dir ?? "in" });
    startTransition(() => router.push(href));
  };
  /** 한 번 클릭 때 흡수 목적지를 미리 받아 둔다(프로덕션만 — Next는 개발 모드에서 prefetch를 하지 않는다). */
  const warm = (href: string) => router.prefetch(href, { kind: "full" as PrefetchKind });
  const navigate = (target: ExploreTarget | TrailLabel, viaSel: string | null = selected ?? sector.key, pivotId: string | null = null) => {
    if (leaving) return;
    const to: TrailItem = "sector" in target && target.sector ? { kind: target.kind, id: target.id, sector: target.sector } : { kind: target.kind, id: target.id };
    // 지금 중심을 다시 고르면 그대로(같은 주소라 화면이 새로 서지 않아 떠나는 중 상태가 풀리지 않는다).
    if (sameCenter(to, current)) return;
    const isBack = trail.findIndex((t) => sameCenter(t, to)) >= 0;
    leaveTo(exploreHref(to, { trail: nextTrail(trail, current, to), embed }), to, { key: isBack ? null : viaSel, kind: target.kind, label: target.label, dir: isBack ? "out" : "in" }, pivotId);
  };
  /** 경로 i번째로 되돌아가기 — 경로 클릭·우클릭이 같은 길(흡수의 역재생). */
  const backTo = (i: number) => {
    if (leaving) return;
    const t = trail[i];
    if (!t) return;
    leaveTo(exploreHref(t, { trail: trail.slice(0, i), embed }), t, { key: null, kind: t.kind, label: t.label, dir: "out" });
  };
  /** 한 칸 뒤로(우클릭) — 되돌아갈 중심이 없으면 알린다(시안). */
  const goBack = () => {
    if (trail.length === 0) {
      toast("되돌아갈 이전 중심이 없습니다.");
      return;
    }
    backTo(trail.length - 1);
  };
  const onDonutContext = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("input, a, textarea, [data-native-menu]")) return;
    e.preventDefault();
    goBack();
  };
  const selectSector = (key: string | null) => {
    if (leaving) return;
    setSelected(key);
    syncSectorParam(key);
    if (!key) return;
    const plan = zoomPlan(model, key, trail, embed);
    if (plan && "go" in plan) warm(plan.go);
  };
  const zoom = (sel: string) => {
    if (leaving) return;
    const plan = zoomPlan(model, sel, trail, embed);
    if (!plan) return;
    setSelected(sel);
    if ("go" in plan) leaveTo(plan.go, plan.to, plan.leaving);
    else if (plan.link) openPanelLink(plan.link);
  };
  const centerZoom = () => {
    if (model.center.detailHref) openPanelLink(model.center.detailHref);
  };
  /** 네트워크 점 두 번 클릭(대상 아닌 것) — 대상이 있는 사실(형제)은 그 원생이 중심, 나머지는 오른쪽 패널에 자세히. */
  const openRecord = (rec: NetRecordInfo) => {
    if (rec.target) navigate(rec.target, selected, rec.id);
    else setRecord(rec);
  };
  /** 기록 패널의 이웃 줄 — 그 점을 고른다(판도 그 점을 강조한다). */
  const pickRecord = (id: string) => {
    const n = fullGraphOf(netInput).nodes.find((x) => x.id === id);
    if (n) setRecord(netRecordInfo(n, { adjacency: new Map() }));
  };
  const toggleInstant = (on: boolean) => {
    setInstant(on);
    savePref({ instant: on });
  };
  const switchMode = (m: ExploreMode) => {
    if (m === mode || leaving) return;
    setMode(m);
    if (m === "donut") {
      setWide(false);
      sessionPrefs.wide = false;
      setRecord(null);
    }
    savePref({ mode: m });
  };
  const changeWide = (on: boolean) => {
    setWide(on);
    sessionPrefs.wide = on;
  };

  const kind: ExploreKind = model.center.kind;
  const description = model.center.group ? "고른 영역의 항목을 조각으로 펼쳤습니다 · 더블클릭 = 그 항목이 중심" : DESCRIPTION[kind];
  const panelRecord = mode === "network" ? record : null;
  const focus = model.analysis ? analysisFocus(model.analysis.blocks, model, selected, panelRecord) : null;
  return (
    <div className={`space-y-2.5 ${instant ? styles.instant : ""}`}>
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
              onClick={() => backTo(i)}
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

      <PageHeader
        eyebrow="원생"
        title="연결 탐색"
        description={description}
        embedLabel={`${model.center.name} · 연결 탐색`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold whitespace-nowrap" title="켜면 중심 바꾸기·되돌아가기·보기 전환이 애니메이션 없이 바로 바뀝니다">
              <input type="checkbox" checked={instant} onChange={(e) => toggleInstant(e.target.checked)} className="accent-primary size-4" />
              전환 효과 생략
            </label>
            <ExploreSearch onPick={(t) => navigate(t, null)} />
            <ToolbarSegment title="보기">
              <ToolbarSegmentItem active={mode === "donut"} onClick={() => switchMode("donut")} className="gap-1">
                <EyIcon name="pieChart" size={15} />
                도넛
              </ToolbarSegmentItem>
              <ToolbarSegmentItem active={mode === "network"} onClick={() => switchMode("network")} className="gap-1">
                <EyIcon name="merge" size={15} />
                네트워크
              </ToolbarSegmentItem>
            </ToolbarSegment>
          </div>
        }
      />

      <div ref={gridRef} className={styles.grid} data-mode={mode} data-wide={mode === "network" && wide ? "true" : undefined}>
        <div className={styles.aside} aria-label="원생 정보">
          <AsideColumn center={model.center} aside={model.aside} contribution={contribution} />
        </div>
        {mode === "donut" ? (
          <section ref={stageRef} aria-label="연결 도넛" className={`${styles.stage} space-y-2`} onContextMenu={onDonutContext} onClick={(e) => clearOnBackground(e, selected, () => selectSector(null))}>
            <ExploreDonut
              center={model.center}
              sectors={model.sectors}
              selected={selected}
              onSelect={selectSector}
              onZoom={zoom}
              onCenterZoom={centerZoom}
              leaving={leaving}
              arrived={!!handoff}
              back={back}
            />
            <p className="text-text-dim px-1 text-center text-xs break-keep" data-native-menu="">
              클릭 = 펼치기 · 더블클릭 = 중심 바꾸기 · 가운데 더블클릭 = 상세 · 우클릭 = 되돌아가기
            </p>
          </section>
        ) : (
          <section ref={stageRef} aria-label="지식그래프 네트워크" className={styles.stage} style={{ "--net-h": NET_HEIGHT } as CSSProperties}>
            <ExploreNetwork
              {...netInput}
              selected={selected}
              record={record?.id ?? null}
              onSelectSector={selectSector}
              onSelectRecord={setRecord}
              onZoomSector={zoom}
              onOpenTarget={(t, via) => navigate(t, selected, via)}
              onOpenRecord={openRecord}
              onCenterZoom={centerZoom}
              onBack={goBack}
              view={netView}
              onViewChange={(v) => {
                setNetView(v);
                savePref({ netView: v });
              }}
              wide={wide}
              onWideChange={changeWide}
              instant={instant}
              colored={colored}
              labels={labels}
              onColoredChange={(b) => {
                setColored(b);
                savePref({ colored: b });
              }}
              onLabelsChange={(b) => {
                setLabels(b);
                savePref({ labels: b });
              }}
            />
          </section>
        )}
        <div className={styles.right}>
          <div className={styles.half}>
            <div className={`text-foreground text-xs ${styles.colHead}`}>
              <EyIcon name="layers" size={15} />
              펼친 영역
            </div>
            {panelRecord ? (
              <div key={`rec:${panelRecord.id}`} data-explore-panel="" className={`flex min-h-0 flex-1 flex-col ${styles.enter}`}>
                <RecordPanel
                  rec={panelRecord}
                  model={model}
                  neighbors={neighbors}
                  centerTarget={panelRecord.target}
                  onNavigate={(t) => navigate(t, selected, panelRecord.id)}
                  onPick={pickRecord}
                  onClose={() => setRecord(null)}
                  pending={!!leaving}
                />
              </div>
            ) : (
              <div key={sector.key} data-explore-panel="" className={`flex min-h-0 flex-1 flex-col ${styles.enter}`}>
                <ExploreSidePanel sector={sector} onNavigate={(t) => navigate(t)} pending={!!leaving} />
              </div>
            )}
          </div>
          <div className={styles.half}>
            <div className={`text-foreground text-xs ${styles.colHead}`}>
              <EyIcon name="sparkle" size={15} className="text-primary" />
              분석·판단
            </div>
            <AnalysisCard studentId={kind === "student" ? model.center.id : null} analysis={model.analysis} focus={focus} />
          </div>
        </div>
      </div>
    </div>
  );
}
