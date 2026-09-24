"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanField } from "@/components/super-admin/plan-field";
import { updateTenant, type UpdateTenantState } from "@/features/super-admin/server/actions";

const initial: UpdateTenantState = undefined;

/**
 * 학원 기본 정보(이름·플랜) 수정.
 * ⚠️ React 19는 `<form action>` 제출마다 폼을 리셋한다([[#83]]) — 입력이 `defaultValue`라 저장 뒤
 *    서버 재검증(revalidatePath)이 새 값을 내려줘 그대로 보인다(컨트롤드 입력으로 바꾸지 말 것).
 */
export function UpdateTenantForm({ id, name, plan }: { id: string; name: string; plan: string }) {
  const [state, formAction, pending] = useActionState(updateTenant, initial);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-foreground text-sm font-bold">학원 이름</span>
        <Input type="text" name="name" defaultValue={name} className="mt-1" />
      </label>
      <PlanField defaultValue={plan} />

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {state?.error ? <span className="text-danger text-sm font-medium">{state.error}</span> : null}
        {state?.ok ? <span className="text-green text-sm font-medium">저장했습니다</span> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </form>
  );
}
