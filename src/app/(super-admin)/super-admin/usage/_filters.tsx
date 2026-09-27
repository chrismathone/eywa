import { Toolbar, ToolbarDivider, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { FilterSelect } from "@/components/filter-select";
import { USAGE_ROLES, usageRoleLabel } from "@/features/usage/labels";
import { USAGE_PERIODS, USAGE_SORTS, usageHref, type UsageQuery } from "@/features/usage/query";
import type { TenantOption } from "@/features/usage/server/summary-query";
import { SORT_LABEL } from "./_parts";

/**
 * 조회 조건 줄 — 기간(최근 N일)·지점·권한·정렬 기준. 전부 주소에 실린다(새로고침·공유해도 같은 화면).
 * 🔑 정렬 기준의 기본은 **활동 시간**이다(원장: 멍하니 띄워 둔 시간보다 실제 활동이 중요). 화면 시간·방문은 대조용.
 */
export function UsageFilters({ q, tenants }: { q: UsageQuery; tenants: TenantOption[] }) {
  return (
    <Toolbar>
      <ToolbarSegment label="기간">
        {USAGE_PERIODS.map((d) => (
          <ToolbarSegmentItem key={d} active={q.days === d} href={usageHref(q, { days: d })}>
            최근 {d}일
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
      <ToolbarDivider />
      <FilterSelect
        paramName="tenant"
        axisLabel="지점"
        allLabel="전 지점"
        value={q.tenantId}
        options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        ariaLabel="지점 필터"
        triggerClassName={TOOLBAR_SELECT}
      />
      <FilterSelect
        paramName="role"
        axisLabel="권한"
        allLabel="전체 권한"
        value={q.role}
        options={USAGE_ROLES.map((r) => ({ value: r, label: usageRoleLabel(r) }))}
        ariaLabel="권한 필터"
        triggerClassName={TOOLBAR_SELECT}
      />
      <ToolbarDivider />
      <ToolbarSegment label="정렬">
        {USAGE_SORTS.map((s) => (
          <ToolbarSegmentItem key={s} active={q.sort === s} href={usageHref(q, { sort: s })}>
            {SORT_LABEL[s]}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
    </Toolbar>
  );
}
