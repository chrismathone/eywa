import { ScrollText } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { getAuditLogsPage, AUDIT_ACTIONS, auditActionLabel } from "@/features/audit/server/log";

export const metadata = { title: "운영 감사로그 — eywa" };

const PAGE_SIZE = 50;

const ACTION_COLOR: Record<string, PillColor> = {
  staff_role_change: "amber",
  staff_delete: "danger",
  invoice_create: "primary",
  exam_create: "blue",
  exam_delete: "danger",
  exam_scores: "blue",
  payroll_upsert: "purple",
  withdrawal_update: "rose",
};

const ACTION_FILTERS = Object.entries(AUDIT_ACTIONS).map(([value, label]) => ({ value, label }));

const TYPE_LABEL: Record<string, string> = {
  staff: "직원",
  student: "학생",
  invoice: "청구서",
  exam: "시험",
  payroll: "급여",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  await requireAccess("admin"); // master 전용 (admin 메뉴 = master)
  const { action, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { rows: logs, total } = await getAuditLogsPage({ action }, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (action && action !== "all") sp.set("action", action);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <div className="space-y-4">
      <BackLink href="/admin" label="관리자 도구로" />

      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5">
        <span className="text-text-dim text-xs">액션</span>
        <FilterSelect paramName="action" value={action ?? null} options={ACTION_FILTERS} ariaLabel="액션 필터" />
        <span className="text-text-faint ml-auto font-mono text-[11px]">
          {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={() => <ScrollText size={32} strokeWidth={1.5} />}
          title="기록된 작업이 없습니다"
          description="역할 변경·삭제·청구서·시험·급여 등 주요 작업이 발생하면 여기에 기록됩니다."
        />
      ) : (
        <>
          <section className="bg-card border-line shadow-card overflow-auto rounded-md border">
            <table className="w-full text-[12px] [&_td]:whitespace-nowrap">
              <thead>
                <tr className="bg-bg-soft text-text-dim border-line border-b [&_th]:whitespace-nowrap">
                  <th className="px-4 py-2 text-left font-semibold">시각</th>
                  <th className="px-4 py-2 text-left font-semibold">실행자</th>
                  <th className="px-4 py-2 text-left font-semibold">액션</th>
                  <th className="px-4 py-2 text-left font-semibold">대상</th>
                  <th className="px-4 py-2 text-left font-semibold">상세</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-bg-soft/50">
                    <td className="text-text-dim px-4 py-2.5 font-mono text-[11px]">{fmtTime(log.createdAt)}</td>
                    <td className="text-text-dim px-4 py-2.5">{log.actorName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <Pill color={ACTION_COLOR[log.action] ?? "neutral"} soft>
                        {auditActionLabel(log.action)}
                      </Pill>
                    </td>
                    <td className="text-foreground px-4 py-2.5">
                      {log.targetType ? (
                        <span className="text-text-faint mr-1">{TYPE_LABEL[log.targetType] ?? log.targetType}</span>
                      ) : null}
                      {log.targetLabel ?? "—"}
                    </td>
                    <td className="text-text-dim px-4 py-2.5 font-mono text-[10px]">
                      {log.metadata ? JSON.stringify(log.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
