"use client";

import { useEffect, useState, type ReactNode } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";

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
  onControl,
}: {
  turn: Turn;
  /** 다시 묻기를 지금 할 수 있나(다른 답을 받는 중이면 못 한다). */
  canRetry: boolean;
  onRetry: (turn: Turn) => void;
  /** 저장본 다시 읽기(아직 만드는 중 · 끊김). */
  onReload: () => void;
  /** 이 화면이 받지 않는 도는 질문(다른 탭 · 새로 고친 뒤)을 멈추거나 바로 결과 보기 — 서버가 그 질문을 찾았나. */
  onControl?: (turn: Turn, action: "stop" | "finish") => Promise<boolean>;
}) {
  const time = kstTimeOf(turn.createdAt);
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-end gap-1">
        <p className="bg-primary-soft text-foreground max-w-[min(85%,44rem)] rounded-2xl rounded-br-md px-4 py-2.5 text-base leading-relaxed break-words whitespace-pre-wrap">
          {turn.question}
        </p>
        {time ? <p className="num px-1 text-xs">{time}</p> : null}
      </div>
      <Answer turn={turn} canRetry={canRetry} onRetry={onRetry} onReload={onReload} onControl={onControl} />
    </div>
  );
}

function Answer({
  turn,
  canRetry,
  onRetry,
  onReload,
  onControl,
}: {
  turn: Turn;
  canRetry: boolean;
  onRetry: (t: Turn) => void;
  onReload: () => void;
  onControl?: (turn: Turn, action: "stop" | "finish") => Promise<boolean>;
}) {
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
        <Notice icon="clock" tone="neutral" text="아직 답을 만드는 중입니다. 끝나면 이 자리에 보고서가 뜹니다." steps={turn.steps} pending>
          {onControl && turn.messageId ? <SavedControls turn={turn} onControl={onControl} /> : null}
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

/**
 * 이 화면이 받지 않는 도는 질문(다른 탭·기기에서 물었거나 새로 고친 뒤)의 '바로 결과 보기' · '멈추기' — 질문 번호로 서버에 알린다.
 * 다른 곳에서 쥔 자리(동시 3개)를 여기서도 풀 수 있게(적대 리뷰 2026-11-09). 결과는 3초 다시 읽기가 가져온다.
 */
function SavedControls({ turn, onControl }: { turn: Turn; onControl: (turn: Turn, action: "stop" | "finish") => Promise<boolean> }) {
  const [sent, setSent] = useState<"stop" | "finish" | null>(null);
  const [failed, setFailed] = useState(false);
  const send = async (action: "stop" | "finish") => {
    setSent(action);
    setFailed(false);
    if (!(await onControl(turn, action))) {
      setSent(null);
      setFailed(true);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={sent !== null} onClick={() => void send("finish")}>
        <EyIcon name="report" />
        {sent === "finish" ? "결과 정리 중…" : "바로 결과 보기"}
      </Button>
      <Button type="button" variant="outline" disabled={sent !== null} onClick={() => void send("stop")}>
        <EyIcon name="stop" />
        {sent === "stop" ? "멈추는 중…" : "멈추기"}
      </Button>
      {failed ? <span className="text-danger text-sm font-medium">이미 끝났거나 알리지 못했습니다. 다시 불러와 보세요.</span> : null}
    </span>
  );
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
  pending = false,
}: {
  icon: "clock" | "pause" | "error";
  tone: "neutral" | "danger";
  text: string;
  steps: readonly AskStep[];
  queries?: readonly QuerySummary[];
  children?: ReactNode;
  /** 서버가 아직 답을 만드는 중(다시 연 화면) — 막힌 단계를 실시간 화면처럼 옅게. */
  pending?: boolean;
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
        <ProcessDetails steps={steps} defaultOpen={tone === "danger"} pending={pending} />
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
  survey: "layers",
};

/**
 * 끝난 답의 과정 — 한 줄로 접힌다: `조회 3번 · 표 5개 · 18초 — 과정 보기`(누르면 타임라인 전체). JS 없이 `<details>`.
 * 다시 연 대화도 저장된 단계(`ThreadMessage.steps`)로 같은 줄을 보인다.
 */
function ProcessDetails({
  steps,
  defaultOpen = false,
  settled = false,
  pending = false,
}: {
  steps: readonly AskStep[];
  defaultOpen?: boolean;
  settled?: boolean;
  pending?: boolean;
}) {
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
        <StepTimeline steps={steps} live={false} settled={settled} pending={pending} />
      </div>
    </details>
  );
}

/**
 * 답을 만드는 동안 — 지금 하는 단계(큰 글 · 낭독) + 단계 타임라인 + 걸린 시간(1초마다).
 * 🔴 타임라인은 **기본 접힘 — 최신 단계 한 줄만**(원장 2026-11-06 *"이렇게 나열하지말고 펼치기 할때만 나열하고, 디폴트로 접기한 상태에서
 *    최신 상태만 보여주도록"*). '지난 단계 N개 펼치기'를 누르면 전체를 나열한다(그 차례 동안 펼친 채로 둔다).
 */
function Progress({ turn, note }: { turn: Turn; note?: string }) {
  const [expanded, setExpanded] = useState(false);
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
  const latest = turn.steps.at(-1);
  // 접혀 있으면 단계 줄을 그리지 않는다 — 지금 단계가 이미 큰 글씨라 같은 문장이 두 번 보였다(원장 2026-11-09
  // *"이 두 메시지가 결국은 똑같은데 따로 둘 필요가 있을까?"*). 지금 단계가 보는 표(칩)만 큰 글씨 아래에 붙인다.
  // 단계 사이(끝난 뒤 다음 단계가 열리기 전)에도 줄을 띄우지 않는다 — 경계마다 카드가 늘었다 줄었다 한다.
  // 예외: 마지막 단계가 막혔으면(그 까닭) · 다시 잇는 중이면(note) 줄을 그대로 보인다.
  const lineHidden = !expanded && !note && !!latest && latest.state !== "error";
  const chips = lineHidden && latest?.state === "running" && latest.tables?.length ? latest.tables : null;
  const more = turn.steps.length > 1;
  // 펼치면 보일 단계 수 — 단계 사이(마지막 단계가 끝나고 다음이 열리기 전)엔 마지막 단계도 숨어 있다.
  const hiddenCount = lineHidden && latest?.state !== "running" ? turn.steps.length : turn.steps.length - 1;
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
      {/* 첫 단계가 오기 전엔 큰 글씨 한 줄뿐 — 접힌 카드엔 단계 줄이 오지 않으니 뼈대 막대로 줄을 예고하지 않는다(적대 리뷰 2026-11-09). */}
      {turn.steps.length > 0 && (!lineHidden || chips || more) ? (
        // 자식 자리(칩 · 단계 줄 · 펼치기)는 늘 같은 순서 — 펼치고 접어도 버튼이 그대로라 초점이 남는다.
        // 접힌 때는 큰 글씨의 글자 선(pl-11)에 맞추고 칩과 펼치기를 한 줄에 — 칩이 오고 가도 카드 높이가 그대로다.
        <div className={lineHidden ? "relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-11" : "mt-3.5 pl-1"}>
          {chips ? (
            <>
              <span className="sr-only">이 단계가 보는 표: </span>
              <TableChips tables={chips} />
            </>
          ) : null}
          {lineHidden ? null : <StepTimeline steps={expanded ? turn.steps : turn.steps.slice(-1)} live now={now} startedAt={started} currentId={running?.id ?? null} />}
          {more ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className={`text-primary hover:bg-muted inline-flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-0.5 text-sm font-bold ${lineHidden ? (chips ? "" : "-ml-1.5") : "mt-1.5"}`}
            >
              {expanded ? "과정 접기" : `지난 단계 ${hiddenCount}개 펼치기`}
              <EyIcon name="chevronDown" size={16} className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 단계가 보는 DB 표 — 짧은 이름 칩(마우스를 올리면 실제 표 이름). */
function TableChips({ tables }: { tables: NonNullable<AskStep["tables"]> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {tables.map((t) => (
        <span
          key={t.name}
          {...tipProps({ title: t.label, rows: [["DB 표", t.name]] })}
          className="bg-bg-soft rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
        >
          {t.label}
        </span>
      ))}
    </span>
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
  pending = false,
}: {
  steps: readonly AskStep[];
  live: boolean;
  now?: number | null;
  /** 질문을 보낸 시각(ms) — 도는 단계의 흐르는 초 = 지금 − (보낸 시각 + 단계 시작 `at`). */
  startedAt?: number;
  currentId?: string | null;
  /** 답이 보고서로 끝난 차례 — 막혔다가 이어 간 단계를 옅게 그린다(`stepTrouble`). */
  settled?: boolean;
  /** 서버가 아직 답을 만드는 중(다시 연 화면) — 실시간 화면(live)처럼 막힘을 옅게 '다시 해 봅니다'. */
  pending?: boolean;
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
        // 시간·한도면 주황(분석이 잘렸다는 신호) · 원장이 누른 '바로 결과 보기'면 옅은 멈춤 · 나머지는 빨강(원장 2026-11-06 · 적대 리뷰 2026-11-06).
        const trouble = stepTrouble(steps, index, settled);
        // 진행 중(live)의 막힘은 아직 결말이 아니다 — 비서가 고쳐 다시 하는 게 보통이라 옅게 '다시 해 봅니다'.
        // 끝내 답이 실패하면 실패 안내(Notice · settled 아님)에서 빨강으로 남는다.
        const retrying = (live || pending) && trouble === "failed";
        const retried = trouble === "retried" || retrying;
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
                <EyIcon name="undo" size={14} className="text-text-faint" aria-label={retrying ? "다시 해 보는 중" : "다른 조회로 이어 감"} />
              ) : trouble === "limit" ? (
                <EyIcon name="clock" size={15} className="text-amber" aria-label="시간·한도로 멈춤" />
              ) : trouble === "user" ? (
                <EyIcon name="pause" size={14} aria-label="여기서 조회를 끝냄" />
              ) : s.state === "error" ? (
                <EyIcon name="alertCircle" size={16} className="text-danger" aria-label="막힘" />
              ) : (
                <EyIcon name="check" size={16} strokeWidth={2.4} className="text-green" aria-label="끝" />
              )}
            </span>
            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1.5 py-0.5 ${current ? "bg-primary-soft" : ""}`}>
              <EyIcon name={KIND_ICON[s.kind] ?? "dot"} size={15} className="shrink-0" />
              <span className={`min-w-0 text-sm break-words ${current ? "font-bold" : "font-medium"}`}>{s.label}</span>
              {s.tables?.length ? <TableChips tables={s.tables} /> : null}
              {tail ? <span className="num ml-auto text-xs whitespace-nowrap">{tail}</span> : null}
            </div>
            {s.state === "error" && s.detail ? (
              <p className={`mt-0.5 px-1.5 text-xs break-words ${retried ? "text-text-faint" : trouble === "limit" ? "text-amber" : trouble === "user" ? "" : "text-danger"}`}>
                {retried && !/고칩니다|고쳐/.test(s.detail) ? `${s.detail} — ${retrying ? "다시 해 봅니다" : "다른 조회로 이어 갔습니다"}` : s.detail}
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
