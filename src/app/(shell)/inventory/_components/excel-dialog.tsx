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
import type { NewCategoryPlan } from "@/features/inventory/category-plan";
import { importInventoryExcel, type ExcelCounts, type ExcelImportResult, type ExcelPreviewRow } from "@/features/inventory/server/excel-actions";
import { DialogShell, FormError } from "./form-bits";

const EXCEL_URL = "/api/inventory/excel";

/**
 * 엑셀 서식 내려받기 + 작성한 파일 올리기(추가 / 덮어쓰기) — 원장 2026-09-02.
 * 파일을 고르면 **곧바로 미리보기**(아무것도 안 쓴다): 행마다 추가/갱신/건너뜀. 서식이 안 맞으면 경고와 함께 **파일 선택을
 * 취소**한다. [반영]은 미리보기가 오류 없이 나왔을 때만 눌린다. 방식을 바꾸면 미리보기를 다시 뽑는다(판정이 달라진다).
 *
 * 🔑 **새 분류 확인 창**(원장 2026-09-03: *"분류 추가시에 반영 누르면 '확인' 메시지 하나 띄워주는걸로"*) — 이 파일이
 *    만들 분류가 있을 때만 뜬다(없으면 곧바로 반영 — 매번 뜨면 아무도 안 읽는다). 오탈자가 새 분류를 만들기 때문에
 *    이 창이 방어선이다: 무엇이 생기는지와 **비슷한 기존 분류**를 함께 적는다(자동 병합은 안 한다 — 사람이 판단).
 * 🔴 확인은 **화면 장식이 아니다** — 확인한 목록을 서버로 보내고, 서버가 계획을 다시 계산해 같을 때만 통과시킨다([[#77]]).
 */
export function ExcelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExcelMode>("append");
  const [result, setResult] = useState<ExcelImportResult>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, startTransition] = useTransition();

  function run(target: File | null, nextMode: ExcelMode, dryRun: boolean, confirmCategories?: string[]) {
    if (!target) return;
    const fd = new FormData();
    fd.set("file", target);
    fd.set("mode", nextMode);
    fd.set("dryRun", dryRun ? "1" : "");
    if (confirmCategories) fd.set("confirmCategories", JSON.stringify(confirmCategories));
    startTransition(async () => {
      const res = await importInventoryExcel(fd);
      setConfirming(false);
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
    setConfirming(false);
    if (f) run(f, mode, true);
  }
  function changeMode(m: ExcelMode) {
    setMode(m);
    setConfirming(false);
    if (file) run(file, m, true);
  }

  const newCategories = result?.newCategories ?? [];
  /** [반영] — 새 분류가 있으면 확인부터, 없으면 곧바로. */
  function apply() {
    if (newCategories.length > 0) {
      setConfirming(true);
      return;
    }
    run(file, mode, false);
  }

  // 🔑 '다시 확인' 오류는 파일이 아니라 목록이 어긋난 것이라 [반영]을 잠그지 않는다(잠그면 파일을 다시 골라야 한다).
  const canApply =
    !!file && !busy && !!result && (!result.error || !!result.needsReconfirm) && (result.errors?.length ?? 0) === 0 && !result.applied;

  return (
    <DialogShell title="엑셀로 넣기" description="서식을 내려받아 고치거나 새 행을 적은 뒤 올리면 미리보기가 뜨고, [반영]을 누르면 그대로 들어갑니다." onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-xs">
        <section className="border-line flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
          <div>
            <p className="font-bold">1. 서식 내려받기</p>
            <p className="text-text-dim text-xs">현재 자산·소모품이 들어 있는 파일(시트: 자산 · 소모품 · 안내). 분류·상태는 드롭다운.</p>
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
                <span className="text-text-faint text-xs">
                  {m === "append" ? "— 이미 있는 자산ID·품목ID는 건너뛰고 새 행만" : "— 있는 것은 파일 값으로 바꾸고 새 행은 넣기"}
                </span>
              </label>
            ))}
          </div>
          <p className="text-text-faint text-xs">매칭 키 = 자산ID / 품목ID. 오류가 하나라도 있으면 아무것도 바꾸지 않습니다. 대여·실사 이력은 이 파일로 넣지 않습니다.</p>
        </section>

        {busy && !result ? <p className="text-text-dim text-xs">파일을 읽는 중…</p> : null}
        {result?.error ? <FormError error={result.error} /> : null}
        {/* 확인 목록이 어긋난 경우엔 오류와 **함께** 새 미리보기를 남긴다(파일은 그대로라 다시 확인하면 된다). */}
        {result && (!result.error || result.needsReconfirm) && result.preview ? <ResultPanel result={result} /> : null}

        {confirming ? (
          <ConfirmCategories
            plan={newCategories}
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={() => run(file, mode, false, newCategories.map((c) => c.label))}
          />
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
            <Button type="button" disabled={!canApply} onClick={apply}>
              {result?.applied ? "반영됨" : "반영"}
            </Button>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

/**
 * 새 분류 확인 — [반영]을 누르면 이 자리가 버튼 줄을 대신한다(다이얼로그 안 다이얼로그는 포커스가 갇힌다).
 * 🔴 **자동 병합은 하지 않는다** — 비슷한 기존 분류가 있으면 그 사실만 적고 판단은 사람이 한다(오탈자 방어선).
 */
function ConfirmCategories({
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: NewCategoryPlan[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section role="alertdialog" aria-label="새 분류 확인" className="bg-amber-soft rounded-lg px-3 py-2.5 text-xs">
      <p className="font-bold">이 파일에 없던 분류 {plan.length}개가 새로 만들어집니다. 계속할까요?</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {plan.map((c) => (
          <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
            <b className="text-sm">{c.label}</b>
            <span className="text-text-dim">
              자산ID 접두 <span className="font-mono font-bold">{c.codePrefix}</span>
              {c.prefixFromFile ? "(파일에서)" : "(자동)"} · 이 파일 <span className="num">{c.rowCount}</span>행
            </span>
            {c.similarTo ? <span className="text-danger font-bold">기존 &lsquo;{c.similarTo}&rsquo;과(와) 비슷합니다 — 오타가 아닌지 확인하세요</span> : null}
          </li>
        ))}
      </ul>
      <p className="text-text-dim mt-1.5 text-xs">
        분류는 한 번 만들면 화면에서 지우거나 이름을 바꿀 수 없습니다(자산이 연결되기 때문). 오타라면 취소하고 엑셀을 고쳐 주세요.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>취소</Button>
        <Button type="button" onClick={onConfirm} disabled={busy}>확인하고 반영</Button>
      </div>
    </section>
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
      <p className="text-text-dim text-xs font-bold">{title}</p>
      <ul className="border-line mt-1 max-h-56 overflow-y-auto rounded-lg border">
        {shown.map((r) => (
          <li key={`${title}-${r.rowNum}`} className="border-line-faint flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <span className="text-text-faint num w-8 shrink-0 text-right">{r.rowNum}</span>
            <Pill color={toneColor(ACTION_TONE[r.action])}>{ACTION_LABEL[r.action]}</Pill>
            <span className="font-mono font-bold">{r.key}</span>
            <span className="text-text-dim min-w-0 truncate">{r.summary}</span>
          </li>
        ))}
        {rows.length > shown.length ? <li className="text-text-faint px-2 py-1 text-xs">… 외 {rows.length - shown.length}행</li> : null}
      </ul>
    </div>
  );
}

function ResultPanel({ result }: { result: NonNullable<ExcelImportResult> }) {
  const errors = result.errors ?? [];
  const tone = errors.length > 0 ? "bg-danger-soft text-danger" : result.applied ? "bg-green-soft" : "bg-blue-soft";
  return (
    <section className={`rounded-lg px-3 py-2 text-xs ${tone}`}>
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
      {result.newCategories && result.newCategories.length > 0 ? (
        <p className="mt-1.5 font-bold">
          새로 추가될 분류 {result.newCategories.length}개 —{" "}
          {result.newCategories.map((c) => `${c.label}(${c.codePrefix})`).join(" · ")}
          {result.applied ? "" : " · [반영]을 누르면 확인 창이 뜹니다"}
        </p>
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
