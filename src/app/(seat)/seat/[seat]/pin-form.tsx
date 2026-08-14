"use client";

import { useActionState } from "react";
import { submitSeatPin, type SeatPinResult } from "@/features/attendance/seat/server/pin-actions";

export function SeatPinForm({
  seat,
  seatName,
  academyLine,
}: {
  seat: string;
  seatName: string;
  academyLine: string;
}) {
  const [state, action, pending] = useActionState<SeatPinResult, FormData>(submitSeatPin, undefined);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <form action={action} className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-text-dim text-xs font-medium tracking-wide">{academyLine}</p>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">{seatName} 출석부</h1>
          <p className="text-text-dim text-sm">비밀번호를 입력하면 오늘 출석을 찍을 수 있습니다.</p>
        </header>
        <input type="hidden" name="seat" value={seat} />
        <label className="block">
          <span className="sr-only">비밀번호</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
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
