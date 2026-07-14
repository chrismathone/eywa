"use client";

/**
 * FeatureSwitcher — 기능 소개를 한 섹션 안에서 탭으로 전환(페이지 넘김 느낌).
 * 풀섹션 3개를 1개로 합쳐 랜딩 스크롤 길이를 줄인다. 좌(텍스트+체크리스트) · 우(제품 목업).
 * 모션 단일 기준 = motionDisabled()/prefersReducedMotion() — 전환 애니메이션은 클릭 시에만 판정해
 * SSR/하이드레이션 불일치 없이(초기 anim=false) key 변경으로 재생한다.
 */
import { useState, type ReactNode } from "react";
import { EyIcon, MENU_ICON } from "@/components/icons/eywa-icons";
import { motionDisabled, prefersReducedMotion } from "@/components/workspace/motion";
import type { MenuKey } from "@/lib/permissions";
import { BrowserFrame } from "./browser-frame";

export type Feature = {
  /** menuKey와 동일 — 아이콘은 MENU_ICON[key]에서 끌어온다(하드코딩 금지) */
  key: MenuKey;
  label: string;
  eyebrow: string;
  title: ReactNode;
  desc: string;
  points: string[];
  url: string;
  mock: ReactNode;
};

export function FeatureSwitcher({ features }: { features: Feature[] }) {
  const [view, setView] = useState({ idx: 0, anim: false });
  const select = (i: number) =>
    setView({ idx: i, anim: !motionDisabled() && !prefersReducedMotion() });
  const f = features[view.idx];

  return (
    <div>
      {/* 탭 바 — 세그먼트 컨트롤 */}
      <div
        role="tablist"
        aria-label="기능 둘러보기"
        className="border-line bg-card inline-flex flex-wrap gap-1 rounded-lg border p-1"
      >
        {features.map((t, i) => {
          const on = i === view.idx;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              id={`feat-tab-${t.key}`}
              aria-controls="feat-panel"
              onClick={() => select(i)}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                on
                  ? "bg-primary text-white shadow-[0_8px_20px_-10px_rgba(26,95,60,0.7)]"
                  : "text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              <EyIcon name={MENU_ICON[t.key]} size={15} className={on ? "text-white" : "text-text-faint"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 패널 — key 변경으로 페이지 넘김 재생 (좌 텍스트 · 우 목업) */}
      <div
        key={f.key}
        id="feat-panel"
        role="tabpanel"
        aria-labelledby={`feat-tab-${f.key}`}
        className={`mt-9 grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${
          view.anim ? "ey-flip-in" : ""
        }`}
      >
        <div>
          <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">{f.eyebrow}</p>
          <h3 className="text-foreground mt-4 text-[clamp(1.7rem,3.4vw,2.6rem)] leading-[1.2] font-extrabold tracking-[-0.025em]">
            {f.title}
          </h3>
          <p className="text-text-dim mt-5 max-w-[30rem] text-[16px] leading-[1.75]">{f.desc}</p>
          <ul className="mt-6 space-y-2.5">
            {f.points.map((p) => (
              <li key={p} className="text-foreground flex items-center gap-2.5 text-[14px] font-medium">
                <span className="bg-primary-soft text-primary flex size-5 shrink-0 items-center justify-center rounded-md">
                  <EyIcon name="check" size={13} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <BrowserFrame url={f.url}>{f.mock}</BrowserFrame>
      </div>
    </div>
  );
}
