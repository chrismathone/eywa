"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";

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
  /** 시간표 강사 헤더 색(ijw Teacher.bgColor 패리티). 글자색은 저장 시 자동 도출. */
  bgColor: string | null;
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
  const { markSaved } = useUnsavedGuard({ formRef });

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
    bgColor: null,
  };

  const [bgColor, setBgColor] = useState(v.bgColor ?? "");
  // 직급 입력(uncontrolled) — 빠른 선택 칩이 값을 채울 수 있게 ref. 칩 클릭 시 input 이벤트를
  // 발화해 초안 자동저장·동시편집 가드가 변경을 포착하게 한다(setter 직접 호출은 이벤트 미발화).
  const jobTitleRef = useRef<HTMLInputElement>(null);
  const pickJobTitle = (t: string) => {
    const el = jobTitleRef.current;
    if (!el) return;
    el.value = t;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  // 로컬 초안 자동저장 — 입력 중 보관, 다시 열면 복구. ⚠️ 임시비번(password)은 보안상 IDB 캡처 제외,
  // 색(bgColor)은 hidden input으로 값 캡처되나 스와치 동기화 위해 onRestore→setBgColor.
  const draft = useFormDraft({
    scope: mode === "create" ? "staff:new" : `staff:${initialValue?.id ?? "edit"}`,
    formRef,
    exclude: ["password"],
    // systemRole은 빈 옵션 없이 항상 첫 역할이 제출되므로 빈 폼 오탐 배너 방지로 의미판정서 제외.
    ignoreForBanner: ["systemRole"],
    onRestore: (vals) => setBgColor(vals.bgColor ?? ""),
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 직원관리로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft]);

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
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
            ref={jobTitleRef}
            defaultValue={v.jobTitle ?? ""}
            placeholder="직접 입력하거나 아래에서 선택"
            className={inputClass}
          />
          {/* 학원 설정(operations.jobTitles)의 직급을 빠른 선택 칩으로 — 항상 노출(현재 값과 무관).
              datalist(▼)는 크롬이 입력값으로 제안을 필터링해 "부장" 같은 설정 밖 값이 차 있으면 빈
              드롭다운처럼 보였다(#오해). 칩은 항상 보이고, 클릭하면 채워지며, 직접 입력도 그대로. */}
          {jobTitleOptions.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {jobTitleOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickJobTitle(t)}
                  className="border-line text-text-dim hover:border-primary hover:text-primary rounded border px-2 py-0.5 text-xs transition"
                >
                  {t}
                </button>
              ))}
            </div>
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

      <Field label="시간표 색" htmlFor="bgColor">
        <input type="hidden" name="bgColor" value={bgColor} />
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={bgColor || "#1a5f3c"}
            onChange={(e) => setBgColor(e.target.value)}
            aria-label="강사 색"
            className="border-input h-8 w-12 cursor-pointer rounded border"
          />
          {bgColor ? (
            <>
              <span className="text-text-dim font-mono text-xs">{bgColor}</span>
              <button
                type="button"
                onClick={() => setBgColor("")}
                className="text-text-faint hover:text-foreground text-xs underline"
              >
                지우기
              </button>
            </>
          ) : (
            <span className="text-text-faint text-xs">미설정(기본 해시색)</span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          시간표 강사 헤더 밴드 색(ijw 패리티). 글자색은 자동.
        </p>
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

      <FormActionBar>
        <SubmitButton mode={mode} />
      </FormActionBar>
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
