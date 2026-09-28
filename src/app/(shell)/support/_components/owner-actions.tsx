"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SupportRequestForm } from "./request-form";

/**
 * 작성자 전용 동작 — '접수'이고 답변이 달린 적 없을 때만 서버가 이 부품을 내려준다(처리가 시작되면 잠금, 서버 액션도 다시 본다).
 * 작성자는 지우지 못한다(원장 2026-09-28) — 고치기만 있다.
 */
export function SupportRequestOwnerActions({
  requestId,
  initial,
}: {
  requestId: string;
  initial: { title: string; body: string; contactPhone: string; contactEmail: string };
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <SupportRequestForm initial={initial} requestId={requestId} onCancel={() => setEditing(false)} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>
        요청 수정
      </Button>
      <span className="text-text-dim text-sm">
        운영팀이 확인을 시작하거나 답변을 달면 고칠 수 없습니다. 올린 요청은 지울 수 없습니다.
      </span>
    </div>
  );
}
