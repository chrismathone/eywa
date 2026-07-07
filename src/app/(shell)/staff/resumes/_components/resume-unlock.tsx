"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { unlockResumeView, type ResumeUnlockState } from "@/features/staff/server/resume-actions";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";

/**
 * 이력서 열람 잠금 화면 — 작성자·원장이 아닌 사무실 직원에게 표시.
 * 본인 로그인 비밀번호를 재입력하면(step-up) 10분 열람 창이 열리고 페이지가 새로고침돼 이력서가 보인다.
 * 민감 데이터(주민번호·급여·계좌)는 이 화면에 **전혀 전달되지 않는다**(서버가 잠김일 때 미전송).
 */
export function ResumeUnlock({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ResumeUnlockState, FormData>(unlockResumeView, undefined);
  // 성공(nonce) 1회만 새로고침 — 쿠키가 생겼으니 서버가 이력서를 렌더한다([[#67]] 패턴).
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (state?.ok && state.nonce && handled.current !== state.nonce) {
      handled.current = state.nonce;
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="bg-card border-line rounded-md border p-6 text-center">
        <div className="bg-bg-soft mx-auto flex size-12 items-center justify-center rounded-full">
          <Lock className="text-text-dim size-5" />
        </div>
        <h2 className="text-foreground mt-3 text-base font-bold">열람 잠금 — {name}</h2>
        <p className="text-text-dim mt-1 text-sm">
          이 이력서에는 주민번호·급여·계좌 등 민감정보가 있어, 열람하려면 <b>본인 로그인 비밀번호</b>를
          한 번 입력해야 합니다. 확인 후 <b>이 이력서</b>를 10분간 열람할 수 있습니다(다른 이력서는 다시 확인).
        </p>
        <p className="text-text-faint mt-1 text-xs">작성자 본인과 원장은 비밀번호 없이 바로 열람됩니다.</p>

        <form action={action} className="mt-4 space-y-2 text-left">
          <input type="hidden" name="id" value={id} />
          <PasswordInput
            name="password"
            required
            autoFocus
            placeholder="로그인 비밀번호"
            autoComplete="current-password"
          />
          {state?.error ? <p className="text-danger text-xs">{state.error}</p> : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "확인 중…" : "열람"}
          </Button>
        </form>
      </div>
    </div>
  );
}
