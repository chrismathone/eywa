"use client";

import { useRef, useState, type FormEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import styles from "@/components/public-site/public-site.module.css";
import { safeLoginNext } from "@/lib/auth/login-next";
import { loginErrorMessage } from "@/lib/auth/login-error";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);

    if (!email || password.length < 6) {
      setError(!email ? "이메일을 입력해 주세요." : "비밀번호는 6자 이상 입력해 주세요.");
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(loginErrorMessage(signInError));
      } else {
        // Full document navigation ensures the server sees the new session cookie.
        // /home resolves the user's role and teaching subject; never guess it here.
        window.location.assign(safeLoginNext(next) ?? "/home");
        return;
      }
    } catch {
      setError("로그인 서버에 연결하지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주세요.");
    }
    submitting.current = false;
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className={styles.loginForm} aria-busy={pending} aria-describedby={error ? "login-error" : undefined}>
      <div className={styles.formField}>
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required placeholder="name@academy.kr" disabled={pending} />
      </div>
      <div className={styles.formField}>
        <label htmlFor="password">비밀번호</label>
        <div className={styles.passwordField}>
          <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} placeholder="비밀번호를 입력해 주세요" disabled={pending} />
          <button type="button" onClick={() => setShowPassword((show) => !show)} disabled={pending} aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"} aria-pressed={showPassword} aria-controls="password">
            <EyIcon name={showPassword ? "eyeOff" : "eye"} size={19} />
          </button>
        </div>
      </div>
      {error ? <div id="login-error" role="alert" className={styles.loginError}><EyIcon name="alert" size={17} /><span>{error}</span></div> : null}
      <button type="submit" className={styles.loginSubmit} disabled={pending}>
        <span>{pending ? "로그인 중…" : "로그인"}</span>
        {pending ? null : <EyIcon name="arrowRight" size={18} />}
      </button>
    </form>
  );
}
