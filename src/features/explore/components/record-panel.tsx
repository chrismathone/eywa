"use client";

import { useRef } from "react";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { KIND_LABEL, TONE_BG_CLASS, TONE_INK_CLASS, type ExploreModel, type ExploreTarget, type ExploreTone } from "../model";
import type { NetNeighbor, NetRecordInfo } from "./network/types";
import { useScrollFade } from "./use-scroll-fade";
import styles from "./layout.module.css";

type Props = {
  rec: NetRecordInfo;
  model: ExploreModel;
  neighbors: NetNeighbor[];
  /** 이 점을 중심으로 볼 수 있으면 그 대상(대상 점 · 형제 사실). */
  centerTarget: ExploreTarget | null;
  onNavigate: (t: ExploreTarget) => void;
  /** 이웃 줄을 누르면 그 점을 고른다. */
  onPick: (id: string) => void;
  /** '영역으로' — 고른 기록을 풀고 영역 패널로 돌아간다. */
  onClose: () => void;
  pending: boolean;
};

const NEIGHBOR_MAX = 12;

/**
 * 네트워크에서 기록·대상·분석·사실 점을 골랐을 때 오른쪽 위 '펼친 영역' 자리에 서는 패널(원장 2026-11-05 시안 :3978 `recordPanel`).
 * 머리(영역 그림 · 이름 · 종류) · 중심으로 보기 · 날짜·내용·원본 · 본문 · 이 기록에 이어진 것(점 id 그대로 — 고르면 그 점) · 바닥 '영역으로'.
 * 🔴 시안의 '근거 · 확인 날짜' 줄은 가짜 값이라 싣지 않는다 — 원본 화면 링크는 그 영역의 첫 링크(없으면 줄 없음).
 */
export function RecordPanel({ rec, model, neighbors, centerTarget, onNavigate, onPick, onClose, pending }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  const sector = model.sectors.find((s) => s.key === rec.sectorKey) ?? null;
  const look: { label: string; icon: AywaIconName; tone: ExploreTone } = sector
    ? { label: sector.label, icon: sector.icon, tone: sector.tone }
    : rec.kind === "analysis"
      ? { label: "분석·판단", icon: "sparkle", tone: "primary" }
      : rec.kind === "fact"
        ? { label: "온톨로지 사실", icon: "layers", tone: "gold" }
        : { label: "기록", icon: "report", tone: "primary" };
  const kindLabel = rec.kind === "target" && rec.target ? KIND_LABEL[rec.target.kind] : rec.kind === "analysis" ? "분석" : rec.kind === "fact" ? "사실" : look.label;
  const source = rec.kind === "analysis" ? "저장된 분석" : rec.kind === "fact" ? "판정" : rec.kind === "target" ? "연결" : "기록";
  const link = sector?.links?.[0] ?? null;
  const body = rec.body && rec.body !== rec.detail ? rec.body : null;

  return (
    <aside className={`bg-card shadow-card min-h-0 flex-1 rounded-2xl px-4 py-3.5 ${styles.card} ${pending ? "opacity-50" : ""}`} aria-labelledby="explore-record-title" aria-busy={pending || undefined}>
      <header className="border-line-faint mb-2.5 flex items-center gap-2 border-b pb-2.5">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${TONE_BG_CLASS[look.tone]}`}>
          <EyIcon name={look.icon} size={16} className={TONE_INK_CLASS[look.tone]} />
        </span>
        <h2 id="explore-record-title" className="text-foreground min-w-0 truncate text-sm font-extrabold">
          {rec.title}
        </h2>
        <Pill color="neutral" className="ml-auto shrink-0">
          {kindLabel}
        </Pill>
      </header>

      <div ref={bodyRef} className={`flex flex-col gap-3 ${styles.scrollBody}`}>
        {centerTarget ? (
          <button
            type="button"
            onClick={() => onNavigate(centerTarget)}
            className="bg-primary text-primary-foreground hover:bg-primary-deep focus-visible:ring-ring flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-extrabold transition focus-visible:ring-2 focus-visible:outline-none"
          >
            이 {KIND_LABEL[centerTarget.kind]}을 중심으로 보기
            <ChevronRight className="size-4" />
          </button>
        ) : null}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          {rec.date ? (
            <>
              <dt className="text-text-dim text-xs">날짜</dt>
              <dd className="text-foreground num">{rec.date}</dd>
            </>
          ) : null}
          {rec.detail ? (
            <>
              <dt className="text-text-dim text-xs">내용</dt>
              <dd className="text-foreground break-keep">{rec.detail}</dd>
            </>
          ) : null}
          <dt className="text-text-dim text-xs">원본</dt>
          <dd className="text-foreground break-keep">
            {look.label} · {source}
            {link ? (
              <WindowLink href={link.href} title={link.label} frameTarget="window" className="text-primary ml-1.5 inline-flex items-center text-xs font-bold hover:underline">
                {link.label}
                <ChevronRight className="size-3.5" />
              </WindowLink>
            ) : null}
          </dd>
        </dl>

        {body ? <p className="text-foreground bg-bg-soft rounded-xl px-3 py-2 text-sm break-keep whitespace-pre-line">{body}</p> : null}

        <section>
          <p className="text-foreground mb-1.5 text-xs font-extrabold opacity-85">
            이 기록에 이어진 것 <span className="text-text-dim num font-medium">{neighbors.length}개</span>
          </p>
          {neighbors.length > 0 ? (
            <ul className="flex flex-col">
              {neighbors.slice(0, NEIGHBOR_MAX).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onPick(n.id)} className="hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm">
                    <span className={`size-2 shrink-0 rounded-full bg-current ${TONE_INK_CLASS[n.tone]}`} aria-hidden="true" />
                    <span className="text-foreground min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="text-text-dim shrink-0 text-xs">{n.rel}</span>
                  </button>
                </li>
              ))}
              {neighbors.length > NEIGHBOR_MAX ? <li className="text-text-dim px-1.5 py-1 text-xs">… {neighbors.length - NEIGHBOR_MAX}개 더</li> : null}
            </ul>
          ) : (
            <p className="text-text-dim text-xs">영역 밖으로 이어진 기록이 없습니다.</p>
          )}
        </section>

        <p className="text-text-dim text-xs break-keep">연결 = 인과 확정 아님 · 원본 기록으로 연결</p>
      </div>

      <div className="border-line-faint mt-1 border-t pt-1 text-xs font-bold">
        <button type="button" onClick={onClose} className="text-primary inline-flex items-center gap-1 hover:underline">
          <ChevronRight className="size-3.5 rotate-180" />
          {look.label} 영역으로
        </button>
      </div>
    </aside>
  );
}
