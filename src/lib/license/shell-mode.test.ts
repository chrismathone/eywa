import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  devShellModeOverride,
  flagsFromMode,
  isShellMode,
  modeFromFlags,
  resolveShellMode,
  shellModeFromLicenses,
  shellModeInfoFromLicenses,
  SHELL_MODES,
  SHELL_MODE_LABEL,
} from "./shell-mode";

describe("지점 화면 방식 판정(셋)", () => {
  it("행이 없으면(창 모드 켜짐 · 유지 꺼짐) 창 모드 — 기존 지점이 그대로다", () => {
    expect(modeFromFlags({ windowMode: true, keepalive: false })).toBe("windows");
  });

  it("창 모드가 켜져 있고 이전 화면 유지를 명시로 켠 지점만 keepalive", () => {
    expect(modeFromFlags({ windowMode: true, keepalive: true })).toBe("keepalive");
  });

  it("창 모드를 끈 지점은 keepalive 값과 무관하게 단일 화면 — 기존 '꺼짐'의 뜻이 안 바뀐다", () => {
    expect(modeFromFlags({ windowMode: false, keepalive: false })).toBe("single");
    expect(modeFromFlags({ windowMode: false, keepalive: true })).toBe("single");
  });

  it("방식 → 저장값 → 방식 왕복이 항상 같다(두 행을 늘 함께 쓴다)", () => {
    for (const m of SHELL_MODES) expect(modeFromFlags(flagsFromMode(m))).toBe(m);
    expect(flagsFromMode("windows")).toEqual({ windowMode: true, keepalive: false });
    expect(flagsFromMode("keepalive")).toEqual({ windowMode: true, keepalive: true });
    expect(flagsFromMode("single")).toEqual({ windowMode: false, keepalive: false });
  });

  it("라벨은 원장이 정한 이름 그대로", () => {
    expect(SHELL_MODE_LABEL).toEqual({
      windows: "창 모드",
      keepalive: "단일 화면(이전 화면 유지)",
      single: "단일 화면",
    });
    expect(isShellMode("keepalive")).toBe(true);
    expect(isShellMode("nope")).toBe(false);
    expect(isShellMode(undefined)).toBe(false);
  });
});

describe("개발 전용 덮어쓰기", () => {
  it("개발 환경에선 값이 먹는다", () => {
    expect(devShellModeOverride("keepalive", "development")).toBe("keepalive");
    expect(devShellModeOverride("single", undefined)).toBe("single");
    expect(devShellModeOverride("windows", "test")).toBe("windows");
  });

  it("🔴 운영 빌드(production)에선 무조건 무시 — 실수로 걸려도 지점 화면이 안 바뀐다", () => {
    for (const v of ["keepalive", "windows", "single"]) expect(devShellModeOverride(v, "production")).toBeNull();
    expect(
      shellModeFromLicenses(
        { window_mode: true, window_keepalive: false },
        { override: "keepalive", nodeEnv: "production" },
      ),
    ).toBe("windows");
  });

  it("모르는 값·빈 값은 무시", () => {
    expect(devShellModeOverride("", "development")).toBeNull();
    expect(devShellModeOverride("full", "development")).toBeNull();
    expect(devShellModeOverride(undefined, "development")).toBeNull();
  });

  it("덮어쓰기가 있으면 라이선스 판정을 이긴다(개발에서만)", () => {
    expect(resolveShellMode({ windowMode: false, keepalive: false }, "keepalive")).toBe("keepalive");
    expect(
      shellModeFromLicenses({ window_mode: true, window_keepalive: false }, { override: "keepalive", nodeEnv: "development" }),
    ).toBe("keepalive");
  });

  it("환경변수는 레이아웃 한 곳에서만 읽는다(운영 판정과 갈라지지 않게)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = join(dir, n);
        if (statSync(f).isDirectory()) return walk(f);
        return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [f] : [];
      });
    const readers = walk(join(process.cwd(), "src"))
      .filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_DEV_WINDOW_MODE_OVERRIDE"))
      .map((f) => f.replaceAll("\\", "/").split("/src/")[1])
      .filter((p) => !p.endsWith("shell-mode.ts")); // 이 모듈은 설명 주석에만 이름이 나온다
    expect(readers).toEqual(["app/(shell)/layout.tsx"]);
  }, 60_000); // 전수 스캔 가드 — 전체 스위트에선 느려진다(기억: 전수 스캔 it은 60초)
});

describe("방식의 판(epoch) — 바꿨다 되돌린 전환도 초기화되게", () => {
  const flags = { window_mode: true, window_keepalive: true };
  const env = { override: undefined, nodeEnv: "production" };

  it("DB 판을 그대로 싣는다(행이 없으면 none)", () => {
    expect(shellModeInfoFromLicenses({ flags, windowModeEpoch: "2026-10-01T00:00:00+00:00" }, env)).toEqual({
      mode: "keepalive",
      epoch: "2026-10-01T00:00:00+00:00",
    });
    expect(shellModeInfoFromLicenses({ flags: { window_mode: true, window_keepalive: false }, windowModeEpoch: "none" }, env)).toEqual({
      mode: "windows",
      epoch: "none",
    });
  });

  it("조회 실패(판 null)는 모름 그대로 — 그 값으로 아무도 초기화하지 않는다", () => {
    expect(shellModeInfoFromLicenses({ flags, windowModeEpoch: null }, env).epoch).toBeNull();
  });

  it("단일 화면 강제(읽기 전용 지점 보기)는 지점 설정·개발 덮어쓰기보다 먼저다 — 판은 비워 창 배치를 초기화하지 않는다", () => {
    const windowsOn = { flags: { window_mode: true, window_keepalive: true }, windowModeEpoch: "2026-10-01T00:00:00+00:00" };
    expect(shellModeInfoFromLicenses(windowsOn, { ...env, forceSingle: true })).toEqual({ mode: "single", epoch: null });
    expect(shellModeInfoFromLicenses(windowsOn, { override: "windows", nodeEnv: "development", forceSingle: true })).toEqual({ mode: "single", epoch: null });
    // 끄면 종전 그대로다.
    expect(shellModeInfoFromLicenses(windowsOn, { ...env, forceSingle: false })).toEqual(shellModeInfoFromLicenses(windowsOn, env));
  });

  it("개발 덮어쓰기는 DB 판과 따로 센다(덮어쓰기를 켜고 끄는 것도 전환이다) — 운영 빌드에선 DB 그대로", () => {
    expect(
      shellModeInfoFromLicenses({ flags: { window_mode: false, window_keepalive: false }, windowModeEpoch: "x" }, {
        override: "keepalive",
        nodeEnv: "development",
      }),
    ).toEqual({ mode: "keepalive", epoch: "dev:keepalive" });
    expect(
      shellModeInfoFromLicenses({ flags: { window_mode: false, window_keepalive: false }, windowModeEpoch: "x" }, {
        override: "keepalive",
        nodeEnv: "production",
      }),
    ).toEqual({ mode: "single", epoch: "x" });
  });
});

describe("라이선스 조회 배선", () => {
  const server = readFileSync(join(process.cwd(), "src/lib/license/server.ts"), "utf8");

  it("window_keepalive는 명시로 켠 행만 true(기본 꺼짐) — 다른 넷(행 없음 = 켜짐)과 기본값이 반대다", () => {
    expect(server).toContain("window_keepalive: false, laboratory: false };"); // ALL_ON
    expect(server).toMatch(/out\.window_keepalive = licenseExplicitlyOn\(r\)/);
    expect(server).toContain('["tenant-license-flags-v4", tenantId]'); // 실험실 플래그가 추가되어 이전 캐시와 구분한다
  });

  it("판은 방식 행 둘(window_mode·window_keepalive)의 updated_at에서만 — 다른 기능을 켜고 꺼도 창 배치가 초기화되지 않는다", () => {
    expect(server).toContain('const WINDOW_MODE_ROWS: readonly string[] = ["window_mode", WINDOW_KEEPALIVE_FEATURE];');
    expect(server).toContain('.select("feature, is_active, expires_at, updated_at")');
    expect(server).toMatch(/if \(WINDOW_MODE_ROWS\.includes\(r\.feature\) && r\.updated_at/);
    // 실패 = 표는 켜짐(fail-open) · 판은 모름(null)
    expect(server).toContain("return { flags: ALL_ON, windowModeEpoch: null };");
  });
});
