/**
 * **시간대 규약 가드** — 원장 2026-09-09: *"왜 자꾸 UTC를 남겨두나? KST만 쓰라고 예전에 말한거 같은데.
 * 전수검사해서 UTC 삭제시키고 전부 KST 화 해"*.
 *
 * 규약은 하나다: **"지금"에서 날짜·연·월·시각을 뽑을 때는 언제나 KST**([`date-kst`](./date-kst.ts)).
 * 서버는 Vercel UTC라 `new Date()`의 로컬 게터와 `toISOString()`은 한국 새벽(00~09시)에 **하루/한 달**이
 * 어긋난다. 이건 눈에 안 띄는 종류의 오류라(그 시간대에 아무도 안 보므로) 테스트로 못박는다.
 *
 * 🔴 **UTC 산술 자체는 금지가 아니다** — 이미 확정된 `YYYY-MM-DD` 문자열을 더하고 빼는 계산은 `Date.UTC`
 *    앵커가 **정답**이다(DST·서버 TZ와 무관하게 결정적). `date-kst.ts`의 `addDays`·`shiftMonth`·
 *    `weekdayIndexOf`가 그렇게 짜여 있다. 금지되는 것은 **"지금"을 UTC 달력으로 읽는 것**뿐이다.
 * 🔴 **timestamptz 저장·비교도 금지가 아니다** — `new Date().toISOString()`을 `updated_at` 같은 절대시각
 *    컬럼에 넣는 것은 옳다(그 컬럼은 순간이지 날짜가 아니다). 그래서 아래 규칙은 `.toISOString()` 뒤에
 *    **`.slice(`가 붙는 경우**(= 날짜/시각 문자열로 잘라 쓰는 경우)만 잡는다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sourceFiles(p, out);
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

/** 주석은 규칙을 **설명**하는 자리다 — 경고 주석이 위반으로 걸리면 규약을 적을 수 없다. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const rel = (p: string) => p.slice(process.cwd().length + 1).split(String.fromCharCode(92)).join("/");

/**
 * 규약을 **정의하는** 파일 — 여기서는 UTC 관용구가 정답이다(그걸 감싸서 나머지에 KST를 준다).
 * 🔴 새 파일을 여기 넣지 말 것. 예외가 필요하면 대개 `date-kst`에 헬퍼가 없다는 뜻이다.
 */
const DEFINERS = new Set(["src/lib/date-kst.ts"]);

describe("🔴 '지금'에서 날짜를 뽑을 때는 KST만 쓴다", () => {
  it("`new Date()`의 로컬 게터·UTC 문자열 자르기가 없다", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (DEFINERS.has(rel(file))) continue;
      const src = strip(readFileSync(file, "utf8"));
      // ① 지금 → UTC 날짜/시각 문자열: `new Date().toISOString().slice(...)`
      // ② 지금 → 런타임 로컬 달력: `new Date().getFullYear()` 등 (서버=UTC)
      for (const m of src.matchAll(
        /new Date\(\)\.(?:toISOString\(\)\.slice|getFullYear|getMonth|getDate|getDay|getHours|getMinutes)\b/g,
      )) {
        offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders, `KST 헬퍼(kstToday·kstMonth·kstYear·kstDateOf)를 쓸 것:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  /**
   * ②의 변형 — `const now = new Date();` 로 받아 두고 **그 변수에** 로컬 게터를 쓰는 형태.
   * 직접 체이닝(`new Date().getMonth()`)만 막으면 한 줄만 쪼개서 그대로 되살아난다.
   * 🔴 `new Date(값)`(인자 있음)은 대상이 아니다 — 이미 확정된 순간을 파싱한 것이고, 그 순간에서
   *    KST 날짜를 뽑는 정답은 `kstDateOf`다(그건 이 규칙과 별개로 각 호출부가 지킨다).
   */
  it("`new Date()`를 변수로 받아 로컬 게터를 쓰지도 않는다", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (DEFINERS.has(rel(file))) continue;
      const src = strip(readFileSync(file, "utf8"));
      // 🔴 **한 정규식**으로 본다 — 선언과 사용을 따로 찾아 이름으로 잇던 판은 템플릿 안의 이스케이프가
      //    한 겹 벗겨져 조용히 헛통과했다. 여기선 "= new Date() 직후 400자 안의 로컬 게터"를 그대로 본다.
      for (const m of src.matchAll(
        /=\s*new Date\(\s*\)[\s\S]{0,400}?\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes)\(/g,
      )) {
        offenders.push(`${rel(file)}: .${m[1]}()`);
      }
    }
    expect(
      offenders,
      `"지금"의 달력은 KST에서 읽을 것(kstToday·kstMonth·kstYear): ` + offenders.join(", "),
    ).toEqual([]);
  });

  it("날짜·시각 포맷터엔 `timeZone: \"Asia/Seoul\"`이 붙는다", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (DEFINERS.has(rel(file))) continue;
      const src = strip(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/(toLocaleDateString|toLocaleTimeString|new Intl\.DateTimeFormat)\s*\(/g)) {
        // 호출 인자 안에 timeZone이 있는지 — 넉넉히 400자를 본다(옵션 객체가 여러 줄이다).
        if (src.slice(m.index, m.index + 400).includes("timeZone")) continue;
        offenders.push(`${rel(file)}: ${m[1]}`);
      }
    }
    expect(
      offenders,
      `런타임 시간대(서버=UTC)로 포맷된다 — 확정된 날짜 문자열이면 date-kst의 라벨 헬퍼를 쓸 것:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
