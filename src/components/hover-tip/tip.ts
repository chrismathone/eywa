/**
 * **메모 툴팁 = 카드** — 브라우저 기본 툴팁(`title`) 대신 화면에 뜨는 카드의 **재료**(순수 모듈, Vitest).
 *
 * 원장 2026-09-15: *"왠만하면 모든 곳의 메모는 시간표에서 사진올린것처럼 생기면 좋겠네. 그냥 메모처럼하니까
 * 너무 보기가 불편하다랄까?"* — 시간표 학생 hover 카드가 기준 모양이다(이름 굵게 + 오른쪽 학교·학년,
 * 구분선 아래 `라벨 값` 줄).
 *
 * 🔑 왜 속성(`data-tip`)인가: 출석부 격자는 칸이 **수천 개**다. 칸마다 카드 컴포넌트(상태·이벤트)를 달면
 *    그게 곧 반응속도 손실이라, 칸은 **문자열 한 줄만** 달고 문서마다 하나 있는
 *    [HoverTipLayer](./hover-tip-layer.tsx)가 그린다(창=iframe이라 문서마다 한 장).
 * 🔴 **본문은 데이터다** — 카드는 텍스트로만 그린다(HTML 문자열 금지). 여기서 만드는 값은 화면에 그대로 보이므로
 *    raw 코드(`absent`·`mon`)를 넣지 말 것(한글 매핑을 거친 값만).
 * ⚠️ 라벨·값이 하나도 없으면 **속성을 안 단다**(`undefined`) — 이름만 뜨는 빈 카드는 소음이다.
 */

/** 칸에 다는 속성 이름 — 레이어가 이 속성을 가진 가장 가까운 조상을 찾는다. */
export const TIP_ATTR = "data-tip";

/** `라벨 · 값` 한 줄. 값은 여러 줄(`\n`)이어도 된다(카드가 줄을 살려 그린다). */
export type TipRow = readonly [label: string, value: string];

/** 카드 한 장의 재료. 전부 선택이고, 빈 값은 스스로 빠진다. */
export type TipCard = {
  /** 머리 왼쪽 — 이름처럼 "무엇에 대한 카드인가". */
  title?: string | null;
  /** 머리 오른쪽 — 학교·학년, 날짜처럼 제목을 한정하는 짧은 말. */
  meta?: string | null;
  /** 구분선 아래 `라벨 값` 줄들. 값이 비면 그 줄은 빠진다. */
  rows?: readonly (TipRow | null | undefined | false)[];
  /** 라벨 없는 문장들(메모 원문·안내). */
  lines?: readonly (string | null | undefined | false)[];
};

/** 직렬화 모양 — 속성 문자열이 칸 수천 개에 실리므로 키를 한 글자로 줄인다. */
type Encoded = { t?: string; m?: string; r?: [string, string][]; l?: string[] };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 카드(또는 메모 한 줄) → 속성 문자열. 값이 하나도 없으면 `undefined`.
 * 🔴 문자열을 주면 **메모 한 줄**로 본다(`lines`) — 기존 `title={메모}` 자리를 그대로 옮기기 위한 지름길이다.
 */
export function encodeTip(tip: string | TipCard | null | undefined): string | undefined {
  if (tip === null || tip === undefined) return undefined;
  const card: TipCard = typeof tip === "string" ? { lines: [tip] } : tip;
  const out: Encoded = {};
  const title = clean(card.title);
  const meta = clean(card.meta);
  const rows = (card.rows ?? [])
    .filter((r): r is TipRow => Array.isArray(r) && clean(r[1]) !== "")
    .map((r) => [clean(r[0]), clean(r[1])] as [string, string]);
  const lines = (card.lines ?? []).map(clean).filter((l) => l !== "");
  if (title) out.t = title;
  if (meta) out.m = meta;
  if (rows.length > 0) out.r = rows;
  if (lines.length > 0) out.l = lines;
  // 🔴 이름·날짜만 있는 카드는 안 띄운다 — 화면에 이미 보이는 것을 한 번 더 말할 뿐이다.
  if (!out.r && !out.l) return undefined;
  return JSON.stringify(out);
}

/**
 * 칸에 펴 바를 props — `{...tipProps(...)}`. 값이 없으면 **빈 객체**라 속성 자체가 안 붙는다
 * (빈 문자열을 달면 레이어가 "카드 있음"으로 보고 빈 상자를 띄운다).
 */
export function tipProps(tip: string | TipCard | null | undefined): { "data-tip"?: string } {
  const value = encodeTip(tip);
  return value === undefined ? {} : { [TIP_ATTR]: value };
}

/**
 * 해석이 끝난 카드 — 만들 때(`TipCard`)는 빈 값·`false`를 섞어도 되지만, **읽을 때는 정리된 모양**이다
 * (그래야 그리는 쪽·테스트가 `row[0]`을 그냥 읽는다).
 */
export type ResolvedTip = { title: string | null; meta: string | null; rows: TipRow[]; lines: string[] };

/**
 * 속성 문자열 → 카드. 형식이 아니면 `null`(지어내지 않는다 — 카드를 안 띄운다).
 * ⚠️ 속성은 DOM에 있는 값이라 **무엇이든 올 수 있다** — 모양을 일일이 확인한다.
 */
export function decodeTip(raw: string | null | undefined): ResolvedTip | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const e = parsed as Encoded;
  const rows = Array.isArray(e.r)
    ? e.r
        .filter((r): r is [string, string] => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string")
        .map((r) => [r[0], r[1]] as TipRow)
    : [];
  const lines = Array.isArray(e.l) ? e.l.filter((l): l is string => typeof l === "string") : [];
  if (rows.length === 0 && lines.length === 0) return null;
  return {
    title: typeof e.t === "string" ? e.t : null,
    meta: typeof e.m === "string" ? e.m : null,
    rows,
    lines,
  };
}

/**
 * 카드를 **한 줄 글**로 편다 — 접근성 설명(`aria-description`)과 테스트가 읽는 값.
 * 🔴 순서는 카드가 그리는 순서와 같다(제목 · 메타 · 줄들 · 문장들) — 다르면 눈으로 본 것과 읽히는 것이 갈린다.
 */
export function tipText(raw: string | null | undefined): string {
  const card = decodeTip(raw);
  if (!card) return "";
  return [clean(card.title), clean(card.meta), ...card.rows.map((r) => `${r[0]} ${r[1]}`), ...card.lines]
    .filter((v) => v !== "")
    .join(" · ");
}

/**
 * 카드의 **그 줄 값** — `tipRow(el.getAttribute("data-tip"), "상태")`. 없으면 빈 문자열.
 * 🔑 테스트가 옛 `title` 문자열을 조각내 읽던 자리를 이걸로 대신한다(문장 순서에 안 흔들린다).
 */
export function tipRow(raw: string | null | undefined, label: string): string {
  return decodeTip(raw)?.rows.find((r) => r[0] === label)?.[1] ?? "";
}
