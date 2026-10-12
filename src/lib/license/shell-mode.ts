/**
 * 지점 **화면 방식**(셋) 판정 — 순수 모듈(서버·클라·테스트 공용, `server-only` 금지 [[#61]]).
 *
 * 원장 2026-10-01 *"창 모드를 꺼도 이전 페이지를 다시 열면 이전 화면이 저장돼서 다시 볼 수 있게 가능한가? admin에서"*
 * → 세 번째 방식을 **확장으로** 더했다(기존 저장값의 뜻은 그대로):
 *   · `windows`   = 창 모드(메뉴마다 플로팅 창) — 슈퍼관리자 `window_mode` 켜짐(기본) ∧ `window_keepalive` 없음/꺼짐
 *   · `keepalive` = 단일 화면(이전 화면 유지) — `window_mode` 켜짐 ∧ `window_keepalive` **명시로 켬**
 *   · `single`    = 단일 화면 — `window_mode` 꺼짐(키프얼라이브 값은 무시)
 * 🔴 저장 형식을 안 바꿨다 — `window_mode`(기존 행)는 그대로 "창 엔진을 쓰나", 새 행 `window_keepalive`(기본 꺼짐, opt-in)가
 *    "그 엔진을 한 화면씩 쓰나". 새 행이 없으면(= SQL·마이그레이션 0) 지금까지와 똑같이 동작한다.
 */
export type ShellMode = "windows" | "keepalive" | "single";

export const SHELL_MODES: readonly ShellMode[] = ["windows", "keepalive", "single"];

export const SHELL_MODE_LABEL: Record<ShellMode, string> = {
  windows: "창 모드",
  keepalive: "단일 화면(이전 화면 유지)",
  single: "단일 화면",
};

/** 라이선스 두 행 → 방식. `windowMode`는 행 없음 = 켜짐(`licenseAllows`), `keepalive`는 행 없음 = 꺼짐(`licenseExplicitlyOn`). */
export function modeFromFlags(flags: { windowMode: boolean; keepalive: boolean }): ShellMode {
  if (!flags.windowMode) return "single";
  return flags.keepalive ? "keepalive" : "windows";
}

/** 방식 → 저장할 두 값(슈퍼관리자 카드가 한 번에 쓴다). 항상 두 행을 함께 쓴다 — 반쪽만 남아 뜻이 갈리지 않게. */
export function flagsFromMode(mode: ShellMode): { windowMode: boolean; keepalive: boolean } {
  return { windowMode: mode !== "single", keepalive: mode === "keepalive" };
}

export function isShellMode(v: unknown): v is ShellMode {
  return typeof v === "string" && (SHELL_MODES as readonly string[]).includes(v);
}

/**
 * **개발 전용** 덮어쓰기(`NEXT_PUBLIC_DEV_WINDOW_MODE_OVERRIDE=keepalive|windows|single`) — 운영 DB의 지점 방식을 건드리지 않고
 * 개발 서버에서만 새 방식을 보려는 길이다. 🔴 **운영 빌드(NODE_ENV=production)에선 무조건 무시**한다(Vercel에 실수로 걸려도
 * 지점 화면이 바뀌지 않는다) — 가드 `shell-mode.test.ts`.
 */
export function devShellModeOverride(raw: string | undefined, nodeEnv: string | undefined): ShellMode | null {
  if (nodeEnv === "production") return null;
  return isShellMode(raw) ? raw : null;
}

export function resolveShellMode(
  flags: { windowMode: boolean; keepalive: boolean },
  override: ShellMode | null = null,
): ShellMode {
  return override ?? modeFromFlags(flags);
}

/** 지점 라이선스 표(`getLicenseFlags`) + 환경 → 방식 — 레이아웃이 한 번 부른다(개발 덮어쓰기는 운영 빌드에서 무시). */
export function shellModeFromLicenses(
  l: { window_mode: boolean; window_keepalive: boolean },
  env: { override: string | undefined; nodeEnv: string | undefined },
): ShellMode {
  return resolveShellMode(
    { windowMode: l.window_mode, keepalive: l.window_keepalive },
    devShellModeOverride(env.override, env.nodeEnv),
  );
}

/**
 * 방식 + **판(epoch)** — 판 = 그 지점의 방식 행(`window_mode`·`window_keepalive`)이 마지막으로 바뀐 시각(`updated_at`, 행이 없으면
 * `"none"`). 브라우저에 쌓인 창 배치는 이 둘과 함께 저장되고, 둘 중 하나라도 다르면 **전부 닫고 빈 상태로** 시작한다
 * (원장 2026-10-01 *"창모드 전환 시에 이전의 창 모드들은 모두 종료시킨 채로 초기화 상태로"*).
 * 🔑 판까지 보는 이유: 창 모드 → 단일 화면 → 창 모드처럼 **바꿨다가 되돌린 사이** 접속하지 않은 사람은 방식만 비교하면
 *    '같은 방식'이라 옛 창이 그대로 살아난다. 판이 다르면 그 사이 전환이 있었다는 뜻이다.
 * `epoch: null` = **모른다**(라이선스 조회 실패 — 그 요청은 fail-open으로 창 모드가 된다). 모르는 판으로는 초기화하지 않는다
 * (일시 장애 한 번에 모든 사람의 유지 화면이 지워지면 안 된다 — 캔버스가 이때는 방식도 채택하지 않는다).
 */
export type ShellModeInfo = { mode: ShellMode; epoch: string | null };

/**
 * 부모 셸이 **이 문서에서 쓰는 방식**을 화면(iframe) 문서에 알리는 쿠키 — 셸 공급자(`ShellModeProvider`)가 처음 그릴 때 적고,
 * 레이아웃의 창 문서 갈래가 읽어 화면 모양(단일 화면 모양 vs 창 모양)을 **부모와 같게** 정한다.
 * 🔑 왜 서버 판정(DB)이 아니라 이것인가: 부모는 문서를 연 순간의 방식을 끝까지 쓴다(쓰던 화면이 도중에 갈아엎히지 않게) — 그 사이 슈퍼관리자가
 *    방식을 바꾸거나 라이선스 조회가 한 번 실패하면(fail-open) 새로 여는 화면만 다른 모양이 되어 사이드바 밑에 깔리거나 창 모양이 섞였다(적대 리뷰).
 *    표시 전용이다 — 권한·데이터와 무관하다(사용자가 바꿔도 자기 화면 모양만 바뀐다).
 * ⚠️ 서버가 import한다 — `"use client"` 모듈에 두지 말 것([[#81]]).
 */
export const SHELL_MODE_COOKIE = "eywa-shell-mode";

export function shellModeInfoFromLicenses(
  snapshot: { flags: { window_mode: boolean; window_keepalive: boolean }; windowModeEpoch: string | null },
  env: {
    override: string | undefined;
    nodeEnv: string | undefined;
    /**
     * 지점 설정과 무관하게 **단일 화면**으로 연다 — 운영 콘솔의 '지점 보기'(읽기 전용)가 쓴다. 창(iframe)마다 셸이 따로 돌면
     * 보기 상태가 창마다 갈릴 수 있어서다. 판은 `null`(모른다)로 둔다: 그 문서는 브라우저의 화면 방식 쿠키를 적지 않고
     * 저장된 창 배치도 초기화하지 않는다 — 운영자가 본인 지점에서 쓰던 창 배치가 보기 때문에 지워지면 안 된다.
     */
    forceSingle?: boolean;
  },
): ShellModeInfo {
  if (env.forceSingle) return { mode: "single", epoch: null };
  const override = devShellModeOverride(env.override, env.nodeEnv);
  // 개발 덮어쓰기는 DB 판과 따로 센다 — 덮어쓰기를 켜고 끄는 것도 방식 전환이다(판이 갈려 초기화된다).
  if (override) return { mode: override, epoch: `dev:${override}` };
  return { mode: shellModeFromLicenses(snapshot.flags, env), epoch: snapshot.windowModeEpoch };
}
