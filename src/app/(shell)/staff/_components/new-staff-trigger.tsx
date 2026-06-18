"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

export function NewStaffTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/staff/new", "직원 등록", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />
      직원 등록
    </Button>
  );
}
