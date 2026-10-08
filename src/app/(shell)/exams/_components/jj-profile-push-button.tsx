"use client";

/**
 * 인재원에 **짝 맞춘 학생 전원의 학교·학년·생년월일**을 지금 보낸다(원장 2026-10-08 *"전부 보내줘"*) — 하루 한 번 cron과 같은 일.
 * 결과(보낸 수·인재원에 없는 아이디·못 읽은 값)를 그 자리에 적는다. 짝 잇기와 같은 사람(학생 기록 관리)만 보인다.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pushIjwProfilesNow } from "@/features/ijw/server/link-actions";

export function JjProfilePushButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await pushIjwProfilesNow();
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            const line = `${res.sent}명 보냄 · 인재원 반영 ${res.updated}명${res.notFound ? ` · 인재원에 없는 아이디 ${res.notFound}개` : ""}${res.invalid ? ` · 못 읽은 값 ${res.invalid}개` : ""}`;
            setResult(line);
            toast.success(line);
          })
        }
      >
        {pending ? "보내는 중…" : "인재원에 학교·학년·생일 보내기"}
      </Button>
      <span className="text-text-faint text-xs break-keep">
        {result ?? "짝을 맞춘 학생 전원 — 매일 새벽에도 자동으로 보냅니다"}
      </span>
    </div>
  );
}
