"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next?: string }) {
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
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      const message = /invalid login credentials/i.test(signInError.message)
        ? "이메일 또는 비밀번호가 올바르지 않습니다"
        : signInError.message;
      setError(message);
      setPending(false);
      return;
    }

    // 🔑 **착지 지점을 클라에서 정하지 않는다.** 강사 홈은 담당 과목(DB)으로 갈리는데(영어 전담=ECS)
    // 클라는 JWT의 role까지밖에 못 본다. 예전엔 여기서 서버 액션에 물었는데, **그 요청엔 세션 쿠키가
    // 아직 안 실릴 때가 있어**(getClaims 빈손) 같은 코드가 어떤 때는 ECS로 어떤 때는 원스크린으로 가는
    // 경합이 났다(2026-08-07 실측). 그래서 판정을 **목적지 문서 요청으로 미룬다** → `/home`(리다이렉터).
    //
    // 🔴 **`router.push`가 아니라 풀 문서 네비게이션**이어야 한다 — 이 핸들러가 서버와 주고받은 뒤
    // 클라 라우터로 이동하면, 늦게 도착한 응답이 현재 페이지 트리를 다시 적용하면서 이동을 덮는다
    // (목적지 RSC를 200으로 받아놓고도 화면은 '로그인 중…'에서 멈췄다). 뷰 전환도 같은 이유로
    // window.location을 쓴다 — 동일 규약. 부수 효과로 모든 서버 컴포넌트가 새 세션 쿠키를 확실히 본다.
    window.location.assign(next && next.startsWith("/") ? next : "/home");
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
          <span className="text-muted-foreground text-xs">관리자에게 문의</span>
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
