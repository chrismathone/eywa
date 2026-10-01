"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { dashboardAssignmentOf } from "@/features/dashboard/layout/assignment";
import type { DashboardAssignment } from "@/features/dashboard/layout/types";
import { saveStaffDashboardAssignment } from "@/features/staff/server/dashboard-assignment";

export function DashboardAssignmentForm({ user, initial, subjects }: {
  user: { id: string; systemRole: SystemRole; subjects: string[]; isSuperAdmin: boolean };
  initial?: DashboardAssignment;
  subjects: { key: string; label: string }[];
}) {
  const inherited = dashboardAssignmentOf(user, initial);
  const [value, setValue] = useState(inherited.assignment);
  const [baseline, setBaseline] = useState(JSON.stringify(initial ?? null));
  const [note, setNote] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const fixed = user.isSuperAdmin || user.systemRole === "master";
  return <form className="border-line space-y-3 rounded-xl border p-4" onSubmit={(e) => {
    e.preventDefault();
    startTransition(async () => {
      const next = { ...value, subjects: value.scope === "subjects" ? value.subjects : [] };
      try {
        const result = await saveStaffDashboardAssignment(next, baseline);
        setNote(result);
        if ("ok" in result) { setBaseline(JSON.stringify(next)); router.refresh(); }
      } catch { setNote({ error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }); }
    });
  }}>
    <h2 className="font-bold">대시보드 담당 범위·배치</h2>
    <p className="text-text-dim text-xs">대시보드 집계에 적용할 범위입니다. 실제 열람에는 메뉴 권한도 적용됩니다.</p>
    {fixed ? <p className="text-sm">{user.isSuperAdmin ? "슈퍼관리자" : "원장"} 배치 · 전 과목</p> : <>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">대시보드 배정</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {([['all', '전 과목'], ['subjects', '과목 선택'], ['unassigned', '미지정']] as const).map(([scope, label]) => <label key={scope} className="flex items-center gap-1.5">
            <input type="radio" name="dashboardScope" checked={value.scope === scope} onChange={() => setValue({ ...value, scope })} />{label}
          </label>)}
        </div>
        {value.scope === "subjects" ? <div className="flex flex-wrap gap-3 text-sm">
          {subjects.map((s) => <label key={s.key} className="flex items-center gap-1.5"><input type="checkbox" checked={value.subjects.includes(s.key)} onChange={(e) => setValue({ ...value, subjects: e.target.checked ? [...value.subjects, s.key] : value.subjects.filter((key) => key !== s.key) })} />{s.label}</label>)}
        </div> : null}
        {user.systemRole === "admin" ? <label className="flex items-center gap-3 text-sm">관리자 배치
          <select aria-label="관리자 대시보드 배치" className="border-line rounded-md border p-1" value={value.adminLayout} onChange={(e) => setValue({ ...value, adminLayout: e.target.value as "subject" | "desk" })}>
            <option value="subject">과목 운영형</option><option value="desk">경영지원형</option>
          </select>
        </label> : null}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || (value.scope === "subjects" && !value.subjects.length)}>{pending ? "저장 중…" : "대시보드 배정 저장"}</Button>
        <p role="status" className={`text-xs ${note?.error ? "text-danger" : "text-text-dim"}`}>{note?.error ?? (note?.ok ? "저장했습니다" : initial ? "" : "기존 배정을 유지 중입니다. 저장하면 이 지정이 적용됩니다.")}</p>
      </div>
    </>}
  </form>;
}
