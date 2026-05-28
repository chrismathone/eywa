"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  closeOrphanEnrollments,
  type CleanupState,
} from "@/features/admin/server/actions";
import type { OrphanReport } from "@/features/admin/server/queries";

function CleanBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
      자동 종료 실행
    </Button>
  );
}

export function CleanupClient({ report }: { report: OrphanReport }) {
  const [state, action] = useActionState<CleanupState, FormData>(
    closeOrphanEnrollments,
    undefined,
  );

  return (
    <div className="space-y-4">
      {/* 1. 수강 없는 재원생 */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-semibold">수강 없는 재원생</h2>
          <span className="num text-muted-foreground text-xs">
            {report.studentsWithoutEnrollments.length}명
          </span>
        </header>
        <p className="text-muted-foreground text-xs">
          status=enrolled인데 활성 enrollment가 없습니다. 학생 상세에서 반 배정하거나 상태를
          변경하세요.
        </p>
        {report.studentsWithoutEnrollments.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {report.studentsWithoutEnrollments.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/students/${s.id}`}
                  className="text-chart-1 hover:underline text-xs"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-chart-2 mt-2 inline-flex items-center gap-1 text-xs">
            <CheckCircle2 className="size-3" />
            문제 없음
          </p>
        )}
      </section>

      {/* 2. 스케줄 없는 활성 반 */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-semibold">스케줄 없는 활성 반</h2>
          <span className="num text-muted-foreground text-xs">
            {report.classesWithoutSchedules.length}개
          </span>
        </header>
        <p className="text-muted-foreground text-xs">
          is_active=true인데 class_schedules가 없습니다. 시간표에 등장하지 않습니다.
        </p>
        {report.classesWithoutSchedules.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {report.classesWithoutSchedules.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/classes/${c.id}/edit`}
                  className="text-chart-1 hover:underline text-xs"
                >
                  {c.className}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-chart-2 mt-2 inline-flex items-center gap-1 text-xs">
            <CheckCircle2 className="size-3" />
            문제 없음
          </p>
        )}
      </section>

      {/* 3. 퇴원 학생의 활성 enrollment */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-semibold">
            퇴원 학생의 활성 수강
          </h2>
          <span className="num text-muted-foreground text-xs">
            {report.enrollmentsWithoutEndDate}건
          </span>
        </header>
        <p className="text-muted-foreground text-xs">
          status=withdrawn인 학생의 enrollment 중 end_date=null인 row가 있습니다. 자동 종료 처리하세요.
        </p>
        {report.enrollmentsWithoutEndDate > 0 ? (
          <form action={action} className="mt-3">
            <CleanBtn />
            {state?.error ? (
              <p className="text-chart-4 mt-2 text-xs">{state.error}</p>
            ) : null}
            {state?.closedCount !== undefined ? (
              <p className="text-chart-2 mt-2 text-xs">
                {state.closedCount}건 자동 종료 완료
              </p>
            ) : null}
          </form>
        ) : (
          <p className="text-chart-2 mt-2 inline-flex items-center gap-1 text-xs">
            <CheckCircle2 className="size-3" />
            문제 없음
          </p>
        )}
      </section>
    </div>
  );
}
