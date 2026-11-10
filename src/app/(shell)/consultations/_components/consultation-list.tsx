
import { SheetClassName, SheetText } from "@/features/teacher-view/interface-label";
import type { CSSProperties } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Pill } from "@/components/atoms/pill";
import { AutoPageSize } from "@/components/auto-page-size";
import { consultationPreview } from "@/features/consultations/summary-preview";
import type { StudentConsultationRow } from "@/features/consultations/server/queries";
import type { ConsultationRating } from "@/features/consultation-rating/rating";
import { relativeTimeKo } from "@/lib/relative-time";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import { CATEGORY_META, URGENCY_META } from "./consultation-meta";
import { ConsultationRatingCell } from "./consultation-rating-cell";

/** 행 높이(h-11 44px) + 헤어라인 1px — AutoPageSize가 이 값으로 행 수를 센다. 행 높이를 바꾸면 여기도. */
export const CONSULT_ROW_PX = 45;
/**
 * 한 단의 **최소** 폭(rem) — 목록 폭이 `2 × 이 값 + 단 간격(1rem)` = 72rem(1,152px) 이상이면 2단이 선다
 * (원장 2026-09-30 *"적당한 너비에서 2단, 좁으면 1단"*). 통계 패널이 옆에서 빠진(2026-10-01) 뒤로 목록이 화면 폭을 다 쓴다.
 * 35.5rem(568px) = 2단이 막 서는 폭에서도 글 열이 읽히는 바닥(실측: 이름 112 · 과목·상담사 84 · 반 116px). 34rem이면 이름·반이
 * 104·102px로 눌려 30행 중 24행이 잘렸다.
 */
const COLUMN_REM = 35.5;
/** 단 수 상한 — 원장 2026-09-30 *"상담을 2단으로 줄이고"*. 통계 패널이 통계 화면으로 옮겨 간(2026-10-01) 뒤에도 2단이 상한이다(넓은 창은 단이 넓어진다). */
export const CONSULT_MAX_COLS = 2;
/**
 * 오른쪽 폭 고정 열(카테고리 | 상담 평점 | 시각)의 폭(rem) — 실측(Pretendard): 알약 두 글자 44.2 · 제목 '상담 평점' 약 62(칸 64px) ·
 * "2026. 12. 31." 98.2(제목 '카테고리' 55px는 칸 52px에서 양옆 1.5px씩 간격에 걸친다).
 * 2026-11-11 원장 *"후속 열하고 녹음/AI 열 제거 → 상담 평점 열 추가"* — 옛 '후속'(4.75)·'녹음·AI'(5.5) 두 열이 빠져 좁은 행/보통 행 구분이 없어졌다.
 * 🔴 바깥 행 그리드의 오른쪽 트랙은 **이 합 + 안쪽 간격**으로 여기서 함께 도출한다 — 둘을 따로 적었다가 안쪽이 12px 넘쳤다
 *    (적대적 리뷰 2026-09-03). 바꿀 땐 여기 하나만. 평점 열은 지점 스위치·권한이 켜졌을 때만 선다(없으면 이 열을 통째로 뺀다).
 */
const RIGHT_CAT_REM = 3.25;
const RIGHT_RATING_REM = 4;
const RIGHT_TIME_REM = 6.25;
const RIGHT_GAP_REM = 0.25; // = gap-1
const widthOf = (cols: readonly number[]) => cols.reduce((a, b) => a + b, 0) + RIGHT_GAP_REM * (cols.length - 1);
const tracksOf = (cols: readonly number[]) => cols.map((r) => `${r}rem`).join(" ");
/**
 * 왼쪽 글 열 — 실측 자연 폭(Pretendard): 이름+학년 중앙 106 · 상위 10% 121 · 최대 124px / 과목·상담사 상위 10% 81 · 최대 137px /
 * 반 이름 중앙 112 · 상위 10% 126 · 최대 153px. 세 열이 남는 폭을 **그 비율(31 : 21 : 32)**로 나눠 갖는다(`minmax(최소, Nfr)`).
 * 최소 합 = 6.5 + 5.25 + 5.5 = 17.25rem → 행 최소 폭 = 17.25 + 오른쪽 13.75(평점 열 포함 · 간격 포함) + 간격 0.5×3 + 좌우 여백 0.75
 * = 33.25rem ≤ 한 단 35.5rem. 넘치는 값은 말줄임 + 마우스 오버 전문(원장 *"긴 값은 말줄임 허용"*).
 */
const NAME_MIN = "6.5rem";
const WHO_MIN = "5.25rem";
const CLASS_MIN = "5.5rem";
/** 요약 열이 서는 넓은 행(64rem 이상)에선 글 열을 실측 최대 폭에서 멈춘다 — 남는 폭은 요약 몫이다. */
const NAME_WIDE = `minmax(${NAME_MIN},7.75rem)`;
const WHO_WIDE = `minmax(${WHO_MIN},8.5rem)`;
const CLASS_WIDE = `minmax(${CLASS_MIN},9.75rem)`;
/**
 * 제목 행을 몇 벌 그려 두나 — 단마다 하나씩 서야 하는데 단 수는 폭이 정한다(CSS 다단, 상한 2). 제목 행은 다단과 **같은 식**으로
 * 단을 세는 격자에 두 벌을 넣고 첫 줄만 보이게 잘라 낸다. `auto-fit`이라 측정 전(첫 페인트)에도 빈 트랙이 접혀 목록과 단 폭이 같다.
 */
const LIST_HEADER_COPIES = CONSULT_MAX_COLS;
const COL_GRID = `repeat(var(--cols, auto-fit), minmax(min(${COLUMN_REM}rem, 100%), 1fr))`;
/**
 * 행 격자 두 벌 — 행(=단) 폭이 정한다(`@container/row`):
 *   보통        이름 | 과목·상담사 | 반 이름 | [카테고리·상담 평점·시각]
 *   넓음(64rem~) 이름 | 과목·상담사 | 반 이름 | 요약 | [카테고리·상담 평점·시각]
 * 오른쪽 블록은 늘 **마지막 트랙**(`-col-end-1`)에 앉는다 — 요약·반 열이 없는 벌에서도 자리를 따로 세지 않는다.
 * 🔴 폰 두 줄 카드(`phone:`)는 이 벌들과 같은 속성을 다투므로 `!`로 이긴다(폭 656px 넘는 폰 가로·좁은 브라우저).
 */
const ROW_GRID = "grid-cols-(--row) @5xl/row:grid-cols-(--row-l)";

function rowGridVars(classOn: boolean, ratingOn: boolean): CSSProperties {
  // 반 칸(0318a)이 없으면 그 열을 통째로 뺀다([[#95]] — '—'만 늘어선 열은 "매핑이 고장 났다"로 읽힌다).
  const text = classOn
    ? `minmax(${NAME_MIN},31fr) minmax(${WHO_MIN},21fr) minmax(${CLASS_MIN},32fr)`
    : `minmax(${NAME_MIN},31fr) minmax(${WHO_MIN},21fr)`;
  const wide = classOn ? `${NAME_WIDE} ${WHO_WIDE} ${CLASS_WIDE}` : `${NAME_WIDE} ${WHO_WIDE}`;
  const right = rightCols(ratingOn);
  return {
    "--row": `${text} ${widthOf(right)}rem`,
    "--row-l": `${wide} minmax(0,1fr) ${widthOf(right)}rem`,
    "--right": tracksOf(right),
  } as CSSProperties;
}
const rightCols = (ratingOn: boolean) => (ratingOn ? [RIGHT_CAT_REM, RIGHT_RATING_REM, RIGHT_TIME_REM] : [RIGHT_CAT_REM, RIGHT_TIME_REM]);

/**
 * 마우스 오버 전문 — 행에는 이름·학년·배지·시각만 남기고(원장 *"기본은 그냥 칸반"*) 요약·상담사·후속은 여기로
 * (등록상담 카드와 같은 규약: [column-cards.tsx](../../enrollment/_components/column-cards.tsx)).
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다 — 행을 열면 상세에 전부 있으므로 폰에서도 한 번의 탭으로 닿는다.
 */
function hoverTextOf(c: StudentConsultationRow, classOn: boolean): string | undefined {
  const who = [c.subject, c.counselorName ? `${c.counselorName} 상담` : null].filter(Boolean).join(" · ");
  const followUp =
    c.followUpAction || c.followUpDate
      ? `후속 조치: ${c.followUpAction ?? "—"}${c.followUpDate ? ` · 기한 ${c.followUpDate}` : ""}${c.followUpDone ? " · 완료" : ""}`
      : null;
  return (
    [
      `${c.studentName}${c.studentGrade ? ` (${c.studentGrade})` : ""}`,
      who || null,
      classOn ? `반: ${c.className ?? "없음"}${c.classSource === "manual" ? "(직접 고름)" : ""}` : null,
      c.summary?.trim() || null,
      followUp,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

/**
 * 원생상담 목록 — 행 = 표처럼 열이 선다: 이름(학년) | 과목 · 상담사 | 반 이름 | 요약(행이 넓을 때만) | 카테고리 | 상담 평점 | 시각.
 * 행 사이는 헤어라인(§11 — 카드로 싸지 않는다), 행 전체가 상세 링크(§10 — 행 안 아이콘 버튼 금지, 삭제는 상세에).
 * 🔴 **단 수는 폭이 정한다**(CSS 다단, 한 단 최소 35.5rem · 상한 2단). 🔴 **행 수는 높이가 정한다**(AutoPageSize → ?size=N) —
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
    <AutoPageSize
      size={size}
      rowPx={CONSULT_ROW_PX}
      storageKey={pageSizeKey}
      maxCols={CONSULT_MAX_COLS}
      pageCols={CONSULT_MAX_COLS}
      className="relative"
    >
      {/* 단마다 테두리 — 다단의 단은 요소가 아니라 테두리를 두를 수 없다. 제목 행과 같은 격자로 **단 크기의 빈 상자**를 뒤에 깔고
          그 위에 제목·목록을 얹는다. 링(shadow-card)은 상자 밖에 그려져 overflow에 잘리므로 여기만 border([[#114]]). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid auto-rows-[100%] gap-x-4 overflow-hidden"
        style={{ gridTemplateColumns: COL_GRID }}
      >
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} className="border-line rounded-lg border" />
        ))}
      </div>
      {/* 제목 행 — 아래 행과 같은 열 격자라 글자가 열 위에 정확히 선다. 머리 라벨은 **그 열 본문과 같은 정렬**
          (표 규약 "제목도 같은 쪽"): 글 열(학생·과목·반 이름·요약)은 본문이 왼쪽이라 왼쪽, 칩 열(카테고리·상담 평점)은 가운데,
          시각은 오른쪽. 반 이름은 4~15자로 길이가 들쭉날쭉해 가운데로 모으면 줄마다 시작이 달라진다 → 이웃 글 열과 같이 왼쪽. */}
      <div
        className="relative grid h-9 auto-rows-[100%] gap-x-4 overflow-hidden phone:hidden"
        style={{ ...vars, gridTemplateColumns: COL_GRID }}
        data-list-header=""
      >
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} aria-hidden={i > 0 ? "true" : undefined} className="@container/row">
            <div className={`text-text-dim grid h-full items-center gap-2 px-1.5 text-sm font-bold ${ROW_GRID}`}>
              <span className="truncate text-left"><SheetText value={"학생"} /></span>
              <span className="truncate text-left"><SheetText value={"과목 · 상담사"} /></span>
              {classOn ? <span className="truncate text-left"><SheetText value={"반 이름"} /></span> : null}
              <span className="hidden text-left @5xl/row:block"><SheetText value={"요약"} /></span>
              <div className="-col-end-1 grid grid-cols-(--right) items-center justify-items-center gap-1 whitespace-nowrap">
                <span><SheetText value={"카테고리"} /></span>
                {ratingOn ? <span><SheetText value={"상담 평점"} /></span> : null}
                <span className="justify-self-end"><SheetText value={"시각"} /></span>
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

function ConsultationRow({ c, classOn, ratingOn, rating }: { c: StudentConsultationRow; classOn: boolean; ratingOn: boolean; rating: ConsultationRating | null }) {
  const catMeta = c.category ? CATEGORY_META[c.category] : null;
  // 후속 기한이 지났거나 오늘인 행은 배경으로 알린다 — '후속' 열은 걷었어도(2026-11-11) 이 신호는 남긴다. 무슨 후속인지는 마우스 오버 전문(hoverTextOf)에 적힌다.
  const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
  const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
  const who = [c.subject, c.counselorName].filter(Boolean).join(" · ");
  const className = c.className ?? "—";
  return (
    // @container/row — 이 행(=단)의 폭이 행 격자 두 벌(위 ROW_GRID 주석)을 고른다.
    <li title={hoverTextOf(c, classOn)} className="@container/row border-line border-t">
      {/* 폰(`phone:` = 최상위 프레임 <768px)은 두 줄 — [이름 | 과목·상담사(·반)] / [카테고리 · 상담 평점 · 시각].
          🔴 `max-md:`가 아니다 — 이 창은 기본 크기가 760px(<768)이라 `max-md:`면 데스크톱 창이 폰 카드로 바뀐다. */}
      <WindowLink
        href={`/consultations/${c.id}`}
        title={c.studentName}
        className={`hover:bg-bg-soft grid h-11 items-center gap-2 rounded-lg px-1.5 transition ${ROW_GRID} phone:h-auto phone:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]! phone:gap-y-1 phone:py-1.5 ${isUrgent ? "bg-danger-soft" : ""}`}
      >
        {/* 이름 24px, 학년 18px — 1차 핵심값이라 이 칸엔 이름·학년만(배지가 같이 서면 이름을 민다). */}
        <p className="text-foreground min-w-0 truncate text-xl leading-none font-bold">
          {c.studentName}
          {c.studentGrade ? <span className="text-text-dim ml-1 text-base font-semibold">({c.studentGrade})</span> : null}
        </p>
        {/* 과목 · 상담사 — 동기화·수정중 배지는 여기(2차 정보 칸)에. 폰에선 반 이름도 여기 붙는다(반 열이 폰에서 숨는다). */}
        <p className="text-text-dim flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="min-w-0 truncate">
            {who}
            {classOn && c.className ? <span className="hidden phone:inline"> · <SheetClassName value={c.className} /></span> : null}
          </span>
          {c.syncAddedAt ? <MakeeduOriginTag /> : null}
          <EditingBadge scope={`student-consultation:${c.id}`} />
        </p>
        {/* 반 이름 — 상담사가 가르치는 반(판정 한 벌: scripts/_makeedu/consultation-class.cjs). 못 정하면 '—'(추측 금지). */}
        {classOn ? (
          <p className={`min-w-0 truncate text-sm font-medium phone:hidden ${c.className ? "text-text-dim" : "text-muted-foreground"}`} title={c.className ?? "반 없음"}>
            {className}
          </p>
        ) : null}
        {/* 요약 한 줄 — 2차 정보라 말줄임 허용(§1). 전문은 마우스 오버·상세. */}
        <p className="text-text-faint hidden min-w-0 truncate text-sm @5xl/row:block" title={c.summary}>
          {consultationPreview(c.summary)}
        </p>
        {/* 오른쪽은 **열**이다 — 카테고리 | 상담 평점 | 시각, 칸 폭 고정이라 행마다 배지 수가 달라도 같은 자리에 선다. */}
        <div
          className={`-col-end-1 grid grid-cols-(--right) items-center justify-items-center gap-1 phone:col-start-1 ${ratingOn ? "phone:grid-cols-[auto_auto_minmax(0,1fr)]!" : "phone:grid-cols-[auto_minmax(0,1fr)]!"} phone:justify-items-start phone:gap-2`}
        >
          <span>{catMeta ? <Pill color={catMeta.color}>{catMeta.label}</Pill> : null}</span>
          {ratingOn ? <ConsultationRatingCell rating={rating} /> : null}
          <span className="num text-text-dim justify-self-end text-sm whitespace-nowrap">{relativeTimeKo(c.consultedAt)}</span>
        </div>
      </WindowLink>
    </li>
  );
}
