import { PageHeaderSkeleton } from "@/components/page-header";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { SHEET_BAR, sheetPill } from "@/features/class-sheets/chrome";
import { SheetBarDivider } from "@/features/class-sheets/components/sheet-chrome";
import { SheetClassPickerSkeleton, SheetFaceSwitchSkeleton } from "@/features/class-sheets/components/sheet-chrome-skeleton";

/**
 * ECS 월간 뷰 스켈레톤(B7) — 달력 보기(month-client.tsx `view === "cal"`) 순서 그대로:
 * 상단 바 → 목표 띠(month-goal-strip) → **월 특이사항 메모**(month-memo, 머리 띠 + 72px 입력칸) → 달력(요일 머리 줄 + 주 행).
 * 실물과 같은 클래스 + 투명 글자로 줄 높이를 잡는다(손 px 금지). 간격은 실물 루트와 같은 gap-2.5.
 * ⚠️ EiE 반의 계획(MP) 보기는 종이 서식 표라 모양이 다르다 — loading.tsx는 보기를 못 읽어 달력 보기에 맞춘다.
 * 달력의 요일 수(주 2~3일)·주 수(4~5주)는 반마다 다르다 — 3일 × 5주로 그린다.
 * 🔴 상단 바는 **실물과 같은 폭의 조각**(반 고르기 세 조각 · 달 이동 · 면 전환 · 작성 수 / 오른쪽 교재 배정 · 과제 · 자리 교시) —
 *    폭이 실물보다 짧으면 실물만 두 줄로 감겨 도착 때 아래가 한 줄 내려앉는다(주간 시트 loading과 같은 이유).
 */
const fill = "bg-bg-soft text-transparent animate-pulse";
const bar = `${fill} rounded`;
const DAYS = 3;
const cols = `44px repeat(${DAYS}, minmax(0, 1fr))`; // month-calendar.tsx `cols`와 같은 꼴

/**
 * 오른쪽 묶음 칩 — 실물 `sheetPill` 상자 + 투명 글자. `on` = 켜진 토글 칩(month-client.tsx `toggleChip`: 11px 체크 아이콘 + gap-1.5) —
 * 달력 보기 기본값은 과제·자리 교시 둘 다 켬(view-prefs.ts `DEFAULT_ECS_MONTH_DISPLAY.cal`)이라 그 폭으로 그린다.
 */
function ChipSkeleton({ label, on = false }: { label: string; on?: boolean }) {
  return (
    <span className={`${sheetPill(false)} inline-flex animate-pulse items-center ${on ? "gap-1.5" : "gap-1"}`}>
      {on ? <span className="block size-[11px]" /> : null}
      <span className="text-transparent">{label}</span>
    </span>
  );
}

export default function EcsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 실물도 머리글을 compact-chrome:hidden 래퍼로 감싼다(창에선 머리 줄 통째 숨김). */}
      <PageHeaderSkeleton hideCompact />
      {/* aria-hidden — 투명 글자(가짜 컨트롤 이름)를 스크린리더가 읽지 않게. 머리글 스켈레톤의 실제 토글 버튼은 이 밖이다. */}
      <div aria-hidden className="flex min-h-0 flex-col gap-2.5">
        {/* 상단 바 — 주간 시트와 같은 `SHEET_BAR`: 반 고르기 · 달 이동 · 면 전환 · 작성 수 / (오른쪽) 배정 · 숙제 · 좌석 */}
        <div className={SHEET_BAR}>
          <SheetClassPickerSkeleton />
          <SheetBarDivider />
          {/* 달 이동 = 실물 labelWidth 116(month-client.tsx) */}
          <PeriodNavSkeleton labelWidth={116} />
          <SheetFaceSwitchSkeleton />
          <SheetBarDivider />
          <span className={`text-xs ${bar}`}>계획 00/00교시 (00%)</span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <ChipSkeleton label="교재 배정" />
            <ChipSkeleton label="과제" on />
            <ChipSkeleton label="자리 교시(JJ)" on />
          </span>
        </div>

        {/* 목표 띠 — 머리(역할 칩) + 영역 칸(sm 2열 · xl 3열). 영역 6개 기준. */}
        <div className="border-line overflow-hidden rounded-xl border">
          <div className="bg-bg-soft flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs font-bold">
            <span className={bar}>담임 월간계획</span>
            <span className={bar}>0000-00</span>
            <span className="flex gap-1">
              <span className={`rounded-full border border-transparent px-2 py-0.5 text-xs font-bold ${fill}`}>담임</span>
              <span className={`rounded-full border border-transparent px-2 py-0.5 text-xs font-bold ${fill}`}>부담임</span>
            </span>
            <span className={`ml-auto text-xs font-semibold ${bar}`}>주간 시트와 같은 칸입니다</span>
            <span className={`rounded-full border border-transparent px-2 py-0.5 text-xs font-bold ${fill}`}>접기</span>
          </div>
          <div className="bg-line-faint grid gap-px sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1 bg-white px-2.5 py-1.5">
                <div className="bg-bg-soft h-5 animate-pulse rounded-md" />
                <p className="pl-[80px] text-xs">
                  <span className={bar}>실제 진도 자리</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 월 특이사항 메모 — 머리 띠 + 입력칸(실물과 같은 textarea라 줄 상자 높이까지 같다). */}
        <div className="border-line overflow-hidden rounded-xl border">
          <div className="bg-bg-soft flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs font-bold">
            <span className={bar}>특이사항</span>
            <span className={bar}>0000년 00월</span>
            <span className={`ml-auto text-xs font-semibold ${bar}`}>이 달 전체에 남는 메모입니다</span>
          </div>
          {/* disabled = 눌러도 초점이 안 들어간다(aria-hidden 칸에 초점이 가면 읽을 수 없는 곳에 커서가 선다). */}
          <textarea
            aria-hidden
            disabled
            tabIndex={-1}
            className="min-h-[72px] w-full resize-none border-0 bg-white px-2.5 py-2 text-sm outline-none"
          />
        </div>

        {/* 달력 — 요일 머리 줄 + 주 행(왼쪽 44px = 주 번호). */}
        <div className="grid gap-1.5">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
            <div />
            {Array.from({ length: DAYS }, (_, i) => (
              <div key={i} className="bg-bg-soft flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold">
                <span className="text-transparent">요일</span>
              </div>
            ))}
          </div>
          {Array.from({ length: 5 }, (_, w) => (
            <div key={w} className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: cols }}>
              <div className="border-line-faint border-r" />
              {Array.from({ length: DAYS }, (_, d) => (
                <div key={d} className="border-line h-24 animate-pulse rounded-lg border bg-white" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
