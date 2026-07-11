import { ScrollText } from "lucide-react";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { getAuditLogsPage, getAuditNameMap, AUDIT_ACTIONS, auditActionLabel } from "@/features/audit/server/log";
import { auditDetail, auditTargetName, AUDIT_TYPE_LABEL } from "@/features/audit/describe";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 감사로그 면 (owner ?tab=audit) — 역할 변경·삭제·청구서·시험·급여 등 주요 작업 이력. 구 /admin/audit 흡수.
 * FilterSelect(action)는 currentParams를 복사해 tab=audit·embed를 자동 유지. Pagination만 pageHref가 명시 유지.
 */
export async function AuditFace({
  action,
  page,
  isEmbed,
}: {
  action?: string;
  page: number;
  isEmbed: boolean;
}) {
  // 설정(과목 라벨)은 독립 조회라 병렬(B4) — 이름 맵만 rows에 의존.
  const [{ rows: logs, total }, settings] = await Promise.all([
    getAuditLogsPage({ action }, page, PAGE_SIZE),
    getTenantSettings(),
  ]);
  const names = await getAuditNameMap(logs);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const nameOf = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "audit" });
    if (action && action !== "all") sp.set("action", action);
    if (p > 1) sp.set("page", String(p));
    if (isEmbed) sp.set("embed", "1");
    return `/owner?${sp.toString()}`;
  };

  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 운영 감사로그</p>
        <h2 className="text-foreground text-lg font-semibold">작업 이력</h2>
      </header>

      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5">
        <span className="text-text-dim text-xs">액션</span>
        <FilterSelect paramName="action" value={action ?? null} options={ACTION_FILTERS} ariaLabel="액션 필터" />
        <span className="text-text-faint ml-auto font-mono text-[11px]">
          {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState
          image="audit"
          icon={() => <ScrollText size={32} strokeWidth={1.5} />}
          title="기록된 작업이 없습니다"
          description="역할 변경·삭제·청구서·시험·급여 등 주요 작업이 발생하면 여기에 기록됩니다."
        />
      ) : (
        <>
          <DragScrollArea className="bg-card border-line shadow-card rounded-md border">
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
                        <span className="text-text-faint mr-1">
                          {AUDIT_TYPE_LABEL[log.targetType] ?? log.targetType}
                        </span>
                      ) : null}
                      {log.targetLabel ?? auditTargetName(log.metadata, nameOf) ?? "—"}
                    </td>
                    {/* 상세 = 한글 요약, 원문 JSON은 title 툴팁으로만(raw 노출 금지 규칙) */}
                    <td
                      className="text-text-dim px-4 py-2.5 text-[11px]"
                      title={log.metadata ? JSON.stringify(log.metadata) : undefined}
                    >
                      <span className="inline-block max-w-[420px] truncate align-bottom">
                        {auditDetail(log.action, log.metadata, { nameOf, subjectLabel: subjects.labelOf }) ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DragScrollArea>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
