"use client";

import { cn } from "@/lib/utils";
import type { RunStopKind } from "../../types";
import { busSlot } from "../route-progress";

/**
 * 흐르는 선 · 화살표 애니메이션 — 이 부품 안에서만 쓰는 keyframes라 여기 둔다(전역 CSS에 안 퍼지게).
 * 🔴 '동작 줄이기'를 켠 폰에선 멈춘다(화살표는 그대로 보인다).
 */
const FLOW_CSS = `
@keyframes route-flow { from { background-position: 0 0 } to { background-position: 16px 0 } }
@keyframes route-nudge { 0%, 100% { transform: translate(50%, -50%) } 50% { transform: translate(80%, -50%) } }
.route-flow { background-image: repeating-linear-gradient(90deg, transparent 0 8px, rgb(255 255 255 / .55) 8px 12px, transparent 12px 16px); animation: route-flow .9s linear infinite }
.route-nudge { animation: route-nudge 1.2s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .route-flow, .route-nudge { animation: none } }
`;

/** 노선도 한 칸. `role`이 있으면 우리 아이가 **타는 곳(board) / 내리는 곳(alight)** — 학부모 화면만 쓴다. */
export type LineStop = { id: string; kind: RunStopKind; name: string; time: string | null; role?: "board" | "alight" };

export const ROLE_LABEL = { board: "탈 곳", alight: "내릴 곳" } as const;

/**
 * 버스 노선도 모양(사용자 2026-10-14 "버스 노선에서 보는 것처럼 동그랗게 하고 시간·역 표시") — 회차 하나 = 한 줄.
 * 가로 선 위에 정류장 동그라미, 위엔 시각, 아래엔 정류장 이름. 학원 출발·도착은 채운 동그라미로 구분한다.
 * 직원 '실시간 위치'(track의 RunLineDiagram)와 학부모 '실시간 차량'이 함께 쓴다.
 *
 * 🔑 정류장 순서·시각은 편성 그대로 — 화면에서 새로 정하지 않는다(부르는 쪽이 순서대로 넘긴다).
 * 🔑 `role` 칸은 초록(탈 곳) / 주황(내릴 곳) 동그라미 + 꼬리표(사용자 2026-10-15 "내가 탈 곳 내릴 곳만 구분").
 * 📱 **가로 스크롤 없음**(사용자 2026-10-14) — 정류장이 많으면 **다음 줄로 내려간다**(폰 4칸 · 넓으면 6~8칸). 줄 끝에서 선이
 *    끊기고 다음 줄 첫 칸에서 이어진다(순서는 왼쪽→오른쪽, 위→아래).
 */
export function RouteLineDiagram({
  time,
  label,
  title,
  stops,
  active = false,
  onPick,
  bus,
}: {
  /** 머리줄 맨 앞 시각(굵게). */
  time: string;
  /** 시각 옆 흐린 글씨(예: 등원). */
  label: string;
  /** 회차 이름. */
  title: string;
  stops: LineStop[];
  /** 지금 고른 회차 — 테두리로 표시. */
  active?: boolean;
  /** 누르면 그 회차를 고른다. */
  onPick?: () => void;
  /**
   * 🚌 차가 지금 노선 어디쯤인가(0381a GPS → `routeProgress`, 사용자 2026-10-15 "노선에 어디 있는지").
   * `pos` = 칸 번호 기준 소수 위치 · `text` = 머리 아래 한 줄 설명 · `stale` = 위치 끊김(회색).
   */
  bus?: { pos: number; text: string; stale: boolean } | null;
}) {
  const Box = onPick ? "button" : "div";
  const slot = bus ? busSlot(bus.pos, stops.length) : null;
  return (
    <Box
      {...(onPick ? { type: "button" as const, onClick: onPick, "aria-pressed": active } : {})}
      className={cn(
        "bg-card w-full overflow-hidden rounded-2xl border px-3 pt-2 pb-1 text-left shadow-[var(--shadow-card)]",
        active ? "border-primary" : "border-transparent",
        onPick && "cursor-pointer",
      )}
    >
      <p className="flex items-baseline gap-1.5 text-xs font-bold">
        <span className="num text-sm">{time || "—"}</span>
        <span className="text-text-dim">{label}</span>
        <span>{title}</span>
        <span className="text-text-faint ml-auto font-medium">정류장 {stops.filter((s) => s.kind === "stop").length}곳</span>
      </p>

      {bus ? (
        <p className={cn("mt-1 rounded-md px-2 py-0.5 text-xs font-bold break-keep", bus.stale ? "bg-muted text-text-dim" : "bg-primary/10 text-primary")}>
          {bus.text}
        </p>
      ) : null}

      <style>{FLOW_CSS}</style>
      {/* 노선 줄 — 칸마다 [시각 / 동그라미 / 이름]. 칸 사이 가로 선은 각 칸의 양쪽 반선으로 잇는다. 넘치면 다음 줄로.
          🔑 선은 진행 방향(→)으로 **흐르고**, 정류장 사이(칸 경계)마다 ➤ 화살표가 앞으로 살짝 밀린다(사용자 2026-10-14). */}
      {/* 🔴 줄 끝 칸의 오른쪽 선·화살표와 줄 첫 칸의 왼쪽 선은 숨긴다 — 안 숨기면 박스 밖으로 삐져나온다(사용자 2026-10-14).
          칸 수가 화면 폭마다 달라(4·6·8) nth-child를 폭별로 건다. */}
      <ol
        className={cn(
          "mt-1 grid grid-cols-4 gap-y-2 pb-2 sm:grid-cols-6 lg:grid-cols-8",
          "max-sm:[&>li:nth-child(4n)_.conn-r]:hidden max-sm:[&>li:nth-child(4n+1)_.conn-l]:hidden",
          "sm:max-lg:[&>li:nth-child(6n)_.conn-r]:hidden sm:max-lg:[&>li:nth-child(6n+1)_.conn-l]:hidden",
          "lg:[&>li:nth-child(8n)_.conn-r]:hidden lg:[&>li:nth-child(8n+1)_.conn-l]:hidden",
        )}
      >
        {stops.map((s, i) => {
          const academy = s.kind !== "stop";
          const name = s.kind === "depart" ? "학원 출발" : s.kind === "arrive" ? "학원 도착" : s.name;
          // 차가 이미 지나간 칸은 흐리게(탈 곳·내릴 곳 표시는 그대로 둔다).
          const passed = !!bus && !bus.stale && i < bus.pos - 0.001;
          return (
            <li key={s.id} className="flex min-w-0 flex-col items-center px-0.5">
              <span className="num text-text-dim h-4 text-xs leading-4 font-bold">{s.time?.slice(0, 5) ?? ""}</span>
              <span className="relative flex h-5 w-full items-center justify-center">
                {/* 왼쪽·오른쪽 반선 — 첫 칸엔 왼쪽이, 마지막 칸엔 오른쪽이 없다. */}
                <span className={cn("conn-l bg-primary route-flow absolute top-1/2 left-0 h-1 w-1/2 -translate-y-1/2", i === 0 && "invisible")} />
                <span
                  className={cn("conn-r bg-primary route-flow absolute top-1/2 right-0 h-1 w-1/2 -translate-y-1/2", i === stops.length - 1 && "invisible")}
                />
                {/* 다음 정류장 쪽 화살표 — 칸 오른쪽 끝(= 두 정류장 사이)에 선다. 마지막 칸엔 없다. */}
                {i < stops.length - 1 && (
                  <span
                    aria-hidden
                    className="conn-r text-primary bg-card route-nudge absolute top-1/2 right-0 z-20 rounded-full px-0.5 text-xs leading-none"
                    style={{ transform: "translate(50%, -50%)" }}
                  >
                    ➤
                  </span>
                )}
                {/* 🚌 지금 차 위치 — 구간 앞 절반은 앞 칸, 뒤 절반은 뒤 칸에 놓는다(busSlot). */}
                {slot && slot.cell === i ? (
                  <span
                    aria-label="지금 차 위치"
                    className={cn(
                      "bg-card absolute top-1/2 z-30 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm leading-none shadow ring-2",
                      bus?.stale ? "ring-line opacity-60 grayscale" : "ring-primary",
                    )}
                    style={{ left: `${slot.leftPct}%` }}
                  >
                    🚌
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "relative z-10 rounded-full border-[3px]",
                    passed && !s.role && "opacity-40",
                    s.role === "board"
                      ? "border-green bg-green size-5 ring-2 ring-white"
                      : s.role === "alight"
                        ? "border-amber bg-amber size-5 ring-2 ring-white"
                        : academy
                          ? "border-primary bg-primary size-4"
                          : "border-primary bg-card size-3.5",
                  )}
                />
              </span>
              <span
                className={cn(
                  "mt-1 w-full text-center text-xs leading-tight break-all",
                  passed && !s.role && "opacity-50",
                  s.role === "board" ? "text-green font-bold" : s.role === "alight" ? "text-amber font-bold" : academy ? "text-primary font-bold" : "font-medium",
                )}
              >
                {name}
              </span>
              {s.role ? (
                <span
                  className={cn(
                    "mt-0.5 rounded-full px-1.5 text-xs leading-4 font-bold",
                    s.role === "board" ? "bg-green-soft text-green" : "bg-amber-soft text-amber",
                  )}
                >
                  {ROLE_LABEL[s.role]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Box>
  );
}
