"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud, X } from "@/components/icons/aywa-icon-compat";
import { uploadDocumentFile } from "@/features/documents/upload-file";

type Job = { id: number; file: File; category: string; folder: string; status: "queued" | "uploading" | "done" | "error"; progress: number; error?: string };
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

/** 드롭 시점의 폴더를 고정한다. 업로드 중 탐색 위치를 바꿔도 다른 폴더로 새지 않는다. */
export function DirectFileDrop({ category, folderLabel, dialogOpen, blocked }: {
  category: string; folderLabel: string; dialogOpen: boolean; blocked: boolean;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const nextId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let depth = 0;
    const update = (id: number, patch: Partial<Job>) => {
      if (mounted.current) setJobs((prev) => prev.map((job) => job.id === id ? { ...job, ...patch } : job));
    };
    async function drain() {
      if (running.current) return;
      running.current = true;
      let uploaded = false;
      try {
        while (queue.current.length) {
          const job = queue.current.shift()!;
          update(job.id, { status: "uploading" });
          try {
            await uploadDocumentFile(job.file, job.category, (progress) => update(job.id, { progress }));
            update(job.id, { status: "done", progress: 100 }); uploaded = true;
          } catch (error) { update(job.id, { status: "error", error: error instanceof Error ? error.message : "업로드하지 못했습니다." }); }
        }
      } finally {
        running.current = false;
        if (uploaded && mounted.current) router.refresh();
      }
    }
    const reset = () => { depth = 0; setDragging(false); };
    const enter = (e: DragEvent) => { if (hasFiles(e) && !dialogOpen) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); if (!dialogOpen) e.dataTransfer!.dropEffect = blocked ? "none" : "copy"; } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); reset();
      if (dialogOpen) return;
      if (blocked) { toast.error("파일을 넣을 문서 폴더를 먼저 선택해 주세요."); return; }
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const added: Job[] = files.map((file) => ({ id: ++nextId.current, file, category, folder: folderLabel, status: "queued", progress: 0 }));
      queue.current.push(...added);
      setJobs((prev) => [...prev, ...added]);
      void drain();
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over); window.addEventListener("drop", drop); window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("dragend", reset);
    };
  }, [category, folderLabel, dialogOpen, blocked, router]);

  const busy = jobs.some((job) => job.status === "queued" || job.status === "uploading");
  return <>
    {dragging && !dialogOpen ? <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg-canvas/80 p-6 backdrop-blur-sm">
      <div className="flex max-w-lg flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary/60 bg-primary/5 p-8 text-center text-primary">
        <UploadCloud className="size-9" />
        <p className="text-base font-bold">{blocked ? "문서 폴더를 먼저 선택해 주세요" : "여기에 놓으면 바로 업로드합니다"}</p>
        {!blocked ? <><p className="break-words text-sm">{folderLabel}</p><p className="text-xs text-text-dim">파일 이름 그대로 · 여러 파일 가능 · 파일당 최대 20MB</p></> : null}
      </div>
    </div> : null}
    {jobs.length ? <section aria-label="파일 업로드 진행" className="fixed right-4 bottom-4 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-background p-4 shadow-lg">
      <header className="mb-2 flex items-center justify-between gap-2">
        <p role="status" className="text-sm font-semibold">{busy ? "파일 업로드 중" : "파일 업로드 결과"} · {jobs.filter((job) => job.status === "done").length}/{jobs.length}개 완료</p>
        {!busy ? <button type="button" aria-label="업로드 결과 닫기" onClick={() => setJobs([])}><X className="size-4" /></button> : null}
      </header>
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {jobs.map((job) => <li key={job.id} className="text-xs">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate" title={job.file.name}>{job.file.name}</span>
            <span className={job.status === "error" ? "text-danger" : "text-text-dim"}>{job.status === "done" ? "완료" : job.status === "error" ? "실패" : job.status === "queued" ? "대기" : job.progress === 100 ? "등록 중" : "업로드 중"}</span>
          </div>
          <p className="truncate text-text-faint" title={job.folder}>{job.folder}</p>
          {job.error ? <p role="alert" className="text-danger whitespace-normal">{job.error}</p> : null}
        </li>)}
      </ul>
    </section> : null}
  </>;
}
