import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { BEFORE_CLASS_ITEMS } from "@/features/before-class/items";
import { SkeletonText } from "@/components/skeleton-text";

const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 미흡 항목 뒤 머리 — 실물(check-table.tsx)과 같은 순서·같은 문구.
const TAIL_HEADS = ["결석", "제외", "카드", "완료율", "판정"];

/**
 * 비포클래스체크리스트 스켈레톤 — 줄 = 실물: 머리 → 보드(board.tsx `space-y-3`) = 툴바(껍데기 없는 `<Toolbar>`) →
 * 날짜·인원 안내 한 줄 → 체크 표(check-table.tsx — 카드 없이 `px-1` 표). 기본 보기 = '체크'.
 * 표 머리 줄 수·행 높이를 실물 셀 클래스로 맞춘다(아래 표 주석).
 */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="비포클래스체크리스트 불러오는 중">
      <PageHeaderSkeleton />
      <div aria-hidden className="space-y-3">
        {/* 툴바 — 반 선택(라벨 + w-64) · 반 관리 · 보기(체크·월별 현황·학생 통계·보고서 시안) · 수업일 이동. */}
        <Toolbar rail={false} className="flex-wrap">
          <ToolbarSkeletonItem className="w-72" />
          <ToolbarSkeletonItem className="w-20" />
          <ToolbarSkeletonItem className="w-76" />
          <ToolbarSkeletonItem className="w-56" />
        </Toolbar>
        <SkeletonText className="px-1 text-sm">00월 00일(목) · 학생 00명 · 보충 필요 0명 · 결석 0명 · 체크한 칸 = 미흡(누르면 바로 저장)</SkeletonText>
        {/* 체크 표(check-table.tsx) — 같은 고정 표·같은 열 폭·같은 칸 상자. 머리는 실물 문구(BEFORE_CLASS_ITEMS.short)를 투명 글자로 깔아
            `text-xs break-keep` 머리가 실물과 같은 폭에서 같은 줄 수로 감긴다(본문 폭 약 1,460px 미만이면 '본교재 풀이' 등이 2줄).
            행 높이 = 체크 칸 상자(`min-h-9`)와 편집 권한의 카드 드롭다운 칸(`py-1` + 컨트롤 높이) 중 큰 쪽 — 실물과 같은 셀로 정해진다. */}
        <div className="overflow-x-auto px-1">
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
            <colgroup>
              <col className="w-44" />
              {BEFORE_CLASS_ITEMS.map((i) => <col key={i.key} />)}
              <col />
              <col />
              <col className="w-32" />
              <col className="w-18" />
              <col className="w-24" />
            </colgroup>
            <thead>
              <tr className="border-line border-b">
                <th className="px-2 py-2 text-left font-semibold"><span className={BAR}>이름</span></th>
                {[...BEFORE_CLASS_ITEMS.map((i) => i.short), ...TAIL_HEADS].map((h) => (
                  <th key={h} className="px-1 py-2 text-center text-xs font-semibold break-keep"><span className={BAR}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
                <tr key={r} className="border-line-faint border-b">
                  <td className="px-2 py-1.5"><span className={BAR}>학생 이름</span></td>
                  {/* 미흡 10칸 + 결석 + 제외 — 실물 CellBox(min-h-9) 안의 체크 상자(size-4). */}
                  {Array.from({ length: BEFORE_CLASS_ITEMS.length + 2 }, (_, c) => (
                    <td key={c} className="p-0 text-center">
                      <div className="flex min-h-9 w-full items-center justify-center px-1">
                        <span className="bg-bg-soft size-4 animate-pulse rounded-xs" />
                      </div>
                    </td>
                  ))}
                  {/* 카드 — 편집 권한(흔한 경로)의 드롭다운 칸. */}
                  <td className="px-2 py-1 text-center">
                    <div className="bg-bg-soft h-(--control-h) w-full animate-pulse rounded-lg" />
                  </td>
                  <td className="px-1 py-1.5 text-center"><span className={BAR}>00%</span></td>
                  <td className="px-1 py-1.5 text-center"><span className={BAR}>판정</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
