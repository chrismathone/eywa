"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { deleteStudent } from "@/features/students/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

/**
 * 학생 영구 삭제 — 잘못 추가한 경우 즉시 정정용. 2단계 확인(클릭 → '삭제 확정').
 * 청구 기록이 있으면 서버가 막고 사유를 반환(퇴원 처리 안내). 성공 시 **온 자리로** 돌아간다.
 * (권한 게이트는 서버 + 페이지 렌더에서 이중 — 이 컴포넌트는 admin 쓰기 가능자에게만 렌더된다.)
 *
 * 🔴 이동은 `assign`이 아니라 **`replace`**다(원장 2026-09-09: *"신규생 관리에서 학생이 삭제되고 뒤로가기를
 *    눌러도 안 가지고 자꾸 원생목록으로 가지네"*). 방금 지운 학생의 상세 URL은 **죽은 항목**이라
 *    `assign`으로 그 위에 한 칸을 더 쌓으면 뒤로가기가 그 404 자리에 떨어지고, 신규생 관리는 두 칸 뒤가 된다.
 *    `replace`는 죽은 칸을 덮어써서 뒤로가기가 **진짜 이전 화면**으로 간다.
 * 🔴 목적지도 `/students` 고정이 아니다 — 상세는 창(iframe) 안에서 **드릴인**으로 열리므로
 *    (`WindowLink`가 iframe 안에선 평범한 Link로 떨어진다) 목록을 고정하면 **신규생 관리 창이 원생목록 창으로
 *    바뀌어 버린다**(창의 `params.href`는 그대로라 사이드바에서 신규생 관리를 다시 눌러도 포커스만 되고
 *    화면은 원생목록 그대로 = 원장이 본 "자꾸 원생목록"). 목록이 `?back=<경로>`로 온 자리를 알려 준다.
 * ⚠️ 창 안이면 `embed=1`을 유지한다 — 빠뜨리면 그 이동만 풀 셸로 서버 렌더된다(크롬은 `HideInFrame`이
 *    클라에서 감추지만, 애초에 안 그리는 게 맞다).
 */
export function DeleteStudentButton({
  studentId,
  studentName,
  backHref = "/students?list=1",
}: {
  studentId: string;
  studentName: string;
  /** 삭제 뒤 돌아갈 자리 — 서버(page.tsx)가 `isInternalPath`로 검증해 넘긴다. 기본 = 원생목록. */
  backHref?: string;
}) {
  const inFrame = useInFrame();
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
        notifyTermPlansChanged();
        // 죽은 상세 칸을 **덮어쓰며** 온 자리로(뒤로가기가 그 404에 걸리지 않게). 하드 내비라 목록은
        // 항상 새로 그려진다 = 방금 지운 학생이 남아 보이지 않는다.
        window.location.replace(inFrame ? withEmbed(backHref) : backHref);
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
    <div className="border-danger/40 bg-danger-soft/40 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1">
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
