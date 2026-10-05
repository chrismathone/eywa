/**
 * 설정 문서(`tenant_settings`)가 "언제의 값인가"를 가리는 두 표식 — 순수(Vitest).
 *
 * ① **저장 순번** — 운영 섹션 안의 숫자(`data.operations.rev`). 그 섹션을 다시 쓰는 앱 저장이 쓸 때마다 1씩 올린다.
 *    편집 폼이 "내려온 값이 **내 저장보다 먼저 읽힌 것인가**"를 가리는 순서다(`useSectionDraft`).
 *    🔴 시각이 아니라 숫자인 이유: 시각은 서버마다 시계가 달라 뒤로 갈 수 있고, DB 안에서 직접 쓰는 곳(보강 설정 RPC 등)은
 *       자기 시계의 `now()`를 쓴다 — 시각으로 순서를 가리면 그런 쓰기 하나가 순서를 뒤집어 최신 값을 옛것으로 버리게 된다.
 *       순번은 값 안에 있어서, 순번을 모르는 쓰기(SQL의 `jsonb_set` · 시트 반영)는 **그대로 둘 뿐 줄이지 않는다**.
 *       그래서 "내 저장 전에 읽힌 값은 내 순번보다 작다"가 항상 성립한다.
 *    🔴 문서 **최상위가 아니라 섹션 안**에 두는 이유: DB의 쓰기 가드(0335a `guard_tenant_settings_write`)는 개별 설정만
 *       위임받은 사람에게 "맡은 섹션 밖은 그대로일 것"을 요구한다. 최상위에 새 키가 생기면 그 사람들의 저장이 전부 거절된다.
 *       섹션 안의 키는 그 섹션을 고칠 권한으로 함께 쓰인다.
 *    ⚠️ 순번을 올리는 곳 = 운영 섹션을 다시 쓰는 앱 저장(saveOwnerSection의 운영 요청 · 예약 그룹 반영).
 *       순번이 없는 옛 문서와 아직 없는 행은 0이다. 스키마에는 없는 키다(읽을 때 설정 값에 섞이지 않는다).
 *    ⚠️ 한 칸만 고치는 SQL이 **면이 맡는 값**(과목 이름·요일 병합 등)을 바꾸면서 순번을 안 올리면, 같은 순번의 옛 읽기와
 *       새 읽기를 가리지 못한다(지금 알려진 곳 = 데모 구성의 요일 병합 — 데모 지점 한정). 그런 SQL을 새로 쓸 땐 순번도 올릴 것.
 * ② **수정 표식 `updated_at`** — 저장 직전 "읽은 뒤 누가 먼저 썼나"의 판정(같지 않으면 저장하지 않는다).
 *    같은 ms에 두 번 써도 같은 값이 되지 않게, 앱은 직전 값보다 최소 1ms 뒤로 민다. 순서 판정에는 쓰지 않는다.
 */
export function nextSettingsStamp(previous: string | null | undefined, now: number = Date.now()): string {
  const prev = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(prev) ? Math.max(now, prev + 1) : now).toISOString();
}

/** 저장된 섹션(예: `data.operations`)의 저장 순번. 섹션이 없거나 순번이 없으면(이 규칙 전의 문서) 0. */
export function settingsRevOf(section: unknown): number {
  const rev = section && typeof section === "object" && !Array.isArray(section) ? (section as { rev?: unknown }).rev : undefined;
  return typeof rev === "number" && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

/** 저장 순번을 뺀 섹션 값 — 순번은 설정이 아니라 장부라, 변경 내역(감사 기록)을 만들 때는 빼고 비교한다. */
export function withoutSettingsRev(section: unknown): unknown {
  if (!section || typeof section !== "object" || Array.isArray(section) || !("rev" in section)) return section;
  const rest: Record<string, unknown> = { ...(section as Record<string, unknown>) };
  delete rest.rev;
  return rest;
}

/**
 * `a`가 `b`보다 **먼저** 쓰인 상태의 순번인가.
 * 어느 쪽이든 모르면(읽기 전용 열람자 등) false — 옛것이라고 단정하지 않고 평소 규칙대로 다룬다.
 */
export function isOlderRev(a: number | undefined, b: number | undefined): boolean {
  return typeof a === "number" && typeof b === "number" && a < b;
}
