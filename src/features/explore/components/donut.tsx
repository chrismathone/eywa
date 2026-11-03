"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Pill } from "@/components/atoms/pill";
import {
  DONUT_CENTER,
  DONUT_INNER,
  DONUT_LABEL_R,
  DONUT_OUTER,
  DONUT_SIZE,
  KIND_ICON,
  KIND_LABEL,
  OFFSET_HOVER,
  OFFSET_SELECTED,
  TONE_FILL,
  TONE_INK_CLASS,
  polar,
  sectorAngles,
  sectorOffset,
  sectorPath,
  type ExploreCenter,
  type ExploreKind,
  type ExploreSector,
} from "../model";
import styles from "./explore.module.css";

/** 떠나는 중 — 고른 대상(가운데 원이 먼저 이 이름을 받는다)과 그 대상을 고른 조각(가운데로 날아간다). */
export type Leaving = { key: string | null; kind: ExploreKind; label: string };

type Props = {
  center: ExploreCenter;
  sectors: ExploreSector[];
  /** 고른 조각 — null이면 아무것도 띄우지 않는다(처음 열었을 때). */
  selected: string | null;
  /** 한 번 클릭 — 조각을 고른다(패널이 그 조각을 펼친다). */
  onSelect: (key: string) => void;
  /** 더블클릭·Enter — **확대**: 연결 대상이 하나면 그 대상이 중심으로, 업무 화면이 이어진 조각이면 그 화면을 연다. */
  onZoom: (key: string) => void;
  /** 가운데 원 더블클릭 — 지금 중심의 기존 상세 화면을 연다. */
  onCenterZoom: () => void;
  leaving: Leaving | null;
};

/** 조각마다 펼쳐지는 간격(ms) — 맨 위부터 시계 방향으로 "촤르륵". */
const STAGGER_MS = 60;

/**
 * 중심 전환형 도넛 — 통계 차트가 아니라 **탐색 메뉴**다. 조각은 같은 크기(퍼센트로 바꾸지 않는다), 글자는 전부 수평,
 * 조각 사이는 흰 간격(조각 테두리 = 카드색), 고르거나 올린 조각만 바깥으로 **모양 그대로** 돌출한다(12~18px).
 * 조각 모양·클릭 영역 = SVG path · 글자·그림 = HTML 겹판(줄바꿈·말줄임·아이콘을 HTML로 다룬다). 둘은 같은 각도·같은 이동량을 쓴다.
 * 모션(펼침·접힘·올리기)은 [`explore.module.css`](./explore.module.css) 한 곳 — 바깥 <g>(도넛 중심 축)과 안쪽 <g>(제 중심 축)을 겹쳐
 * 펼침·접힘과 올리기가 서로의 축을 건드리지 않는다.
 * 키보드 — Tab으로 도넛에 들어오면 고른 조각에 초점, ←→↑↓로 옆 조각, Enter/Space로 고르기·전환. 선택은 색만이 아니라
 * 돌출·테두리·그림자·`aria-pressed`로도 드러난다.
 */
export function ExploreDonut({ center, sectors, selected, onSelect, onZoom, onCenterZoom, leaving }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const n = sectors.length;
  const C = DONUT_CENTER;

  const move = (from: number, delta: number) => {
    const next = (from + delta + n) % n;
    refs.current[next]?.focus();
    onSelect(sectors[next].key);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, i: number) => {
    const key = sectors[i].key;
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

  const geo = sectors.map((s, i) => {
    const a = sectorAngles(n, i);
    const isSel = s.key === selected;
    const isHot = !isSel && (s.key === hover || s.key === focus);
    const lift = isSel ? OFFSET_SELECTED : isHot ? OFFSET_HOVER : 0;
    return {
      a,
      lift,
      scale: isHot ? 1.035 : 1,
      ...sectorOffset(a.mid, lift),
      label: polar(C, C, DONUT_LABEL_R, a.mid),
      path: sectorPath(C, C, DONUT_INNER, DONUT_OUTER, a.start, a.end),
    };
  });

  return (
    <div className="relative mx-auto w-full max-w-2xl select-none 2xl:max-w-3xl" aria-busy={leaving ? true : undefined}>
      <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="block h-auto w-full" role="group" aria-label={`${center.name}의 연결 영역 ${n}개`}>
        <circle cx={C} cy={C} r={DONUT_OUTER + 10} fill="var(--card)" stroke="var(--line-faint)" />
        {sectors.map((s, i) => {
          const g = geo[i];
          const isSel = s.key === selected;
          const isFocus = s.key === focus;
          const outerCls = leaving ? (leaving.key === s.key ? styles.sectorOuterLeaveChosen : styles.sectorOuterLeave) : styles.sectorOuter;
          return (
            <g key={s.key} className={outerCls} style={{ animationDelay: leaving ? `${(n - 1 - i) * 18}ms` : `${i * STAGGER_MS}ms` }}>
              <g
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="button"
                tabIndex={isSel || (selected === null && i === 0) ? 0 : -1}
                aria-pressed={isSel}
                aria-label={`${s.label}: ${s.summary}`}
                className={`${styles.sector} ${isSel ? styles.sectorSelected : g.lift > 0 ? styles.sectorHover : ""}`}
                style={{ transform: `translate(${g.dx.toFixed(2)}px, ${g.dy.toFixed(2)}px) scale(${g.scale})` }}
                onClick={() => onSelect(s.key)}
                onDoubleClick={() => onZoom(s.key)}
                onKeyDown={(e) => onKey(e, i)}
                onFocus={() => setFocus(s.key)}
                onBlur={() => setFocus((f) => (f === s.key ? null : f))}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover((h) => (h === s.key ? null : h))}
              >
                <path d={g.path} fill={isSel ? "var(--primary)" : TONE_FILL[s.tone]} stroke="var(--card)" strokeWidth={6} strokeLinejoin="round" />
                {isFocus ? <path d={g.path} fill="none" stroke="var(--ring)" strokeWidth={3} strokeDasharray="10 6" /> : null}
              </g>
            </g>
          );
        })}
      </svg>

      {/* 글자·그림 겹판 — 포인터는 아래 SVG 조각이 받는다. 떠날 땐 고른 조각의 글자가 가운데로 날아간다. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {sectors.map((s, i) => {
          const g = geo[i];
          const isSel = s.key === selected;
          const muted = s.state === "denied" || s.state === "error";
          const chosen = leaving?.key === s.key;
          const midCls = leaving ? (chosen ? styles.labelLeaveChosen : styles.labelLeave) : styles.labelEnter;
          return (
            <div
              key={s.key}
              className={`absolute w-[26%] -translate-x-1/2 -translate-y-1/2 ${styles.labelOuter}`}
              style={{
                left: chosen ? "50%" : `${(g.label.x / DONUT_SIZE) * 100}%`,
                top: chosen ? "50%" : `${(g.label.y / DONUT_SIZE) * 100}%`,
              }}
            >
              <div className={midCls} style={{ animationDelay: leaving ? "0ms" : `${i * STAGGER_MS + 60}ms` }}>
                <div className={`flex flex-col items-center gap-1 text-center ${styles.label}`} style={{ transform: `translate(${g.dx}px, ${g.dy}px)` }}>
                  <EyIcon name={s.icon} size={30} className={isSel ? "text-primary-foreground" : TONE_INK_CLASS[s.tone]} />
                  <span className={`text-lg leading-tight font-bold break-keep ${isSel ? "text-primary-foreground" : "text-foreground"}`}>{s.label}</span>
                  <span
                    className={`line-clamp-2 max-w-full rounded-pill px-2.5 py-0.5 text-xs leading-snug font-medium break-keep ${
                      isSel ? "bg-card text-primary" : muted ? "bg-card/80 text-text-dim" : "bg-card/90 text-foreground"
                    }`}
                  >
                    {s.summary}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 고른 조각 자리에서 자라나 가운데 원이 되는 둥근 면 — 고른 조각이 "가운데로 들어와 원이 되는" 장면. 조각 색 그대로(선택된 조각이면 primary). */}
      {leaving?.key
        ? (() => {
            const i = sectors.findIndex((s) => s.key === leaving.key);
            if (i < 0) return null;
            const g = geo[i];
            const style = {
              "--ox": `${(g.label.x / DONUT_SIZE) * 100}%`,
              "--oy": `${(g.label.y / DONUT_SIZE) * 100}%`,
              background: sectors[i].key === selected ? "var(--primary)" : TONE_FILL[sectors[i].tone],
            } as CSSProperties;
            return <div className={styles.orb} style={style} aria-hidden="true" />;
          })()
        : null}

      {/* 가운데 원 — 지금 중심. 다른 대상을 고르면 **이 자리의 내용이 바뀐다**(옆에 노드를 더하지 않는다). 떠날 땐 고른 대상의 이름을 먼저 받는다. */}
      <div
        className={`bg-card shadow-card ring-primary-softer absolute top-1/2 left-1/2 flex aspect-square w-[40%] flex-col items-center justify-center gap-1.5 rounded-full px-4 text-center ring-8 ${
          center.detailHref ? "cursor-pointer" : ""
        } ${leaving ? styles.centerSwap : styles.centerEnter}`}
        style={leaving ? undefined : { transform: "translate(-50%, -50%)" }}
        onDoubleClick={() => onCenterZoom()}
        title={center.detailHref ? `더블클릭: ${center.detailLabel}` : undefined}
      >
        {leaving ? (
          <div key="leaving" className={`flex flex-col items-center gap-1.5 ${styles.centerContent}`} style={{ animationDelay: "320ms" }} role="status">
            <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full">
              <EyIcon name={KIND_ICON[leaving.kind]} size={30} />
            </span>
            <span className="text-foreground max-w-full truncate text-2xl leading-tight font-bold">{leaving.label}</span>
            <Pill color="primary">{KIND_LABEL[leaving.kind]} · 불러오는 중…</Pill>
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
