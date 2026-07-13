"use client";

import { useActionState, useEffect, useState } from "react";
import { ExternalLink, TriangleAlert, UserCheck, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { deactivateStaff } from "@/features/staff/server/actions";
import type { HomeroomClassRow } from "@/features/staff/server/queries";
import { Footer, Modal, SubmitBtn } from "./dialog-bits";

/**
 * 퇴사 확인 다이얼로그 — 이 직원이 담임인 진행중 반이 있을 때만 뜬다.
 * 경고 + 반 목록(각 반 상세 링크) + 인수인계 안내를 보여주되, 퇴사 자체는 막지 않는다.
 * (퇴사해도 담임 배정은 자동 해제되지 않아 시간표·출석부에 "(퇴직)" 담임으로 남는 구조 갭 안내.)
 */
function DeactivateDialog({
  staffId,
  displayName,
  classes,
  onClose,
}: {
  staffId: string;
  displayName: string;
  classes: HomeroomClassRow[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(deactivateStaff, undefined);
  // 조건부 마운트(open ? … : null)라 성공 닫기 effect가 재오픈을 즉시 닫지 않는다(#67 안전).
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal title="퇴사 처리" desc={displayName} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-amber inline-flex items-start gap-1.5 text-sm font-medium">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          이 직원이 담임인 진행중인 반이 {classes.length}개 있습니다.
        </p>
        <p className="text-text-dim text-xs">
          퇴사 처리해도 담임 배정은 자동으로 해제되지 않아, 시간표·출석부에 ‘(퇴직)’ 담임으로 계속
          표시됩니다. 반 이름을 눌러 각 반 상세의{" "}
          <span className="text-foreground font-medium">강사 인수인계</span>로 새 담임을 지정해
          주세요.
        </p>
        <ul className="border-line divide-line max-h-44 divide-y overflow-y-auto rounded-md border">
          {classes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <WindowLink
                href={`/classes/${c.id}`}
                title={c.className}
                className="text-foreground hover:text-primary truncate font-medium hover:underline"
              >
                {c.className}
              </WindowLink>
              {c.pendingTeacherName ? (
                <span className="text-primary shrink-0 text-[11px]">
                  인수인계 예약됨 → {c.pendingTeacherName}
                  {c.pendingTeacherDate ? <span className="num"> · {c.pendingTeacherDate}</span> : null}
                </span>
              ) : (
                <span className="text-text-faint shrink-0 text-[11px]">인수인계 없음</span>
              )}
            </li>
          ))}
        </ul>
        <WindowLink
          href={`/classes?teacher=${staffId}`}
          title="수업목록"
          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
        >
          수업목록에서 이 강사의 반 모두 보기
          <ExternalLink className="size-3" />
        </WindowLink>
        <form action={action}>
          <input type="hidden" name="id" value={staffId} />
          <input type="hidden" name="next" value="inactive" />
          {state?.error ? <p className="text-chart-4 mb-2 text-xs">{state.error}</p> : null}
          <Footer onClose={onClose}>
            <SubmitBtn label="그래도 퇴사 처리" />
          </Footer>
        </form>
      </div>
    </Modal>
  );
}

/** 퇴사/재직복구 — 담임인 진행중 반이 있으면 경고 다이얼로그, 없으면 confirm 인라인(기존 패턴). */
export function DeactivateButton({
  staffId,
  displayName,
  currentStatus,
  homeroomClasses,
}: {
  staffId: string;
  displayName: string;
  currentStatus: "active" | "inactive" | "pending";
  homeroomClasses: HomeroomClassRow[];
}) {
  const [state, action] = useActionState(deactivateStaff, undefined);
  const [open, setOpen] = useState(false);
  const isInactive = currentStatus === "inactive";

  if (!isInactive && homeroomClasses.length > 0) {
    return (
      <>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserMinus className="size-3.5" />
          퇴사 처리
        </Button>
        {open ? (
          <DeactivateDialog
            staffId={staffId}
            displayName={displayName}
            classes={homeroomClasses}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const msg = isInactive
          ? `${displayName} 직원을 재직 복구할까요?`
          : `${displayName} 직원을 퇴사 처리할까요? 로그인·목록에서 비활성됩니다 (기록은 보존).`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={staffId} />
      <input type="hidden" name="next" value={isInactive ? "active" : "inactive"} />
      <Button type="submit" variant="outline" size="sm">
        {isInactive ? <UserCheck className="size-3.5" /> : <UserMinus className="size-3.5" />}
        {isInactive ? "재직 복구" : "퇴사 처리"}
      </Button>
      {state?.error ? <span className="text-chart-4 ml-2 text-xs">{state.error}</span> : null}
      {/* 렌더 시점 목록이 stale해 경고 없이 지나갔는데 서버가 담임 반을 발견한 경우 — 사후 안내(차단 아님) */}
      {state?.ok && (state.homeroomCount ?? 0) > 0 ? (
        <span className="text-amber ml-2 text-xs">
          담임인 진행중 반 {state.homeroomCount}개가 남아 있습니다 — 각 반에서 강사 인수인계를
          진행하세요.
        </span>
      ) : null}
    </form>
  );
}
