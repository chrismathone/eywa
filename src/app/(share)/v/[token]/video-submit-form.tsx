"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { checkVideoFile } from "@/features/video-submit/rules";
import { runResumableUpload, UploadError, wakeableSleep, xhrPut } from "@/features/video-submit/upload-client";
import { createUploadReporter, flushUploadEvents } from "@/features/video-submit/upload-diagnostics-client";
import { confirmationReason, uploadEventLabel, uploadFailureText, type UploadEvent } from "@/features/video-submit/upload-diagnostics";
import { SITE_FREE_UPLOADS_PER_DAY, SITE_MAX_VIDEOS_PER_HOMEWORK, SITE_NOTE_MAX, siteNote } from "@/features/video-submit/site";
import { InAppWarning } from "./in-app-warning";
import { useScreenWakeLock } from "@/features/video-submit/use-screen-wake-lock";

type Phase =
  | { kind: "idle" }
  | { kind: "picked"; file: File }
  | { kind: "uploading"; file: File; sent: number }
  | { kind: "finishing" }
  | { kind: "done" }
  | { kind: "error"; message: string; file: File | null };

const mb = (bytes: number) => `${Math.max(0.1, Math.round(bytes / 104857.6) / 10)}MB`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * "끝났다"를 못 알린 업로드 번호(이 기기에만) — 확인 중에 폰을 닫으면 영상은 Drive에 있는데 기록이 없다. 같은 링크를 다시 열면
 * 화면이 대신 알린다(서버도 다음 시작 때 대신 마무리한다). 기기 편의일 뿐이라 저장이 막혀도 동작은 같다.
 */
const pendingKey = (token: string) => `aywa.videoSubmit.pending.${token.slice(0, 12)}`;
function readPending(token: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(pendingKey(token)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-5) : [];
  } catch {
    return [];
  }
}
function writePending(token: string, ids: string[]) {
  try {
    if (ids.length) window.localStorage.setItem(pendingKey(token), JSON.stringify(ids));
    else window.localStorage.removeItem(pendingKey(token));
  } catch {
    // 저장이 막힌 브라우저 — 서버가 다음 시작 때 대신 마무리한다.
  }
}
/** 완료 응답이 결론(성공·되돌릴 수 없는 거절)인가 — '아직'·연결 실패·잠시 못 받음은 결론이 아니다. */
const settled = (done: Record<string, unknown> | null) =>
  !!done && (done.ok === true || (done.code !== "pending" && done.code !== "error" && done.code !== "unavailable"));

async function postJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 공개 제출 화면 — 학부모 폰이 기본(한 열·큰 버튼). 문구는 전부 한글, 원문 오류는 내보내지 않는다. */
export function VideoSubmitForm(props: {
  token: string; academyName: string; studentLabel: string; className: string; lastDayLabel: string; maxLabel: string;
  /** 올리기 사이트에서 고른 숙제일(서버가 확인한 값) — 업로드 시작 때 함께 보내 영상을 그 숙제에 묶는다. 없으면 예전처럼 올린다. */
  homeworkDate?: string | null;
  /** 그 숙제가 나간 수업일 표기("10/1 (목)"). */
  homeworkLabel?: string | null;
  /** 그 숙제에 이미 낸 영상 수(서버가 장부와 같은 판정으로 센 값) — 한 숙제에 여러 단원 영상을 낸다(원장 2026-10-21). */
  sent?: number;
  /** 같은 반의 다른 안 낸 영상 숙제(올리기 사이트 링크만) — 같은 링크에 숙제일만 바꿔 바로 간다. */
  otherHomework?: { date: string; label: string }[];
  /** 숙제 없이 올리기(올리기 사이트 · 2026-10-13) — 무슨 영상인지 메모를 받아 업로드 시작 때 함께 보낸다(서버가 다시 확인한다). */
  freeUpload?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [note, setNote] = useState("");
  // 이 화면에서 그 숙제에 더 낸 수 — 상한 안내용(정확한 수와 상한은 업로드 시작이 다시 센다).
  const [sentHere, setSentHere] = useState(0);
  const sentTotal = (props.sent ?? 0) + sentHere;
  // 숙제 없이 올릴 때는 메모가 있어야 올린다(서버와 같은 다듬기 — 2글자 이상).
  const noteMissing = !!props.freeUpload && !siteNote(note);
  const [recovered, setRecovered] = useState(false);
  const [uploadLog, setUploadLog] = useState<UploadEvent[]>([]);
  const [uploadNumber, setUploadNumber] = useState<string | null>(null);
  const reporter = useRef<ReturnType<typeof createUploadReporter> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // 화면이 스스로 새로 고칠 때(만료·숙제 없어짐)는 아래 '닫기 붙잡기'를 건너뛴다 — 그 순간 화면은 아직 '올리는 중'이다.
  const leaving = useRef(false);

  // 지난번에 못 알린 업로드가 이 기기에 남아 있으면 대신 알린다.
  useEffect(() => {
    let alive = true;
    const flush = () => { void flushUploadEvents(props.token); };
    flush();
    window.addEventListener("online", flush);
    void (async () => {
      for (const uploadId of readPending(props.token)) {
        const done = await postJson("/api/video-submit/complete", { token: props.token, uploadId });
        if (settled(done)) writePending(props.token, readPending(props.token).filter((id) => id !== uploadId));
        if (done?.ok && alive) setRecovered(true);
      }
    })();
    return () => { alive = false; reporter.current?.dispose(); window.removeEventListener("online", flush); };
  }, [props.token]);
  const busy = phase.kind === "uploading" || phase.kind === "finishing";
  // 올리는 동안 화면이 저절로 꺼지지 않게(자동 잠금에 사파리가 숨으면 전송이 멈춘다 — use-screen-wake-lock.ts).
  useScreenWakeLock(busy);

  // 올리는 중에 창을 닫으려 하면 한 번 붙잡는다(폰은 무시할 수 있다 — 그래서 화면에도 적는다).
  useEffect(() => {
    if (!busy) return;
    const hold = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [busy]);

  function pick(file: File | undefined) {
    if (!file) return;
    const check = checkVideoFile(file);
    setPhase(check.ok ? { kind: "picked", file } : { kind: "error", message: check.error, file: null });
  }

  async function upload(file: File) {
    reporter.current?.dispose();
    setUploadLog([]); setUploadNumber(null);
    setPhase({ kind: "uploading", file, sent: 0 });
    const started = await postJson("/api/video-submit/start", {
      token: props.token, name: file.name, size: file.size, type: file.type, ...(props.homeworkDate ? { homeworkDate: props.homeworkDate } : {}),
      ...(props.freeUpload ? { note } : {}),
    });
    if (!started?.ok || typeof started.sessionUrl !== "string" || typeof started.uploadId !== "string") {
      const message = typeof started?.error === "string" ? started.error : "연결을 확인하고 다시 시도해 주세요.";
      // 그사이 만료(→ 만료 화면) · 링크가 끊겼거나 고른 숙제가 없어짐(→ 닫힌 화면 / 올리기 사이트 첫 화면) — 페이지가 맞는 곳으로 보낸다.
      // 여기 남겨 두면 '다시 올리기'가 같은 거절만 되풀이한다.
      if (started?.code === "expired" || started?.code === "invalid") {
        leaving.current = true;
        window.location.reload();
      }
      setPhase({ kind: "error", message, file });
      return;
    }
    writePending(props.token, [...readPending(props.token), started.uploadId]);
    setUploadNumber(started.uploadId.slice(0, 8));
    const trace = createUploadReporter(props.token, started.uploadId, file.size, event => {
      setUploadLog(current => [...current.filter(e => e.kind !== "progress"), event].slice(-12));
    });
    reporter.current = trace;
    try {
      await runResumableUpload({
        size: file.size, slice: (start, end) => file.slice(start, end), put: xhrPut(started.sessionUrl), sleep: wakeableSleep,
        onProgress: (sent) => { trace.progress(sent); setPhase({ kind: "uploading", file, sent }); },
        onEvent: (kind, detail) => trace.event(kind, detail),
      });
    } catch (error) {
      if (!(error instanceof UploadError)) trace.event("failed", { reason: "unknown" });
      trace.dispose();
      setPhase({ kind: "error", message: error instanceof UploadError ? error.message : "영상을 올리지 못했습니다. 다시 올려 주세요.", file });
      return;
    }
    setPhase({ kind: "finishing" });
    trace.confirming();
    // Drive가 마지막 조각을 반영하는 데 잠깐 걸릴 수 있다 — '아직'이면 몇 번 더 묻는다.
    for (let attempt = 0; attempt < 5; attempt++) {
      const done = await postJson("/api/video-submit/complete", { token: props.token, uploadId: started.uploadId });
      if (settled(done)) writePending(props.token, readPending(props.token).filter((id) => id !== started.uploadId));
      if (done?.ok) { trace.event("confirmed"); trace.dispose(); if (props.homeworkDate) setSentHere((n) => n + 1); return setPhase({ kind: "done" }); }
      const reason = done ? confirmationReason(done.code) : "network";
      if (done && settled(done)) {
        trace.event("confirm_failed", { reason, attempt: attempt + 1 }); trace.dispose();
        return setPhase({ kind: "error", message: typeof done.error === "string" ? done.error : "올린 영상을 확인하지 못했습니다.", file: null });
      }
      trace.event(attempt === 4 ? "confirm_failed" : "confirm_retry", { reason, attempt: attempt + 1 });
      await sleep(1500 * (attempt + 1));
    }
    trace.dispose();
    const message = uploadFailureText("confirm_pending");
    setPhase({ kind: "error", message: `${message.label}. ${message.help}`, file });
  }

  const percent = phase.kind === "uploading" ? Math.floor((phase.sent / Math.max(1, phase.file.size)) * 100) : 0;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pt-8 pb-8 lg:pb-10">
      <header className="space-y-1">
        <p className="text-text-dim text-sm">{props.academyName}</p>
        <h1 className="text-foreground text-2xl font-bold">숙제 영상 제출</h1>
        <p className="text-foreground text-base break-keep">{props.studentLabel} 학생 · {props.className}</p>
        {props.homeworkLabel ? <p className="text-foreground text-base font-bold break-keep">{props.homeworkLabel} 수업의 영상 숙제</p> : null}
        {props.freeUpload ? <p className="text-foreground text-base font-bold break-keep">숙제 목록에 없는 영상</p> : null}
      </header>
      <InAppWarning />
      {recovered ? <p className="text-foreground text-sm break-keep" aria-live="polite">지난번에 올린 영상도 제출됐습니다.</p> : null}
      <section className="bg-card border-line relative space-y-4 rounded-2xl border p-5">
        <ul className="text-text-dim space-y-1 text-sm break-keep">
          <li>영상 한 개에 {props.maxLabel}까지 올릴 수 있습니다.</li>
          {/* 고른 숙제가 있으면 그 숙제의 마감(선생님이 고른 다음 수업 또는 숙제일 + 7일, video-homework/due.ts), 없으면 링크가 끝나는 날 */}
          <li>{props.homeworkLabel ? `${props.lastDayLabel}까지 올릴 수 있습니다.` : `${props.lastDayLabel}까지 쓸 수 있는 링크입니다.`}</li>
          <li>올린 영상은 담당 선생님만 봅니다.</li>
          {props.freeUpload ? <li>숙제 없이 올리는 영상은 하루 {SITE_FREE_UPLOADS_PER_DAY}개까지 올릴 수 있습니다.</li> : null}
          {/* 여러 단원이면 같은 숙제에 여러 개(원장 2026-10-21). */}
          {props.homeworkDate ? <li>여러 단원이면 이 숙제에 영상을 {SITE_MAX_VIDEOS_PER_HOMEWORK}개까지 올릴 수 있습니다.{sentTotal ? ` 지금까지 ${sentTotal}개 냈습니다.` : ""}</li> : null}
        </ul>
        {props.freeUpload ? (
          <label className="block space-y-2">
            <span className="text-foreground block text-base font-bold break-keep">무슨 영상인가요?</span>
            {/* 16px 이상 — iOS 확대 방지. 선생님이 이 메모를 보고 숙제에 연결한다. */}
            <textarea value={note} maxLength={SITE_NOTE_MAX} rows={2} disabled={busy} aria-label="무슨 영상인지 메모"
              placeholder="예: 10월 6일 수업 숙제 3번 풀이" onChange={(event) => setNote(event.target.value)}
              className="border-line bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-base outline-none" />
            <span className="text-text-dim block text-sm break-keep">선생님이 이 메모를 보고 숙제에 연결합니다.</span>
          </label>
        ) : null}
        <input ref={input} type="file" accept="video/*" className="sr-only" aria-label="영상 고르기"
          onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
        {phase.kind === "idle" ? (
          <Button type="button" size="lg" className="w-full" onClick={() => input.current?.click()}>영상 고르기</Button>
        ) : null}
        {phase.kind === "picked" ? (
          <div className="space-y-3">
            <p className="text-foreground text-sm break-all">{phase.file.name} · {mb(phase.file.size)}</p>
            <Button type="button" size="lg" className="w-full" disabled={noteMissing} onClick={() => upload(phase.file)}>올리기</Button>
            {noteMissing ? <p className="text-text-dim text-sm break-keep">무슨 영상인지 메모를 2글자 이상 적어 주세요.</p> : null}
            <Button type="button" variant="outline" className="w-full" onClick={() => input.current?.click()}>다른 영상 고르기</Button>
          </div>
        ) : null}
        {phase.kind === "uploading" ? (
          <div className="space-y-2" aria-live="polite">
            <div className="bg-muted h-3 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="올리는 중">
              <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-foreground text-sm">올리는 중 {percent}% ({mb(phase.sent)} / {mb(phase.file.size)})</p>
            <p className="text-text-dim text-sm break-keep">끝날 때까지 이 화면을 켜 둔 채 기다려 주세요. 화면을 끄거나 다른 앱으로 넘어가면 전송이 멈추고, 이 화면으로 돌아오면 이어서 올립니다.</p>
          </div>
        ) : null}
        {phase.kind === "finishing" ? <p className="text-foreground text-sm" aria-live="polite">거의 다 됐습니다. 확인하는 중…</p> : null}
        {phase.kind === "done" ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-foreground text-base font-bold">제출했습니다. 감사합니다.</p>
            <p className="text-text-dim text-sm break-keep">담당 선생님이 확인할 수 있습니다.</p>
            {/* 숙제를 골라 낸 영상이면 같은 숙제에 마감까지 더 낸다(여러 단원 — 원장 2026-10-21) · 상한에 닿으면 숙제 없이 올리기로. */}
            {props.homeworkDate && sentTotal >= SITE_MAX_VIDEOS_PER_HOMEWORK
              ? <p className="text-text-dim text-sm break-keep">이 숙제에는 영상을 {SITE_MAX_VIDEOS_PER_HOMEWORK}개까지 올릴 수 있습니다. 더 올릴 영상이 있으면 <Link href="/v" prefetch={false} className="text-foreground underline underline-offset-2">처음 화면</Link>에서 &lsquo;숙제 없이 올리기&rsquo;로 올려 주세요.</p>
              : <Button type="button" variant="outline" className="w-full" onClick={() => { setNote(""); setPhase({ kind: "idle" }); }}>
                {props.homeworkDate ? "이 숙제에 영상 더 올리기" : "다른 영상 올리기"}</Button>}
          </div>
        ) : null}
        {!busy && props.otherHomework?.length ? (
          <div className="border-line space-y-2 border-t pt-4">
            <p className="text-foreground text-sm font-bold break-keep">이 반의 다른 영상 숙제</p>
            <ul className="space-y-2">
              {props.otherHomework.map((hw) => (
                <li key={hw.date}>
                  {/* 문서 이동 — 서버가 그 숙제를 다시 확인하고 이 화면을 새로 그린다. 토큰은 같은 링크다. */}
                  <a href={`/v/${props.token}?h=${hw.date}`}
                    className="border-line text-foreground hover:bg-muted block rounded-lg border px-4 py-3 text-base font-bold break-keep">
                    {hw.label} 수업 숙제 올리기
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {phase.kind === "error" ? (
          <div className="space-y-3" role="alert">
            <p className="text-danger text-sm font-bold break-keep">{phase.message}</p>
            {phase.file ? <Button type="button" size="lg" className="w-full" disabled={noteMissing} onClick={() => upload(phase.file!)}>다시 올리기</Button> : null}
            <Button type="button" variant="outline" className="w-full" onClick={() => input.current?.click()}>영상 다시 고르기</Button>
          </div>
        ) : null}
        {uploadNumber ? <details className="border-line border-t pt-3 text-sm">
          <summary className="cursor-pointer">업로드 기록 · 확인번호 {uploadNumber}</summary>
          <p className="text-text-dim mt-2 break-keep">문제가 계속되면 이 번호를 선생님께 알려 주세요. 인터넷에 연결되면 기록을 전송합니다.</p>
          <ol className="mt-2 space-y-1" aria-label="업로드 진행 기록">{uploadLog.map(event => <li key={event.sequence}>
            {Math.floor(event.elapsedMs / 1000)}초 · {uploadEventLabel(event)}{event.kind === "progress" ? ` · ${mb(event.sentBytes)}` : ""}
          </li>)}</ol>
        </details> : null}
      </section>
    </main>
  );
}
