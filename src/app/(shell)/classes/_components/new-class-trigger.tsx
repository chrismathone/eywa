"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

export function NewClassTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <button
      type="button"
      onClick={(e) => openFormWindow("/classes/new", "새 반 생성", e)}
      className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition"
    >
      <EyIcon name="plus" size={13} />
      새 반
    </button>
  );
}
