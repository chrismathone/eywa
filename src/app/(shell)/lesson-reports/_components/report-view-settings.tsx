"use client";

import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Filter, RotateCcw } from "@/components/icons/aywa-icon-compat";
import { classnoteBadge } from "@/features/onescreen/components/report-card";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  IMPORT_FILTER,
  UNSENT_FILTER,
  activeReportFilterCount,
  defaultReportFilters,
  type ReportListFilters,
} from "@/features/report-admin/report-filters";
import { MENT_SOURCES, MENT_SOURCE_LABEL } from "@/features/onescreen/ment-source";
import { monthOf, monthRange } from "@/lib/date-kst";
import type { ReportFilterOptions } from "@/features/report-admin/server/queries";

// 라벨은 classnoteBadge가 해석(한글) — 여기엔 상태 키만. blocked_shared = 프리플라이트 게이트 보류.
// 회수 3종(2026-08-05)도 넣는다 — 관리자가 "회수한 건"·"회수 실패한 건"을 검색으로 찾아야 뒤처리가 된다.
const STATUS_OPTIONS = [
  "queued",
  "processing",
  "success",
  "failed",
  "too_old",
  "name_conflict",
  "blocked_shared",
  "recall_requested",
  "recalled",
  "recall_failed",
];

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

  const active = activeReportFilterCount(filters);

  const patch = (p: Partial<ReportListFilters>) => setDraft((d) => ({ ...d, ...p }));

  // 필터가 바뀌면 항상 1페이지부터(현재 페이지 번호를 물고 가면 빈 화면이 난다).
  const commit = () => {
    setOpen(false);
    onApply({ ...draft, page: 0 });
  };
  const cancel = () => setOpen(false);

  // ⚠️ **닫히면 커밋한다**(2026-07-24 적대검수). base-ui Popover는 바깥 클릭으로 닫히는데, 예전처럼
  // 초안을 그냥 버리면 기간·강사·과목·상태·읽음·반을 다 고른 뒤 표를 보려고 한 번 클릭한 순간
  // **경고 없이 전부 사라진다** — 즉시 적용이던 옛 인라인 필터 바엔 없던 손실이다. 되돌릴 길은 '취소'로 남긴다.
  // ⚠️ '적용'·'취소'는 setOpen을 직접 부른다 — controlled라 prop 변경만으로 닫히고 onOpenChange가 다시
  //    불리지 않으므로 이중 커밋이 안 난다.
  const onOpenChange = (o: boolean) => {
    // 열 때마다 초안을 **현재 적용값으로** 재시드 — 옛 초안이 남아 있으면 안 걸린 필터가 걸린 것처럼 보인다.
    if (o) {
      setDraft(filters);
      setOpen(true);
      return;
    }
    commit();
  };

  const isAllTime = !draft.from && !draft.to;
  const thisMonth = monthRange(monthOf(todayYmd));
  const isThisMonth = draft.from === thisMonth.from && draft.to === thisMonth.to;

  const sel = "border-line bg-card focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none";
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs font-bold transition ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition ${
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
                onClick={() =>
                  // ⚠️ 정렬(sort/dir)은 보존한다 — 팝오버가 다루지도, 배지로 세지도 않는 값을
                  //    "초기화"가 조용히 해제하면 표의 줄 세우기가 이유 없이 되돌아간다(적대검수).
                  setDraft({ ...defaultReportFilters(todayYmd), sort: draft.sort, dir: draft.dir })
                }
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <RotateCcw size={10} strokeWidth={1.8} aria-hidden />
                초기화
              </button>
            </div>

            {/* 기간 — 월 이동은 밖(상단 1줄)에 남겨 두고, 여기선 범위 직접 지정과 전체 기간만 다룬다. */}
            <p className="text-text-faint mb-1 text-xs font-bold">기간</p>
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
              <span className="text-text-faint text-xs">~</span>
              <input
                type="date"
                value={draft.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || undefined })}
                className={sel}
                aria-label="종료일"
              />
            </div>

            <div className="mb-3 grid grid-cols-[42px_1fr] items-center gap-x-2 gap-y-1.5">
              <label className="text-text-faint text-xs font-bold" htmlFor="rvs-teacher">강사</label>
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

              <label className="text-text-faint text-xs font-bold" htmlFor="rvs-subject">과목</label>
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

              {/* 반(0134a) — 옵션은 0147a RPC가 **최근 창에 실제 보고서가 붙은 반만** 준다(반 149개 전체가
                  아니다 — 대부분 0건이라 못 고른다). 마이그레이션 전이면 목록이 비므로 항목 자체를 숨긴다:
                  선택지 없는 드롭다운을 띄우면 "고장"으로 읽힌다. */}
              {/* ⚠️ `?? []` — 배포 중 버전 스큐(구 서버 페이로드에 classes 없음)로 undefined가 와도
                     팝오버 전체가 죽지 않게. 타입상으론 필수지만 런타임 방어가 싸다. */}
              {(options.classes ?? []).length > 0 ? (
                <>
                  <label className="text-text-faint text-xs font-bold" htmlFor="rvs-class">반</label>
                  <select
                    id="rvs-class"
                    value={draft.classId ?? ""}
                    onChange={(e) => patch({ classId: e.target.value || undefined })}
                    className={sel}
                    title="반이 붙은 보고서만 걸립니다 — 이관분은 반 정보가 없어 제외됩니다"
                  >
                    <option value="">전체</option>
                    {(options.classes ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {/* ⚠️ 옵션은 **최근 60일** 보고서에서 뽑는다(강사·과목과 같은 창). 목록은 '전체 기간'을
                      고를 수 있어 옛 학기 반은 목록엔 있어도 이 드롭다운엔 없다 — 자유입력이 없으니
                      기대치를 문구로 맞춘다(안 적으면 "왜 그 반이 없지"가 된다). */}
                  <span />
                  <span className="text-text-faint text-xs leading-snug">
                    최근 60일에 보고서가 있는 반만 — 이관분은 반 정보가 없어 제외됩니다
                  </span>
                </>
              ) : null}

              <label className="text-text-faint text-xs font-bold" htmlFor="rvs-status">상태</label>
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
                {/* 미발송 = classnote_status IS NULL — 등호로 못 잡아 특수값. 알림·발송 큐 카드가 여기로 보낸다. */}
                <option value={UNSENT_FILTER}>미발송(저장만 됨)</option>
                <option value={IMPORT_FILTER}>이관(edutrix)</option>
              </select>

              <label className="text-text-faint text-xs font-bold" htmlFor="rvs-read">읽음</label>
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

              {/* 멘트 작성 방식(0214a) — 강사 필터와 조합 = "그 선생님이 직접 쓴 멘트만"(말투 코퍼스 검수용).
                  마이그레이션 전이면 항목 자체를 숨긴다(반 필터와 같은 규약 — 걸면 400이 나는 필터를 노출하지 않는다).
                  `?? false`는 배포 중 버전 스큐(구 서버 페이로드에 이 키 없음) 런타임 방어(위 classes와 동일). */}
              {(options.mentSourceReady ?? false) ? (
                <>
                  <label className="text-text-faint text-xs font-bold" htmlFor="rvs-ment">멘트</label>
                  <select
                    id="rvs-ment"
                    value={draft.mentSource ?? ""}
                    onChange={(e) => patch({ mentSource: (e.target.value || undefined) as ReportListFilters["mentSource"] })}
                    className={sel}
                    title="멘트를 누가 썼는가 — 직접 작성 / 자동작성 후 수정 / 자동작성 그대로"
                  >
                    <option value="">전체</option>
                    {MENT_SOURCES.map((s) => (
                      <option key={s} value={s}>{MENT_SOURCE_LABEL[s]}</option>
                    ))}
                  </select>
                  {/* 소급 없음 — 도입 이후 저장분만 구분된다. 안 적으면 "왜 옛 보고서가 안 걸리지"가 된다. */}
                  <span />
                  <span className="text-text-faint text-xs leading-snug">
                    도입(2026-08-18) 이후 저장된 보고서만 구분됩니다 — 이전 보고서는 &lsquo;전체&rsquo;에서만 보입니다
                  </span>
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={cancel}
                className="border-line text-text-dim hover:text-foreground rounded-lg border px-2.5 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={commit}
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
