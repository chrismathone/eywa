"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { deleteStudent } from "@/features/students/server/actions";

/**
 * 학생 영구 삭제 — 잘못 추가한 경우 즉시 정정용. 2단계 확인(클릭 → '삭제 확정').
 * 청구 기록이 있으면 서버가 막고 사유를 반환(퇴원 처리 안내). 성공 시 목록으로 이동.
 * (권한 게이트는 서버 + 페이지 렌더에서 이중 — 이 컴포넌트는 admin 쓰기 가능자에게만 렌더된다.)
 */
export function DeleteStudentButton({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setErr(null);
    const fd = new FormData();
    fd.set("id", studentId);
    startTransition(async () => {
      const res = await deleteStudent(undefined, fd);
      if (res?.ok) {
        window.location.assign("/students"); // 삭제 후 목록으로(창 내 전체 이동)
      } else {
        setErr(res?.error ?? "삭제에 실패했습니다"); // 청구기록 등 사유 노출, 확인 상태 유지
      }
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          setErr(null);
          setConfirming(true);
        }}
        className="text-danger border-danger/40 hover:bg-danger-soft"
      >
        <Trash2 className="size-3.5" />
        삭제
      </Button>
    );
  }

  return (
    <div className="border-danger/40 bg-danger-soft/40 flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1">
      <span className="text-danger text-xs font-medium">
        “{studentName}” 영구 삭제? <span className="text-danger/70">되돌릴 수 없습니다</span>
      </span>
      <Button variant="destructive" size="sm" onClick={doDelete} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : "삭제 확정"}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="text-text-faint hover:text-foreground text-xs"
      >
        취소
      </button>
      {err ? <span className="text-danger w-full text-xs">{err}</span> : null}
    </div>
  );
}
