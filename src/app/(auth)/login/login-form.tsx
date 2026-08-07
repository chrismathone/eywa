"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { resolveLoginLanding } from "@/features/shell/landing-action";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!email) {
      setError("이메일을 입력해주세요");
      setPending(false);
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다");
      setPending(false);
      return;
    }

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      const message = /invalid login credentials/i.test(signInError.message)
        ? "이메일 또는 비밀번호가 올바르지 않습니다"
        : signInError.message;
      setError(message);
      setPending(false);
      return;
    }

    // 역할별 기본 착지 지점: 강사=원스크린, 학생=내 학습 현황, 그 외(원장 등)=대시보드.
    // ⚠️ 이건 **폴백**이다 — 강사 홈은 담당 과목으로 갈리는데(영어 전담=ECS) 그건 DB에만 있어
    // 클라의 JWT role만으론 못 정한다. 서버에 물어보고(resolveLoginLanding), 세션 쿠키가 아직
    // 안 실렸거나 실패하면 여기로 떨어진다(로그인 자체는 절대 안 막는다).
    const role = data.user?.app_metadata?.system_role as string | undefined;
    const fallback =
      role === "teacher" ? "/onescreen" : role === "student" ? "/my-learning" : "/dashboard";
    let home = fallback;
    try {
      home = (await resolveLoginLanding()) ?? fallback;
    } catch {
      home = fallback;
    }
    const target = next && next.startsWith("/") ? next : home;
    router.push(target);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="eyebrow">
            비밀번호
          </Label>
          <span className="text-muted-foreground text-[11px]">관리자에게 문의</span>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={6}
          placeholder="••••••••"
          className="h-11"
          disabled={pending}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" className="group w-full" size="lg" disabled={pending}>
        <span>{pending ? "로그인 중…" : "로그인"}</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Button>

      <p className="text-muted-foreground border-border border-t pt-5 text-center text-xs leading-relaxed">
        계정 발급은 원장 또는 시스템 담당자에게 요청하세요.
      </p>
    </form>
  );
}
