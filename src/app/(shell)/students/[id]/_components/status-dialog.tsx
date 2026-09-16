"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Save, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { describeEndSelection } from "@/features/students/withdraw-selection";
import { describeHoldSelection } from "@/features/students/hold-selection";
import {
  changeStudentStatus,
  endStudentEnrollments,
  setStudentEnrollmentHolds,
  type ChangeStatusState,
} from "@/features/students/server/actions";

type Target = "withdrawn" | "on_hold" | "enrolled";

/** 퇴원 다이얼로그가 "무엇을 닫을지" 고르게 하는 재료 — 학생의 활성(end_date null) 수강. */
export type OpenEnrollment = {
  id: string;
  className: string;
  /** 과목 **키**(math·english…) — 화면엔 반드시 labelOf로 한글 라벨을 그린다(raw 노출 금지). */
  subject: string;
  teacherName: string | null;
  /** 지금 대기(휴원)인가 — 휴원 탭이 **현재 상태 그대로** 열리는 근거(2026-09-16). */
  onHold?: boolean;
};

const WITHDRAWAL_REASON_OPTIONS = [
  { value: "graduated", label: "졸업" },
  { value: "relocation", label: "이사" },
  { value: "competitor", label: "타학원" },
  { value: "financial", label: "경제적 사유" },
  { value: "schedule", label: "일정" },
  { value: "dissatisfaction", label: "불만족" },
  { value: "other", label: "기타" },
];

function SubmitBtn({ target, label, disabled }: { target: Target; label?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const fallback =
    target === "withdrawn" ? "퇴원 처리" : target === "on_hold" ? "휴원 처리" : "재원 복구";
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label ?? fallback}
    </Button>
  );
}

export function StatusDialog({
  studentId,
  studentName,
  currentStatus,
  initialTarget,
  openEnrollments,
  onClose,
}: {
  studentId: string;
  studentName: string;
  currentStatus: string;
  initialTarget: Target;
  /** 활성 수강(퇴원 탭의 '종료할 수업' 목록). 비면 종전처럼 목록 없이 단순 퇴원. */
  openEnrollments: OpenEnrollment[];
  onClose: (changed: boolean) => void;
}) {
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<ChangeStatusState, FormData>(
    changeStudentStatus,
    undefined,
  );
  // 부분 종료는 **다른 액션**(학생 상태를 안 바꾼다) — 같은 폼이 선택에 따라 행선지를 바꾼다.
  const [partialState, partialAction] = useActionState<ChangeStatusState, FormData>(
    endStudentEnrollments,
    undefined,
  );
  // 부분 휴원도 마찬가지(2026-09-16) — 고른 수강만 대기로, 체크가 풀린 대기는 수강으로 되돌린다.
  const [holdState, holdAction] = useActionState<ChangeStatusState, FormData>(
    setStudentEnrollmentHolds,
    undefined,
  );
  const [target, setTarget] = useState<Target>(initialTarget);

  const allIds = useMemo(() => openEnrollments.map((e) => e.id), [openEnrollments]);

  // 🔴 퇴원과 휴원은 **선택을 공유하지 않는다** — 뜻이 다르다(닫을 수업 / 쉬게 할 수업).
  //    한 벌로 묶으면 탭을 바꾸는 것만으로 다른 쪽 결과가 바뀐다.
  // 기본은 **전부 선택** = 지금 동작 보존(과목이 하나뿐이면 추가 클릭 없이 그대로 퇴원).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds));
  /**
   * 휴원 탭 기본값 — **지금 대기인 수업이 있으면 그 상태 그대로**, 하나도 없으면 전부 선택.
   * 🔑 선택 = "휴원 중인 수업 전체"라, 이미 걸어 둔 부분 휴원을 열었을 때 화면이 사실을 보여 주고
   *    체크를 푸는 것만으로 되돌릴 수 있다(되돌릴 문이 여기밖에 없다 — hold-selection.ts 주석).
   */
  const [holdSelected, setHoldSelected] = useState<Set<string>>(() => {
    const held = openEnrollments.filter((e) => e.onHold).map((e) => e.id);
    return new Set(held.length > 0 ? held : allIds);
  });

  const toggleIn = (
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    id: string,
  ) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const plan = useMemo(
    () =>
      describeEndSelection(
        openEnrollments.length,
        openEnrollments.filter((e) => selected.has(e.id)).map((e) => e.className),
      ),
    [openEnrollments, selected],
  );
  const holdPlan = useMemo(
    () =>
      describeHoldSelection(
        openEnrollments.length,
        openEnrollments.filter((e) => holdSelected.has(e.id)).map((e) => e.className),
        // 체크가 풀렸는데 지금 대기인 것 = 저장하면 다시 수강으로 돌아간다.
        openEnrollments.filter((e) => e.onHold && !holdSelected.has(e.id)).map((e) => e.className),
      ),
    [openEnrollments, holdSelected],
  );

  const isWithdraw = target === "withdrawn";
  const isHold = target === "on_hold";
  const isRestore = target === "enrolled";
  // 퇴원 탭에서 일부만 골랐을 때만 부분 종료 경로 — 나머지는 전부 종전 changeStudentStatus.
  const isPartial = isWithdraw && plan.mode === "partial";
  const blocked = (isWithdraw && plan.mode === "none") || (isHold && holdPlan.mode === "none");
  // 🔴 "0개 선택"도 부분 종료 액션으로 보낸다 — 버튼은 비활성이지만 만에 하나 제출이 새어 나가도
  //    서버가 "1개 이상 선택" 으로 거절할 뿐, **전체 퇴원으로 떨어지지 않는다**(가장 나쁜 오작동 차단).
  const usePartialAction = isWithdraw && plan.mode !== "full";
  // 휴원도 같은 규약 — 전부 선택만 학생 상태를 바꾸고, 나머지(부분·해제·0개)는 수강 단위 액션으로.
  const useHoldAction = isHold && holdPlan.mode !== "full";
  const activeState = usePartialAction ? partialState : useHoldAction ? holdState : state;

  // 성공 시 1회만 닫기 — 렌더 본문 부수효과(queueMicrotask) 대신 가드된 effect(#67).
  // 부모가 조건부 마운트({open ? … })라 닫히면 언마운트 → useActionState 리셋 → stale 성공 재발화 불가.
  // ⚠️ 두 액션 중 어느 쪽이 성공해도 닫는다(액션은 성공을 `ok:true`로 알린다 — undefined면 감지 불가).
  const closedRef = useRef(false);
  useEffect(() => {
    const done =
      (state && !state.error) ||
      (partialState && !partialState.error) ||
      (holdState && !holdState.error);
    if (done && !closedRef.current) {
      closedRef.current = true;
      onClose(true);
    }
  }, [state, partialState, holdState, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">학생 상태 전환</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">{studentName}</h2>
            <p className="text-muted-foreground text-xs">현재 상태: {currentStatus}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* target switcher chips */}
        <div className="border-border mb-4 flex gap-1 rounded-full border p-1">
          <ChipButton current={target} value="withdrawn" onClick={setTarget} label="퇴원" />
          <ChipButton current={target} value="on_hold" onClick={setTarget} label="휴원" />
          <ChipButton current={target} value="enrolled" onClick={setTarget} label="재원 복구" />
        </div>

        {/* 🔴 부분 종료는 학생 상태를 안 바꾸므로 **다른 액션**으로 보낸다 — 선택이 바뀌면 행선지도 바뀐다. */}
        <form
          action={usePartialAction ? partialAction : useHoldAction ? holdAction : formAction}
          className="space-y-3"
        >
          <input type="hidden" name="id" value={studentId} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="target" value={target} />

          {isWithdraw ? (
            <>
              <EnrollmentPicker
                label="종료할 수업"
                rows={openEnrollments}
                selected={selected}
                onToggle={(id) => toggleIn(setSelected, id)}
                onToggleAll={(all) => setSelected(all ? new Set(allIds) : new Set())}
                subjects={subjects}
              />

              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">
                  {isPartial ? "종료일" : "퇴원일"}
                </label>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={kstToday()}
                  className="border-border bg-card text-foreground num w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">
                  {isPartial ? "종료 사유" : "퇴원 사유"}
                </label>
                <select
                  name="reason"
                  required
                  className="border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                >
                  {WITHDRAWAL_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* 메모는 퇴원(students.withdrawal_metadata)에만 저장 자리가 있다 — 부분 종료에서 보여 주면
                  적어도 안 남는 거짓 약속이 된다(수강 행엔 메모 칼럼이 없다). */}
              {isPartial ? null : (
                <div className="space-y-1.5">
                  <label className="text-foreground block text-sm font-medium">상세 메모</label>
                  <textarea
                    name="memo"
                    rows={3}
                    placeholder="배경 정보 (선택)"
                    className="border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              )}
              {/* 결과를 **누르기 전에** 말한다 — 누른 뒤에 알게 되면 지금과 같은 말싸움이 난다. */}
              <p
                className={`text-xs ${
                  isPartial ? "text-amber font-medium" : blocked ? "text-danger" : "text-muted-foreground"
                }`}
              >
                {plan.notice}
              </p>
            </>
          ) : isHold ? (
            <>
              {/* 🔴 퇴원과 **같은 규약**(원장 2026-09-16 *"퇴원이든 휴원이든 … 선택한 과목만"*):
                  체크한 수업만 대기로 간다. 전부 체크면 종전대로 학생 상태까지 '휴원'이 된다. */}
              <EnrollmentPicker
                label="휴원할 수업"
                rows={openEnrollments}
                selected={holdSelected}
                onToggle={(id) => toggleIn(setHoldSelected, id)}
                onToggleAll={(all) => setHoldSelected(all ? new Set(allIds) : new Set())}
                subjects={subjects}
                markHeld
              />
              <p className="text-muted-foreground text-sm">
                대기(휴원)로 바뀐 수업은 수강 등록이 유지된 채 시간표·출석부에서 &lsquo;대기&rsquo;로 표시되고,
                자동 결석으로 잡히지 않습니다.
              </p>
              {/* 부분 휴원엔 메모를 담을 자리가 없다(수강 행엔 메모 칸이 없다) — 전체 휴원일 때만 받는다.
                  전체 휴원 메모는 감사로그(student_hold)에 남는다. */}
              {holdPlan.mode === "full" ? (
                <div className="space-y-1.5">
                  <label className="text-foreground block text-sm font-medium">메모 (선택)</label>
                  <textarea
                    name="memo"
                    rows={2}
                    placeholder="휴원 사유"
                    className="border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              ) : null}
              {/* 결과를 **누르기 전에** 말한다 — 퇴원 다이얼로그와 같은 규칙. */}
              <p
                className={`text-xs ${
                  holdPlan.mode === "partial" || holdPlan.mode === "resume"
                    ? "text-amber font-medium"
                    : holdPlan.mode === "none"
                      ? "text-danger"
                      : "text-muted-foreground"
                }`}
              >
                {holdPlan.notice}
              </p>
            </>
          ) : isRestore ? (
            <p className="text-muted-foreground text-sm">
              학생을 재원 상태로 복구합니다. 퇴원/휴원 사유 기록은 삭제되며 활성 수강이 다시 활성화됩니다.
            </p>
          ) : null}

          {activeState?.error ? (
            <p className="text-danger text-sm">{activeState.error}</p>
          ) : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              취소
            </Button>
            <SubmitBtn
              target={target}
              label={isWithdraw ? plan.buttonLabel : isHold ? holdPlan.buttonLabel : undefined}
              disabled={blocked}
            />
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * 활성 수강 고르기 — **퇴원 탭과 휴원 탭이 같은 부품을 쓴다**(원장 2026-09-16 *"퇴원이든 휴원이든"*).
 * 두 벌로 두면 한쪽만 고쳐진다(#77과 같은 결) — 체크박스 name도 `enrollmentIds` 하나로 맞춰
 * 두 서버 액션이 같은 모양(`getAll("enrollmentIds")`)으로 받는다.
 *
 * ⚠️ 활성 수강이 0개면 아무것도 안 그린다 — 고를 것이 없다(안내는 호출부의 plan 문구가 한다).
 */
function EnrollmentPicker({
  label,
  rows,
  selected,
  onToggle,
  onToggleAll,
  subjects,
  /** 휴원 탭 — 지금 대기인 줄에 표식을 단다(체크를 풀면 되돌아간다는 사실이 보여야 한다). */
  markHeld = false,
}: {
  label: string;
  rows: OpenEnrollment[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  subjects: ReturnType<typeof useSubjectMaps>;
  markHeld?: boolean;
}) {
  if (rows.length === 0) return null;
  const allSelected = selected.size === rows.length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-foreground block text-sm font-medium">{label}</label>
        <label className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onToggleAll(!allSelected)}
            className="size-3.5"
          />
          전체 선택
        </label>
      </div>
      <ul className="border-border max-h-44 space-y-1 overflow-auto rounded-lg border px-2 py-1.5">
        {rows.map((e) => (
          <li key={e.id}>
            <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded-md px-1 py-1">
              {/* 체크된 항목이 곧 제출 값 — 서버 액션이 getAll("enrollmentIds")로 받는다. */}
              <input
                type="checkbox"
                name="enrollmentIds"
                value={e.id}
                checked={selected.has(e.id)}
                onChange={() => onToggle(e.id)}
                className="size-3.5 shrink-0"
              />
              <Pill color={subjects.colorOf(e.subject)}>{subjects.labelOf(e.subject)}</Pill>
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">{e.className}</span>
              {markHeld && e.onHold ? (
                <span className="text-amber shrink-0 text-xs font-medium">휴원 중</span>
              ) : null}
              <span className="text-text-dim shrink-0 text-xs">{e.teacherName ?? "—"}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChipButton({
  current,
  value,
  onClick,
  label,
}: {
  current: Target;
  value: Target;
  onClick: (v: Target) => void;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {label}
    </button>
  );
}
