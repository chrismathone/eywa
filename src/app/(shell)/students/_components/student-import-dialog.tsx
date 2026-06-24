"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import {
  applyStudentImport,
  previewStudentImport,
  type ImportInsertRow,
  type StudentImportResult,
} from "@/features/students/server/import-actions";
import type { ClassifiedRow, ImportSummary } from "@/features/students/lib/student-import";

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

const KIND_TONE: Record<string, string> = {
  new: "text-primary",
  duplicate: "text-text-faint",
  error: "text-danger",
};

/** 학생 엑셀 일괄등록 — 내보낸(또는 같은 형식의) xlsx 업로드 → 미리보기 → 신규만 등록. */
export function StudentImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ClassifiedRow[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudentImportResult | null>(null);
  const [previewing, startPreview] = useTransition();
  const [importing, startImport] = useTransition();

  function reset() {
    setFile(null);
    setRows(null);
    setSummary(null);
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
    setRows(null);
    const fd = new FormData();
    fd.set("file", file);
    startPreview(async () => {
      const res = await previewStudentImport(fd);
      if (res.error) setError(res.error);
      else {
        setRows(res.rows ?? []);
        setSummary(res.summary ?? null);
      }
    });
  }

  const newRows: ImportInsertRow[] = (rows ?? [])
    .filter((r) => r.kind === "new")
    .map((r) => ({
      name: r.name,
      school: r.school,
      grade: r.grade,
      status: r.status,
      parentPhone: r.parentPhone,
      studentPhone: r.studentPhone,
      englishName: r.englishName,
    }));

  function runImport() {
    if (newRows.length === 0) return;
    startImport(async () => {
      const res = await applyStudentImport(newRows);
      setResult(res);
      if (!res.error) {
        setRows(null);
        setSummary(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <EyIcon name="arrowUp" size={13} />
        엑셀 가져오기
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
            role="dialog"
            aria-label="학생 엑셀 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-extrabold">학생 엑셀 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-[11px]">
              <b>엑셀 내보내기</b>로 받은 파일(또는 같은 형식: 이름·학년·학교·상태·학부모 연락처)을 올리면
              <b> 새 학생만</b> 추가됩니다. 이미 있는 학생은 건너뜁니다.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setRows(null);
                  setResult(null);
                  setError(null);
                }}
                className="text-text-dim flex-1 text-[12px]"
              />
              <button
                type="button"
                onClick={preview}
                disabled={!file || previewing}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {previewing ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                미리보기
              </button>
            </div>

            {error ? <p className="text-danger mt-3 text-[12px]">{error}</p> : null}

            {summary ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <div className="flex gap-3 font-mono text-[12px]">
                  <span className="text-primary">신규 {summary.new}</span>
                  <span className="text-text-faint">중복 {summary.duplicate}</span>
                  <span className="text-danger">오류 {summary.error}</span>
                  <span className="text-text-dim">전체 {summary.total}</span>
                </div>
                <div className="border-line mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-bg-soft text-text-dim sticky top-0">
                      <tr className="[&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium">
                        <th>행</th>
                        <th>이름</th>
                        <th>학년·학교</th>
                        <th>상태</th>
                        <th>구분</th>
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {(rows ?? []).map((r) => (
                        <tr key={r.rowNum}>
                          <td className="text-text-faint px-2 py-1 font-mono">{r.rowNum}</td>
                          <td className="text-foreground px-2 py-1">{r.name || "—"}</td>
                          <td className="text-text-dim px-2 py-1">
                            {r.grade ?? "—"}
                            {r.school ? ` · ${r.school}` : ""}
                          </td>
                          <td className="text-text-dim px-2 py-1">{STATUS_LABEL[r.status] ?? r.status}</td>
                          <td className={`px-2 py-1 font-medium ${KIND_TONE[r.kind]}`}>
                            {r.kind === "new" ? "신규" : r.kind === "duplicate" ? "중복" : "오류"}
                            {r.reason ? <span className="text-text-faint ml-1 font-normal">{r.reason}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={newRows.length === 0 || importing}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold transition disabled:opacity-40"
                >
                  {importing ? <Loader2 className="size-3 animate-spin" /> : null}
                  {newRows.length}명 가져오기
                </button>
              </div>
            ) : null}

            {result ? (
              result.error ? (
                <p className="text-danger mt-3 text-[12px]">{result.error}</p>
              ) : (
                <p className="text-primary mt-3 text-[12px]">
                  등록 완료 — 신규 {result.inserted}
                  {result.skipped ? <span className="text-text-faint"> · 건너뜀 {result.skipped}</span> : null}
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
