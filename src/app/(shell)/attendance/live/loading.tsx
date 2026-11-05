import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. 라운드는 따로(실물 칩의 `rounded-lg`와 겹치지 않게). */
const PULSE = "bg-bg-soft animate-pulse text-transparent";
const BAR = `${PULSE} rounded`;

/**
 * 오늘 출결 스켈레톤 — 창(iframe)으로 열 때 빈 화면을 보이지 않게(B7).
 * 실제 표면과 같은 라운드(2xl)·간격이라 로드 후 레이아웃이 튀지 않는다.
 * 🔴 모양은 **사무실(full) · 오늘 · 좌석표 면**이다 — 이 화면을 열어 두는 사람이 데스크이고, 확인 큐까지 함께 불러 가장 느리다.
 *    강사(scoped)는 머리 동작('결석 통보 접수')과 면 탭 줄이 없다(그만큼 짧아진다 — 주소·권한을 못 읽는 스켈레톤의 한계).
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      {/* 머리 동작 = '결석 통보 접수' 단추 하나(absence-intake-button.tsx — `--control-h`). */}
      <PageHeaderSkeleton actions={<ToolbarSkeletonItem className="w-28" />} />

      {/* 면 탭 줄(좌석표 · 확인 필요 · 어제 출결) — 실물이 공용 FaceTabs가 아니라 page.tsx의 밑줄 링크(`py-2 text-sm` + `border-b-2`)라
          같은 클래스를 그대로 둔다(FaceTabsSkeleton은 `--control-h` 밑줄이라 높이가 다르다). */}
      <div aria-hidden className="border-line flex gap-1 border-b">
        {["좌석표", "확인 필요", "어제 출결"].map((label) => (
          <span key={label} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-semibold whitespace-nowrap">
            <span className={BAR}>{label}</span>
          </span>
        ))}
      </div>

      {/* 좌석표(seating-chart.tsx `space-y-6`) — 요약·검색·과목·범례 줄 → 시간 띠. */}
      <div aria-hidden className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-bold">
            <span className={BAR}>미출결 0 · 결석 0 · 입력 00/00 · 지금 수업 중 0개 반</span>
          </p>
          {/* 학생 검색 토글 · 과목 드롭다운 — 둘 다 `--control-h`. */}
          <ToolbarSkeletonItem className="w-16" />
          <ToolbarSkeletonItem className="w-28" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {["출석", "지각", "조퇴", "보강", "결석", "미입력", "대기"].map((label) => (
              <span key={label} className={`${PULSE} rounded-lg px-2 py-0.5 text-xs font-bold`}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* 펼친 시간 띠(지금 수업 중) — `rounded-2xl border` · 머리 `px-3 py-2`(`text-base`) · 본문 `px-3 pt-1 pb-3`. */}
        <div className="border-line rounded-2xl border">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
            <span className={`${BAR} text-base font-bold`}>지금 수업 중</span>
            <span className={`${BAR} text-sm`}>0개 반</span>
          </div>
          <div className="px-3 pt-1 pb-3">
            {/* 층 — 제목 `text-xl` → 방마다 제목 `text-base` + 4열 반 카드. */}
            <div className="space-y-4">
              <p className="text-xl font-bold">
                <span className={BAR}>층 이름</span>
              </p>
              <div className="space-y-4">
                {Array.from({ length: 2 }, (_, room) => (
                  <div key={room} className="space-y-2">
                    <p className="text-base font-bold">
                      <span className={BAR}>강의실 이름</span>
                    </p>
                    <div className="grid grid-cols-4 items-start gap-3">
                      {Array.from({ length: 4 }, (_, card) => (
                        <SeatingCardSkeleton key={card} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 접힌 시간 띠(지난 수업) — 머리 줄만. */}
        <div className="border-line rounded-2xl border">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
            <span className={`${BAR} text-base font-bold`}>지난 수업</span>
            <span className={`${BAR} text-sm`}>0개 반</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 반 카드 한 장(seating-room.tsx) — 머리(반 이름 + 시각·담임, `text-sm`) + 학생 3열 칸(`min-h-9`). */
function SeatingCardSkeleton() {
  return (
    <div className="bg-card shadow-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
      <div className="px-2 py-2 text-center text-sm font-bold">
        <p>
          <span className={BAR}>반 이름</span>
        </p>
        <p className="mt-0.5">
          <span className={BAR}>00:00~00:00 · 담임</span>
        </p>
      </div>
      <div className="bg-bg-soft px-2 py-2">
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-card min-h-9 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
