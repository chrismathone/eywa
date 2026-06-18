"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  assignAttendanceCodesAction,
  registerKioskDevice,
  revokeKioskDevice,
  type KioskActionState,
} from "@/features/attendance/kiosk/server/actions";

function Notice({ state }: { state: KioskActionState }) {
  if (!state) return null;
  if (state.error)
    return <p className="text-danger mt-2 text-[13px]">{state.error}</p>;
  if (state.ok) return <p className="text-primary mt-2 text-[13px]">{state.ok}</p>;
  return null;
}

export function AssignCodesForm() {
  const [state, action, pending] = useActionState<KioskActionState, FormData>(
    assignAttendanceCodesAction,
    undefined,
  );
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "발급 중…" : "출석번호 일괄 발급"}
      </button>
      <Notice state={state} />
    </form>
  );
}

export function RegisterDeviceForm() {
  const [state, action, pending] = useActionState<KioskActionState, FormData>(
    registerKioskDevice,
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        placeholder="기기 이름 (예: 1층 현관)"
        className="border-border bg-card h-9 rounded-md border px-3 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="border-border hover:bg-bg-soft h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "등록 중…" : "이 기기를 키오스크로 등록"}
      </button>
      {state?.ok ? (
        <Link
          href="/kiosk"
          className="bg-primary rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          키오스크 열기 →
        </Link>
      ) : null}
      <Notice state={state} />
    </form>
  );
}

export function RevokeDeviceButton({ deviceId }: { deviceId: string }) {
  const [state, action, pending] = useActionState<KioskActionState, FormData>(
    revokeKioskDevice,
    undefined,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="deviceId" value={deviceId} />
      <button
        type="submit"
        disabled={pending}
        className="text-danger hover:bg-danger/5 rounded px-2 py-1 text-[12px] disabled:opacity-50"
      >
        {pending ? "…" : "폐기"}
      </button>
      {state?.error ? <span className="text-danger ml-1 text-[11px]">{state.error}</span> : null}
    </form>
  );
}
