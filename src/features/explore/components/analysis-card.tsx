"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import type { FlowKind } from "../flow-insight";
import type { ExploreAnalysis, ExploreAnalysisBlock } from "../model";
import { requestFlowInsight } from "../server/flow-actions";
import { useScrollFade } from "./use-scroll-fade";
import styles from "./layout.module.css";

type Focus = { label: string; match: (b: ExploreAnalysisBlock) => boolean; count: number } | null;

/**
 * 오른쪽 아래 '분석·판단' 칸(원장 2026-11-05 시안) — 카드 머리 없이 블록(상담 · 타임라인)만. 고른 조각과 이어진 블록이 먼저, 나머지는 옅게,
 * 맨 위 한 줄 '{고른 것} 관련 분석 N개 먼저' · '관련 분석 없음 · 전체 표시'. 저장된 결과만 보인다 — '다시 분석'은 명시 버튼(원생상담 쓰기 권한).
 */
export function AnalysisCard({ studentId, analysis, focus }: { studentId: string | null; analysis: ExploreAnalysis | undefined; focus: Focus }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  const blocks = analysis?.blocks ?? [];
  const ordered = focus ? [...blocks].sort((a, b) => Number(focus.match(b)) - Number(focus.match(a))) : blocks;
  return (
    <section className={`bg-card shadow-card rounded-2xl px-4 py-3.5 ${styles.card}`} aria-label="분석·판단">
      <div ref={bodyRef} className={styles.scrollBody}>
        {!analysis ? (
          <p className="text-text-dim text-sm break-keep">이 중심에는 분석·판단이 없습니다.</p>
        ) : analysis.state !== "ready" ? (
          <p className={`rounded-xl px-3 py-2 text-sm break-keep ${analysis.state === "denied" ? "bg-amber-soft text-amber" : "bg-danger-soft text-danger"}`}>{analysis.note}</p>
        ) : (
          <>
            {focus ? (
              <p className={`text-foreground text-xs ${styles.focusNote}`}>
                <b>{focus.label}</b> {focus.count > 0 ? `관련 분석 ${focus.count}개 먼저` : "관련 분석 없음 · 전체 표시"}
              </p>
            ) : null}
            {ordered.map((b) => (
              <Block key={b.id} studentId={studentId} block={b} canRefresh={analysis.canRefresh} dim={!!focus && !focus.match(b)} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function Block({ studentId, block: b, canRefresh, dim }: { studentId: string | null; block: ExploreAnalysisBlock; canRefresh: boolean; dim: boolean }) {
  const router = useRouter();
  // 🔴 트랜지션으로 감싸지 않는다 — AI 호출(수 초~수십 초)이 끝날 때까지 중심 이동(router.push)이 같은 갈래에 묶여 멈춘다(#102).
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (kind: FlowKind) => {
    if (!studentId || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const r = await requestFlowInsight(studentId, kind);
      if (!r.ok) {
        setNotice(r.error);
        return;
      }
      setNotice(r.status === "updated" ? "분석을 갱신했습니다." : r.status === "unchanged" ? "새 기록이 없어 그대로입니다." : "분석할 기록이 아직 없습니다.");
      if (r.status === "updated") router.refresh();
    } catch {
      setNotice("분석하지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setPending(false);
    }
  };
  const showRun = b.kind === "ai" && !!b.flowKind && canRefresh && !!studentId;
  return (
    <article className={styles.block} data-dim={dim ? "true" : undefined}>
      <h3 className="text-foreground flex flex-wrap items-center gap-1.5 text-sm font-extrabold">
        {b.title}
        {b.badge ? <Pill color={b.badge.color}>{b.badge.label}</Pill> : null}
        {showRun ? (
          <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" disabled={pending} onClick={() => void run(b.flowKind!)}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <EyIcon name="sync" size={13} />}
            {b.headline ? "다시 분석" : "지금 분석"}
          </Button>
        ) : null}
      </h3>
      {b.notice ? <p className="bg-amber-soft text-amber mt-1 rounded-xl px-2.5 py-1.5 text-xs break-keep">{b.notice}</p> : null}
      {b.headline ? (
        <>
          <p className="text-foreground mt-1 text-sm leading-relaxed font-medium break-keep">{b.headline}</p>
          {b.change ? <Line label="달라진 점" text={b.change} /> : null}
          {b.watch.length > 0 ? <Line label="지켜볼 점" text={b.watch.join(" · ")} /> : null}
          {b.next.length > 0 ? <Line label="다음 제안" text={b.next.join(" · ")} /> : null}
          {b.basis ? <p className="text-text-dim mt-1 text-xs break-keep">{b.basis}</p> : null}
        </>
      ) : (
        <p className="text-text-dim mt-1 text-sm break-keep">{b.empty}</p>
      )}
      {notice ? (
        <p className="text-text-dim mt-1 text-xs" role="status">
          {notice}
        </p>
      ) : null}
    </article>
  );
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-foreground mt-1 text-sm break-keep">
      <b className="text-xs">{label} · </b>
      {text}
    </p>
  );
}
