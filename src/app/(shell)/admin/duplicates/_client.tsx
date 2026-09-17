"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { GitMerge, Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { DUPLICATE_REASON_LABEL } from "@/features/admin/duplicate-candidates";
import { mergeStudents, type MergeStudentsState } from "@/features/admin/server/actions";
import type { DuplicateGroup } from "@/features/admin/server/queries";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

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

/**
 * 보존/중복 선택지 라벨 — **이름을 먼저** 적는다.
 *
 * 🔴 종전엔 `id 앞 8자 · 상태`뿐이었다. 이름이 글자까지 같은 쌍만 후보였을 땐 상관없었지만,
 *    접미사 신호(2026-09-10)가 붙으면서 `권민서A`/`권민서B`처럼 **이름이 다른 쌍**이 올라온다 —
 *    어느 쪽을 남기느냐가 곧 살아남을 이름이라, id 앞자리만 보고 고르면 잘못 합친다(되돌릴 수 없다).
 */
function optionLabel(s: DuplicateGroup["students"][number]): string {
  const where = [s.grade, s.school].filter(Boolean).join(" · ");
  return `${s.name}${where ? ` (${where})` : ""} · ${statusLabel(s.status)} · ${s.id.slice(0, 8)}`;
}

function MergeBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
      병합
    </Button>
  );
}

export function DuplicatesClient({ groups }: { groups: DuplicateGroup[] }) {
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} />
      ))}
    </ul>
  );
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const [keeperId, setKeeperId] = useState(group.students[0].id);
  const [mergeeId, setMergeeId] = useState(group.students[1]?.id ?? "");
  const [state, action] = useActionState<MergeStudentsState, FormData>(
    mergeStudentsWithSignal,
    undefined,
  );

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

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">
            보존할 학생 (통합 후 유지)
          </label>
          <select
            name="keeperId"
            value={keeperId}
            onChange={(e) => setKeeperId(e.target.value)}
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
            value={mergeeId}
            onChange={(e) => setMergeeId(e.target.value)}
            className="border-border bg-card text-foreground rounded-md border px-2 py-1.5 text-xs"
          >
            {group.students
              .filter((s) => s.id !== keeperId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {optionLabel(s)}
                </option>
              ))}
          </select>
        </div>
        <MergeBtn />
      </form>

      {state?.error ? <p className="text-chart-4 mt-2 text-xs">{state.error}</p> : null}
      {state?.mergedRows !== undefined ? (
        <p className="text-chart-2 mt-2 text-xs">
          {state.mergedRows}개 항목 이전 완료 — 통합된 학생은 목록에서 사라집니다.
        </p>
      ) : null}
    </li>
  );
}
