"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkVideoFile } from "@/features/video-submit/rules";
import { runResumableUpload, UploadError, xhrPut } from "@/features/video-submit/upload-client";

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
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [recovered, setRecovered] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // 지난번에 못 알린 업로드가 이 기기에 남아 있으면 대신 알린다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const uploadId of readPending(props.token)) {
        const done = await postJson("/api/video-submit/complete", { token: props.token, uploadId });
        if (settled(done)) writePending(props.token, readPending(props.token).filter((id) => id !== uploadId));
        if (done?.ok && alive) setRecovered(true);
      }
    })();
    return () => { alive = false; };
  }, [props.token]);
  const busy = phase.kind === "uploading" || phase.kind === "finishing";

  // 올리는 중에 창을 닫으려 하면 한 번 붙잡는다(폰은 무시할 수 있다 — 그래서 화면에도 적는다).
  useEffect(() => {
    if (!busy) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [busy]);

  function pick(file: File | undefined) {
    if (!file) return;
    const check = checkVideoFile(file);
    setPhase(check.ok ? { kind: "picked", file } : { kind: "error", message: check.error, file: null });
  }

  async function upload(file: File) {
    setPhase({ kind: "uploading", file, sent: 0 });
    const started = await postJson("/api/video-submit/start", { token: props.token, name: file.name, size: file.size, type: file.type });
    if (!started?.ok || typeof started.sessionUrl !== "string" || typeof started.uploadId !== "string") {
      const message = typeof started?.error === "string" ? started.error : "연결을 확인하고 다시 시도해 주세요.";
      if (started?.code === "expired") window.location.reload(); // 그사이 만료 — 페이지가 만료 화면으로 보낸다
      setPhase({ kind: "error", message, file });
      return;
    }
    writePending(props.token, [...readPending(props.token), started.uploadId]);
    try {
      await runResumableUpload({
        size: file.size, slice: (start, end) => file.slice(start, end), put: xhrPut(started.sessionUrl),
        onProgress: (sent) => setPhase({ kind: "uploading", file, sent }),
      });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof UploadError ? error.message : "영상을 올리지 못했습니다. 다시 올려 주세요.", file });
      return;
    }
    setPhase({ kind: "finishing" });
    // Drive가 마지막 조각을 반영하는 데 잠깐 걸릴 수 있다 — '아직'이면 몇 번 더 묻는다.
    for (let attempt = 0; attempt < 5; attempt++) {
      const done = await postJson("/api/video-submit/complete", { token: props.token, uploadId: started.uploadId });
      if (settled(done)) writePending(props.token, readPending(props.token).filter((id) => id !== started.uploadId));
      if (done?.ok) return setPhase({ kind: "done" });
      if (done && settled(done))
        return setPhase({ kind: "error", message: typeof done.error === "string" ? done.error : "올린 영상을 확인하지 못했습니다.", file: null });
      await sleep(1500 * (attempt + 1));
    }
    setPhase({ kind: "error", message: "올린 영상을 확인하지 못했습니다. 잠시 후 다시 올려 주세요.", file });
  }

  const percent = phase.kind === "uploading" ? Math.floor((phase.sent / Math.max(1, phase.file.size)) * 100) : 0;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pt-8 pb-8 lg:pb-10">
      <header className="space-y-1">
        <p className="text-text-dim text-sm">{props.academyName}</p>
        <h1 className="text-foreground text-2xl font-bold">숙제 영상 제출</h1>
        <p className="text-foreground text-base break-keep">{props.studentLabel} 학생 · {props.className}</p>
      </header>
      {recovered ? <p className="text-foreground text-sm break-keep" aria-live="polite">지난번에 올린 영상도 제출됐습니다.</p> : null}
      <section className="bg-card border-line relative space-y-4 rounded-2xl border p-5">
        <ul className="text-text-dim space-y-1 text-sm break-keep">
          <li>영상 한 개에 {props.maxLabel}까지 올릴 수 있습니다.</li>
          <li>{props.lastDayLabel}까지 쓸 수 있는 링크입니다.</li>
          <li>올린 영상은 담당 선생님만 봅니다.</li>
        </ul>
        <input ref={input} type="file" accept="video/*" className="sr-only" aria-label="영상 고르기"
          onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
        {phase.kind === "idle" ? (
          <Button type="button" size="lg" className="w-full" onClick={() => input.current?.click()}>영상 고르기</Button>
        ) : null}
        {phase.kind === "picked" ? (
          <div className="space-y-3">
            <p className="text-foreground text-sm break-all">{phase.file.name} · {mb(phase.file.size)}</p>
            <Button type="button" size="lg" className="w-full" onClick={() => upload(phase.file)}>올리기</Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => input.current?.click()}>다른 영상 고르기</Button>
          </div>
        ) : null}
        {phase.kind === "uploading" ? (
          <div className="space-y-2" aria-live="polite">
            <div className="bg-muted h-3 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="올리는 중">
              <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-foreground text-sm">올리는 중 {percent}% ({mb(phase.sent)} / {mb(phase.file.size)})</p>
            <p className="text-text-dim text-sm break-keep">끝날 때까지 이 화면을 닫지 말아 주세요. 잠깐 끊기면 이어서 올립니다.</p>
          </div>
        ) : null}
        {phase.kind === "finishing" ? <p className="text-foreground text-sm" aria-live="polite">거의 다 됐습니다. 확인하는 중…</p> : null}
        {phase.kind === "done" ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-foreground text-base font-bold">제출했습니다. 감사합니다.</p>
            <p className="text-text-dim text-sm break-keep">담당 선생님이 확인할 수 있습니다.</p>
            <Button type="button" variant="outline" className="w-full" onClick={() => setPhase({ kind: "idle" })}>다른 영상 올리기</Button>
          </div>
        ) : null}
        {phase.kind === "error" ? (
          <div className="space-y-3" role="alert">
            <p className="text-danger text-sm font-bold break-keep">{phase.message}</p>
            {phase.file ? <Button type="button" size="lg" className="w-full" onClick={() => upload(phase.file!)}>다시 올리기</Button> : null}
            <Button type="button" variant="outline" className="w-full" onClick={() => input.current?.click()}>영상 다시 고르기</Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
