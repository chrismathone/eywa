"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { rerunVideoReview } from "../server/actions";
import { OVERALL_LABEL, OVERALL_TONE, type ReviewView } from "../view";
import { ScoreBars } from "./score-bars";
import { pointsTier, POINTS_TIER_COLOR, reviewPoints } from "../score";

type Load = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ready"; view: ReviewView | null };

/**
 * 영상 설명 AI 참고 메모 — 재생 창 아래. 저장된 결과만 읽는다(창을 연다고 AI를 부르지 않는다).
 * 스위치가 꺼졌거나 볼 수 없는 영상(404·403)이면 아무것도 그리지 않는다. 창이 열려 있는 동안 분석 중이면 20초,
 * 준비·대기 중(또는 아직 줄이 없으면) 60초마다 저장된 상태를 다시 읽는다(DB 읽기뿐 — AI 호출 없음).
 * `reserve` = 분석 대상일 것 같은 영상(수학 반) — 불러오는 동안에도 메모 칸을 세워 둔다(원장 2026-10-21 "처음부터 1번 사진처럼" — 불러온 뒤에
 *   칸이 생기며 영상이 줄던 것). 불러와 보니 볼 것이 없으면(꺼짐·대상 아님) 그때 칸을 거둔다.
 */
export function AiReviewPanel({ videoId, reserve = false }: { videoId: string; reserve?: boolean }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/homework-videos/${videoId}/review`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404 || r.status === 403 || r.status === 401) return setLoad({ kind: "hidden" });
        if (!r.ok) return setLoad({ kind: "error" });
        setLoad({ kind: "ready", view: ((await r.json()) as { view: ReviewView | null }).view });
      })
      .catch(() => alive && setLoad({ kind: "error" }));
    return () => { alive = false; };
  }, [videoId, tick]);

  const state = load.kind === "ready" ? (load.view?.state ?? "none") : null;
  useEffect(() => {
    const ms = state === "analyzing" ? 20_000 : state === "waiting" || state === "none" ? 60_000 : 0;
    if (!ms) return;
    const t = setTimeout(() => setTick((n) => n + 1), ms);
    return () => clearTimeout(t);
  }, [state, tick]);

  if (load.kind === "loading") return reserve ? <MemoColumn busy><p role="status" className="text-text-dim text-sm">AI 참고 메모를 불러오는 중…</p></MemoColumn> : null;
  if (load.kind === "hidden") return null;
  if (load.kind === "error") return <MemoColumn><p className="text-text-dim text-sm">AI 참고 메모를 불러오지 못했어요.</p></MemoColumn>;
  const view = load.view;
  if (!view) return null;
  const r = view.result;
  const points = r ? reviewPoints(r.scores) : null;

  async function rerun() {
    setPending(true);
    setNotice(null);
    const res = await rerunVideoReview(videoId).catch(() => ({ ok: false as const, error: "다시 분석을 요청하지 못했어요." }));
    setPending(false);
    if (!res.ok) setNotice(res.error);
    setTick((n) => n + 1);
  }

  return (
    <MemoColumn>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">AI 참고 메모</h3>
        {r ? <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_SOFT[OVERALL_TONE[r.overall]]}`}>{OVERALL_LABEL[r.overall]}</span> : null}
        {/* 평점 — 장부 칸 아래와 같은 값·같은 색(원장 2026-10-21 · score.ts). */}
        {points !== null ? <span className="text-sm font-bold tabular-nums" style={{ color: POINTS_TIER_COLOR[pointsTier(points)] }} title="AI 참고 평점(5점 만점)">
          {points.toFixed(1)}<span className="font-normal opacity-70">/5</span></span> : null}
        {view.judgeModelLabel ? <span className="text-text-dim text-xs">{view.judgeModelLabel}</span> : null}
        <span className="text-text-dim text-xs">선생님 참고용 · 틀릴 수 있어요</span>
        {view.canRerun ? <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={rerun}>
          {pending ? "요청 중…" : "다시 분석"}</Button> : null}
      </header>
      {view.message ? <p role="status" className="text-text-dim text-sm">{view.message}</p> : null}
      {notice ? <p role="alert" className="text-sm">{notice}</p> : null}
      {r ? <ReviewBody result={r} /> : null}
    </MemoColumn>
  );
}

/**
 * 메모 칸 — 넓은 화면은 영상 칸 옆 26rem · **높이는 영상 칸이 정한다**(바깥 칸은 줄 높이를 따라 늘고, 안쪽 상자가 그 높이를 꽉 채워 넘치면 안에서
 * 스크롤 — 원장 2026-10-21 "메모크기에 맞추지말고 영상크기에 맞추고 메모는 스크롤"). 영상이 아직 없을 때 너무 납작해지지 않게 최소 높이. 좁으면 영상 아래.
 */
function MemoColumn({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return <div className="lg:relative lg:min-h-64 lg:w-[26rem] lg:shrink-0">
    <section aria-label="AI 참고 메모" aria-busy={busy || undefined} className="border-line-faint space-y-3 rounded-xl border p-4 lg:absolute lg:inset-0 lg:overflow-y-auto">
      {children}
    </section>
  </div>;
}

function ReviewBody({ result: r }: { result: NonNullable<ReviewView["result"]> }) {
  return (
    <div className="space-y-3 text-sm">
      {r.topic ? <p><span className="text-text-dim">설명한 내용 </span>{r.topic}</p> : null}
      <ScoreBars scores={r.scores} />
      {r.note ? <p className="leading-relaxed">{r.note}</p> : null}
      <Findings title="확인된 오류" tone="critical" items={r.mistakes.map((m) => `${m.where} — ${m.whyWrong}`)} />
      <Findings title="선생님 확인 필요" tone="caution" items={r.needsCheck} />
      <Findings title="스스로 고친 곳" tone="inert" items={r.selfFixed} />
    </div>
  );
}

function Findings({ title, tone, items }: { title: string; tone: "critical" | "caution" | "inert"; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs ${TONE_SOFT[tone]}`}>{title} {items.length}</h4>
      <ul className="list-disc space-y-1 pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
