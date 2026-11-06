"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { AywaIconName } from "@/components/icons/aywa-icons";
import { Pill } from "@/components/atoms/pill";
import {
  DONUT_CENTER,
  DONUT_INNER,
  DONUT_LABEL_R,
  DONUT_OUTER,
  DONUT_SIZE,
  KIND_ICON,
  KIND_LABEL,
  LEAVE_STAGGER_MS,
  OFFSET_HOVER,
  OFFSET_SELECTED,
  TONE_FILL,
  TONE_INK_CLASS,
  polar,
  sectorOffset,
  sectorPath,
  wedgesOf,
  type ExploreCenter,
  type ExploreKind,
  type ExploreSector,
  type TrailItem,
} from "../model";
import styles from "./explore.module.css";

/** 떠나는 중 — 고른 대상(가운데 원이 먼저 이 이름을 받는다)과 그 대상을 고른 쐐기(가운데로 빨려 들어간다). */
export type Leaving = { key: string | null; kind: ExploreKind; label: string; icon?: AywaIconName; /** out = 되돌아가기(흡수의 역재생). */ dir?: "in" | "out" };

type Props = {
  center: ExploreCenter;
  sectors: ExploreSector[];
  /** 고른 쐐기의 선택 key(`조각 key` 또는 `조각 key#작은 조각 key`) — null이면 아무것도 띄우지 않는다. */
  selected: string | null;
  /** 한 번 클릭 — 쐐기를 고른다(패널이 그것을 펼친다). */
  onSelect: (selKey: string) => void;
  /** 더블클릭·Enter — **흡수**: 그 쐐기가 가운데로 들어와 새 중심이 된다. */
  onZoom: (selKey: string) => void;
  /** 가운데 원 더블클릭 — 지금 중심의 기존 상세 화면을 연다. */
  onCenterZoom: () => void;
  leaving: Leaving | null;
  /** 떠난 화면에서 이어 받아 뜬 화면 — 가운데 원은 이미 이 이름으로 떠 있었으니 등장 모션을 건너뛴다(조각 펼침은 그대로). */
  arrived?: boolean;
  /** 되돌아와 뜬 화면 — `from`(떠난 중심)으로 이어진 쐐기가 가운데에서 되살아나고 나머지는 사라지던 그대로 돌아온다. */
  back?: { from: TrailItem | null } | null;
};

/**
 * 중심 전환형 도넛 — 통계 차트가 아니라 **탐색 메뉴**다. 조각은 같은 크기(퍼센트로 바꾸지 않는다), 같은 과목의 반이 여럿이면 그 조각 안에서
 * 다시 n분할(`parts` → `wedgesOf`). 글자는 전부 수평, 조각 사이는 흰 간격, 고르거나 올린 쐐기만 바깥으로 **모양 그대로** 돌출(12~18px).
 * 쐐기 모양·클릭 영역 = SVG path · 글자·그림 = HTML 겹판. 모션(펼침·접힘·올리기)은 [`explore.module.css`](./explore.module.css) 한 곳 —
 * 바깥 <g>(도넛 중심 축)과 안쪽 <g>(제 중심 축)을 겹쳐 펼침·흡수와 올리기가 서로의 축을 건드리지 않는다.
 * 키보드 — Tab으로 도넛에 들어오면 고른 쐐기에 초점, ←→↑↓로 옆 쐐기, Enter/Space로 고르기·흡수. 선택은 색만이 아니라 돌출·테두리·그림자·`aria-pressed`로도.
 */
export function ExploreDonut({ center, sectors, selected, onSelect, onZoom, onCenterZoom, leaving, arrived = false, back = null }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const wedges = wedgesOf(sectors);
  const n = wedges.length;
  const C = DONUT_CENTER;
  const stagger = Math.min(60, Math.round(520 / Math.max(n, 1)));
  const fullSpan = 360 / Math.max(sectors.length, 1);
  const out = leaving?.dir === "out";
  // 되돌아와 뜬 화면 — 떠난 중심으로 이어진 쐐기(그 반·그 영역·그 대상)를 찾는다. 못 찾으면 고리만 거꾸로 돌아온다.
  const [via] = useState<string | null>(() => (back ? viaWedgeOf(wedges, back.from) : null));
  const [settled, setSettled] = useState(!back);
  const [labelsMoved, setLabelsMoved] = useState(!back);
  useEffect(() => {
    if (!back) return;
    const moveT = window.setTimeout(() => setLabelsMoved(true), 140);
    const doneT = window.setTimeout(() => setSettled(true), 600);
    return () => {
      window.clearTimeout(moveT);
      window.clearTimeout(doneT);
    };
  }, [back]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + n) % n;
    refs.current[next]?.focus();
    onSelect(wedges[next].selKey);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, i: number) => {
    const key = wedges[i].selKey;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (key === selected) onZoom(key);
      else onSelect(key);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(i, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(i, -i);
    }
  };

  const geo = wedges.map((w) => {
    const isSel = w.selKey === selected || (!settled && w.selKey === via);
    const isHot = !isSel && (w.selKey === hover || w.selKey === focus);
    const lift = isSel ? OFFSET_SELECTED : isHot ? OFFSET_HOVER : 0;
    const span = w.angles.end - w.angles.start;
    return {
      lift,
      scale: isHot ? 1.035 : 1,
      ...sectorOffset(w.angles.mid, lift),
      label: polar(C, C, DONUT_LABEL_R, w.angles.mid),
      path: sectorPath(C, C, DONUT_INNER, DONUT_OUTER, w.angles.start, w.angles.end),
      // 라벨 상자 폭 — 조각 그대로면 26%, 작은 조각은 각도에 비례(바닥 13%).
      widthPct: Math.max(13, Math.min(26, (26 * span) / fullSpan)),
      narrow: span < fullSpan * 0.75,
    };
  });

  return (
    // 크기 = 폭과 **화면 높이** 중 작은 쪽(1920×1080에서 페이지 스크롤이 안 생기게 — 머리글·경로·설명 줄을 뺀 높이).
    <div className="relative mx-auto w-full max-w-[min(48rem,calc(100dvh-15rem))] select-none" aria-busy={leaving ? true : undefined}>
      <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="block h-auto w-full" role="group" aria-label={`${center.name}의 연결 영역 ${n}개`}>
        <circle cx={C} cy={C} r={DONUT_OUTER + 10} fill="var(--card)" stroke="var(--line-faint)" />
        {wedges.map((w, i) => {
          const g = geo[i];
          const isSel = w.selKey === selected || (!settled && w.selKey === via);
          const isFocus = w.selKey === focus;
          // 🔴 바깥 <g>는 늘 `.sectorOuter`를 지닌다(변형 축 = 도넛 중심). 떠날 때 그 클래스를 떼면 축이 좌상단(0,0)으로 떨어져
          //    고른 조각이 가운데가 아니라 **왼쪽 위로** 빨려 갔다(원장 2026-11-03 캡처).
          const outerCls = `${styles.sectorOuter} ${leaving ? (out ? styles.sectorOuterUnenter : leaving.key === w.selKey ? styles.sectorOuterLeaveChosen : styles.sectorOuterLeave) : via !== null ? (w.selKey === via ? styles.sectorOuterBackChosen : styles.sectorOuterBack) : back ? styles.sectorOuterBack : ""}`;
          const delay = leaving ? (out ? (n - 1 - i) * stagger : (n - 1 - i) * LEAVE_STAGGER_MS) : back ? (w.selKey === via ? 0 : Math.max(0, 320 - (n - 1 - i) * LEAVE_STAGGER_MS)) : i * stagger;
          return (
            <g key={w.selKey} className={outerCls} style={{ animationDelay: `${delay}ms` }}>
              <g
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="button"
                tabIndex={isSel || (selected === null && i === 0) ? 0 : -1}
                aria-pressed={isSel}
                aria-label={`${w.eyebrow ? `${w.eyebrow} ` : ""}${w.label}: ${w.summary}`}
                className={`${styles.sector} ${isSel ? styles.sectorSelected : g.lift > 0 ? styles.sectorHover : ""}`}
                style={{ transform: `translate(${g.dx.toFixed(2)}px, ${g.dy.toFixed(2)}px) scale(${g.scale})` }}
                onClick={() => onSelect(w.selKey)}
                onDoubleClick={() => onZoom(w.selKey)}
                onKeyDown={(e) => onKey(e, i)}
                onFocus={() => setFocus(w.selKey)}
                onBlur={() => setFocus((f) => (f === w.selKey ? null : f))}
                onMouseEnter={() => setHover(w.selKey)}
                onMouseLeave={() => setHover((h) => (h === w.selKey ? null : h))}
              >
                <path d={g.path} fill={isSel ? "var(--primary)" : TONE_FILL[w.tone]} stroke="var(--card)" strokeWidth={w.part ? 4 : 6} strokeLinejoin="round" />
                {isFocus ? <path d={g.path} fill="none" stroke="var(--ring)" strokeWidth={3} strokeDasharray="10 6" /> : null}
              </g>
            </g>
          );
        })}
      </svg>

      {/* 글자·그림 겹판 — 포인터는 아래 SVG 쐐기가 받는다. 떠날 땐 고른 쐐기의 글자가 가운데로 날아간다. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {wedges.map((w, i) => {
          const g = geo[i];
          const isSel = w.selKey === selected || (!settled && w.selKey === via);
          const muted = w.sector.state === "denied" || w.sector.state === "error";
          const chosen = !out && leaving?.key === w.selKey;
          // 되살아나는 쐐기의 글자는 가운데에서 출발해 140ms 뒤 제자리로 미끄러진다(들어올 때의 거꾸로).
          const fromCenter = w.selKey === via && !settled;
          const midCls = leaving ? (out ? styles.labelUnenter : chosen ? styles.labelLeaveChosen : styles.labelLeave) : back ? (w.selKey === via ? styles.labelBackChosen : styles.labelBack) : styles.labelEnter;
          const midDelay = leaving ? (out ? 40 + (n - 1 - i) * stagger : 0) : back ? (w.selKey === via ? 120 : 360) : i * stagger + 60;
          return (
            <div
              key={w.selKey}
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${styles.labelOuter}`}
              style={{
                width: `${g.widthPct}%`,
                left: chosen || (fromCenter && !labelsMoved) ? "50%" : `${(g.label.x / DONUT_SIZE) * 100}%`,
                top: chosen || (fromCenter && !labelsMoved) ? "50%" : `${(g.label.y / DONUT_SIZE) * 100}%`,
              }}
            >
              <div className={midCls} style={{ animationDelay: `${midDelay}ms` }}>
                <div className={`flex flex-col items-center gap-1 text-center ${styles.label}`} style={{ transform: `translate(${g.dx}px, ${g.dy}px)` }}>
                  {w.eyebrow ? <span className={`text-xs leading-none font-medium ${isSel ? "text-primary-foreground" : "text-text-dim"}`}>{w.eyebrow}</span> : null}
                  <EyIcon name={w.icon} size={g.narrow ? 22 : 30} className={isSel ? "text-primary-foreground" : TONE_INK_CLASS[w.tone]} />
                  <span className={`${g.narrow ? "line-clamp-2 text-sm" : "text-lg"} leading-tight font-bold break-keep ${isSel ? "text-primary-foreground" : "text-foreground"}`}>
                    {w.label}
                  </span>
                  {w.summary ? (
                    <span
                      className={`${g.narrow ? "line-clamp-1" : "line-clamp-2"} max-w-full rounded-pill px-2.5 py-0.5 text-xs leading-snug font-medium break-keep ${
                        isSel ? "bg-card text-primary" : muted ? "bg-card/80 text-text-dim" : "bg-card/90 text-foreground"
                      }`}
                    >
                      {w.summary}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 고른 쐐기 자리에서 자라나 가운데 원이 되는 둥근 면 — "가운데로 들어와 원이 되는" 장면. 쐐기 색 그대로(선택된 쐐기면 primary). */}
      {leaving?.key && !out
        ? (() => {
            const i = wedges.findIndex((w) => w.selKey === leaving.key);
            if (i < 0) return null;
            const g = geo[i];
            const style = {
              "--ox": `${(g.label.x / DONUT_SIZE) * 100}%`,
              "--oy": `${(g.label.y / DONUT_SIZE) * 100}%`,
              background: wedges[i].selKey === selected ? "var(--primary)" : TONE_FILL[wedges[i].tone],
            } as CSSProperties;
            return <div className={styles.orb} style={style} aria-hidden="true" />;
          })()
        : null}

      {/* 되돌아와 뜬 화면 — 들어갈 때 가운데에 닿은 구슬이 거꾸로 떠올라 왔던 조각 자리로(고른 색 그대로). */}
      {via !== null && !settled
        ? (() => {
            const i = wedges.findIndex((w) => w.selKey === via);
            if (i < 0) return null;
            const g = geo[i];
            const style = { "--ox": `${(g.label.x / DONUT_SIZE) * 100}%`, "--oy": `${(g.label.y / DONUT_SIZE) * 100}%`, background: "var(--primary)" } as CSSProperties;
            return <div className={`${styles.orb} ${styles.orbOut}`} style={style} aria-hidden="true" />;
          })()
        : null}

      {/* 가운데 원 — 지금 중심. 다른 대상을 고르면 **이 자리의 내용이 바뀐다**(옆에 노드를 더하지 않는다). 떠날 땐 고른 대상의 이름을 먼저 받는다. */}
      <div
        className={`bg-card shadow-card ring-primary-softer absolute top-1/2 left-1/2 flex aspect-square w-[40%] flex-col items-center justify-center gap-1.5 rounded-full px-4 text-center ring-8 ${
          center.detailHref ? "cursor-pointer" : ""
        } ${leaving ? styles.centerSwap : back ? styles.centerSwapOut : arrived ? "" : styles.centerEnter}`}
        style={leaving || back ? undefined : { transform: "translate(-50%, -50%)" }}
        data-explore-center=""
        onDoubleClick={() => onCenterZoom()}
        title={center.detailHref ? `더블클릭: ${center.detailLabel}` : undefined}
      >
        {leaving ? (
          <div key="leaving" className={`flex max-w-full flex-col items-center gap-1.5 ${styles.centerContent}`} style={{ animationDelay: "320ms" }} role="status">
            <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full">
              <EyIcon name={leaving.icon ?? KIND_ICON[leaving.kind]} size={30} />
            </span>
            <span className="text-foreground max-w-full truncate text-2xl leading-tight font-bold">{leaving.label}</span>
            <Pill color="primary">{leaving.icon ? "불러오는 중…" : `${KIND_LABEL[leaving.kind]} · 불러오는 중…`}</Pill>
          </div>
        ) : (
          <div key="center" className={`flex max-w-full flex-col items-center gap-1.5 ${styles.centerContent}`}>
            <span className="bg-primary-soft text-primary flex size-14 items-center justify-center rounded-full">
              <EyIcon name={center.icon} size={30} />
            </span>
            <span className="text-foreground max-w-full truncate text-2xl leading-tight font-bold">{center.name}</span>
            {center.subtitle ? <span className="text-text-dim max-w-full truncate text-xs">{center.subtitle}</span> : null}
            {center.status ? (
              <Pill color={center.status.color}>
                <span className="mr-1 inline-block size-2 rounded-full bg-current" aria-hidden="true" />
                {center.status.label}
              </Pill>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 되돌아와 뜬 화면에서 "어느 쐐기에서 왔었나" — 떠난 중심(`from`)이 이 화면의 작은 조각(반)의 대상이거나, 이 중심의 영역 중심(같은 대상 + 영역 key)이거나,
 * 한 대상짜리 조각의 대상이면 그 쐐기. 못 찾으면 null(고리만 거꾸로 돌아온다).
 */
function viaWedgeOf(wedges: ReturnType<typeof wedgesOf>, from: TrailItem | null): string | null {
  if (!from) return null;
  for (const w of wedges) {
    if (w.part && w.part.target.kind === from.kind && w.part.target.id === from.id && !from.sector) return w.selKey;
  }
  for (const w of wedges) {
    if (from.sector && w.sector.key === from.sector && !w.part) return w.selKey;
    if (from.sector && w.sector.key === from.sector && w.part) return w.selKey;
  }
  for (const w of wedges) {
    const only = w.sector.focus ?? (w.sector.targets?.length === 1 ? w.sector.targets[0] : null);
    if (only && only.kind === from.kind && only.id === from.id && !from.sector) return w.selKey;
    if (!from.sector && w.sector.targets?.some((t) => t.kind === from.kind && t.id === from.id)) return w.selKey;
  }
  return null;
}
