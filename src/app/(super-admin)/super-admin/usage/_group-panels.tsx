import Link from "next/link";
import { Panel, TABLE_COL_LINES, TH, fmtNum } from "@/components/super-admin/parts";
import { fmtDuration, usageMenuLabel, usageRoleLabel } from "@/features/usage/labels";
import { usageHref, type UsageQuery } from "@/features/usage/query";
import type { GroupUsage } from "@/features/usage/summary";
import type { TenantOption } from "@/features/usage/server/summary-query";
import { EmptyRow, ShareBar, SORT_LABEL, activityRatio, metricText } from "./_parts";

/**
 * 권한별·지점별 묶음 — "누가 어디를 쓰나". 사람 한 명 단위는 보여 주지 않는다(권한·지점 집계만, 0292a 머리주석).
 * 카드·행을 누르면 그 권한·지점으로 좁혀 아래 표 전체를 다시 본다.
 */

function TopMenus({ group, q }: { group: GroupUsage; q: UsageQuery }) {
  if (group.topMenus.length === 0) return <p className="text-foreground text-sm">기록 없음</p>;
  return (
    <ol className="space-y-1.5">
      {group.topMenus.map((m) => (
        <li key={m.menuKey} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="text-foreground truncate font-medium" title={usageMenuLabel(m.menuKey)}>
            {usageMenuLabel(m.menuKey)}
          </span>
          <ShareBar share={m.share} label={`이 묶음 안 ${SORT_LABEL[q.sort]} 비중`} />
          <span className="num text-foreground text-right text-xs whitespace-nowrap">{metricText(q.sort, m)}</span>
        </li>
      ))}
    </ol>
  );
}

export function RoleUsagePanel({ roles, q }: { roles: GroupUsage[]; q: UsageQuery }) {
  return (
    <Panel title="권한별 많이 쓰는 메뉴" description={`권한마다 ${SORT_LABEL[q.sort]} 상위 5개 메뉴입니다. 권한 이름을 누르면 그 권한만 봅니다.`}>
      {roles.length === 0 ? (
        <p className="text-foreground py-6 text-center text-sm">이 조건에서 기록된 이용이 없습니다.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <section key={r.key} className="border-line space-y-2.5 rounded-2xl border p-3">
              <header className="flex flex-wrap items-baseline justify-between gap-x-2">
                <Link href={usageHref(q, { role: r.key as UsageQuery["role"] })} className="text-foreground hover:text-primary text-base font-bold">
                  {usageRoleLabel(r.key)}
                </Link>
                <span className="num text-foreground text-sm">
                  {fmtNum(r.users)}명 · 활동 {fmtDuration(r.activeSec)} · 활동률 {activityRatio(r)}
                </span>
              </header>
              <TopMenus group={r} q={q} />
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function TenantUsagePanel({ tenants, names, q }: { tenants: GroupUsage[]; names: TenantOption[]; q: UsageQuery }) {
  const nameOf = new Map(names.map((t) => [t.id, t.name]));
  return (
    <Panel title="지점별 이용" description="지점 이름을 누르면 그 지점만 봅니다. 기록이 있는 지점만 보입니다." flush>
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[980px] text-sm ${TABLE_COL_LINES}`}>
          <thead>
            <tr>
              <th scope="col" className={`${TH} text-left`}>지점</th>
              <th scope="col" className={`${TH} text-right`}>이용자</th>
              <th scope="col" className={`${TH} text-right`}>활동 시간</th>
              <th scope="col" className={`${TH} text-right`}>화면 시간</th>
              <th scope="col" className={`${TH} text-center`}>활동률</th>
              <th scope="col" className={`${TH} text-right`}>방문</th>
              <th scope="col" className={`${TH} w-[26rem] text-left`}>많이 쓰는 메뉴</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {tenants.length === 0 ? (
              <EmptyRow colSpan={7}>이 조건에서 기록된 이용이 없습니다.</EmptyRow>
            ) : (
              tenants.map((t) => (
                <tr key={t.key} className="hover:bg-muted align-top">
                  <td data-cell="primary" className="px-3 py-2.5 font-bold whitespace-nowrap">
                    <Link href={usageHref(q, { tenantId: t.key })} className="text-foreground hover:text-primary">
                      {nameOf.get(t.key) ?? "이름 없는 지점"}
                    </Link>
                  </td>
                  <td className="num text-foreground px-3 py-2.5 text-right">{fmtNum(t.users)}명</td>
                  <td className="num text-foreground px-3 py-2.5 text-right font-bold whitespace-nowrap">{fmtDuration(t.activeSec)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-right whitespace-nowrap">{fmtDuration(t.openSec)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-center">{activityRatio(t)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-right">{fmtNum(t.visits)}회</td>
                  <td className="px-3 py-2.5">
                    <TopMenus group={{ ...t, topMenus: t.topMenus.slice(0, 3) }} q={q} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
