"use client";

import { useState } from "react";
import type { HelpCallout, HelpLayout } from "@/features/help/types";
import { HelpText } from "./help-text";

const ZONE_ROW: HelpCallout["zone"][] = ["header", "toolbar", "filters", "board", "row", "cell", "footer"];

function NumberMark({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
        active ? "bg-primary text-white" : "bg-primary-soft text-primary"
      }`}
    >
      {n}
    </span>
  );
}

function ScreenGuide({
  title,
  layout,
  callouts,
  active,
  onPick,
}: {
  title: string;
  layout: HelpLayout;
  callouts: HelpCallout[];
  active: number | null;
  onPick: (n: number) => void;
}) {
  const byZone = (z: HelpCallout["zone"]) => callouts.filter((c) => c.zone === z);
  return (
    <figure className="bg-card shadow-card overflow-hidden rounded-2xl">
      <div className="border-line-faint flex items-center gap-2 border-b px-3 py-2">
        <span className="bg-line inline-flex gap-1 rounded-full px-1.5 py-1">
          {/* 🔴 `bg-caution`·`bg-positive`는 **정의되지 않은 토큰**이라 점 셋 중 둘이 아무 색도 안 칠해지고
              있었다(팔레트 v4 함정 — 빌드·타입체크를 통과하고 흰 바탕에선 투명해도 정상처럼 보인다).
              의미색 캐논의 **뜻 이름**(caution·positive)과 **실제 토큰 이름**(`--amber`·`--green`)은 다르다. */}
          <i className="bg-danger/70 size-2 rounded-full" />
          <i className="bg-amber/80 size-2 rounded-full" />
          <i className="bg-green/70 size-2 rounded-full" />
        </span>
        <figcaption className="text-foreground min-w-0 truncate text-sm font-bold">{title}</figcaption>
      </div>
      <div className="bg-bg-soft space-y-2 p-3">
        {ZONE_ROW.map((zone) => {
          const items = byZone(zone);
          if (items.length === 0) return null;
          return (
            <div
              key={zone}
              className={`flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 ${
                zone === "board" || zone === "row" || zone === "cell" ? "min-h-16" : ""
              }`}
            >
              {items.map((c) => (
                <span
                  key={c.n}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
                    active === c.n ? "border-primary bg-primary-soft" : "border-line"
                  }`}
                >
                  <button type="button" onClick={() => onPick(c.n)} aria-label={`${c.n}번`}>
                    <NumberMark n={c.n} active={active === c.n} />
                  </button>
                  <span className="text-foreground font-medium break-keep">{c.label}</span>
                </span>
              ))}
              {zone === "board" && layout === "kanban" ? (
                <span className="text-text-dim ml-auto text-xs">4칸 보드</span>
              ) : null}
              {zone === "board" && layout === "grid" ? (
                <span className="text-text-dim ml-auto text-xs">격자</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-text-dim px-3 py-2 text-xs">번호를 누르면 아래 설명이 따라갑니다. 실제 화면과 같은 자리·같은 이름입니다.</p>
    </figure>
  );
}

export function GuideBlock({
  title,
  layout,
  callouts,
  currentSlug,
}: {
  title: string;
  layout: HelpLayout;
  callouts: HelpCallout[];
  currentSlug?: string;
}) {
  const [active, setActive] = useState<number | null>(callouts[0]?.n ?? null);
  if (callouts.length === 0) return null;
  return (
    <div className="space-y-3">
      <ScreenGuide title={title} layout={layout} callouts={callouts} active={active} onPick={setActive} />
      <ol className="bg-card shadow-card divide-line divide-y rounded-2xl">
        {callouts.map((c) => (
          <li
            key={c.n}
            id={`help-n-${c.n}`}
            className={`flex items-start gap-3 px-4 py-3 ${active === c.n ? "bg-primary-soft/60" : ""}`}
          >
            <button type="button" onClick={() => setActive(c.n)} aria-label={`${c.n}번 ${c.label}`}>
              <NumberMark n={c.n} active={active === c.n} />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setActive(c.n)}
                className="text-foreground text-sm font-bold break-keep"
              >
                {c.label}
              </button>
              <p className="text-text-dim mt-1 text-sm leading-relaxed break-keep">
                <HelpText text={c.body} currentSlug={currentSlug} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
