/**
 * 워커 폴러별 마지막 결과(classnote_workers.last_results, 0123a) → 카드 표시행 변환.
 * 순수 함수(Vitest) — 서버 쿼리와 클라 카드가 공유한다. 라벨은 전부 한글(raw 키 노출 금지).
 */

export type WorkerLastResults = Record<string, { at?: string; error?: string; [k: string]: unknown }>;

export type WorkerResultRow = {
  key: string;
  label: string;
  /** "12:30 · 매칭 3" 같은 압축 요약(시각은 KST HH:MM). */
  text: string;
  error: boolean;
};

/** 폴러 키 → 한글 라벨. 미등록 키는 표시하지 않는다(워커가 앞서갈 때 raw 키 누출 방지). */
const POLLER_LABEL: Readonly<Record<string, string>> = {
  queue: "발송",
  notice: "공지",
  provision: "프로비저닝",
  posts: "새 글",
  comments: "댓글",
  reads: "읽음",
};

/** 요약에 표시할 숫자 필드 → 한글 라벨(폴러별 대표값만 — 전부 나열하면 카드가 시끄럽다). */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  success: "성공",
  failed: "실패",
  processed: "처리",
  created: "생성",
  assigned: "배정",
  notified: "알림",
  matched: "매칭",
  read: "읽음",
  unread: "미읽음",
};

function kstHHMM(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * last_results → 표시행. 정렬은 POLLER_LABEL 선언 순서(발송이 먼저). 오류 행이 있으면 error=true로
 * 표시(카드가 붉게). 알 수 없는 키·시각 없는 항목은 건너뛴다(방어).
 */
export function formatWorkerResults(raw: unknown): WorkerResultRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const results = raw as WorkerLastResults;
  const rows: WorkerResultRow[] = [];
  for (const [key, label] of Object.entries(POLLER_LABEL)) {
    const entry = results[key];
    if (!entry || typeof entry !== "object") continue;
    const at = typeof entry.at === "string" ? kstHHMM(entry.at) : "";
    if (!at) continue;
    if (typeof entry.error === "string" && entry.error) {
      rows.push({ key, label, text: `${at} 오류`, error: true });
      continue;
    }
    const parts: string[] = [];
    for (const [field, fieldLabel] of Object.entries(FIELD_LABEL)) {
      const value = entry[field];
      if (typeof value === "number" && value > 0) parts.push(`${fieldLabel} ${value}`);
    }
    rows.push({ key, label, text: parts.length ? `${at} · ${parts.join(" · ")}` : at, error: false });
  }
  return rows;
}
