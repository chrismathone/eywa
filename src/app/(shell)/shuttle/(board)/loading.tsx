/**
 * 셔틀 편성 스켈레톤 — 보드 조회가 차량·정류장·회차·노선·배정·학생을 여러 왕복으로 모으므로
 * 첫 페인트를 막지 않게 즉시 흘려보낸다(B7). 창(iframe)으로 열면 빈 화면이 특히 길게 보인다.
 * 모양 = 실 배치(shuttle-board-client): 헤더(인쇄 · 정류장 관리) → 툴바 줄(면 탭 · 시즌 · 엑셀) → 📱 보기 전환 탭(lg 미만) → 3열.
 * 📱 lg 미만은 한 면씩 — 실물 첫 면이 '노선'(`useState<PaneKey>("route")`)이라 가운데 열만 보이고 회차·학생 열은 `lg`부터 선다.
 * 🔑 `(board)` 묶음 안에 둔다 — `shuttle/` 바로 아래면 하위 면(학부모 등하원 등) 전부를 감싸, 이 3열 뼈대가
 *    먼저 뜨고 그 면 스켈레톤으로 다시 바뀌어 "두 번 로딩"처럼 보였다(사용자 2026-10-16).
 */
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SHUTTLE_ACTION, SHUTTLE_PHONE_CONTROLS, SHUTTLE_ROW, SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

/** 글자 막대 — 실물 문구를 투명하게 깔아 줄 높이·감김(폰 줄 수)을 실물 글자가 정하게 한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 실물 카드 표면(회차 열 차량 카드 · 정류장 카드 · 학생 풀). */
const CARD = "bg-card rounded-2xl shadow-[var(--shadow-card)]";
/** 면 탭 칸 — 관리자 전용 셋(탑승 학생 시간표 · 실시간 위치 · 가까운 노선 찾기)을 뺀 기본 다섯(faces.ts). */
const FACES = 5;

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <PageHeaderSkeleton
        actions={
          // 실물 actions 래퍼 그대로 — 폰에선 머리 버튼도 44px(SHUTTLE_PHONE_CONTROLS). 인쇄는 거친 포인터에서 숨는다.
          <span className={`flex items-center gap-2 ${SHUTTLE_PHONE_CONTROLS}`}>
            <span className="no-mouse:hidden">
              <ToolbarSkeletonItem className="w-16" />
            </span>
            <ToolbarSkeletonItem className="w-28" />
          </span>
        }
      />
      {/* 툴바 줄 — 면 탭(폰에선 한 줄 다, `basis-full sm:basis-auto`) + 시즌 드롭다운 + 엑셀(쓰기 권한 · 손 기기에선 숨김). */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabsSkeleton count={FACES} />
        </span>
        <ToolbarSkeletonItem className="w-32" />
        <span className="no-mouse:hidden">
          <ToolbarSkeletonItem className="w-20" />
        </span>
      </div>
      {/* 📱 보기 전환 탭(회차 · 노선 · 학생) — 실물 nav 클래스 그대로, lg부터 사라진다. */}
      <div aria-hidden className="border-line flex gap-1 border-b lg:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="-mb-px flex min-h-11 items-center border-b-2 border-transparent px-3">
            <SkeletonLine className="w-8 text-sm font-bold" />
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(190px,15rem)_minmax(0,1fr)_minmax(200px,17rem)]">
        {/* 회차 열 — 차량 카드(이름 줄 text-sm · 회차 줄 = 방향 알약 + 제목 / 시간·인원 두 줄 · '+ 등원/하원 회차' 버튼 줄(쓰기 권한)). */}
        <div className="hidden lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:px-1 lg:py-0.5">
          {[0, 1].map((i) => (
            <section key={i} className={`${CARD} p-3`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className={`${TEXT_BAR} text-sm font-bold`}>1호차</span>
              </div>
              <div className="flex flex-col gap-1">
                {[0, 1, 2].map((j) => (
                  <div key={j} className={`${SHUTTLE_ROW} bg-bg-soft flex animate-pulse flex-col justify-center gap-0.5 rounded-xl px-2.5 py-2`}>
                    <span className="flex items-center gap-1.5">
                      {/* 방향 알약(Pill sm — `px-2.5 py-[3px] text-xs`) */}
                      <span className="rounded-pill inline-flex px-2.5 py-0.75 text-xs font-bold text-transparent">등원</span>
                      <span className="text-sm font-bold text-transparent">1회차</span>
                    </span>
                    <span className="text-xs text-transparent">00:00~00:00 · 0명</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                {[0, 1].map((j) => (
                  <span key={j} className={`${SHUTTLE_ACTION} bg-bg-soft w-24 animate-pulse rounded-lg`} />
                ))}
              </div>
            </section>
          ))}
        </div>
        {/* 노선 열 — 회차 제목(text-base) + '+ 정류장' 줄 → 안내 문장(쓰기 권한, 폰 2~3줄) → 정류장 카드들. */}
        <div className="flex min-h-0 flex-col gap-2 px-1 py-0.5">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className={`${TEXT_BAR} text-base font-bold`}>등원 1회차 · 1호차</span>
            <div className={`${SHUTTLE_ACTION} bg-bg-soft w-24 animate-pulse rounded-lg`} />
          </div>
          <p className="text-text-faint px-1 text-xs">
            <span className={TEXT_BAR}>
              학생을 끌어다 놓으면 <b className="font-bold">평일</b>로 들어갑니다 — 칩의 요일 글자를 누르면 요일을 바꿉니다.
            </span>
          </p>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`${CARD} p-2.5`}>
              <div className="flex items-center gap-2">
                <div className="size-11 shrink-0 sm:size-(--control-h)" />
                <SkeletonLine className="w-32 text-sm font-bold" />
              </div>
            </div>
          ))}
        </div>
        {/* 학생 풀 — 열 높이를 채우는 카드(실물 flex-1). */}
        <div className="hidden lg:flex lg:min-h-0 lg:flex-col">
          <div className={`${CARD} flex min-h-0 flex-1 flex-col gap-2 p-2.5`}>
            <SkeletonLine className="w-12 text-sm font-bold" />
            <div className="bg-bg-soft h-11 animate-pulse rounded-lg sm:h-(--control-h)" />
          </div>
        </div>
      </div>
      {/* 고른 회차 요약(text-xs) — 실물 보드 맨 아래 문단. */}
      <p className="text-xs">
        <span className={TEXT_BAR}>등원 1회차 — 정류장 0곳 · 배정 0명</span>
      </p>
    </div>
  );
}
