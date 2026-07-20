import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { addDays } from "@/lib/date-kst";
import type { TodayClass } from "../server/roster";

/**
 * 원스크린 상단 바 — 날짜 + 반 필터 + 오늘 수업 + 마감 통계 + 카드/표 토글을 **한 줄(반응형)**로.
 * 예전 TopBar+HubBar 2개 카드를 하나의 flex-wrap 바로 합침 — 넓은 화면은 1줄, 좁으면 자연 wrap(불필요한 2줄 제거).
 */
export function OneScreenTopBar({
  today,
  date,
  todayYmd,
  onDateChange,
  classTags,
  classFilter,
  onFilter,
  doneCount,
  total,
  view,
  onView,
  stats,
  todayClasses,
  noticeMode,
  academyNoticeMode,
  onNoticeMode,
  makeupAdder,
}: {
  today: string;
  date: string; // 대상 날짜(YYYY-MM-DD)
  todayYmd: string; // KST 오늘(YYYY-MM-DD) — 다음날 이동 상한
  onDateChange: (ymd: string) => void; // 날짜 이동(searchParam 네비)
  classTags: readonly string[];
  classFilter: string;
  onFilter: (tag: string) => void;
  doneCount: number;
  total: number;
  view: "card" | "grid" | "status" | "history" | "notice";
  onView: (v: "card" | "grid" | "status" | "history" | "notice") => void;
  stats: { students: number; progressDone: number; testDone: number; reportDone: number };
  todayClasses: TodayClass[];
  noticeMode: "A" | "B" | null; // 강사 본인 멘트 모드(null=학원 기본)
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드
  onNoticeMode: (mode: "A" | "B" | null) => void;
  makeupAdder?: ReactNode; // 보강 학생 추가 컨트롤(슬롯)
}) {
  const noticeOptions: { value: "A" | "B" | null; label: string }[] = [
    { value: null, label: `학원 기본(${academyNoticeMode})` },
    { value: "A", label: "단일 A" },
    { value: "B", label: "2문단 B" },
  ];
  const isToday = date >= todayYmd; // 오늘(또는 이상) = 다음날 이동 막고 '오늘' 버튼 숨김
  return (
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-3 py-2">
      {/* 날짜 — 이전/다음 이동 + 날짜 선택(과거 날짜 마감·재발송). report_date=카드 표시일=ClassNote 게시일. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="bg-primary-soft text-primary flex size-7 items-center justify-center rounded-sm">
          <EyIcon name="check" size={14} />
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, -1))}
            aria-label="이전 날짜"
            className="text-text-dim hover:bg-bg-soft rounded-sm px-1 py-1"
          >
            <EyIcon name="chevronLeft" size={16} />
          </button>
          <div className="min-w-[128px] text-center">
            <p className="micro text-text-faint">{isToday ? "수업 마감" : "지난 마감"}</p>
            <label className="relative block cursor-pointer">
              <p className="text-foreground text-[13px] font-bold">{today}</p>
              {/* 네이티브 date input을 겹쳐 라벨 클릭 = 달력 열기(표시는 한글 날짜 유지). */}
              <input
                type="date"
                value={date}
                max={todayYmd}
                onChange={(e) => e.target.value && onDateChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="날짜 선택"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, 1))}
            disabled={isToday}
            aria-label="다음 날짜"
            className="text-text-dim hover:bg-bg-soft rounded-sm px-1 py-1 disabled:opacity-30"
          >
            <EyIcon name="chevronRight" size={16} />
          </button>
          {!isToday ? (
            <button
              type="button"
              onClick={() => onDateChange(todayYmd)}
              className="border-line text-primary hover:bg-bg-soft ml-1 rounded-lg border px-1.5 py-0.5 text-[11px] font-bold"
            >
              오늘
            </button>
          ) : null}
        </div>
      </div>

      <span className="bg-line hidden h-5 w-px shrink-0 sm:block" aria-hidden />

      {/* 반 필터 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {classTags.map((tag) => {
          const on = tag === classFilter;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onFilter(tag)}
              aria-pressed={on}
              className={`rounded-pill px-2.5 py-1 text-[12px] font-bold transition ${
                on ? "bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {/* 오늘 수업 — 시각·인원(반 필터와 같은 반이지만 시각/인원 정보 유지) */}
      {todayClasses.length ? (
        <>
          <span className="bg-line hidden h-5 w-px shrink-0 lg:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro text-text-faint">오늘</span>
            {todayClasses.map((c) => (
              <span
                key={c.id}
                className="border-line inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] whitespace-nowrap"
              >
                <span className="text-primary font-mono text-[10px] font-bold">{c.startTime ?? "—"}</span>
                <span className="text-foreground font-bold">{c.name}</span>
                <span className="text-text-faint">{c.studentCount}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {/* 우측: 마감 통계 + 카드/표 토글 */}
      <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <div className="text-text-dim flex items-center gap-x-2.5 text-[12px]">
          <span>
            학생 <b className="text-foreground tabular">{stats.students}</b>
          </span>
          <span>
            진도 <b className="text-primary tabular">{stats.progressDone}</b>
            <span className="text-text-faint">/{stats.students}</span>
          </span>
          <span>
            테스트 <b className="text-blue tabular">{stats.testDone}</b>
            <span className="text-text-faint">/{stats.students}</span>
          </span>
          <span>
            발송 <b className="text-gold tabular">{stats.reportDone}</b>
            <span className="text-text-faint">/{stats.students}</span>
          </span>
          <span className="border-line rounded-md border px-1.5 py-0.5">
            마감 <b className="text-foreground tabular">{doneCount}</b>
            <span className="text-text-faint">/{total}</span>
          </span>
        </div>
        {makeupAdder}
        {/* AI 멘트 모드(내 계정) — 학원 기본 / 단일 A / 2문단 B. 강사별 저장(users.report_notice_mode). */}
        <div className="border-line flex items-center rounded-full border p-0.5" title="AI 자동작성 멘트 문단 구성(내 계정)">
          {noticeOptions.map((o) => {
            const on = noticeMode === o.value;
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onNoticeMode(o.value)}
                aria-pressed={on}
                className={`rounded-full px-1.5 py-1 text-[11px] font-bold transition ${
                  on ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <span className="bg-line h-5 w-px" aria-hidden />
        {/* 카드 ↔ 표(스프레드시트) ↔ 발송 현황 ↔ 지난 보고서 뷰 전환 */}
        <div className="border-line flex items-center rounded-full border p-0.5">
          {(["card", "grid", "status", "history", "notice"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              aria-pressed={view === v}
              className={`rounded-full px-2 py-1 text-[11px] font-bold transition ${
                view === v ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
              }`}
            >
              {v === "card"
                ? "카드"
                : v === "grid"
                  ? "표"
                  : v === "status"
                    ? "발송 현황"
                    : v === "history"
                      ? "지난 보고서"
                      : "공지"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
