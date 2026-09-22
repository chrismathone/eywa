/**
 * 옛 호스트 → 새 도메인 영구 리다이렉트(경로·쿼리 보존) — `next.config.ts`의 `redirects()`가 부른다.
 *
 * 왜 코드에 두나(원장 2026-09-18 *"아직 도메인 구매 준비중이므로 적용은 미룰 것. 대신 완벽하게 구현해 놓는 것 —
 * 구매만 하고 바로 쓰게"*): 기기에 **이미 붙여 둔 자산 QR 라벨**(`/inventory/asset/<code>`)·학부모에게 나간 공유 링크
 * (`/r/<token>`)·QR 접수 안내(`/intake/<token>`)가 전부 `eywa-alpha.vercel.app`을 가리킨다. 도메인을 옮기는 날
 * 옛 호스트가 새 호스트로 **같은 경로**를 돌려줘야 그 인쇄물이 산다. Vercel은 `.vercel.app` 별칭을 계속 서빙하지만
 * 새 도메인으로 **저절로 보내 주지는 않는다**.
 *
 * 켜는 법 = env 둘(구매 뒤 Vercel에 넣고 재배포 — env는 배포 시점 스냅샷이라 넣기만 하면 안 바뀐다):
 *   NEXT_PUBLIC_APP_URL=https://<새 도메인>   (이미 쓰는 값 — 전사 콜백·QR·공유 링크의 기준 주소)
 *   LEGACY_REDIRECT_HOSTS=eywa-alpha.vercel.app  (쉼표로 여러 개)
 * 둘 중 하나라도 비면 리다이렉트 0개 = 지금과 같다(도메인 구매 전엔 아무 일도 안 일어난다).
 *
 * 🔴 `/api/*`는 **보내지 않는다** — AssemblyAI 전사 웹훅(POST)·크론·ClassNote/makeedu 워커의 내부 API가 옛 호스트로
 *    들어와도 그 자리에서 처리돼야 한다(진행 중이던 전사는 제출 당시 콜백 URL = 옛 호스트다. 308로 튕기면 콜백을
 *    따라오지 않는 클라이언트에서 행이 `transcribing`에 영구 정지한다 — `app-url.ts`가 막았던 바로 그 사고).
 *    정적 자원(`_next/*`·이미지)은 새 배포가 어차피 새 호스트에서 내려주므로 옛 호스트에서 페이지가 안 열리면 그만이다.
 * 🔴 새 호스트 자신을 옛 호스트에 적지 말 것 — 무한 리다이렉트. `buildLegacyHostRedirects`가 같은 호스트는 건너뛴다.
 */
export type LegacyRedirect = {
  source: string;
  has: { type: "host"; value: string }[];
  destination: string;
  permanent: boolean;
};

export function parseHostList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((h) => h.length > 0);
}

/** `NEXT_PUBLIC_APP_URL`에서 호스트만(비교용). 비었거나 URL이 아니면 null. */
export function canonicalHostOf(appUrl: string | undefined | null): string | null {
  const v = appUrl?.trim();
  if (!v) return null;
  try {
    return new URL(v).host.toLowerCase();
  } catch {
    return null;
  }
}

export function buildLegacyHostRedirects(env: {
  NEXT_PUBLIC_APP_URL?: string;
  LEGACY_REDIRECT_HOSTS?: string;
}): LegacyRedirect[] {
  const canonical = canonicalHostOf(env.NEXT_PUBLIC_APP_URL);
  const base = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!canonical || !base) return [];
  const out: LegacyRedirect[] = [];
  for (const host of parseHostList(env.LEGACY_REDIRECT_HOSTS)) {
    if (host === canonical) continue; // 자기 자신으로 보내면 무한 루프
    // `has.value`는 Next·Vercel 모두 **정규식**으로 본다(`^value$`) — `.`을 그대로 두면 `eywa-alphaXvercelXapp`도 맞는다.
    const has: LegacyRedirect["has"] = [{ type: "host", value: host.replace(/\./g, "\\.") }];
    // 루트와 나머지 경로를 따로 — path-to-regexp의 파라미터 정규식은 빈 문자열을 안 받는다.
    out.push({ source: "/", has, destination: `${base}/`, permanent: true });
    // `(?!api/)` = /api/* 제외(위 주석). 쿼리 문자열은 Next가 기본으로 그대로 넘긴다.
    out.push({ source: "/:path((?!api/).+)", has, destination: `${base}/:path`, permanent: true });
  }
  return out;
}
