import { PageHeaderSkeleton } from "@/components/page-header";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { SHEET_BAR, SHEET_SEG_BOX, sheetPill, sheetSegItem } from "@/features/class-sheets/chrome";
import { SheetBarDivider } from "@/features/class-sheets/components/sheet-chrome";
import { SheetClassPickerSkeleton, SheetFaceSwitchSkeleton } from "@/features/class-sheets/components/sheet-chrome-skeleton";
import { SHEET_DAY_MAX_W, sheetPlanWidth } from "@/features/class-sheets/lib/today-columns";
import { SHEET_TEXTAREA } from "@/features/class-sheets/ui-box";
import { WEEK_LABEL_W } from "@/features/timetable/lib/week";

/**
 * ECS 주간 시트 스켈레톤(B7) — 실물(page.tsx → sheet-client.tsx → sheet-toolbar.tsx · plan-panel.tsx · sheet-grid.tsx)과 같은 클래스·상수로 그린다.
 * - 상단 바 = 실물과 같은 `SHEET_BAR` + **실물과 같은 폭의 조각들**(반 고르기 세 조각 · 주 이동 · 면 전환 · 요일 / 오른쪽 출석부 · JJ · 글씨 ·
 *   저장됨 · 계획 패널). 🔴 폭이 실물보다 짧으면 실물만 두 줄로 감겨(실물 줄 ≈ 1,900px) 도착 때 격자가 한 줄(약 37px) 내려앉는다 —
 *   그래서 막대 폭을 손으로 적지 않고 실물 상자 클래스에 실물 문구를 투명 글자로 깐다(같은 flex-wrap에서 같은 폭에 감긴다).
 * - 본문 = 계획 패널(300px, 내용 높이) | 요일 격자. 🔴 폰(`phone:`)은 실물처럼 **패널이 위**로 쌓인다(`phone:flex-col`).
 * - 요일 격자 = 실물과 같은 `1fr` 열(최소 `sheetPlanWidth` · 최대 SHEET_DAY_MAX_W, 열 사이 gap-x-3) + 머리 띠(요일 칩 size-7 + py-2 = 44px).
 * loading.tsx는 화면 언어를 못 읽어 한국어 폭(`sheetPlanWidth()` = 420 · 영어 480)·한국어 문구로 그린다.
 * 요일 수는 반마다 다르다(주 2~3일이 흔하다) — 3일로, 면 전환은 인재원 영어 3칸(주간·달력·진도표 — EiE는 2칸)으로 그린다.
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
const DAYS = 3;
const GAP_X = 12; // sheet-grid.tsx GAP_X(= gap-x-3)와 같은 값 — 최소·최대 폭 계산용.
const gaps = (DAYS - 1) * GAP_X;

/** 실물 HrefSelect 트리거(`TOOLBAR_SELECT` + 16px 쉐브론) — `축: 값` 문구를 투명 글자로. */
function SelectSkeleton({ label }: { label: string }) {
  return (
    <span className={`${TOOLBAR_SELECT} shrink-0 animate-pulse gap-2`}>
      <span className="text-transparent">{label}</span>
      <span className="block size-4 shrink-0" />
    </span>
  );
}

/** JJ 표시/숨김 묶음 — 실물 `SHEET_SEG_BOX` + `sheetSegItem`, 칸 글자는 투명. */
function SegSkeleton({ items }: { items: readonly string[] }) {
  return (
    <span className={`${SHEET_SEG_BOX} shrink-0 animate-pulse`}>
      {items.map((i) => (
        <span key={i} className={sheetSegItem(false)}>
          <span className="text-transparent">{i}</span>
        </span>
      ))}
    </span>
  );
}

export default function EcsSheetLoading() {
  const planW = sheetPlanWidth();
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 실물도 머리글을 compact-chrome:hidden 래퍼로 감싼다(창에선 머리 줄 통째 숨김). */}
      <PageHeaderSkeleton hideCompact />
      {/* aria-hidden — 투명 글자(가짜 컨트롤 이름·'저장됨')를 스크린리더가 읽지 않게. 머리글 스켈레톤의 실제 토글 버튼은 이 밖이다. */}
      <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3">
        {/* 상단 바(sheet-toolbar.tsx) — 반 고르기 · 주 이동 · 면 전환 · 요일 / (오른쪽 묶음) 출석부 · JJ 표시/숨김 · 글씨 · 저장됨 · 계획 패널 */}
        <div className={SHEET_BAR}>
          <SheetClassPickerSkeleton />
          <SheetBarDivider />
          <PeriodNavSkeleton labelWidth={WEEK_LABEL_W} />
          <SheetFaceSwitchSkeleton />
          <SheetBarDivider />
          <SelectSkeleton label="요일: 전체" />
          <span className="ml-auto flex items-center gap-2 phone:flex-wrap">
            <span className={`${sheetPill(false)} inline-flex animate-pulse items-center gap-1`}>
              <span className="block size-3" />
              <span className="text-transparent"> 출석부</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="shrink-0 text-xs font-bold"><span className={bar}>JJ</span></span>
              <SegSkeleton items={["표시", "숨김"]} />
            </span>
            <SelectSkeleton label="글씨: 작음" />
            <span className="text-sm font-semibold whitespace-nowrap"><span className={bar}>저장됨</span></span>
            <span className={`${sheetPill(false)} animate-pulse`}><span className="text-transparent">계획 패널</span></span>
          </span>
        </div>
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-hidden phone:flex-col">
          {/* 계획 패널 — 실물 aside와 같은 껍데기(self-start = 내용 높이 · 폰은 폭 전부 + 35vh 캡). 첫 섹션만 펼침(열 머리 줄 + 영역 줄). */}
          <div className="bg-card shadow-card w-[300px] shrink-0 self-start overflow-hidden rounded-2xl p-2.5 phone:max-h-[35vh] phone:w-full">
            <div className="space-y-1">
              {[0, 1, 2, 3].map((s) => (
                <div key={s}>
                  <div className="flex items-center gap-1.5 px-1 py-1 text-sm">
                    <span className={bar}>섹션 제목 자리</span>
                  </div>
                  {s === 0 ? (
                    <div className="space-y-1 px-1 pt-1 pb-2">
                      {/* 열 머리 줄 '교재명 / 목표 진도'(plan-panel.tsx — bg-soft py-0.5 text-xs) */}
                      <div className="bg-bg-soft animate-pulse rounded-md py-0.5 text-xs font-bold">
                        <span className="text-transparent">교재명 목표 진도</span>
                      </div>
                      {[0, 1, 2, 3, 4, 5].map((r) => (
                        <div key={r} className="bg-bg-soft h-6 animate-pulse rounded-md" />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {/* 메모 — '주간 메모' 라벨 줄 + 실물과 같은 textarea(인라인 상자라 줄 상자 높이까지 같다). */}
            <div className="border-line-strong mt-1.5 border-t pt-1.5">
              <span className="text-xs font-bold"><span className={bar}>주간 메모</span></span>
              <textarea aria-hidden disabled tabIndex={-1} className={`${SHEET_TEXTAREA} mt-1 min-h-[56px] resize-none`} />
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden phone:flex-none">
            <div className="w-full pb-2" style={{ minWidth: DAYS * planW + gaps, maxWidth: DAYS * SHEET_DAY_MAX_W + gaps }}>
              <div className="grid grid-cols-3 gap-x-3 pb-2">
                {Array.from({ length: DAYS }, (_, i) => (
                  <div key={i} className="bg-card shadow-card flex items-center gap-2 rounded-2xl px-3 py-2">
                    <span className="bg-bg-soft size-7 animate-pulse rounded-lg" />
                    <span className={`text-sm ${bar}`}>00/00</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                {Array.from({ length: DAYS * 2 }, (_, i) => (
                  <div key={i} className={`bg-card shadow-card animate-pulse rounded-2xl ${i < DAYS ? "h-[220px]" : "h-[180px]"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
