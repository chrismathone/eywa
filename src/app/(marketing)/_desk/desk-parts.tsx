"use client";

import type { Dispatch } from "react";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { dotPos, stepPath, wireRoute, type Geo, type Rect } from "./geometry";
import { WIN_META, winTitle } from "./rooms";
import type { Win, WinAction } from "./windows-state";

/**
 * 방 점 → 그 방 창 연결선. 가로로 나와 창 옆에서 한 번 꺾여 제목줄로 들어간다(계단식 — 원장 2026-09-22
 * *"좀 더 잘보이게 직진하지말고 계단식으로 꺾는걸로"*). 흰 테두리(halo)를 먼저 깔아 모형 위에서도 보이고,
 * 지금 보는 창의 선만 실선·노란 끝점이다.
 */
export function Wires({ wins, geo, frontId }: { wins: Win[]; geo: Geo | null; frontId: string | null }) {
  if (!geo) return <svg className="wires" aria-hidden="true" />;
  const lines = wins.flatMap((w) => {
    const room = WIN_META[w.type].room;
    if (w.min || w.max || !room) return [];
    const pts = wireRoute(dotPos(room, geo.model), w);
    return pts ? [{ id: w.id, d: stepPath(pts, 10), e: pts[pts.length - 1], on: w.id === frontId }] : [];
  }).sort((a, b) => Number(a.on) - Number(b.on));
  return (
    <svg className="wires" aria-hidden="true">
      {lines.map((l) => (
        <g key={l.id}>
          <path className="halo" d={l.d} />
          <path className={`ln${l.on ? " on" : ""}`} d={l.d} />
          <circle className={l.on ? "on" : undefined} r={4.5} cx={l.e[0].toFixed(1)} cy={l.e[1].toFixed(1)} />
        </g>
      ))}
    </svg>
  );
}

/** 접은 창 줄(데스크톱) — 누르면 다시 편다. */
export function Dock({ wins, dispatch }: { wins: Win[]; dispatch: Dispatch<WinAction> }) {
  const mins = wins.filter((w) => w.min);
  if (!mins.length) return null;
  return (
    <div className="dock" role="group" aria-label="접어 둔 창">
      {mins.map((w) => (
        <button key={w.id} type="button" onClick={() => dispatch({ t: "min", id: w.id, on: false })}>
          <MenuGlyph name={WIN_META[w.type].icon} size={16} />{w.type === "stu" ? w.arg : winTitle(w.type)}
        </button>
      ))}
    </div>
  );
}

/** 폰: 열린 창 탭 — 창은 모형 아래에 한 번에 하나. */
export function MobileTabs({ wins, frontId, dispatch }: { wins: Win[]; frontId: string | null; dispatch: Dispatch<WinAction> }) {
  if (!wins.length) return null;
  return (
    <div className="m-tabs" role="group" aria-label="열린 창">
      {wins.map((w) => (
        <button key={w.id} type="button" className={w.id === frontId ? "on" : ""} aria-pressed={w.id === frontId} onClick={() => dispatch({ t: "focus", id: w.id })}>
          <MenuGlyph name={WIN_META[w.type].icon} size={18} />{w.type === "stu" ? w.arg : winTitle(w.type)}
        </button>
      ))}
    </div>
  );
}

/** 스냅 미리보기(좌우 반쪽·꽉 채움). */
export function SnapGhost({ rect }: { rect: Rect | null }) {
  return <div className={`snap-ghost${rect ? " show" : ""}`} style={rect ? { left: rect[0], top: rect[1], width: rect[2], height: rect[3] } : undefined} />;
}
