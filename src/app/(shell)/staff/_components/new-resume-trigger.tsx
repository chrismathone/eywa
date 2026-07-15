"use client";

import { Plus } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

/**
 * '새 이력서' = autoClose 창(생성 폼 규약) — WindowLink는 창 안에서 드릴인으로 떨어져
 * 목록이 사라지고 저장해도 창이 안 닫힌다. 같은 화면의 '직원 등록'(NewStaffTrigger)과 동일 패턴.
 */
export function NewResumeTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/staff/resumes/new", "직원 이력서 작성", e)}>
      <Plus className="size-4" />새 이력서
    </Button>
  );
}
