/**
 * 자산ID(`asset_code`) 채번·검증 — 순수.
 *
 * 규칙: 분류 접두(DT/NB/MN/TB/PR/TV/ET) + `-` + 3자리(그 접두의 최대 번호 + 1). 사람이 직접 고칠 수
 * 있게 두되(중복은 서버가 한글 오류로 거절), 자동 제안은 이 함수 하나가 만든다.
 * ⚠️ 3자리를 넘으면(1000번째) 4자리로 늘어난다 — `padStart`는 자르지 않는다.
 */
import { ASSET_CODE_PREFIX, type AssetCategory } from "./category";

/** 대문자·숫자·하이픈만, 2~32자. `NB-002`·`DT-044`·`MN-5A`. 소문자는 대문자로 정규화한다. */
export const ASSET_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export function normalizeAssetCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidAssetCode(code: string): boolean {
  return ASSET_CODE_RE.test(code);
}

/** 접두가 같은 코드들의 최대 번호 + 1. 번호가 아닌 꼬리(`MN-5A`)는 건너뛴다. */
export function nextAssetCode(category: AssetCategory, existingCodes: ReadonlyArray<string>): string {
  const prefix = ASSET_CODE_PREFIX[category];
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const c of existingCodes) {
    const m = re.exec(normalizeAssetCode(c));
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
