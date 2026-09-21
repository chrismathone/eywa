"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

export function NewConsultationTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/consultations/new", "상담 기록 추가", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />
      상담 추가
    </Button>
  );
}
