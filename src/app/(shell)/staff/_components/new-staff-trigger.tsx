"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

/** 직원 등록 = 이력서 작성 페이지(원장 지시 2026-07-28 — 이력서·직원등록 통합, 저장 시 계정까지 원샷). */
export function NewStaffTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/staff/resumes/new", "직원 등록", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />
      직원 등록
    </Button>
  );
}
