"use client";

import { useId, useRef, useState } from "react";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmbedAnchor } from "@/components/embed-link";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { addDays, kstToday } from "@/lib/date-kst";
import {
  ADVICE_RATING_LABEL,
  ADVICE_RATINGS,
  ADVICE_STATUS_LABEL,
  CHECK_FAILED,
  CHECK_SKIPPED,
  formatCheckValue,
  monthDayLabel,
  NO_CHECK_GIVEN,
  type AdviceRating,
  type AdviceStatus,
  type AdviceView,
} from "../advice";
import { VERDICT_LABEL } from "../advice-outcome";
import { newerAdvice, rememberAdvice, useLatestAdvice } from "./advice-latest";
import { PlanLine } from "./advice-lines";
import { adviceRequest } from "./advice-request";

const ACTIONS: AdviceStatus[] = ["adopted", "done", "on_hold", "declined"];
const SAVED_TEXT: Record<AdviceStatus, string> = {
  open: "처리 전으로 되돌렸습니다",
  adopted: "채택으로 저장했습니다",
  done: "완료로 저장했습니다",
  on_hold: "보류로 저장했습니다",
  declined: "안 함으로 저장했습니다",
};
const MEMO_MAX = 500;

/**
 * 비서 의견 한 줄의 확인 지표 · 원장 처리(제안 → 결과 → 학습 1단계 · 원장 2026-11-06 *"그 해결책이 어떤 결과를 가져왔는지 … 결과 피드백"*).
 * 채택 · 보류는 바로 저장 · 완료는 한 날·해 본 내용·어땠나 · 안 함은 까닭 · 처리한 것을 다시 누르면 채택·보류는 처리 전으로, 완료·안 함은 고치기.
 * 다시 잴 날에 크론이 같은 조회문으로 다시 재어(2단계 · /api/cron/assistant-outcomes) 결과 줄 — 기준 → 지금 · 판정(개선·변화 없음·악화·판정 보류).
 */
export function AdviceStatusPanel({ initial, onChange }: { initial: AdviceView; onChange?: (view: AdviceView) => void }) {
  const id = useId();
  // 보이는 값 = 받은 값(서버 — 다른 탭에서 처리했으면 더 새 값)과 이 문서에서 저장한 값(대화 카드·'지난 의견' 공유 — advice-latest) 중 더 새 것.
  // 다시 그리지 않고 고르므로 대화를 조용히 다시 읽어도 열어 둔 창·쓰던 메모가 그대로다(재리뷰 2026-11-09).
  const shared = useLatestAdvice(initial.id);
  const view = newerAdvice(initial, shared);
  const [form, setForm] = useState<null | "done" | "declined">(null);
  const [memo, setMemo] = useState("");
  const [doneOn, setDoneOn] = useState(() => kstToday());
  const [rating, setRating] = useState<AdviceRating | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [announce, setAnnounce] = useState("");

  const setView = (next: AdviceView) => {
    rememberAdvice(next);
    onChange?.(next);
  };

  async function send(status: AdviceStatus, extra: { memo?: string; doneOn?: string; selfRating?: AdviceRating | null } = {}) {
    // 빠르게 두 번 누르면 둘째가 옛 처리 시각으로 가 409가 났다 — 저장 중에는 받지 않는다(단추는 막지 않는다 · 포커스가 사라지지 않게).
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNeedsLogin(false);
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), 15_000);
    try {
      const res = await adviceRequest(`/api/assistant/advice/${encodeURIComponent(view.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, statusAt: view.statusAt, ...extra }),
        signal: timeout.signal,
      });
      const body = (await res.json().catch(() => null)) as { advice?: AdviceView; error?: unknown } | null;
      if (!res.ok || !body?.advice) {
        setNeedsLogin(res.status === 401);
        setError(res.status === 401 ? "로그인 상태를 확인하지 못했습니다. 다시 로그인한 뒤 처리해 주세요" : typeof body?.error === "string" ? body.error : "처리를 저장하지 못했습니다. 다시 눌러 주세요");
        return;
      }
      setView(body.advice);
      setForm(null);
      setAnnounce(SAVED_TEXT[body.advice.status]);
    } catch {
      setError(timeout.signal.aborted ? "응답이 없어 저장하지 못했습니다. 다시 눌러 주세요" : "연결이 끊겨 저장하지 못했습니다. 다시 눌러 주세요");
    } finally {
      window.clearTimeout(timer);
      busyRef.current = false;
      setBusy(false);
    }
  }

  function openForm(kind: "done" | "declined") {
    setMemo(view.status === kind ? (view.memo ?? "") : "");
    setDoneOn(view.doneOn ?? kstToday());
    setRating(view.status === kind ? view.selfRating : null);
    setForm(kind);
    setError(null);
  }

  function pick(status: AdviceStatus) {
    if (busyRef.current) return;
    if (status === "done" || status === "declined") {
      if (form === status) return; // 열린 창을 다시 눌러도 쓰던 글을 지우지 않는다
      return openForm(status);
    }
    setForm(null);
    void send(status === view.status ? "open" : status);
  }

  const lock = busy ? { "aria-disabled": true } : {};
  return (
    <div className="relative mt-2 space-y-2">
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <CheckLine view={view} />
      <PlanLine view={view} />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span id={`${id}-label`} className="text-sm font-bold">
          처리
        </span>
        <div role="group" aria-labelledby={`${id}-label`} className={TOOLBAR_SEG_BOX}>
          {ACTIONS.map((s) => {
            const on = (form ?? view.status) === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                {...lock}
                onClick={() => pick(s)}
                className={`${TOOLBAR_SEG_ITEM} cursor-pointer aria-disabled:cursor-wait ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {ADVICE_STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        {view.status !== "open" && !form ? (
          <>
            <span className="min-w-0 text-sm break-words">{statusSummary(view)}</span>
            <button type="button" {...lock} onClick={() => void send("open")} className="text-primary cursor-pointer text-sm font-bold underline-offset-2 hover:underline aria-disabled:cursor-wait">
              처리 전으로
            </button>
          </>
        ) : null}
      </div>
      {form ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(form, form === "done" ? { memo, doneOn, selfRating: rating } : { memo });
          }}
          className="bg-bg-soft space-y-2.5 rounded-xl p-3"
        >
          {form === "done" ? (
            <label className="flex flex-wrap items-center gap-2 text-sm font-bold">
              한 날
              <Input type="date" required min={view.askedOn ?? undefined} max={kstToday()} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} className="w-auto" />
            </label>
          ) : null}
          <label className="block space-y-1 text-sm font-bold">
            <span>{form === "done" ? "해 본 내용(선택)" : "안 하는 까닭(선택)"}</span>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={MEMO_MAX}
              rows={2}
              className="border-line bg-card focus-visible:border-primary/50 block w-full resize-y rounded-lg border px-3 py-2 text-base font-normal outline-none"
            />
          </label>
          {form === "done" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span id={`${id}-rating`} className="text-sm font-bold">
                어땠나요(선택)
              </span>
              {/* 고르지 않아도 되는 하나 고르기 — 다시 누르면 풀린다(라디오가 아니라 눌림 단추 묶음). */}
              <div role="group" aria-labelledby={`${id}-rating`} className={TOOLBAR_SEG_BOX}>
                {ADVICE_RATINGS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={rating === r}
                    {...lock}
                    onClick={() => !busyRef.current && setRating(rating === r ? null : r)}
                    className={`${TOOLBAR_SEG_ITEM} cursor-pointer ${rating === r ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
                  >
                    {ADVICE_RATING_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" {...lock}>
              {busy ? "저장하는 중…" : form === "done" ? "완료로 저장" : "안 함으로 저장"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              취소
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm font-medium break-words">
          {error}
          {needsLogin ? <EmbedAnchor href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="ml-2 underline underline-offset-4">로그인하기</EmbedAnchor> : null}
        </p>
      ) : null}
    </div>
  );
}

/** 판정 칩 — 의미색 캐논(좋음 · 나쁨 · 그 밖은 비활성). 원인을 말하지 않는다(같은 시기에 함께 일어난 변화). */
const VERDICT_TONE: Record<NonNullable<AdviceView["result"]>["verdict"], string> = {
  improved: TONE_SOFT.positive,
  worse: TONE_SOFT.critical,
  flat: TONE_SOFT.inert,
  unknown: TONE_SOFT.inert,
};

/** 확인 지표 한 줄 — 기준값과 그 기간 · 좋아지는 쪽 · 다시 잴 날 또는 결과. 일반 의견의 지표 없는 사유는 표시하지 않는다. */
function CheckLine({ view }: { view: AdviceView }) {
  const c = view.check;
  if (!c) {
    if (!view.noCheck) return null;
    const server = view.noCheck === NO_CHECK_GIVEN || view.noCheck === CHECK_FAILED || view.noCheck === CHECK_SKIPPED;
    if (!server) return null;
    return <p className="text-sm break-words">확인 지표 없음 — {view.noCheck}</p>;
  }
  const b = c.baseline;
  const r = view.result;
  const period = (from: string, to: string) => `${monthDayLabel(from)}~${monthDayLabel(addDays(to, -1))}`;
  // 다시 잴 날이 지났는데 아직 기다림(크론이 그 지점을 건너뛴 날 · 실패해 다음 날로)이면 날짜를 약속하지 않는다.
  const waiting = view.measureState === "waiting" && c.nextCheckOn ? (c.nextCheckOn >= kstToday() ? `${monthDayLabel(c.nextCheckOn)}에 다시 잽니다` : "다시 재기를 기다리는 중") : null;
  return (
    <div className="space-y-1">
      <p className="text-sm break-words">
        <span className="font-bold">확인 지표</span> · {c.label}
        {b ? (
          <>
            {" · 기준값 "}
            <span className="num font-bold">{formatCheckValue(b.value, c.unit)}</span>
            {c.unit === "percent" && b.sample !== null ? ` (${formatCheckValue(b.sample, "number")} 중)` : ""}
            {` · ${period(b.from, b.to)}`}
          </>
        ) : (
          " · 기준값을 재지 못했습니다"
        )}
        {` · ${c.better === "up" ? "오르면 좋음" : "내리면 좋음"}`}
        {waiting ? ` · ${waiting}` : ""}
      </p>
      {r ? (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm break-words">
            <span className="font-bold">다시 잰 값</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${VERDICT_TONE[r.verdict]}`}>{VERDICT_LABEL[r.verdict]}</span>
            <span>
              {"기준값 "}
              <span className="num font-bold">{formatCheckValue(r.base, c.unit)}</span>
              {" → 재측정 "}
              <span className="num font-bold">{formatCheckValue(r.value, c.unit)}</span>
              {r.verdict === "flat" && r.threshold !== null ? ` (차이가 ±${formatCheckValue(r.threshold, c.unit === "percent" ? "number" : c.unit)}${c.unit === "percent" ? "%p" : ""} 안)` : ""}
              {` · ${period(r.from, r.to)} · ${r.basis === "done" ? (view.status === "done" ? `완료(${monthDayLabel(r.anchor)}) 뒤` : `${monthDayLabel(r.anchor)}부터`) : "의견을 낸 뒤"} · ${monthDayLabel(kstToday(new Date(r.checkedAt)))}에 잼`}
              {r.reason ? ` — ${r.reason}` : ""}
            </span>
          </p>
          <p className="text-text-dim text-sm break-words">같은 시기에 함께 일어난 변화입니다 — 이 의견 때문이라고 단정하지 않습니다.</p>
        </>
      ) : view.measureState === "broken" ? (
        <p className="text-sm break-words">다시 잰 값 — 여러 번 다시 재지 못해 판정하지 않습니다</p>
      ) : view.measureState === "stopped" ? (
        <p className="text-sm break-words">다시 잰 값 — 다시 재지 않습니다</p>
      ) : null}
    </div>
  );
}

function statusSummary(v: AdviceView): string {
  const parts: string[] = [ADVICE_STATUS_LABEL[v.status]];
  if (v.status === "done" && v.doneOn) parts.push(monthDayLabel(v.doneOn));
  if (v.status === "done" && v.selfRating) parts.push(ADVICE_RATING_LABEL[v.selfRating]);
  return `${parts.join(" · ")}${v.memo ? ` — ${v.memo}` : ""}`;
}
