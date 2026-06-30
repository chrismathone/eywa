"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { GitMerge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeStudents, type MergeStudentsState } from "@/features/admin/server/actions";
import type { DuplicateGroup } from "@/features/admin/server/queries";

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
    mergeStudents,
    undefined,
  );

  return (
    <li className="bg-card border-border rounded-md border p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-foreground text-sm font-semibold">
          {group.students[0].name}
          <span className="text-muted-foreground ml-2 text-xs">
            {group.students[0].grade ?? "—"}
            {group.students[0].school ? ` · ${group.students[0].school}` : ""}
          </span>
        </h3>
        <span className="text-muted-foreground num text-xs">{group.students.length}명</span>
      </header>

      <ul className="space-y-1.5">
        {group.students.map((s) => (
          <li
            key={s.id}
            className="bg-bg-soft/30 border-border flex items-center gap-3 rounded-sm border px-3 py-1.5 text-xs"
          >
            <span className="num text-muted-foreground">{s.id.slice(0, 8)}</span>
            <span className="text-foreground font-medium">{s.name}</span>
            <span className="text-muted-foreground">{statusLabel(s.status)}</span>
            <span className="text-muted-foreground num ml-auto">
              {s.enrolledAt ?? "—"}
            </span>
          </li>
        ))}
      </ul>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium">
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
                {s.id.slice(0, 8)} · {statusLabel(s.status)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium">
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
                  {s.id.slice(0, 8)} · {statusLabel(s.status)}
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
