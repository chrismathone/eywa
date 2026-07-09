"use client";

// 원장 보고서 관리 > 보고서 목록/필터(5단계-2 Part C) — 강사·기간·상태·과목 필터 + 열람(/r·/print).
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { IMPORT_FILTER, listReports, type ReportListFilters, type ReportListRow } from "@/features/report-admin/server/actions";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";

const STATUS_OPTIONS = ["queued", "processing", "success", "failed", "too_old", "name_conflict"];

/** 발송 상태 표시 — eywa 발송이력(classnote_status) 우선, 없으면 이관(edutrix)/미발송 구분. */
function StatusCell({ status, source }: { status: string | null; source: string | null }) {
  const badge = classnoteBadge(status ?? undefined);
  if (badge) return <span className={`text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>;
  // 발송 이력 없음: 이관분(edutrix)은 "이관"(발송 아님, 오해 방지), 그 외는 진짜 "미발송".
  if (source === "edutrix_import")
    return <span className="text-text-faint text-[11px]" title="edutrix에서 이관된 기록(eywa 발송 아님)">이관</span>;
  return <span className="text-amber text-[11px]">미발송</span>;
}

type Result = { rows: ReportListRow[]; total: number; page: number; pageSize: number };

export function ReportList({ options, initial }: { options: ReportFilterOptions; initial: Result }) {
  const [filters, setFilters] = useState<ReportListFilters>({ page: 0 });
  const [result, setResult] = useState<Result>(initial);
  const [pending, start] = useTransition();

  function run(next: ReportListFilters) {
    setFilters(next);
    start(async () => {
      const res = await listReports(next);
      if (res.ok) setResult({ rows: res.rows ?? [], total: res.total ?? 0, page: res.page ?? 0, pageSize: res.pageSize ?? 30 });
      else toast.error(res.error ?? "목록을 불러오지 못했습니다");
    });
  }
  const set = (patch: Partial<ReportListFilters>) => run({ ...filters, ...patch, page: 0 });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const openReport = (r: ReportListRow) => {
    const url = r.shareToken ? `${origin}/r/${r.shareToken}` : `${origin}/lesson_reports/${r.id}/print`;
    window.open(url, "_blank", "noopener");
  };

  const { rows, total, page, pageSize } = result;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  const selCls =
    "border-line bg-card focus:border-primary h-8 rounded-sm border px-2 text-[12px] outline-none";

  return (
    <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
      <div className="mb-3">
        <h2 className="text-foreground text-[15px] font-semibold">보고서 목록</h2>
        <p className="text-text-faint text-[12px]">강사·기간·상태·과목으로 조회 · 행 클릭 시 학부모 보고서 열람</p>
      </div>

      {/* 필터 바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} className={selCls} aria-label="시작일" />
        <span className="text-text-faint text-[12px]">~</span>
        <input type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} className={selCls} aria-label="종료일" />
        <select value={filters.teacher ?? ""} onChange={(e) => set({ teacher: e.target.value || undefined })} className={selCls} aria-label="강사">
          <option value="">강사 전체</option>
          {options.teachers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={filters.subject ?? ""} onChange={(e) => set({ subject: e.target.value || undefined })} className={selCls} aria-label="과목">
          <option value="">과목 전체</option>
          {options.subjects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })} className={selCls} aria-label="상태">
          <option value="">상태 전체</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{classnoteBadge(s)?.label ?? s}</option>
          ))}
          <option value={IMPORT_FILTER}>이관(edutrix)</option>
        </select>
        {(filters.from || filters.to || filters.teacher || filters.subject || filters.status) ? (
          <Button size="sm" variant="ghost" onClick={() => run({ page: 0 })}>
            초기화
          </Button>
        ) : null}
        <span className="text-text-faint ml-auto text-[12px]">{pending ? "불러오는 중…" : `총 ${total}건`}</span>
      </div>

      <div className="border-line overflow-x-auto rounded-md border">
        <table className="w-full min-w-[600px] text-left text-[12px]">
          <thead>
            <tr className="border-line text-text-faint border-b">
              <th className="px-3 py-2 font-semibold">날짜</th>
              <th className="px-3 py-2 font-semibold">학생 · 과목</th>
              <th className="px-3 py-2 font-semibold">강사</th>
              <th className="px-3 py-2 font-semibold">발송 상태</th>
              <th className="px-3 py-2 text-right font-semibold">열람</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-text-faint px-3 py-6 text-center">
                  조건에 맞는 보고서가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft border-b last:border-b-0">
                  <td className="text-text-dim px-3 py-2">{r.reportDate}</td>
                  <td className="px-3 py-2">
                    <span className="text-foreground font-semibold">{r.studentName}</span>
                    {r.subject ? <span className="text-text-faint ml-1.5">{r.subject}</span> : null}
                  </td>
                  <td className="text-text-dim px-3 py-2">{r.teacherName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusCell status={r.classnoteStatus} source={r.source} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => openReport(r)}>
                      열람
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {maxPage > 0 ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-[12px]">
          <Button size="sm" variant="ghost" disabled={page <= 0 || pending} onClick={() => run({ ...filters, page: page - 1 })}>
            이전
          </Button>
          <span className="text-text-dim">
            {page + 1} / {maxPage + 1}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= maxPage || pending} onClick={() => run({ ...filters, page: page + 1 })}>
            다음
          </Button>
        </div>
      ) : null}
    </section>
  );
}
