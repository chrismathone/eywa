import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 스켈레톤 짝 가드(2026-11-05 2차 전수 검수 — 52개 중 47개가 다시 어긋났다).
 * 원인 둘을 잠근다.
 * ① 공용 부품(면 탭·요약 띠·숫자 카드)을 **손으로 베낀** 스켈레톤 — 부품이 바뀌어도 따라오지 않았다(면 탭이 09-11에 폭 전체
 *    밑줄이 됐는데 상자를 계속 그림 · 09-11 요약 띠 전환 뒤에도 떨어진 카드 5장). → 화면이 그 부품을 그리면 덮는 스켈레톤은
 *    **짝 스켈레톤**(`FaceTabsSkeleton`·`StatStripSkeleton`·`BigStatSkeleton`)을 쓴다.
 * ② **하위 화면이 부모 스켈레톤을 받는다**(Next: 자기 loading.tsx가 없으면 가장 가까운 조상 것) — 보강 상세·회의록 새로 만들기 등
 *    모양이 전혀 다른 화면에 목록 스켈레톤이 떴다. → 부모 스켈레톤이 덮는 하위 화면을 아래 목록으로 잠근다. 새 하위 화면이
 *    생기면 이 시험이 실패한다 — 자기 loading.tsx를 두거나, 모양이 같다는 사유와 함께 목록에 올릴 것.
 */
const ROOT = process.cwd();
const APP = join(ROOT, "src", "app");
const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}
const files = walk(APP);
const loadingDirs = new Set(files.filter((f) => /[\\/]loading\.tsx$/.test(f)).map((f) => dirname(f)));
const pages = files.filter((f) => /[\\/]page\.tsx$/.test(f));

/** 이 page를 덮는 스켈레톤 폴더 — 같은 폴더부터 위로 처음 만나는 loading.tsx(앱 루트까지). */
function coveringLoadingDir(page: string): string | null {
  let d = dirname(page);
  while (d.length >= APP.length) {
    if (loadingDirs.has(d)) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/** page.tsx와 그 파일이 직접 import한 로컬 컴포넌트(상대 경로·`@/app`·`@/features`)의 원문 — page-maximize-wiring 가드와 같은 범위. */
function pageAndDirectImports(page: string): string {
  const src = read(page);
  const parts = [src];
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+|@\/(?:app|features)\/[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dirname(page), spec);
    for (const f of [`${base}.tsx`, join(base, "index.tsx")]) if (existsSync(f)) parts.push(read(f));
  }
  return parts.join("\n");
}

const appRel = (dir: string) => relative(APP, dir).replaceAll("\\", "/");

/** 리다이렉트만 하는 화면 — 자기 모양이 없으니 어느 스켈레톤을 받아도 상관없다(①·② 모두 건너뛴다). */
function redirectOnly(page: string): boolean {
  const own = read(page);
  return /redirect\(/.test(own) && !/return\s*\(?\s*</.test(own);
}

describe("① 공용 부품을 그리는 화면의 스켈레톤은 짝 스켈레톤을 쓴다", () => {
  /**
   * [실물 태그, 짝 스켈레톤 이름] — 스켈레톤이 짝을 직접 쓰거나 짝을 쓰는 공용 스켈레톤 컴포넌트를 import하면 된다.
   * 🔴 짝은 **JSX로 그렸는지**(`<FaceTabsSkeleton …`)로 본다 — 이름 문자열로 보면 `PageHeaderSkeleton`(page-header.tsx) 문서 주석에
   *    적힌 짝 이름 때문에 거의 모든 스켈레톤이 저절로 통과했다(2026-11-05 재리뷰).
   */
  const PAIRS: [RegExp, string][] = [
    [/<FaceTabs[\s>/]/, "FaceTabsSkeleton"],
    [/<StatStrip[\s>/]/, "StatStripSkeleton"],
    [/<BigStat[\s>/]/, "BigStatSkeleton"],
  ];
  const drawsPair = (skel: string, pair: string) => new RegExp(`<${pair}[\\s/>]`).test(skel);
  /**
   * 예외 — 실물 부품이 **흔한 첫 화면엔 안 서는** 경우(조건부·특정 면에서만)라 스켈레톤이 그리면 오히려 튄다. 사유를 적는다.
   * 키 = `<스켈레톤 폴더(app 기준)>:<짝 이름>`.
   */
  const EXEMPT: Record<string, string> = {
    "(shell)/attendance/live:BigStatSkeleton":
      "숫자 카드는 '지난 기록' 면(`?tab=recap`, recap-view.tsx)에만 선다 — 첫 화면(사무실·오늘 좌석표)엔 없다",
  };

  /** 스켈레톤 원문 + 그것이 직접 import한 로컬 스켈레톤 컴포넌트(…skeleton 파일) 원문. */
  function loadingSource(dir: string): string {
    const f = join(dir, "loading.tsx");
    const src = read(f);
    const parts = [src];
    for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+|@\/(?:app|features|components)\/[^"]+)"/g)) {
      const spec = m[1];
      const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : resolve(dir, spec);
      for (const g of [`${base}.tsx`, join(base, "index.tsx")]) if (existsSync(g)) parts.push(read(g));
    }
    return parts.join("\n");
  }

  it("짝 스켈레톤을 빠뜨린 스켈레톤이 없다", () => {
    const misses: string[] = [];
    const usedExempt = new Set<string>();
    let checked = 0;
    for (const page of pages) {
      if (redirectOnly(page)) continue;
      const dir = coveringLoadingDir(page);
      if (!dir) continue;
      const drawn = pageAndDirectImports(page);
      const skel = loadingSource(dir);
      for (const [tag, pair] of PAIRS) {
        if (!tag.test(drawn)) continue;
        checked++;
        const key = `${appRel(dir)}:${pair}`;
        if (EXEMPT[key]) {
          usedExempt.add(key);
          continue;
        }
        if (!drawsPair(skel, pair)) misses.push(`${rel(page)} → ${appRel(dir)}/loading.tsx에 <${pair}> 없음`);
      }
    }
    // 스캐너가 빈 목록으로 통과하지 않게(정규식·경로가 어긋나면 0쌍이 된다) — 2026-11-05 기준 21쌍.
    expect(checked).toBeGreaterThan(10);
    expect([...new Set(misses)]).toEqual([]);
    // 쓰이지 않는 예외는 걷는다(화면이 바뀌어 짝이 필요 없어졌거나 스켈레톤이 짝을 그리게 됐다).
    expect(Object.keys(EXEMPT).filter((k) => !usedExempt.has(k))).toEqual([]);
  });
});

describe("② 부모 스켈레톤을 받는 하위 화면은 목록으로 잠근다", () => {
  /**
   * 키 = 스켈레톤 폴더(app 기준) · 값 = 그 스켈레톤을 **자기 것처럼 받아도 되는** 하위 화면(폴더 기준 상대 경로)과 사유.
   * 여기 없는 하위 화면이 생기면 실패한다 — 자기 loading.tsx를 두거나, 모양이 같다는 사유와 함께 올린다.
   */
  const ALLOWED: Record<string, Record<string, string>> = {};

  it("목록 밖 하위 화면이 부모 스켈레톤을 받지 않는다", () => {
    // 스캐너가 빈 목록으로 통과하지 않게 — 2026-11-05 기준 page 191 · loading 69.
    expect(pages.length).toBeGreaterThan(100);
    expect(loadingDirs.size).toBeGreaterThan(40);
    const strays: string[] = [];
    for (const page of pages) {
      const dir = coveringLoadingDir(page);
      if (!dir) continue;
      const sub = relative(dir, dirname(page)).replaceAll("\\", "/");
      if (!sub) continue; // 자기 폴더의 page
      if (redirectOnly(page)) continue;
      if (ALLOWED[appRel(dir)]?.[sub]) continue;
      strays.push(`${appRel(dir)} ⊃ ${sub}`);
    }
    expect(strays).toEqual([]);
  });

  it("목록에 남은 항목은 실제로 있는 하위 화면이다(지운 화면을 목록에서도 걷는다)", () => {
    for (const [dir, subs] of Object.entries(ALLOWED)) {
      for (const sub of Object.keys(subs)) {
        expect(existsSync(join(APP, dir, sub, "page.tsx")), `${dir} ⊃ ${sub}`).toBe(true);
        expect(existsSync(join(APP, dir, "loading.tsx")), `${dir}/loading.tsx`).toBe(true);
      }
    }
  });
});
