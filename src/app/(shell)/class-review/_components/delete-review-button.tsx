"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { deleteClassReview } from "@/features/class-review/server/actions";

/**
 * 수업 평가 건 삭제 — 잘못 만든 건 정리(원장 지시 2026-08-14). 학생 삭제 버튼과 같은
 * **2단계 확인**(클릭 → '삭제 확정') + 성공 시 목록으로 이동. 서버 액션이 이미 있었는데
 * 호출부가 없어 화면에서 지울 방법이 없었다.
 *
 * ⚠️ 지우면 **그 건에 모인 평가자들의 채점이 통째로** 사라진다(되돌리기 없음) — 그래서 확인
 *    문구에 제출 건수를 박아 "몇 명 것이 사라지는지"를 누르기 전에 보이게 한다.
 * ⚠️ 이동은 `window.location.assign` — 서버 액션 **직후의 `router.push`는 액션 응답이 현재
 *    페이지 RSC 트리를 다시 적용하면서 삼켜진다**(#102). 게다가 지워진 건의 상세에 남으면 404다.
 */
export function DeleteReviewButton({
  docId,
  teacherName,
  date,
  submittedCount,
}: {
  docId: string;
  teacherName: string;
  date: string;
  submittedCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setErr(null);
    const fd = new FormData();
    fd.set("docId", docId);
    startTransition(async () => {
      const res = await deleteClassReview(undefined, fd);
      if (res?.ok) {
        window.location.assign("/class-review"); // 삭제 후 목록으로(창 내 전체 이동)
      } else {
        setErr(res?.error ?? "삭제에 실패했습니다"); // 사유 노출, 확인 상태 유지
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
        평가 삭제
      </Button>
    );
  }

  return (
    <div className="border-danger/40 bg-danger-soft/40 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1">
      <span className="text-danger text-xs font-medium break-keep">
        “{teacherName} · {date}” 삭제?{" "}
        <span className="text-danger/70">
          {submittedCount > 0 ? `제출된 채점 ${submittedCount}건이 함께 사라지며 ` : ""}되돌릴 수 없습니다
        </span>
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
