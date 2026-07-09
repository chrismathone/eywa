"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Sheet, X } from "lucide-react";
import { previewStructureImport } from "@/features/timetable/server/structure-import-actions";
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

  function preview() {
    setError(null);
    setReport(null);
    startPreview(async () => {
      const res = await previewStructureImport(subject);
      if (res.error) setError(res.error);
      else setReport(res.report ?? null);
    });
  }
  function close() {
    setOpen(false);
    setReport(null);
    setError(null);
  }

  const creates = report?.planItems.filter((p) => p.action === "create") ?? [];
  const updates = report?.planItems.filter((p) => p.action === "update") ?? [];
  const removes = report?.planItems.filter((p) => p.action === "remove") ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <Sheet className="size-3" /> 구조 가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5"
            role="dialog"
            aria-label="강사별 시트에서 구조 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-[15px] font-extrabold">강사별 시트에서 구조 가져오기</h2>
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

                <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">
                  미리보기 전용입니다. 실제 반영(class_schedules 쓰기)은 다음 단계에서 추가됩니다.
                </p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
