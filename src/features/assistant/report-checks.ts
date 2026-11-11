/**
 * 보고서 확정 때 보는 '화면에 틀린 말이 나가지 않게' 검사 — settleReport(report.ts)가 쓴다(순수 · 서버·화면 공용).
 * 멘트 시험 2026-11-11(Claude·Codex 합의 · 원장 *"여전히 날것이 출력되는 문제도 해결해 active 이런거"*)에서 나온 것만 담는다:
 *  · KPI·차트 단위 — 영어 단위('39count')는 고치거나 뺀다(보고서를 돌려보내지 않는다 · 재리뷰 2026-11-11)
 *  · KPI 이름의 달 ≠ 가리킨 줄의 달('9~10월 퇴원'이 8월 줄) · KPI가 글자 칸을 가리킴('원생T 건')
 *  · 표 칸 이름에 붙인 코드표('재직 상태(active=재직, inactive=퇴사)') → 값을 바꾸고 이름을 다듬는다
 *  · 표·차트 칸에 남은 영어 코드 값 → SQL에서 CASE로 고치게 돌려보낸다(마무리 중에는 그대로 둔다)
 * 🔴 마무리 중(조회가 막힌 뒤)에 돌려보내면 고칠 길이 없어 답을 잃는다 — 돌려보내는 검사는 모두 `lenient`(마무리)에서 꺼진다.
 */

/** 단위 바꿈표 — 뜻이 하나인 것만. 프로토타입 이름(`__proto__`)에 걸리지 않게 Map(재리뷰 2026-11-11). */
const UNIT_ALIAS = new Map<string, string>([
  ["won", "원"],
  ["krw", "원"],
  ["percent", "%"],
  ["pct", "%"],
  ["%p", "%p"],
  ["people", "명"],
  ["persons", "명"],
  ["students", "명"],
  ["h", "시간"],
  ["hr", "시간"],
  ["hrs", "시간"],
  ["hours", "시간"],
  ["min", "분"],
  ["mins", "분"],
  ["minutes", "분"],
  ["days", "일"],
  ["times", "회"],
]);

/**
 * KPI·차트 단위 — 뜻이 하나인 영어는 한국어로, 그 밖의 영어(count·number — 명·건·개 중 무엇인지 모른다)는 뺀다(값만 보인다).
 * `%p`(퍼센트포인트)는 기호로 받는다 — `%p/월` 같은 한국어 조합도. 빈 단위는 뺀다(undefined).
 */
export function unitFix(unit: string | undefined): string | undefined {
  const u = unit?.trim();
  if (!u) return undefined;
  const alias = UNIT_ALIAS.get(u.toLowerCase());
  if (alias) return alias;
  if (/[A-Za-z]/.test(u.replace(/%p/gi, ""))) return undefined;
  return u;
}

/** 글에 적힌 달(1~12) — `9~10월`·`9월~10월`·`9·10월`은 둘 다 · `2026-08`·`2026-08-01`도 8. */
export function monthsIn(text: string): Set<number> {
  return periodIn(text).months;
}

/**
 * 달과, 여러 달을 한 묶음으로 적었나(`ranged`) — 범위 `9~10월`·`9월~10월`·`9-10월` · 나열 `9·10월`·`9, 10월`·`9/10월`.
 * 따로 적은 두 달(`10월 신규 − 9월 신규` · `9월-10월 증감` · `9월 등록생의 10월 출석률`)은 묶음이 아니다(Codex·재리뷰 2026-11-11).
 */
export function periodIn(text: string): { months: Set<number>; ranged: boolean } {
  const months = new Set<number>();
  let ranged = false;
  const ok = (n: number) => n >= 1 && n <= 12;
  const span = (a: number, b: number) => {
    for (let k = a, n = 0; n < 12; k = (k % 12) + 1, n++) {
      months.add(k);
      if (k === b) break;
    }
  };
  // 범위: 9~10월 · 9월~10월(물결은 '월'이 앞에 있어도) · 9-10월(줄표는 앞에 '월'이 없을 때만 — '9월-10월'은 차이다)
  for (const re of [/(?<!\d)(\d{1,2})\s*월?\s*[~∼]\s*(\d{1,2})\s*월/g, /(?<!\d)(\d{1,2})\s*[–-]\s*(\d{1,2})\s*월/g]) {
    for (const m of text.matchAll(re)) {
      if (!ok(Number(m[1])) || !ok(Number(m[2]))) continue;
      ranged = true;
      span(Number(m[1]), Number(m[2]));
    }
  }
  // 나열: 8·9·10월 · 9, 10월 · 9/10월
  for (const m of text.matchAll(/(?<!\d)((?:\d{1,2}\s*[·,/]\s*)+\d{1,2})\s*월/g)) {
    const list = m[1]!.split(/\s*[·,/]\s*/).map(Number).filter(ok);
    if (list.length > 1) {
      ranged = true;
      for (const k of list) months.add(k);
    }
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s*월/g)) if (ok(Number(m[1]))) months.add(Number(m[1]));
  // 연월 범위: 2026-05~10 · 2025-11~2026-04 (물결만 — 2026-05-01 같은 날짜의 줄표를 범위로 읽지 않는다 · D9-normal 오탐 2026-11-11)
  for (const m of text.matchAll(/(?<!\d)20\d\d[-./](\d{1,2})\s*[~∼]\s*(?:20\d\d[-./])?(\d{1,2})(?!\d)/g)) {
    if (!ok(Number(m[1])) || !ok(Number(m[2]))) continue;
    ranged = true;
    span(Number(m[1]), Number(m[2]));
  }
  for (const m of text.matchAll(/(?<!\d)20\d\d[-./](\d{1,2})(?!\d)/g)) if (ok(Number(m[1]))) months.add(Number(m[1]));
  return { months, ranged };
}

/** 기간을 이어 말하는 이름('3월 이후 · 10월까지 누적 · 지난달 대비 · 3월~')은 달이 줄과 달라도 맞을 수 있다 — 판정하지 않는다. */
const OPEN_PERIOD = /(이후|부터|이전|까지|누적|대비|전후|동안)|월\s*[~∼](?!\s*\d)/;
/**
 * 줄에서 집계 기간을 말하는 칸 — 이름이 딱 이것일 때만(월 · 달 · 기간 · 연월 …). 등록월·종료월·전달사항처럼 다른 사건의 달이나
 * 낱말 속 글자는 집계 기간이 아니다(Codex 리뷰 2026-11-11).
 */
const PERIOD_COLUMN = /^(월|달|기간|연월|년월|기준월|기준 월|집계월|대상월|month|ym)$/i;

type Ref = { query: string; row: number; column: string };

/**
 * KPI 이름의 달과 ref가 가리킨 줄의 달이 다르면 그 까닭(멘트 시험 2026-11-11 — '9~10월 퇴원 23명'이 8월 줄을 가리켰다).
 * 이름에 달이 없거나 · 줄에 기간 칸이 없거나 · 기간을 이어 말하는 이름이면 판정하지 않는다(null — 자유 글 전체 검증은 하지 않는다).
 */
export function kpiPeriodProblem(label: string, row: Readonly<Record<string, unknown>>, ref: Ref): string | null {
  if (OPEN_PERIOD.test(label)) return null;
  const { months: named, ranged } = periodIn(label);
  if (!named.size) return null;
  const inRow = new Set<number>();
  for (const [column, value] of Object.entries(row)) {
    if (column === ref.column || !PERIOD_COLUMN.test(column.trim())) continue;
    if (typeof value === "string") for (const m of monthsIn(value)) inRow.add(m);
    else if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12 && /^(월|달|month)$/i.test(column.trim())) inRow.add(value);
  }
  if (!inRow.size) return null;
  const list = (s: Set<number>) => `${[...s].join("·")}월`;
  const where = `${ref.query}[${ref.row}]`;
  const fix = "이름을 그 줄의 기간으로 고치거나, 같은 기간의 줄(합계면 합계를 한 줄로 조회한 줄)을 가리키거나, ref를 빼 주세요";
  if (![...named].some((m) => inRow.has(m))) return `KPI '${label}'의 이름은 ${list(named)}인데 가리킨 줄 ${where}은(는) ${list(inRow)}입니다 — ${fix}`;
  if (ranged && named.size > 1 && inRow.size === 1) return `KPI '${label}'의 이름은 ${list(named)} 여러 달인데 가리킨 줄 ${where}은(는) ${list(inRow)} 한 달입니다 — ${fix}`;
  return null;
}

/** 숫자로 읽히는 값인가 — `39` · `1,234` · `92.4%` · `467,500원` · `39명`. */
const NUMERIC = /^[-+]?[\d,]+(\.\d+)?\s*(%p?|원|명|건|개|회|점|일|시간|분|반|곳)?$/;

/**
 * KPI가 숫자를 쓰고는 글자 칸(이름·반)을 가리켰으면 그 까닭 — 서버가 값을 칸 값으로 바꾸므로 화면에 '원생T 건'이 떴다(멘트 시험 2026-11-11 M3).
 */
export function kpiRefTypeProblem(label: string, written: string | number, actual: unknown, ref: Ref): string | null {
  const wroteNumber = typeof written === "number" || NUMERIC.test(String(written).trim());
  if (!wroteNumber || typeof actual !== "string" || NUMERIC.test(actual.trim())) return null;
  return `KPI '${label}'은(는) 숫자인데 ref ${ref.query}[${ref.row}].${ref.column}은(는) 글자 칸('${actual.slice(0, 20)}')입니다 — 숫자 칸을 가리키거나 ref를 빼 주세요`;
}

/**
 * 칸 이름에 붙인 코드표 — `재직 상태(active=재직, inactive=퇴사)` → 이름 '재직 상태' + 바꿈표. AI가 값을 CASE로 바꾸는 대신
 * 머리에 뜻을 적곤 한다(원장 화면 2026-11-11). 코드표 모양이 아니면 null.
 */
export function legendOf(label: string): { label: string; map: Map<string, string> } | null {
  const m = /^(.*?)\s*[(（]([^()（）]*)[)）]\s*$/.exec(label);
  if (!m) return null;
  const map = new Map<string, string>();
  // 쉼표·쌍반점·띄어 쓴 빗금으로 나눈다 — 붙여 쓴 '·'·'/'는 퇴원 사유 이름('수업·강사' · '시간/일정')에 있다(최종 리뷰 2026-11-11).
  // 열쇠는 소문자 코드만(대문자 등급 'A'·반 이름 'LE2'는 값 자체가 이름이다) · 뜻 안에 또 '코드=' 꼴이 있으면 잘못 나눈 것이라 코드표로 보지 않는다.
  for (const part of m[2]!.split(/\s*[,，、;；]\s*|\s+\/\s+/)) {
    const pair = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s*[=:→]\s*(.+)$/.exec(part.trim());
    if (!pair || /[A-Za-z_][A-Za-z0-9_]*\s*[=:→]/.test(pair[2]!)) return null;
    map.set(pair[1]!, pair[2]!.trim());
  }
  const name = m[1]!.trim();
  return map.size && name ? { label: name, map } : null;
}

/** 영어 코드처럼 보이는 값 — 소문자 낱말(밑줄·숫자 이어짐 허용). 이름(대문자)·반 이름(LE2)·메일·uuid는 아니다. */
const CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
/**
 * 이 앱 DB가 실제로 쓰는 상태·종류 코드(밑줄 없는 것). 밑줄 없는 소문자 값은 이 목록에 있을 때만 코드로 본다 —
 * 소문자 영어 이름(amy)·채널(general)·am·pm까지 돌려보내면 CASE로 고칠 길이 없어 재작성만 낭비한다(최종 리뷰 2026-11-11).
 */
const KNOWN_CODES = new Set([
  "active", "inactive", "pending", "enrolled", "withdrawn", "paused", "prospective", "waiting", "graduated",
  "present", "absent", "late", "early", "excused", "makeup",
  "paid", "unpaid", "partial", "overdue", "refunded", "cancelled", "canceled",
  "missing", "submitted", "unchecked", "checked", "approved", "rejected", "draft", "sent", "failed", "queued", "done", "completed",
  "scheduled", "open", "closed", "true", "false",
  "math", "english", "science", "korean", "master", "admin", "teacher", "accountant", "manager", "parttime",
  "aywa", "makeedu", "monthly", "weekly", "daily", "regular", "special",
]);
/** 코드로 볼 값인가 — 밑줄이 있는 코드 모양이거나, 알려진 코드. */
export function isRawCode(value: string): boolean {
  const s = value.trim();
  return CODE.test(s) && (s.includes("_") || KNOWN_CODES.has(s));
}

/**
 * 표·차트 칸에 영어 코드 값이 남았으면 그 까닭(코드 안전망 code-labels를 지난 뒤) — 원장 *"날것이 출력되는 문제"*.
 * 한 칸의 글자 값이 **모두** 코드 모양일 때만(한국어·이름이 섞인 칸은 사람이 쓴 글일 수 있다).
 */
export function rawCodeProblem(label: string, values: readonly unknown[], opts: { anyLeft?: boolean } = {}): string | null {
  const strings = values.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!strings.length) return null;
  // 보통은 칸 전체가 코드일 때만(사람이 쓴 글이 섞인 칸은 건드리지 않는다). 코드표를 붙인 칸은 바꾸고 남은 코드가 하나라도 있으면(anyLeft).
  const codes = strings.filter((s) => CODE.test(s.trim()));
  if (opts.anyLeft ? !strings.some(isRawCode) : codes.length !== strings.length || !codes.some(isRawCode)) return null;
  const sample = [...new Set(opts.anyLeft ? strings.filter(isRawCode) : strings)].slice(0, 3).join("·");
  return `칸 '${label}'에 영어 코드 값(${sample})이 그대로 보입니다 — SQL에서 CASE로 한국어 이름을 select해 주세요(뜻은 describe_table 설명에 있습니다)`;
}

/**
 * 차트 가로축 값이 겹치면 그 까닭 — 같은 날짜·같은 대상이 막대 둘로 나온다(멘트 시험 2026-11-11 E26 · Codex 합의 v3.2).
 * 축약 전 원래 값으로 본다. 빈 값은 보지 않는다.
 */
export function chartXProblem(x: string, values: readonly unknown[]): string | null {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const k = String(v);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  if (!dup.size) return null;
  return `차트의 가로축(${x}) 값이 중복됩니다(${[...dup].slice(0, 3).join("·")}) — 대상·기간별 값을 한 행의 여러 계열로 펼치거나, 서로 다른 대상을 구분할 이름을 조회해 주세요`;
}
