"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { toneColor } from "@/lib/design/semantic-color";
import { EXCEL_MODE_LABEL, type ExcelMode } from "@/features/inventory/excel-sheet";
import { importVendorExcel, type VendorExcelPreviewRow, type VendorExcelResult } from "@/features/inventory/server/vendor-excel-actions";
import { DialogShell, FormError } from "./form-bits";

export const VENDOR_EXCEL_URL = "/api/inventory/vendors/excel";

const ACTION_LABEL: Record<VendorExcelPreviewRow["action"], string> = { insert: "추가", update: "갱신", skip: "건너뜀" };
const ACTION_TONE: Record<VendorExcelPreviewRow["action"], "positive" | "info" | "inert"> = { insert: "positive", update: "info", skip: "inert" };

/**
 * 업체리스트 엑셀 가져오기 — 재고 엑셀 창(`excel-dialog`)과 같은 흐름(원장 2026-10-26 *"일괄 등록"*).
 * 파일을 고르면 **곧바로 미리보기**(아무것도 안 쓴다) · 서식이 안 맞으면 파일 선택을 취소 · [반영]은 오류 0건일 때만.
 * 방식(추가/덮어쓰기)을 바꾸면 미리보기를 다시 뽑는다(판정이 달라진다).
 */
export function VendorExcelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExcelMode>("append");
  const [result, setResult] = useState<VendorExcelResult>(undefined);
  const [busy, startTransition] = useTransition();

  function run(target: File | null, nextMode: ExcelMode, dryRun: boolean) {
    if (!target) return;
    const fd = new FormData();
    fd.set("file", target);
    fd.set("mode", nextMode);
    fd.set("dryRun", dryRun ? "1" : "");
    startTransition(async () => {
      const res = await importVendorExcel(fd);
      if (res?.formatMismatch) {
        setFile(null);
        setResult({ error: res.error });
        return;
      }
      setResult(res);
      if (res && !res.error && res.applied) {
        toast.success("업체리스트를 반영했습니다");
        router.refresh();
      }
    });
  }

  const pick = (f: File | null) => {
    setFile(f);
    setResult(undefined);
    if (f) run(f, mode, true);
  };
  const changeMode = (m: ExcelMode) => {
    setMode(m);
    if (file) run(file, m, true);
  };

  const errors = result?.errors ?? [];
  const canApply = !!file && !busy && !!result && !result.error && errors.length === 0 && !result.applied;

  return (
    <DialogShell title="업체리스트 엑셀 가져오기" description="서식을 내려받아 고치거나 새 행을 적은 뒤 올리면 미리보기가 뜨고, [반영]을 누르면 그대로 들어갑니다." onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-xs">
        <section className="border-line flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
          <div>
            <p className="font-bold">1. 서식 내려받기</p>
            <p className="text-text-dim text-xs">지금 업체가 들어 있는 파일(시트: 업체리스트 · 안내).</p>
          </div>
          <a href={VENDOR_EXCEL_URL} download className="text-primary inline-flex items-center gap-1 font-bold hover:underline">
            <EyIcon name="arrowDown" size={14} /> 업체리스트.xlsx
          </a>
        </section>

        <section className="border-line flex flex-col gap-2 rounded-xl border p-3">
          <p className="font-bold">2. 작성한 파일 올리기 — 고르면 바로 미리보기</p>
          <FilePickerButton accept=".xlsx" file={file} onSelect={pick} label="엑셀 파일 선택" disabled={busy} />
          <div className="flex flex-wrap gap-4">
            {(["append", "overwrite"] as ExcelMode[]).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="vendor-mode" value={m} checked={mode === m} onChange={() => changeMode(m)} disabled={busy} />
                <span className="font-medium">{EXCEL_MODE_LABEL[m]}</span>
                <span className="text-text-faint text-xs">
                  {m === "append" ? "— 이미 있는 업체명은 건너뛰고 새 업체만" : "— 있는 업체는 파일 값으로 바꾸고 새 업체는 넣기"}
                </span>
              </label>
            ))}
          </div>
          <p className="text-text-faint text-xs">매칭 키 = 업체명(띄어쓰기 무시). 오류가 하나라도 있으면 아무것도 바꾸지 않습니다.</p>
        </section>

        {busy && !result ? <p className="text-text-dim text-xs">파일을 읽는 중…</p> : null}
        {result?.error ? <FormError error={result.error} /> : null}
        {result && !result.error && result.counts ? (
          <section className={`rounded-lg px-3 py-2 text-xs ${errors.length > 0 ? "bg-danger-soft text-danger" : result.applied ? "bg-green-soft" : "bg-blue-soft"}`}>
            <p className="font-bold">
              {errors.length > 0 ? `오류 ${errors.length}건 — 반영할 수 없습니다(고친 뒤 다시 올려 주세요)` : result.applied ? "반영했습니다" : "미리보기 — 아직 아무것도 바꾸지 않았습니다"}
              {result.mode ? ` · ${EXCEL_MODE_LABEL[result.mode]}` : ""}
            </p>
            <p className="mt-1">
              {result.counts.total}행 — 추가 <span className="num">{result.counts.insert}</span> · 갱신 <span className="num">{result.counts.update}</span> · 건너뜀{" "}
              <span className="num">{result.counts.skip}</span>
            </p>
            {errors.length > 0 ? (
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4">
                {errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}
                {errors.length > 30 ? <li>… 외 {errors.length - 30}건</li> : null}
              </ul>
            ) : null}
            {!result.applied && result.preview && result.preview.length > 0 ? (
              <ul className="border-line bg-card mt-2 max-h-56 overflow-y-auto rounded-lg border text-foreground">
                {result.preview.slice(0, 200).map((r) => (
                  <li key={r.rowNum} className="border-line-faint flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
                    <span className="text-text-faint num w-8 shrink-0 text-right">{r.rowNum}</span>
                    <Pill color={toneColor(ACTION_TONE[r.action])}>{ACTION_LABEL[r.action]}</Pill>
                    <span className="shrink-0 font-bold">{r.key}</span>
                    <span className="text-text-dim min-w-0 truncate">{r.summary}</span>
                  </li>
                ))}
                {result.preview.length > 200 ? <li className="text-text-faint px-2 py-1 text-xs">… 외 {result.preview.length - 200}행</li> : null}
              </ul>
            ) : null}
          </section>
        ) : null}

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
