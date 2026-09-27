import { Pill } from "@/components/atoms/pill";
import { Panel, TABLE_COL_LINES, TH, fmtNum } from "@/components/super-admin/parts";
import { toneColor } from "@/lib/design/semantic-color";
import { fmtDuration, routeLabel, usageMenuLabel } from "@/features/usage/labels";
import type { RouteUsage, UsageSort } from "@/features/usage/summary";
import { EmptyRow, SORT_LABEL, activityRatio, perVisit } from "./_parts";

/** 화면(주소) 단위 상위 목록 길이 — 메뉴 표가 "어느 기능"이라면 이쪽은 "그 기능의 어느 화면". */
export const ROUTE_TOP = 30;

/**
 * **화면별 상세** — 같은 메뉴 안에서도 목록·상세·탭마다 쓰임이 다르다. 유지보수 대상을 화면 단위로 짚는 표.
 * 둘째 줄의 주소는 개발자가 코드 위치를 찾는 열쇠다(학생 id 등은 `[id]`로 접혀 있다 — 개인 정보가 아니다).
 */
export function RouteUsagePanel({ routes, sort }: { routes: RouteUsage[]; sort: UsageSort }) {
  const top = routes.slice(0, ROUTE_TOP);
  return (
    <Panel
      title="화면별 상세"
      description={`${SORT_LABEL[sort]} 상위 ${ROUTE_TOP}개 화면. '1회 평균 활동'이 길수록 한 번 들어가 오래 일하는 화면입니다.`}
      flush
    >
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[860px] text-sm ${TABLE_COL_LINES}`}>
          <thead>
            <tr>
              <th scope="col" className={`${TH} text-left`}>화면</th>
              <th scope="col" className={`${TH} text-right`}>활동 시간</th>
              <th scope="col" className={`${TH} text-right`}>1회 평균 활동</th>
              <th scope="col" className={`${TH} text-right`}>화면 시간</th>
              <th scope="col" className={`${TH} text-center`}>활동률</th>
              <th scope="col" className={`${TH} text-right`}>방문</th>
              <th scope="col" className={`${TH} text-right`}>이용자</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {top.length === 0 ? (
              <EmptyRow colSpan={7}>이 조건에서 기록된 이용이 없습니다.</EmptyRow>
            ) : (
              top.map((r) => (
                <tr key={r.routeKey} className="hover:bg-muted">
                  <td data-cell="primary" className="px-3 py-2">
                    <p className="text-foreground font-bold">{routeLabel(r.routeKey)}</p>
                    <p className="text-foreground text-xs break-all">{r.routeKey}</p>
                  </td>
                  <td className="num text-foreground px-3 py-2 text-right font-bold whitespace-nowrap">{fmtDuration(r.activeSec)}</td>
                  <td className="num text-foreground px-3 py-2 text-right whitespace-nowrap">{perVisit(r)}</td>
                  <td className="num text-foreground px-3 py-2 text-right whitespace-nowrap">{fmtDuration(r.openSec)}</td>
                  <td className="num text-foreground px-3 py-2 text-center">{activityRatio(r)}</td>
                  <td className="num text-foreground px-3 py-2 text-right">{fmtNum(r.visits)}회</td>
                  <td className="num text-foreground px-3 py-2 text-right">{fmtNum(r.users)}명</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** 기간 안에 한 번도 안 열린 메뉴 — 손볼 순서를 뒤로 미뤄도 되는 후보(기능이 꺼진 지점도 여기 섞인다). */
export function UnusedMenusPanel({ menus }: { menus: string[] }) {
  return (
    <Panel
      title="이 기간에 안 열린 메뉴"
      description="유지보수 순서를 뒤로 미뤄도 되는 후보입니다. 지점에서 꺼 둔 기능·권한이 없는 메뉴도 함께 보입니다."
    >
      {menus.length === 0 ? (
        <p className="text-foreground text-sm">모든 메뉴가 한 번 이상 열렸습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {menus.map((k) => (
            <Pill key={k} color={toneColor("inert")}>
              {usageMenuLabel(k)}
            </Pill>
          ))}
        </div>
      )}
    </Panel>
  );
}
