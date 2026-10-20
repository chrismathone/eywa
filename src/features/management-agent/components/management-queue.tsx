import { WindowLink } from "@/components/workspace/window-link";
import { managementQueue } from "../server/queries";
import { CASE_LABEL, caseHref, type CaseStatus } from "../model";
import { RefreshCasesButton } from "./refresh-button";

export async function ManagementQueue({ page = 1, compact = false }: { page?: number; compact?: boolean }) {
  const data = await managementQueue(page);
  if (!data) return null;
  return <section className="border-line bg-card mb-4 space-y-4 rounded-2xl border p-4" aria-label="후속조치 관리">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">상담 후속조치 관리</h2>
      {compact ? <WindowLink href="/consultations/followups" title="후속조치 관리" className="text-primary text-sm">전체 기록 보기</WindowLink> : <RefreshCasesButton />}
    </div>
    {"error" in data ? <p role="alert" className="text-sm">{data.error}</p> : <>
      {data.mode === "observe" ? <p className="text-text-dim text-xs">관찰 중입니다. 기존 알림은 유지하며, 이 기능의 추가 외부 알림은 보내지 않습니다.</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{Object.entries(data.counts).map(([s,n]) => <span key={s}>{CASE_LABEL[s as CaseStatus]} <strong>{n}</strong></span>)}</div>
      {data.notionMessage ? <p role="status" className="text-text-dim text-xs">{data.notionMessage}</p> : null}
      <ul className="divide-line divide-y">{data.rows.slice(0, compact ? 5 : 12).map((row) => <li key={row.id} className="py-3">
        <WindowLink href={caseHref(row.id)} title="상담 후속조치" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-bold">{row.studentName ?? `기록 ${row.id.slice(0,8)}`} · {CASE_LABEL[row.status]}</span>
          <span>예정일 {row.source_due_on} · {row.assigneeName ?? (row.assignee_id ? "담당자 이름 확인 필요" : "담당자 지정 필요")}</span>
        </WindowLink>
        {row.next_check_on ? <p className="text-text-dim mt-1 text-xs">다음 확인 {row.next_check_on}</p> : null}
      </li>)}</ul>
      {data.rows.length === 0 ? <p className="text-text-dim text-sm">이 페이지에 처리 기록이 없습니다. 최신 상담 확인 후 감지 결과를 볼 수 있습니다.</p> : null}
      {compact ? <p className="text-text-dim text-xs">최근 확인된 미종료 건 중 기한이 빠른 5건을 표시합니다.</p> : <nav aria-label="후속조치 페이지" className="flex items-center gap-4 text-sm">
        {page > 1 ? <WindowLink href={`/consultations/followups?page=${page-1}`} title="이전 기록">이전</WindowLink> : null}
        <span>{page}쪽</span>
        {data.hasNext ? <WindowLink href={`/consultations/followups?page=${page+1}`} title="다음 기록">다음</WindowLink> : null}
      </nav>}
      {data.resolved.length ? <details className="text-sm"><summary className="cursor-pointer font-bold">최근 조치 확인 결과</summary>
        <ul className="mt-2 space-y-2">{data.resolved.map((row) => <li key={row.id}>
          <WindowLink href={caseHref(row.id)} title="처리 결과">사건 {row.id.slice(0,8)} · {CASE_LABEL[row.status]}</WindowLink>
        </li>)}</ul>
      </details> : null}
    </>}
  </section>;
}
