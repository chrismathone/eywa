"use client";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PAGER_STEP_BASE, PAGER_STEP_ENABLED, PAGER_STEP_DISABLED, PAGER_LABEL } from "@/components/pagination";
export function ListPager({ page, total, pageSize, onChange, label = "목록", unit = "건" }: {
  page: number; total: number; pageSize: number; onChange: (page: number) => void; label?: string; unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize)), current = Math.min(page, pages);
  return <nav aria-label={`${label} 페이지`} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
    <p className="text-xs" aria-live="polite">전체 {total.toLocaleString("ko-KR")}{unit}{total > 0 && ` 중 ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, total)}${unit}`}</p>
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`${label} 이전 페이지`} disabled={current <= 1} onClick={() => onChange(current - 1)} className={`${PAGER_STEP_BASE} ${current <= 1 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED} focus-visible:outline-primary`}><EyIcon name="chevronLeft" size={16} />이전</button>
      <span className={PAGER_LABEL}>{current} / {pages}</span>
      <button type="button" aria-label={`${label} 다음 페이지`} disabled={current >= pages} onClick={() => onChange(current + 1)} className={`${PAGER_STEP_BASE} ${current >= pages ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED} focus-visible:outline-primary`}>다음<EyIcon name="chevronRight" size={16} /></button>
    </div>
  </nav>;
}
