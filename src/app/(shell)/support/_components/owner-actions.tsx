"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { deleteSupportRequest } from "@/features/support/server/actions";
import { SupportRequestForm } from "./request-form";

/**
 * 작성자 전용 동작 — '접수'이고 답변이 없을 때만 서버가 이 부품을 내려준다(처리가 시작되면 잠금, 서버 액션도 다시 본다).
 */
export function SupportRequestOwnerActions({
  requestId,
  initial,
}: {
  requestId: string;
  initial: { title: string; body: string; contactPhone: string; contactEmail: string };
}) {
  const embed = useEmbed();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (editing) {
    return <SupportRequestForm initial={initial} requestId={requestId} onCancel={() => setEditing(false)} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
        요청 수정
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("이 개선요청을 지울까요? 되돌릴 수 없습니다.")) return;
          setError(null);
          start(async () => {
            const res = await deleteSupportRequest(requestId);
            if ("error" in res) {
              setError(res.error);
              return;
            }
            const href = "/support?tab=requests";
            window.location.assign(embed ? withEmbed(href) : href);
          });
        }}
      >
        {pending ? "지우는 중…" : "요청 삭제"}
      </Button>
      <span className="text-text-dim text-sm">운영팀이 확인을 시작하거나 답변을 달면 고치거나 지울 수 없습니다.</span>
      {error ? <p className="text-danger w-full text-sm">{error}</p> : null}
    </div>
  );
}
