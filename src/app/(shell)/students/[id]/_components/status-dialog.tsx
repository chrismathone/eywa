"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { changeStudentStatus, type ChangeStatusState } from "@/features/students/server/actions";

type Target = "withdrawn" | "on_hold" | "enrolled";

const WITHDRAWAL_REASON_OPTIONS = [
  { value: "graduated", label: "졸업" },
  { value: "relocation", label: "이사" },
  { value: "competitor", label: "타학원" },
  { value: "financial", label: "경제적 사유" },
  { value: "schedule", label: "일정" },
  { value: "dissatisfaction", label: "불만족" },
  { value: "other", label: "기타" },
];

function SubmitBtn({ target }: { target: Target }) {
  const { pending } = useFormStatus();
  const label =
    target === "withdrawn" ? "퇴원 처리" : target === "on_hold" ? "휴원 처리" : "재원 복구";
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label}
    </Button>
  );
}

export function StatusDialog({
  studentId,
  studentName,
  currentStatus,
  initialTarget,
  onClose,
}: {
  studentId: string;
  studentName: string;
  currentStatus: string;
  initialTarget: Target;
  onClose: (changed: boolean) => void;
}) {
  const [state, formAction] = useActionState<ChangeStatusState, FormData>(
    changeStudentStatus,
    undefined,
  );
  const [target, setTarget] = useState<Target>(initialTarget);

  // 성공 시 1회만 닫기 — 렌더 본문 부수효과(queueMicrotask) 대신 가드된 effect(#67).
  // 부모가 조건부 마운트({open ? … })라 닫히면 언마운트 → useActionState 리셋 → stale 성공 재발화 불가.
  const closedRef = useRef(false);
  useEffect(() => {
    if (state && !state.error && !closedRef.current) {
      closedRef.current = true;
      onClose(true);
    }
  }, [state, onClose]);

  const isWithdraw = target === "withdrawn";
  const isHold = target === "on_hold";
  const isRestore = target === "enrolled";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">학생 상태 전환</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">{studentName}</h2>
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
        <div className="border-border mb-4 flex gap-1 rounded-md border p-1">
          <ChipButton current={target} value="withdrawn" onClick={setTarget} label="퇴원" />
          <ChipButton current={target} value="on_hold" onClick={setTarget} label="휴원" />
          <ChipButton current={target} value="enrolled" onClick={setTarget} label="재원 복구" />
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={studentId} />
          <input type="hidden" name="target" value={target} />

          {isWithdraw ? (
            <>
              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">퇴원일</label>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={kstToday()}
                  className="border-border bg-card text-foreground num w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">퇴원 사유</label>
                <select
                  name="reason"
                  required
                  className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
                >
                  {WITHDRAWAL_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">상세 메모</label>
                <textarea
                  name="memo"
                  rows={3}
                  placeholder="배경 정보 (선택)"
                  className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <p className="text-muted-foreground text-[11px]">
                활성 수강 등록은 모두 종료되며, 퇴원관리 페이지에 자동 노출됩니다.
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
                  className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </>
          ) : isRestore ? (
            <p className="text-muted-foreground text-sm">
              학생을 재원 상태로 복구합니다. 퇴원/휴원 사유 기록은 삭제되며 활성 수강이 다시 활성화됩니다.
            </p>
          ) : null}

          {state?.error ? (
            <p className="text-chart-4 text-sm">{state.error}</p>
          ) : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              취소
            </Button>
            <SubmitBtn target={target} />
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
      className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {label}
    </button>
  );
}
