import { PageHeaderSkeleton } from "@/components/page-header";
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { StatStripSkeleton } from "@/components/atoms/stat-strip";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

// 투명 글자 막대 — 글자 크기·줄 높이를 실물과 같게 잡는다(손 치수 대신).
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 면 탭 이름 — page.tsx의 FACES 6 + 원장 전용 '강사 정산'(회차 정산 모듈이 켜진 지점의 원장 = 흔한 첫 화면). 실물 이름이라 칸 폭이 같다.
const FACE_LABELS = ["수납", "교재", "지출", "수강료 계산기", "회차 확정", "환불 요청서", "강사 정산"] as const;

// 수납관리 초기 로드 스트리밍(B7) — BillingContent가 그 달 청구서 전건·월 목록·학생 옵션·동기화 상태를 await하는 동안
// Next가 이 loading을 즉시 흘려보낸다(예전엔 loading이 없어 창으로 열면 응답까지 흰 화면이었다).
// ⚠️ 실물과 블록 순서·간격을 맞춘다 — 바깥 `space-y-4`(page.tsx) 안에 BillingContent의 `space-y-3`.
//    (면 탭 줄 → 머리 → 월 이동 줄 → 요약 띠 → 진행률 한 줄 → 표). 어긋나면 데이터 도착 순간 화면이 튄다.
// 면(`?tab=`)마다 본문이 다르지만 loading은 주소를 못 읽는다 — 기본 면(수납)에 맞춘다(원장 결정: 공통 골격 타협).
export default function BillingLoading() {
  return (
    <div className="space-y-4 print:space-y-0">
      {/* 면 탭 줄 — 실물과 같은 래퍼·같은 부품 치수. 동기화 배지는 같은 줄 오른쪽 끝(2026-10-15)이라 따로 줄을 그리지 않는다. */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="min-w-0 max-w-full self-start">
          <FaceTabsSkeleton labels={FACE_LABELS} />
        </div>
        <div className="ml-auto flex justify-end">
          <span aria-hidden className={`${TEXT_BAR} inline-flex whitespace-nowrap text-xs`}>동기화 0시간 전 확인</span>
        </div>
      </div>
      <div className="space-y-3">
        {/* 머리 — 실 헤더에 embedLabel·actions가 있어 창(컴팩트)에서도 한 줄이 남는다 → hideCompact 금지.
            동작 = '검색' + '청구서 만들기'. 검색 토글은 툴바에 놓여도 포털로 머리 동작 줄 맨 앞에 선다(HeaderSearchSlot, 10-19). */}
        <PageHeaderSkeleton
          actions={
            <>
              <ToolbarSkeletonItem className="w-14" />
              <ToolbarSkeletonItem className="w-36" />
            </>
          }
        />
        {/* 월 이동 툴바 — 실물(손으로 짠 줄 `gap-2.5 px-1 py-1`)과 같은 래퍼. PeriodNav 한 상자 + 오른쪽 ExcelMenu.
            엑셀은 09-29부터 이 줄이다(머리 아님). 검색은 위 머리로 옮겨 가므로 여기 자리를 두지 않는다.
            엑셀 = 원장(billing full) 실물 '엑셀 내보내기/가져오기 ▾' 버튼 — 공용 Button 기본 크기·여백에 실물 문구를 투명 글자로(폭이 실물과 같다). */}
        <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
          <ToolbarSkeletonItem className="w-60" />
          <div className="ml-auto flex items-center gap-2">
            <span
              aria-hidden
              className={`${CONTROL_H} ${CONTROL_LABEL} bg-bg-soft inline-flex shrink-0 animate-pulse items-center gap-1.5 rounded-lg border border-transparent px-2.5 font-medium whitespace-nowrap text-transparent`}
            >
              엑셀 내보내기/가져오기
              {/* 쉐브론 — Button의 CONTROL_ICON 규칙(크기 클래스 없는 svg = 1em)이라 글자와 같은 18px. */}
              <span className="size-[1em] shrink-0" />
            </span>
          </div>
        </div>
        {/* KPI 5칸 = 요약 띠(09-11 띠 전환) — 떨어진 카드로 그리면 좁은 폭에서 줄 수가 달라진다.
            보조 줄은 실물 칸 순서대로 총 청구액·수납 완료·미수금 셋뿐(할인 합계·수납률은 없음). */}
        <StatStripSkeleton count={5} sub={[true, false, true, true, false]} />
        {/* 수납 진행률 — 카드 없이 띠 아래 한 줄(09-04). */}
        <div aria-hidden className="px-1">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className={`${TEXT_BAR} text-sm font-bold`}>수납 진행률</span>
            <span className={`${TEXT_BAR} num text-sm`}>수납 00% · 부분납부 잔액 0.0% · 미납 0.0%</span>
          </div>
          <div className="bg-bg-soft h-2.5 animate-pulse rounded-pill" />
        </div>
        {/* 표 — 실물 카드(`bg-card shadow-card rounded-2xl`, 헤어라인 링 하나 · border 없음). */}
        <div aria-hidden className="bg-card shadow-card h-[32.5rem] animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
