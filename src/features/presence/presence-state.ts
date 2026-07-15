// 순수 로직 — Supabase presence state를 "scope → 편집 중인 사람들"로 변환한다(Vitest 대상).
// UI/Realtime 없이 테스트 가능하도록 분리. 실제 채널·구독은 edit-presence.tsx.

/** 각 클라이언트가 track하는 payload. editingScopes = 그 탭이 지금 편집 중인 scope 목록. */
export type EditPresencePayload = {
  editingScopes: string[];
  userId: string;
  userName: string;
};

/** supabase `channel.presenceState()` 형태: presenceKey → (payload + presence_ref)[]. */
export type RawPresenceState = Record<string, Array<Record<string, unknown>>>;

export type Editor = { userId: string; userName: string };

/**
 * "수정중" presence를 붙이는 scope 접두(계획 범위 = 주요 편집 표면). scope는 `${prefix}:${id}` 형식.
 * ⚠️ 매칭은 반드시 콜론 포함(`startsWith(prefix + ":")`) — 느슨한 `student` 검사가 `student-consultation:*`를
 *    엉뚱하게 잡지 않도록.
 */
export const PRESENCE_SCOPE_PREFIXES = [
  "student",
  "class",
  "staff",
  "staff-resume",
  "consultation",
  "student-consultation",
  "meeting",
  "tenant-settings",
] as const;

export function isPresenceScope(scope: string): boolean {
  return PRESENCE_SCOPE_PREFIXES.some((p) => scope.startsWith(`${p}:`));
}

/**
 * presenceState → Map<scope, 편집자[]>. **myKey(이 탭의 presence key) 엔트리는 제외** — 같은 계정의
 * 다른 탭/기기 편집은 데이터 유실 위험이라 포함한다(userId가 아니라 presence key 기준 제외). allowlist 밖 scope는 무시.
 */
export function buildOthersByScope(state: RawPresenceState, myKey: string): Map<string, Editor[]> {
  const out = new Map<string, Editor[]>();
  for (const [key, entries] of Object.entries(state)) {
    if (key === myKey) continue; // 내 구독만 제외
    for (const entry of entries) {
      const userId = typeof entry.userId === "string" ? entry.userId : "";
      const userName = typeof entry.userName === "string" ? entry.userName : "";
      const scopes = Array.isArray(entry.editingScopes) ? entry.editingScopes : [];
      for (const scope of scopes) {
        if (typeof scope !== "string" || !isPresenceScope(scope)) continue;
        const list = out.get(scope);
        if (list) list.push({ userId, userName });
        else out.set(scope, [{ userId, userName }]);
      }
    }
  }
  return out;
}

/** 편집자 목록을 userId로 dedupe(같은 사람이 여러 탭/기기에서 열어도 1명). 배지 라벨·카운트용. */
export function dedupeEditors(editors: Editor[]): Editor[] {
  const seen = new Set<string>();
  const out: Editor[] = [];
  for (const e of editors) {
    if (seen.has(e.userId)) continue;
    seen.add(e.userId);
    out.push(e);
  }
  return out;
}
