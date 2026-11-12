"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { kstToday } from "@/lib/date-kst";
import { ADVICE_STATUS_LABEL, ADVICE_STATUSES, monthDayLabel, type AdviceView } from "../advice";
import { ADVICE_FILTER_LABEL, ADVICE_FILTERS, groupAdvice, matchesFilter, summarizeAdvice, type AdviceFilter } from "../advice-list";
import { VERDICT_LABEL, VERDICTS } from "../advice-outcome";
import { AdviceStatusPanel } from "./advice-controls";
import { currentAdvice, useAdviceVersion } from "./advice-latest";
import { RichText } from "./rich-text";
import { useAdviceList } from "./use-advice-list";

/**
 * '지난 의견' — 제안 → 결과 → 학습 3단계 첫 조각(2026-11-10). 내가 받은 비서 의견을 대화와 상관없이 한곳에서 보고 처리한다.
 * 위 = 현황(처리 상태별 · 다시 잰 결과별 · 가장 가까운 재측정) · 거르기 · 아래 = 답별 묶음(새 답이 위). 처리 단추는 대화 안의 것과 같은 부품이고
 * 처리 값은 문서 하나에 모아 둘이 같이 구독한다(advice-latest) — 여기서 처리하면 감춰 둔 대화 카드도, 대화에서 처리하면 여기 현황도 바로 같은 값.
 * `active` = 판이 열려 있다(다시 열 때 다시 읽는다) · `hiddenThreads` = 이 판에서 지운 대화(그 대화의 의견은 바로 뺀다 — 다시 읽기를 기다리지 않는다).
 */
export function AdviceList({ active, hiddenThreads, onOpenThread }: { active: boolean; hiddenThreads: ReadonlySet<string>; onOpenThread: (threadId: string) => void }) {
  const { state: loaded, reload, reloading } = useAdviceList(active);
  const state = hiddenThreads.size ? { ...loaded, items: loaded.items.filter((i) => !hiddenThreads.has(i.threadId)) } : loaded;
  useAdviceVersion(); // 어느 의견이든 저장되면 다시 그린다(현황 숫자 · 거르기)
  const [filter, setFilter] = useState<AdviceFilter>("all");
  /** 거르는 중에 처리해 조건을 벗어난 의견 — 거르기를 바꿀 때까지 그 자리에 둔다(누르자마자 사라지지 않게 · '이 보기에서 빠집니다' 표시). */
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());

  // 오늘 = 그릴 때의 한국 날짜 — 카드의 '다시 잴 날' 문구(kstToday)와 같은 기준(판을 열어 둔 채 자정을 넘겨도 둘이 갈리지 않게).
  const today = kstToday();
  const views = state.items.map((i) => currentAdvice(i.view));
  const summary = summarizeAdvice(views, today);
  const groups = groupAdvice(state.items, filter, (i) => currentAdvice(i.view), keep);

  const onSaved = (view: AdviceView) => {
    if (filter !== "all") setKeep((k) => new Set(k).add(view.id));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-foreground min-w-0 flex-1 text-lg font-bold">
          지난 의견
        </h2>
        <Button type="button" variant="ghost" onClick={reload} aria-busy={reloading || undefined} disabled={state.status === "loading" || reloading}>
          <EyIcon name="sync" className={reloading ? "animate-spin motion-reduce:animate-none" : undefined} />
          {reloading ? "읽는 중" : "새로 고침"}
        </Button>
      </div>
      <p className="text-sm break-words">대화와 상관없이 내가 받은 비서 의견을 모아 봅니다. 여기서 처리해도 대화 안의 같은 의견에 그대로 남습니다. 지운 대화의 의견은 보이지 않습니다.</p>

      {state.status === "error" ? (
        <div role="alert" className="bg-bg-soft/60 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1 break-words">{state.error}</span>
          <Button type="button" variant="ghost" onClick={reload} disabled={reloading}>
            <EyIcon name="sync" />
            다시 불러오기
          </Button>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="지난 의견을 읽는 중" className="space-y-3">
          <div className="bg-bg-soft h-20 animate-pulse rounded-2xl motion-reduce:animate-none" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-bg-soft h-28 animate-pulse rounded-xl motion-reduce:animate-none" />
          ))}
        </div>
      ) : state.items.length === 0 ? (
        state.status === "ready" ? (
          <p className="bg-bg-soft rounded-2xl px-4 py-6 text-center text-base">아직 비서 의견이 없습니다. 질문하면 보고서 끝의 &lsquo;비서 의견&rsquo;이 여기에 모입니다.</p>
        ) : null
      ) : (
        <>
          <dl className="bg-bg-soft grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl px-4 py-3 text-sm">
            <dt className="font-bold">{`의견 ${summary.total}개`}</dt>
            <dd className="num break-words">{ADVICE_STATUSES.map((s) => `${ADVICE_STATUS_LABEL[s]} ${summary.byStatus[s]}`).join(" · ")}</dd>
            <dt className="font-bold">다시 잰 결과</dt>
            <dd className="num break-words">
              {[
                ...VERDICTS.filter((v) => summary.byVerdict[v] > 0).map((v) => `${VERDICT_LABEL[v]} ${summary.byVerdict[v]}`),
                `다시 잴 날을 기다리는 의견 ${summary.waiting}`,
                ...(summary.nextCheckOn ? [`가장 가까운 재측정 ${monthDayLabel(summary.nextCheckOn)}`] : []),
              ].join(" · ")}
            </dd>
          </dl>
          <ToolbarSegment label="보기" wrap>
            {ADVICE_FILTERS.map((f) => (
              <ToolbarSegmentItem
                key={f}
                active={filter === f}
                onClick={() => {
                  setFilter(f);
                  setKeep(new Set());
                }}
              >
                {`${ADVICE_FILTER_LABEL[f]} ${summary.byFilter[f]}`}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
          {groups.length === 0 ? (
            <p className="bg-bg-soft rounded-2xl px-4 py-6 text-center text-base">{`'${ADVICE_FILTER_LABEL[filter]}'에 맞는 의견이 없습니다.`}</p>
          ) : (
            <ol className="space-y-6">
              {groups.map((g) => (
                <li key={g.messageId} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="min-w-0 flex-1 text-base font-bold break-words">
                      <span className="num">{monthDayLabel(g.askedOn)}</span>
                      {` · ${g.threadTitle}`}
                    </h3>
                    <Button type="button" variant="ghost" onClick={() => onOpenThread(g.threadId)}>
                      대화 열기
                      <EyIcon name="arrowRight" />
                    </Button>
                  </div>
                  <ol className="space-y-2">
                    {g.items.map((item) => (
                      <li key={item.view.id} className="bg-card shadow-card flex gap-3 rounded-xl px-3.5 py-3">
                        <span aria-hidden className="bg-gold text-primary-foreground num mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                          {item.view.itemNo + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-base leading-snug font-bold break-words">
                            <RichText text={item.action} />
                          </p>
                          <p className="text-sm leading-relaxed break-words whitespace-pre-line">
                            <span className="mr-1.5 font-bold">근거</span>
                            <RichText text={item.why} />
                          </p>
                          <AdviceStatusPanel initial={item.view} onChange={onSaved} />
                          {matchesFilter(currentAdvice(item.view), filter) ? null : (
                            <p className="text-text-dim text-sm">{`처리해서 '${ADVICE_FILTER_LABEL[filter]}'에서 빠집니다 — 보기를 다시 고르면 사라집니다.`}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
