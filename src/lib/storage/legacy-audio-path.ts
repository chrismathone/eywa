// 오디오 경로 판별 — **순수**(server-only 없음 → Vitest 대상). IO(GCS/Supabase 서명)는 legacy-audio.ts.
// tenant 경로(신규 Supabase 업로드) vs 레거시 Firebase 경로(옛 ijw 녹음)를 분류한다.

export type AudioKind = "meeting" | "consultation" | "registration";

/** 레거시(ijw Firebase Storage) 폴더 prefix — kind별 한정(교차 kind 접근 차단). */
export const LEGACY_PREFIX_BY_KIND: Record<AudioKind, string> = {
  meeting: "meeting-recordings/",
  consultation: "consultation-recordings/",
  registration: "registration-recordings/",
};

/** 신규(eywa Supabase) 버킷 — 등록상담 신규 녹음은 consultation-recordings 버킷을 공유. */
export const SUPABASE_BUCKET_BY_KIND: Record<AudioKind, string> = {
  meeting: "meeting-recordings",
  consultation: "consultation-recordings",
  registration: "consultation-recordings",
};

/**
 * 업로드 오디오 경로가 "이 테넌트의 단일 객체키"인지 검증 — `{tenantId}/{파일명}` 한 세그먼트만 허용.
 * (구 audio-path.ts에서 이전 — 순수화해 Vitest 가능. audio-path.ts는 이 함수를 re-export.)
 * 슬래시·상위경로·이상문자를 차단. 실제 업로드는 `{uuid}.{ext}` 꼴이라 이 패턴을 만족.
 */
export function isTenantAudioPath(path: string, tenantId: string): boolean {
  const prefix = `${tenantId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(rest);
}

/**
 * 파일명(경로의 마지막 세그먼트)이 안전한가 — 빈값·선행점·`..`·슬래시·역슬래시·제어문자 차단 + 확장자 필수.
 * ⚠️ tenant validator의 ASCII 전용 regex와 달리 **한글 등 Unicode 파일명 허용**
 * (레거시 예: `고등관회의_2026-04-17_….webm`).
 */
function isSafeFilename(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  if (name.includes("..")) return false;
  // 슬래시·역슬래시·제어문자(코드 0x1f 이하) 차단.
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === "/" || ch === "\\" || name.charCodeAt(i) <= 0x1f) return false;
  }
  return /\.[A-Za-z0-9]+$/.test(name); // 확장자 필수
}

/**
 * 레거시 Firebase 경로(`{kind prefix}{안전 파일명}`, 정확히 2세그먼트)인지. kind별 prefix로 한정해
 * meeting 재처리가 registration 객체를 서명하는 식의 교차접근을 차단.
 */
export function isLegacyFirebasePath(path: string, kind: AudioKind): boolean {
  const prefix = LEGACY_PREFIX_BY_KIND[kind];
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return isSafeFilename(name);
}

export type AudioPathClass = "tenant" | "legacy" | "invalid";

/** 경로 분류: tenant(신규 Supabase) / legacy(옛 Firebase) / invalid. */
export function classifyAudioPath(
  path: string,
  kind: AudioKind,
  tenantId: string,
): AudioPathClass {
  if (isTenantAudioPath(path, tenantId)) return "tenant";
  if (isLegacyFirebasePath(path, kind)) return "legacy";
  return "invalid";
}

// ── 이미지/파일 tenant 경로(스토리지 추상화 공용) — 오디오와 동일하게 server-only 없는 순수함수 ──

/**
 * 영수증 경로 `{tenantId}/{expenseId}/{파일명}` (정확히 2세그먼트). expenseId는 ASCII 식별자.
 * (expense-actions의 동명 함수를 단일 소스화 — Phase B에서 그쪽이 이 함수로 통일.)
 */
export function isTenantReceiptPath(path: string, tenantId: string): boolean {
  const prefix = `${tenantId}/`;
  if (!path.startsWith(prefix)) return false;
  const parts = path.slice(prefix.length).split("/");
  if (parts.length !== 2) return false;
  return (
    /^[A-Za-z0-9._-]+$/.test(parts[0]) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(parts[1])
  );
}

/** 브랜딩(로고/직인) 경로 `{tenantId}/branding/{파일명}`. */
export function isTenantBrandingPath(path: string, tenantId: string): boolean {
  const prefix = `${tenantId}/branding/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(path.slice(prefix.length));
}
