"use client";

// 원장 보고서 관리 > 보고서 목록/필터(5단계-2 Part C) — 강사·기간·상태·과목 필터 + 열람(/r·/print)
// + 관리자 최초 발송(미발송 native만 선택 가능 — 이미 발송·이관분은 서버·UI 이중 차단, 2026-07-10).
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { listReports, sendClassnoteForUnsent } from "@/features/report-admin/server/actions";
import {
  IMPORT_FILTER,
  isAdminSendable,
  type ReportListFilters,
  type ReportListRow,
} from "@/features/report-admin/report-filters";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";

const STATUS_OPTIONS = ["queued", "processing", "success", "failed", "too_old", "name_conflict"];

// 시:분(KST). timestamptz → Asia/Seoul HH:mm. 값 없으면 빈 문자열.
function hhmmKst(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

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

export function ReportList({
  options,
  initial,
  canSend,
}: {
  options: ReportFilterOptions;
  initial: Result;
  canSend: boolean; // lesson_reports 쓰기 권한(관리자 발송 열 노출 여부) — 서버 액션이 최종 게이트
}) {
  const router = useRouter();
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [filters, setFilters] = useState<ReportListFilters>({ page: 0 });
  const [result, setResult] = useState<Result>(initial);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  function run(next: ReportListFilters) {
    setFilters(next);
    setChecked(new Set()); // 페이지·필터 전환 시 선택 초기화 — 화면 밖 행 발송 방지
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
  const sendable = rows.filter(isAdminSendable);
  const allChecked = sendable.length > 0 && sendable.every((r) => checked.has(r.id));

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doSend() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    const res = await sendClassnoteForUnsent(ids);
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — 승인 전이라 실제 발송 안 함. 원장 설정(보고서)에서 'ClassNote 실제 발송'을 켜야 전송됩니다");
      setChecked(new Set());
    } else if (res.ok) {
      const parts = [`${res.queued ?? 0}건 발송 대기`];
      if (res.conflicts) parts.push(`${res.conflicts}건 동명이인 차단`);
      if (res.skipped) parts.push(`${res.skipped}건 제외(이미 발송·과목 미허용·오래된 보고서)`);
      toast.success(parts.join(" · "));
      setChecked(new Set());
      run({ ...filters }); // 목록 상태 갱신
      router.refresh(); // 상단 발송 큐 카드(서버 렌더) 갱신
    } else toast.error(res.error ?? "발송 요청에 실패했습니다");
  }

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
            <option key={s} value={s}>{subjects.labelOf(s)}</option>
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

      {/* 관리자 발송 — 미발송(native)만 대상. 이미 발송된 건은 선택 자체가 안 되고 서버도 거부(중복발송 차단). */}
      {canSend ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || pending || checked.size === 0} onClick={doSend}>
            선택 발송 {checked.size > 0 ? `(${checked.size})` : ""}
          </Button>
          <span className="text-text-faint text-[12px]">
            미발송 보고서만 선택 가능 · 발송된 건의 재발송은 위 발송 큐 카드에서
          </span>
        </div>
      ) : null}

      <div className="border-line overflow-x-auto rounded-md border">
        <table className="w-full min-w-[600px] text-left text-[12px]">
          <thead>
            <tr className="border-line text-text-faint border-b">
              {canSend ? (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={sendable.length === 0}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(sendable.map((r) => r.id)))}
                    aria-label="현재 페이지 미발송 전체 선택"
                  />
                </th>
              ) : null}
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
                <td colSpan={canSend ? 6 : 5} className="text-text-faint px-3 py-6 text-center">
                  조건에 맞는 보고서가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft border-b last:border-b-0">
                  {canSend ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        disabled={!isAdminSendable(r)}
                        aria-label={`${r.studentName} 발송 선택`}
                        title={isAdminSendable(r) ? undefined : "미발송 보고서만 발송할 수 있습니다"}
                      />
                    </td>
                  ) : null}
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">
                    {r.reportDate}
                    {/* 발송분은 실제 발송 시각(classnote_sent_at), 미발송분은 작성/등록 시각 폴백 */}
                    {r.sentAt || r.createdAt ? (
                      <span
                        className="text-text-faint ml-1.5"
                        title={r.sentAt ? "학부모 발송 시각" : "작성·등록 시각(발송 전)"}
                      >
                        {hhmmKst(r.sentAt ?? r.createdAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-foreground font-semibold">{r.studentName}</span>
                    {r.subject ? <span className="text-text-faint ml-1.5">{subjects.labelOf(r.subject)}</span> : null}
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
