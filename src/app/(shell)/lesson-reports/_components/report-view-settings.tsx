"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Filter, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  IMPORT_FILTER,
  activeReportFilterCount,
  defaultReportFilters,
  type ReportListFilters,
} from "@/features/report-admin/report-filters";
import { monthOf, monthRange } from "@/lib/date-kst";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";

// 라벨은 classnoteBadge가 해석(한글) — 여기엔 상태 키만. blocked_shared = 프리플라이트 게이트 보류.
const STATUS_OPTIONS = ["queued", "processing", "success", "failed", "too_old", "name_conflict", "blocked_shared"];

/**
 * 보고서 목록 '뷰 설정' — 기간·강사·과목·상태·읽음을 **한 팝오버에** 모은다
 * (원장 지시 2026-07-24: "뷰 설정 안에 다 때려박으면 좋겠다"). 시간표 뷰 설정과 같은 구조.
 *
 * ⚠️ 왜 인라인 필터 바가 아니라 팝오버인가: 목록 카드 상단이 제목+부제 / 월이동 / 필터 7개 / 발송+안내로
 * **4줄**을 먹어 정작 표가 아래로 밀려났다(원장 제보 "공간낭비"). 팝오버로 빼면 상단이 1줄로 줄고,
 * 가로 압박이 없어져 필터를 더 얹어도 레이아웃이 안 무너진다.
 *
 * ⚠️ 걸린 필터는 트리거 **배지로 항상** 드러낸다 — 숨은 필터는 "왜 이 보고서가 안 보이지"를 만든다
 * (시간표 뷰 설정이 같은 규칙을 타협 불가로 둔 이유).
 *
 * ⚠️ 초안(draft)에서 고르고 **'적용'에서 한 번만** 조회한다 — 셀렉트 5개를 즉시 적용하면 고르는 동안
 * 서버 왕복이 5번 난다(목록은 서버 페이지네이션이라 매번 실제 쿼리).
 */
export function ReportViewSettings({
  options,
  filters,
  todayYmd,
  onApply,
}: {
  options: ReportFilterOptions;
  filters: ReportListFilters; // 현재 **적용된** 값(배지·초안 시드의 진실)
  todayYmd: string; // KST 오늘 — 기본값(이번 달) 판정을 서버와 같게
  onApply: (next: ReportListFilters) => void;
}) {
  const subjects = useSubjectMaps(); // 과목 표시는 한글 라벨(raw 키 노출 금지)
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReportListFilters>(filters);

  const active = activeReportFilterCount(filters, todayYmd);

  // 열 때마다 초안을 **현재 적용값으로** 맞춘다 — 취소하고 다시 열었을 때 옛 초안이 남아 있으면
  // 화면에 안 걸린 필터가 걸린 것처럼 보인다.
  const onOpenChange = (o: boolean) => {
    if (o) setDraft(filters);
    setOpen(o);
  };

  const patch = (p: Partial<ReportListFilters>) => setDraft((d) => ({ ...d, ...p }));
  const apply = () => {
    onApply({ ...draft, page: 0 }); // 필터가 바뀌면 항상 1페이지부터(현재 페이지 번호를 물고 가면 빈 화면이 난다)
    setOpen(false);
  };

  const isAllTime = !draft.from && !draft.to;
  const thisMonth = monthRange(monthOf(todayYmd));
  const isThisMonth = draft.from === thisMonth.from && draft.to === thisMonth.to;

  const sel = "border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-[12px] outline-none";
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
        }`}
        title="기간·강사·과목·상태·읽음을 한 곳에서 고릅니다"
      >
        <Filter size={11} strokeWidth={1.8} aria-hidden />
        {active ? `필터 ${active}` : "뷰 설정"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border p-3 text-left outline-none">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">뷰 설정</span>
              <button
                type="button"
                onClick={() => setDraft(defaultReportFilters(todayYmd))}
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-[11px]"
              >
                <RotateCcw size={10} strokeWidth={1.8} aria-hidden />
                초기화
              </button>
            </div>

            {/* 기간 — 월 이동은 밖(상단 1줄)에 남겨 두고, 여기선 범위 직접 지정과 전체 기간만 다룬다. */}
            <p className="text-text-faint mb-1 text-[11px] font-bold">기간</p>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => patch(thisMonth)} aria-pressed={isThisMonth} className={chip(isThisMonth)}>
                이번 달
              </button>
              <button
                type="button"
                onClick={() => patch({ from: undefined, to: undefined })}
                aria-pressed={isAllTime}
                className={chip(isAllTime)}
                title="전체 기간에서는 정렬을 눌러도 오래된 기록이 먼저 나올 수 있습니다"
              >
                전체 기간
              </button>
            </div>
            <div className="mb-3 flex items-center gap-1.5">
              <input
                type="date"
                value={draft.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || undefined })}
                className={sel}
                aria-label="시작일"
              />
              <span className="text-text-faint text-[12px]">~</span>
              <input
                type="date"
                value={draft.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || undefined })}
                className={sel}
                aria-label="종료일"
              />
            </div>

            <div className="mb-3 grid grid-cols-[42px_1fr] items-center gap-x-2 gap-y-1.5">
              <label className="text-text-faint text-[11px] font-bold" htmlFor="rvs-teacher">강사</label>
              <select
                id="rvs-teacher"
                value={draft.teacher ?? ""}
                onChange={(e) => patch({ teacher: e.target.value || undefined })}
                className={sel}
              >
                <option value="">전체</option>
                {options.teachers.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <label className="text-text-faint text-[11px] font-bold" htmlFor="rvs-subject">과목</label>
              <select
                id="rvs-subject"
                value={draft.subject ?? ""}
                onChange={(e) => patch({ subject: e.target.value || undefined })}
                className={sel}
              >
                <option value="">전체</option>
                {options.subjects.map((s) => (
                  <option key={s} value={s}>{subjects.labelOf(s)}</option>
                ))}
              </select>

              <label className="text-text-faint text-[11px] font-bold" htmlFor="rvs-status">상태</label>
              <select
                id="rvs-status"
                value={draft.status ?? ""}
                onChange={(e) => patch({ status: e.target.value || undefined })}
                className={sel}
              >
                <option value="">전체</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{classnoteBadge(s)?.label ?? s}</option>
                ))}
                <option value={IMPORT_FILTER}>이관(edutrix)</option>
              </select>

              <label className="text-text-faint text-[11px] font-bold" htmlFor="rvs-read">읽음</label>
              <select
                id="rvs-read"
                value={draft.read ?? ""}
                onChange={(e) => patch({ read: (e.target.value || undefined) as ReportListFilters["read"] })}
                className={sel}
                title="안읽음 = 발송 성공했고 읽음 확인이 가능한데 아직 안 읽은 건만 (확인 불가한 옛 이관분 제외)"
              >
                <option value="">전체</option>
                <option value="read">읽음</option>
                <option value="unread">안읽음</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-line text-text-dim hover:text-foreground rounded-lg border px-2.5 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={apply}
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1 text-xs font-medium"
              >
                적용
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
