"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { submitLeaveRequest, type LeaveActionState } from "@/features/leave/server/actions";
import { LEAVE_KIND_LABEL } from "@/features/leave/types";
import {
  countLeaveDays,
  formatLeaveDays,
  validateLeaveRange,
  type LeaveKind,
} from "@/features/leave/request-days";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

const KIND_OPTIONS = [
  { value: "annual", label: LEAVE_KIND_LABEL.annual, hint: "하루 단위" },
  { value: "half", label: LEAVE_KIND_LABEL.half, hint: "0.5일 · 하루만" },
];

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      휴가 신청
    </Button>
  );
}

/**
 * 휴가 신청 폼. 차감 일수는 화면에서도 **같은 순수 함수**(countLeaveDays)로 미리 보여준다 —
 * 서버가 다시 계산하므로 표시는 어디까지나 예고이고, 규칙이 갈라질 여지가 없다.
 *
 * ⚠️ 잔여를 넘으면 **버튼을 잠근다**(원장 2026-08-14: *"잔여없으면 신청 자체를 못하자나"*).
 *    다만 이건 알려주기용이고 **판정의 근거는 서버 액션**이다 — 화면은 게이트가 아니다([[#77]]).
 */
export function RequestForm({
  periodEnd,
  remaining,
  today,
}: {
  periodEnd: string;
  remaining: number;
  today: string;
}) {
  const [state, action] = useActionState<LeaveActionState, FormData>(submitLeaveRequest, undefined);
  const [kind, setKind] = useState<LeaveKind>("annual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const seen = useRef<LeaveActionState>(undefined);

  // 반차는 하루뿐 — 종료일을 시작일에 붙여 둔다(폼에서 칸이 사라져도 값이 어긋나지 않게).
  const effectiveEnd = kind === "half" ? start : end;
  const days = countLeaveDays(start, effectiveEnd, kind);
  // ⚠️ 위에 보이는 잔여·구간 끝은 **오늘이 속한 구간**의 값이다. 시작일이 그 구간을 지나면(입사 응당일
  //    이후 휴가) 서버는 **그 날이 속한 다음 구간**으로 판정하므로, 여기서 현재 구간 잣대를 들이대면
  //    화면만 "기간 초과"라고 거짓말을 한다 — 그럴 땐 구간·잔여 검사를 접고 안내만 띄운다.
  const inCurrentPeriod = !!start && start <= periodEnd;
  const invalid = validateLeaveRange({
    start,
    end: effectiveEnd,
    kind,
    periodEnd: inCurrentPeriod ? periodEnd : null,
  });
  const over =
    inCurrentPeriod && !invalid && days > remaining
      ? remaining <= 0
        ? "남은 연차가 없어 신청할 수 없습니다"
        : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다`
      : null;
  const blocked = !!invalid || !!over;

  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "신청했습니다");
  }, [state]);

  return (
    <form action={action} className="border-line bg-card shadow-card space-y-4 rounded-2xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">휴가 신청</h2>
        <p className="text-text-faint text-[11px]">
          연차 사용 기간 <span className="num">{periodEnd}</span>까지 · 일요일은 차감하지 않습니다
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="micro mb-1 block">종류</span>
          <SearchableSelect
            options={KIND_OPTIONS}
            value={kind}
            onValueChange={(v) => setKind(v === "half" ? "half" : "annual")}
            name="kind"
            ariaLabel="휴가 종류"
          />
        </label>
        <label className="block">
          <span className="micro mb-1 block">시작일</span>
          <input
            type="date"
            name="startDate"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              // 종료일이 앞서면 함께 끌어올린다(역순 입력으로 막히지 않게).
              if (e.target.value > end) setEnd(e.target.value);
            }}
            className={inputClass}
            required
          />
        </label>
        {kind === "half" ? (
          <input type="hidden" name="endDate" value={start} />
        ) : (
          <label className="block">
            <span className="micro mb-1 block">종료일</span>
            <input
              type="date"
              name="endDate"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className={inputClass}
              required
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="micro mb-1 block">사유 (선택)</span>
        {/* ⚠️ 비제어 입력 — React 19가 action 성공 후 폼을 자동 리셋하므로 사유가 저절로 비워진다
            (effect에서 setState로 비우면 react-hooks/set-state-in-effect 위반, [[#25]]).
            날짜·종류는 일수 미리보기 계산에 쓰여야 해서 제어 상태로 남긴다(리셋 대상 아님). */}
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="예: 가족 행사"
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-[13px]">
          {invalid ? (
            <span className="text-danger">{invalid}</span>
          ) : (
            <>
              <span className="text-text-dim">차감 </span>
              <b className="num text-foreground">{formatLeaveDays(days)}</b>
              {inCurrentPeriod ? (
                <>
                  <span className="text-text-faint"> / 잔여 </span>
                  <b className="num text-foreground">{formatLeaveDays(remaining)}</b>
                </>
              ) : (
                <span className="text-text-faint"> · 다음 연차 구간이라 잔여는 그 구간 기준으로 계산됩니다</span>
              )}
              {over ? <span className="text-danger ml-2 font-medium">{over}</span> : null}
            </>
          )}
        </p>
        <SubmitButton blocked={blocked} />
      </div>
    </form>
  );
}
