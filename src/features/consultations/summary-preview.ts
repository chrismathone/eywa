/** 목록에만 쓰는 미리보기. 저장된 원문이나 사용자 양식은 변경하지 않는다. */
export function consultationPreview(
  summary: string | null | undefined,
): string {
  const raw = summary?.trim();
  if (!raw) return "상담 내용 미입력";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading =
    /^(?:[✅📌]\s*)?(상담\s*내용|상담\s*요약|조치\s*사항|건의\s*사항|후속\s*조치|비고)\s*[:：]\s*(.*)$/u;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(heading);
    if (!match) continue;
    const content = match[2] ? [match[2]] : [];
    for (let j = i + 1; j < lines.length && !heading.test(lines[j]); j++)
      content.push(lines[j]);
    if (content.length) return content.join(" ").replace(/\s+/g, " ");
  }
  // 알려진 기본 양식이 비어 있으면 날짜·담당자 이름을 상담 내용처럼 보여주지 않는다.
  if (
    /상담\s*내역/u.test(raw) &&
    /상담\s*기록\s*항목/u.test(raw) &&
    lines.some((line) => heading.test(line))
  ) {
    return "상담 내용 미입력";
  }
  return lines.join(" ").replace(/\s+/g, " ");
}
