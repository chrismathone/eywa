import { SuperAdminHeader } from "@/components/super-admin/header";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { getAuditLogsPage } from "@/features/super-admin/server/audit";

export const metadata = { title: "Super Admin · 감사 로그 — eywa" };

const PAGE_SIZE = 50;

const ACTION_META: Record<string, { label: string; color: PillColor }> = {
  create_tenant: { label: "학원 발급", color: "primary" },
  update_tenant: { label: "학원 수정", color: "blue" },
  impersonate_view: { label: "지점장 보기", color: "gold" },
  grant_license: { label: "라이선스 부여", color: "purple" },
  toggle_license: { label: "라이선스 토글", color: "purple" },
  change_user_role: { label: "역할 변경", color: "amber" },
  reset_user_password: { label: "비번 재설정", color: "rose" },
  set_user_active: { label: "활성 토글", color: "amber" },
};

const ACTION_FILTERS = [
  { value: "create_tenant", label: "학원 발급" },
  { value: "update_tenant", label: "학원 수정" },
  { value: "impersonate_view", label: "지점장 보기" },
  { value: "grant_license", label: "라이선스 부여" },
  { value: "toggle_license", label: "라이선스 토글" },
  { value: "change_user_role", label: "역할 변경" },
  { value: "reset_user_password", label: "비번 재설정" },
  { value: "set_user_active", label: "활성 토글" },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

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
      <SuperAdminHeader title="감사 로그" breadcrumb={[{ label: "감사 로그" }]} />
      <div className="space-y-4 px-7 py-6">
        <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5">
          <span className="text-text-dim text-xs">액션</span>
          <FilterSelect paramName="action" value={action ?? null} options={ACTION_FILTERS} ariaLabel="액션 필터" />
          <span className="text-text-faint ml-auto font-mono text-[11px]">
            {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
          </span>
        </div>

        <section className="bg-card border-line shadow-card overflow-hidden rounded-md border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-bg-soft text-text-dim border-line border-b">
                <th className="px-4 py-2 text-left font-semibold">시각</th>
                <th className="px-4 py-2 text-left font-semibold">실행자</th>
                <th className="px-4 py-2 text-left font-semibold">액션</th>
                <th className="px-4 py-2 text-left font-semibold">대상 학원</th>
                <th className="px-4 py-2 text-left font-semibold">상세</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-text-dim px-4 py-10 text-center">
                    기록된 액션이 없습니다.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const meta = ACTION_META[log.action] ?? { label: log.action, color: "neutral" as PillColor };
                  return (
                    <tr key={log.id} className="hover:bg-bg-soft">
                      <td className="text-text-dim px-4 py-2.5 font-mono text-[11px] whitespace-nowrap">
                        {fmtTime(log.createdAt)}
                      </td>
                      <td className="text-text-dim px-4 py-2.5 font-mono text-[11px]">{log.actorEmail}</td>
                      <td className="px-4 py-2.5">
                        <Pill color={meta.color} soft>
                          {meta.label}
                        </Pill>
                      </td>
                      <td className="text-foreground px-4 py-2.5">{log.targetLabel ?? "—"}</td>
                      <td className="text-text-dim px-4 py-2.5 font-mono text-[10px]">
                        {log.metadata ? JSON.stringify(log.metadata) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
      </div>
    </>
  );
}
