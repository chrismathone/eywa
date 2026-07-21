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

/** 워커가 실어 보낸 실행환경 진단(`last_results.env`) — 로그 폴더 + 최근 경고/오류 몇 줄. */
export type WorkerEnvInfo = { logDir: string | null; recent: string[] };

/**
 * `last_results.env` → 화면 표시용. **연동 PC가 물리적으로 다른 컴퓨터**라 파일 로그를 열 수 없을 때가 있어
 * (2026-07-21: 로그 폴더를 못 만들어 watch.log가 한 줄도 없었고, 같은 이유로 프로비저닝 마커도 죽어
 * 하루 1회여야 할 작업이 15초마다 돌았다) 워커가 스스로 위치와 최근 문제를 웹으로 보낸다.
 * 구버전 워커는 이 키가 없어 `{ logDir: null, recent: [] }`(카드에 아무것도 안 뜸).
 */
/**
 * 워커 로그 한 줄이 **진짜 문제**인가. 워커는 "실패/오류" 단어가 들어간 줄을 모아 보내는데, 정상 요약
 * (`처리 완료 — 성공 1 / 실패 0 / 재큐 0`)도 그 단어를 갖고 있어 **매 폴마다 "최근 경고"가 뜨는 늑대소년**이
 * 된다(2026-07-21 첫 가동에서 실제로 발생). 숫자가 0인 실패·오류 표기는 지우고 나서 판정한다.
 */
function isRealIssue(line: string): boolean {
  const probe = line.replace(/(실패|오류|error)\s*[:=]?\s*0\b/gi, "");
  return /실패|오류|error|⚠/i.test(probe);
}

export function extractWorkerEnv(raw: unknown): WorkerEnvInfo {
  const empty: WorkerEnvInfo = { logDir: null, recent: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const env = (raw as Record<string, unknown>).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return empty;
  const e = env as Record<string, unknown>;
  return {
    logDir: typeof e.logDir === "string" && e.logDir ? e.logDir : null,
    recent: Array.isArray(e.recent)
      ? e.recent.filter((x): x is string => typeof x === "string").filter(isRealIssue).slice(-5)
      : [],
  };
}

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
