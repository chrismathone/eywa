import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { TABLE_COL_LINES, TH } from "@/components/super-admin/parts";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";

/**
 * 고객센터 목록 스켈레톤(B7) — 실 배치(page.tsx, `space-y-4`): 헤더 → 면 탭(공지사항 · 개선요청) → 툴바 → 표 카드.
 * 주소(`?tab=`)를 못 읽으니 기본 면(공지사항 — 툴바 = 검색 토글 + 오른쪽 총 건수)으로 그린다. 쪽 이동은 2쪽 이상일 때만 서서 뺐다.
 * 하위 화면(공지 상세 · 개선요청 상세 · 글쓰기)은 헤더 + 카드라 각 폴더의 loading.tsx가 덮는다.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <FaceTabsSkeleton count={2} />
      {/* 툴바 — 검색 토글 · (오른쪽) 총 N건. 줄 여백·레일은 실물 Toolbar 그대로. */}
      <Toolbar>
        <ToolbarSkeletonItem className="w-16" />
        <span className={`${TEXT_BAR} ml-auto text-sm`}>총 00건</span>
      </Toolbar>
      {/* 공지 표 — 실물(SupportNoticeTable)과 같은 카드 · `<table>` · 머리 칸 상수(TH `py-2.5 text-sm` ≈ 44px) · 행(`px-3 py-2.5` + divide-y ≈ 45px).
          칸 글자만 투명 막대라 줄 높이를 실물 칸이 정한다. */}
      <section aria-hidden className="bg-card shadow-card overflow-hidden rounded-2xl">
        <table className={`w-full min-w-[560px] table-fixed text-sm ${TABLE_COL_LINES}`}>
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr>
              {["No", "제목", "등록일"].map((label) => (
                // 정렬은 실물 그대로 — 제목만 왼쪽, No·등록일은 가운데.
                <th key={label} scope="col" className={`${TH} ${label === "제목" ? "text-left" : "text-center"}`}>
                  <span className={TEXT_BAR}>{label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {Array.from({ length: 10 }, (_, i) => (
              <tr key={i}>
                <td className="px-3 py-2.5 text-center">
                  <span className={TEXT_BAR}>00</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={TEXT_BAR}>공지 제목 자리 · 공지 제목 자리</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={TEXT_BAR}>2026-11-05</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
