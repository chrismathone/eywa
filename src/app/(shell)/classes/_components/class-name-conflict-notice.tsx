"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { classNameConflictHint, type ClassNameConflict } from "@/features/classes/class-name-conflict";

/**
 * 반 이름 충돌 안내 — 반 이름 칸 바로 아래(원장 2026-10-01 *"중복되는 반이름이 있습니다. (종강처리된 반) 같은 식으로
 * 명확하게"*). 무엇과 겹쳤는지(그 반의 상태)를 적고, 겹친 반이 **운영 중이 아닐 때만** 그 반 이름을 비우고 저장하는
 * 버튼을 준다. 운영 중인 반이면 문구만.
 *
 * 🔴 버튼은 `type="button"` — submit 버튼으로 두면 반 이름 칸에서 Enter를 칠 때 **폼의 첫 submit 버튼**인 이 버튼이
 *    눌린 것으로 제출돼, 묻지도 않고 남의 반 이름을 바꾼다. 누른 경우에만 부모가 플래그를 실어 다시 보낸다.
 */
export function ClassNameConflictNotice({
  conflict,
  pending,
  onFree,
}: {
  conflict: ClassNameConflict;
  pending: boolean;
  onFree: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hint = classNameConflictHint(conflict);
  // 저장 버튼은 아래 고정 바, 이 칸은 맨 위 — 결과가 오면 칸을 보이는 곳으로 끌어온다(긴 폼에서 놓치지 않게).
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [conflict]);

  return (
    <div ref={ref} role="alert" className="space-y-1.5">
      <p className="text-chart-4 text-xs break-keep">{conflict.message}</p>
      {conflict.freeTo ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onFree}
            className="h-auto min-h-(--control-h) py-1 text-left break-keep whitespace-normal"
          >
            그 반 이름을 &lsquo;{conflict.freeTo}&rsquo;로 바꾸고 저장
          </Button>
          <p className="text-muted-foreground text-xs break-keep">
            그 반의 수강·출결·성적 기록은 반에 그대로 붙어 있고 이름만 바뀝니다.
          </p>
        </>
      ) : hint ? (
        <p className="text-muted-foreground text-xs break-keep">{hint}</p>
      ) : null}
    </div>
  );
}
