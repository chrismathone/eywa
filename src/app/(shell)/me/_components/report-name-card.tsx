"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { REPORT_NAME_MAX } from "@/features/onescreen/report-author-name";
import { updateMyReportName, type MeAccountState } from "@/features/staff/server/me-actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

/**
 * 수업보고서 발송용 이름(0217a) — 학부모에게 나가는 수업보고서(ClassNote 게시 작성자명·공유 링크
 * '담임' 칸·인쇄본)에 실명 대신 표시할 이름을 본인이 정한다. 비우고 저장하면 실명으로 돌아간다.
 *
 * ⚠️ #83: `<form action>`은 제출마다(실패 응답 포함) 자동 리셋된다 — 0217a 미적용 에러에서 방금 친
 * 이름이 증발하면 안 되므로 **제어 입력 + onSubmit 직접 디스패치**(자동 리셋 무력화)로 제출한다.
 */
export function ReportNameCard({
  realName,
  initialName,
  mappingBlocked,
}: {
  realName: string;
  initialName: string | null;
  /** 이름은 저장돼 있는데 발송 매핑이 안 걸리는 상태(동명 직원 등) — 카드가 사실을 밝힌다([[#89]]). */
  mappingBlocked: boolean;
}) {
  const [state, action, pending] = useActionState<MeAccountState, FormData>(updateMyReportName, undefined);
  const [name, setName] = useState(initialName ?? "");
  const seen = useRef<MeAccountState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "저장했습니다");
  }, [state]);

  return (
    <section className="border-line bg-card rounded-2xl border p-5 shadow-card">
      <h2 className="text-foreground text-sm font-bold">수업보고서 이름</h2>
      <p className="text-text-dim mt-1 text-xs">
        학부모에게 나가는 수업보고서(클래스노트 게시·공유 링크·인쇄)에 표시할 이름입니다. 비워 두면
        실명(<b>{realName}</b>)으로 나갑니다.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault(); // #83 자동 리셋 차단 — 에러가 돌아와도 입력이 남는다.
          const fd = new FormData();
          fd.set("reportName", name);
          startTransition(() => action(fd));
        }}
        className="mt-4"
      >
        <label htmlFor="me-report-name" className="micro mb-1 block">
          발송에 표시할 이름
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="me-report-name"
            name="reportName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={REPORT_NAME_MAX}
            // 예시에 실명("OO 선생님")을 섞지 않는다 — 원장 지시 2026-08-18 "하드 코딩된 이름 삭제".
            placeholder="예: 영어 이름"
            autoComplete="off"
            className={`${inputClass} max-w-72 flex-1`}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            저장
          </Button>
        </div>
      </form>
      {mappingBlocked ? (
        <p className="mt-2 text-xs leading-snug text-amber-700">
          저장된 이름이 있지만 같은 이름의 직원이 있어 지금은 <b>실명으로 발송</b>되고 있습니다 —
          관리자에게 문의하세요.
        </p>
      ) : null}
      <p className="text-text-faint mt-1 text-xs">
        다음 발송부터 새 이름으로 나가고, <b>이미 보낸 보고서도</b> 학부모가 공유 링크를 다시 열면 새
        이름으로 보입니다(게시된 이미지 속 이름은 그대로).
      </p>
    </section>
  );
}
