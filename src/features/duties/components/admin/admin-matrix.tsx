"use client";

import type { ReactNode } from "react";
import { add, cellOf, cellTextOf, cellTitle, EMPTY, MATRIX_COLUMNS, WITHDRAWAL_LABEL, type Cell, type MatrixRow, addRating, MIN_RATED, type Rating } from "../../view-admin";
import { judge, type Avg } from "../../view-admin-levels";
import { MixBar, useOntimeOnly } from "./admin-mix";
import { VerdictBadge } from "./admin-verdict";

/** 열 머리 — 칸이 좁아지면 낱말 사이에서 두 줄로 접힌다(한 줄을 고집하면 칸 밖으로 나가 표가 옆으로 밀린다). */
export const TH = "text-text-dim px-1 py-1.5 align-bottom text-xs leading-tight font-semibold break-keep";
/**
 * 표 틀 — 줄(선생님 · 반 · 학생)마다 옅은 가로선, 열마다 더 옅은 세로선(원장 2026-11-11 *"선생님별로도 구분할 수 있게 구분선 … 진하지 않은 적절한 크기로 가로 세로선"*).
 * 세로선은 줄 높이만큼 이어져 같은 농도면 가로선보다 세게 읽힌다 — 한 단계 옅게(`--line-faint`). 바깥 테두리는 없다(카드가 테두리다). 합계 줄 위는 한 단계 진하게.
 * 선은 칸(td · th)이 긋는다 — 항목 필터로 열을 감출 때 칸이 아니라 **칸 안의 내용**을 감춰야 선이 끊기지 않는다(`AdminMatrix`의 `off`).
 */
const TABLE = "table-fixed border-separate border-spacing-0 text-center text-sm [&_th:first-child]:px-2 [&_th:first-child]:text-left"
  + " [&_tbody>tr>*]:border-t [&_tbody>tr>*]:border-t-line [&_tbody>tr[data-total]>*]:border-t-line-strong [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint";
/** 숫자 칸(td)의 안 여백 — 막대가 구분선에 붙지 않게. */
export const TD = "px-1 py-0.5";
const n = (v: number) => v.toLocaleString("ko-KR");

/**
 * 표 열 너비(선생님 · 반 · 학생 표 한 벌) — 표는 늘 카드 폭을 채우고, 숫자 칸은 **모두 같은 너비**로 남은 폭을 나눠 갖는다.
 * 🔴 가로 스크롤을 만들지 않는다(원장 2026-11-11 *"가로 스크롤이 안생기게 열너비 적절하게 조정해"* → *"가로스크롤은 왠만하면 생기지 않게 열너비나 폰트 사이즈 조정"*):
 *   · **이름 열이 먼저 줄어든다** — 숫자 칸이 편한 폭(`CELL_OK`)을 갖고 남는 폭이 이름 열이다(넓으면 `wide`까지 · 좁으면 `narrow`까지).
 *     표를 감싼 상자가 `@container`라 그 폭(`100cqw`)으로 계산한다 — 화면 폭이 아니라 **카드 폭**을 따르므로 옆에 다른 카드가 서도 맞는다.
 *     이름 옆 글(과목 · 반 · 학생 수)은 이름 칸이 좁아지면 이름 아래로, 더 좁으면 감춘다(`NameCell` — 줄 높이는 그대로).
 *   · 그다음 숫자 칸이 `CELL_MIN`까지 줄어든다 — 칸의 둘째 줄('미처리 n%')은 좁은 칸에서 접히고, 열 머리는 두 줄로 접힌다.
 *   · 그 아래(본문 600px 안팎 — 데스크톱 화면에서는 나오지 않는 폭)에서만 카드 안에서 옆으로 민다. 화면 전체가 밀리지는 않는다.
 *   · `tableBasis` = 이 표가 넉넉하게 서는 카드 폭 — 옆에 다른 카드(기한 초과)가 설 수 있는지를 이 값으로 가린다(모자라면 표가 한 줄을 다 쓰고 옆 카드는 아래로).
 */
const GRADE_W = 80, CELL_FIT = 96, CELL_OK = 84, CELL_MIN = 52, GAP = 4, CARD_PAD = 26;
/** 이름 열의 폭 — 넉넉할 때(`wide`)와 가장 좁을 때(`narrow`). */
export type NameCol = { wide: number; narrow: number };
/** 사람 이름(선생님) — 좁으면 이름만 남긴다. */
export const NAME_PERSON: NameCol = { wide: 232, narrow: 84 };
/** 반 이름 · 학생(학교 · 학년) — 좁아도 옆 글을 이름 아래에 남긴다. */
export const NAME_LONG: NameCol = { wide: 232, narrow: 136 };
const restW = (cells: number, grade: boolean, cell: number) => (grade ? GRADE_W : 0) + (cells + (grade ? 2 : 1) + 1) * GAP + cells * cell;
export const gridStyle = (cells: number, grade = true, name: NameCol = NAME_PERSON) => ({ width: "100%", minWidth: name.narrow + restW(cells, grade, CELL_MIN) });
export const tableBasis = (cells: number, grade = true, name: NameCol = NAME_PERSON) => name.wide + restW(cells, grade, CELL_FIT) + CARD_PAD;
export function GridCols({ count, grade = true, name = NAME_PERSON }: { count: number; grade?: boolean; name?: NameCol }) {
  const nameW = `clamp(${name.narrow}px, calc(100cqw - ${restW(count, grade, CELL_OK)}px), ${name.wide}px)`;
  return <colgroup><col style={{ width: nameW }} />{grade ? <col style={{ width: GRADE_W }} /> : null}{Array.from({ length: count }, (_, i) => <col key={i} />)}</colgroup>;
}
/** 표를 감싸는 상자 — 열 너비 계산의 기준(`@container`)이고, 아주 좁을 때만 이 안에서 옆으로 민다. */
export function GridWrap({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`@container overflow-x-auto ${className}`}>{children}</div>;
}
/** 표 한 벌의 틀(선생님 · 반 · 학생 표가 같은 틀을 쓴다). */
export function GridTable({ count, grade = true, name = NAME_PERSON, children }: { count: number; grade?: boolean; name?: NameCol; children: ReactNode }) {
  return <table className={TABLE} style={gridStyle(count, grade, name)}><GridCols count={count} grade={grade} name={name} />{children}</table>;
}

/**
 * 이름 칸 — 이름(단추) + 표식 + 옆 글. 칸이 넓으면 한 줄 · 좁아지면 옆 글이 이름 아래로 · 더 좁으면 이름만(전체 글자는 마우스 오버).
 * 두 줄이어도 칸 상자(40px)보다 낮아 줄 높이가 바뀌지 않는다. 긴 이름은 줄 끝에서 줄인다.
 */
export function NameCell({ name, meta, badge, onClick }: { name: string; meta?: string | null; badge?: ReactNode; onClick?: () => void }) {
  const label = "min-w-0 overflow-hidden text-sm leading-tight font-bold text-ellipsis whitespace-nowrap";
  return <td className="px-2 py-0.5 text-left" title={meta ? `${name} · ${meta}` : name}>
    <div className="@container">
      <div className="flex min-w-0 flex-col justify-center @min-[200px]:flex-row @min-[200px]:items-baseline @min-[200px]:justify-start @min-[200px]:gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {onClick ? <button type="button" onClick={onClick} className={`hover:text-primary text-left ${label}`}>{name}</button> : <span className={label}>{name}</span>}
          {badge}
        </span>
        {meta ? <span className="text-text-dim hidden min-w-0 overflow-hidden text-xs leading-tight font-medium text-ellipsis whitespace-nowrap @min-[112px]:block">{meta}</span> : null}
      </div>
    </div>
  </td>;
}

/**
 * 선생님 × 업무 종류 표 — 칸 = 그 종류의 막대(`CountBox`). 이름을 누르면 그 선생님 · 칸을 누르면 그 선생님의 그 종류만.
 * 둘째 열 = 등급(`judge` — 전체 업무의 **기한 내 완료율** = '전체' 막대의 초록 몫으로 매긴다). 마지막 줄 = 전체(누르지 않는다).
 * 열(`columns`)과 평점 열(`rated`)은 **부모가 정한다** — 과목마다 표를 나눠 세워도 열이 같아야 세로줄이 맞는다.
 */
export function AdminMatrix({ rows, total, avg = null, grade = true, title = "선생님", kind = null, columns, rated = false, withdrawal, onCell }: {
  rows: MatrixRow[]; total: MatrixRow | null; avg?: Avg | null; /** 첫 열 머리(과목별로 나눈 표는 과목 이름). */ title?: string;
  /** 한 종류만 보기(항목 필터) — 다른 종류 열은 자리를 둔 채 감춘다. */ kind?: string | null; /** 등급 열을 세울지 — 하루 보기에는 없다. */ grade?: boolean;
  /** 세울 종류 열(없으면 이 표에 있는 종류). */ columns?: readonly { kind: string; label: string }[]; /** 수업보고서 평점 열을 세울지. */ rated?: boolean;
  /** 퇴원보고서 작성 참고 열(s2_0093) — 있으면 열을 세우고, 칸을 누르면 이 함수로 그 선생님의 작성 차례 목록. 등급 · 전체에는 안 든다. */
  withdrawal?: (ownerId: string) => void;
  onCell: (ownerId: string, kind: string | null) => void;
}) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">해당 기간 업무 없음</p>;
  // 이 표에 실제로 있는 종류만 열로 세운다(발송 길이 있는 지점엔 '보고서 작성' 열이 없다 — 빈 열을 세우지 않는다).
  const cols = columns ?? MATRIX_COLUMNS.filter((c) => rows.some((r) => r.cells[c.kind]?.total));
  // 항목 필터는 표를 다시 짜지 않는다 — 다른 항목 열을 잠시 감출 뿐이라 자리와 크기가 그대로다(원장 2026-11-11 *"창이 변경되거나 하지말고 그냥 잠시 해당 항목을 숨기는 효과"*).
  //   감추는 것은 칸(td · th)이 아니라 그 안의 내용이다 — 칸이 구분선을 긋기 때문에 칸째 감추면 선이 끊긴다.
  const off = (k: string) => (kind && k !== kind ? "invisible" : undefined);
  // 수업보고서 평점 — 준수율과 섞지 않는 참고 열(볼 수 있는 사람에게만 내려온다).
  const count = cols.length + 1 + (rated ? 1 : 0) + (withdrawal ? 1 : 0);
  const wTotal = withdrawal ? rows.reduce<Cell | null>((acc, r) => (r.withdrawal ? cellOf(add(acc ?? EMPTY, r.withdrawal)) : acc), null) : null;
  return <GridWrap>
    <GridTable count={count} grade={grade}>
      <thead><tr>
        <th className={TH}>{title}</th>
        {grade ? <th className={TH}>등급</th> : null}
        {cols.map((c) => <th key={c.kind} className={TH}><span className={off(c.kind)}>{c.label}</span></th>)}
        {/* 평균평점은 종류 열 바로 뒤 · '전체'가 맨 오른쪽(원장 2026-11-11). */}
        {rated ? <th className={TH}>보고서 평균평점</th> : null}
        {/* 퇴원보고서 작성 = 참고(등급 · 전체에 안 든다 — 머리에 밝힌다). */}
        {withdrawal ? <th className={TH} title="등급 · 전체에 들지 않는 참고 열입니다">{WITHDRAWAL_LABEL}<span className="text-text-dim ml-1 text-xs font-medium">참고</span></th> : null}
        <th className={TH}>전체</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.ownerId}>
          <NameCell name={r.name} meta={r.meta} onClick={() => onCell(r.ownerId, null)} />
          {grade ? <td className="px-1"><VerdictBadge v={judge(r.all, avg)} /></td> : null}
          {cols.map((c) => <td key={c.kind} className={TD}><div className={off(c.kind)}><CountBox cell={r.cells[c.kind] ?? null} onClick={r.cells[c.kind] ? () => onCell(r.ownerId, c.kind) : undefined} /></div></td>)}
          {rated ? <td className={TD}><RatingBox rating={r.rating} /></td> : null}
          {withdrawal ? <td className={TD}><CountBox cell={r.withdrawal ?? null} onClick={r.withdrawal ? () => withdrawal(r.ownerId) : undefined} /></td> : null}
          <td className={TD}><CountBox cell={r.all} onClick={() => onCell(r.ownerId, null)} /></td>
        </tr>)}
        {/* 합계 줄 — 줄 배경 없이 윗선 하나로 가른다(원장 2026-11-11 · 다른 줄보다 한 단계 진한 선 — 표 틀의 `data-total`). 칸은 위와 같은 막대다(숫자만으로는 기한 내 · 기한 후가 갈리지 않는다). */}
        {total ? <tr data-total>
          <td className="px-2 py-0.5 text-left text-sm font-bold">{total.name}</td>
          {grade ? <td /> : null}
          {cols.map((c) => <td key={c.kind} className={TD}><div className={off(c.kind)}><CountBox cell={total.cells[c.kind] ?? null} /></div></td>)}
          {rated ? <td className={TD}><RatingBox rating={rows.reduce<Rating | undefined>((acc, r) => addRating(acc, r.rating), undefined)} plain /></td> : null}
          {withdrawal ? <td className={TD}><CountBox cell={wTotal} /></td> : null}
          <td className={TD}><CountBox cell={total.all} /></td>
        </tr> : null}
      </tbody>
    </GridTable>
  </GridWrap>;
}

/**
 * 칸 상자 — 높이가 **하나**다(원장 2026-11-11 *"행높이 바뀌지 않게"*): 숫자 한 줄뿐이어도, 그 아래 작은 '미처리 n%'가 붙어도 같은 높이라 줄이 들쭉날쭉하지 않다.
 * 선생님 · 반 · 학생 표와 평점 · 결석 칸이 같은 상자를 쓴다. 상자가 `@container`라 안의 글자가 **칸 폭**을 보고 접힌다. 바탕은 칠하지 않는다(막대만 색이다).
 * 글자는 대시보드의 표와 같은 크기다(14px — 원장 *"폰트 사이즈가 다른곳과 다르게 너무 거대해서 그럴까?"*): 좁은 칸에 16px 굵은 글자가 꽉 차서 무거워 보였다. 숫자는 굵기로만 세운다.
 */
export const BOX = "@container flex h-10 w-full flex-col items-center justify-center rounded-lg px-0.5 pb-0.5 text-xs leading-none tabular-nums";
/** 막대 없는 칸(— · 결석 · 평점)의 글자 — 막대 자리만큼 비워 옆 칸의 숫자와 같은 높이에 선다. */
export function BoxText({ className = "", title, children }: { className?: string; title?: string; children: ReactNode }) {
  return <span className={`${BOX} ${className}`} title={title}><span className="flex min-h-0 flex-1 items-center whitespace-nowrap">{children}</span><span className="h-1.5 shrink-0" aria-hidden /></span>;
}

/**
 * 수업보고서 평점 칸 — 평균(5점 만점)만 적는다(건수는 적지 않는다 — 원장 2026-11-11). 색 · 막대 없이 숫자만(막대의 색은 '기한 내 · 기한 후 · 미처리'라는 뜻이다).
 * 건수가 모자라면(`MIN_RATED` 미만) 흐리게.
 */
export function RatingBox({ rating, plain }: { rating: Rating | undefined; plain?: boolean }) {
  if (!rating) return <BoxText className="text-text-placeholder font-semibold">—</BoxText>;
  const few = rating.rated < MIN_RATED;
  return <BoxText className={plain ? "font-bold" : `font-semibold ${few ? "opacity-60" : ""}`} title={`보고서 ${n(rating.rated)}건의 평균평점`}>{rating.avg.toFixed(1)}</BoxText>;
}

/**
 * 한 칸 = **숫자 + 가로 막대 하나** — 선생님 · 반 · 학생 표가 같은 부품을 쓴다(원장 2026-11-11 *"가로 막대로 3등분 하라는 뜻이야. 만약 100%중에 28%가 기한내, 70%가 기한외, 2%가 미처리면
 * 가로로 28%/70%/2%를 그리는거야. 그리고 그 위에 텍스트는 98%라고 적고 98%아래에 미처리 2% 적으면 될듯"*).
 *   · 막대(`MixBar`) = 때가 된 업무가 어떻게 끝났나를 **건수 비율 그대로** 가로로 나눈다: 기한 내 · 기한 후 완료 · 미처리(= 기한 초과 + 미처리 확정) · 남은 것(때는 됐고 기한 전)은 빈 바탕.
 *     가늘게, 칸 아래에 붙인다 — 줄 높이를 다 채우던 막대는 *"두껍고 너비가 넓지않으니까 못생겨보임"*으로 물렸다. 색은 대시보드의 노랑 · 회색 · 차콜(`MIX_COLOR`).
 *     🔴 칸 바탕을 따로 칠하지 말 것(막대가 둘로 읽힌다) · 경계를 기울이거나 작은 몫을 키워 그리지 말 것 — 그날 물리친 시안들이다.
 *   · 글자는 막대 위에 따로 선다(어느 한 몫의 이름표가 아니다): 첫 줄 = **완료율**(기한 내 + 기한 후 완료) · 둘째 줄 = **미처리 n%**(있을 때만 — 막대로는 2%가 안 보인다).
 *     무엇을 적는지는 `cellTextOf` 한 곳이 정한다 — 왼쪽 목록의 반 줄 · 학생 단계 종류 카드도 같은 함수를 쓴다(같은 반이 자리마다 다른 숫자로 보이지 않게).
 *     마우스를 올리면(초점이 가도) 그 자리에 건수(분자/분모 · 미처리 n건). 글자는 **칸에 들어갈 때만** 보인다 — 둘째 줄도, 올렸을 때의 건수도 잰 폭으로 접는다(`stepOf` · 잘라 보이지 않는다).
 *   · **기한 내만 보기**(화면 오른쪽 위 토글 · `useOntimeOnly`)면 숫자 = 기한 내 완료율 · 막대 = 기한 내 몫만. `mode="ontime"`은 토글과 무관하게 늘 그렇게 그린다(과목 관리자별 현황의 '기한 내 완료율' 칸).
 *     🔴 등급 · 등수 · 요약 칸의 숫자는 완료율이 아니라 늘 **기한 내 완료율**(막대의 노랑 몫)이다 — 칸의 글자를 등급 계산에 쓰지 말 것.
 *   · 때가 된 업무가 없는 칸(기한 전의 학생 상담 · 월말평가 · 신규생 관리)은 **진행**을 흐린 숫자와 **옅은 노랑 막대**로 그린다(원장 2026-11-11 *"학생 상담이나 월말평가도 막대바로 표현하는게 어때?"*)
 *     — 등급 · 전체에 들지 않는다는 것이 색으로 갈린다(기한이 지나면 진한 막대가 선다).
 *   · **결석 n**(`absent`) — 결석이라 보고서 업무가 빠진 수. 출결은 했는데 보고서 건수가 적은 것이 결석 때문인지 겉으로 보이게 적는다(원장 2026-11-11 *"결석해서 미발송했는지 겉으로 판단이 어려움"*).
 *     업무가 그것뿐이면 칸에 '결석'만 적는다. 집계(% · 막대 · 등급)에는 들지 않는다.
 */
/**
 * 칸 상자 안쪽 폭이 이만큼일 때만 보이는 글자의 클래스(8px 계단) — 좁은 칸에서 글자가 옆 칸의 세로선 위로 넘치지 않게, 들어갈 때만 보인다(2차 리뷰 2026-11-11).
 * 잘라서('미처리 6…') 보이면 숫자가 다른 뜻으로 읽힌다 — 자르지 않고 통째로 접는다. Tailwind가 문자열에서 찾으므로 클래스는 글자 그대로 적혀 있어야 한다.
 */
const STEP_FROM = 40, STEP = 8;
const INLINE_AT = ["@min-[40px]:inline", "@min-[48px]:inline", "@min-[56px]:inline", "@min-[64px]:inline", "@min-[72px]:inline", "@min-[80px]:inline", "@min-[88px]:inline", "@min-[96px]:inline", "@min-[104px]:inline", "@min-[112px]:inline", "@min-[120px]:inline", "@min-[128px]:inline", "@min-[136px]:inline", "@min-[144px]:inline", "@min-[152px]:inline", "@min-[160px]:inline", "@min-[168px]:inline"];
const HOVER_IN = ["@min-[40px]:group-hover:inline @min-[40px]:group-focus-visible:inline", "@min-[48px]:group-hover:inline @min-[48px]:group-focus-visible:inline", "@min-[56px]:group-hover:inline @min-[56px]:group-focus-visible:inline", "@min-[64px]:group-hover:inline @min-[64px]:group-focus-visible:inline", "@min-[72px]:group-hover:inline @min-[72px]:group-focus-visible:inline", "@min-[80px]:group-hover:inline @min-[80px]:group-focus-visible:inline", "@min-[88px]:group-hover:inline @min-[88px]:group-focus-visible:inline", "@min-[96px]:group-hover:inline @min-[96px]:group-focus-visible:inline", "@min-[104px]:group-hover:inline @min-[104px]:group-focus-visible:inline", "@min-[112px]:group-hover:inline @min-[112px]:group-focus-visible:inline", "@min-[120px]:group-hover:inline @min-[120px]:group-focus-visible:inline", "@min-[128px]:group-hover:inline @min-[128px]:group-focus-visible:inline", "@min-[136px]:group-hover:inline @min-[136px]:group-focus-visible:inline", "@min-[144px]:group-hover:inline @min-[144px]:group-focus-visible:inline", "@min-[152px]:group-hover:inline @min-[152px]:group-focus-visible:inline", "@min-[160px]:group-hover:inline @min-[160px]:group-focus-visible:inline", "@min-[168px]:group-hover:inline @min-[168px]:group-focus-visible:inline"];
const HOVER_OUT = ["@min-[40px]:group-hover:hidden @min-[40px]:group-focus-visible:hidden", "@min-[48px]:group-hover:hidden @min-[48px]:group-focus-visible:hidden", "@min-[56px]:group-hover:hidden @min-[56px]:group-focus-visible:hidden", "@min-[64px]:group-hover:hidden @min-[64px]:group-focus-visible:hidden", "@min-[72px]:group-hover:hidden @min-[72px]:group-focus-visible:hidden", "@min-[80px]:group-hover:hidden @min-[80px]:group-focus-visible:hidden", "@min-[88px]:group-hover:hidden @min-[88px]:group-focus-visible:hidden", "@min-[96px]:group-hover:hidden @min-[96px]:group-focus-visible:hidden", "@min-[104px]:group-hover:hidden @min-[104px]:group-focus-visible:hidden", "@min-[112px]:group-hover:hidden @min-[112px]:group-focus-visible:hidden", "@min-[120px]:group-hover:hidden @min-[120px]:group-focus-visible:hidden", "@min-[128px]:group-hover:hidden @min-[128px]:group-focus-visible:hidden", "@min-[136px]:group-hover:hidden @min-[136px]:group-focus-visible:hidden", "@min-[144px]:group-hover:hidden @min-[144px]:group-focus-visible:hidden", "@min-[152px]:group-hover:hidden @min-[152px]:group-focus-visible:hidden", "@min-[160px]:group-hover:hidden @min-[160px]:group-focus-visible:hidden", "@min-[168px]:group-hover:hidden @min-[168px]:group-focus-visible:hidden"];
const stepOf = (px: number) => Math.min(Math.max(Math.ceil((px - STEP_FROM) / STEP), 0), INLINE_AT.length - 1);
/** 글자 폭 어림(px) — 앱 글꼴 14px에서 잰 값(한글 12.6 · 숫자 8.3 · 빈칸 3.4 · % 12.3 · 굵은 글씨는 조금 넓다)으로 센다. 실제보다 좁게 세지 않는다. */
const W = { han: 12.6, digit: 8.3, sp: 3.4, pct: 12.3, slash: 5.5, comma: 3.6, dot: 7.2 };
const numW = (v: number) => { const t = v.toLocaleString("ko-KR"); return [...t].reduce((a, ch) => a + (ch === "," ? W.comma : W.digit), 0); };
const boldW = (w: number) => w * 1.06 + 1;

/**
 * 한 칸 = **숫자 + 가로 막대 하나** — 선생님 · 반 · 학생 표가 같은 부품을 쓴다(머리말은 위 `BOX` · `MixBar` 풀이 참고).
 */
export function CountBox({ cell, onClick, mode, absent = 0 }: { cell: Cell | null; onClick?: () => void; mode?: "ontime"; /** 결석으로 빠진 업무 수(보고서 — 반 · 학생 표). */ absent?: number }) {
  const toggled = useOntimeOnly();
  const ontimeOnly = toggled || mode === "ontime";
  const text = cell ? cellTextOf(cell, ontimeOnly) : null;
  // 업무가 하나도 없는데 결석으로 빠진 것만 있으면 '결석'이라고 적는다(그날 보고서가 없는 까닭). 누르면 그 날들이 목록에 뜬다.
  if (!cell || !text) {
    if (!absent) return <BoxText className="text-text-placeholder font-semibold">—</BoxText>;
    const label = `결석 ${n(absent)}건 · 업무 없음`;
    const inner = <><span className="flex min-h-0 flex-1 items-center whitespace-nowrap">결석{absent > 1 ? ` ${n(absent)}` : ""}</span><span className="h-1.5 shrink-0" aria-hidden /></>;
    return onClick ? <button type="button" onClick={onClick} className={`${BOX} hover:bg-bg-soft font-semibold`} title={label} aria-label={label}>{inner}</button> : <span className={`${BOX} font-semibold`} title={label}>{inner}</span>;
  }
  // 마우스를 올리면(초점이 가도) 건수로 — 그 글자가 칸에 들어갈 때만 바꾼다(안 들어가면 %를 그대로 둔다 · 건수는 칸 설명에 있다).
  const swap = (rest: ReactNode, hover: ReactNode, hoverPx: number) => { const i = stepOf(hoverPx); return <><span className={HOVER_OUT[i]}>{rest}</span><span className={`hidden ${HOVER_IN[i]}`}>{hover}</span></>; };
  const fracW = boldW(numW(text.num) + W.slash + numW(text.den));
  const missW = 3 * W.han + W.sp + numW(text.missPct) + W.pct, missHoverW = 3 * W.han + W.sp + numW(text.missed) + W.han;
  const absentW = 2 * W.han + W.sp + numW(absent);
  // 둘째 줄을 보일 최소 폭 — 미처리만 / 결석만 / 둘 다(둘 다 안 들어가면 미처리만 · 결석은 칸 설명에).
  const line2 = text.missed ? missW : absentW;
  const both = missW + W.dot + absentW;
  const body = <>
    <span className="flex min-h-0 flex-1 flex-col items-center justify-center gap-px">
      <span className={`whitespace-nowrap ${text.judged ? "font-bold" : "font-semibold opacity-60"}`}>{swap(<>{text.pct}<span className="font-medium">%</span></>, `${n(text.num)}/${n(text.den)}`, fracW)}</span>
      {/* 둘째 줄 — 미처리 n% · 결석 n(결석으로 보고서 업무가 빠진 수 — 출결은 했는데 보고서 건수가 적은 까닭). */}
      {text.missed || absent ? <span className={`hidden font-medium whitespace-nowrap ${INLINE_AT[stepOf(line2)]}`}>
        {text.missed ? <>미처리 {swap(`${text.missPct}%`, `${n(text.missed)}건`, Math.max(missHoverW, absent ? missHoverW + W.dot + absentW : 0))}</> : null}
        {absent ? <span className={text.missed ? `hidden ${INLINE_AT[stepOf(both)]}` : undefined}>{text.missed ? " · " : ""}결석 {n(absent)}</span> : null}
      </span> : null}
    </span>
    <MixBar cell={cell} ontimeOnly={ontimeOnly} />
  </>;
  const cls = `group ${BOX}`;
  const title = absent ? `${cellTitle(cell)} · 결석 ${n(absent)}건(업무 없음)` : cellTitle(cell);
  // 단추의 이름 = 보이는 숫자 + 칸 설명 전체 — 좁은 칸에서 둘째 줄이 접혀도, 막대(그림)를 못 봐도 같은 내용을 듣고, 보이는 숫자로 단추를 부를 수 있다.
  const name = `${text.pct}%${text.missed ? ` · 미처리 ${text.missPct}%` : ""} · ${title}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:bg-bg-soft`} title={title} aria-label={name}>{body}</button> : <span className={cls} title={title}>{body}</span>;
}
