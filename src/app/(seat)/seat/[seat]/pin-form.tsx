"use client";

import { useActionState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { submitSeatPin, type SeatPinResult } from "@/features/attendance/seat/server/pin-actions";

export function SeatPinForm({
  seat,
  seatName,
  academyLine,
  branches,
}: {
  seat: string;
  seatName: string;
  academyLine: string;
  /**
   * 지점 선택지 — 학원이 **둘 이상**일 때만 온다(하나면 서버가 그대로 확정, 결정 C 2026-09-18: URL에 지점 없음).
   * 고른 값은 `tenant`로 제출되고 서버가 목록 안인지 다시 본다(#77 — 화면 목록은 게이트가 아니다).
   */
  branches?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<SeatPinResult, FormData>(submitSeatPin, undefined);
  const askBranch = (branches?.length ?? 0) > 1;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <form action={action} className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-text-dim text-xs font-medium tracking-wide">{academyLine}</p>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">{seatName} 출석부</h1>
          <p className="text-text-dim text-sm">
            {askBranch ? "지점을 고르고 비밀번호를 입력하면 오늘 출석을 찍을 수 있습니다." : "비밀번호를 입력하면 오늘 출석을 찍을 수 있습니다."}
          </p>
        </header>
        <input type="hidden" name="seat" value={seat} />
        {askBranch ? (
          <SearchableSelect
            name="tenant"
            options={branches!.map((b) => ({ value: b.id, label: b.name }))}
            placeholder="지점 선택"
            ariaLabel="지점"
            // PIN 입력칸(rounded-xl · py-3)과 같은 상자 — 태블릿에서 두 칸이 한 벌로 읽히게.
            triggerClassName="border-line bg-card text-foreground focus:border-primary rounded-xl border px-4 py-3 text-base"
          />
        ) : null}
        <label className="block">
          <span className="sr-only">비밀번호</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus={!askBranch}
            disabled={pending}
            className="border-line bg-card text-foreground focus:border-primary w-full rounded-xl border px-4 py-3 text-center text-xl tracking-[0.4em] outline-none"
          />
        </label>
        {state?.error ? (
          <p className="text-att-absent-ink text-center text-sm" role="alert">
            {state.error}
          </p>
        ) : (
          <p className="h-5" />
        )}
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "확인 중…" : "입장"}
        </button>
      </form>
    </main>
  );
}
