import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { NAME_FILL_MAX_PX } from "@/features/attendance/seat/name-fit";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. 라운드는 따로(실물 단추의 라운드와 겹치지 않게). */
const PULSE = "bg-bg-soft animate-pulse text-transparent";
const BAR = `${PULSE} rounded`;
/** 반 머리(`bg-bg-soft`) 위 단추 자리 — 같은 색이면 안 보여서 한 단계 진한 `bg-line`. */
const PULSE_ON_SOFT = "bg-line animate-pulse text-transparent";

/**
 * 자리 출석부 스켈레톤(B7) — 이 화면은 자리에서 창(iframe)으로 열려 곧바로 출결을 찍는 자리라,
 * 첫 페인트가 비면 "안 열렸다"로 읽힌다. 교시 칩 줄 + 요약 카드 + 반 카드 모양만 먼저 흘려보낸다.
 * 랩실(SeatAllDay)·JJ실(SeatBoard) 모두 같은 순서다: 칩 줄('전체' + 교시) → 요약 카드 → 반 카드.
 */
export default function SeatAttendanceLoading() {
  return (
    // 루트 = page.tsx 루트와 같은 클래스(화면 높이에 맞추고 반 카드 영역이 안에서 스크롤한다).
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeaderSkeleton
        actions={
          // page.tsx 머리 동작과 같은 묶음 — 출석부로 · 월간 · 랩실|JJ실 전환 · 날짜 이동(PeriodNav `labelWidth=140`).
          <div className="flex flex-wrap items-center gap-1.5">
            <ToolbarSkeletonItem className="mr-1 w-22" />
            <ToolbarSkeletonItem className="mr-1 w-14" />
            <ToolbarSkeletonItem className="mr-1 w-30" />
            <ToolbarSkeletonItem className="w-66" />
          </div>
        }
      />
      {/* 보드(seat-board.tsx 루트) — 남는 높이를 받는다. */}
      <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3">
        {/* 교시 칩 줄 — 실물 `TOOLBAR_CHIP`(`--control-h` · `rounded-lg`). 로그인 화면은 랩실·JJ실 모두 '전체' 칩이 맨 앞에 선다. */}
        <div className="toolbar-rail flex shrink-0 items-center gap-1.5 overflow-x-auto">
          <ToolbarSkeletonItem className="w-24" />
          {Array.from({ length: 5 }, (_, i) => (
            <ToolbarSkeletonItem key={i} className="w-28" />
          ))}
        </div>
        {/* 요약 카드 — 교시(`text-base`) · 체크 수(`text-xs`) + 오늘·미입력이 남은 동안 서는 '남은 N명 출석·결석' 칩 둘. */}
        <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
          <span className={`${BAR} text-base font-bold`}>00:00 · 0개 반 · 00명</span>
          <span className={`${BAR} text-xs`}>체크 00 / 00</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <ToolbarSkeletonItem className="w-28" />
            <ToolbarSkeletonItem className="w-28" />
          </div>
        </div>
        {/* 반 카드 — 랩실 격자(seat-lab-grid.tsx): `rounded-2xl border` · 머리 `px-3 py-1.5 text-sm` + '이 반 출석' 단추(미입력이 남은 흔한 경우) ·
            학생 칸 = 카드 본체(`min-h-[54px] rounded-xl`) + 아래 세 단추 줄(seat-mark-extras.tsx `SeatMarkTriad`, 늘 선다). */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="border-line shrink-0 overflow-hidden rounded-2xl border">
              <div className="border-line bg-bg-soft flex items-center gap-2 border-b px-3 py-1.5 text-sm">
                <span className={`${PULSE_ON_SOFT} rounded font-bold`}>반 이름</span>
                <span className={`${PULSE_ON_SOFT} rounded text-xs`}>00명</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className={`${PULSE_ON_SOFT} rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold`}>이 반 출석</span>
                </span>
              </div>
              <div className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
                {Array.from({ length: 6 }, (__, j) => (
                  <div key={j} className="flex flex-col gap-1">
                    {/* 카드 본체 — 54px은 바닥이고 높이는 내용이 정한다(seat-lab-grid.tsx): 이름(`leading-none`, 글자 = 실물 상한
                        `NAME_FILL_MAX_PX`) · 메타 줄(`text-xs`, 비어도 늘 선다) · 다음 수업/마지막 수업 줄(seat-period-hints.tsx — 서버가 채워 첫 화면에 온다). */}
                    <div className={`${PULSE} @container flex min-h-[54px] w-full flex-col items-start rounded-xl border border-transparent px-2.5 py-2 text-left`}>
                      <span className="w-full truncate pr-3 leading-none font-bold" style={{ fontSize: NAME_FILL_MAX_PX }}>
                        학생 이름
                      </span>
                      <span className="text-xs opacity-80">학교 · 학년</span>
                      <p className="text-xs leading-tight font-semibold break-keep">00:00 강의실 이동</p>
                    </div>
                    <div className="grid w-full grid-cols-3 gap-0.5">
                      {["출석", "결석", "지각"].map((label) => (
                        <span key={label} className={`${PULSE} min-w-0 rounded-md border border-transparent px-0.5 py-1 text-center text-xs font-bold`}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
