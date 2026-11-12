"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PlanField } from "@/components/super-admin/plan-field";
import { NEW_TENANT_LICENSE_OPTIONS } from "@/features/super-admin/new-tenant-licenses";
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
      <section aria-labelledby="new-tenant-features-title" className="border-line border-t pt-4">
        <div>
          <h2 id="new-tenant-features-title" className="text-base font-bold">처음 사용할 기능</h2>
          <p className="text-foreground mt-1 text-xs">만든 뒤 학원 상세의 라이선스에서도 바꿀 수 있습니다.</p>
        </div>
        <div className="divide-line mt-2 divide-y">
          {NEW_TENANT_LICENSE_OPTIONS.map((feature) => (
            <label key={feature.key} className="relative flex cursor-pointer items-center justify-between gap-4 py-3">
              <input type="hidden" name={feature.key} value="false" />
              <input
                type="checkbox"
                role="switch"
                name={feature.key}
                value="true"
                defaultChecked={feature.defaultOn}
                disabled={pending}
                aria-describedby={`new-tenant-${feature.key}-description`}
                className="peer sr-only"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{feature.label}</span>
                <span id={`new-tenant-${feature.key}-description`} className="text-foreground mt-0.5 block text-xs">
                  {feature.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="border-line bg-muted peer-checked:bg-primary peer-focus-visible:ring-ring/50 peer-disabled:opacity-60 inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition peer-checked:border-transparent peer-focus-visible:ring-2 peer-checked:[&>span]:translate-x-5"
              >
                <span className="bg-card size-5 rounded-full shadow-sm transition-transform" />
              </span>
            </label>
          ))}
        </div>
      </section>

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
