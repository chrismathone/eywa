"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="group w-full" size="lg" disabled={pending}>
      <span>{pending ? "로그인 중…" : "로그인"}</span>
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next ?? ""} />

      <div className="space-y-2">
        <Label htmlFor="email" className="eyebrow">
          이메일
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="name@academy.kr"
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="eyebrow">
            비밀번호
          </Label>
          <span className="text-muted-foreground text-[11px]">관리자에게 문의</span>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          placeholder="••••••••"
          className="h-11"
        />
      </div>

      {state?.error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <SubmitButton />

      <p className="text-muted-foreground border-border border-t pt-5 text-center text-xs leading-relaxed">
        계정 발급은 원장 또는 시스템 담당자에게 요청하세요.
      </p>
    </form>
  );
}
