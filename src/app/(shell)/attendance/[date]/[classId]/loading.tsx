import { ToolbarSkeletonItem } from "@/components/toolbar";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. 라운드는 따로(실물 단추의 `rounded-lg`와 겹치지 않게). */
const PULSE = "bg-bg-soft animate-pulse text-transparent";
const BAR = `${PULSE} rounded`;
/** 출결 단추 자리 — input-form.tsx 상태 단추와 같은 테두리·여백·글자 크기(아이콘 `size-3` 포함)라 높이가 같다. */
const STATUS_CHIP =
  "bg-bg-soft inline-flex animate-pulse items-center gap-1 rounded-full border border-transparent px-2 py-1 text-xs font-medium text-transparent";

/**
 * 반 하나 출석 입력 스켈레톤 — 자기 것이 없으면 위 날짜 화면(처리 현황·반별 카드)의 스켈레톤을 받는데,
 * 이 화면은 모양이 전혀 다르다(뒤로 링크 + 3줄 머리 + 일괄 바 + 명단 카드). 그래서 따로 둔다.
 * 🔴 PageHeader가 **없는** 화면이다(page.tsx 자체 `<header>`) — PageHeaderSkeleton을 넣으면 데이터 도착 때 머리가 바뀐다.
 * ⚠️ 뒤로 링크(BackLink)는 창(iframe) 안에선 스스로 숨는데 스켈레톤은 그걸 모른다 — 풀셸(링크가 서는 쪽)에 맞춘다.
 */
export default function AttendanceInputLoading() {
  return (
    <div aria-hidden className="w-full min-w-0 space-y-6">
      {/* 뒤로 링크 — BackLink와 같은 `inline-flex text-sm`(아이콘 `size-3.5`) 한 줄. */}
      <span className={`${BAR} inline-flex items-center gap-1.5 text-sm`}>
        <span className="size-3.5" />
        날짜 화면으로
      </span>

      {/* 머리 3줄 — 날짜(eyebrow) · 반 이름(`text-2xl`) · 과목·담임·재원생(`text-sm`), 아래 구분선. */}
      <div className="border-line space-y-1 border-b pb-5">
        <p className="eyebrow">
          <span className={BAR}>날짜 자리</span>
        </p>
        <p className="text-2xl font-bold tracking-tight">
          <span className={BAR}>반 이름 자리</span>
        </p>
        <p className="text-sm">
          <span className={BAR}>과목 · 담임 · 재원생 00명</span>
        </p>
      </div>

      {/* 폼 — input-form.tsx `space-y-4`: 일괄 바 카드 → 명단 카드 → 저장 줄. */}
      <div className="space-y-4">
        <div className="border-line bg-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5">
          <span className={`${BAR} text-xs`}>입력 0 / 00</span>
          <div className="flex items-center gap-1.5">
            <span className={`${PULSE} rounded-lg px-2 py-1 text-xs font-medium`}>전체 출석</span>
            <span className={`${PULSE} rounded-lg px-2 py-1 text-xs`}>전체 초기화</span>
            {/* 보강 추가 단추(makeup-adder.tsx) — 테두리가 있어 이 줄에서 가장 높다. */}
            <span className={`${PULSE} rounded-lg border border-transparent px-2.5 py-1 text-xs font-medium`}>보강 학생 추가</span>
          </div>
        </div>

        <ul className="bg-card border-line divide-border divide-y rounded-2xl border">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-[92px] text-sm font-medium">
                    <span className={BAR}>학생 이름</span>
                  </span>
                  <span className="min-w-[64px] text-xs">
                    <span className={BAR}>학년</span>
                  </span>
                </div>
                <div className="inline-flex flex-wrap items-center justify-end gap-1">
                  {["출석", "결석", "지각", "조퇴", "보강"].map((label) => (
                    <span key={label} className={STATUS_CHIP}>
                      <span className="size-3" />
                      {label}
                    </span>
                  ))}
                  {/* 메모·숙제 펼치기 단추(`size-6`). */}
                  <span className="ml-1 size-6" />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2 border-t pt-5">
          <span className={`${BAR} text-xs`}>변경 사항 없음</span>
          {/* 저장 단추 = 공용 `<Button>` 기본 크기(`--control-h`). */}
          <ToolbarSkeletonItem className="w-16" />
        </div>
      </div>
    </div>
  );
}
