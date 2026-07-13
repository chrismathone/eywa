"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Loader2, RotateCcw, Sheet, UserMinus, UserPlus, X } from "lucide-react";
import {
  applyStructureImport,
  previewStructureImport,
  rollbackStructureImport,
} from "@/features/timetable/server/structure-import-actions";
import { applyTimetableImport, previewSheetImport } from "@/features/timetable/server/import-actions";
import type { DryRunReport, SchedulePlanItem } from "@/features/timetable/import/structure/types";
import type { ImportDiff } from "@/features/timetable/import/types";

const KO_DAY: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const dayT = (p: SchedulePlanItem) => `${KO_DAY[p.day] ?? p.day} ${p.startTime}${p.endTime ? `~${p.endTime}` : ""}`;
const tch = (names: string[]) => (names.length ? names.join(", ") : "—");

/**
 * 영어 시트 가져오기 — **구조(강사별→class_schedules) + 학생 반이동(수강편집→enrollments)을 하나로**.
 * 한 번 '불러오기'로 두 시트를 동시에 미리보고(두 섹션), '적용' 한 번에 둘 다 반영(구조 먼저 → 반이동).
 * 각 시트는 독립: 한쪽 탭이 없거나 변경이 없어도 다른 쪽은 정상 동작. 기존 서버 액션 재사용(합성만).
 */
export function EnglishImportDialog({
  subject = "english",
  disabled = false,
  disabledTitle,
}: {
  subject?: string;
  /** 시트 리스 진행 중(새벽 자동 반영·타 관리자 실행) 트리거 선제 비활성 — 사유는 마우스오버(title). */
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [struct, setStruct] = useState<DryRunReport | null>(null);
  const [structErr, setStructErr] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<ImportDiff | null>(null);
  const [enrollErr, setEnrollErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();
  const [confirming, setConfirming] = useState(false);
  // 적용 결과(각 시트별). snapshotId=구조 롤백용(반이동은 롤백 UI 없음 — 기존 동일).
  const [structRes, setStructRes] = useState<{ closed: number; inserted: number; classUpdated: number } | null>(null);
  const [enrollRes, setEnrollRes] = useState<{ moved: number; removed: number; added: number; failed: number } | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [reverted, setReverted] = useState<string | null>(null);
  const [rolling, startRollback] = useTransition();

  const structChanges = struct ? struct.plan.create + struct.plan.update + struct.plan.remove : 0;
  const enrollChanges = enroll ? enroll.moves.length + enroll.adds.length + enroll.removes.length : 0;
  const totalChanges = structChanges + enrollChanges;
  const previewed = struct !== null || enroll !== null || structErr !== null || enrollErr !== null;
  const applied = structRes !== null || enrollRes !== null;

  function resetResult() {
    setConfirming(false);
    setStructRes(null);
    setEnrollRes(null);
    setSnapshotId(null);
    setReverted(null);
  }
  function clearPreview() {
    setStruct(null);
    setStructErr(null);
    setEnroll(null);
    setEnrollErr(null);
  }
  function preview() {
    setError(null);
    clearPreview();
    resetResult();
    startPreview(async () => {
      const [s, e] = await Promise.all([previewStructureImport(subject), previewSheetImport(subject)]);
      // 둘 다 실패해야 하드 에러 — 하나만 실패면 그 섹션에만 안내(다른 쪽은 정상 진행).
      if (s.error && e.error) {
        setError(`불러오기 실패 — 배치: ${s.error} · 반이동: ${e.error}`);
        return;
      }
      setStruct(s.report ?? null);
      setStructErr(s.error ?? null);
      setEnroll(e.diff ?? null);
      setEnrollErr(e.error ?? null);
    });
  }
  function apply() {
    setError(null);
    startApply(async () => {
      let sRes: typeof structRes = null;
      // ① 구조 먼저(원자 RPC). 스테일이면 전체 중단(재불러오기 유도).
      if (struct && structChanges > 0) {
        const r = await applyStructureImport(struct.hash, subject);
        if (r.error) {
          setError((r.staleHash ? "시트 또는 시간표가 변경됐습니다 — 다시 불러오세요. " : "배치 적용 실패: ") + r.error);
          if (r.staleHash) clearPreview();
          setConfirming(false);
          return;
        }
        sRes = r.applied ?? null;
        setSnapshotId(r.snapshotId ?? null);
      }
      // ② 학생 반이동(구조가 이미 적용됐어도 반이동만 실패 가능 — 부분 상태 안내).
      let eRes: typeof enrollRes = null;
      if (enroll && enrollChanges > 0) {
        const r = await applyTimetableImport(enroll, subject);
        if (r.error) {
          setError("학생 반이동 적용 실패: " + r.error + (sRes ? " (수업 배치는 이미 적용됨)" : ""));
          setStructRes(sRes); // 구조는 성공했으면 결과·롤백 노출
          setConfirming(false);
          return;
        }
        eRes = { moved: r.applied?.moved ?? 0, removed: r.applied?.removed ?? 0, added: r.applied?.added ?? 0, failed: r.failed ?? 0 };
      }
      setStructRes(sRes);
      setEnrollRes(eRes);
      setConfirming(false);
      router.refresh(); // 기본뷰·통합뷰·강사뷰 자동 갱신.
    });
  }
  function rollback() {
    if (!snapshotId) return;
    setError(null);
    startRollback(async () => {
      const res = await rollbackStructureImport(snapshotId);
      if (res.error) setError(res.error);
      else {
        setReverted(`배치 되돌리기 완료 — 삭제 ${res.reverted?.deleted ?? 0} · 복원 ${res.reverted?.restored ?? 0} · 반 ${res.reverted?.classReverted ?? 0}`);
        setSnapshotId(null);
        router.refresh();
      }
    });
  }
  function close() {
    setOpen(false);
    setError(null);
    clearPreview();
    resetResult();
  }

  const creates = struct?.planItems.filter((p) => p.action === "create") ?? [];
  const updates = struct?.planItems.filter((p) => p.action === "update") ?? [];
  const removes = struct?.planItems.filter((p) => p.action === "remove") ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition disabled:opacity-50"
      >
        <Sheet className="size-3" /> 시트에서 가져오기
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
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
              연결된 구글 시트를 편집한 뒤 불러오면 <b>수업 배치</b>(강사별 탭)와 <b>학생 반이동</b>(수강편집 탭) 변경을 한 번에 봅니다.
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

            {previewed ? (
              <div className="mt-4 flex-1 space-y-4 overflow-auto pr-1 text-[12px]">
                {/* ── 수업 배치(구조) ── */}
                <section>
                  <h3 className="text-foreground mb-1.5 text-[12px] font-bold">수업 배치 <span className="text-text-faint font-normal">(강사별 탭)</span></h3>
                  {structErr ? (
                    <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">{structErr}</p>
                  ) : structChanges === 0 ? (
                    <p className="text-text-faint text-[11px]">변경 없음 — 시트와 배치가 일치합니다.</p>
                  ) : (
                    <>
                      <div className="mb-1.5 flex flex-wrap gap-3 font-mono">
                        <span className="text-blue">생성 {struct!.plan.create}</span>
                        <span className="text-primary">변경 {struct!.plan.update}</span>
                        <span className="text-amber">제거 {struct!.plan.remove}</span>
                      </div>
                      <div className="border-line divide-line max-h-40 divide-y overflow-auto rounded-sm border">
                        {creates.map((p, i) => (
                          <p key={`c${i}`} className="text-text-dim px-2 py-1"><span className="text-blue">＋</span> <b className="text-foreground">{p.className}</b> {dayT(p)} · {tch(p.teacherNames)}{p.room ? ` · ${p.room}` : ""}</p>
                        ))}
                        {updates.map((p, i) => (
                          <p key={`u${i}`} className="text-text-dim px-2 py-1"><span className="text-primary">↻</span> <b className="text-foreground">{p.className}</b> {KO_DAY[p.day] ?? p.day} {p.startTime} <span className="text-primary">→ {tch(p.teacherNames)}/{p.room ?? "—"}/{p.endTime ?? "—"}</span></p>
                        ))}
                        {removes.map((p, i) => (
                          <p key={`r${i}`} className="text-text-dim px-2 py-1"><span className="text-amber">－</span> <b className="text-foreground">{p.className}</b> {dayT(p)} <span className="text-amber">종료</span></p>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                {/* ── 학생 반이동 ── */}
                <section>
                  <h3 className="text-foreground mb-1.5 text-[12px] font-bold">학생 반이동 <span className="text-text-faint font-normal">(수강편집 탭)</span></h3>
                  {enrollErr ? (
                    <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">{enrollErr}</p>
                  ) : enrollChanges === 0 ? (
                    <p className="text-text-faint text-[11px]">변경 없음 — 시트와 수강이 일치합니다.</p>
                  ) : (
                    <>
                      <div className="mb-1.5 flex flex-wrap gap-3 font-mono">
                        <span className="text-primary">이동 {enroll!.moves.length}</span>
                        <span className="text-blue">추가 {enroll!.adds.length}</span>
                        <span className="text-amber">삭제 {enroll!.removes.length}</span>
                        {enroll!.warnings.length > 0 ? <span className="text-chart-4">무시 {enroll!.warnings.length}</span> : null}
                      </div>
                      <div className="border-line divide-line max-h-40 divide-y overflow-auto rounded-sm border">
                        {enroll!.moves.map((m) => (
                          <p key={m.enrollmentId} className="text-text-dim px-2 py-1"><ArrowRight className="text-primary inline size-3" /> <b className="text-foreground">{m.studentName}</b> {m.fromClassName} <span className="text-text-faint">→</span> <span className="text-primary">{m.toClassName}</span></p>
                        ))}
                        {enroll!.adds.map((a, i) => (
                          <p key={`a${i}`} className="text-text-dim px-2 py-1"><UserPlus className="text-blue inline size-3" /> <b className="text-foreground">{a.studentName}</b> <span className="text-text-faint">→</span> <span className="text-blue">{a.className}</span></p>
                        ))}
                        {enroll!.removes.map((r) => (
                          <p key={r.enrollmentId} className="text-text-dim px-2 py-1"><UserMinus className="text-amber inline size-3" /> <b className="text-foreground">{r.studentName}</b> {r.className} <span className="text-amber">종료</span></p>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                {/* 경고(구조) */}
                {struct && struct.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-[11px]">
                    <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="size-3" /> 확인 필요 {struct.warnings.length}건</p>
                    <div className="max-h-20 space-y-0.5 overflow-auto">{struct.warnings.map((w, i) => <p key={i}>· {w}</p>)}</div>
                  </div>
                ) : null}

                {/* 적용 / 결과 / 롤백 */}
                {applied ? (
                  <div className="bg-blue-soft text-blue space-y-2 rounded-sm p-2 text-[12px]">
                    <p className="flex items-center gap-1 font-semibold"><Check className="size-3" /> 적용 완료</p>
                    {structRes ? <p className="text-text-dim text-[11px]">· 배치: 마감 {structRes.closed} · 삽입 {structRes.inserted} · 반 {structRes.classUpdated}</p> : null}
                    {enrollRes ? <p className="text-text-dim text-[11px]">· 반이동: 이동 {enrollRes.moved} · 삭제 {enrollRes.removed} · 추가 {enrollRes.added}{enrollRes.failed ? ` · 실패 ${enrollRes.failed}` : ""}</p> : null}
                    {snapshotId ? (
                      <button type="button" onClick={rollback} disabled={rolling} className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-40">
                        {rolling ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} 배치 변경 되돌리기
                      </button>
                    ) : null}
                  </div>
                ) : reverted ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[12px]">{reverted}</p>
                ) : totalChanges === 0 ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">변경 사항이 없습니다 — 시트와 시간표가 일치합니다.</p>
                ) : confirming ? (
                  <div className="border-amber/40 bg-amber-soft space-y-2 rounded-sm border p-2 text-[12px]">
                    <p className="text-amber flex items-center gap-1 font-semibold"><AlertTriangle className="size-3" /> 배치 {structChanges}건 · 반이동 {enrollChanges}건을 적용합니다. 계속할까요?</p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={apply} disabled={applying} className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40">
                        {applying ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} 적용 확정
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} disabled={applying} className="text-text-dim hover:text-foreground px-2 py-1 text-xs transition">취소</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)} className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold transition">
                    <Check className="size-3" /> {totalChanges}건 적용 (배치 {structChanges} · 반이동 {enrollChanges})
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
