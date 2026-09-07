"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Printer, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { deleteStaffResume } from "@/features/staff/server/resume-actions";

/** 이력서 뷰 인쇄 — 플로팅 창(iframe) 안이라 이 문서만 A4(print-portrait)로 인쇄된다. */
export function PrintResumeButton() {
  const t = useSheetT();
  return (
    // 2차 액션 = outline(1차는 '수정' 하나) — 채움 버튼 둘이 나란히 경쟁하지 않게.
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      {t("res.print")}
    </Button>
  );
}

export function DeleteResumeButton({ id, name }: { id: string; name: string }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <span className="text-text-dim whitespace-nowrap">
          {name ? tf("res.del.askNamed", { name }) : t("res.del.ask")}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await deleteStaffResume(id);
            if (res.error) {
              toast.error(res.error);
              setBusy(false);
              setConfirming(false);
              return;
            }
            toast.success(t("res.del.done"));
            router.push("/staff");
          }}
          className="text-danger font-bold hover:underline"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : t("res.delete")}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-text-dim hover:underline">
          {t("res.cancel")}
        </button>
      </span>
    );
  }
  return (
    <Button variant="outline" onClick={() => setConfirming(true)}>
      <Trash2 className="size-4" />
      {t("res.delete")}
    </Button>
  );
}
