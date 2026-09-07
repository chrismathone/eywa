"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { EmailIdField } from "@/components/forms/email-id-field";
import { PasswordInput } from "@/components/ui/password-input";
// 강사 미니셸이면 화면 언어를 따른다 — 관리자 풀셸에는 provider가 없어 한국어 그대로다.
import { useSheetT } from "@/features/teacher-view/lang-context";
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
  const t = useSheetT();
  const seen = useRef<MeAccountState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      // 🔴 서버가 준 사유(state.notice)는 그대로 — 지어내지 않는다. 기본 문구만 언어를 따른다.
      toast.success(state.notice ?? t("me.saved"));
      onOk?.();
    }
  }, [state, onOk, t]);
}

export function AccountCard({ email, isPlaceholder }: { email: string; isPlaceholder: boolean }) {
  const [emailState, emailAction] = useActionState<MeAccountState, FormData>(updateMyEmail, undefined);
  const [pwState, pwAction] = useActionState<MeAccountState, FormData>(updateMyPassword, undefined);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const t = useSheetT();
  useResultToast(emailState);
  useResultToast(pwState, () => {
    setPw("");
    setPw2("");
  });

  return (
    <section className="border-line bg-card rounded-2xl border p-5 shadow-card">
      <h2 className="text-foreground text-sm font-bold">{t("me.account")}</h2>
      <p className="text-text-dim mt-1 text-xs">
        {isPlaceholder
          ? t("me.account.placeholder")
          : t("me.account.desc")}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
        <form action={emailAction} className="flex flex-col">
          <label htmlFor="me-email" className="micro mb-1 block">
            {t("me.email")}
          </label>
          {/* 아이디만 고치고 도메인은 고정(지금 쓰는 도메인 그대로) — 전체 주소 타이핑 오타 방지. */}
          <EmailIdField id="me-email" defaultEmail={email} inputClassName={inputClass} />
          <p className="text-text-faint mt-1 text-xs">
            {t("me.email.hint.a")} <b>{t("me.email.hint.b")}</b> {t("me.email.hint.c")}
          </p>
          <div className="mt-auto pt-3">
            <SubmitButton label={t("me.email.submit")} />
          </div>
        </form>

        <form action={pwAction} className="flex flex-col">
          <label htmlFor="me-pw" className="micro mb-1 block">
            {t("me.pw.new")}
          </label>
          <PasswordInput
            id="me-pw"
            name="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            placeholder={t("me.pw.min")}
          />
          <label htmlFor="me-pw2" className="micro mt-3 mb-1 block">
            {t("me.pw.again")}
          </label>
          <PasswordInput
            id="me-pw2"
            name="passwordConfirm"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            placeholder={t("me.pw.againPh")}
          />
          <div className="mt-auto pt-3">
            <SubmitButton label={t("me.pw.submit")} />
          </div>
        </form>
      </div>
    </section>
  );
}
