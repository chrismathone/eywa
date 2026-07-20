"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "@/components/icons/eywa-icon-compat";
import { clearDupSuspect } from "@/features/students/server/actions";

/**
 * 동명이인 '의심' 알림 + 해제 — makeedu 동기화가 이름 충돌로 자동 접미사(테스트→테스트A)한 학생 상세에 표시.
 * "정상 확인"(실제 다른 학생 맞음) → dup_suspect=false로 배지 제거. 실제 같은 사람(중복)이면 관리자 병합 도구로.
 * canClear = students 쓰기(full) 권한자에게만 버튼 노출(액션도 서버에서 이중 게이트).
 */
export function DupSuspectNotice({ studentId, canClear }: { studentId: string; canClear: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const clear = () =>
    start(async () => {
      setErr(null);
      const res = await clearDupSuspect(studentId);
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  return (
    <div className="border-amber/40 bg-amber/10 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs">
      <AlertTriangle className="text-amber size-3.5 shrink-0" />
      <span className="text-foreground">
        동기화가 이름 겹침으로 <b>자동 구분(접미사)</b>한 학생입니다 — 실제 동명이인인지 확인해 주세요.
        (같은 사람이면 관리자 <b>중복 병합</b>으로 합치세요.)
      </span>
      {err ? <span className="text-danger">{err}</span> : null}
      {canClear ? (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="border-amber/50 text-amber hover:bg-amber/20 ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium whitespace-nowrap transition disabled:opacity-60"
        >
          <Check className="size-3" />
          {pending ? "확인 중…" : "정상 확인"}
        </button>
      ) : null}
    </div>
  );
}
