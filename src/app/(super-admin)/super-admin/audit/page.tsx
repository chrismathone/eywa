import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { TABLE_COL_LINES, TH, fmtNum } from "@/components/super-admin/parts";
import { AUDIT_ACTION_OPTIONS, auditActionMeta, auditDetail } from "@/features/super-admin/labels";
import { toneColor } from "@/lib/design/semantic-color";
import { getAuditLogsPage } from "@/features/super-admin/server/audit";

export const metadata = { title: "슈퍼관리자 · 감사 로그 — 에이와" };

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 감사 로그 — 슈퍼관리자가 한 모든 조치(발급·수정·지점장 보기·라이선스·계정 관리).
 * 🔴 상세는 `auditDetail`이 만든 **한글 문장**이다 — `metadata` 원문(JSON)은 `title` 툴팁으로만(원문 노출 금지 규칙).
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const { action, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { rows: logs, total } = await getAuditLogsPage({ action }, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (action && action !== "all") sp.set("action", action);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/super-admin/audit?${s}` : "/super-admin/audit";
  };

  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="감사 로그"
        description="슈퍼관리자가 한 조치를 시간 역순으로 봅니다."
        embedLabel="슈퍼관리자 조치 기록"
      />

      <Toolbar>
        <FilterSelect
          paramName="action"
          axisLabel="조치"
          value={action ?? null}
          options={AUDIT_ACTION_OPTIONS}
          ariaLabel="조치 종류 필터"
          triggerClassName={TOOLBAR_SELECT}
        />
        <span className="num text-foreground ml-auto text-sm">
          {fmtNum(total)}건{totalPages > 1 ? ` · ${page}/${totalPages}쪽` : ""}
        </span>
      </Toolbar>

      <section className="bg-card shadow-card stack-rows overflow-hidden rounded-2xl" aria-label="감사 로그">
        <div className="overflow-x-auto">
          <table className={`w-full min-w-[880px] text-sm ${TABLE_COL_LINES}`}>
            <thead>
              <tr>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>시각</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>조치</th>
                <th scope="col" data-cell="label" className={`${TH} text-left`}>대상 학원</th>
                <th scope="col" data-cell="label" className={`${TH} text-left`}>내용</th>
                <th scope="col" data-cell="label" className={`${TH} text-left`}>실행자</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-foreground px-4 py-10 text-center">
                    기록된 조치가 없습니다.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const meta = auditActionMeta(log.action);
                  return (
                    <tr key={log.id} className="hover:bg-muted">
                      <td data-cell="lead" className="num text-foreground px-3 py-2.5 text-center whitespace-nowrap">
                        {fmtTime(log.createdAt)}
                      </td>
                      <td data-cell="status" className="px-3 py-2.5 text-center">
                        <Pill color={toneColor(meta.tone)}>{meta.label}</Pill>
                      </td>
                      <td data-cell="primary" className="text-foreground px-3 py-2.5 font-bold">
                        {log.targetLabel ?? "—"}
                      </td>
                      <td
                        className="text-foreground px-3 py-2.5"
                        title={log.metadata ? JSON.stringify(log.metadata) : undefined}
                      >
                        {auditDetail(log.action, log.metadata)}
                      </td>
                      <td className="text-foreground max-w-[16rem] truncate px-3 py-2.5" title={log.actorEmail}>
                        {log.actorEmail}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Pagination page={page} totalPages={totalPages} total={total} hrefForPage={pageHref} />
    </>
  );
}
