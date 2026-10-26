const placeholder = /^(?:어머니|어머님|엄마|아버지|아버님|아빠|할머니|할아버지|학부모|보호자|부모|부|모|없음|미상|미입력|이름없음)$|폰|번호|연락처/;
/** Accept complete names and explicit relationship annotations; never substring/fuzzy-match a parent. */
export function eventGuardianNames(value: string | null | undefined): string[] {
  const text = (value ?? "").normalize("NFKC").trim();
  if (!text) return [];
  const tokens = text.replace(/\((?:모|부|어머니|아버지|엄마|아빠|할머니|할아버지)\)/g, "/").split(/[,/·\n]+/)
    .map(s => s.replace(/\s+/g, "")).filter(Boolean);
  if (!tokens.length || tokens.some(s => !/^[가-힣]{2,5}$/.test(s) || placeholder.test(s))) return [];
  return [...new Set(tokens)].sort();
}
/** One form may name only one of the two registered parents. Conflicting two-parent lists still fail. */
export function eventGuardiansCompatible(a: string | null | undefined, b: string | null | undefined) {
  const left = eventGuardianNames(a), right = eventGuardianNames(b);
  return !!left.length && !!right.length && (left.every(n => right.includes(n)) || right.every(n => left.includes(n)));
}
