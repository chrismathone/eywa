import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `EmbedUrlKeeper` — 창 갈래 문서의 주소를 창 여부와 맞춘다(전수검사 2026-09-11 근본 수리 + 리뷰 후속).
 *  ① 창 안인데 embed가 빠졌으면 **null 상태로** replaceState(null이어야 Next가 라우터까지 따라온다).
 *  ② 최상위(새 탭)인데 embed가 있으면 떼고 전체 셸로 다시 연다.
 *  ③ 안전망이다 — 자주 도는 이동은 처음부터 embed를 싣는다(아래 '출처' 묶음이 잠근다).
 * ⚠️ 이 파일의 행동 테스트는 **목 history** 위에서 돈다 — "라우터 canonicalUrl도 따라온다"는 Next 계약 핀이 따로 잠근다.
 */
const nav = vi.hoisted(() => ({ pathname: "/attendance", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { EmbedUrlKeeper } from "./embed-url-keeper";

// 창(iframe) 안인 척 — `window.top`을 다른 창으로 바꾼다(키퍼는 이펙트 안에서 self !== top으로 본다).
const TOP = Object.getOwnPropertyDescriptor(window, "top");
function setFramed(framed: boolean) {
  Object.defineProperty(window, "top", { configurable: true, get: () => (framed ? ({} as Window) : window) });
}
function restoreTop() {
  if (TOP) Object.defineProperty(window, "top", TOP);
  else delete (window as { top?: unknown }).top;
}

/** 문서가 지금 이 주소에 있다고 둔다(라우터 훅 값도 같이 — 소프트 이동이 커밋된 직후의 모습). */
function landAt(url: string, how: "push" | "replace" = "replace") {
  if (how === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  const u = new URL(url, "http://x");
  nav.pathname = u.pathname;
  nav.search = u.search.replace(/^\?/, "");
}
/** 라우터가 되붙인 주소를 따라온 뒤의 훅 값(Next의 ACTION_RESTORE가 하는 일). */
function routerFollows() {
  nav.pathname = window.location.pathname;
  nav.search = window.location.search.replace(/^\?/, "");
}
const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
function spyNav() {
  return {
    replaceState: vi.spyOn(window.history, "replaceState"),
    locReplace: vi.spyOn(window.location, "replace").mockImplementation(() => {}),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreTop();
});

describe("EmbedUrlKeeper — 창 여부와 주소 맞추기", () => {
  it("🔴 창 안에서 embed가 빠진 주소면 되붙인다(쿼리·해시 보존, 상태는 null)", () => {
    setFramed(true);
    landAt("/attendance?teacher=t1&month=2026-10#top");
    const { replaceState, locReplace } = spyNav();
    render(<EmbedUrlKeeper />);
    expect(here()).toBe("/attendance?teacher=t1&month=2026-10&embed=1#top");
    expect(replaceState).toHaveBeenCalledTimes(1);
    // 🔴 null이어야 Next 패치가 ACTION_RESTORE를 보내 canonicalUrl까지 embed 주소가 된다(__NA 객체면 건너뛴다).
    expect(replaceState.mock.calls[0]![0]).toBeNull();
    expect(locReplace).not.toHaveBeenCalled();
  });

  it("🔴 창 안에 embed가 있으면 아무것도 안 한다 — 떼지 않는다(창 여부는 훅이 아니라 이펙트에서 직접 본다)", () => {
    setFramed(true);
    landAt("/ecs?view=week&embed=1");
    const { replaceState, locReplace } = spyNav();
    render(<EmbedUrlKeeper />);
    expect(replaceState).not.toHaveBeenCalled();
    expect(locReplace).not.toHaveBeenCalled();
  });

  it("🔴 새 탭(최상위)에 뜬 창 문서는 embed를 떼고 전체 셸로 다시 연다(쿼리·해시 보존)", () => {
    setFramed(false);
    landAt("/students/abc?tab=grades&embed=1#memo");
    const { replaceState, locReplace } = spyNav();
    render(<EmbedUrlKeeper />);
    expect(locReplace).toHaveBeenCalledWith("/students/abc?tab=grades#memo");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("최상위에 embed가 없으면(평범한 문서) 아무것도 안 한다", () => {
    setFramed(false);
    landAt("/students?q=kim");
    const { replaceState, locReplace } = spyNav();
    render(<EmbedUrlKeeper />);
    expect(replaceState).not.toHaveBeenCalled();
    expect(locReplace).not.toHaveBeenCalled();
  });

  it("붙인 뒤 라우터가 따라와 다시 돌아도 한 번뿐(무한 루프 없음)", () => {
    setFramed(true);
    landAt("/mcs/c1/month?month=2026-09");
    const { replaceState } = spyNav();
    const r = render(<EmbedUrlKeeper />);
    routerFollows();
    r.rerender(<EmbedUrlKeeper />);
    r.rerender(<EmbedUrlKeeper />);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(here()).toBe("/mcs/c1/month?month=2026-09&embed=1");
  });

  it("창 안 소프트 이동이 embed를 지운 주소에 되붙는다(목 history — 라우터 동기화는 아래 Next 계약 핀)", () => {
    setFramed(true);
    landAt("/attendance?embed=1");
    const r = render(<EmbedUrlKeeper />);
    landAt("/attendance?teacher=t1&month=2026-09&mode=teacher", "push"); // Next HistoryUpdater가 pushState한 뒤의 모습
    r.rerender(<EmbedUrlKeeper />);
    expect(here()).toBe("/attendance?teacher=t1&month=2026-09&mode=teacher&embed=1");
  });
});

/** 문자열에서 `head` 뒤 첫 `(`부터 짝이 맞는 `)`까지 = 인자 식(중첩 괄호 포함). */
function closeOf(src: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i;
  }
  return -1;
}
/**
 * `at`을 감싸는 **콜백(`=> {…}`) 본문** — 괄호 짝으로 바깥쪽 블록을 하나씩 거슬러 올라가 `=>` 뒤의 블록을 찾는다
 * (`if (…) {`는 건너뛴다). 없으면 가장 안쪽 블록.
 */
function enclosingCallbackBody(src: string, at: number): string {
  let fallback: string | null = null;
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const close = closeOf(src, i, "{", "}");
      const body = src.slice(i + 1, close < 0 ? src.length : close);
      fallback ??= body;
      if (/=>\s*$/.test(src.slice(Math.max(0, i - 20), i))) return body;
    }
  }
  return fallback ?? src;
}

/**
 * 파일의 `router.push(…)`마다 withEmbed를 거치는가 — 인자에 바로 쓰거나, **그 push가 든 콜백 안에서** withEmbed로 만든
 * 변수를 넘긴다(sheet-client는 출결 배선 가드가 `router.push(href)` 모양을 잠가 변수로 넘긴다).
 */
function pushKeepsEmbed(src: string): { arg: string; ok: boolean }[] {
  const head = "router.push(";
  const out: { arg: string; ok: boolean }[] = [];
  for (let at = src.indexOf(head); at >= 0; at = src.indexOf(head, at + 1)) {
    const lp = at + head.length - 1;
    const arg = src.slice(lp + 1, closeOf(src, lp, "(", ")"));
    if (/\bwithEmbed\(/.test(arg)) {
      out.push({ arg, ok: true });
      continue;
    }
    const id = arg.trim();
    const body = enclosingCallbackBody(src, at);
    const ok =
      /^[A-Za-z_$][\w$]*$/.test(id) && new RegExp(`(?:const|let)\\s+${id}\\s*=[^;]*\\bwithEmbed\\(`).test(body);
    out.push({ arg, ok });
  }
  return out;
}

describe("자주 도는 창 안 이동은 처음부터 embed를 싣는다(키퍼는 안전망 — 리뷰 2026-09-11)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it.each([
    ["src/app/(shell)/attendance/_components/attendance-hub.tsx", "출석부 허브 강사 줄"],
    ["src/app/(shell)/attendance/_components/hub-student-search.tsx", "허브 학생 검색 결과"],
    ["src/app/(shell)/mcs/page.tsx", "MCS 목록 반 카드"],
  ])("%s(%s) — 맨 next/link 대신 EmbedLink", (file) => {
    const src = read(file);
    expect(src).toMatch(/<EmbedLink\b/);
    expect(src, "맨 Link는 창 안에서 embed를 지운다 — EmbedLink로").not.toMatch(/from "next\/link"/);
  });

  it.each([
    ["src/features/class-sheets/components/sheet-client.tsx", "ECS 주간 시트 navigate(반 선택·주 이동·면 전환)"],
    ["src/features/class-sheets/components/month-client.tsx", "ECS 월간 navigate"],
    ["src/features/class-sheets/components/month-day-editor.tsx", "월간 날짜 편집 → 주간 시트"],
  ])("%s(%s) — router.push가 withEmbed를 거친다", (file) => {
    const pushes = pushKeepsEmbed(read(file));
    expect(pushes.length).toBeGreaterThan(0);
    for (const { arg, ok } of pushes) expect(ok, `router.push(${arg}) — withEmbed를 거치지 않는다`).toBe(true);
  });

  it("🔴 변수로 넘기면 그 push가 든 콜백 안의 정의만 본다 — 다른 함수의 같은 이름 변수로는 통과 안 함", () => {
    const elsewhere = [
      "const a = () => { const href = withEmbed('/x'); go(href); };",
      "const b = async (raw) => { const href = raw; router.push(href); };",
    ].join("\n");
    expect(pushKeepsEmbed(elsewhere).map((p) => p.ok)).toEqual([false]);
    // 같은 콜백 안이면 `if` 블록 안의 push도 통과한다(정의는 콜백 본문에 있다).
    const inside = "const b = async (raw) => { const href = embed ? withEmbed(raw) : raw; if (x) { router.push(href); } };";
    expect(pushKeepsEmbed(inside).map((p) => p.ok)).toEqual([true]);
  });
});

describe("Next 계약 — 키퍼가 기대는 동작(Next를 올리면 여기부터 다시 확인)", () => {
  const NEXT = join(process.cwd(), "node_modules/next/dist/client/components");
  const read = (p: string) => readFileSync(join(NEXT, p), "utf8");
  /** `head`로 시작하는 함수의 인자 이름과 본문(인자 이름은 컴파일마다 달라질 수 있어 **읽어서** 쓴다). */
  function fn(src: string, head: string): { params: string[]; body: string } {
    const at = src.indexOf(head);
    if (at < 0) return { params: [], body: "" };
    const lp = src.indexOf("(", at);
    const rp = closeOf(src, lp, "(", ")");
    const lb = src.indexOf("{", rp);
    const rb = closeOf(src, lb, "{", "}");
    return {
      params: src.slice(lp + 1, rp).split(",").map((s) => s.trim()).filter(Boolean),
      body: rb < 0 ? "" : src.slice(lb + 1, rb),
    };
  }

  it("HistoryUpdater는 새 주소를 useInsertionEffect에서 적는다", () => {
    const { body } = fn(read("app-router.js"), "function HistoryUpdater(");
    expect(
      body,
      "Next 업그레이드: HistoryUpdater가 insertion effect에서 history를 쓰는지 확인 — 아니면 키퍼(useLayoutEffect)가 이전 칸 주소를 고칠 수 있다",
    ).toMatch(/^\s*\([^()]*\buseInsertionEffect\)\(/);
    expect(body, "Next 업그레이드: HistoryUpdater가 여전히 history.pushState/replaceState로 주소를 쓰는지 확인").toMatch(
      /window\.history\.replaceState\(/,
    );
  });

  it("history.replaceState 패치는 내부 표식(__NA) 없는 호출을 ACTION_RESTORE로 라우터에 알린다", () => {
    const app = read("app-router.js");
    const patch = fn(app, "window.history.replaceState = function replaceState(");
    const [data, , url] = patch.params;
    expect(patch.params, "Next 업그레이드: replaceState 패치가 없어졌는지 확인 — 없으면 키퍼가 라우터와 갈라진다").toHaveLength(3);
    expect(
      patch.body,
      "Next 업그레이드: 패치가 __NA 없는 호출만 라우터에 알리는지 확인 — 키퍼는 null 상태로 부른다",
    ).toMatch(new RegExp(`if \\(${data}\\?\\.__NA \\|\\| ${data}\\?\\._N\\)`));
    expect(patch.body, "Next 업그레이드: 패치가 새 주소를 라우터에 넘기는지 확인").toMatch(
      new RegExp(`applyUrlFromHistoryPushReplace\\(${url}\\)`),
    );
    expect(
      fn(app, "const applyUrlFromHistoryPushReplace").body,
      "Next 업그레이드: 넘기는 액션이 ACTION_RESTORE인지 확인",
    ).toMatch(/ACTION_RESTORE/);
  });

  it("복원은 canonicalUrl을 그 주소로 바꾼다", () => {
    const traverse = fn(read("segment-cache/navigation.js"), "function completeTraverseNavigation(");
    expect(
      traverse.body,
      "Next 업그레이드: completeTraverseNavigation이 canonicalUrl을 넘겨받은 주소로 정하는지 확인",
    ).toMatch(new RegExp(`canonicalUrl:\\s*\\([^()]*createHrefFromUrl\\)\\(${traverse.params[1]}\\)`));
    const restore = fn(read("router-reducer/reducers/restore-reducer.js"), "function restoreReducer(");
    const [state, action] = restore.params;
    const restored = new RegExp(`const (\\w+) = ${action}\\.url;`).exec(restore.body)?.[1];
    expect(restored, "Next 업그레이드: 복원이 액션의 주소를 읽는지 확인").toBeTruthy();
    expect(
      restore.body,
      "Next 업그레이드: 복원이 그 주소로 completeTraverseNavigation을 부르는지 확인",
    ).toMatch(new RegExp(`completeTraverseNavigation\\)\\(${state},\\s*${restored}\\b`));
  });

  it("refresh는 canonicalUrl로 공유 레이아웃까지 다시 받는다(그래서 canonicalUrl에 embed가 있어야 한다)", () => {
    const src = read("router-reducer/reducers/refresh-reducer.js");
    expect(
      fn(src, "function refreshReducer(").body,
      "Next 업그레이드: refresh가 여전히 레이아웃까지 다시 받는지(RefreshAll) 확인",
    ).toMatch(/RefreshAll/);
    const dyn = fn(src, "function refreshDynamicData(");
    expect(dyn.body, "Next 업그레이드: refresh가 canonicalUrl로 요청하는지 확인").toMatch(
      new RegExp(`${dyn.params[0]}\\.canonicalUrl`),
    );
  });
});

describe("배선 — 키퍼는 (shell)/layout의 embed 갈래에만 선다", () => {
  const layout = readFileSync(join(process.cwd(), "src/app/(shell)/layout.tsx"), "utf8");

  it("🔴 embed 갈래 안에 한 번(최상위 풀 셸엔 없다)", () => {
    const start = layout.indexOf("if (embed) {");
    const end = layout.indexOf("getActivePopups(");
    const at = layout.indexOf("<EmbedUrlKeeper");
    expect(start).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(end);
    expect(layout.indexOf("<EmbedUrlKeeper", at + 1)).toBe(-1);
  });
});
