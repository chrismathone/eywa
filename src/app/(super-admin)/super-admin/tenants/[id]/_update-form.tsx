"use client";

import { useActionState } from "react";
import { updateTenant, type UpdateTenantState } from "@/features/super-admin/server/actions";

const initial: UpdateTenantState = undefined;

export function UpdateTenantForm({ id, name, plan }: { id: string; name: string; plan: string }) {
  const [state, formAction, pending] = useActionState(updateTenant, initial);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-foreground text-[12px] font-semibold">학원 이름</span>
        <input
          type="text"
          name="name"
          defaultValue={name}
          className="border-line text-foreground mt-1 block w-full rounded-md border bg-transparent px-3 py-2 text-[13px]"
        />
      </label>
      <label className="block">
        <span className="text-foreground text-[12px] font-semibold">플랜</span>
        <input
          type="text"
          name="plan"
          defaultValue={plan}
          className="border-line text-foreground mt-1 block w-full rounded-md border bg-transparent px-3 py-2 text-[13px]"
        />
      </label>

      {state?.error ? (
        <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[12px]">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="bg-primary-soft text-primary rounded-md px-3 py-2 text-[12px]">저장됨</p>
      ) : null}

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center rounded-md px-4 py-2 text-[12px] font-bold disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
