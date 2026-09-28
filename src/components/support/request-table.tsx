import Link from "next/link";
import { Pill } from "@/components/atoms/pill";
import { TABLE_COL_LINES, TH } from "@/components/super-admin/parts";
import { WindowLink } from "@/components/workspace/window-link";
import { toneColor } from "@/lib/design/semantic-color";
import { fmtSupportDateTime } from "@/features/support/format";
import { SUPPORT_STATUS_META, type SupportRequestListItem, type SupportStatus } from "@/features/support/types";

export function SupportStatusPill({ status }: { status: SupportStatus }) {
  const meta = SUPPORT_STATUS_META[status];
  return <Pill color={toneColor(meta.tone)}>{meta.label}</Pill>;
}

/**
 * 개선요청 목록 표 — 지점 화면(`/support?tab=requests`)과 슈퍼관리자 화면(`/super-admin/support`)이 **같은 표**를 쓴다.
 * makeedu 목록의 열(No · 제목 · 등록자 · 등록일시 · 처리상태)에 **완료 예정일**을 더했고, 슈퍼관리자는 앞에 지점 열이 선다.
 * 지점 화면은 창 시스템 안이라 `WindowLink`, 슈퍼관리자 셸은 창이 없어 보통 `Link`.
 */
export function SupportRequestTable({
  rows,
  hrefFor,
  showTenant = false,
  windowed = true,
}: {
  rows: SupportRequestListItem[];
  hrefFor: (id: string) => string;
  showTenant?: boolean;
  windowed?: boolean;
}) {
  const LinkAs = windowed ? WindowLink : Link;
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl" aria-label="개선요청 목록">
      <div className="overflow-x-auto">
        <table className={`w-full table-fixed text-sm ${showTenant ? "min-w-[900px]" : "min-w-[720px]"} ${TABLE_COL_LINES}`}>
          <colgroup>
            <col className="w-16" />
            {showTenant ? <col className="w-36" /> : null}
            <col />
            <col className={showTenant ? "w-36" : "w-28"} />
            <col className="w-40" />
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${TH} text-center`}>No</th>
              {showTenant ? <th scope="col" className={`${TH} text-left`}>지점</th> : null}
              <th scope="col" className={`${TH} text-left`}>제목</th>
              <th scope="col" className={`${TH} text-center`}>등록자</th>
              <th scope="col" className={`${TH} text-center`}>등록일시</th>
              <th scope="col" className={`${TH} text-center`}>처리상태</th>
              <th scope="col" className={`${TH} text-center`}>완료 예정일</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-bg-soft/60">
                <td className="num text-text-dim px-3 py-2.5 text-center">{r.no}</td>
                {showTenant ? <td className="text-foreground truncate px-3 py-2.5">{r.tenantName}</td> : null}
                <td className="px-3 py-2.5">
                  <LinkAs
                    href={hrefFor(r.id)}
                    title={r.title}
                    className="text-foreground hover:text-primary block truncate font-bold"
                  >
                    {r.title}
                  </LinkAs>
                </td>
                <td className="text-foreground truncate px-3 py-2.5 text-center" title={r.authorRole ? `${r.authorName} · ${r.authorRole}` : undefined}>
                  {r.authorName}
                  {r.authorRole ? <span className="text-text-dim"> · {r.authorRole}</span> : null}
                </td>
                <td className="num text-foreground px-3 py-2.5 text-center">{fmtSupportDateTime(r.createdAt)}</td>
                <td className="px-3 py-2.5 text-center">
                  <SupportStatusPill status={r.status} />
                </td>
                <td className="num text-foreground px-3 py-2.5 text-center">{r.dueDate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
