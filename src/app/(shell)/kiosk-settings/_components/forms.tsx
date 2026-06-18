"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  assignAttendanceCodesAction,
  registerKioskDevice,
  revokeKioskDevice,
  saveKakaoChannel,
  sendTestAlimtalk,
  type KioskActionState,
} from "@/features/attendance/kiosk/server/actions";
import type { KakaoChannelStatus } from "@/features/attendance/kiosk/server/queries";

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
        placeholder="기기 위치/이름 (예: 1층 현관)"
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

const inputCls = "border-border bg-card h-9 w-full rounded-md border px-3 text-sm";
const labelCls = "text-text-dim mb-1 block text-[12px] font-medium";

/** 카카오 알림톡 연동 정보(pfId·등하원 템플릿·SMS대체) 저장 폼. */
export function KakaoChannelForm({ status }: { status: KakaoChannelStatus }) {
  const [state, action, pending] = useActionState<KioskActionState, FormData>(
    saveKakaoChannel,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="pfId" className={labelCls}>
          발신프로필 키 (pfId)
        </label>
        <input id="pfId" name="pfId" defaultValue={status.pfId ?? ""} placeholder="KA01PF..." className={inputCls} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="checkinTemplateId" className={labelCls}>
            등원 템플릿 ID
          </label>
          <input
            id="checkinTemplateId"
            name="checkinTemplateId"
            defaultValue={status.checkinTemplateId ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="checkoutTemplateId" className={labelCls}>
            하원 템플릿 ID
          </label>
          <input
            id="checkoutTemplateId"
            name="checkoutTemplateId"
            defaultValue={status.checkoutTemplateId ?? ""}
            className={inputCls}
          />
        </div>
      </div>
      <label className="text-foreground flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="smsFallback" defaultChecked={status.smsFallback} className="size-4" />
        알림톡 실패 시 SMS로 대체발송
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "저장 중…" : "연동 정보 저장"}
      </button>
      <Notice state={state} />
    </form>
  );
}

/** 연동 테스트 발송 — 원장 본인 번호로 등원 알림톡 1건. */
export function TestAlimtalkForm() {
  const [state, action, pending] = useActionState<KioskActionState, FormData>(
    sendTestAlimtalk,
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="grow">
        <label htmlFor="phone" className={labelCls}>
          받는 번호(원장 본인)
        </label>
        <input id="phone" name="phone" placeholder="010-0000-0000" className={inputCls} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="border-border hover:bg-bg-soft h-9 shrink-0 rounded-md border px-4 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "발송 중…" : "테스트 발송"}
      </button>
      <div className="w-full">
        <Notice state={state} />
      </div>
    </form>
  );
}
