import { Pill } from "@/components/atoms/pill";
import { Pagination } from "@/components/pagination";
import { Panel, TABLE_COL_LINES, TH, fmtNum } from "@/components/super-admin/parts";
import { roleMeta } from "@/features/staff/status-labels";
import { userStatusMeta } from "@/features/super-admin/labels";
import { toneColor } from "@/lib/design/semantic-color";
import { UserActions } from "./_user-actions";

const PAGE_SIZE = 50;

type User = { id: string; email: string; displayName: string; systemRole: string; status: string };

/**
 * 학원 상세의 **계정** 카드 — 역할별 인원(머리) + 계정 표(역할·상태·관리).
 * 역할 라벨·색 = [`roleMeta`](src/features/staff/status-labels.ts)(직원관리와 같은 색) · 상태 = `userStatusMeta`(tone).
 * 폰에선 `.stack-rows`로 한 계정이 두 줄 카드(이름·상태 / 이메일·역할·관리)가 된다.
 */
export function AccountsPanel({
  tenantId,
  tenantName,
  users,
  page,
}: {
  tenantId: string;
  tenantName: string;
  users: User[];
  page: number;
}) {
  const roleCount = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.systemRole] = (acc[u.systemRole] ?? 0) + 1;
    return acc;
  }, {});
  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const pageUsers = users.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const pageHref = (p: number) => (p > 1 ? `/super-admin/tenants/${tenantId}?upage=${p}` : `/super-admin/tenants/${tenantId}`);

  return (
    <Panel
      id="accounts"
      title={<>계정 <span className="num font-medium">{fmtNum(users.length)}명</span></>}
      description={
        Object.keys(roleCount).length === 0 ? "계정이 없습니다." : (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(roleCount).map(([role, count]) => (
              <Pill key={role} color={roleMeta(role).color}>
                {roleMeta(role).label} {count}
              </Pill>
            ))}
          </span>
        )
      }
      flush
    >
      <div className="stack-rows overflow-x-auto">
        <table className={`w-full min-w-[820px] text-sm ${TABLE_COL_LINES}`}>
          <thead>
            <tr>
              <th scope="col" data-cell="label" className={`${TH} text-left`}>이름</th>
              <th scope="col" data-cell="label" className={`${TH} text-left`}>이메일</th>
              <th scope="col" data-cell="label" className={`${TH} text-center`}>역할</th>
              <th scope="col" data-cell="label" className={`${TH} text-center`}>상태</th>
              <th scope="col" data-cell="label" className={`${TH} text-left`}>관리</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {pageUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-foreground px-4 py-8 text-center">계정이 없습니다.</td>
              </tr>
            ) : (
              pageUsers.map((u) => {
                const role = roleMeta(u.systemRole);
                const status = userStatusMeta(u.status);
                return (
                  <tr key={u.id}>
                    <td data-cell="primary" className="text-foreground px-3 py-2.5 font-bold whitespace-nowrap">{u.displayName}</td>
                    <td className="text-foreground max-w-[18rem] truncate px-3 py-2.5" title={u.email}>{u.email}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Pill color={role.color}>{role.label}</Pill>
                    </td>
                    <td data-cell="status" className="px-3 py-2.5 text-center">
                      <Pill color={toneColor(status.tone)}>{status.label}</Pill>
                    </td>
                    <td data-cell="wide" className="px-3 py-2.5">
                      <UserActions userId={u.id} tenantId={tenantId} tenantName={tenantName} currentRole={u.systemRole} status={u.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="border-line border-t px-4 py-3">
          <Pagination page={current} totalPages={totalPages} hrefForPage={pageHref} />
        </div>
      ) : null}
    </Panel>
  );
}
