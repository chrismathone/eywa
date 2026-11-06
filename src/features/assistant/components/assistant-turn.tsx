"use client";

import { useEffect, useState, type ReactNode } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ASSISTANT_LEVEL_LABEL } from "@/features/assistant/levels";
import type { AskStep, QuerySummary } from "@/features/assistant/protocol";
import { kstTimeOf } from "@/lib/date-kst";
import { formatDuration, stepSummaryText, stepTrouble, type Turn } from "./assistant-state";
import { ReportView } from "./report-view";

/**
 * 질문 한 차례 — 오른쪽 질문 말풍선 + 그 아래 답.
 * 답을 만드는 동안은 **단계 타임라인**(원장 2026-11-06 *"진짜 Ai 대화하는것처럼 어떤 db를 조회중이고 어떤 프로그레스중인지 단계가
 * 표시되면 좋을듯"*) — 질문 이해 → 표 확인(표 칩) → 조회문 작성 → 조회(행 수·시간) → 살펴보기 → 보고서. 끝나면 보고서로 바뀌고
 * 단계는 `조회 3번 · 표 5개 · 18초 — 과정 보기` 한 줄로 접힌다. 실패·멈춤·아직 만드는 중은 그 사실과 다시 묻기.
 * 🔴 질문·단계·오류 문구 모두 글자로만 그린다.
 */
export function AssistantTurn({
  turn,
  canRetry,
  onRetry,
  onReload,
}: {
  turn: Turn;
  /** 다시 묻기를 지금 할 수 있나(다른 답을 받는 중이면 못 한다). */
  canRetry: boolean;
  onRetry: (turn: Turn) => void;
  /** 저장본 다시 읽기(아직 만드는 중 · 끊김). */
  onReload: () => void;
}) {
  const time = kstTimeOf(turn.createdAt);
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-end gap-1">
        <p className="bg-primary-soft text-foreground max-w-[min(85%,44rem)] rounded-2xl rounded-br-md px-4 py-2.5 text-base leading-relaxed break-words whitespace-pre-wrap">
          {turn.question}
        </p>
        <p className="px-1 text-xs">
          {`추론 ${ASSISTANT_LEVEL_LABEL[turn.level]}`}
          {time ? <span className="num">{` · ${time}`}</span> : null}
        </p>
      </div>
      <Answer turn={turn} canRetry={canRetry} onRetry={onRetry} onReload={onReload} />
    </div>
  );
}

function Answer({ turn, canRetry, onRetry, onReload }: { turn: Turn; canRetry: boolean; onRetry: (t: Turn) => void; onReload: () => void }) {
  switch (turn.status) {
    case "done":
      return (
        <div className="space-y-4">
          {turn.steps.length ? <ProcessDetails steps={turn.steps} settled /> : null}
          {turn.report ? <ReportView report={turn.report} /> : null}
        </div>
      );
    case "streaming":
      return <Progress turn={turn} />;
    case "recovering":
      return <Progress turn={turn} note="연결이 끊겨 저장된 답을 다시 불러오는 중입니다." />;
    case "running":
      return (
        <Notice icon="clock" tone="neutral" text="아직 답을 만드는 중입니다. 끝나면 이 자리에 보고서가 뜹니다." steps={turn.steps}>
          <Button type="button" variant="ghost" onClick={onReload}>
            <EyIcon name="sync" />
            지금 다시 불러오기
          </Button>
        </Notice>
      );
    case "stopped":
      return (
        <Notice icon="pause" tone="neutral" text="답을 멈췄습니다." steps={turn.steps}>
          <RetryButton turn={turn} disabled={!canRetry} onRetry={onRetry} />
        </Notice>
      );
    case "error":
      return (
        <Notice icon="error" tone="danger" text={turn.error ?? "답을 받지 못했습니다."} steps={turn.steps} queries={turn.queries}>
          <RetryButton turn={turn} disabled={!canRetry} onRetry={onRetry} />
        </Notice>
      );
  }
}

function RetryButton({ turn, disabled, onRetry }: { turn: Turn; disabled: boolean; onRetry: (t: Turn) => void }) {
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={() => onRetry(turn)}>
      <EyIcon name="undo" />
      다시 묻기
    </Button>
  );
}

function Notice({
  icon,
  tone,
  text,
  steps,
  queries,
  children,
}: {
  icon: "clock" | "pause" | "error";
  tone: "neutral" | "danger";
  text: string;
  steps: readonly AskStep[];
  queries?: readonly QuerySummary[];
  children?: ReactNode;
}) {
  return (
    // 역할(alert)을 달지 않는다 — 지난 대화를 열면 저장된 실패가 한꺼번에 낭독된다. 방금 끝난 답의 결과는 오버레이의 알림 줄(aria-live)이 읽는다.
    <div className="space-y-3">
      <div className={`${tone === "danger" ? "bg-danger-soft" : "bg-bg-soft/60"} flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3.5`}>
        <EyIcon name={icon} size={20} className={`shrink-0 ${tone === "danger" ? "text-danger" : ""}`} />
        <p className="min-w-0 flex-1 text-sm leading-relaxed font-medium break-words whitespace-pre-line">{text}</p>
        {children}
      </div>
      {steps.length ? (
        // 실패했으면 어디서 막혔는지가 곧 까닭이다 — 과정을 펼친 채로 둔다.
        <ProcessDetails steps={steps} defaultOpen={tone === "danger"} />
      ) : queries && queries.length ? (
        <QueryList queries={queries} />
      ) : null}
    </div>
  );
}

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}초`;

/** 단계 종류 아이콘 — 지금 무엇을 하는지(질문 이해 · 표 확인 · 조회문 작성 · 조회 · 살펴보기 · 보고서 · 고치기). */
const KIND_ICON: Record<AskStep["kind"], AywaIconName> = {
  understand: "message",
  schema: "layers",
  write_sql: "edit",
  query: "search",
  analyze: "chart",
  report: "report",
  fix: "wrench",
};

/**
 * 끝난 답의 과정 — 한 줄로 접힌다: `조회 3번 · 표 5개 · 18초 — 과정 보기`(누르면 타임라인 전체). JS 없이 `<details>`.
 * 다시 연 대화도 저장된 단계(`ThreadMessage.steps`)로 같은 줄을 보인다.
 */
function ProcessDetails({ steps, defaultOpen = false, settled = false }: { steps: readonly AskStep[]; defaultOpen?: boolean; settled?: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="hover:bg-muted inline-flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg px-2 py-1 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <EyIcon name="listChecks" size={16} className="shrink-0" />
        <span className="num">{stepSummaryText(steps, settled)}</span>
        <span aria-hidden>—</span>
        <span className="text-primary font-bold group-open:hidden">과정 보기</span>
        <span className="text-primary hidden font-bold group-open:inline">과정 접기</span>
        <EyIcon name="chevronDown" size={16} className="text-primary transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pt-2.5 pl-2">
        <StepTimeline steps={steps} live={false} settled={settled} />
      </div>
    </details>
  );
}

/** 답을 만드는 동안 — 지금 하는 단계(큰 글 · 낭독) + 단계 타임라인 + 걸린 시간(1초마다). */
function Progress({ turn, note }: { turn: Turn; note?: string }) {
  // '지금'은 1초마다 effect가 적는다(렌더 중에 시계를 읽지 않는다 — 첫 1초는 비워 둔다).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const started = Date.parse(turn.createdAt);
  const elapsed = now !== null && !Number.isNaN(started) ? Math.max(0, now - started) : null;
  const running = [...turn.steps].reverse().find((s) => s.state === "running");
  const headline = note ?? running?.label ?? (turn.steps.length ? "다음 단계를 준비하는 중" : "질문을 보내는 중");
  return (
    <div className="bg-card shadow-card rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="bg-gold-soft text-gold flex size-8 shrink-0 items-center justify-center rounded-xl">
          <EyIcon name="sparkle" size={18} className="animate-pulse motion-reduce:animate-none" />
        </span>
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-base font-bold break-words">
          {headline}
        </p>
        {elapsed !== null ? <span className="num shrink-0 text-xs">{formatDuration(elapsed)}</span> : null}
      </div>
      {turn.steps.length ? (
        <div className="mt-3.5 pl-1">
          <StepTimeline steps={turn.steps} live now={now} startedAt={started} currentId={running?.id ?? null} />
        </div>
      ) : (
        // 첫 단계가 오기 전 — 화면이 비어 보이지 않게(단계 두 줄 모양).
        <div aria-hidden className="mt-4 space-y-2.5 pl-11">
          <div className="bg-bg-soft h-3.5 w-3/5 animate-pulse rounded motion-reduce:animate-none" />
          <div className="bg-bg-soft h-3.5 w-2/5 animate-pulse rounded motion-reduce:animate-none" />
        </div>
      )}
    </div>
  );
}

/**
 * 단계 타임라인 — 상태 표식(도는 중 · 끝 · 막힘) + 종류 아이콘 + 이름 + 본 DB 표(칩 · 마우스를 올리면 실제 표 이름) +
 * 오른쪽 끝 한 줄(행 수·시간 · 도는 단계는 흐르는 초) · 막히면 그 까닭(빨강).
 * - 진행 중(`live`): 새 단계는 아래에서 살짝 떠오르고, 지금 도는 마지막 단계는 굵게 + 옅은 바탕.
 * - 표식 사이를 잇는 1px 세로선은 구조선이다(왼쪽 색 띠가 아니다). 끝난 차례에 남은 '도는 중' 단계는 멈춘 것으로 그린다.
 */
function StepTimeline({
  steps,
  live,
  now = null,
  startedAt = Number.NaN,
  currentId = null,
  settled = false,
}: {
  steps: readonly AskStep[];
  live: boolean;
  now?: number | null;
  /** 질문을 보낸 시각(ms) — 도는 단계의 흐르는 초 = 지금 − (보낸 시각 + 단계 시작 `at`). */
  startedAt?: number;
  currentId?: string | null;
  /** 답이 보고서로 끝난 차례 — 막혔다가 이어 간 단계를 옅게 그린다(`stepTrouble`). */
  settled?: boolean;
}) {
  return (
    <ol className="space-y-2" aria-label="답을 만드는 단계">
      {steps.map((s, index) => {
        const running = s.state === "running";
        const current = live && s.id === currentId;
        const ticking = live && running && now !== null && !Number.isNaN(startedAt) ? Math.max(0, now - startedAt - s.at) : null;
        const tail =
          s.state === "error" ? null : running ? (ticking !== null ? formatDuration(ticking) : null) : (s.detail ?? (typeof s.ms === "number" ? seconds(s.ms) : null));
        // 막힌 단계의 뜻(`stepTrouble`) — 답이 끝까지 나왔고 뒤에 같은 종류가 이어졌으면 옅게(다른 조회로 이어 감) ·
        // 시간·한도면 주황(분석이 잘렸다는 신호) · 나머지는 빨강(원장 2026-11-06 · 적대 리뷰 2026-11-06).
        const trouble = stepTrouble(steps, index, settled);
        const retried = trouble === "retried";
        return (
          <li
            key={s.id}
            className={`before:bg-line relative pl-7 before:absolute before:top-6 before:-bottom-2 before:left-[7.5px] before:w-px last:before:hidden ${live ? "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" : ""}`}
          >
            <span className="bg-card absolute top-1 left-0 flex size-4 items-center justify-center">
              {running && live ? (
                <EyIcon name="loader" size={16} className="text-primary animate-spin motion-reduce:animate-none" aria-label="진행 중" />
              ) : running ? (
                <EyIcon name="circle" size={14} aria-label="멈춤" />
              ) : retried ? (
                <EyIcon name="undo" size={14} className="text-text-faint" aria-label="다른 조회로 이어 감" />
              ) : trouble === "limit" ? (
                <EyIcon name="clock" size={15} className="text-amber" aria-label="시간·한도로 멈춤" />
              ) : s.state === "error" ? (
                <EyIcon name="alertCircle" size={16} className="text-danger" aria-label="막힘" />
              ) : (
                <EyIcon name="check" size={16} strokeWidth={2.4} className="text-green" aria-label="끝" />
              )}
            </span>
            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1.5 py-0.5 ${current ? "bg-primary-soft" : ""}`}>
              <EyIcon name={KIND_ICON[s.kind] ?? "dot"} size={15} className="shrink-0" />
              <span className={`min-w-0 text-sm break-words ${current ? "font-bold" : "font-medium"}`}>{s.label}</span>
              {s.tables?.length ? (
                <span className="flex flex-wrap gap-1">
                  {s.tables.map((t) => (
                    <span
                      key={t.name}
                      {...tipProps({ title: t.label, rows: [["DB 표", t.name]] })}
                      className="bg-bg-soft rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                    >
                      {t.label}
                    </span>
                  ))}
                </span>
              ) : null}
              {tail ? <span className="num ml-auto text-xs whitespace-nowrap">{tail}</span> : null}
            </div>
            {s.state === "error" && s.detail ? (
              <p className={`mt-0.5 px-1.5 text-xs break-words ${retried ? "text-text-faint" : trouble === "limit" ? "text-amber" : "text-danger"}`}>
                {retried && !/고칩니다|고쳐/.test(s.detail) ? `${s.detail} — 다른 조회로 이어 갔습니다` : s.detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** 단계가 없던 저장본(옛 메시지)의 조회 요약 — 목적 · 행 수 · 시간, 실패는 빨강. */
function QueryList({ queries }: { queries: readonly QuerySummary[] }) {
  return (
    <ul className="space-y-1.5 px-1 text-sm" aria-label="조회">
      {queries.map((q) => (
        <li key={q.id}>
          <div className="flex items-center gap-2">
            <EyIcon name={q.error ? "alertCircle" : "check"} size={16} className={`shrink-0 ${q.error ? "text-danger" : "text-green"}`} />
            <span className="min-w-0 flex-1 truncate" title={q.purpose}>
              {q.purpose}
            </span>
            <span className={`num shrink-0 text-xs whitespace-nowrap ${q.error ? "text-danger font-bold" : ""}`}>
              {q.error ? `실패 · ${seconds(q.ms)}` : `${q.rowCount.toLocaleString("ko-KR")}행 · ${seconds(q.ms)}`}
            </span>
          </div>
          {q.error ? <p className="text-danger mt-0.5 pl-6 text-xs break-words">{q.error}</p> : null}
        </li>
      ))}
    </ul>
  );
}
