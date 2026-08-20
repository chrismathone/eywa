"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Save, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { describeEndSelection } from "@/features/students/withdraw-selection";
import {
  changeStudentStatus,
  endStudentEnrollments,
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
  const [target, setTarget] = useState<Target>(initialTarget);

  // 기본은 **전부 선택** = 지금 동작 보존(과목이 하나뿐이면 추가 클릭 없이 그대로 퇴원).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(openEnrollments.map((e) => e.id)),
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = openEnrollments.length > 0 && selected.size === openEnrollments.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(openEnrollments.map((e) => e.id)));

  const plan = useMemo(
    () =>
      describeEndSelection(
        openEnrollments.length,
        openEnrollments.filter((e) => selected.has(e.id)).map((e) => e.className),
      ),
    [openEnrollments, selected],
  );

  const isWithdraw = target === "withdrawn";
  const isHold = target === "on_hold";
  const isRestore = target === "enrolled";
  // 퇴원 탭에서 일부만 골랐을 때만 부분 종료 경로 — 나머지는 전부 종전 changeStudentStatus.
  const isPartial = isWithdraw && plan.mode === "partial";
  const blocked = isWithdraw && plan.mode === "none";
  // 🔴 "0개 선택"도 부분 종료 액션으로 보낸다 — 버튼은 비활성이지만 만에 하나 제출이 새어 나가도
  //    서버가 "1개 이상 선택" 으로 거절할 뿐, **전체 퇴원으로 떨어지지 않는다**(가장 나쁜 오작동 차단).
  const usePartialAction = isWithdraw && plan.mode !== "full";
  const activeState = usePartialAction ? partialState : state;

  // 성공 시 1회만 닫기 — 렌더 본문 부수효과(queueMicrotask) 대신 가드된 effect(#67).
  // 부모가 조건부 마운트({open ? … })라 닫히면 언마운트 → useActionState 리셋 → stale 성공 재발화 불가.
  // ⚠️ 두 액션 중 어느 쪽이 성공해도 닫는다(액션은 성공을 `ok:true`로 알린다 — undefined면 감지 불가).
  const closedRef = useRef(false);
  useEffect(() => {
    const done = (state && !state.error) || (partialState && !partialState.error);
    if (done && !closedRef.current) {
      closedRef.current = true;
      onClose(true);
    }
  }, [state, partialState, onClose]);

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
        <form action={usePartialAction ? partialAction : formAction} className="space-y-3">
          <input type="hidden" name="id" value={studentId} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="target" value={target} />

          {isWithdraw ? (
            <>
              {openEnrollments.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-foreground block text-sm font-medium">종료할 수업</label>
                    <label className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="size-3.5"
                      />
                      전체 선택
                    </label>
                  </div>
                  <ul className="border-border max-h-44 space-y-1 overflow-auto rounded-lg border px-2 py-1.5">
                    {openEnrollments.map((e) => (
                      <li key={e.id}>
                        <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded-md px-1 py-1">
                          {/* 체크된 항목이 곧 제출 값 — 부분 종료 액션이 getAll("enrollmentIds")로 받는다. */}
                          <input
                            type="checkbox"
                            name="enrollmentIds"
                            value={e.id}
                            checked={selected.has(e.id)}
                            onChange={() => toggle(e.id)}
                            className="size-3.5 shrink-0"
                          />
                          <Pill color={subjects.colorOf(e.subject)}>{subjects.labelOf(e.subject)}</Pill>
                          <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                            {e.className}
                          </span>
                          <span className="text-text-dim shrink-0 text-xs">{e.teacherName ?? "—"}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
              <p className="text-muted-foreground text-sm">
                휴원 처리 시 활성 수강 등록은 유지되되 &lsquo;휴원&rsquo; 표시됩니다. 출석부에 자동 결석으로 잡히지
                않습니다.
              </p>
              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">메모 (선택)</label>
                <textarea
                  name="memo"
                  rows={2}
                  placeholder="휴원 사유"
                  className="border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
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
              label={isWithdraw ? plan.buttonLabel : undefined}
              disabled={blocked}
            />
          </footer>
        </form>
      </div>
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
