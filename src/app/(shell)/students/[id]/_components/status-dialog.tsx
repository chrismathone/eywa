"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Save, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { describeEndSelection } from "@/features/students/withdraw-selection";
import { describeHoldSelection } from "@/features/students/hold-selection";
import {
  groupEnrollmentsBySubject,
  idsOf,
  initialHoldSubjects,
  type SubjectGroup,
} from "@/features/students/subject-selection";
import {
  changeStudentStatus,
  endStudentEnrollments,
  setStudentEnrollmentHolds,
  type ChangeStatusState,
} from "@/features/students/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { ReasonFields } from "@/features/withdrawals/reason-fields";

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

// 퇴원 사유(대분류·세부·메모)는 퇴원관리와 **한 벌**(`ReasonFields` · REASON_LABEL) — 두 벌이면 여기서 고른 사유가 퇴원관리에선
// 다른 말로 보였다(감사 D4).
const FIELD_LABEL = "text-foreground block text-sm font-medium";
const FIELD_CONTROL = "border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm";

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
  statusKey,
  initialTarget,
  openEnrollments,
  onClose,
}: {
  studentId: string;
  studentName: string;
  /** 화면 표시용 한글 라벨(예 "재원"). */
  currentStatus: string;
  /**
   * 학생 상태 **원값**(enrolled·on_hold·withdrawn…) — 지금 상태와 같은 칩을 잠그는 근거.
   * ⚠️ `currentStatus`(한글 라벨)로 비교하지 말 것 — 라벨로 분기했다가 메뉴가 늘 '재원으로 전환'만 뜨던
   *    사고가 있었다([[#42]]).
   */
  statusKey: string;
  initialTarget: Target;
  /** 활성 수강 — 다이얼로그가 **과목으로 묶어** 보여 준다. 비면 종전처럼 목록 없이 학생 단위로 처리. */
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
  // 퇴원일이 미래면 예약이다(서버 `changeStudentStatus`) — 저장 전에 그 사실을 한 줄로 알린다.
  const [pickedDate, setPickedDate] = useState(() => kstToday());

  /**
   * 🔑 **선택 단위 = 과목**(원장 2026-09-16 *"과목 선택 가능하게 해달라한것 같은데, 수업 선택이 아니라"*).
   * 수강 한 줄씩 세웠더니 수학만 세 반 다니는 학생이 한 과목인데 세 줄로 보였다. 과목 하나를 고르면 그 과목의
   * **모든** 활성 수강이 함께 간다 — 서버엔 여전히 수강 id로 펼쳐 보낸다(`idsOf`, 서버 계약 불변).
   * 순서는 학원설정 과목 순서(`subjects.options`).
   */
  const subjectOrder = useMemo(() => subjects.options.map((o) => o.value), [subjects]);
  const groups = useMemo(
    () => groupEnrollmentsBySubject(openEnrollments, subjectOrder),
    [openEnrollments, subjectOrder],
  );
  const allSubjects = useMemo(() => groups.map((g) => g.subject), [groups]);

  // 🔴 퇴원과 휴원은 **선택을 공유하지 않는다** — 뜻이 다르다(그만두는 과목 / 쉬는 과목).
  //    한 벌로 묶으면 탭을 바꾸는 것만으로 다른 쪽 결과가 바뀐다.
  // 기본은 **전부 선택** = 지금 동작 보존(과목이 하나뿐이면 추가 클릭 없이 그대로 퇴원).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allSubjects));
  /** 휴원 탭 기본값 — 대기인 수강이 있는 과목(없으면 전 과목). 규칙은 `initialHoldSubjects` 주석. */
  const [holdSelected, setHoldSelected] = useState<Set<string>>(() => initialHoldSubjects(groups));

  const toggleIn = (
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    key: string,
  ) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const plan = useMemo(
    () =>
      describeEndSelection(
        groups.length,
        groups.filter((g) => selected.has(g.subject)).map((g) => subjects.labelOf(g.subject)),
      ),
    [groups, selected, subjects],
  );
  const holdPlan = useMemo(
    () =>
      describeHoldSelection(
        groups.length,
        groups.filter((g) => holdSelected.has(g.subject)).map((g) => subjects.labelOf(g.subject)),
        // 체크가 풀렸는데 그 과목에 대기인 수강이 있는 것 = 저장하면 다시 수강으로 돌아간다.
        groups
          .filter((g) => g.heldCount > 0 && !holdSelected.has(g.subject))
          .map((g) => subjects.labelOf(g.subject)),
      ),
    [groups, holdSelected, subjects],
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
      notifyTermPlansChanged();
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

        {/* 전환 칩 — 🔴 **지금 상태와 같은 칩은 잠근다**(원장 2026-09-16 *"이미 재원 중인데, 재원 복구가 왜
            활성화 되어있지? 알아서 비활성화"*). 재원인 학생을 '재원 복구'로 보내면 할 일이 없는 저장이 되고,
            휴원인 학생을 '휴원'으로, 퇴원인 학생을 '퇴원'으로 보내는 것도 같다. 판정은 원값(statusKey)으로. */}
        <div className="border-border mb-4 flex gap-1 rounded-full border p-1">
          <ChipButton current={target} value="withdrawn" onClick={setTarget} label="퇴원" disabled={statusKey === "withdrawn"} />
          <ChipButton current={target} value="on_hold" onClick={setTarget} label="휴원" disabled={statusKey === "on_hold"} />
          <ChipButton current={target} value="enrolled" onClick={setTarget} label="재원 복구" disabled={statusKey === "enrolled"} />
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
              <SubjectPicker
                label="종료할 과목"
                groups={groups}
                selected={selected}
                onToggle={(key) => toggleIn(setSelected, key)}
                onToggleAll={(all) => setSelected(all ? new Set(allSubjects) : new Set())}
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
                  onChange={(e) => setPickedDate(e.target.value)}
                  className="border-border bg-card text-foreground num w-full rounded-lg border px-3 py-2 text-sm"
                />
                {!isPartial && pickedDate > kstToday() ? (
                  <p className="text-muted-foreground text-sm">
                    퇴원 예약입니다 — 퇴원일 전날까지는 재원으로 남고, 퇴원일에 자동으로 퇴원 처리됩니다.
                  </p>
                ) : null}
              </div>
              {/* 대분류 · 세부(선택) · 메모(기타는 필수) — 퇴원은 students.withdrawal_metadata, 부분 종료는 고른 수강 행
                  (`enrollments.withdrawal_detail`·`withdrawal_memo`, 0367a)에 남는다(원장 2026-10-15 사유 2단계). */}
              <ReasonFields
                reasonLabel={isPartial ? "종료 사유" : "퇴원 사유"}
                initialReason={null}
                memoPlaceholder="배경 정보 (선택)"
                labelClassName={FIELD_LABEL}
                controlClassName={FIELD_CONTROL}
              />
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
              {/* 🔴 퇴원과 **같은 규약 · 단위는 과목**(원장 2026-09-16): 체크한 과목의 수업이 전부 대기로 간다.
                  전 과목을 체크하면 종전대로 학생 상태까지 '휴원'이 된다. */}
              <SubjectPicker
                label="쉬는 과목"
                groups={groups}
                selected={holdSelected}
                onToggle={(key) => toggleIn(setHoldSelected, key)}
                onToggleAll={(all) => setHoldSelected(all ? new Set(allSubjects) : new Set())}
                subjects={subjects}
                markHeld
              />
              <p className="text-muted-foreground text-sm">
                대기로 바뀐 수업은 수강 등록이 유지된 채 시간표·출석부에서 &lsquo;대기&rsquo;로 표시되고,
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
 * **과목** 고르기 — 퇴원 탭과 휴원 탭이 같은 부품을 쓴다(두 벌이면 한쪽만 고쳐진다, #77과 같은 결).
 *
 * 🔑 한 줄 = 한 과목(원장 2026-09-16 *"내 말은 한 과목의 '한 수업'"*). 그 과목의 반은 줄 안에 작게 적는다
 *    (몇 반이 함께 가는지 누르기 전에 보여야 한다).
 * 🔑 **제출 값은 수강 id 그대로** — 보이는 체크박스엔 name을 달지 않고, 고른 과목의 수강 id마다 hidden input을
 *    하나씩 싣는다(`idsOf`). 두 서버 액션이 종전 모양(`getAll("enrollmentIds")`)으로 받으므로 서버 계약이 안 바뀐다.
 * ⚠️ 활성 수강이 0개면 아무것도 안 그린다 — 고를 것이 없다(안내는 호출부의 plan 문구가 한다).
 */
function SubjectPicker({
  label,
  groups,
  selected,
  onToggle,
  onToggleAll,
  subjects,
  /** 휴원 탭 — 대기인 수강이 있는 과목에 표식을 단다(체크를 풀면 되돌아간다는 사실이 보여야 한다). */
  markHeld = false,
}: {
  label: string;
  groups: SubjectGroup[];
  selected: Set<string>;
  onToggle: (subject: string) => void;
  onToggleAll: (all: boolean) => void;
  subjects: ReturnType<typeof useSubjectMaps>;
  markHeld?: boolean;
}) {
  if (groups.length === 0) return null;
  const allSelected = selected.size === groups.length;
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
      {/* 제출 값 — 고른 과목의 수강 id 전부(보이는 체크박스는 과목 단위라 name이 없다). */}
      {idsOf(groups, selected).map((id) => (
        <input key={id} type="hidden" name="enrollmentIds" value={id} />
      ))}
      <ul className="border-border max-h-44 space-y-1 overflow-auto rounded-lg border px-2 py-1.5">
        {groups.map((g) => {
          const classes = g.classNames.join(" · ");
          const held =
            g.heldCount === 0 ? null : g.heldCount === g.enrollmentIds.length ? "휴원 중" : "일부 대기";
          return (
            <li key={g.subject}>
              <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded-md px-1 py-1">
                <input
                  type="checkbox"
                  checked={selected.has(g.subject)}
                  onChange={() => onToggle(g.subject)}
                  className="size-3.5 shrink-0"
                />
                <Pill color={subjects.colorOf(g.subject)}>{subjects.labelOf(g.subject)}</Pill>
                {/* 반 이름은 작게 한 줄 — 길면 잘리고 전체는 마우스 오버로. */}
                <span className="text-text-dim min-w-0 flex-1 truncate text-xs" title={classes}>
                  {g.enrollmentIds.length > 1 ? `${g.enrollmentIds.length}개 수업 · ` : ""}
                  {classes}
                </span>
                {markHeld && held ? (
                  <span className="text-amber shrink-0 text-xs font-medium">{held}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChipButton({
  current,
  value,
  onClick,
  label,
  disabled = false,
}: {
  current: Target;
  value: Target;
  onClick: (v: Target) => void;
  label: string;
  /** 지금 상태와 같은 전환 — 누를 일이 없다(원장 2026-09-16). */
  disabled?: boolean;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      disabled={disabled}
      aria-disabled={disabled}
      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : disabled
            ? "text-text-faint cursor-not-allowed opacity-40"
            : "text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {label}
    </button>
  );
}
