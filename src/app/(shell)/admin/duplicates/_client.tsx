"use client";

import { useActionState, useState } from "react";
import { GitMerge, Loader2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { DUPLICATE_REASON_LABEL } from "@/features/admin/duplicate-candidates";
import { MERGE_SCOPE_LABEL } from "@/features/admin/merge-scope";
import { mergeStudents, type MergeStudentsState } from "@/features/admin/server/actions";
import type { DuplicateGroup } from "@/features/admin/server/queries";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { MENU_LABEL } from "@/lib/permissions";

/**
 * 병합은 수강(enrollments)을 남길 학생 앞으로 옮기고 다른 학생을 퇴원시킨다 — 끝나면 열린 회차 확정 창에 알린다
 * (원장 2026-09-17 *"관리 도구 화면도 배선해"*). ⚠️ 오류로 끝나도 보낸다 — 표를 차례로 옮기다 멈추면 앞 표(수강이 첫 번째)는
 * 이미 옮겨져 있다. 신호는 새로고침일 뿐이라 헛걸음이어도 해가 없다.
 */
async function mergeStudentsWithSignal(prev: MergeStudentsState, formData: FormData): Promise<MergeStudentsState> {
  const result = await mergeStudents(prev, formData);
  notifyTermPlansChanged();
  return result;
}

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

type Student = DuplicateGroup["students"][number];

/** 이름 + 학년·학교 — 확인 문장과 선택지가 같은 모양으로 적는다(어느 학생인지 헷갈리지 않게). */
function whoLabel(s: Student): string {
  const where = [s.grade, s.school].filter(Boolean).join(" · ");
  return `${s.name}${where ? ` (${where})` : ""}`;
}

/**
 * 보존/중복 선택지 라벨 — **이름을 먼저** 적는다.
 *
 * 🔴 종전엔 `id 앞 8자 · 상태`뿐이었다. 이름이 글자까지 같은 쌍만 후보였을 땐 상관없었지만,
 *    접미사 신호(2026-09-10)가 붙으면서 `권민서A`/`권민서B`처럼 **이름이 다른 쌍**이 올라온다 —
 *    어느 쪽을 남기느냐가 곧 살아남을 이름이라, id 앞자리만 보고 고르면 잘못 합친다(되돌릴 수 없다).
 */
function optionLabel(s: Student): string {
  return `${whoLabel(s)} · ${statusLabel(s.status)} · ${s.id.slice(0, 8)}`;
}

export function DuplicatesClient({
  groups,
  canManage,
}: {
  groups: DuplicateGroup[];
  /**
   * 병합할 수 있는가 — 서버가 **병합 액션과 같은 판정**으로 정한다(page.tsx). 후보 목록·근거는 이 값과 무관하게 보인다.
   * (화면을 맞추는 값일 뿐 게이트가 아니다 — 자물쇠는 액션의 권한 검사다.)
   */
  canManage: boolean;
}) {
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} canManage={canManage} />
      ))}
    </ul>
  );
}

function GroupCard({ group, canManage }: { group: DuplicateGroup; canManage: boolean }) {
  const [keeperId, setKeeperId] = useState(group.students[0].id);
  const [mergeeId, setMergeeId] = useState(group.students[1]?.id ?? "");
  // 🔴 병합은 되돌릴 수 없다 — **두 번 눌러야** 실행되고, 두 번째 화면이 누구의 기록을 누구에게 옮기는지 이름으로 적는다.
  //    🔴 확인은 **확인한 그 쌍의 한 번의 실행에만** 쓴다 — 확인할 때의 쌍(남길 학생·진 쪽)을 함께 기억하고, 지금의 쌍이
  //       그것과 다르면 확인이 저절로 풀린다. 쌍은 선택을 바꿀 때만이 아니라 **목록이 새로 읽힐 때도** 바뀐다(세 명 묶음에서
  //       다른 창이 한 명을 처리하면 진 쪽이 다음 학생으로 넘어간다) — 그때 확인이 남아 있으면 확인 문장을 본 적 없는
  //       학생이 첫 클릭 없이 병합된다. 제출하는 순간에도 내린다.
  const [confirmedPair, setConfirmedPair] = useState<{ keeperId: string; mergeeId: string } | null>(null);
  const [state, action, pending] = useActionState<MergeStudentsState, FormData>(
    mergeStudentsWithSignal,
    undefined,
  );
  // 고른 학생이 목록에서 빠지면(다른 창의 처리) 화면에 보이는 첫 선택지가 실제로 보낼 값이다 — 상태와 화면이 어긋나지 않게.
  const effectiveKeeperId = group.students.some((s) => s.id === keeperId) ? keeperId : (group.students[0]?.id ?? "");
  const mergeeOptions = group.students.filter((s) => s.id !== effectiveKeeperId);
  const effectiveMergeeId = mergeeOptions.some((s) => s.id === mergeeId) ? mergeeId : (mergeeOptions[0]?.id ?? "");
  const keeper = group.students.find((s) => s.id === effectiveKeeperId);
  const mergee = group.students.find((s) => s.id === effectiveMergeeId);
  const confirming =
    !!confirmedPair && confirmedPair.keeperId === effectiveKeeperId && confirmedPair.mergeeId === effectiveMergeeId;

  return (
    <li className="bg-card border-border rounded-md border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-foreground text-sm font-bold">
          {group.students[0].name}
          <span className="text-muted-foreground ml-2 text-xs">
            {group.students[0].grade ?? "—"}
            {group.students[0].school ? ` · ${group.students[0].school}` : ""}
          </span>
        </h3>
        <span className="text-muted-foreground num text-xs">{group.students.length}명</span>
        {/* 무엇이 같아서 후보인지 — 근거 없이 "합치세요"만 보이면 데스크가 판단할 수 없다. */}
        <div className="flex w-full flex-wrap items-center gap-1">
          {group.reasons.map((r) => (
            <Pill key={r} color="neutral">
              {DUPLICATE_REASON_LABEL[r]}
            </Pill>
          ))}
        </div>
      </header>

      <ul className="space-y-1.5">
        {group.students.map((s) => (
          <li
            key={s.id}
            className="bg-bg-soft/30 border-border flex items-center gap-3 rounded-sm border px-3 py-1.5 text-xs"
          >
            <span className="num text-muted-foreground shrink-0">{s.id.slice(0, 8)}</span>
            {/* 이름은 안 줄인다 — 접미사 한 글자가 두 사람을 가르는 유일한 표시다([[#111]]). */}
            <span className="text-foreground shrink-0 font-medium whitespace-nowrap">{s.name}</span>
            {s.dupSuspect ? <DupSuspectTag className="shrink-0" /> : null}
            <span className="text-muted-foreground min-w-0 truncate">
              {s.grade ?? "—"}
              {s.school ? ` · ${s.school}` : ""}
            </span>
            <span className="text-muted-foreground shrink-0">{statusLabel(s.status)}</span>
            <span className="text-muted-foreground num ml-auto shrink-0">
              {s.enrolledAt ?? "—"}
            </span>
          </li>
        ))}
      </ul>

      {canManage ? (
        <form
          action={action}
          onSubmit={(event) => {
            // 저장이 도는 중의 재제출 · 확인이 풀린 뒤의 제출(Enter 등)은 받지 않는다.
            if (pending || !confirming) event.preventDefault();
            setConfirmedPair(null);
          }}
          className="mt-3 space-y-2 border-t pt-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                보존할 학생 (통합 후 유지)
              </label>
              <select
                name="keeperId"
                value={effectiveKeeperId}
                disabled={pending}
                onChange={(e) => {
                  setKeeperId(e.target.value);
                  setConfirmedPair(null);
                }}
                className="border-border bg-card text-foreground rounded-md border px-2 py-1.5 text-xs"
              >
                {group.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {optionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                중복 학생 (통합 후 퇴원)
              </label>
              <select
                name="mergeeId"
                value={effectiveMergeeId}
                disabled={pending}
                onChange={(e) => {
                  setMergeeId(e.target.value);
                  setConfirmedPair(null);
                }}
                className="border-border bg-card text-foreground rounded-md border px-2 py-1.5 text-xs"
              >
                {mergeeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {optionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            {confirming || pending ? null : (
              <Button
                type="button"
                disabled={!keeper || !mergee}
                onClick={() => setConfirmedPair({ keeperId: effectiveKeeperId, mergeeId: effectiveMergeeId })}
              >
                <GitMerge className="size-4" />
                병합
              </Button>
            )}
          </div>
          {/* 저장이 도는 동안에는 대상 문장을 적지 않는다 — 그사이 목록이 새로 읽히면 화면의 '지금 쌍'이 보낸 쌍과 달라져,
              보내지 않은 학생을 처리하는 것처럼 읽힌다(적대 리뷰 3b B2). */}
          {pending ? (
            <p role="status" className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              병합 처리 중…
            </p>
          ) : confirming && keeper && mergee ? (
            <div role="alert" className="border-amber/30 bg-amber-soft space-y-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
              <p>
                <b>{whoLabel(mergee)}</b>의 {MERGE_SCOPE_LABEL} 기록을 <b>{whoLabel(keeper)}</b>에게 옮기고,{" "}
                <b>{mergee.name}</b>은(는) 퇴원 처리합니다. <b>되돌릴 수 없습니다.</b>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm">
                  <GitMerge className="size-3.5" />
                  병합 확정
                </Button>
                <button
                  type="button"
                  onClick={() => setConfirmedPair(null)}
                  className="text-text-faint hover:text-foreground text-xs"
                >
                  취소
                </button>
              </div>
            </div>
          ) : null}
        </form>
      ) : (
        <p className="text-text-faint mt-3 border-t pt-3 text-xs">
          병합은 &lsquo;{MENU_LABEL.admin}&rsquo; 권한이 있는 계정만 할 수 있습니다.
        </p>
      )}

      {state?.error ? <p className="text-chart-4 mt-2 text-xs">{state.error}</p> : null}
      {state?.mergedRows !== undefined ? (
        <p className="text-chart-2 mt-2 text-xs">
          {state.mergedRows}개 항목 이전 완료 — 통합된 학생은 목록에서 사라집니다.
        </p>
      ) : null}
      {state?.warning ? <p className="text-chart-4 mt-2 text-xs">{state.warning}</p> : null}
    </li>
  );
}
