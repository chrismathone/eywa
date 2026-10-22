export const foldArchiveText = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** Some original name cells also contain a grade/school on separate lines. */
export function archiveName(raw: string) {
  const lines = raw.normalize("NFKC").trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const annotations = lines.slice(1);
  if (annotations.some(s => /(?:초|중|고)[1-6](?:학년)?$/.test(s)) && annotations.every(s => /^(?:(?:초|중|고)[1-6](?:학년)?|[가-힣]+(?:초|중|고)(?:등학교|학교)?[1-6]?)$/.test(s))) return foldArchiveText(lines[0]);
  return foldArchiveText(raw);
}

export function archiveSchool(raw: string) {
  const text = foldArchiveText(raw);
  // "5", "4학년" and "중1" contain a grade, not a school identity.
  if (/^(?:(?:초|중|고)(?:등학교|학교)?)?[1-6](?:학년)?$/.test(text)) return "";
  const result = text.replace(/초등학교/g, "초").replace(/중학교/g, "중").replace(/고등학교/g, "고").replace(/학교/g, "").replace(/(초|중|고)[1-6].*$/, "$1");
  return /^(초|중|고)$/.test(result) ? "" : result;
}

/** Keep the actual course code/level; remove only display prefixes and decorations. */
export function archiveClass(raw: string) {
  return foldArchiveText(raw)
    .replace(/\([~～]\d{2,4}\.\d{1,2}\.\d{1,2}\)$/, "")
    .replace(/^(?:초등|중등|고등|중고)[em]_?/, "")
    .replace(/[월화수목금토일]{2,}[0-9:~～–-]+$/, "")
    .replace(/\/+$/, "")
    .replace(/반$/, "");
}
