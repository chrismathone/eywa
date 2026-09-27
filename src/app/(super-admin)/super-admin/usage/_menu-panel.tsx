import { Panel, TABLE_COL_LINES, TH, fmtNum } from "@/components/super-admin/parts";
import { fmtDuration, usageMenuLabel } from "@/features/usage/labels";
import type { MenuUsage, UsageSort } from "@/features/usage/summary";
import { EmptyRow, ShareBar, SORT_LABEL, activityRatio, perVisit } from "./_parts";

/**
 * **메뉴별 이용 = 유지보수 우선순위** — 위에 있을수록 많이 쓰는 기능이라 속도·버그를 고쳤을 때 체감이 크다.
 * 비중 막대는 고른 기준(기본 활동 시간)의 몫이다. 화면 시간·활동률은 "띄워만 둔 화면"을 가려내는 대조 칸.
 */
export function MenuUsagePanel({ menus, sort }: { menus: MenuUsage[]; sort: UsageSort }) {
  return (
    <Panel
      title="메뉴별 이용 — 유지보수 우선순위"
      description={`${SORT_LABEL[sort]} 기준. 위에 있을수록 많이 쓰는 기능이라 손봤을 때 효과가 큽니다.`}
      flush
    >
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[920px] text-sm ${TABLE_COL_LINES}`}>
          <thead>
            <tr>
              <th scope="col" className={`${TH} w-14 text-center`}>순위</th>
              <th scope="col" className={`${TH} text-left`}>메뉴</th>
              <th scope="col" className={`${TH} w-48 text-left`}>비중</th>
              <th scope="col" className={`${TH} text-right`}>활동 시간</th>
              <th scope="col" className={`${TH} text-right`}>화면 시간</th>
              <th scope="col" className={`${TH} text-center`}>활동률</th>
              <th scope="col" className={`${TH} text-right`}>방문</th>
              <th scope="col" className={`${TH} text-right`}>1회 평균 활동</th>
              <th scope="col" className={`${TH} text-right`}>이용자</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {menus.length === 0 ? (
              <EmptyRow colSpan={9}>이 조건에서 기록된 이용이 없습니다.</EmptyRow>
            ) : (
              menus.map((m, i) => (
                <tr key={m.menuKey} className="hover:bg-muted">
                  <td className="num text-foreground px-3 py-2.5 text-center">{i + 1}</td>
                  <td data-cell="primary" className="text-foreground px-3 py-2.5 font-bold whitespace-nowrap">
                    {usageMenuLabel(m.menuKey)}
                  </td>
                  <td className="px-3 py-2.5">
                    <ShareBar share={m.share} label={`${SORT_LABEL[sort]} 비중`} />
                  </td>
                  <td className="num text-foreground px-3 py-2.5 text-right font-bold whitespace-nowrap">
                    {fmtDuration(m.activeSec)}
                  </td>
                  <td className="num text-foreground px-3 py-2.5 text-right whitespace-nowrap">{fmtDuration(m.openSec)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-center">{activityRatio(m)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-right">{fmtNum(m.visits)}회</td>
                  <td className="num text-foreground px-3 py-2.5 text-right whitespace-nowrap">{perVisit(m)}</td>
                  <td className="num text-foreground px-3 py-2.5 text-right">{fmtNum(m.users)}명</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
