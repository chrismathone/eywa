"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { kstShortStamp } from "@/lib/date-kst";
import { DIRECTION_META, type FlowInsightView, type FlowKind } from "../flow-insight";
import { requestFlowInsight } from "../server/flow-actions";

type Props = {
  studentId: string;
  items: FlowInsightView[];
  state: "ready" | "denied" | "error";
  canRefresh: boolean;
};

/**
 * AI 흐름 카드 — 저장된 분석만 보여 준다(원장 2026-11-03). 갱신은 상담 저장 뒤·밤 배치가 하고, 여기 '다시 분석'은 **명시 버튼**이다.
 * 분석이 없는 학생은 "다음 상담 저장 때 처음 분석" + (권한자) 지금 분석. 실패·권한 없음·결과 없음을 가른다.
 */
export function FlowInsightCard({ studentId, items, state, canRefresh }: Props) {
  return (
    <section className="bg-card shadow-card space-y-4 rounded-2xl p-4" aria-label="AI 흐름 분석">
      <header className="flex items-center gap-2">
        <span className="bg-primary-soft text-primary flex size-9 items-center justify-center rounded-full">
          <EyIcon name="sparkle" size={18} />
        </span>
        <h2 className="text-foreground text-lg font-bold">흐름 분석</h2>
        <span className="text-text-dim ml-auto text-xs">AI · 저장된 결과</span>
      </header>
      {state === "denied" ? (
        <p className="bg-amber-soft text-amber rounded-xl px-3 py-2 text-sm break-keep">원생상담 열람 권한(전체)이 있어야 합산 분석을 볼 수 있습니다.</p>
      ) : state === "error" ? (
        <p className="bg-danger-soft text-danger rounded-xl px-3 py-2 text-sm break-keep">흐름 분석을 조회하지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
      ) : (
        items.map((v) => <FlowBlock key={v.kind} studentId={studentId} view={v} canRefresh={canRefresh} />)
      )}
    </section>
  );
}

function FlowBlock({ studentId, view, canRefresh }: { studentId: string; view: FlowInsightView; canRefresh: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const run = (kind: FlowKind) =>
    startTransition(async () => {
      setNotice(null);
      const r = await requestFlowInsight(studentId, kind);
      if (!r.ok) {
        setNotice(r.error);
        return;
      }
      setNotice(r.status === "updated" ? "분석을 갱신했습니다." : r.status === "unchanged" ? "새 기록이 없어 그대로입니다." : "분석할 기록이 아직 없습니다.");
      if (r.status === "updated") router.refresh();
    });
  const i = view.insight;
  const dir = i ? DIRECTION_META[i.direction] : null;
  return (
    <article className="border-line-faint space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-foreground text-sm font-bold">{view.label}</h3>
        {dir ? <Pill color={dir.color}>{dir.label}</Pill> : null}
        {canRefresh ? (
          <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={() => run(view.kind)}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <EyIcon name="sync" size={14} />}
            {i ? "다시 분석" : "지금 분석"}
          </Button>
        ) : null}
      </div>
      {i ? (
        <>
          <p className="text-foreground text-sm leading-relaxed font-medium break-keep">{i.headline}</p>
          {i.themes.length > 0 ? (
            <ul className="flex flex-wrap gap-1" aria-label="되풀이되는 주제">
              {i.themes.map((t) => (
                <li key={t} className="bg-bg-soft text-foreground rounded-pill px-2 py-0.5 text-xs">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          {i.recentChange ? (
            <p className="text-sm break-keep">
              <span className="text-text-dim text-xs font-bold">달라진 점 · </span>
              {i.recentChange}
            </p>
          ) : null}
          {i.watch.length > 0 ? <ListBlock title="지켜볼 점" items={i.watch} /> : null}
          {i.nextSteps.length > 0 ? <ListBlock title="다음 제안" items={i.nextSteps} /> : null}
          <p className="text-text-dim text-xs break-keep">
            {i.basis}
            {view.coveredCount ? ` · 기록 ${view.coveredCount}건 반영` : ""}
            {view.generatedAt ? ` · ${kstShortStamp(view.generatedAt) ?? ""}` : ""}
            {view.modelLabel ? ` · ${view.modelLabel}` : ""}
          </p>
        </>
      ) : (
        <p className="text-text-dim text-sm break-keep">
          아직 분석이 없습니다.{" "}
          {view.kind === "consultations" ? "다음 상담을 저장하면 전체 상담으로 처음 분석하고, 그 뒤로는 새 상담을 합산합니다." : "밤마다 새 기록이 있는 학생부터 차례로 분석합니다."}
        </p>
      )}
      {notice ? (
        <p className="text-text-dim text-xs" role="status">
          {notice}
        </p>
      ) : null}
    </article>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-text-dim text-xs font-bold">{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm break-keep">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
