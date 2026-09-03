/**
 * 자산ID(`asset_code`) 채번·검증 — 순수.
 *
 * 규칙: **분류 접두**(`inventory_categories.code_prefix` — DT/NB/… + 학원이 추가한 HS·C1) + `-` +
 * 3자리(그 접두의 최대 번호 + 1). 사람이 직접 고칠 수 있게 두되(중복은 서버가 한글 오류로 거절),
 * 자동 제안은 이 함수 하나가 만든다.
 * ⚠️ 3자리를 넘으면(1000번째) 4자리로 늘어난다 — `padStart`는 자르지 않는다.
 * 🔴 접두는 **분류에서 파생**하지만 저장된 `asset_code`는 사람이 고칠 수 있는 라벨이다 —
 *    접두로 분류를 되짚지 말 것(코드는 라벨, 분류는 컬럼).
 */

/** 대문자·숫자·하이픈만, 2~32자. `NB-002`·`DT-044`·`MN-5A`. 소문자는 대문자로 정규화한다. */
export const ASSET_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export function normalizeAssetCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidAssetCode(code: string): boolean {
  return ASSET_CODE_RE.test(code);
}

/**
 * 접두가 같은 코드들의 최대 번호 + 1. 번호가 아닌 꼬리(`MN-5A`)는 건너뛴다.
 * `prefix`는 `CategoryMaps.prefixOf(key)`가 준다 — 분류 키를 여기서 다시 해석하지 않는다(단일 소스).
 */
export function nextAssetCode(prefix: string, existingCodes: ReadonlyArray<string>): string {
  // 접두는 DB CHECK가 `^[A-Z][A-Z0-9]{0,3}$`로 잠그지만, 정규식에 그대로 넣기 전에 한 번 더 턴다.
  const safe = prefix.replace(/[^A-Z0-9]/g, "");
  const re = new RegExp(`^${safe}-(\\d+)$`);
  let max = 0;
  for (const c of existingCodes) {
    const m = re.exec(normalizeAssetCode(c));
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${safe}-${String(max + 1).padStart(3, "0")}`;
}
