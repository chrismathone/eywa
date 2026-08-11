/**
 * 오늘 과제의 **쪽수 단위 후보정**(순수 함수, Vitest).
 *
 * 원장 2026-08-11: *"과제 입력할 때 쪽수를 꼭 입력하도록 강제할 수 있나 — `~131` 이렇게 말고 `~131p`
 * 혹은 `~131쪽` 이렇게"* → 뒤이어 *"후보정 처리 할 수 있으면 좋겠네"*. 그래서 **막지 않고 고친다**:
 * 강사가 `~131`이라 적어도 학부모에게는 `~131p`로 나간다(입력을 거절하면 그날 과제가 통째로 안 적힌다).
 *
 * 실측(lesson_reports 최근 90일 5,504건): 단위가 붙은 건 **161건뿐**이고 **1,622건이 맨숫자로 끝난다**
 * (`42-60`·`97-105`·`~89`·`6/11(목) : 50~52`). 학부모는 그 숫자가 쪽인지 문제 번호인지 알 수 없다.
 *
 * 🔴 **범위(A-B, A~B, ~B)만 건드린다.** 맨숫자 하나(`고쟁이 2-1`·`Step 1,2`·`07 연립방정식의 활용`)는
 *    쪽이 아닌 경우가 훨씬 많아 손대면 없는 사실을 만든다. 잘못 붙이는 것보다 안 붙이는 게 낫다.
 * 🔴 **끝 > 시작인 범위만.** 이 한 줄이 실데이터 최대 오탐원인 교재명(`고쟁이 2-1`·`유형의 나무 2-2`)을 막는다.
 * 🔴 열린 범위는 **물결에 숫자가 딱 붙었을 때만**(`~131` ⭕ / `06 이차방정식 ~ 10 일차함수` ❌ — 뒤엣것은
 *    쪽이 아니라 단원 구간이다. 실제 입력에 있다).
 * ⚠️ 멱등 — 이미 `p`·`쪽`·`페이지`가 붙었거나(`p.148~161`·`p50~p53`) 다른 단위가 붙은 값
 *    (`10-15문제`·`3-4단원`)은 그대로 지나간다. 여러 번 돌려도 `~131pp`가 되지 않는다.
 */

/** 붙일 단위. 강사 입력 실물이 `P101`·`p.148~161`처럼 이미 p 계열이라 p로 통일(원장 예시도 `~131p`가 먼저). */
const PAGE_UNIT = "p";

/**
 * 숫자 뒤에 이미 붙어 있으면 **쪽이 아닌** 것 — 여기 걸리면 손대지 않는다.
 * ⚠️ 한 글자 단위 중 일부만 `(?![가-힣])`로 낱말 경계를 확인한다. 안 그러면 `개`가 다음 줄의 "**개**념의 숲"에,
 *    `과`가 "**과**제"에 걸려 멀쩡한 쪽 범위를 통째로 건너뛴다(실데이터 드라이런에서 났다).
 *    반대로 `번·장·회`는 **뒤에 글자가 이어지는 게 정상**이라(`~319번까지`·`3장까지`·`1회~4회까지`)
 *    경계를 요구하면 문항 번호에 p가 붙는다 — 그래서 이 셋만 경계 없이 잡는다.
 * ⚠️ 앞에 `\s*`를 두지 않는다 — 단위는 숫자에 붙어 있지, 줄 바꿔 나타나지 않는다.
 */
const TRAILING_UNIT =
  /^(?:p\b|P\b|쪽|페이지|번째|문제|단원|단계|교시|학기|학년|세트|시간|차시|개월|번|장|회|[개과강권차시분년월일페](?![가-힣])|%)/;

/** 범위 **앞**에 이미 쪽 표시가 있는가(`p.148~161`·`P 12-20`). 있으면 손대지 않는다. */
const PAGE_PREFIX = /(?:p|P|쪽|페이지)\s*\.?\s*$/;

/** 다른 숫자 코드에 이어붙은 자리인가 — `1-1-1`(차시)·`6/11`(날짜)·`2026-08-11`·`179=195`(오타). */
const CODE_BEFORE = /[\d./=~–—-]$/;
/** 뒤가 숫자 코드거나 **영문자**인 자리 — `180-184x`(제외 표시)·`70a~71b`처럼 쪽이 아닌 기호가 붙는다. */
const CODE_AFTER = /^[\d./=~–—A-Za-z-]/;

/**
 * 숫자 앞의 낱말이 **쪽이 아님을 이미 말하고 있는가** — `유형 1~17까지`·`Step 1,2`·`문제 12-20`.
 * (단위는 뒤가 아니라 앞에 붙기도 한다.)
 */
const NON_PAGE_NOUN_BEFORE = /(?:유형|문제|번호|단원|단계|차시|회차|[Ss]tep)\s*[:：]?\s*$/;

/** 앞자리 0이 붙은 숫자는 쪽이 아니라 **코드**다 — `2-04 여러가지 부등식`·`창의융합 ( 01~03 )`. */
const LEADING_ZERO = /^0\d/;

/** 괄호 안 숫자는 이 데이터에선 문항 번호·설명이다 — `p.42~44(109~136)`·`( 01~03 )`. */
function insideParens(before: string): boolean {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return line.split("(").length - 1 > line.split(")").length - 1;
}

/**
 * 그 줄이 **이미 쪽 표기를 쓰고 있는가** — `가우스 p24~27, 34~36`·`p. 31-35. 36-40`.
 * 강사가 한 번 `p`를 적었으면 그 줄의 숫자가 쪽이라는 건 이미 전해졌다. 뒤엣것에 또 붙이면
 * `p.64,67-69p`처럼 지저분해지고, 그 줄의 다른 숫자가 문항 번호일 때 틀린 단위가 된다.
 */
function linePaged(before: string): boolean {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return /(?:p|P)\s*\.|(?:p|P)\s*\d|쪽|페이지/.test(line);
}

/**
 * 쪽으로 인정할 최소 끝번호. 한 자리 범위는 이 데이터에서 거의 다 **차시·단원 코드**다
 * (`4-5 이차함수 …`·`가우스 1-3까지`). 못 붙이는 쪽 범위가 생기더라도 틀리게 붙이는 것보다 낫다.
 */
const MIN_PAGE = 10;

/**
 * 숫자 범위 뒤에 쪽 단위를 붙인다. 대상은 두 꼴뿐:
 *  ① 닫힌 범위 `42-60`·`50 ~ 52`·`94- 98` (끝 > 시작일 때만)
 *  ② 열린 범위 `~131` (물결에 숫자가 붙은 "여기까지")
 * 그 외(맨숫자·이미 단위 있음·다른 코드의 일부)는 원문 그대로. 여러 줄·여러 개도 각각 처리한다.
 */
export function normalizeHomeworkPages(raw: string): string {
  if (!raw) return raw;
  const out = raw.replace(
    /(\d{1,4})(\s*[-~–—]\s*)(\d{1,4})/g,
    (m, aRaw: string, _sep: string, bRaw: string, offset: number, full: string) => {
      if (!(Number(bRaw) > Number(aRaw)) || Number(bRaw) < MIN_PAGE) return m; // 고쟁이 2-1 · 4-5 차시코드
      if (LEADING_ZERO.test(aRaw) || LEADING_ZERO.test(bRaw)) return m;
      const before = full.slice(0, offset);
      const after = full.slice(offset + m.length);
      if (CODE_BEFORE.test(before) || CODE_AFTER.test(after)) return m;
      if (PAGE_PREFIX.test(before) || TRAILING_UNIT.test(after)) return m;
      if (NON_PAGE_NOUN_BEFORE.test(before) || insideParens(before) || linePaged(before)) return m;
      return `${m}${PAGE_UNIT}`;
    },
  );
  return out.replace(/[~–—](\d{1,4})/g, (m, nRaw: string, offset: number, full: string) => {
    if (LEADING_ZERO.test(nRaw) || Number(nRaw) < MIN_PAGE) return m;
    const before = full.slice(0, offset);
    const after = full.slice(offset + m.length);
    // 앞이 숫자면 닫힌 범위라 위에서 이미 처리됐다(여기서 또 붙이면 `50~52pp`).
    if (CODE_BEFORE.test(before) || CODE_AFTER.test(after)) return m;
    if (PAGE_PREFIX.test(before) || TRAILING_UNIT.test(after)) return m;
    if (NON_PAGE_NOUN_BEFORE.test(before) || insideParens(before) || linePaged(before)) return m;
    return `${m}${PAGE_UNIT}`;
  });
}
