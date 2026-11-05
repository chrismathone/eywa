import { ToolbarSkeletonItem } from "@/components/toolbar";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. 라운드는 따로(실물 칩의 `rounded-full`과 겹치지 않게). */
const PULSE = "bg-bg-soft animate-pulse text-transparent";
const BAR = `${PULSE} rounded`;
/**
 * 범례 항목 — attendance-legend.tsx와 같은 순서·같은 문구(투명 글자로 깔아 **폭**을 맞춘다 — 좁은 창에서 실물과 같은 자리에서 접힌다).
 * 출결 다섯 · 교시마다 다름 · 보강 예약 · 날짜 성격 넷 · 오늘(보고 있는 달이 이번 달인 흔한 경우).
 */
const LEGEND = ["출석", "지각", "조퇴", "보강", "결석", "교시마다 다름", "보강 예약", "등원요일", "주말", "학원 휴일", "미등원", "오늘"];

/**
 * 출석부 스켈레톤(B7) — 강사는 이제 **자기 전체 출석부**로 바로 들어온다(반 N개 매트릭스를 병렬 조회).
 * 그 사이 창(iframe)이 빈 화면이면 고장으로 읽히므로 표 모양을 먼저 흘려보낸다.
 * ⚠️ 트레이드오프: 월 이동·반 전환 같은 searchParam 네비에도 이 스켈레톤이 한 번 스친다(재조회는 실제로 일어난다).
 * 🔴 모양은 **강사 격자**(툴바 한 줄 → 범례 줄 → 표)다 — 주소 값을 못 읽어 역할을 모르므로 느린 쪽에 맞춘다.
 *    관리자의 첫 화면(강사 미선택 허브 카드, attendance-hub.tsx)은 무거운 매트릭스를 안 불러 금방 지나간다.
 */
export default function AttendanceLoading() {
  return (
    // 루트 = page.tsx 루트와 같은 클래스(화면 높이에 맞추고 남는 높이를 표가 가져간다).
    // 전부 장식이라 화면 읽기에서 감춘다(가짜 숫자 글줄 "재원 00명…"을 읽지 않게).
    <div aria-hidden className="attendance-page flex h-full min-h-0 flex-col gap-1">
      {/* 헤더 자리 없음 — 월별 출석부는 PageHeader를 걷어냈다(2026-08-06, page.tsx "상단 공간낭비" 주석). 그리던 막대는 데이터 도착 때 본문을 끌어올렸다.
          요약 카드 4장도 같은 날 걷혔다(→ 툴바 오른쪽 합계 한 줄) — 그리면 표가 그만큼 내려앉았다 올라온다. */}
      {/* 툴바 — 실물이 `<Toolbar>`가 아니라 손으로 쓴 줄(gap-2.5 · compact-chrome 여백 없음)이라 같은 클래스를 그대로 둔다.
          컨트롤 높이는 공용 `ToolbarSkeletonItem`(= `--control-h`). 강사 툴바 = 반 · 월 이동 · 날짜축 · 정렬 · 전체 접기(기본 정렬 = 반별) ·
          검색 · 대상 표기('N개 반') + 오른쪽 합계·안내. */}
      <div className="relative flex shrink-0 flex-wrap items-center gap-2.5 px-1 py-1">
        <ToolbarSkeletonItem className="w-36" />
        <ToolbarSkeletonItem className="w-56" />
        <ToolbarSkeletonItem className="w-28" />
        <ToolbarSkeletonItem className="w-28" />
        <ToolbarSkeletonItem className="w-24" />
        <ToolbarSkeletonItem className="w-16" />
        <span className={`${BAR} truncate text-xs font-medium`}>0개 반</span>
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-3">
          <span className={`${BAR} text-sm`}>재원 00명 · 출석률 00% · 결석 0회 · 지각 0회</span>
          <ToolbarSkeletonItem className="w-14" />
        </div>
      </div>
      {/* 격자 — page.tsx `isolate flex min-h-0 flex-1 flex-col` > columns.tsx 틀(`flex h-full min-h-0 flex-col gap-1`). */}
      <div className="isolate flex min-h-0 flex-1 flex-col">
        <div className="flex h-full min-h-0 flex-col gap-1">
          {/* 표 위 한 줄(columns.tsx) — 왼쪽 = 칸 범위 칩(page.tsx scopeChip) + 범례(attendance-legend.tsx), 오른쪽 = '보기 옵션'.
              래퍼·flex-wrap·gap이 실물과 같아 노트북 폭에선 실물처럼 두 줄로 접힌다. */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
            <span className={`${PULSE} shrink-0 rounded-full border border-transparent px-2.5 py-0.5 text-xs whitespace-nowrap`}>칸 = 이 선생님 교시</span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs [&_*]:whitespace-nowrap">
              {/* 시수 기준 — 수학 반 문장 하나(영어 반은 브릿지·EiE + 인재원 두 문장이라 더 길다). */}
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`${BAR} font-semibold`}>시수 기준</span>
                <span className={BAR}>수학: 1시간 수업 = 0.5, 2시간 수업 = 1, 3시간 수업 = 1.5</span>
              </span>
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`${BAR} micro shrink-0`}>범례</span>
                {LEGEND.map((label) => (
                  <span key={label} className="inline-flex shrink-0 items-center gap-1">
                    <span className="bg-bg-soft size-5 shrink-0 animate-pulse rounded-sm" />
                    <span className={BAR}>{label}</span>
                  </span>
                ))}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* 실물 단추와 같은 테두리·여백·글자 크기라 높이가 같다. */}
              <span className={`${BAR} border border-transparent px-2 py-0.5 text-xs`}>보기 옵션</span>
            </div>
          </div>
          {/* 표 — 남는 높이 전부(`min-h-0 flex-1`), 표면은 matrix-table.tsx DragScrollArea와 같은 `bg-card shadow-card rounded-2xl`. */}
          <div className="min-h-0 flex-1">
            <div className="bg-card shadow-card h-full animate-pulse rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
