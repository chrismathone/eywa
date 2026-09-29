import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 창 모드 가드 — 지점 설정으로 창 모드를 끈 지점(원장 2026-09-25 *"iframe 모드를 켜고 끌수 잇게 … 지점별 세팅 · admin에서
 * 토글가능하게"*)에서 **창이 새어 나오지 않게**, 창을 여는 코드는 전부 창 모드 판정(`useWindowMode`/`useWorkspaceEnabled`)을
 * 거쳐야 한다. `useIsDesktop()`만 보고 창을 열면 그 지점에서도 창이 뜬다.
 */
const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return walk(f);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [f] : [];
  });
const FILES = walk(join(ROOT, "src")).map((f) => ({
  path: relative(ROOT, f).replaceAll("\\", "/"),
  src: readFileSync(f, "utf8"),
}));

/** 창 시스템 내부 — 캔버스 안에서만 돌거나(캔버스가 창 모드일 때만 뜬다) 정의 자체인 파일. */
const INTERNAL = new Set([
  "src/components/workspace/window-store.ts",
  "src/components/workspace/open-menu-window.ts",
  "src/components/workspace/workspace-canvas.tsx",
  "src/components/workspace/window-content.tsx",
  "src/components/workspace/deep-link-window.ts", // 캔버스가 enabled를 넘긴다
  "src/components/workspace/use-show-desktop.ts", // 훅 정의(부르는 쪽이 창 모드를 확인한다)
]);

const OPENS_WINDOW =
  /openMenuWindow\(|getState\(\)\.open\(|getState\(\)\.openNewInstance\(|\bopenWindow\(|s\s*=>\s*s\.open\b|s\.open\)|useShowDesktop\(\)/;
const CHECKS_MODE = /useWindowMode\(\)|useWorkspaceEnabled\(\)/;

describe("창 모드 가드", () => {
  it("창을 여는 화면 코드는 전부 창 모드를 확인한다", () => {
    const offenders = FILES.filter(
      (f) => !INTERNAL.has(f.path) && OPENS_WINDOW.test(f.src) && !CHECKS_MODE.test(f.src),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("관리자 풀셸은 지점 설정(window_mode)으로 워크스페이스를 켜고 끈다", () => {
    const layout = FILES.find((f) => f.path === "src/app/(shell)/layout.tsx")!.src;
    // 연결 앱 조회와 함께 기다린다(Promise.all) — 이름(windowMode)과 판정 호출만 잠근다.
    // 라이선스 넷은 한 조회(getLicenseFlags)로 받아 창 모드도 그 결과를 쓴다(2026-09-30).
    expect(layout).toMatch(/const licensesPromise = getLicenseFlags\(user\.tenantId\)/);
    expect(layout).toMatch(/const \[windowMode[,\s\w]*\] = await Promise\.all\(\[\s*licensesPromise\.then\(\(l\) => l\.window_mode\)/);
    expect(layout).toContain("<WorkspaceEnabledProvider enabled={windowMode}>");
    // 강사·학생 미니셸은 지금처럼 창 없음 고정.
    expect(layout).toContain("<WorkspaceEnabledProvider enabled={false}>");
  });

  it("캔버스는 창 모드일 때만 뜬다", () => {
    const canvas = FILES.find((f) => f.path === "src/components/workspace/workspace-canvas.tsx")!.src;
    expect(canvas).toMatch(/const isDesktop = useWindowMode\(\);/);
  });
});
