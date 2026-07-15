"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Trash2, UserMinus, Wrench } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import {
  closeOrphanEnrollments,
  bulkWithdrawStudents,
  bulkDeleteStudents,
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
          상태가 재원인데 수강 중인 반이 없고, <b>마지막 수강이 끝난 지 30일이 지난</b> 학생입니다.
          반을 배정하거나, 선택해서 퇴원·삭제 처리하세요. 최근에 반이 폐지·종강돼 수강이 끊긴
          학생은 여기 대신 대시보드 &lsquo;반 미배정 재원생&rsquo;에서 바로 재배정하세요.
        </p>
        {report.studentsWithoutEnrollments.length > 0 ? (
          <OrphanStudentManager items={report.studentsWithoutEnrollments} />
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

/**
 * 수강 없는 재원생 — 전체/개별 선택 후 일괄 퇴원(가역) 또는 삭제(영구, 청구기록 있으면 제외).
 * 선택 상태는 현재 렌더된 항목으로 라이브 필터(액션 성공 시 목록이 줄면 사라진 id는 자동 해제 — setState-in-effect 회피).
 */
function OrphanStudentManager({
  items,
}: {
  items: { id: string; name: string; status: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wState, withdrawAction, wPending] = useActionState(bulkWithdrawStudents, undefined);
  const [dState, deleteAction, dPending] = useActionState(bulkDeleteStudents, undefined);

  const itemIds = new Set(items.map((i) => i.id));
  const live = [...selected].filter((id) => itemIds.has(id));
  const ids = live.join(",");
  const count = live.length;
  const allSelected = items.length > 0 && count === items.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5" />
          전체 선택
        </label>
        {count > 0 ? <span className="num text-primary text-xs">{count}명 선택</span> : null}
      </div>

      <ul className="max-h-72 space-y-1 overflow-auto pr-1">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              className="size-3.5 shrink-0"
            />
            <Link href={`/students/${s.id}`} className="text-chart-1 truncate text-xs hover:underline">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>

      {count > 0 ? (
        <div className="border-border mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          {confirmDelete ? (
            <form action={deleteAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="ids" value={ids} />
              <span className="text-muted-foreground text-xs">
                {count}명 영구 삭제? (청구 기록 있으면 제외)
              </span>
              <Button type="submit" variant="destructive" size="sm" disabled={dPending}>
                {dPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                삭제 확정
              </Button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-text-faint hover:text-foreground text-xs"
              >
                취소
              </button>
            </form>
          ) : (
            <>
              <form action={withdrawAction}>
                <input type="hidden" name="ids" value={ids} />
                <Button type="submit" variant="outline" size="sm" disabled={wPending || dPending}>
                  {wPending ? <Loader2 className="size-3.5 animate-spin" /> : <UserMinus className="size-3.5" />}
                  퇴원 처리
                </Button>
              </form>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={wPending || dPending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" />
                삭제
              </Button>
            </>
          )}
        </div>
      ) : null}

      {wState?.error ? <p className="text-danger mt-2 text-xs">{wState.error}</p> : null}
      {wState?.message ? <p className="text-chart-2 mt-2 text-xs">{wState.message}</p> : null}
      {dState?.error ? <p className="text-danger mt-2 text-xs">{dState.error}</p> : null}
      {dState?.message ? <p className="text-chart-2 mt-2 text-xs">{dState.message}</p> : null}
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
            <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs">
              <EyIcon name="chevronDown" size={12} aria-hidden="true" />
              {rest.length}개 더보기
            </summary>
            <ul className="mt-1 space-y-1">{rest.map((item) => Row(item))}</ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}
