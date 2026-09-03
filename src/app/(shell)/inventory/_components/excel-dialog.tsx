"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { toneColor } from "@/lib/design/semantic-color";
import { EXCEL_MODE_LABEL, type ExcelMode } from "@/features/inventory/excel-sheet";
import { importInventoryExcel, type ExcelCounts, type ExcelImportResult, type ExcelPreviewRow } from "@/features/inventory/server/excel-actions";
import { DialogShell, FormError } from "./form-bits";

const EXCEL_URL = "/api/inventory/excel";

/**
 * 엑셀 서식 내려받기 + 작성한 파일 올리기(추가 / 덮어쓰기) — 원장 2026-09-02.
 * 파일을 고르면 **곧바로 미리보기**(아무것도 안 쓴다): 행마다 추가/갱신/건너뜀. 서식이 안 맞으면 경고와 함께 **파일 선택을
 * 취소**한다. [반영]은 미리보기가 오류 없이 나왔을 때만 눌린다. 방식을 바꾸면 미리보기를 다시 뽑는다(판정이 달라진다).
 */
export function ExcelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExcelMode>("append");
  const [result, setResult] = useState<ExcelImportResult>(undefined);
  const [busy, startTransition] = useTransition();

  function run(target: File | null, nextMode: ExcelMode, dryRun: boolean) {
    if (!target) return;
    const fd = new FormData();
    fd.set("file", target);
    fd.set("mode", nextMode);
    fd.set("dryRun", dryRun ? "1" : "");
    startTransition(async () => {
      const res = await importInventoryExcel(fd);
      if (res?.formatMismatch) {
        // 서식 불일치 = 업로드 취소(파일을 내려놓는다). 문구는 결과 배너로 남긴다.
        setFile(null);
        setResult({ error: res.error });
        return;
      }
      setResult(res);
      if (res && !res.error && res.applied) {
        toast.success("엑셀 내용을 반영했습니다");
        router.refresh();
      }
    });
  }

  function pick(f: File | null) {
    setFile(f);
    setResult(undefined);
    if (f) run(f, mode, true);
  }
  function changeMode(m: ExcelMode) {
    setMode(m);
    if (file) run(file, m, true);
  }

  const canApply = !!file && !busy && !!result && !result.error && (result.errors?.length ?? 0) === 0 && !result.applied;

  return (
    <DialogShell title="엑셀로 넣기" description="서식을 내려받아 고치거나 새 행을 적은 뒤 올리면 미리보기가 뜨고, [반영]을 누르면 그대로 들어갑니다." onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[12.5px]">
        <section className="border-line flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
          <div>
            <p className="font-bold">1. 서식 내려받기</p>
            <p className="text-text-dim text-[11.5px]">현재 자산·소모품이 들어 있는 파일(시트: 자산 · 소모품 · 안내). 분류·상태는 드롭다운.</p>
          </div>
          <a href={EXCEL_URL} download className="text-primary inline-flex items-center gap-1 font-bold hover:underline">
            <EyIcon name="arrowDown" size={14} /> 재고관리.xlsx
          </a>
        </section>

        <section className="border-line flex flex-col gap-2 rounded-xl border p-3">
          <p className="font-bold">2. 작성한 파일 올리기 — 고르면 바로 미리보기</p>
          <FilePickerButton accept=".xlsx" file={file} onSelect={pick} label="엑셀 파일 선택" disabled={busy} />
          <div className="flex flex-wrap gap-4">
            {(["append", "overwrite"] as ExcelMode[]).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => changeMode(m)} disabled={busy} />
                <span className="font-medium">{EXCEL_MODE_LABEL[m]}</span>
                <span className="text-text-faint text-[11.5px]">
                  {m === "append" ? "— 이미 있는 자산ID·품목ID는 건너뛰고 새 행만" : "— 있는 것은 파일 값으로 바꾸고 새 행은 넣기"}
                </span>
              </label>
            ))}
          </div>
          <p className="text-text-faint text-[11px]">매칭 키 = 자산ID / 품목ID. 오류가 하나라도 있으면 아무것도 바꾸지 않습니다. 대여·실사 이력은 이 파일로 넣지 않습니다.</p>
        </section>

        {busy && !result ? <p className="text-text-dim text-[12px]">파일을 읽는 중…</p> : null}
        {result?.error ? <FormError error={result.error} /> : null}
        {result && !result.error ? <ResultPanel result={result} /> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          <Button type="button" disabled={!canApply} onClick={() => run(file, mode, false)}>
            {result?.applied ? "반영됨" : "반영"}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

function CountLine({ label, c }: { label: string; c: ExcelCounts | undefined }) {
  if (!c || c.total === 0) return null;
  return (
    <li>
      <b>{label}</b> {c.total}행 — 추가 <span className="num">{c.insert}</span> · 갱신 <span className="num">{c.update}</span> · 건너뜀{" "}
      <span className="num">{c.skip}</span>
    </li>
  );
}

const ACTION_LABEL: Record<ExcelPreviewRow["action"], string> = { insert: "추가", update: "갱신", skip: "건너뜀" };
const ACTION_TONE: Record<ExcelPreviewRow["action"], "positive" | "info" | "inert"> = { insert: "positive", update: "info", skip: "inert" };

function PreviewList({ title, rows }: { title: string; rows: ExcelPreviewRow[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 200);
  return (
    <div className="mt-2">
      <p className="text-text-dim text-[11.5px] font-bold">{title}</p>
      <ul className="border-line mt-1 max-h-56 overflow-y-auto rounded-lg border">
        {shown.map((r) => (
          <li key={`${title}-${r.rowNum}`} className="border-line-faint flex items-center gap-2 border-b px-2 py-1 text-[12px] last:border-b-0">
            <span className="text-text-faint num w-8 shrink-0 text-right">{r.rowNum}</span>
            <Pill color={toneColor(ACTION_TONE[r.action])}>{ACTION_LABEL[r.action]}</Pill>
            <span className="font-mono font-bold">{r.key}</span>
            <span className="text-text-dim min-w-0 truncate">{r.summary}</span>
          </li>
        ))}
        {rows.length > shown.length ? <li className="text-text-faint px-2 py-1 text-[11.5px]">… 외 {rows.length - shown.length}행</li> : null}
      </ul>
    </div>
  );
}

function ResultPanel({ result }: { result: NonNullable<ExcelImportResult> }) {
  const errors = result.errors ?? [];
  const tone = errors.length > 0 ? "border-danger bg-danger-soft/40" : result.applied ? "border-green bg-green-soft/40" : "border-blue bg-blue-soft/40";
  return (
    <section className={`rounded-lg border-l-[3px] px-3 py-2 text-[12px] ${tone}`}>
      <p className="font-bold">
        {errors.length > 0 ? `오류 ${errors.length}건 — 반영할 수 없습니다(고친 뒤 다시 올려 주세요)` : result.applied ? "반영했습니다" : "미리보기 — 아직 아무것도 바꾸지 않았습니다"}
        {result.mode ? ` · ${EXCEL_MODE_LABEL[result.mode]}` : ""}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        <CountLine label="자산" c={result.assets} />
        <CountLine label="소모품" c={result.supplies} />
      </ul>
      {errors.length > 0 ? (
        <ul className="text-danger mt-1 max-h-40 list-disc overflow-y-auto pl-4">
          {errors.slice(0, 30).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.length > 30 ? <li>… 외 {errors.length - 30}건</li> : null}
        </ul>
      ) : null}
      {result.notes && result.notes.length > 0 ? (
        <ul className="text-text-dim mt-1 list-disc pl-4">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {!result.applied && result.preview ? (
        <>
          <PreviewList title="자산" rows={result.preview.assets} />
          <PreviewList title="소모품" rows={result.preview.supplies} />
        </>
      ) : null}
    </section>
  );
}
