import { PageHeaderSkeleton } from "@/components/page-header";
import { PageMaximizeToolbar } from "@/components/page-maximize/page-maximize-toolbar";
import { Toolbar, ToolbarRow, ToolbarSkeletonItem } from "@/components/toolbar";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";
import { ExitOverlayHint } from "./_components/exit-overlay/exit-overlay-hint";

// 시간표 초기 로드 스트리밍 — 무거운 getWeeklyScheduleWithStudents(전 슬롯·학생·교재·진도)가 도는
// 동안 Next가 이 loading을 Suspense fallback으로 즉시 스트리밍한다(특히 창=iframe으로 열 때 첫 페인트가
// 빈 화면이 아니라 스켈레톤). 툴바가 데이터(과목칩·인원)에 의존해 부분 페인트가 안 되므로 셸 전체 스켈레톤.
// `.edge-to-edge` = page.tsx 루트와 같은 마커(창에서 좌우·아래 베젤 0) — 스켈레톤이 본문과 같은 폭으로 서야 데이터
// 도착 때 안 튄다. 두 루트의 className은 가드(window-bezel.test)가 같게 잠근다.
// 🔴 최대화 표식도 실물과 같게(10/02~): 루트 `data-maximize-toolbar-page` · 제목 줄 `data-maximize-title-row` ·
//    툴바를 `PageMaximizeToolbar`로 감싼다 — 빠지면 최대화 중 스켈레톤엔 제목 줄이 남아 툴바가 약 60px 튄다.
// 원장·영어·통합뷰(가장 흔한 경로) 기준 — 머리 동작 = ECS 바로가기 · 왼쪽 묶음에 '그룹 설정' 칩(학원설정 쓰기 권한) ·
// 오른쪽 묶음 = 시간표 편집기·메모 시트(다른 과목엔 없다) · 맨 아래 'X를 누르면…' 안내 줄(퇴원 열람 권한 — 강사 화면엔 없다).
export default function TimetableLoading() {
  return (
    <div data-maximize-toolbar-page="" className="edge-to-edge flex h-full min-h-0 flex-col gap-4 compact-chrome:gap-3">
      {/* 창(임베드)은 헤더 줄을 통째로 접는다(실물도 같은 래퍼) · 최대화 중엔 globals.css가 이 줄을 숨긴다. */}
      <div data-maximize-title-row="" className="shrink-0 compact-chrome:hidden">
        <PageHeaderSkeleton hideCompact actions={<ToolbarSkeletonItem className="w-28" />} />
      </div>
      {/* 툴바 스켈레톤 — 실물과 같은 줄 래퍼(주 이동 레일 · 왼쪽 묶음 / 오른쪽 묶음). 창을 줄이면 **묶음 단위로**
          줄이 바뀌므로 같은 `toolbar-group`·`rail-spacer`를 써야 데이터 도착 때 안 튄다.
          왼쪽 = 과목·구분·프로그램·뷰 드롭다운 · 검색 | 그룹 설정 | 뷰 설정 | 엑셀(구분선 셋 = 실물과 같은 `bg-line h-4 w-px`) /
          오른쪽 = (창에서만) ECS · 편집기 · 메모 시트.
          (옛 오른쪽 집계 글자는 09-28 실물에서 삭제 — 그리지 않는다.) */}
      <PageMaximizeToolbar>
        <Toolbar rail={false} gap="gap-3 compact-chrome:gap-1">
          <ToolbarRow>
            <ToolbarSkeletonItem className="w-72 compact-chrome:w-56" />
          </ToolbarRow>
          <ToolbarRow>
            <div className="toolbar-group flex min-w-0 flex-wrap items-center gap-3">
              <ToolbarSkeletonItem className="w-28" />
              <ToolbarSkeletonItem className="w-24" />
              <ToolbarSkeletonItem className="w-28" />
              <ToolbarSkeletonItem className="w-20" />
              <ToolbarSkeletonItem className="w-16" />
              <span className="bg-line h-4 w-px" aria-hidden />
              {/* '그룹 설정' 칩 — 실물과 같은 칩 상자(TOOLBAR_CHIP) + 11px 아이콘 자리 + 투명 글자 */}
              <span aria-hidden className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} animate-pulse gap-1.5`}>
                <span className="block size-[11px]" />
                <span className="text-transparent">그룹 설정</span>
              </span>
              <span className="bg-line h-4 w-px" aria-hidden />
              <ToolbarSkeletonItem className="w-20" />
              <span className="bg-line h-4 w-px" aria-hidden />
              <ToolbarSkeletonItem className="w-20" />
            </div>
            <div className="rail-spacer ml-auto" aria-hidden />
            <div className="toolbar-group flex flex-wrap items-center gap-3">
              {/* 창에선 머리 줄이 접혀 ECS 바로가기가 여기로 온다(실물과 같은 조건). */}
              <div className="hidden compact-chrome:block">
                <ToolbarSkeletonItem className="w-28" />
              </div>
              <ToolbarSkeletonItem className="w-24" />
              <ToolbarSkeletonItem className="w-20" />
            </div>
          </ToolbarRow>
        </Toolbar>
      </PageMaximizeToolbar>
      {/* 그리드 스켈레톤 — 실제 그리드 카드와 같은 라운드로 전환 시 형태가 안 바뀌게 */}
      <div className="bg-card border-line shadow-card min-h-0 flex-1 animate-pulse rounded-2xl border" />
      {/* 맨 아래 안내 줄 — 실물 부품 그대로(정적 글). 표식 `.timetable-footnote`가 셸 아래 여백을 0으로 바꿔 그 줄이 여백 자리가 된다. */}
      <ExitOverlayHint />
    </div>
  );
}
