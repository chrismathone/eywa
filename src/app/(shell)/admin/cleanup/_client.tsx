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
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* 1. 수강 없는 재원생 */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-semibold">수강 없는 재원생</h2>
          <span className="num text-muted-foreground text-xs">
            {report.studentsWithoutEnrollments.length}명
          </span>
        </header>
        <p className="text-muted-foreground text-xs">
          상태가 재원인데 수강 중인 반이 없습니다. 학생 상세에서 반을 배정하거나 상태를
          변경하세요.
        </p>
        {report.studentsWithoutEnrollments.length > 0 ? (
          <OrphanList
            items={report.studentsWithoutEnrollments}
            href={(s) => `/students/${s.id}`}
            label={(s) => s.name}
          />
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
          운영 중인 반인데 주간 스케줄이 없습니다. 시간표에 표시되지 않습니다.
        </p>
        {report.classesWithoutSchedules.length > 0 ? (
          <OrphanList
            items={report.classesWithoutSchedules}
            href={(c) => `/classes/${c.id}/edit`}
            label={(c) => c.className}
          />
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
          퇴원한 학생인데 종료되지 않은 수강 기록이 남아 있습니다. 자동 종료 처리하세요.
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

const ORPHAN_CAP = 50;

/** 고아 목록 — 50개까지만 렌더하고 나머지는 <details>로 접는다(카운트는 섹션 헤더에 이미 표시). */
function OrphanList<T extends { id: string }>({
  items,
  href,
  label,
}: {
  items: T[];
  href: (item: T) => string;
  label: (item: T) => string;
}) {
  const shown = items.slice(0, ORPHAN_CAP);
  const rest = items.slice(ORPHAN_CAP);
  const Row = (item: T) => (
    <li key={item.id}>
      <Link href={href(item)} className="text-chart-1 text-xs hover:underline">
        {label(item)}
      </Link>
    </li>
  );
  return (
    <ul className="mt-3 space-y-1">
      {shown.map((item) => Row(item))}
      {rest.length > 0 ? (
        <li>
          <details>
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs">
              + {rest.length}개 더보기
            </summary>
            <ul className="mt-1 space-y-1">{rest.map((item) => Row(item))}</ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}
