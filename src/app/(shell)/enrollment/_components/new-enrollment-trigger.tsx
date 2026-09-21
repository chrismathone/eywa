"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

export function NewEnrollmentTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/enrollment/new", "신규 콜&상담", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />
      신규 등록
    </Button>
  );
}
