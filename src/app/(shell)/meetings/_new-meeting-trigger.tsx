"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

/**
 * /meetings 목록 페이지에서 "새 회의록" 트리거.
 * /meetings/new 라우트를 플로팅 윈도우로 연다(폼은 해당 라우트와 공유).
 */
export function NewMeetingTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/meetings/new", "새 회의록", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />
      새 회의록
    </Button>
  );
}
