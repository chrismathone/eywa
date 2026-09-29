"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { toneColor } from "@/lib/design/semantic-color";
import { IMPORT_META, type ImportKind } from "@/features/excel-import/kinds";
import { EXCEL_MODE_LABEL, type ExcelMode, type ImportIssue, type ImportPreviewRow, type ImportResult } from "@/features/excel-import/spec";

/**
 * 엑셀로 넣기 — 모든 탭이 같은 창을 쓴다(재고관리 창을 공용화, 원장 2026-09-29).
 * ① 서식 내려받기 ② 방식(추가 / 덮어쓰기) ③ 파일 고르면 곧바로 미리보기(아무것도 안 씀) ④ [반영].
 * 🔑 **오류는 위치 표로** — 시트 · 행 · 열 · 적은 값 · 문제. [오류 칸 표시 파일]은 올린 파일의 틀린 칸을 빨갛게 칠해 돌려준다.
 * 🔑 방식을 바꾸면 미리보기를 다시 뽑는다(추가/갱신/건너뜀 판정이 달라진다).
 */
export function ExcelImportDialog({ kind, open, onOpenChange }: { kind: ImportKind; open: boolean; onOpenChange: (open: boolean) => void }) {
  const meta = IMPORT_META[kind];
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExcelMode>("append");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/excel-import/${kind}`;

  async function post(target: File, m: ExcelMode, opts: { dryRun?: boolean; annotate?: boolean }) {
    const fd = new FormData();
    fd.set("file", target);
    fd.set("mode", m);
    if (opts.dryRun) fd.set("dryRun", "1");
    if (opts.annotate) fd.set("annotate", "1");
    return fetch(url, { method: "POST", body: fd });
  }

  async function run(target: File | null, m: ExcelMode, dryRun: boolean) {
    if (!target) return;
    setBusy(true);
    try {
      const res = await post(target, m, { dryRun });
      const body = (await res.json().catch(() => ({ error: `서버 오류(${res.status})` }))) as ImportResult;
      setResult(body);
      if (body.applied) {
        toast.success(`${meta.title} 엑셀을 반영했습니다`);
        router.refresh();
      }
    } catch {
      setResult({ error: "올리지 못했습니다 — 연결을 확인하고 다시 시도하세요" });
    } finally {
      setBusy(false);
    }
  }

  async function downloadAnnotated() {
    if (!file) return;
    setBusy(true);
    try {
      const res = await post(file, mode, { annotate: true });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${meta.title}_오류표시.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      toast.error("오류 표시 파일을 만들지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  function pick(f: File | null) {
    setFile(f);
    setResult(null);
    if (f) void run(f, mode, true);
  }
  function changeMode(m: ExcelMode) {
    setMode(m);
    if (file) void run(file, m, true);
  }
  function close(next: boolean) {
    if (!next) {
      setFile(null);
      setResult(null);
      setMode("append");
    }
    onOpenChange(next);
  }

  const issues = result?.issues ?? [];
  const canApply = !!file && !busy && !!result && !result.formatMismatch && issues.length === 0 && !result.applied && !result.error;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{meta.title} 엑셀로 넣기</DialogTitle>
          <DialogDescription className="text-xs">
            서식을 내려받아 고치거나 새 행을 적은 뒤 올리면 미리보기가 뜨고, [반영]을 누르면 그대로 들어갑니다. 검사에서 오류가 하나라도 나오면 아무것도 넣지 않습니다(반영 도중 서버 오류로 멈추면 그 앞까지는 남고, 몇 줄인지 알려 드립니다 — 같은 파일을 같은 방식으로 다시 올리면 이미 들어간 줄은 건너뛰고 나머지만 들어갑니다).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs">
          <section className="border-line flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
            <div className="min-w-0">
              <p className="font-bold">1. 서식 내려받기</p>
              <p className="text-text-dim">{meta.templateNote}</p>
            </div>
            <a href={url} download className="text-primary inline-flex items-center gap-1 font-bold hover:underline">
              <EyIcon name="download" size={14} /> {meta.title}_서식.xlsx
            </a>
          </section>

          <section className="border-line flex flex-col gap-2 rounded-xl border p-3">
            <p className="font-bold">2. 반영 방식</p>
            <div className="flex flex-col gap-1.5">
              {(["append", "overwrite"] as ExcelMode[]).map((m) => (
                <label key={m} className="flex items-start gap-1.5">
                  <input type="radio" name={`excel-mode-${kind}`} value={m} checked={mode === m} onChange={() => changeMode(m)} disabled={busy} className="mt-0.5" />
                  <span>
                    <b>{EXCEL_MODE_LABEL[m]}</b> <span className="text-text-dim">— {meta.modeHelp[m]}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-text-faint">같은 것인지 가리는 기준(매칭 키): {meta.keyHint}</p>
          </section>

          <section className="border-line flex flex-col gap-2 rounded-xl border p-3">
            <p className="font-bold">3. 작성한 파일 올리기 — 고르면 바로 미리보기</p>
            <FilePickerButton accept=".xlsx" file={file} onSelect={pick} label="엑셀 파일 선택" disabled={busy} />
          </section>

          {busy ? <p className="text-text-dim">파일을 확인하는 중…</p> : null}
          {result ? <ResultPanel result={result} onAnnotate={file && issues.length > 0 ? downloadAnnotated : null} busy={busy} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              닫기
            </Button>
            <Button type="button" disabled={!canApply} onClick={() => void run(file, mode, false)}>
              {result?.applied ? "반영됨" : `${EXCEL_MODE_LABEL[mode]}로 반영`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Record<ImportPreviewRow["action"], string> = { insert: "추가", update: "갱신", skip: "건너뜀" };
const ACTION_TONE: Record<ImportPreviewRow["action"], "positive" | "info" | "inert"> = { insert: "positive", update: "info", skip: "inert" };

function ResultPanel({ result, onAnnotate, busy }: { result: ImportResult; onAnnotate: (() => void) | null; busy: boolean }) {
  const issues = result.issues ?? [];
  const total = result.issueTotal ?? issues.length;
  const tone = result.error || issues.length ? "bg-danger-soft" : result.applied ? "bg-green-soft" : "bg-blue-soft";
  return (
    <section className={`flex flex-col gap-2 rounded-lg px-3 py-2 ${tone}`}>
      {result.error ? (
        <p role="alert" className="text-danger font-bold">
          {result.error}
        </p>
      ) : (
        <p className="font-bold">
          {issues.length
            ? `오류 ${total}건 — 반영할 수 없습니다(아래 위치를 고친 뒤 다시 올려 주세요)`
            : result.applied
              ? "반영했습니다"
              : "미리보기 — 아직 아무것도 바꾸지 않았습니다"}
          {result.mode ? ` · ${EXCEL_MODE_LABEL[result.mode]}` : ""}
        </p>
      )}
      {result.counts?.length ? (
        <ul className="flex flex-col gap-0.5">
          {result.counts
            .filter((c) => c.total > 0)
            .map((c) => (
              <li key={c.label}>
                <b>{c.label}</b> {c.total}행 — 추가 <span className="num">{c.insert}</span> · 갱신 <span className="num">{c.update}</span> · 건너뜀{" "}
                <span className="num">{c.skip}</span>
              </li>
            ))}
        </ul>
      ) : null}
      {issues.length ? <IssueTable issues={issues} total={total} onAnnotate={onAnnotate} busy={busy} /> : null}
      {result.notes?.length ? (
        <ul className="text-text-dim list-disc pl-4">
          {result.notes.slice(0, 30).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {!result.applied && !issues.length && result.preview?.length ? <PreviewList rows={result.preview} /> : null}
    </section>
  );
}

/** 오류 위치 표 — 원장 *"어디서 업로드 에러가 나는지도 확인가능하게"*. */
function IssueTable({ issues, total, onAnnotate, busy }: { issues: ImportIssue[]; total: number; onAnnotate: (() => void) | null; busy: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-line max-h-72 overflow-auto rounded-lg border bg-white">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-bg-soft sticky top-0">
            <tr>
              <th className="px-2 py-1 text-center">시트</th>
              <th className="px-2 py-1 text-center">행</th>
              <th className="px-2 py-1 text-center">열</th>
              <th className="px-2 py-1 text-left">적은 값</th>
              <th className="px-2 py-1 text-left">문제</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i, n) => (
              <tr key={`${i.sheet}-${i.row}-${i.col}-${n}`} className="border-line-faint border-t align-top">
                <td className="px-2 py-1 text-center whitespace-nowrap">{i.sheet}</td>
                <td className="num px-2 py-1 text-center">{i.row ?? "—"}</td>
                <td className="px-2 py-1 text-center whitespace-nowrap">{i.col ? `${i.col}${i.header ? ` (${i.header})` : ""}` : "—"}</td>
                <td className="max-w-40 truncate px-2 py-1" title={i.value ?? ""}>
                  {i.value ?? ""}
                </td>
                <td className="text-danger px-2 py-1">{i.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-dim">{total > issues.length ? `처음 ${issues.length}건만 보입니다(전체 ${total}건) — 전체는 오류 표시 파일에서` : ""}</span>
        {onAnnotate ? (
          <Button type="button" variant="outline" size="sm" onClick={onAnnotate} disabled={busy}>
            <EyIcon name="download" size={14} /> 오류 칸 표시 파일 받기
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PreviewList({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <ul className="border-line max-h-64 overflow-y-auto rounded-lg border bg-white">
      {rows.map((r) => (
        <li key={`${r.sheet}-${r.rowNum}`} className="border-line-faint flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
          <span className="text-text-faint shrink-0 whitespace-nowrap">
            {r.sheet} <span className="num">{r.rowNum}</span>행
          </span>
          <Pill color={toneColor(ACTION_TONE[r.action])}>{ACTION_LABEL[r.action]}</Pill>
          <span className="shrink-0 font-bold">{r.key}</span>
          <span className="text-text-dim min-w-0 truncate">{r.summary}</span>
        </li>
      ))}
    </ul>
  );
}
