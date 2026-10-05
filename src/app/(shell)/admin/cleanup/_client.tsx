"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import { CheckCircle2, Loader2, Trash2, UserMinus, Wrench } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import {
  closeOrphanEnrollments,
  bulkWithdrawStudents,
  bulkDeleteStudents,
  type BulkStudentState,
  type CleanupState,
} from "@/features/admin/server/actions";
import type { OrphanReport } from "@/features/admin/server/queries";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { MENU_LABEL } from "@/lib/permissions";

/**
 * 수강을 끝내거나 학생을 지우는 정리 작업 — 끝나면 열린 회차 확정 창에 알린다(원장 2026-09-17 *"관리 도구 화면도 배선해"*).
 * ⚠️ 오류로 끝나도 보낸다 — 이 액션들은 100명씩 나눠 쓰다 중간에 멈추면 **앞 묶음은 이미 바뀐 채** 오류를 돌려준다.
 *    신호는 새로고침일 뿐이라 헛걸음이어도 해가 없다. 액션 자체가 던지면(네트워크) 보내지 않는다.
 */
function withTermPlansSignal<S>(action: (prev: S, formData: FormData) => Promise<S>) {
  return async (prev: S, formData: FormData): Promise<S> => {
    const result = await action(prev, formData);
    notifyTermPlansChanged();
    return result;
  };
}
const closeOrphanEnrollmentsWithSignal = withTermPlansSignal<CleanupState>(closeOrphanEnrollments);
const bulkWithdrawStudentsWithSignal = withTermPlansSignal<BulkStudentState>(bulkWithdrawStudents);
const bulkDeleteStudentsWithSignal = withTermPlansSignal<BulkStudentState>(bulkDeleteStudents);

/** 정리 작업 권한이 없는 열람자에게 — 목록은 보이고 버튼 자리에 이 안내가 선다. */
function NoPermissionNote() {
  return (
    <p className="text-text-faint mt-3 text-xs">
      정리 작업은 &lsquo;{MENU_LABEL.admin}&rsquo; 권한이 있는 계정만 할 수 있습니다.
    </p>
  );
}

export function CleanupClient({
  report,
  canManage,
}: {
  report: OrphanReport;
  /**
   * 정리 작업(퇴원 · 삭제 · 수강 종료)을 할 수 있는가 — 서버가 **저장 액션과 같은 판정**으로 정한다(page.tsx).
   * 🔴 변이 버튼에만 쓴다. 목록 조회와 학생·반 링크는 이 값과 무관하게 보인다.
   *    (이 값은 화면을 맞추는 것일 뿐 게이트가 아니다 — 자물쇠는 각 액션의 권한 검사다.)
   */
  canManage: boolean;
}) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* 1. 수강 없는 재원생 */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-bold">수강 없는 재원생</h2>
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
          <OrphanStudentManager items={report.studentsWithoutEnrollments} canManage={canManage} />
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
          <h2 className="text-foreground text-sm font-bold">스케줄 없는 활성 반</h2>
          <span className="num text-muted-foreground text-xs">
            {report.classesWithoutSchedules.length}개
          </span>
        </header>
        {/* 판정 = 스케줄 기록이 한 줄도 없음(지난 기록 포함). 지난 기록만 남은 반은 여기 나오지 않는다 — 그렇게 적는다. */}
        <p className="text-muted-foreground text-xs">
          운영 중인 반인데 <b>스케줄 기록이 하나도 없는 반</b>입니다. 시간표에 표시되지 않습니다. 지난 스케줄만 남아
          있는 반은 여기 나오지 않습니다.
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
          <h2 className="text-foreground text-sm font-bold">
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
          canManage ? <CloseOrphansForm students={report.enrollmentsWithoutEndDate} /> : <NoPermissionNote />
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
 * 퇴원 학생의 남은 수강 종료 — **두 번 눌러야** 실행된다(여러 학생의 수강 기록을 한꺼번에 바꾼다).
 * 끝나면 목록이 새로 읽혀 이 구획이 '문제 없음'으로 바뀐다(실패하면 사유가 남는다).
 * 🔴 확인은 **확인한 그 대상의 한 번의 실행에만** 쓴다 — 제출하는 순간 내리고, 확인한 뒤 대상(학생 수)이 달라지면
 *    (다른 창의 처리 · 새로 읽힘) 확인이 저절로 풀려 첫 버튼부터 다시 누른다.
 */
function CloseOrphansForm({ students }: { students: number }) {
  const [state, action, pending] = useActionState<CleanupState, FormData>(closeOrphanEnrollmentsWithSignal, undefined);
  /** 확인한 때의 학생 수 — 지금 값과 같을 때만 확인된 것으로 친다. */
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const confirming = confirmedFor === students;
  return (
    <div className="mt-3">
      {/* 저장이 도는 동안에는 대상 문장을 적지 않는다 — 그사이 목록이 새로 읽히면 화면의 숫자가 보낸 대상과 달라진다. */}
      {pending ? (
        <p role="status" className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          종료 처리 중…
        </p>
      ) : confirming ? (
        <form
          action={action}
          onSubmit={(event) => {
            // 확인이 풀린 뒤의 제출은 받지 않는다.
            if (!confirming) event.preventDefault();
            setConfirmedFor(null);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-muted-foreground text-xs">
            퇴원 학생 {students}명의 남은 수강을 모두 종료합니다. 종료일은 오늘(아직 시작 전인 수강은 그 시작일)로
            기록됩니다.
          </span>
          <Button type="submit" size="sm">
            <Wrench className="size-3.5" />
            종료 확정
          </Button>
          <button
            type="button"
            onClick={() => setConfirmedFor(null)}
            className="text-text-faint hover:text-foreground text-xs"
          >
            취소
          </button>
        </form>
      ) : (
        <Button type="button" onClick={() => setConfirmedFor(students)}>
          <Wrench className="size-4" />
          남은 수강 종료
        </Button>
      )}
      {state?.error ? <p className="text-chart-4 mt-2 text-xs">{state.error}</p> : null}
      {state?.closedCount !== undefined ? (
        <p className="text-chart-2 mt-2 text-xs">{state.closedCount}건 자동 종료 완료</p>
      ) : null}
      {state?.warning ? <p className="text-chart-4 mt-2 text-xs">{state.warning}</p> : null}
    </div>
  );
}

/**
 * 수강 없는 재원생 — 전체/개별 선택 후 일괄 퇴원(가역) 또는 삭제(영구, 청구기록 있으면 제외). 둘 다 **두 번 눌러야** 실행된다.
 * 🔴 확인은 **확인한 그 학생들의 한 번의 실행에만** 쓴다 — 확인할 때 고른 학생 묶음을 함께 기억하고, 지금 고른 묶음이
 *    그것과 다르면(체크를 바꿈 · 목록이 새로 읽힘) 확인이 저절로 풀린다. 제출하는 순간에도 내린다.
 *    안 그러면 확인 문장을 본 학생이 아닌 다른 학생이 첫 클릭 없이 바로 처리된다.
 * 선택 상태는 현재 렌더된 항목으로 라이브 필터(액션 성공 시 목록이 줄면 사라진 id는 자동 해제 — setState-in-effect 회피).
 * 권한이 없는 열람자에게는 이름 목록만 선다(선택 칸·버튼 없음).
 */
function OrphanStudentManager({
  items,
  canManage,
}: {
  items: { id: string; name: string; status: string }[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 확인한 작업과 **그때 고른 학생 묶음**(정렬한 id) — 지금 고른 묶음과 같을 때만 확인된 것으로 친다. */
  const [confirmed, setConfirmed] = useState<{ kind: "withdraw" | "delete"; key: string } | null>(null);
  const [wState, withdrawAction, wPending] = useActionState(bulkWithdrawStudentsWithSignal, undefined);
  const [dState, deleteAction, dPending] = useActionState(bulkDeleteStudentsWithSignal, undefined);

  const itemIds = new Set(items.map((i) => i.id));
  const live = [...selected].filter((id) => itemIds.has(id));
  const ids = live.join(",");
  const count = live.length;
  const allSelected = items.length > 0 && count === items.length;
  const busy = wPending || dPending;
  const selectionKey = [...live].sort().join(",");
  const confirming = confirmed && confirmed.key === selectionKey ? confirmed.kind : null;
  const confirm = (kind: "withdraw" | "delete") => setConfirmed({ kind, key: selectionKey });
  /** 제출 직전 — 저장이 도는 중이거나 확인이 풀렸으면 받지 않고, 확인은 이 한 번으로 쓴다. */
  const guardSubmit = (kind: "withdraw" | "delete") => (event: { preventDefault: () => void }) => {
    if (busy || confirming !== kind) event.preventDefault();
    setConfirmed(null);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  if (!canManage) {
    return (
      <div className="mt-3">
        <ul className="max-h-72 space-y-1 overflow-auto pr-1">
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/students/${s.id}`} className="text-chart-1 truncate text-xs hover:underline">
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
        <NoPermissionNote />
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs">
          {/* 저장이 도는 동안에는 선택을 바꿀 수 없다(보낸 묶음과 화면의 선택이 어긋나지 않게). */}
          <input type="checkbox" checked={allSelected} disabled={busy} onChange={toggleAll} className="size-3.5" />
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
              disabled={busy}
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
          {busy ? (
            // 저장이 도는 동안에는 대상 문장을 적지 않는다(그사이 목록이 새로 읽히면 숫자가 보낸 대상과 달라진다).
            <p role="status" className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {dPending ? "삭제 처리 중…" : "퇴원 처리 중…"}
            </p>
          ) : confirming === "delete" ? (
            <form action={deleteAction} onSubmit={guardSubmit("delete")} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="ids" value={ids} />
              <span className="text-muted-foreground text-xs">
                {count}명 영구 삭제? (청구 기록 있으면 제외)
              </span>
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-3.5" />
                삭제 확정
              </Button>
              <button
                type="button"
                onClick={() => setConfirmed(null)}
                className="text-text-faint hover:text-foreground text-xs"
              >
                취소
              </button>
            </form>
          ) : confirming === "withdraw" ? (
            <form action={withdrawAction} onSubmit={guardSubmit("withdraw")} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="ids" value={ids} />
              <span className="text-muted-foreground text-xs">
                {count}명을 퇴원 처리합니다. 학생 상세에서 다시 재원으로 되돌릴 수 있습니다.
              </span>
              <Button type="submit" variant="outline" size="sm">
                <UserMinus className="size-3.5" />
                퇴원 확정
              </Button>
              <button
                type="button"
                onClick={() => setConfirmed(null)}
                className="text-text-faint hover:text-foreground text-xs"
              >
                취소
              </button>
            </form>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => confirm("withdraw")}>
                <UserMinus className="size-3.5" />
                퇴원 처리
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => confirm("delete")}>
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
