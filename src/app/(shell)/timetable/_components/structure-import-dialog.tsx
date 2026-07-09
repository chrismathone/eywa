"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Sheet, X } from "lucide-react";
import {
  applyStructureImport,
  previewStructureImport,
  rollbackStructureImport,
} from "@/features/timetable/server/structure-import-actions";
import type { DryRunReport, SchedulePlanItem } from "@/features/timetable/import/structure/types";

const KO_DAY: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const dayT = (p: SchedulePlanItem) => `${KO_DAY[p.day] ?? p.day} ${p.startTime}${p.endTime ? `~${p.endTime}` : ""}`;
const tch = (names: string[]) => (names.length ? names.join(", ") : "—");

/**
 * 강사별 그리드 시트 → class_schedules 구조 **미리보기**(Phase 1 = 읽기전용, 적용 없음).
 * 편집한 강사별 시트가 eywa 배치를 어떻게 바꿀지 화면에서 검증한다. master 전용.
 */
export function StructureImportDialog({ subject }: { subject: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  // 적용/롤백 상태
  const [confirming, setConfirming] = useState(false); // 2단계 확인(오적용 방지)
  const [applying, startApply] = useTransition();
  const [applied, setApplied] = useState<{ closed: number; inserted: number; classUpdated: number } | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [rolling, startRollback] = useTransition();
  const [reverted, setReverted] = useState<string | null>(null);

  function resetResult() {
    setConfirming(false);
    setApplied(null);
    setSnapshotId(null);
    setReverted(null);
  }
  function preview() {
    setError(null);
    setReport(null);
    resetResult();
    startPreview(async () => {
      const res = await previewStructureImport(subject);
      if (res.error) setError(res.error);
      else setReport(res.report ?? null);
    });
  }
  function apply() {
    if (!report) return;
    setError(null);
    startApply(async () => {
      const res = await applyStructureImport(report.hash, subject);
      if (res.error) {
        setError(res.error);
        // 스테일(시트/시간표 변경) — 미리보기 무효화, 재미리보기 유도.
        if (res.staleHash) setReport(null);
        setConfirming(false);
      } else if (res.noop) {
        setError("변경 사항이 없습니다(모두 최신).");
        setConfirming(false);
      } else {
        setApplied(res.applied ?? null);
        setSnapshotId(res.snapshotId ?? null);
        setConfirming(false);
      }
    });
  }
  function rollback() {
    if (!snapshotId) return;
    setError(null);
    startRollback(async () => {
      const res = await rollbackStructureImport(snapshotId);
      if (res.error) setError(res.error);
      else {
        setReverted(
          `되돌리기 완료: 삭제 ${res.reverted?.deleted ?? 0} · 복원 ${res.reverted?.restored ?? 0} · 반 ${res.reverted?.classReverted ?? 0}`,
        );
        setSnapshotId(null);
        setApplied(null);
      }
    });
  }
  function close() {
    setOpen(false);
    setReport(null);
    setError(null);
    resetResult();
  }

  const creates = report?.planItems.filter((p) => p.action === "create") ?? [];
  const updates = report?.planItems.filter((p) => p.action === "update") ?? [];
  const removes = report?.planItems.filter((p) => p.action === "remove") ?? [];
  const changeCount = creates.length + updates.length + removes.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <Sheet className="size-3" /> 시트에서 가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5"
            role="dialog"
            aria-label="시트에서 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-extrabold">시트에서 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>

            <p className="text-text-dim mt-1 text-[11px]">
              연결된 구글 시트의 <b>강사별영어시간표</b> 탭을 편집한 뒤 불러오면, 수업·요일·시각·방·강사 배치가
              어떻게 바뀔지 미리 봅니다.
            </p>
            <p className="text-text-faint mt-1 text-[11px]">
              ⚠️ 편집했으면 <b>‘시트 반영’을 다시 누르지 마세요</b>(전체 덮어쓰기라 편집분이 사라집니다).
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

            {error ? <p className="text-chart-4 mt-3 text-[12px]">{error}</p> : null}

            {report ? (
              <div className="mt-4 space-y-3 text-[12px]">
                <div className="flex flex-wrap gap-3 font-mono">
                  <span className="text-blue">생성 {report.plan.create}</span>
                  <span className="text-primary">변경 {report.plan.update}</span>
                  <span className="text-amber">제거 {report.plan.remove}</span>
                  <span className="text-text-faint">유지 {report.plan.keep}</span>
                </div>

                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {creates.length > 0 ? (
                    <section>
                      <h4 className="text-blue mb-1 font-semibold">추가 {creates.length}건</h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {creates.map((p, i) => (
                          <p key={`c${i}`} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{p.className}</b> {dayT(p)} · {tch(p.teacherNames)}
                            {p.room ? ` · ${p.room}` : ""}
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {updates.length > 0 ? (
                    <section>
                      <h4 className="text-primary mb-1 font-semibold">변경 {updates.length}건</h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {updates.map((p, i) => (
                          <p key={`u${i}`} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{p.className}</b> {KO_DAY[p.day] ?? p.day} {p.startTime}{" "}
                            <span className="text-text-faint">
                              [{p.before?.teacherNames?.join(",") || "—"}/{p.before?.room ?? "—"}/{p.before?.endTime ?? "—"}]
                            </span>
                            <span className="text-primary"> → [{tch(p.teacherNames)}/{p.room ?? "—"}/{p.endTime ?? "—"}]</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {removes.length > 0 ? (
                    <section>
                      <h4 className="text-amber mb-1 font-semibold">제거(스케줄 종료) {removes.length}건</h4>
                      <div className="border-line divide-line divide-y rounded-sm border">
                        {removes.map((p, i) => (
                          <p key={`r${i}`} className="text-text-dim px-2 py-1">
                            <b className="text-foreground">{p.className}</b> {dayT(p)} <span className="text-amber">종료</span>
                          </p>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>

                {report.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-[11px]">
                    <p className="mb-1 flex items-center gap-1 font-semibold">
                      <AlertTriangle className="size-3" /> 확인 필요 {report.warnings.length}건
                    </p>
                    <div className="max-h-24 space-y-0.5 overflow-auto">
                      {report.warnings.map((w, i) => (
                        <p key={i}>· {w}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {report.conflicts.length > 0 ? (
                  <p className="text-text-faint text-[11px]">강의실 공유(같은 방·시간) {report.conflicts.length}건 — 정보용</p>
                ) : null}

                {/* 적용 / 롤백 */}
                {applied ? (
                  <div className="bg-blue-soft text-blue space-y-2 rounded-sm p-2 text-[12px]">
                    <p className="flex items-center gap-1 font-semibold">
                      <Check className="size-3" /> 적용 완료 — 마감 {applied.closed} · 삽입 {applied.inserted} · 반 갱신{" "}
                      {applied.classUpdated}
                    </p>
                    <p className="text-text-dim text-[11px]">기본뷰·통합뷰·강사뷰에 반영됩니다. 문제가 있으면 되돌릴 수 있습니다.</p>
                    {snapshotId ? (
                      <button
                        type="button"
                        onClick={rollback}
                        disabled={rolling}
                        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-40"
                      >
                        {rolling ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                        이 적용 되돌리기
                      </button>
                    ) : null}
                  </div>
                ) : reverted ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[12px]">{reverted}</p>
                ) : changeCount === 0 ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">변경 사항이 없습니다 — 시트와 시간표가 일치합니다.</p>
                ) : confirming ? (
                  <div className="border-amber/40 bg-amber-soft space-y-2 rounded-sm border p-2 text-[12px]">
                    <p className="text-amber flex items-center gap-1 font-semibold">
                      <AlertTriangle className="size-3" /> 적용하면 시간표(class_schedules)가 바뀝니다. 계속할까요?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={apply}
                        disabled={applying}
                        className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40"
                      >
                        {applying ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        적용 확정
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        disabled={applying}
                        className="text-text-dim hover:text-foreground px-2 py-1 text-xs transition"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition"
                  >
                    <Check className="size-3" /> 이 계획 적용
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
