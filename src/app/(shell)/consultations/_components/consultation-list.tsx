
import { SheetText } from "@/features/teacher-view/interface-label";
import type { CSSProperties } from "react";
import { AutoPageSize } from "@/components/auto-page-size";
import type { StudentConsultationRow } from "@/features/consultations/server/queries";
import type { ConsultationRating } from "@/features/consultation-rating/rating";
import { ConsultationRow } from "./consultation-row";
import { ROW_GRID } from "./consultation-grid";

/** 행 높이(h-11 44px) + 헤어라인 1px — AutoPageSize가 이 값으로 행 수를 센다. 행 높이를 바꾸면 여기도. */
export const CONSULT_ROW_PX = 45;
/**
 * 한 단의 **최소** 폭(rem) — 목록 폭이 `2 × 이 값 + 단 간격(1rem)` = 79rem(1,264px) 이상이면 2단이 선다
 * (원장 2026-09-30 *"적당한 너비에서 2단, 좁으면 1단"*). 39rem = 아래 열 최소 합(38.75rem)이 들어가는 바닥 — 2026-11-11 열이 늘며(과목·학교학년·상담자를
 * 따로 세움) 35.5rem에서 올렸다(2단 경계 1,152 → 1,264px · 그 사이 폭은 1단). 넓은 창(1,800px)은 2단 그대로다.
 */
const COLUMN_REM = 39;
/** 단 수 상한 — 원장 2026-09-30 *"상담을 2단으로 줄이고"*. 통계 패널이 통계 화면으로 옮겨 간(2026-10-01) 뒤에도 2단이 상한이다(넓은 창은 단이 넓어진다). */
export const CONSULT_MAX_COLS = 2;
/**
 * 열 순서(원장 2026-11-11 *"과목 / 학생 / 학교학년 / 반이름 / 상담자 / 날짜 / 카테고리"* + 상담 평점):
 *   과목 | 학생 | 학교학년 | 반 이름 | 상담자 | (요약 — 넓은 행만) | [날짜 · 카테고리 · 상담 평점]
 * 오른쪽 폭 고정 열의 폭(rem) — 실측(Pretendard): 날짜 "2025/11/10" 약 85 · "11/10 (화)" 약 75(2026-11-11 상대 시각 → 실제 날짜) · 알약 두 글자 44.2 · 제목 '상담 평점' 약 62(칸 64px)
 * (제목 '카테고리' 55px는 칸 52px에서 양옆 1.5px씩 간격에 걸친다). '후속'·'녹음·AI' 열은 같은 날 걷었다(후속 기한 경과 행 배경 신호는 남김).
 * 🔴 바깥 행 그리드의 오른쪽 트랙은 **이 합 + 안쪽 간격**으로 여기서 함께 도출한다 — 둘을 따로 적었다가 안쪽이 12px 넘쳤다
 *    (적대적 리뷰 2026-09-03). 바꿀 땐 여기 하나만. 평점 열은 지점 스위치·권한이 켜졌을 때만 선다(없으면 이 열을 통째로 뺀다).
 */
const RIGHT_TIME_REM = 6.25;
const RIGHT_CAT_REM = 3.25;
const RIGHT_RATING_REM = 4;
const RIGHT_GAP_REM = 0.25; // = gap-1
const widthOf = (cols: readonly number[]) => cols.reduce((a, b) => a + b, 0) + RIGHT_GAP_REM * (cols.length - 1);
const tracksOf = (cols: readonly number[]) => cols.map((r) => `${r}rem`).join(" ");
const rightCols = (ratingOn: boolean) => (ratingOn ? [RIGHT_TIME_REM, RIGHT_CAT_REM, RIGHT_RATING_REM] : [RIGHT_TIME_REM, RIGHT_CAT_REM]);
/**
 * 왼쪽 글 열 — 과목은 두세 글자라 고정 3rem, 나머지는 남는 폭을 비율로 나눠 갖는다(`minmax(최소, Nfr)` — 한 열이 먼저 최대까지 차고
 * 나머지가 굶지 않게). 최소: 학생 이름(24px 굵게) 5.5 · 학교학년('경명여중1') 4 · 반 이름 5.5 · 상담자 3.5rem(최소 폭에서만 말줄임).
 * 행 최소 폭 = 3 + 5.5 + 4 + 5.5 + 3.5 = 21.5 + 오른쪽 14(평점 열 포함) + 간격 0.5×5 + 좌우 여백 0.75 = 38.75rem ≤ 한 단 39rem.
 * 넘치는 값은 말줄임 + 마우스 오버 전문(원장 *"긴 값은 말줄임 허용"*).
 */
const SUBJECT_TRACK = "3rem";
const NAME_MIN = "5.5rem";
const SG_MIN = "4rem";
const CLASS_MIN = "5.5rem";
const WHO_MIN = "3.5rem";
/** 요약 열이 서는 넓은 행(64rem 이상)에선 글 열을 실측 최대 폭에서 멈춘다 — 남는 폭은 요약 몫이다. */
const NAME_WIDE = `minmax(${NAME_MIN},8rem)`;
const SG_WIDE = `minmax(${SG_MIN},6.5rem)`;
const CLASS_WIDE = `minmax(${CLASS_MIN},9.75rem)`;
const WHO_WIDE = `minmax(${WHO_MIN},6.5rem)`;
/**
 * 제목 행을 몇 벌 그려 두나 — 단마다 하나씩 서야 하는데 단 수는 폭이 정한다(CSS 다단, 상한 2). 제목 행은 다단과 **같은 식**으로
 * 단을 세는 격자에 두 벌을 넣고 첫 줄만 보이게 잘라 낸다. `auto-fit`이라 측정 전(첫 페인트)에도 빈 트랙이 접혀 목록과 단 폭이 같다.
 */
const LIST_HEADER_COPIES = CONSULT_MAX_COLS;
const COL_GRID = `repeat(var(--cols, auto-fit), minmax(min(${COLUMN_REM}rem, 100%), 1fr))`;

function rowGridVars(classOn: boolean, ratingOn: boolean): CSSProperties {
  // 반 칸(0318a)이 없으면 그 열을 통째로 뺀다([[#95]] — '—'만 늘어선 열은 "매핑이 고장 났다"로 읽힌다).
  const cls = classOn ? ` minmax(${CLASS_MIN},30fr)` : "";
  const clsWide = classOn ? ` ${CLASS_WIDE}` : "";
  const right = rightCols(ratingOn);
  return {
    "--row": `${SUBJECT_TRACK} minmax(${NAME_MIN},24fr) minmax(${SG_MIN},14fr)${cls} minmax(${WHO_MIN},12fr) ${widthOf(right)}rem`,
    "--row-l": `${SUBJECT_TRACK} ${NAME_WIDE} ${SG_WIDE}${clsWide} ${WHO_WIDE} minmax(0,1fr) ${widthOf(right)}rem`,
    "--right": tracksOf(right),
  } as CSSProperties;
}

/**
 * 원생상담 목록 — 행 = 표처럼 열이 선다(열 순서는 위 주석). 행 사이는 헤어라인(§11 — 카드로 싸지 않는다), 행 전체가 상세 링크(§10 — 행 안 아이콘 버튼 금지).
 * 🔴 **단 수는 폭이 정한다**(CSS 다단, 한 단 최소 39rem · 상한 2단). 🔴 **행 수는 높이가 정한다**(AutoPageSize → ?size=N) —
 *    쪽 크기는 단 수와 무관하게 `한 단 행 수 × 2`라 단 경계를 넘나들어도 쪽이 튀지 않는다(원장 *"페이지당 건수는 단 수와 무관하게 일정"*).
 * `ratings`가 null이면 '상담 평점' 열을 통째로 뺀다(지점 스위치가 꺼졌거나 쓰기 권한이 없다 — 있었는지조차 모르게).
 */
export function ConsultationList({
  items,
  size,
  pageSizeKey,
  classOn,
  ratings,
}: {
  items: StudentConsultationRow[];
  size: number;
  pageSizeKey: string;
  /** 0318a 반 칸이 있나 — 없으면 '반 이름' 열을 뺀다. */
  classOn: boolean;
  /** 이 쪽 상담의 평점(상담 id → 평점) — null이면 평점 열 없음. 평점이 없는 상담은 맵에 없고 '—'로 선다. */
  ratings: ReadonlyMap<string, ConsultationRating> | null;
}) {
  const ratingOn = ratings !== null;
  const vars = rowGridVars(classOn, ratingOn);
  return (
    // AutoPageSize가 루트다 — 제목·테두리 격자와 목록이 같은 `--cols`(채울 수 있는 단 수)를 읽어야 해서 한 상자 안에 둔다.
    <AutoPageSize size={size} rowPx={CONSULT_ROW_PX} storageKey={pageSizeKey} maxCols={CONSULT_MAX_COLS} pageCols={CONSULT_MAX_COLS} className="relative">
      {/* 단마다 테두리 — 다단의 단은 요소가 아니라 테두리를 두를 수 없다. 제목 행과 같은 격자로 **단 크기의 빈 상자**를 뒤에 깔고
          그 위에 제목·목록을 얹는다. 링(shadow-card)은 상자 밖에 그려져 overflow에 잘리므로 여기만 border([[#114]]). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid auto-rows-[100%] gap-x-4 overflow-hidden" style={{ gridTemplateColumns: COL_GRID }}>
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} className="border-line rounded-lg border" />
        ))}
      </div>
      {/* 제목 행 — 아래 행과 같은 열 격자라 글자가 열 위에 정확히 선다. 머리 라벨은 **그 열 본문과 같은 정렬**(표 규약 "제목도 같은 쪽"):
          과목·날짜·카테고리·상담 평점(짧은 값)은 가운데, 글 열(학생·학교학년·반 이름·상담자·요약)은 왼쪽. */}
      <div className="relative grid h-9 auto-rows-[100%] gap-x-4 overflow-hidden phone:hidden" style={{ ...vars, gridTemplateColumns: COL_GRID }} data-list-header="">
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} aria-hidden={i > 0 ? "true" : undefined} className="@container/row">
            <div className={`text-text-dim grid h-full items-center gap-2 px-1.5 text-sm font-bold ${ROW_GRID}`}>
              <span className="truncate text-center"><SheetText value={"과목"} /></span>
              <span className="truncate text-left"><SheetText value={"학생"} /></span>
              <span className="truncate text-left"><SheetText value={"학교학년"} /></span>
              {classOn ? <span className="truncate text-left"><SheetText value={"반 이름"} /></span> : null}
              <span className="truncate text-left"><SheetText value={"상담자"} /></span>
              <span className="hidden text-left @5xl/row:block"><SheetText value={"요약"} /></span>
              <div className="-col-end-1 grid grid-cols-(--right) items-center justify-items-center gap-1 whitespace-nowrap">
                <span><SheetText value={"날짜"} /></span>
                <span><SheetText value={"카테고리"} /></span>
                {ratingOn ? <span><SheetText value={"상담 평점"} /></span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      <ul
        data-autopage-list=""
        className="gap-x-4 [&>li]:break-inside-avoid"
        // 🔴 `column-count`는 변수(상한 2) — 폭이 허락해도 3단이 서지 않는다. `column-fill`도 변수(기본 balance) — 상수 `auto`면
        //    높이가 없는 모든 순간이 1단이 된다(원장 제보 2026-09-09, AutoPageSize 주석).
        style={{
          ...vars,
          columnWidth: `${COLUMN_REM}rem`,
          columnCount: `var(--cols, ${CONSULT_MAX_COLS})`,
          // CSSProperties의 columnFill은 리터럴 유니온이라 변수를 못 받는다 — 값은 유효한 CSS다.
          columnFill: "var(--col-fill, balance)" as React.CSSProperties["columnFill"],
          height: "var(--list-h, auto)",
        }}
      >
        {items.map((c) => (
          <ConsultationRow key={c.id} c={c} classOn={classOn} ratingOn={ratingOn} rating={ratings?.get(c.id) ?? null} />
        ))}
      </ul>
    </AutoPageSize>
  );
}
