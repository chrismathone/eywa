"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Sheet, UserMinus, UserPlus, Upload, X } from "lucide-react";
import {
  applyTimetableImport,
  previewSheetImport,
  previewTimetableImport,
  type ApplyState,
} from "@/features/timetable/server/import-actions";
import type { ImportDiff } from "@/features/timetable/import/types";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";

const LARGE_CHANGE = 30;

/**
 * 엑셀 가져오기 — 내보낸 xlsx의 '수강편집' 시트를 수정해 재업로드 → 미리보기 → 적용 = **학생 반이동**.
 * mode="sheet"면 파일 업로드 대신 **연결된 구글 시트의 '수강편집' 탭**을 읽어온다(master 전용).
 * subject = 과목별 시트 분리(math=레거시 provider·english=별도) — 시트 경로 미리보기가 그 과목 시트를 읽는다.
 * label = 트리거 버튼 문구(영어는 '구조 가져오기'와 구분 위해 '학생 반이동' 계열로 지정). diff 적용은 두 모드 공유.
 */
export function TimetableImportDialog({
  mode = "file",
  subject = "math",
  label,
}: {
  mode?: "file" | "sheet";
  subject?: string;
  label?: string;
}) {
  const sheet = mode === "sheet";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyState | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  const total = diff ? diff.moves.length + diff.removes.length + diff.adds.length : 0;
  // 미리보기했으나 아직 적용/닫기 전 = 휘발 위험 상태.
  const pending = open && !!diff && total > 0 && !result;

  // 미적용 미리보기가 있는데 새로고침/이탈 시 경고(ijw useUnsavedChangesGuard 대응).
  useEffect(() => {
    if (!pending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending]);

  function reset() {
    setFile(null);
    setDiff(null);
    setError(null);
    setResult(null);
  }
  function close() {
    // 미리보기한 변경을 적용 안 하고 닫으면 사라짐 → 한 번 더 확인.
    if (pending && !confirm("미리보기한 변경을 아직 적용하지 않았습니다. 닫을까요?")) return;
    setOpen(false);
    reset();
  }

  function preview() {
    setError(null);
    setResult(null);
    setDiff(null);
    if (sheet) {
      startPreview(async () => {
        const res = await previewSheetImport(subject);
        if (res.error) setError(res.error);
        else setDiff(res.diff ?? null);
      });
      return;
    }
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startPreview(async () => {
      const res = await previewTimetableImport(fd);
      if (res.error) setError(res.error);
      else setDiff(res.diff ?? null);
    });
  }

  function apply() {
    if (!diff || total === 0) return;
    const rm = diff.removes.length;
    const warn = diff.warnings.length;
    // 한 번 더 확인 — 대량/삭제/무시 항목이 있으면 무엇이 적용·제외되는지 요약해 물어본다.
    const needConfirm = total >= LARGE_CHANGE || rm >= 10 || warn > 0;
    if (needConfirm) {
      const lines = [`이동 ${diff.moves.length} · 추가 ${diff.adds.length} · 삭제 ${rm}건을 적용합니다.`];
      if (rm > 0) lines.push("· 삭제는 시트/파일에서 빠진 수강을 종료합니다.");
      if (warn > 0) lines.push(`· ${warn}건은 매칭 실패/모호로 무시(미적용)됩니다.`);
      lines.push("진행할까요?");
      if (!confirm(lines.join("\n"))) return;
    }
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
        {sheet ? <Sheet className="size-3" /> : <Upload className="size-3" />}
        {label ?? (sheet ? "시트에서 가져오기" : "가져오기")}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5"
            role="dialog"
            aria-label={sheet ? "구글 시트에서 가져오기" : "엑셀 가져오기"}
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-extrabold">
                {sheet ? "구글 시트에서 가져오기" : "시간표 엑셀 가져오기"}
              </h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>

            {sheet ? (
              <>
                <p className="text-text-dim mt-1 text-[11px]">
                  연결된 구글 시트의 <b>수강편집</b> 탭에서 학생의 <b>반</b>만 바꾼 뒤 불러오세요.
                </p>
                <p className="text-text-faint mt-1 text-[11px]">
                  ⚠️ 시트에서 편집했으면 <b>‘시트 반영’을 다시 누르지 마세요</b> — 전체 덮어쓰기라 편집분이 사라집니다.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={preview}
                    disabled={previewing}
                    className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40"
                  >
                    {previewing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                    시트에서 불러오기
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-text-dim mt-1 text-[11px]">
                  내보낸 엑셀의 <b>수강편집</b> 시트에서 학생의 <b>반</b>만 바꿔 다시 올리세요.
                </p>
                <p className="text-text-faint mt-1 text-[11px]">
                  구글시트로 편집했다면 <b>파일 → 다운로드 → Microsoft Excel(.xlsx)</b>로 받아 올리면 됩니다.
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
              </>
            )}

            {error ? <p className="text-chart-4 mt-3 text-[12px]">{error}</p> : null}

            {diff ? (
              <div className="mt-4 space-y-3 text-[12px]">
                {/* 요약 카운트 — 무엇이 얼마나 바뀌는지 */}
                <div className="flex flex-wrap gap-3 font-mono">
                  <span className="text-primary">이동 {diff.moves.length}</span>
                  <span className="text-blue">추가 {diff.adds.length}</span>
                  <span className="text-amber">삭제 {diff.removes.length}</span>
                  {diff.warnings.length > 0 ? (
                    <span className="text-chart-4">무시 {diff.warnings.length}</span>
                  ) : null}
                </div>

                {/* 변경점 상세 — 카테고리별로 미리 확인 */}
                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {diff.moves.length > 0 ? (
                    <section>
                      <h4 className="text-primary mb-1 flex items-center gap-1 font-semibold">
                        <ArrowRight className="size-3" /> 이동 {diff.moves.length}건
                      </h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {diff.moves.map((m) => (
                          <p key={m.enrollmentId} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{m.studentName}</b> {m.fromClassName}{" "}
                            <span className="text-text-faint">→</span>{" "}
                            <span className="text-primary">{m.toClassName}</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {diff.adds.length > 0 ? (
                    <section>
                      <h4 className="text-blue mb-1 flex items-center gap-1 font-semibold">
                        <UserPlus className="size-3" /> 추가 {diff.adds.length}건
                      </h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {diff.adds.map((a, i) => (
                          <p key={`add-${i}`} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{a.studentName}</b>{" "}
                            <span className="text-text-faint">→</span> <span className="text-blue">{a.className}</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {diff.removes.length > 0 ? (
                    <section>
                      <h4 className="text-amber mb-1 flex items-center gap-1 font-semibold">
                        <UserMinus className="size-3" /> 삭제(수강 종료) {diff.removes.length}건
                      </h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {diff.removes.map((r) => (
                          <p key={r.enrollmentId} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{r.studentName}</b> {r.className}{" "}
                            <span className="text-amber">종료</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>

                {/* 확인 필요 · 적용에서 제외되는 항목 */}
                {diff.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-[11px]">
                    <p className="mb-1 flex items-center gap-1 font-semibold">
                      <AlertTriangle className="size-3" /> 확인 필요 · 적용에서 제외 {diff.warnings.length}건
                    </p>
                    <div className="max-h-24 space-y-0.5 overflow-auto">
                      {diff.warnings.map((w, i) => (
                        <p key={i}>· {w}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {total === 0 ? (
                  <p className="text-text-faint text-[11px]">가져올 변경이 없습니다.</p>
                ) : null}

                <button
                  type="button"
                  onClick={apply}
                  disabled={total === 0 || applying}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold transition disabled:opacity-40"
                >
                  {applying ? <Loader2 className="size-3 animate-spin" /> : null}
                  {total > 0 ? `${total}건 적용` : "변경 없음"}
                </button>
              </div>
            ) : null}

            {result ? (
              result.error ? (
                <p className="text-chart-4 mt-3 text-[12px]">{sanitizeErrorText(result.error)}</p>
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
