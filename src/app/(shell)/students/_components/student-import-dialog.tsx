"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { FilePickerButton } from "@/components/ui/file-picker-button";
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
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-5"
            role="dialog"
            aria-label="학생 엑셀 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-base font-bold">학생 엑셀 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-xs">
              <b>엑셀 내보내기</b>로 받은 파일(또는 같은 형식: 이름·학년·학교·상태·학부모 연락처)을 올리면
              <b> 새 학생만</b> 추가됩니다. 이미 있는 학생은 건너뜁니다.
            </p>

            <label className="text-foreground mt-3 block text-xs font-medium">
              엑셀 파일 <span className="text-danger">*</span>
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <FilePickerButton
                accept=".xlsx"
                file={file}
                onSelect={(f) => {
                  setFile(f);
                  setRows(null);
                  setResult(null);
                  setError(null);
                }}
                label="엑셀 파일 선택"
                className="flex-1"
              />
              <button
                type="button"
                onClick={preview}
                disabled={!file || previewing}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {previewing ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                미리보기
              </button>
            </div>
            {!file ? (
              <p className="text-text-faint mt-1.5 text-xs">엑셀 파일을 선택하면 미리보기가 활성화됩니다.</p>
            ) : null}

            {error ? <p className="text-danger mt-3 text-xs">{error}</p> : null}

            {summary ? (
              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <div className="num flex gap-3 text-xs">
                  <span className="text-primary">신규 {summary.new}</span>
                  <span className="text-text-faint">중복 {summary.duplicate}</span>
                  <span className="text-danger">오류 {summary.error}</span>
                  <span className="text-text-dim">전체 {summary.total}</span>
                </div>
                <div className="border-line mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
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
                          <td className="text-text-faint num px-2 py-1">{r.rowNum}</td>
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
                  className="bg-primary text-primary-foreground hover:bg-primary/85 mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition disabled:opacity-40"
                >
                  {importing ? <Loader2 className="size-3 animate-spin" /> : null}
                  {newRows.length}명 가져오기
                </button>
              </div>
            ) : null}

            {result ? (
              result.error ? (
                <p className="text-danger mt-3 text-xs">{result.error}</p>
              ) : (
                <>
                  <p className="text-primary mt-3 text-xs">
                    등록 완료 — 신규 {result.inserted}
                    {result.skipped ? <span className="text-text-faint"> · 건너뜀 {result.skipped}</span> : null}
                    {result.failed ? <span className="text-amber"> · 실패 {result.failed}</span> : null}
                  </p>
                  {/* 동명이인이라 이름이 바뀐 건 반드시 보여준다 — 조용히 바꾸면 나중에 못 찾는다. */}
                  {result.renamed?.length ? (
                    <div className="border-line bg-bg-soft mt-2 rounded-lg border px-3 py-2 text-xs">
                      <p className="text-foreground font-bold">
                        동명이인이 있어 {result.renamed.length}명은 이름 뒤에 구분자를 붙여 등록했습니다
                      </p>
                      <ul className="text-text-dim mt-1 space-y-0.5">
                        {result.renamed.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <p className="text-text-faint mt-1">
                        같은 학생이 두 번 들어간 것이면 학생 목록에서 정리하세요.
                      </p>
                    </div>
                  ) : null}
                </>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
