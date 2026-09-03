"use client";

import { useActionState } from "react";
import { createTenantWithMaster, type CreateTenantState } from "@/features/super-admin/server/actions";
import { PasswordInput } from "@/components/ui/password-input";

const initial: CreateTenantState = undefined;

export function NewTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantWithMaster, initial);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <Field
        name="slug"
        label="학원 slug"
        placeholder="ijw-demo"
        hint="영문 소문자·숫자·하이픈 3~40자. 도메인 식별자로 사용."
        error={fe.slug}
      />
      <Field name="name" label="학원 이름" placeholder="인재원" error={fe.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="masterEmail"
          type="email"
          label="원장 이메일"
          placeholder="owner@academy.kr"
          error={fe.masterEmail}
        />
        <Field
          name="masterPassword"
          type="password"
          label="초기 비밀번호"
          placeholder="8자 이상"
          error={fe.masterPassword}
        />
      </div>
      <Field name="displayName" label="원장 표시명" placeholder="김수진" error={fe.displayName} />
      <Field name="plan" label="플랜" defaultValue="free" hint="free · pro · enterprise 등 자유 입력" />

      {state?.error ? (
        <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-xs">{state.error}</p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground shadow-primary-glow inline-flex items-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-bold disabled:opacity-60"
        >
          {pending ? "생성 중…" : "학원 + 원장 발급"}
        </button>
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
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-foreground text-xs font-bold">{label}</span>
      {type === "password" ? (
        <PasswordInput
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={`border-line text-foreground mt-1 block h-auto w-full rounded-md border bg-transparent px-3 py-2 text-sm ${
            error ? "border-danger" : ""
          }`}
        />
      ) : (
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={`border-line text-foreground mt-1 block w-full rounded-md border bg-transparent px-3 py-2 text-sm ${
            error ? "border-danger" : ""
          }`}
        />
      )}
      {error ? (
        <p className="text-danger mt-1 text-xs">{error}</p>
      ) : hint ? (
        <p className="text-text-dim mt-1 text-xs">{hint}</p>
      ) : null}
    </label>
  );
}
