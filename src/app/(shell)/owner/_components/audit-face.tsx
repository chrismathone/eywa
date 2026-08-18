import { ScrollText } from "@/components/icons/eywa-icon-compat";
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
  // ⚠️ 시각은 KST 고정 — 서버(Vercel=UTC) 렌더라 timeZone 안 박으면 UTC로 나온다(makeedu-sync-runs.tsx 동일 경고).
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
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
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function AuditFace({
  action,
  q,
  from,
  to,
  page,
  isEmbed,
}: {
  action?: string;
  /** 텍스트 검색(원장 2026-08-18) — 실행자·대상·학생/직원 이름·한글 액션 라벨을 한 칸으로 찾는다. */
  q?: string;
  /** 기간 필터(KST 날짜, 달력 입력 — 원장 2026-08-18 "기간별 검색도"). */
  from?: string;
  to?: string;
  page: number;
  isEmbed: boolean;
}) {
  const query = (q ?? "").trim();
  const dateFrom = from && YMD_RE.test(from) ? from : undefined;
  const dateTo = to && YMD_RE.test(to) ? to : undefined;
  // 설정(과목 라벨)은 독립 조회라 병렬(B4) — 이름 맵만 rows에 의존.
  const [{ rows: logs, total }, settings] = await Promise.all([
    getAuditLogsPage({ action, q: query, dateFrom, dateTo }, page, PAGE_SIZE),
    getTenantSettings(),
  ]);
  const names = await getAuditNameMap(logs);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const nameOf = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "audit" });
    if (action && action !== "all") sp.set("action", action);
    if (query) sp.set("q", query);
    if (dateFrom) sp.set("from", dateFrom);
    if (dateTo) sp.set("to", dateTo);
    if (p > 1) sp.set("page", String(p));
    if (isEmbed) sp.set("embed", "1");
    return `/owner?${sp.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* Editorial 문법 ① — 구분선 대신 여백 리듬(문법 ⑥) */}
      <header>
        <p className="editorial-eyebrow">관리 · 운영 감사로그</p>
        <h2 className="text-foreground mt-1 text-lg font-bold">작업 이력</h2>
      </header>

      <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <span className="text-text-dim text-xs">액션</span>
        <FilterSelect paramName="action" value={action ?? null} options={ACTION_FILTERS} ariaLabel="액션 필터" />
        {/* 텍스트+기간 검색(GET) — 서버 컴포넌트라 클라 JS 없이 폼 제출로 필터. tab·embed·action은
            hidden으로 동행(안 실으면 제출 순간 audit 면·창 모드·액션 필터가 풀린다). 페이지는 1로 리셋. */}
        <form method="get" action="/owner" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="audit" />
          {isEmbed ? <input type="hidden" name="embed" value="1" /> : null}
          {action && action !== "all" ? <input type="hidden" name="action" value={action} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="이름·실행자·액션 검색"
            aria-label="감사로그 텍스트 검색"
            className="border-line bg-bg-soft text-foreground placeholder:text-text-faint h-8 w-44 rounded-lg border px-2.5 text-xs outline-none focus:border-primary"
          />
          <input
            type="date"
            name="from"
            defaultValue={dateFrom ?? ""}
            aria-label="검색 시작일"
            className="border-line bg-bg-soft text-foreground num h-8 rounded-lg border px-2 text-xs outline-none focus:border-primary"
          />
          <span className="text-text-faint text-xs">~</span>
          <input
            type="date"
            name="to"
            defaultValue={dateTo ?? ""}
            aria-label="검색 종료일"
            className="border-line bg-bg-soft text-foreground num h-8 rounded-lg border px-2 text-xs outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft h-8 rounded-lg border px-3 text-xs transition"
          >
            검색
          </button>
          {query || dateFrom || dateTo ? (
            <a
              href={`/owner?tab=audit${isEmbed ? "&embed=1" : ""}${action && action !== "all" ? `&action=${action}` : ""}`}
              className="text-text-faint hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              초기화
            </a>
          ) : null}
        </form>
        <span className="text-text-faint num ml-auto text-[12px]">
          {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState
          image="audit"
          icon={() => <ScrollText size={32} strokeWidth={1.8} />}
          title={
            query || dateFrom || dateTo || (action && action !== "all")
              ? "조건에 맞는 기록이 없습니다"
              : "기록된 작업이 없습니다"
          }
          description={
            query || dateFrom || dateTo || (action && action !== "all")
              ? "검색어·기간·액션 필터를 조정해 보세요."
              : "역할 변경·삭제·청구서·시험·급여 등 주요 작업이 발생하면 여기에 기록됩니다."
          }
        />
      ) : (
        <>
          <DragScrollArea className="bg-card shadow-card rounded-2xl">
            <table className="w-full text-[12px] [&_td]:whitespace-nowrap">
              <thead>
                <tr className="bg-bg-soft text-text-dim border-line border-b [&_th]:whitespace-nowrap">
                  <th className="px-4 py-2 text-left font-bold">시각</th>
                  <th className="px-4 py-2 text-left font-bold">실행자</th>
                  <th className="px-4 py-2 text-left font-bold">액션</th>
                  <th className="px-4 py-2 text-left font-bold">대상</th>
                  <th className="px-4 py-2 text-left font-bold">상세</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-bg-soft/50">
                    <td className="text-text-dim num px-4 py-2.5 text-[11px]">{fmtTime(log.createdAt)}</td>
                    <td className="text-text-dim px-4 py-2.5">{log.actorName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <Pill color={ACTION_COLOR[log.action] ?? "neutral"} soft>
                        {auditActionLabel(log.action)}
                      </Pill>
                    </td>
                    {/* 위계: 액션(Pill bold) > 대상 dim — 행에서 액션이 먼저 읽히게 */}
                    <td className="text-text-dim px-4 py-2.5">
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
