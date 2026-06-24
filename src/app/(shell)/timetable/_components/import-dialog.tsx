"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import {
  applyTimetableImport,
  previewTimetableImport,
  type ApplyState,
} from "@/features/timetable/server/import-actions";
import type { ImportDiff } from "@/features/timetable/import/types";

const LARGE_CHANGE = 30;

/** 엑셀 가져오기 — 내보낸 xlsx의 '수강편집' 시트를 수정해 재업로드 → 미리보기 → 적용. */
export function TimetableImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyState | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  function reset() {
    setFile(null);
    setDiff(null);
    setError(null);
    setResult(null);
  }
  function close() {
    setOpen(false);
    reset();
  }

  function preview() {
    if (!file) return;
    setError(null);
    setResult(null);
    setDiff(null);
    const fd = new FormData();
    fd.set("file", file);
    startPreview(async () => {
      const res = await previewTimetableImport(fd);
      if (res.error) setError(res.error);
      else setDiff(res.diff ?? null);
    });
  }

  const total = diff ? diff.moves.length + diff.removes.length + diff.adds.length : 0;

  function apply() {
    if (!diff || total === 0) return;
    if (total >= LARGE_CHANGE && !confirm(`${total}건의 대량 변경입니다. 적용할까요?`)) return;
    startApply(async () => {
      const res = await applyTimetableImport(diff);
      setResult(res);
      if (!res.error) {
        setDiff(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <Upload className="size-3" />
        가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5"
            role="dialog"
            aria-label="엑셀 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-extrabold">시간표 엑셀 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-[11px]">
              내보낸 엑셀의 <b>수강편집</b> 시트에서 학생의 <b>반</b>만 바꿔 다시 올리세요. (enrollmentId 열은 수정 금지)
            </p>

            <label className="text-foreground mt-3 block text-[12px] font-medium">
              엑셀 파일 <span className="text-danger">*</span>
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setDiff(null);
                  setResult(null);
                }}
                className="text-text-dim flex-1 text-[12px]"
              />
              <button
                type="button"
                onClick={preview}
                disabled={!file || previewing}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {previewing ? <Loader2 className="size-3 animate-spin" /> : null}
                미리보기
              </button>
            </div>
            {!file ? (
              <p className="text-text-faint mt-1.5 text-[11px]">엑셀 파일을 선택하면 미리보기가 활성화됩니다.</p>
            ) : null}

            {error ? <p className="text-chart-4 mt-3 text-[12px]">{error}</p> : null}

            {diff ? (
              <div className="mt-4 space-y-2 text-[12px]">
                <div className="flex gap-3 font-mono">
                  <span className="text-primary">이동 {diff.moves.length}</span>
                  <span className="text-amber">삭제 {diff.removes.length}</span>
                  <span className="text-blue">추가 {diff.adds.length}</span>
                  <span className="text-text-faint">변경없음 {diff.unchanged}</span>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {diff.moves.map((m) => (
                    <p key={m.enrollmentId} className="text-text-dim">
                      <b>{m.studentName}</b> {m.fromClassName} → <span className="text-primary">{m.toClassName}</span>
                    </p>
                  ))}
                  {diff.removes.map((r) => (
                    <p key={r.enrollmentId} className="text-text-dim">
                      <b>{r.studentName}</b> {r.className} <span className="text-amber">삭제</span>
                    </p>
                  ))}
                  {diff.adds.map((a, i) => (
                    <p key={`add-${i}`} className="text-text-dim">
                      <b>{a.studentName}</b> → <span className="text-blue">{a.className} 추가</span>
                    </p>
                  ))}
                </div>
                {diff.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-[11px]">
                    {diff.warnings.map((w, i) => (
                      <p key={i}>⚠ {w}</p>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={apply}
                  disabled={total === 0 || applying}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold transition disabled:opacity-40"
                >
                  {applying ? <Loader2 className="size-3 animate-spin" /> : null}
                  {total}건 적용
                </button>
              </div>
            ) : null}

            {result ? (
              result.error ? (
                <p className="text-chart-4 mt-3 text-[12px]">{result.error}</p>
              ) : (
                <p className="text-primary mt-3 text-[12px]">
                  적용 완료 — 이동 {result.applied?.moved} · 삭제 {result.applied?.removed} · 추가{" "}
                  {result.applied?.added}
                  {result.failed ? <span className="text-amber"> · 실패 {result.failed}</span> : null}
                </p>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
