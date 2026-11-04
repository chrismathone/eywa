"use client";

import { useEffect, useRef, useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { useLicenseOn } from "@/features/owner/operations-context";
import { SCHEDULE_HOURS, basisText, changedSince, inputKey, noteSource, secretaryInput, type SecretaryNote, type SecretaryRun } from "@/features/dashboard/instruments/secretary-ai";
import { dayOf } from "@/features/dashboard/instruments/secretary-facts";
import type { Candidate, SecretaryBrief, SecretaryPlan } from "@/features/dashboard/instruments/secretary-plan";
import "./secretary.css";

const FIRST = 3;
/** 비서 후보에 드는 숫자 — 아직 받는 중 · 다 받음 · 일부를 못 받음(후보를 남기지 않고 AI 정리도 멈춘다). */
export type Numbers = "wait" | "ok" | "retry";
/** 같은 후보는 30분에 한 번만 다시 남긴다(숫자가 바뀌면 바로). */
const RECAPTURE_MS = 30 * 60_000;
type State = { enabled: boolean; note: SecretaryNote | null; runs: SecretaryRun[] };
const post = (url: string, body: unknown, signal?: AbortSignal) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

/** 단계의 단추 — 상세 · 화면은 보드가 여는 표식으로, 요청 · 할 일 · 업무는 보드에 맡긴다. */
function Act({ c, onAct, quiet }: { c: Candidate; onAct: (c: Candidate) => void; quiet?: boolean }) {
  const cls = `sec-act${quiet ? " is-quiet" : ""}`;
  if (c.action.kind === "detail") return <button type="button" className={cls} data-detail={c.action.key}>{c.label}</button>;
  if (c.action.kind === "link") return <WindowLink href={c.action.href} className={cls}>{c.label}</WindowLink>;
  return <button type="button" className={cls} data-noopen onClick={() => onAct(c)}>{c.label}</button>;
}

/**
 * 업무 비서 — '확인할 일' 위에서 오늘 먼저 할 일 셋과 그 이유 · 단추(원장 2026-11-02 *"ai가 비서가되어줘서 알려주면 좋을듯"*).
 * 처음엔 자동 정리(규칙 · 지금 숫자)이고, AI 정리는 매일 01:00 · 13:00 예약과 'AI로 정리' 버튼으로 만든다(같은 후보에서 순서 · 이유만 —
 * 페이지 로드는 AI를 부르지 않는다). 숫자가 바뀌면 마지막 후보를 서버에 남겨 예약 정리가 그 값으로 돈다. 언제 돌렸는지 늘 적는다.
 */
export function SecretaryPanel({ brief, today, clock, numbers, canAsk, onAct }: {
  brief: SecretaryBrief; today: string; clock: string; numbers: Numbers; canAsk: boolean; onAct: (c: Candidate) => void;
}) {
  const [state, setState] = useState<State>({ enabled: false, note: null, runs: [] });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const sent = useRef<{ key: string; at: number } | null>(null);
  // 마지막으로 정리를 받은 때 — 그 전에 시작한 다시 읽기의 답은 새 정리를 덮지 않는다.
  const asked = useRef(0);
  // AI가 꺼진 지점은 AI 정리 · 단추 · 예약 문구 없이 자동 정리만(있었는지조차 모르게 — 서버도 따로 막는다).
  const aiOn = useLicenseOn("ai_analysis");
  // 후보가 없으면(맡긴 업무만 있어도) 정리할 것이 없다 — 단추도 후보 남기기도 없다.
  const has = brief.candidates.length > 0;

  // 오늘 정리 — 화면을 열 때와 숫자가 다시 읽힐 때(`clock`)마다 가볍게 다시 읽는다(열어 둔 화면에도 예약 정리가 뜨게).
  useEffect(() => {
    if (!canAsk || !aiOn) return;
    let alive = true;
    const started = Date.now();
    fetch("/api/dashboard/secretary", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<State>) : null))
      .then((next) => { if (alive && next && started >= asked.current) setState({ ...next, runs: next.runs ?? [] }); })
      .catch(() => undefined); // 버튼이 안 보일 뿐 자동 정리는 그대로다
    return () => { alive = false; };
  }, [canAsk, aiOn, clock]);
  // 마지막 후보 남기기 — 숫자를 다 받았을 때만(`numbers` — 일부를 못 받았으면 남기지 않는다) 후보가 바뀌었을 때 · 잠깐 기다렸다가(AI 호출 없음).
  // '같은 후보'는 예약과 같은 판정(`inputKey`).
  useEffect(() => {
    if (numbers !== "ok" || !state.enabled || !has) return;
    const { day, weekday } = dayOf(today);
    const input = secretaryInput(brief, today, weekday, day);
    const key = inputKey(input);
    if (sent.current?.key === key && Date.now() - sent.current.at < RECAPTURE_MS) return;
    const timer = window.setTimeout(() => {
      sent.current = { key, at: Date.now() };
      void post("/api/dashboard/secretary/input", input).catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [numbers, state.enabled, has, brief, today]);
  useEffect(() => {
    if (busy === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const ask = async () => {
    setBusy(Date.now());
    setNow(Date.now());
    setError(null);
    const { day, weekday } = dayOf(today);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await post("/api/dashboard/secretary", secretaryInput(brief, today, weekday, day), controller.signal);
      const body = (await res.json().catch(() => null)) as { note?: SecretaryNote; error?: string } | null;
      if (res.ok && body?.note) { const note = body.note; asked.current = Date.now(); setState((s) => ({ enabled: true, note, runs: [...s.runs, { at: note.at, runKind: note.runKind }] })); }
      else setError(body?.error ?? "AI 정리를 하지 못했습니다. 잠시 뒤 다시 눌러 주세요");
    } catch {
      setError("AI가 답하지 않았습니다. 잠시 뒤 다시 눌러 주세요");
    } finally {
      window.clearTimeout(timer);
      setBusy(null);
    }
  };

  const byRef = new Map(brief.candidates.map((c) => [c.ref, c]));
  // 정리한 뒤 사라진 후보(처리된 일)는 단계에서 빠진다 — 누를 단추가 없는 단계는 세우지 않는다.
  const stepsOf = (p: SecretaryPlan) => p.steps.flatMap((s) => { const c = byRef.get(s.ref); return c ? [{ ...s, c }] : []; });
  // AI 정리의 단계가 모두 처리돼 사라졌거나 후보가 없으면 자동 정리로 — 지난 AI 문장(첫 문장 포함)을 남기지 않는다.
  const fromNote = state.note && has ? stepsOf(state.note.plan) : [];
  const note = fromNote.length ? state.note : null;
  const plan = note?.plan ?? brief.auto;
  const steps = note ? fromNote : stepsOf(brief.auto);
  const shown = new Set(steps.slice(0, FIRST).map((s) => s.ref));
  const later = plan.later.flatMap((l) => { const c = byRef.get(l.ref); return c && !shown.has(l.ref) ? [{ ...l, c }] : []; });
  // 그다음 = 정리의 나머지 순서 → 정리에 없던 후보는 우선순위 순.
  const order = (c: Candidate) => { const i = steps.findIndex((s) => s.ref === c.ref); return i < 0 ? steps.length + (100 - c.priority) / 100 : i; };
  const rest = brief.candidates.filter((c) => !shown.has(c.ref) && !later.some((l) => l.ref === c.ref)).sort((a, b) => order(a) - order(b));
  const changed = note ? changedSince(note, brief.candidates) : [];
  const model = note ? modelDisplayLabel(note.model) : null;
  const schedule = SCHEDULE_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).join(" · ");
  const d = brief.delegated;
  if (!has && !d.waiting) return null;
  const askable = canAsk && aiOn && state.enabled && has;

  return (
    <div className="sec">
      <div className="sec-head">
        <span className="sec-mark" aria-hidden><EyIcon name="sparkle" size={15} /></span>
        <h3>업무 비서</h3>
        <span className="sec-source">{note ? `${noteSource(note, today)}${model ? ` · ${model}` : ""}` : `자동 정리 · ${clock} 숫자${askable ? ` · AI 정리는 매일 ${schedule}` : ""}`}</span>
        {askable ? (
          // 숫자를 다 받기 전엔 누르지 않는다 — 일부 후보로 정리하면 마지막 후보까지 덮인다.
          <button type="button" className="sec-ask" data-noopen disabled={busy !== null || numbers !== "ok"} onClick={() => void ask()}>
            {busy !== null ? `정리하는 중… ${Math.max(0, Math.round((now - busy) / 1000))}초` : numbers === "wait" ? "숫자 받는 중…" : numbers === "retry" ? "숫자 다시 읽기 필요" : state.note ? "AI로 다시 정리" : "AI로 정리"}
          </button>
        ) : null}
      </div>
      {askable && numbers === "retry" ? <p className="sec-error">일부 숫자를 받지 못해 AI 정리를 멈췄습니다 — 오른쪽 위 새로 고침을 눌러 주세요.</p> : null}
      {state.runs.length > 1 ? <p className="sec-runs">오늘 돌린 시각 · {state.runs.map((r) => `${basisText(r.at, today).replace(/^오늘 /, "")} ${r.runKind === "schedule" ? "예약" : "직접"}`).join(" · ")}</p> : null}
      <p className="sec-headline">{plan.headline}</p>
      {changed.length ? <p className="sec-changed">정리한 뒤 바뀐 것 — {changed.slice(0, 3).join(" · ")}{changed.length > 3 ? ` 외 ${changed.length - 3}건` : ""}</p> : null}
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      <ol className="sec-steps">
        {steps.slice(0, FIRST).map((s, i) => (
          <li key={s.ref} className="sec-step">
            <div className="sec-step-top">
              <span className="sec-no">{i + 1}</span>
              {s.c.detail ? <button type="button" className="sec-title card-open" data-detail={s.c.detail}>{s.title}</button> : <b className="sec-title">{s.title}</b>}
            </div>
            <p className="sec-why">{s.why}</p>
            {s.c.people.length ? <div className="sec-people">{s.c.people.slice(0, 4).map((p) => <span key={p}>{p}</span>)}{s.c.people.length > 4 ? <span>외 {s.c.people.length - 4}</span> : null}</div> : <div />}
            <Act c={s.c} onAct={onAct} />
          </li>
        ))}
      </ol>
      {rest.length ? (
        <div className="sec-more"><span>그다음</span>{rest.map((c) => <Act key={c.ref} c={{ ...c, label: c.title, ...(c.detail ? { action: { kind: "detail" as const, key: c.detail } } : {}) }} onAct={onAct} quiet />)}</div>
      ) : null}
      {later.length || d.waiting || d.review.length ? (
        <div className="sec-foot">
          {later.map((l) => (
            <span key={l.ref}>
              <b>미뤄도 되는 것</b> {l.c.detail ? <button type="button" className="sec-link" data-detail={l.c.detail}>{l.c.title}</button> : l.c.title} — {l.why}
            </span>
          ))}
          {d.waiting || d.review.length ? (
            <button type="button" className="sec-link sec-work" data-noopen onClick={() => document.getElementById("work")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              맡긴 업무 · 보고 기다림 {d.waiting}건{d.late.length ? ` · 기한 지남 ${d.late.length}건` : ""}{d.review.length ? ` · 내 검토 ${d.review.length}건` : ""} ›
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
