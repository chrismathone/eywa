"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PlanField } from "@/components/super-admin/plan-field";
import { createTenantWithMaster, type CreateTenantState } from "@/features/super-admin/server/actions";

const initial: CreateTenantState = undefined;

export function NewTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantWithMaster, initial);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <Field
        name="slug"
        label="학원 코드"
        placeholder="예: hanbit"
        hint="영문 소문자·숫자·하이픈 2~40자(학원·지점 약어). 한 번 정하면 바꾸지 않습니다."
        error={fe.slug}
      />
      <Field name="name" label="학원 이름" placeholder="예: 한빛학원" error={fe.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="masterEmail" type="email" label="원장 이메일" placeholder="owner@academy.kr" error={fe.masterEmail} />
        <Field name="masterPassword" type="password" label="초기 비밀번호" placeholder="8자 이상" error={fe.masterPassword} />
      </div>
      <Field name="displayName" label="원장 표시 이름" placeholder="김수진" error={fe.displayName} />
      <PlanField />

      {state?.error ? (
        <p className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm font-medium">{state.error}</p>
      ) : null}

      <div className="flex justify-end pt-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "만드는 중…" : "학원과 원장 계정 만들기"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  hint,
  error,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const invalid = error ? true : undefined;
  return (
    <label className="block">
      <span className="text-foreground text-sm font-bold">{label}</span>
      {type === "password" ? (
        <div className="mt-1">
          <PasswordInput name={name} placeholder={placeholder} aria-invalid={invalid} />
        </div>
      ) : (
        <Input type={type} name={name} placeholder={placeholder} aria-invalid={invalid} className="mt-1" />
      )}
      {error ? (
        <p className="text-danger mt-1 text-xs font-medium">{error}</p>
      ) : hint ? (
        <p className="text-foreground mt-1 text-xs">{hint}</p>
      ) : null}
    </label>
  );
}
