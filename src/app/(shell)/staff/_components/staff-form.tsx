"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createStaff,
  updateStaff,
  type StaffFormState,
} from "@/features/staff/server/actions";
import type { SystemRole } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";

type Mode = "create" | "edit";

export type StaffFormValue = {
  id?: string;
  displayName: string;
  email: string;
  phone: string | null;
  systemRole: SystemRole;
  hireDate: string | null;
  jobTitle: string | null;
  subjects: string[];
  defaultClassroom: string | null;
  memo: string | null;
};

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "등록" : "저장"}
    </Button>
  );
}

export function StaffForm({
  mode,
  initialValue,
  assignableRoleOptions,
  jobTitleOptions = [],
  scope,
}: {
  mode: Mode;
  initialValue?: StaffFormValue;
  assignableRoleOptions: SystemRole[];
  jobTitleOptions?: string[];
  /** 동시 편집 가드 스코프(예: `staff:123`). 수정 모드에서만 — 다른 창 저장 시 경고. */
  scope?: string;
}) {
  const action = mode === "create" ? createStaff : updateStaff;
  const [state, formAction] = useActionState<StaffFormState, FormData>(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });

  // 저장 성공 확정(nonce) 후: 동시편집 신호 발화 → 직원관리로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      notifySaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, router]);

  const v: StaffFormValue = initialValue ?? {
    displayName: "",
    email: "",
    phone: null,
    systemRole: assignableRoleOptions[0] ?? "viewer",
    hireDate: null,
    jobTitle: null,
    subjects: [],
    defaultClassroom: null,
    memo: null,
  };

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="이름 *" htmlFor="displayName" error={errors.displayName}>
          <input
            id="displayName"
            name="displayName"
            defaultValue={v.displayName}
            required
            placeholder="예: 박지훈"
            className={inputClass}
          />
        </Field>
        <Field label="이메일 *" htmlFor="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={v.email}
            required
            placeholder="staff@example.com"
            className={inputClass}
            readOnly={mode === "edit"}
          />
        </Field>
      </div>

      {mode === "create" ? (
        <Field label="임시 비밀번호 *" htmlFor="password" error={errors.password}>
          <input
            id="password"
            name="password"
            type="text"
            required
            minLength={8}
            placeholder="8자 이상, 직원에게 직접 안내"
            className={inputClass}
          />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <Field label="시스템 권한" htmlFor="systemRole">
            <select
              id="systemRole"
              name="systemRole"
              defaultValue={v.systemRole}
              className={inputClass}
            >
              {assignableRoleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-1 text-xs">본인보다 약한 역할만 부여 가능</p>
          </Field>
        ) : null}
        <Field label="직급" htmlFor="jobTitle">
          <input
            id="jobTitle"
            name="jobTitle"
            list="jobTitleOptions"
            defaultValue={v.jobTitle ?? ""}
            placeholder="예: 강사 / 실장 (학원 설정의 직급 또는 직접 입력)"
            className={inputClass}
          />
          {jobTitleOptions.length > 0 ? (
            <datalist id="jobTitleOptions">
              {jobTitleOptions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          ) : null}
        </Field>
      </div>

      <Field label="연락처" htmlFor="phone">
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={v.phone ?? ""}
          placeholder="예: 010-1234-5678"
          className={`${inputClass} num`}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="채용일" htmlFor="hireDate">
          <input
            id="hireDate"
            name="hireDate"
            type="date"
            defaultValue={v.hireDate ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="기본 강의실" htmlFor="defaultClassroom">
          <input
            id="defaultClassroom"
            name="defaultClassroom"
            defaultValue={v.defaultClassroom ?? ""}
            placeholder="예: 301호"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="담당 과목" htmlFor="subjects">
        <input
          id="subjects"
          name="subjects"
          defaultValue={v.subjects.join(", ")}
          placeholder="예: math, english"
          className={inputClass}
        />
        <p className="text-muted-foreground mt-1 text-xs">쉼표로 구분</p>
      </Field>

      <Field label="메모" htmlFor="memo">
        <textarea
          id="memo"
          name="memo"
          defaultValue={v.memo ?? ""}
          rows={3}
          placeholder="자유 메모"
          className={`${inputClass} resize-y`}
        />
      </Field>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-foreground block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
