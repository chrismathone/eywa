import Link from "next/link";
import { Pill } from "@/components/atoms/pill";
import { TABLE_COL_LINES, TH } from "@/components/super-admin/parts";
import { WindowLink } from "@/components/workspace/window-link";
import { toneColor } from "@/lib/design/semantic-color";
import { fmtSupportDate } from "@/features/support/format";
import type { SupportNoticeListItem } from "@/features/support/types";

/**
 * 공지사항 목록 표 — makeedu 공지 목록(No · 제목 · 등록일)과 같은 모양. 고정 공지는 번호 자리에 '공지' 배지.
 * 번호는 고정 공지를 뺀 일반 공지에만 역순으로 매긴다(`normalTotal` = 일반 공지 총 건수, `normalOffset` = 이 쪽 앞의 일반 공지 수).
 */
export function SupportNoticeTable({
  rows,
  hrefFor,
  normalTotal,
  normalOffset,
  windowed = true,
}: {
  rows: SupportNoticeListItem[];
  hrefFor: (id: string) => string;
  normalTotal: number;
  normalOffset: number;
  windowed?: boolean;
}) {
  const LinkAs = windowed ? WindowLink : Link;
  // 일반 공지만 역순 번호 — 고정 공지는 번호 대신 배지.
  const nos: (number | null)[] = [];
  for (const r of rows) {
    nos.push(r.pinned ? null : normalTotal - normalOffset - nos.filter((n) => n !== null).length);
  }
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl" aria-label="공지사항 목록">
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[560px] table-fixed text-sm ${TABLE_COL_LINES}`}>
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${TH} text-center`}>No</th>
              <th scope="col" className={`${TH} text-left`}>제목</th>
              <th scope="col" className={`${TH} text-center`}>등록일</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((r, i) => {
              const no = nos[i];
              return (
                <tr key={r.id} className={r.pinned ? "bg-bg-soft/60" : "hover:bg-bg-soft/60"}>
                  <td className="num text-text-dim px-3 py-2.5 text-center">
                    {no === null ? <Pill color={toneColor("critical")}>공지</Pill> : no}
                  </td>
                  <td className="px-3 py-2.5">
                    <LinkAs
                      href={hrefFor(r.id)}
                      title={r.title}
                      className={`hover:text-primary block truncate ${r.pinned ? "text-foreground font-bold" : "text-foreground"}`}
                    >
                      {r.title}
                    </LinkAs>
                  </td>
                  <td className="num text-foreground px-3 py-2.5 text-center">{fmtSupportDate(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
