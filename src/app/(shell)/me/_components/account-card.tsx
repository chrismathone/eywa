"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { EmailIdField } from "@/components/forms/email-id-field";
import { PasswordInput } from "@/components/ui/password-input";
import {
  updateMyEmail,
  updateMyPassword,
  type MeAccountState,
} from "@/features/staff/server/me-actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/** 액션 결과를 토스트로 흘리고 성공 시 폼을 비운다(비밀번호는 화면에 남기지 않는다). */
function useResultToast(state: MeAccountState, onOk?: () => void) {
  const seen = useRef<MeAccountState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.notice ?? "저장했습니다");
      onOk?.();
    }
  }, [state, onOk]);
}

export function AccountCard({ email, isPlaceholder }: { email: string; isPlaceholder: boolean }) {
  const [emailState, emailAction] = useActionState<MeAccountState, FormData>(updateMyEmail, undefined);
  const [pwState, pwAction] = useActionState<MeAccountState, FormData>(updateMyPassword, undefined);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  useResultToast(emailState);
  useResultToast(pwState, () => {
    setPw("");
    setPw2("");
  });

  return (
    <section className="border-line bg-card rounded-2xl border p-5 shadow-card">
      <h2 className="text-foreground text-sm font-bold">내 계정</h2>
      <p className="text-text-dim mt-1 text-xs">
        {isPlaceholder
          ? "지금 로그인 주소는 임시로 만든 것입니다 — 본인 이메일로 바꾸고 비밀번호도 바꿔 주세요."
          : "로그인에 쓰는 이메일과 비밀번호를 직접 바꿀 수 있습니다."}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
        <form action={emailAction} className="flex flex-col">
          <label htmlFor="me-email" className="micro mb-1 block">
            로그인 이메일
          </label>
          {/* 아이디만 고치고 도메인은 고정(지금 쓰는 도메인 그대로) — 전체 주소 타이핑 오타 방지. */}
          <EmailIdField id="me-email" defaultEmail={email} inputClassName={inputClass} />
          <p className="text-text-faint mt-1 text-xs">
            바꾸면 <b>다음 로그인부터</b> 새 주소를 씁니다. 지금 로그인은 그대로 유지됩니다.
          </p>
          <div className="mt-auto pt-3">
            <SubmitButton label="이메일 변경" />
          </div>
        </form>

        <form action={pwAction} className="flex flex-col">
          <label htmlFor="me-pw" className="micro mb-1 block">
            새 비밀번호
          </label>
          <PasswordInput
            id="me-pw"
            name="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            placeholder="8자 이상"
          />
          <label htmlFor="me-pw2" className="micro mt-3 mb-1 block">
            새 비밀번호 확인
          </label>
          <PasswordInput
            id="me-pw2"
            name="passwordConfirm"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            placeholder="한 번 더"
          />
          <div className="mt-auto pt-3">
            <SubmitButton label="비밀번호 변경" />
          </div>
        </form>
      </div>
    </section>
  );
}
