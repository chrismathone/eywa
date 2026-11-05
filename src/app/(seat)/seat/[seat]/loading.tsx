import { ToolbarSkeletonItem } from "@/components/toolbar";
import { CONTROL_H } from "@/components/ui/control-scale";
import { NAME_FILL_MAX_PX } from "@/features/attendance/seat/name-fit";

/** 글줄 자리(카드 안) — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. */
const BAR = "bg-bg-soft animate-pulse rounded text-transparent";
/**
 * 바탕 위 글줄 자리 — 이 라우트는 레이아웃 바탕이 `bg-bg-soft`라((seat)/layout.tsx) 같은 색 막대는 안 보인다. 한 단계 진한 `bg-line`.
 * 칩 자리도 같은 까닭으로 `ToolbarSkeletonItem`(바탕 `bg-bg-soft` 고정) 대신 같은 높이 상수(`CONTROL_H`)에 `bg-line`을 쓴다.
 */
const PULSE_ON_SOFT = "bg-line animate-pulse text-transparent";
const BAR_ON_SOFT = `${PULSE_ON_SOFT} rounded`;
const CHIP_ON_SOFT = `bg-line ${CONTROL_H} shrink-0 animate-pulse rounded-lg`;

/**
 * 공개(PIN) 자리 화면 스켈레톤 — 크롬리스 라우트라 셸을 안 거친다.
 * 모양은 **PIN이 통과한 뒤의 보드**(가장 느린 쪽: 하루 명단·교시 선택·다음 행선지 조회) — PIN 폼은 그보다 빨리 선다.
 * ⚠️ '전체' 칩은 랩실에서만 선다(page.tsx `allowAllView`) — 랩실에 맞춘다(JJ실은 칩 하나만큼 줄이 짧을 뿐 높이는 같다).
 */
export default function PublicSeatLoading() {
  // 루트 = page.tsx와 **같은 클래스**(min-h-screen · 여백 · 하단 pb-8 lg:pb-10) — 다르면 스켈레톤에서 본문으로 넘어갈 때 폭·여백이 튄다.
  return (
    <div aria-hidden className="flex min-h-screen flex-col gap-3 px-3 pt-4 pb-8 lg:px-6 lg:pb-10">
      {/* 머리 = `<header>` 한 덩어리 3줄 — 지점 이름(`text-xs`) · 자리 이름(`text-xl`) · '오늘'(`text-sm`). */}
      <header className="shrink-0">
        <p className="text-xs font-medium">
          <span className={BAR_ON_SOFT}>지점 이름 자리</span>
        </p>
        <p className="text-xl font-bold tracking-tight">
          <span className={BAR_ON_SOFT}>자리 이름 000호</span>
        </p>
        <p className="text-sm">
          <span className={BAR_ON_SOFT}>오늘</span>
        </p>
      </header>
      {/* 보드(seat-board.tsx 루트) — 교시 칩 줄 → 요약 카드 → 반 카드. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* 교시 칩 줄 — 실물 칩과 같은 높이(`--control-h`)·라운드(`rounded-lg`), '전체' + 교시. */}
        <div className="toolbar-rail flex shrink-0 items-center gap-1.5 overflow-x-auto">
          <div className={`${CHIP_ON_SOFT} w-24`} />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`${CHIP_ON_SOFT} w-28`} />
          ))}
        </div>
        {/* 요약 카드 — 교시(`text-base`) · 체크 수(`text-xs`) + 미입력이 남은 동안 서는 '남은 N명 출석·결석' 칩 둘. */}
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
                <span className={`${BAR_ON_SOFT} font-bold`}>반 이름</span>
                <span className={`${BAR_ON_SOFT} text-xs`}>00명</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className={`${PULSE_ON_SOFT} rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold`}>이 반 출석</span>
                </span>
              </div>
              <div className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
                {Array.from({ length: 6 }, (__, j) => (
                  <div key={j} className="flex flex-col gap-1">
                    {/* 카드 본체 — 54px은 바닥이고 높이는 내용이 정한다(seat-lab-grid.tsx): 이름(`leading-none`, 글자 = 실물 상한
                        `NAME_FILL_MAX_PX`) · 메타 줄(`text-xs`, 비어도 늘 선다) · 다음 수업/마지막 수업 줄(seat-period-hints.tsx — 서버가 채워 첫 화면에 온다). */}
                    <div className={`${PULSE_ON_SOFT} @container flex min-h-[54px] w-full flex-col items-start rounded-xl border border-transparent px-2.5 py-2 text-left`}>
                      <span className="w-full truncate pr-3 leading-none font-bold" style={{ fontSize: NAME_FILL_MAX_PX }}>
                        학생 이름
                      </span>
                      <span className="text-xs opacity-80">학교 · 학년</span>
                      <p className="text-xs leading-tight font-semibold break-keep">00:00 강의실 이동</p>
                    </div>
                    <div className="grid w-full grid-cols-3 gap-0.5">
                      {["출석", "결석", "지각"].map((label) => (
                        <span key={label} className={`${PULSE_ON_SOFT} min-w-0 rounded-md border border-transparent px-0.5 py-1 text-center text-xs font-bold`}>
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
