"use client";

import { useActionState } from "react";
import { toggleLaboratoryMenu } from "@/features/super-admin/server/laboratory-actions";

export function LaboratoryMenuToggle({ menu, label, assigned }: { menu: string; label: string; assigned: boolean }) {
  const [state, action, pending] = useActionState(toggleLaboratoryMenu, undefined);
  return <li className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
    <span className="text-foreground text-sm font-medium">{label}</span>
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="menu" value={menu} />
      <input type="hidden" name="enable" value={String(!assigned)} />
      <span className="text-foreground text-sm">{assigned ? "실험실" : "일반"}</span>
      <button type="submit" role="switch" aria-checked={assigned} aria-label={`${label} 실험실 지정`} disabled={pending}
        className={`inline-flex h-6 w-11 cursor-pointer items-center rounded-full px-0.5 disabled:opacity-60 ${assigned ? "bg-green justify-end" : "bg-muted border-line justify-start border"}`}>
        <span className="bg-card size-5 rounded-full shadow-sm" />
      </button>
    </form>
    {state?.error ? <p role="alert" className="text-danger w-full text-right text-xs">{state.error}</p> : null}
  </li>;
}
