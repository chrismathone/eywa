"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Printer, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { deleteStaffResume } from "@/features/staff/server/resume-actions";

/** 이력서 뷰 인쇄 — 플로팅 창(iframe) 안이라 이 문서만 A4(print-portrait)로 인쇄된다. */
export function PrintResumeButton() {
  return (
    // 2차 액션 = outline(1차는 '수정' 하나) — 채움 버튼 둘이 나란히 경쟁하지 않게.
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      인쇄
    </Button>
  );
}

export function DeleteResumeButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <span className="text-text-dim whitespace-nowrap">{name || "이"} 이력서 삭제?</span>
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
            toast.success("이력서를 삭제했습니다");
            router.push("/staff?tab=resumes");
          }}
          className="text-danger font-semibold hover:underline"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "삭제"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-text-dim hover:underline">
          취소
        </button>
      </span>
    );
  }
  return (
    <Button variant="outline" onClick={() => setConfirming(true)}>
      <Trash2 className="size-4" />
      삭제
    </Button>
  );
}
