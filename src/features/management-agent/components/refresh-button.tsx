"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { refreshManagementCases } from "../server/actions";

export function RefreshCasesButton() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div className="space-y-2">
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      try { const r = await refreshManagementCases(); setMessage(r.error ?? r.message ?? ""); if (!r.error) router.refresh(); }
      catch { setMessage("최신 상태를 확인하지 못했습니다. 다시 시도해 주세요."); }
    })}>{pending ? "확인 중…" : "최신 상담 확인"}</Button>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
