/**
 * 오늘 등하원 스켈레톤 — 편성·기록·결석 신호를 함께 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7).
 * 📱 셔틀 선생님은 폰(느린 회선)에서 열기 때문에 여기서 빈 화면이 특히 길게 느껴진다.
 * 모양 = 실 배치(day-board-client, 10-21 드롭다운 제거 뒤): ① 툴바 줄(면 탭 · 날짜 이동 · 시즌) ② 호차 토글 칩 + 학생 찾기
 * (폰·터치 자리 — 마우스 넓은 화면에선 ③으로 옮겨 간다) ③ 요약 레일 + '오늘만 승하차' → 호차 열(넓으면 26rem 고정 폭으로 옆으로).
 * 기본 경로 = 호차 둘 이상 · 전체 보기 · 쓰기 권한. ⚠️ 줄 높이는 컨트롤 변수(폰 44 / 데스크톱 --control-h) — 낮게 두면 로드 순간 줄이 뛴다.
 */
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SHUTTLE_CHIP, SHUTTLE_INPUT, SHUTTLE_ROW, SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다(text-base = 18px × 1.5). */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 칩 자리 — 실물 호차 칩(`SHUTTLE_CHIP px-4`)에 막대 색만. */
const CHIP = `${SHUTTLE_CHIP} bg-bg-soft animate-pulse px-4`;
/** 면 탭 칸 — 관리자 전용 셋(탑승 학생 시간표 · 실시간 위치 · 가까운 노선 찾기)을 뺀 기본 다섯(faces.ts). */
const FACES = 5;
const VEHICLES = 3;

/** 학생 찾기 칸 — 실물 RideJump 껍데기(`relative w-full sm:w-80`) + 입력(`SHUTTLE_INPUT w-full`). */
function RideJumpSkeleton() {
  return (
    <div className="relative w-full sm:w-80">
      <div className={`${SHUTTLE_INPUT} bg-bg-soft w-full animate-pulse`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className="flex min-h-0 flex-col gap-3">
        {/* ① 툴바 줄 — 면 탭(lg 미만은 한 줄 다) + 날짜 이동(PeriodNav) + 시즌 드롭다운. */}
        <div className={SHUTTLE_TOOLBAR}>
          <span className="min-w-0 flex-1 basis-full lg:basis-auto">
            <FaceTabsSkeleton count={FACES} />
          </span>
          <ToolbarSkeletonItem className="w-64" />
          <ToolbarSkeletonItem className="w-32" />
        </div>
        {/* ② 호차 토글(전체 + 호차마다) + 학생 찾기 — 폰에선 찾기가 따로 한 줄(h-11), 마우스 넓은 화면에선 ③으로 간다. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: VEHICLES + 1 }, (_, i) => (
              <span key={i} className={`${CHIP} w-20`} />
            ))}
          </div>
          <div className="sm:ml-auto lg:pointer-fine:hidden">
            <RideJumpSkeleton />
          </div>
        </div>
        {/* ③ 요약 레일 — 전체 예정 · 미기록 · 탑승 · 미탑승 · (마우스 넓은 화면) 학생 찾기 · 오늘만 승하차(오른쪽 끝). */}
        <div className={`${SHUTTLE_TOOLBAR} text-sm`}>
          {["전체 예정 00명", "미기록 0", "탑승 0", "미탑승 0"].map((t) => (
            <SkeletonText key={t} as="span" className="whitespace-nowrap">
              {t}
            </SkeletonText>
          ))}
          <div className="hidden lg:pointer-fine:block">
            <RideJumpSkeleton />
          </div>
          <ToolbarSkeletonItem className="ml-auto w-28" />
        </div>
        {/* 호차 열 — 판이 좁으면 한 열을 꽉 채우고, 넓으면(@xl/board) 26rem 고정 폭으로 옆으로 이어 선다(전체 보기). */}
        <div className="@container/board">
          <div className="@xl/board:overflow-x-auto @xl/board:pb-2">
            <div className="grid grid-cols-1 items-start gap-4 @xl/board:grid-flow-col @xl/board:auto-cols-[26rem] @xl/board:grid-cols-none">
              {Array.from({ length: VEHICLES }, (_, i) => (
                <section key={i} className="flex min-w-0 flex-col gap-2">
                  {/* 호차 머리 — 실물 VehicleHeader(`border-b py-1.5` + text-base 제목 한 줄). */}
                  <div className="border-line flex items-center gap-2 border-b py-1.5">
                    <span className={`${TEXT_BAR} text-base font-bold`}>1호차</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {[0, 1].map((j) => (
                      // 회차 패널 — 실물 RunPanel 표면(`rounded-2xl bg-card`) · 머리(`px-3 py-2` + 접기 줄 SHUTTLE_ROW) · 학생 줄.
                      <div key={j} className="bg-card flex flex-col rounded-2xl shadow-[var(--shadow-card)]">
                        <div className="flex items-center gap-1.5 px-3 py-2">
                          <div className={`${SHUTTLE_ROW} flex flex-1 items-center`}>
                            <SkeletonLine className="w-40 text-base font-bold" />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 px-2.5 pb-2.5">
                          {[0, 1, 2].map((k) => (
                            <div key={k} className={`${SHUTTLE_ROW} bg-bg-soft animate-pulse rounded-lg`} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
