const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MARKER = new RegExp(`\\s*\\[EYWA-UNIFIED:((?:grade|level):${UUID}|report:${UUID}:(?:daily|check|legacy))\\]$`, "i");

/** 상담 본문 끝의 내부 시험 키만 인식한다. 사용자에게는 본문만 전달한다. */
export function linkedRecordKeyOf(summary: string): string | null {
  return MARKER.exec(summary)?.[1].toLowerCase() ?? null;
}

export function visibleConsultationSummary(summary: string): string {
  const marker = MARKER.exec(summary);
  return marker ? summary.slice(0, marker.index).trimEnd() : summary;
}

/** 편집 폼은 키를 받지 않는다. 저장된 키를 서버에서 다시 붙인다. */
export function preserveConsultationLink(entered: string, stored: string): string {
  const visible = visibleConsultationSummary(entered);
  const key = linkedRecordKeyOf(stored);
  return key ? `${visible} [EYWA-UNIFIED:${key}]` : visible;
}
