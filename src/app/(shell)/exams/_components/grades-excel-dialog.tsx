"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { toneColor } from "@/lib/design/semantic-color";
import {
  importGradesExcel,
  type GradesExcelPreviewRow,
  type GradesExcelResult,
} from "@/features/grades/server/excel-actions";

/**
 * 성적 엑셀 — 지금 보고 있는 명단 그대로 내려받아 점수를 적고 다시 올린다(원장 2026-09-22).
 *
 * 파일을 고르면 **곧바로 미리보기**(아무것도 안 쓴다): 행마다 반영/그대로. 서식이 안 맞으면 경고와 함께
 * **파일 선택을 취소**한다. [반영]은 미리보기가 오류 없이 나왔을 때만 눌린다.
 * 🔴 **어느 칸에 들어가는지는 파일이 말한다**(안내 시트) — 화면에서 고른 학기와 달라도 파일 쪽이 이긴다.
 *    그래서 미리보기 맨 위에 축을 크게 적는다(사람이 확인하는 자리).
 * 🔴 쓰기 권한이 없으면 올리기 구획 자체를 세우지 않는다(서버도 같은 게이트로 막는다 — [[#77]]).
 */
export function GradesExcelDialog({
  excelHref,
  canWrite,
  onClose,
}: {
  excelHref: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<GradesExcelResult>(undefined);
  const [busy, startTransition] = useTransition();

  function run(target: File | null, dryRun: boolean) {
    if (!target) return;
    const fd = new FormData();
    fd.set("file", target);
    fd.set("dryRun", dryRun ? "1" : "");
    startTransition(async () => {
      const res = await importGradesExcel(fd);
      if (res?.formatMismatch) {
        // 서식 불일치 = 업로드 취소(파일을 내려놓는다). 문구는 결과 배너로 남긴다.
        setFile(null);
        setResult({ error: res.error });
        return;
      }
      setResult(res);
      if (res && !res.error && res.applied) {
        toast.success("엑셀 점수를 반영했습니다");
        router.refresh();
      }
    });
  }

  function pick(f: File | null) {
    setFile(f);
    setResult(undefined);
    if (f) run(f, true);
  }

  const canApply = !!file && !busy && !!result && !result.error && (result.errors?.length ?? 0) === 0 && !result.applied;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">엑셀로 넣기</DialogTitle>
          <DialogDescription className="text-xs">
            지금 보고 있는 명단을 받아 점수만 채운 뒤 올리면 미리보기가 뜨고, [반영]을 누르면 그대로 들어갑니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-xs">
          <section className="border-line flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
            <div>
              <p className="font-bold">1. 서식 내려받기</p>
              <p className="text-text-dim text-xs">
                지금 명단·점수가 들어 있는 파일(시트: 성적 · 안내). 학기·과목·시험은 안내 시트에 적혀 있습니다.
              </p>
            </div>
            <a
              href={excelHref}
              download
              className="text-primary inline-flex items-center gap-1 font-bold hover:underline"
            >
              <EyIcon name="arrowDown" size={14} /> 성적.xlsx
            </a>
          </section>

          {canWrite ? (
            <section className="border-line flex flex-col gap-2 rounded-xl border p-3">
              <p className="font-bold">2. 작성한 파일 올리기 — 고르면 바로 미리보기</p>
              <FilePickerButton accept=".xlsx" file={file} onSelect={pick} label="엑셀 파일 선택" disabled={busy} />
              <p className="text-text-faint text-xs">
                매칭 키 = 학생ID(회색 열, 고치지 마세요). 빈 점수 칸은 그대로 둡니다 — 지우기는 화면에서.
                오류가 하나라도 있으면 아무것도 바꾸지 않습니다.
              </p>
            </section>
          ) : (
            <p className="text-text-faint">점수를 올릴 권한이 없습니다 — 내려받기만 됩니다.</p>
          )}

          {busy && !result ? <p className="text-text-dim text-xs">파일을 읽는 중…</p> : null}
          {result?.error ? (
            <p role="alert" className="bg-danger-soft/40 text-danger rounded-lg px-3 py-1.5 text-xs">
              {result.error}
            </p>
          ) : null}
          {result && !result.error && result.counts ? <ResultPanel result={result} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
            {canWrite ? (
              <Button type="button" disabled={!canApply} onClick={() => run(file, false)}>
                {result?.applied ? "반영됨" : "반영"}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Record<GradesExcelPreviewRow["action"], string> = { apply: "반영", keep: "그대로" };
const ACTION_TONE: Record<GradesExcelPreviewRow["action"], "positive" | "inert"> = { apply: "positive", keep: "inert" };

function ResultPanel({ result }: { result: NonNullable<GradesExcelResult> }) {
  const errors = result.errors ?? [];
  // 목록은 잘려 와도 건수는 사실대로(서버가 `errorTotal`을 함께 준다).
  const errorTotal = result.errorTotal ?? errors.length;
  const counts = result.counts!;
  const tone = errorTotal > 0 ? "bg-danger-soft text-danger" : result.applied ? "bg-green-soft" : "bg-blue-soft";
  const preview = result.preview ?? [];
  return (
    <section className={`rounded-lg px-3 py-2 text-xs ${tone}`}>
      {/* 🔴 축은 가장 먼저·굵게 — 이 파일이 어느 칸에 들어가는지 사람이 확인하는 자리다. */}
      {result.axisSummary ? <p className="text-sm font-bold">{result.axisSummary}</p> : null}
      <p className="mt-0.5 font-bold">
        {errorTotal > 0
          ? `오류 ${errorTotal}건 — 반영할 수 없습니다(고친 뒤 다시 올려 주세요)`
          : result.applied
            ? "반영했습니다"
            : "미리보기 — 아직 아무것도 바꾸지 않았습니다"}
      </p>
      <p className="mt-1">
        {counts.total}행 — 반영 <span className="num font-bold">{counts.apply}</span> · 그대로{" "}
        <span className="num">{counts.keep}</span>
      </p>
      {errors.length > 0 ? (
        <ul className="text-danger mt-1 max-h-40 list-disc overflow-y-auto pl-4">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errorTotal > errors.length ? <li>… 외 {errorTotal - errors.length}건</li> : null}
        </ul>
      ) : null}
      {result.notes && result.notes.length > 0 ? (
        <ul className="text-text-dim mt-1 list-disc pl-4">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {!result.applied && preview.length > 0 ? (
        <ul className="border-line mt-2 max-h-56 overflow-y-auto rounded-lg border">
          {preview.map((r) => (
            <li
              key={r.rowNum}
              className="border-line-faint flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0"
            >
              <span className="text-text-faint num w-8 shrink-0 text-right">{r.rowNum}</span>
              <Pill color={toneColor(ACTION_TONE[r.action])}>{ACTION_LABEL[r.action]}</Pill>
              <span className="font-bold">{r.name}</span>
              <span className="text-text-dim shrink-0">{r.className}</span>
              <span className="text-text-dim min-w-0 truncate">{r.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
