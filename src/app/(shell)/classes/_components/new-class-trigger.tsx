"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

export function NewClassTrigger() {
  const openFormWindow = useOpenFormWindow();

  // 헤더 액션은 공용 `<Button>` 기본 크기(h-8)로 통일한다 — 손으로 깎은 `px-3 py-1.5 text-xs`는
  // 옆의 '강의실 배정'(outline Button)과 높이·글자가 따로 놀았다(design-conventions "버튼 크기").
  return (
    <Button onClick={(e) => openFormWindow("/classes/new", "새 반 생성", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />새 반
    </Button>
  );
}
