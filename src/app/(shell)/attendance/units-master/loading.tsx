import { ToolbarSkeletonItem } from "@/components/toolbar";
// 표 껍데기·머리·행 높이는 실물(sheet.tsx)과 **같은 CSS 모듈**을 쓴다 — 시트가 높이를 바꾸면 스켈레톤도 따라온다.
import styles from "./sheet.module.css";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. */
const BAR = "bg-bg-soft animate-pulse rounded text-transparent";
/** 기본 보기 옵션(학교·학년 · 남은 예정 · 강사별 · JJ·LAB 모두 켬)의 열 폭 — sheet.tsx colgroup과 같은 순서. 강사 열은 2칸으로 둔다. */
const COLS = [136, 104, 88, 104, 80, 96, 168, 104, 104, 72, 72];

/**
 * 시수 마스터 스켈레톤 — 영어 반 확정 시수와 강사·JJ·LAB 출결을 모으는 동안 시트 모양을 먼저 흘려보낸다.
 * 🔴 PageHeader가 **없는** 화면이다(sheet.tsx — 제목은 sr-only h1) — 머리 스켈레톤을 넣으면 그만큼 본문이 튄다.
 * 순서는 sheet.tsx와 같다: 툴바 2줄(`<header>` — 실물이 `<Toolbar>`가 아니라 손으로 쓴 줄이라 같은 클래스) → 표(남는 높이) → 바닥 한 줄.
 */
export default function Loading() {
  return (
    // 루트 = sheet.tsx 루트와 같은 클래스(남는 높이를 표가 가져가고 안에서 스크롤한다).
    <div className="flex h-full min-h-0 flex-col gap-2 pb-2 text-sm">
      <p role="status" className="sr-only">
        영어 반의 확정 시수와 강사·JJ·LAB 출결을 모으고 있습니다…
      </p>
      <div aria-hidden className="flex shrink-0 flex-col gap-2 px-1 py-1">
        {/* 1줄 — 과목 · 영어 유형 · 반 · 월 이동 · 검색 + 오른쪽 단추 넷(집계 기준·내려받기·새로고침·출석부). */}
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-36" />
          <ToolbarSkeletonItem className="w-40" />
          <ToolbarSkeletonItem className="w-56" />
          {/* 검색 상자 = 아이콘 + `w-44` 입력 + 여백. */}
          <ToolbarSkeletonItem className="w-54" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ToolbarSkeletonItem className="w-24" />
            <ToolbarSkeletonItem className="w-28" />
            <ToolbarSkeletonItem className="w-24" />
            <ToolbarSkeletonItem className="w-20" />
          </div>
        </div>
        {/* 2줄 — 상태 필터 칩 7개 + 오른쪽 정렬·보기 옵션·전체 접기. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <ToolbarSkeletonItem key={i} className="w-20" />
          ))}
          <div className="ml-auto flex items-center gap-2">
            <ToolbarSkeletonItem className="w-32" />
            <ToolbarSkeletonItem className="w-28" />
            <ToolbarSkeletonItem className="w-24" />
          </div>
        </div>
      </div>
      {/* 표 — 실물과 같은 `body`(남는 높이) > `scroll`(테두리·라운드·카드 바탕) > `table`(머리 40px · 행 42px). */}
      <div aria-hidden className={styles.body}>
        <div className={styles.scroll}>
          <table className={styles.table} style={{ width: "100%", minWidth: COLS.reduce((a, b) => a + b, 0) }}>
            <colgroup>
              {COLS.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLS.map((_, i) => (
                  <th key={i}>
                    <span className={BAR}>열 이름</span>
                  </th>
                ))}
              </tr>
            </thead>
            {Array.from({ length: 2 }, (_, g) => (
              <tbody key={g}>
                <tr className={styles.group}>
                  <th colSpan={COLS.length}>
                    <div className={styles.groupToggle}>
                      <span className={BAR}>반 이름 · 유형 · 00명</span>
                    </div>
                  </th>
                </tr>
                {Array.from({ length: 6 }, (_, r) => (
                  <tr key={r}>
                    <th className={styles.name}>
                      <span className={BAR}>학생 이름</span>
                    </th>
                    {COLS.slice(1).map((_, c) => (
                      <td key={c}>
                        <span className={BAR}>00U</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      {/* 바닥 한 줄 — 반·줄 수 · 집계 규칙 · 기준 시각(`text-xs`). */}
      <div aria-hidden className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
        <span className={BAR}>00개 반 · 000줄</span>
        <span className={BAR}>실수업 = 모든 강사 + JJ + LAB · 보강 포함</span>
        <span className={`${BAR} ml-auto`}>기준 시각 · 읽기 전용</span>
      </div>
    </div>
  );
}
