"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Sheet, UserMinus, UserPlus, Upload, X } from "@/components/icons/aywa-icon-compat";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import {
  applySheetImport,
  applyTimetableImport,
  previewSheetImport,
  previewTimetableImport,
  type ApplyState,
} from "@/features/timetable/server/import-actions";
import { supportsStructureImport } from "@/features/integrations/sheets-provider";
import type { ImportDiff } from "@/features/timetable/import/types";
import { effectiveDateLabel, isImmediate } from "@/features/timetable/import/effective-date";
import { EffectiveDateField } from "./effective-date-field";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

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
  today,
  label,
  disabled = false,
  disabledTitle,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  mode?: "file" | "sheet";
  subject?: string;
  /** KST 오늘(서버 계산) — 적용일의 기본값이자 하한. 클라 `new Date()`는 타임존이 어긋난다. */
  today: string;
  label?: string;
  /** 시트 리스 진행 중(새벽 자동 반영·타 관리자 실행) 트리거 선제 비활성 — 사유는 마우스오버(title). */
  disabled?: boolean;
  disabledTitle?: string;
  /** 부모가 open을 소유할 때(팝오버 메뉴에서 열기). 미지정이면 자기 상태로 동작. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 자체 트리거 버튼을 숨긴다 — 부모(팝오버 항목)가 여는 경우. */
  hideTrigger?: boolean;
}) {
  const sheet = mode === "sheet";
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
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  // 미리보기 hash — apply 시 서버가 재계산 결과와 대조(stale 미리보기 차단). diff와 항상 함께 세팅/해제.
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyState | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();
  // 적용일 — 기본은 오늘(종전 동작). 반이동은 이 날짜로 옛 수강을 끝내고 새 수강을 시작한다.
  const [effective, setEffective] = useState(today);

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
    setHash(null);
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
    setHash(null);
    if (sheet) {
      startPreview(async () => {
        const res = await previewSheetImport(subject);
        if (res.error) setError(res.error);
        else {
          setDiff(res.diff ?? null);
          setHash(res.hash ?? null);
        }
      });
      return;
    }
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startPreview(async () => {
      const res = await previewTimetableImport(fd);
      if (res.error) setError(res.error);
      else {
        setDiff(res.diff ?? null);
        setHash(res.hash ?? null);
      }
    });
  }

  function apply() {
    if (!diff || total === 0) return;
    if (!hash || (!sheet && !file)) {
      // 정상 흐름에선 미리보기가 hash·파일을 항상 보장 — 방어적 안내만.
      setError("미리보기 정보가 없습니다. 다시 미리보기 후 적용하세요.");
      return;
    }
    const rm = diff.removes.length;
    const warn = diff.warnings.length;
    // 한 번 더 확인 — 대량/삭제/무시 항목이 있으면 무엇이 적용·제외되는지 요약해 물어본다.
    // ⚠️ 예약 적용(오늘이 아님)은 규모와 무관하게 항상 묻는다 — 날짜를 바꿔 둔 걸 잊고 누르면
    //    "왜 시간표가 안 바뀌지"가 되고, 그 사이 며칠이 옛 배치로 남는다.
    const needConfirm = total >= LARGE_CHANGE || rm >= 10 || warn > 0 || !isImmediate(effective, today);
    if (needConfirm) {
      const when = isImmediate(effective, today) ? "지금" : `${effectiveDateLabel(effective)}부터`;
      const lines = [`이동 ${diff.moves.length} · 추가 ${diff.adds.length} · 삭제 ${rm}건을 ${when} 적용합니다.`];
      if (rm > 0) lines.push("· 삭제는 시트/파일에서 빠진 수강을 종료합니다.");
      if (warn > 0) lines.push(`· ${warn}건은 매칭 실패/모호로 무시(미적용)됩니다.`);
      lines.push("진행할까요?");
      if (!confirm(lines.join("\n"))) return;
    }
    startApply(async () => {
      // 서버가 파일/시트+DB를 재읽어 hash 대조 후 적용 — 클라 diff는 보내지 않는다(표시용).
      // subject 전달 = 그 과목 시트 리스 선점('시트 반영'과 교차 실행 직렬화). 파일 경로도 무해(미연동=스킵).
      let res: ApplyState;
      if (sheet) {
        res = await applySheetImport(hash, subject, effective);
      } else {
        const fd = new FormData();
        fd.set("file", file!);
        res = await applyTimetableImport(hash, fd, subject, effective);
      }
      if (res.staleHash) {
        // 미리보기 이후 수강/시트 변경 감지 — 오래된 미리보기를 지우고 재미리보기 유도.
        setDiff(null);
        setHash(null);
        setResult(null);
        setError(res.error ?? "미리보기 이후 변경되었습니다. 다시 미리보기 후 적용하세요.");
        return;
      }
      setResult(res);
      // 스냅샷을 맨 뒤(`snapshotId`) 중단된 적용은 일부가 이미 반영됐을 수 있다 — 회차 확정 창에도 알린다.
      if (!res.error || res.snapshotId) notifyTermPlansChanged();
      if (!res.error) {
        setDiff(null);
        setHash(null);
        router.refresh();
      }
    });
  }

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
          {sheet ? <Sheet className="size-3" /> : <Upload className="size-3" />}
          {label ?? (sheet ? "시트에서 가져오기" : "가져오기")}
        </button>
      )}

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5"
            role="dialog"
            aria-label={sheet ? "구글 시트에서 가져오기" : "엑셀 가져오기"}
          >
            <header className="flex items-center justify-between">
              <h2 className="text-foreground text-base font-bold">
                {sheet ? "구글 시트에서 가져오기" : "시간표 엑셀 가져오기"}
              </h2>
              <button type="button" onClick={close} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>

            {sheet ? (
              <>
                <p className="text-text-dim mt-1 text-xs">
                  연결된 구글 시트의 <b>수강편집</b> 탭에서 학생의 <b>반</b>만 바꾼 뒤 불러오세요.
                </p>
                <p className="text-text-faint mt-1 flex items-start gap-1 text-xs">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>시트에서 편집했으면 <b>‘시트로 보내기’를 다시 누르지 마세요</b> — 전체 덮어쓰기라 편집분이 사라집니다.</span>
                </p>
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
              </>
            ) : (
              <>
                <p className="text-text-dim mt-1 text-xs">
                  내보낸 엑셀의 <b>수강편집</b> 시트에서 학생의 <b>반</b>만 바꿔 다시 올리세요.
                </p>
                <p className="text-text-faint mt-1 text-xs">
                  구글시트로 편집했다면 <b>파일 → 다운로드 → Microsoft Excel(.xlsx)</b>로 받아 올리면 됩니다.
                </p>
                {/* 구조 가져오기 지원 과목(영어)만 — 파일 경로는 '수강편집'만 읽어 배치 편집이 조용히 무시된다.
                    사용자가 강사별 격자를 고쳐 올리고 "반영됐겠지" 하는 오해를 막는 안내(2026-07-15). */}
                {supportsStructureImport(subject) ? (
                  <p className="text-text-faint mt-1 flex items-start gap-1 text-xs">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      이 경로는 <b>학생 반이동만</b> 반영합니다 — 강사별 시간표 탭에서 <b>수업 배치</b>를 바꿔도
                      적용되지 않습니다. 배치 변경은 <b>‘시트에서 가져오기’</b>를 쓰세요.
                    </span>
                  </p>
                ) : null}

                <label className="text-foreground mt-3 block text-xs font-medium">
                  엑셀 파일 <span className="text-danger">*</span>
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <FilePickerButton
                    accept=".xlsx"
                    file={file}
                    onSelect={(f) => {
                      setFile(f);
                      setDiff(null);
                      setHash(null);
                      setResult(null);
                    }}
                    label="엑셀 파일 선택"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={preview}
                    disabled={!file || previewing}
                    className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
                  >
                    {previewing ? <Loader2 className="size-3 animate-spin" /> : null}
                    미리보기
                  </button>
                </div>
                {!file ? (
                  <p className="text-text-faint mt-1.5 text-xs">엑셀 파일을 선택하면 미리보기가 활성화됩니다.</p>
                ) : null}
              </>
            )}

            {/* 적용일 — 두 경로(시트·파일)가 같은 규칙을 쓴다. 바꿔도 미리보기는 유효하다: 반이동 diff는
                "누가 어느 반인가"라 날짜에 안 매인다(구조 import와 다른 점 — 그쪽은 날짜별로 다시 계산한다). */}
            <EffectiveDateField
              value={effective}
              onChange={setEffective}
              today={today}
              disabled={applying || !!result?.applied}
            />

            {error ? <p className="text-chart-4 mt-3 text-xs">{error}</p> : null}

            {diff ? (
              <div className="mt-4 space-y-3 text-xs">
                {/* 요약 카운트 — 무엇이 얼마나 바뀌는지 */}
                <div className="flex flex-wrap gap-3 num">
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
                      <h4 className="text-primary mb-1 flex items-center gap-1 font-bold">
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
                      <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
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
                      <h4 className="text-amber mb-1 flex items-center gap-1 font-bold">
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
                  <div className="bg-amber-soft text-amber rounded-sm p-2 text-xs">
                    <p className="mb-1 flex items-center gap-1 font-bold">
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
                  <p className="text-text-faint text-xs">가져올 변경이 없습니다.</p>
                ) : null}

                <button
                  type="button"
                  onClick={apply}
                  disabled={total === 0 || applying}
                  className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition disabled:opacity-40"
                >
                  {applying ? <Loader2 className="size-3 animate-spin" /> : null}
                  {total > 0 ? `${total}건 적용` : "변경 없음"}
                </button>
              </div>
            ) : null}

            {result ? (
              result.error ? (
                <p className="text-chart-4 mt-3 text-xs">{sanitizeErrorText(result.error)}</p>
              ) : (
                <p className="text-primary mt-3 text-xs">
                  적용 완료 — 이동 {result.applied?.moved} · 삭제 {result.applied?.removed} · 추가{" "}
                  {result.applied?.added}
                  {/* 휴원 학생은 거절·스킵이 아니라 **휴원 표식을 달고** 들어간다 — 조용히 넘어가면
                      "왜 이 아이는 출석부에 안 뜨지"가 된다(원장 2026-08-20 휴원 정합). */}
                  {result.heldAdds ? (
                    <span className="text-amber"> · 휴원 상태로 추가 {result.heldAdds}</span>
                  ) : null}
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
