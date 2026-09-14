"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Loader2, Minus, Plus, RotateCcw, Sheet, UserMinus, UserPlus, X } from "@/components/icons/eywa-icon-compat";
import {
  applyStructureImport,
  previewStructureImport,
  rollbackStructureImport,
} from "@/features/timetable/server/structure-import-actions";
import { applySheetImport, previewSheetImport } from "@/features/timetable/server/import-actions";
import type { DryRunReport, SchedulePlanItem } from "@/features/timetable/import/structure/types";
import type { ImportDiff } from "@/features/timetable/import/types";
import { conflictChecklist } from "@/features/timetable/import/structure/conflicts";
import { effectiveDateLabel, isImmediate } from "@/features/timetable/import/effective-date";
import { mondayOf } from "@/features/timetable/lib/week";
import { EffectiveDateField } from "./effective-date-field";
import { ConflictChecklist } from "./conflict-checklist";

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
  today,
  disabled = false,
  disabledTitle,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  subject?: string;
  /** KST 오늘(서버 계산) — 적용일의 기본값이자 하한. */
  today: string;
  /** 시트 리스 진행 중(새벽 자동 반영·타 관리자 실행) 트리거 선제 비활성 — 사유는 마우스오버(title). */
  disabled?: boolean;
  disabledTitle?: string;
  /** 부모가 open을 소유할 때(팝오버 메뉴에서 열기). 미지정이면 자기 상태로 동작. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 자체 트리거 버튼을 숨긴다 — 부모(팝오버 항목)가 여는 경우. */
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  // ⚠️ controlled 하이브리드(2026-07-24) — 툴바가 이 다이얼로그를 '엑셀·시트' 팝오버 항목에서 열기 위해
  // open을 부모가 소유할 수 있게 한다. prop을 안 주면 종전대로 자기 상태로 동작(완전 하위호환).
  // ⚠️ 부모는 **조건부 마운트**로 쓴다 — 항상 마운트한 채 부모가 open을 false로 만들면 close()를 우회해
  //    미리보기·결과(diff/hash/result/snapshotId)가 잔존하고 "미리보기한 변경을 아직 적용하지 않았습니다"
  //    confirm 가드까지 건너뛴다(gotcha #67 나머지 절반). 조건부 마운트면 언마운트가 곧 리셋이라 안전하다.
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };
  // 적용일 — 기본은 오늘(종전 동작). 바꾸면 미리보기를 지운다: 구조 diff는 **그 날짜 기준**으로 다시
  // 계산돼야 하고(예약해 둔 배치가 이미 있으면 그게 '현재'다), 충돌 목록도 함께 달라진다.
  const [effective, setEffective] = useState(today);
  // 확인 체크된 충돌 키 — 적용의 전제조건(서버가 같은 목록으로 재검증).
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [struct, setStruct] = useState<DryRunReport | null>(null);
  const [structErr, setStructErr] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<ImportDiff | null>(null);
  // 반이동 미리보기 hash — apply 시 서버 재계산과 대조(stale 차단). enroll과 함께 세팅/해제.
  const [enrollHash, setEnrollHash] = useState<string | null>(null);
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
    setChecked(new Set());
    setStruct(null);
    setStructErr(null);
    setEnroll(null);
    setEnrollHash(null);
    setEnrollErr(null);
  }
  /** 적용일이 바뀌면 미리보기는 무효 — 그 날짜 기준으로 다시 불러와야 한다. */
  function changeEffective(next: string) {
    setEffective(next);
    setError(null);
    clearPreview();
    resetResult();
  }
  function preview() {
    setError(null);
    clearPreview();
    resetResult();
    startPreview(async () => {
      const [s, e] = await Promise.all([previewStructureImport(subject, effective), previewSheetImport(subject)]);
      // 둘 다 실패해야 하드 에러 — 하나만 실패면 그 섹션에만 안내(다른 쪽은 정상 진행).
      if (s.error && e.error) {
        setError(`불러오기 실패 — 배치: ${s.error} · 반이동: ${e.error}`);
        return;
      }
      setStruct(s.report ?? null);
      setStructErr(s.error ?? null);
      setEnroll(e.diff ?? null);
      setEnrollHash(e.hash ?? null);
      setEnrollErr(e.error ?? null);
    });
  }
  function apply() {
    setError(null);
    startApply(async () => {
      let sRes: typeof structRes = null;
      // ① 구조 먼저(원자 RPC). 스테일이면 전체 중단(재불러오기 유도).
      if (struct && structChanges > 0) {
        const r = await applyStructureImport(struct.hash, subject, effective, [...checked]);
        if (r.error) {
          setError((r.staleHash ? "시트 또는 시간표가 변경됐습니다 — 다시 불러오세요. " : "배치 적용 실패: ") + r.error);
          // 충돌 목록이 서버 재계산과 어긋났으면(확인 이후 시트가 바뀐 경우) 미리보기를 지워 다시 받게 한다.
          if (r.staleHash || r.staleConflicts) clearPreview();
          setConfirming(false);
          return;
        }
        sRes = r.applied ?? null;
        setSnapshotId(r.snapshotId ?? null);
      }
      // ② 학생 반이동(구조가 이미 적용됐어도 반이동만 실패 가능 — 부분 상태 안내).
      //    서버가 시트+DB 재읽기·hash 대조 후 적용(클라 diff 불신) — 스테일이면 미리보기 지우고 재불러오기 유도.
      let eRes: typeof enrollRes = null;
      if (enroll && enrollChanges > 0) {
        if (!enrollHash) {
          setError("반이동 미리보기 정보가 없습니다 — 다시 불러오세요." + (sRes ? " (수업 배치는 이미 적용됨)" : ""));
          setStructRes(sRes);
          setConfirming(false);
          return;
        }
        const r = await applySheetImport(enrollHash, subject, effective);
        if (r.error) {
          if (r.staleHash) {
            // 반이동 미리보기만 무효화(구조는 이미 적용됐을 수 있음 — 결과·롤백은 유지).
            setError("수강 또는 시트가 미리보기 이후 변경됐습니다 — 다시 불러오세요." + (sRes ? " (수업 배치는 이미 적용됨)" : ""));
            setEnroll(null);
            setEnrollHash(null);
            setEnrollErr("미리보기 이후 변경됨 — 다시 불러오세요.");
          } else {
            setError("학생 반이동 적용 실패: " + r.error + (sRes ? " (수업 배치는 이미 적용됨)" : ""));
          }
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

  // 확인이 필요한 충돌(= 이번 변경이 건드린 물리적 불가능). 합반은 여기 안 들어온다(경고만).
  const mustAck = struct ? conflictChecklist(struct.conflicts) : [];
  const ackDone = mustAck.every((c) => checked.has(c.key));
  const scheduled = !isImmediate(effective, today);
  const toggleAck = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  /** 적용한 날짜가 속한 주로 이동 — 예약 적용은 그 주로 넘겨야 결과가 보인다. */
  function goToEffectiveWeek() {
    const sp = new URLSearchParams(window.location.search);
    sp.set("week", mondayOf(effective));
    router.push(`${window.location.pathname}?${sp.toString()}`);
  }

  const creates = struct?.planItems.filter((p) => p.action === "create") ?? [];
  const updates = struct?.planItems.filter((p) => p.action === "update") ?? [];
  const removes = struct?.planItems.filter((p) => p.action === "remove") ?? [];

  return (
    <>
      {hideTrigger ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition disabled:opacity-50"
        >
          <Sheet className="size-3" /> 시트에서 가져오기
        </button>
      )}

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5"
            role="dialog"
            aria-label="시트에서 가져오기"
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-base font-bold">시트에서 가져오기</h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>
            <p className="text-text-dim mt-1 text-xs">
              연결된 구글 시트를 편집한 뒤 불러오면 <b>수업 배치</b>(강사별 탭)와 <b>학생 반이동</b>(수강편집 탭) 변경을 한 번에 봅니다.
            </p>
            <p className="text-text-faint mt-1 flex items-start gap-1 text-xs">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>편집했으면 <b>‘시트 반영’을 다시 누르지 마세요</b>(전체 덮어쓰기라 편집분이 사라집니다).</span>
            </p>
            {/* ⚠️ 적용 뒤에는 잠근다 — changeEffective가 resetResult를 부르는데, 거기 있는 snapshotId가
                되돌리기의 **유일한 경로**라 날짜를 한 번 건드리면 되돌릴 길이 조용히 사라진다. */}
            <EffectiveDateField
              value={effective}
              onChange={changeEffective}
              today={today}
              disabled={applying || applied}
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={preview}
                disabled={previewing}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {previewing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
                시트에서 불러오기
              </button>
            </div>

            {error ? <p className="text-chart-4 mt-3 text-xs">{error}</p> : null}

            {previewed ? (
              <div className="mt-4 flex-1 space-y-4 overflow-auto pr-1 text-xs">
                {/* ── 수업 배치(구조) ── */}
                <section>
                  <h3 className="text-foreground mb-1.5 text-xs font-bold">수업 배치 <span className="text-text-faint font-normal">(강사별 탭)</span></h3>
                  {structErr ? (
                    <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-xs">{structErr}</p>
                  ) : structChanges === 0 ? (
                    <p className="text-text-faint text-xs">변경 없음 — 시트와 배치가 일치합니다.</p>
                  ) : (
                    <>
                      <div className="mb-1.5 flex flex-wrap gap-3 num">
                        <span className="text-blue">생성 {struct!.plan.create}</span>
                        <span className="text-primary">변경 {struct!.plan.update}</span>
                        <span className="text-amber">제거 {struct!.plan.remove}</span>
                      </div>
                      <div className="border-line divide-line max-h-40 divide-y overflow-auto rounded-sm border">
                        {creates.map((p, i) => (
                          <p key={`c${i}`} className="text-text-dim flex items-center gap-1 px-2 py-1"><Plus size={13} className="shrink-0 text-blue" aria-hidden="true" /> <span><b className="text-foreground">{p.className}</b> {dayT(p)} · {tch(p.teacherNames)}{p.room ? ` · ${p.room}` : ""}</span></p>
                        ))}
                        {updates.map((p, i) => (
                          <p key={`u${i}`} className="text-text-dim px-2 py-1"><span className="text-primary">↻</span> <b className="text-foreground">{p.className}</b> {KO_DAY[p.day] ?? p.day} {p.startTime} <span className="text-primary">→ {tch(p.teacherNames)}/{p.room ?? "—"}/{p.endTime ?? "—"}</span></p>
                        ))}
                        {removes.map((p, i) => (
                          <p key={`r${i}`} className="text-text-dim flex items-center gap-1 px-2 py-1"><Minus size={13} className="shrink-0 text-amber" aria-hidden="true" /> <span><b className="text-foreground">{p.className}</b> {dayT(p)} <span className="text-amber">종료</span></span></p>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                {/* ── 학생 반이동 ── */}
                <section>
                  <h3 className="text-foreground mb-1.5 text-xs font-bold">학생 반이동 <span className="text-text-faint font-normal">(수강편집 탭)</span></h3>
                  {enrollErr ? (
                    <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-xs">{enrollErr}</p>
                  ) : enrollChanges === 0 ? (
                    <p className="text-text-faint text-xs">변경 없음 — 시트와 수강이 일치합니다.</p>
                  ) : (
                    <>
                      <div className="mb-1.5 flex flex-wrap gap-3 num">
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

                {/* 적용 후 배치의 물리적 충돌 — 확인 체크리스트 + 합반 경고 + 원래 있던 충돌.
                    🔴 조용히 접는 축은 **배치 변경 수**다(`totalChanges` 아님 — 충돌은 배치에서만 나온다). */}
                {struct ? (
                  <ConflictChecklist
                    conflicts={struct.conflicts}
                    checked={checked}
                    onToggle={toggleAck}
                    disabled={applying || applied}
                    changed={structChanges > 0}
                  />
                ) : null}

                {/* 경고(구조) */}
                {struct && struct.warnings.length > 0 ? (
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-xs">
                    <p className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="size-3" /> 확인 필요 {struct.warnings.length}건</p>
                    <div className="max-h-20 space-y-0.5 overflow-auto">{struct.warnings.map((w, i) => <p key={i}>· {w}</p>)}</div>
                  </div>
                ) : null}

                {/* 적용 / 결과 / 롤백 */}
                {applied ? (
                  <div className="bg-blue-soft text-blue space-y-2 rounded-sm p-2 text-xs">
                    <p className="flex items-center gap-1 font-bold">
                      <Check className="size-3" /> {scheduled ? `${effectiveDateLabel(effective)}부터 적용 예약됨` : "적용 완료"}
                    </p>
                    {structRes ? <p className="text-text-dim text-xs">· 배치: 마감 {structRes.closed} · 삽입 {structRes.inserted} · 반 {structRes.classUpdated}</p> : null}
                    {enrollRes ? <p className="text-text-dim text-xs">· 반이동: 이동 {enrollRes.moved} · 삭제 {enrollRes.removed} · 추가 {enrollRes.added}{enrollRes.failed ? ` · 실패 ${enrollRes.failed}` : ""}</p> : null}
                    {scheduled ? (
                      <p className="text-text-dim text-xs">
                        지금 화면(이번 주)은 그대로입니다 — 바뀐 배치는 그 주로 넘겨야 보입니다.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {scheduled ? (
                        <button type="button" onClick={goToEffectiveWeek} className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition">
                          <ArrowRight className="size-3" /> 그 주 시간표 보기
                        </button>
                      ) : null}
                      {snapshotId ? (
                        <button type="button" onClick={rollback} disabled={rolling} className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition disabled:opacity-40">
                          {rolling ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} 배치 변경 되돌리기
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : reverted ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-xs">{reverted}</p>
                ) : totalChanges === 0 ? (
                  <p className="bg-bg-soft text-text-dim rounded-sm p-2 text-xs">변경 사항이 없습니다 — 시트와 시간표가 일치합니다.</p>
                ) : confirming ? (
                  <div className="border-amber/40 bg-amber-soft space-y-2 rounded-sm border p-2 text-xs">
                    <p className="text-amber flex items-center gap-1 font-bold">
                      <AlertTriangle className="size-3" /> 배치 {structChanges}건 · 반이동 {enrollChanges}건을{" "}
                      {scheduled ? `${effectiveDateLabel(effective)}부터` : "지금"} 적용합니다. 계속할까요?
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={apply} disabled={applying} className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40">
                        {applying ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} 적용 확정
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} disabled={applying} className="text-text-dim hover:text-foreground px-2 py-1 text-xs transition">취소</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => setConfirming(true)}
                      disabled={!ackDone}
                      className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition disabled:opacity-40"
                    >
                      <Check className="size-3" /> {totalChanges}건 적용 (배치 {structChanges} · 반이동 {enrollChanges})
                      {scheduled ? ` · ${effectiveDateLabel(effective)}부터` : ""}
                    </button>
                    {/* ⚠️ 비활성 사유는 title이 아니라 **보이는 문구**로 — disabled button의 툴팁은 안 뜬다(툴바 Reason과 같은 규약). */}
                    {!ackDone ? (
                      <p className="text-text-faint mt-1 text-xs">
                        위 <b>확인 필요</b> {mustAck.length}건을 모두 체크해야 적용할 수 있습니다.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
