import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — **창(iframe) 안의 하드 이동은 embed=1을 지킨다**(메뉴·창 이동 전수검사 2026-09-11 `$[6].findings[1]`).
 *
 * 플로팅 창은 주소의 `embed=1`로 크롬 없는 셸을 받는다(proxy → x-embed → (shell)/layout embed 갈래). 창 안에서
 * 문서를 **통째로 다시 여는** 이동(`location.assign/replace`, 맨 `<a href="/…">`, GET `<form action="/…">`)이
 * embed를 빼먹으면 서버가 **전체 셸**로 그린다 — HideInFrame이 사이드바는 감추지만 창 전용 부품
 * (EmbedFocusSignal·PaletteHotkeyForward·WindowMinSizeNotice)이 빠지고 공지 팝업·검색 팰릿이 창 안에 들어온다
 * (창을 눌러도 앞으로 안 오고, 창 안 Ctrl+K가 그 창을 딴 메뉴로 바꾼다).
 *
 * 규칙 = 원생 삭제(`delete-student-button.tsx`): `useInFrame() ? withEmbed(href) : href`. JSX 링크는 `EmbedAnchor`,
 * GET 폼은 `EmbedHiddenInput`(둘 다 `embed-link.tsx` — 클라가 물리 프레임으로 판정). 서버가 요청의 embed로 짓는 href는
 * embed 없이 소프트 이동으로 들어온 첫 렌더에서 빠지므로 하드 이동엔 쓰지 않는다.
 * ⚠️ 소프트 이동이 지운 **지금 문서의 주소**는 `EmbedUrlKeeper`가 되붙인다 — 그건 이 가드가 보는 하드 이동(새 문서)과 다른 층이다.
 *
 * 🔑 판정은 **패턴 한정**이다 — 소프트 이동(`<Link>`·`router.push`)은 이 가드 밖이다(레이아웃이 그대로라
 *    당장은 안 깨진다; 그쪽은 이동 부품 테스트 `embed-soft-nav.test.tsx`가 잡는다). 넓게 잡은 가드는 곧 무시된다.
 * ⚠️ 한계: `<a href={변수·함수 호출}>`은 판정하지 않는다(값을 정적으로 모른다) — `<a href={buildHref(…)}>` 같은 하드 이동은
 *    이 가드를 빠져나간다. 새로 쓸 땐 맨 `<a>` 대신 `EmbedAnchor`를 쓸 것.
 * ⚠️ 알려진 미수정은 `KNOWN_UNFIXED_ANCHORS`(ratchet) — 고치면 **숫자를 내리고**, 0이 되면 줄을 지운다.
 */
const ROOT = resolve(process.cwd());
const BACKSLASH = String.fromCharCode(92);
const rel = (p: string) => p.slice(ROOT.length + 1).split(BACKSLASH).join("/");

/** 창 안에서 그려질 수 있는 코드 — 셸 라우트 + 기능 모듈 + 공용 부품. */
const SCOPES = ["src/app/(shell)", "src/features", "src/components"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 블록 주석과 줄 전체 주석을 지운다(줄 번호는 남긴다) — 주석 속 예시 코드에 걸리지 않게. */
function stripComments(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

const FILES = SCOPES.flatMap((s) => walk(join(ROOT, s))).map((p) => ({
  rel: rel(p),
  src: stripComments(readFileSync(p, "utf8")),
}));

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

/** `open`(여는 괄호 위치)부터 짝이 맞는 닫는 괄호까지의 속 — 인자·속성 식을 통째로 본다. */
function balanced(src: string, open: number, o = "(", c = ")"): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

/** JSX 여는 태그 `<tag …>` 전체(중괄호 깊이 0의 `>`까지 — 여러 줄 태그도 한 덩어리로). */
function openTags(src: string, tag: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = new RegExp(`<${tag}(?=[\\s>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + tag.length + 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    out.push({ text: src.slice(m.index, i + 1), index: m.index });
  }
  return out;
}

/** 속성 식 — `attr="…"`면 값, `attr={…}`면 중괄호 속. 없으면 null. */
function attrExpr(tag: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}=(["'{])`).exec(tag);
  if (!m) return null;
  const at = m.index + attr.length + 1;
  if (m[1] === "{") return balanced(tag, at, "{", "}");
  const end = tag.indexOf(m[1]!, at + 1);
  return tag.slice(at + 1, end);
}

/** 식이 앱 내부 경로 리터럴로 시작하나(`"/x"` · `` `/x` `` · `{"/x"}`). 변수·함수 호출은 판정하지 않는다. */
function internalLiteral(expr: string | null): boolean {
  return expr != null && /^\s*["'`]?\//.test(expr);
}

// ── ① location.assign/replace(…) · location.href = … ────────────────────────────────────────────────

/**
 * 최상위 프레임에서만 그려지는 곳 — 창 안에 안 뜨므로 embed가 필요 없다(오히려 실으면 셸 없는 화면이 된다).
 * 이유 없이 늘리지 말 것.
 */
const TOP_LEVEL_ONLY: Record<string, string> = {
  "src/components/view-mode-toggle.tsx": "사이드바 '강사뷰 전환'의 나 항목 — 사이드바는 창 안에서 HideInFrame",
  "src/components/other-teacher-view.tsx": "사이드바 '강사뷰 전환' · 열람 종료 배지 — 최상위 전용",
  "src/components/teacher-menu.tsx": "강사 미니셸 '내 메뉴' — 미니셸엔 창이 없다",
  "src/components/workspace/embed-url-keeper.tsx":
    "최상위(새 탭)에 뜬 창 문서에서 embed를 **떼는** 자리 — 창 안에선 이 호출이 안 돈다(isFramed)",
};

/**
 * **지금 문서**를 옮기는 호출만 — `window.location.…` 또는 맨 `location.…`.
 * ⚠️ 창 틀(부모 프레임)이 `iframe.contentWindow.location`·`cw.location`으로 **창을** 옮기는 건 창 시스템(창 스택)
 *    몫이라 이 가드 밖이다 — 앞 글자가 `.`이면(`cw.location`) 걸지 않는다.
 * ⚠️ 뒤돌아보기(lookbehind) 대신 앞 글자를 잡는다 — tsconfig target이 es2017이라 타입체크가 거절한다.
 */
function hardNavCalls(src: string): { arg: string; index: number }[] {
  const out: { arg: string; index: number }[] = [];
  const call = /(^|[^\w$.])(window\.)?location\.(?:assign|replace)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    out.push({ arg: balanced(src, m.index + m[0].length - 1), index: m.index + m[1]!.length });
  }
  const set = /(^|[^\w$.])(window\.)?location\.href\s*=(?!=)([^;\n]*)/gm;
  while ((m = set.exec(src))) out.push({ arg: m[3]!, index: m.index + m[1]!.length });
  return out;
}

/** 인자가 embed 처리를 거치나 — 식 안에 `withEmbed`, 또는 같은 파일에서 `withEmbed`로 만든 변수. */
function keepsEmbed(arg: string, src: string): boolean {
  if (arg.includes("withEmbed")) return true;
  const id = arg.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(id)) return false;
  return new RegExp(`(?:const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\s*=[^;]*withEmbed`).test(src);
}

function unhandledCalls(file: string, src: string): string[] {
  if (TOP_LEVEL_ONLY[file]) return [];
  return hardNavCalls(src)
    .filter(({ arg }) => !keepsEmbed(arg, src))
    .map(({ arg, index }) => `${lineOf(src, index)}번 줄 (${arg.trim()})`);
}

// ── ③ 맨 <a href="/…"> ───────────────────────────────────────────────────────────────────────────

/**
 * 알려진 미수정(ratchet) — **지금 0곳**(2026-09-11 데스크 '어제 남은 결석'·어제 출결 반 링크 2·원스크린 '전체 보기/오늘만' 2를
 * `EmbedAnchor`로 옮겨 비웠다). 🔴 **새로 넣지 말 것** — 맨 `<a href="/…">` 대신 `EmbedAnchor`(하드) 또는 `EmbedLink`(소프트).
 * 부득이하게 넣으면 숫자를 적고, 고치면 내리고 0이면 줄을 지운다(아래 테스트가 둘 다 강제한다).
 */
const KNOWN_UNFIXED_ANCHORS: Record<string, { count: number; why: string }> = {};

function unhandledAnchors(src: string): number[] {
  const lines: number[] = [];
  for (const { text, index } of openTags(src, "a")) {
    const href = attrExpr(text, "href");
    if (!internalLiteral(href)) continue;
    // 새 탭·다운로드는 최상위로 간다(embed를 실으면 셸 없는 화면) · API 응답은 셸 문서가 아니다.
    if (/\btarget=["{]\s*["']?_blank/.test(text) || /\bdownload\b/.test(text)) continue;
    if (/^\s*["'`]?\/api\//.test(href!)) continue;
    // `withEmbed(`를 거친 href만 통과 — `embed`라는 글자나 손으로 이은 `embed=1`(서버 판정 조건부 문자열)은 embed 없이 들어온
    // 첫 렌더에서 빠진다. 창 안 하드 링크는 원래 `EmbedAnchor`로 쓴다(이 스캔은 맨 `<a`만 본다).
    if (/\bwithEmbed\(/.test(href!)) continue;
    lines.push(lineOf(src, index));
  }
  return lines;
}

describe("창 안 하드 이동은 embed=1을 지킨다", () => {
  it("🔴 location.assign/replace · location.href = … 는 withEmbed를 거친다", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const calls = unhandledCalls(f.rel, f.src);
      if (calls.length > 0) bad.push(`${f.rel}: ${calls.join(" · ")}`);
    }
    expect(bad, "창 안이면 `useInFrame() ? withEmbed(href) : href` (delete-student-button.tsx)").toEqual([]);
  });

  it("🔴 GET <form action=\"/…\">은 embed hidden 입력을 싣는다", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      for (const { text, index } of openTags(f.src, "form")) {
        if (!internalLiteral(attrExpr(text, "action"))) continue;
        // **그 폼 안**만 본다 — 파일 어딘가에 있으면 통과시키면 같은 파일 두 번째 폼이 샌다.
        // `<EmbedHiddenInput`만 통과 — 손으로 적은 hidden embed는 서버 판정이라 embed 없이 들어온 첫 렌더에서 빠진다.
        const close = f.src.indexOf("</form>", index);
        const body = f.src.slice(index, close < 0 ? undefined : close);
        if (!/<EmbedHiddenInput\b/.test(body)) bad.push(`${f.rel}:${lineOf(f.src, index)}`);
      }
    }
    expect(bad, "창 안 GET 폼엔 <EmbedHiddenInput /> (embed-link.tsx — 클라가 물리 프레임으로 판정)").toEqual([]);
  });

  it("🔴 맨 <a href=\"/…\">은 embed를 싣는다(알려진 미수정 목록 밖에서 새로 생기지 않는다)", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const lines = unhandledAnchors(f.src);
      const known = KNOWN_UNFIXED_ANCHORS[f.rel]?.count ?? 0;
      if (lines.length > known) bad.push(`${f.rel}: ${lines.join(", ")}번 줄 (허용 ${known})`);
    }
    expect(bad, "창 안 하드 이동이면 href에 embed를 싣거나 <Link>(+EmbedLink)로").toEqual([]);
  });

  it("ratchet — 고친 줄은 목록에서도 내린다(목록이 실제보다 크면 새 결함이 숨을 자리가 된다)", () => {
    const stale: string[] = [];
    const srcOf = (file: string) => FILES.find((x) => x.rel === file)?.src ?? "";
    for (const [file, { count }] of Object.entries(KNOWN_UNFIXED_ANCHORS)) {
      const actual = unhandledAnchors(srcOf(file)).length;
      if (actual < count) stale.push(`${file}: 목록 ${count} → 실제 ${actual}`);
    }
    expect(stale).toEqual([]);
  });

  it("최상위 전용 목록은 실제로 그 파일이 있다(이름이 바뀌면 조용히 빠지지 않게)", () => {
    for (const file of Object.keys(TOP_LEVEL_ONLY)) {
      expect(FILES.some((f) => f.rel === file), file).toBe(true);
    }
  });
});

// 학기 격자는 2026-09 통합 성적관리 개편으로 /exams/input 으로 옮겨 갔다.
describe("성적관리 — 서버 컴포넌트 주소 빌더가 embed를 싣는다", () => {
  const exams = FILES.find((f) => f.rel === "src/app/(shell)/exams/input/page.tsx")!.src;

  it("칩·초기화·페이지·JJ 반 칩이 쓰는 buildHref가 창 안이면 embed=1을 싣는다", () => {
    expect(exams).toMatch(/isEmbed/);
    expect(exams).toMatch(/params\.set\("embed", "1"\)/);
  });
});
