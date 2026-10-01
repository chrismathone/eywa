import { WindowLink } from "@/components/workspace/window-link";
import type { DashboardMembers } from "@/features/dashboard/layout/members";
import { BUNDLE_LABELS, type Bundle } from "@/features/dashboard/layout/types";

export function AssignedStaff({ members, bundle }: { members: DashboardMembers; bundle: Bundle }) {
  const people = members.people.filter((p) => p.bundle === bundle);
  const count = people.filter((p) => p.canOpen).length;
  return <aside className="border-line bg-bg-soft/40 min-w-0 rounded-xl border px-3 py-2" aria-label="대시보드 적용 직원">
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <strong>실제 적용 직원{members.failed ? "" : ` ${count}명`}</strong>
      <span className="text-text-dim">{BUNDLE_LABELS[bundle]}</span>
    </div>
    {members.failed ? <p role="status" className="text-danger text-xs">직원 목록을 불러오지 못했습니다. 새로고침해 주세요.</p> : people.length ? (
      <ul className="scrollbar-thin max-h-28 space-y-1 overflow-y-auto text-xs">
        {people.map((p) => <li key={p.id} className="flex items-center justify-between gap-3">
          <WindowLink href={`/staff/${p.id}/edit`} title={`${p.name} 근무 설정`} className="text-primary shrink-0 font-bold underline-offset-2 hover:underline">{p.name}</WindowLink>
          <span className="text-text-dim text-right">{p.scopeLabel}{!p.canOpen ? " · 대시보드 권한 없음" : ""}</span>
        </li>)}
      </ul>
    ) : <p className="text-text-dim text-xs">현재 이 배치가 적용되는 직원이 없습니다.</p>}
    <p className="text-text-faint mt-2 text-[11px]">이름을 누르면 담당 범위와 배치를 지정할 수 있습니다.</p>
  </aside>;
}
