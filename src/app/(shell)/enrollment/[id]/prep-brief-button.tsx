"use client";

import { useActionState } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { useFormStatus } from "react-dom";
import { AlertCircle, RefreshCw, Sparkles } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { generatePrepBrief, type PrepBriefState } from "@/features/enrollment/server/prep-actions";

function SubmitButton({ exists }: { exists: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={exists ? "outline" : "default"} disabled={pending}>
      {exists ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
      {pending ? "작성 중…" : exists ? "다시 작성" : "브리프 만들기"}
    </Button>
  );
}

/**
 * 사전 브리프 생성 트리거 — **명시 버튼만**(페이지 로드로는 절대 안 돈다, AI 캐싱 규칙).
 * 액션은 동기 완료(사실 수집 + 짧은 생성) 후 revalidate → 같은 화면에 브리프가 나타난다.
 */
function PrepBriefButtonInner({ consultationId, exists }: { consultationId: string; exists: boolean }) {
  const [state, formAction] = useActionState<PrepBriefState, FormData>(generatePrepBrief, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <SubmitButton exists={exists} />
      </form>
      {state?.error ? (
        <p className="text-destructive inline-flex items-center gap-1 text-xs">
          <AlertCircle className="size-3" />
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/** AI 라이선스가 꺼진 지점엔 이 버튼·카드가 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 generateJSON이 따로 막는다. */
export function PrepBriefButton(props: Parameters<typeof PrepBriefButtonInner>[0]) {
  return useLicenseOn("ai_analysis") ? <PrepBriefButtonInner {...props} /> : null;
}
