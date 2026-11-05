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

/**
 * 이 워커가 **공지 이미지 첨부(0130a)를 지원하는 버전**인가 — 하트비트 `last_results.caps.noticeAttachments`.
 *
 * 워커는 zip 물리 이관이라 앱보다 늦게 갱신된다. 구버전은 이 키가 없고, 첨부를 실어 보내도 **무시하고
 * 글자만 게시한 뒤 success로 기록**한다(학부모는 요청서 없는 글, 강사는 정상 발송으로 오인). 그래서
 * 발송 전에 이 값을 확인해 미지원이면 막는다. 키가 없으면 **미지원으로 본다**(fail-safe).
 */
export function workerSupportsNoticeAttachments(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const caps = (raw as Record<string, unknown>).caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return (caps as Record<string, unknown>).noticeAttachments === true;
}

/**
 * 이 워커가 **공지의 반 보드 경로**(수학 개별 공지·교재요청서를 반 보드의 그 학생 원아에게 1:1로)를 지원하는 버전인가 —
 * 하트비트 `last_results.caps.noticeClassRoute`(2026-10-02). 구버전은 `classId`를 모르고 반 보드 이름을 1인 보드처럼 찾다가
 * 막힌다(발송 실패) — 그래서 앱은 이 값이 참일 때만 반 보드 경로로 큐에 싣는다. 키가 없으면 미지원(fail-safe = 기존 1인 보드 경로).
 */
export function workerSupportsNoticeClassRoute(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const caps = (raw as Record<string, unknown>).caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return (caps as Record<string, unknown>).noticeClassRoute === true;
}

/**
 * 이 워커가 **영어 개별 공지·교재요청서의 반 방 경로**(그 영어 반에 이어진 ClassNote 반 방의 그 학생 원아에게 1:1)를 아는 버전인가 —
 * 하트비트 `last_results.caps.noticeEnglishRoom`(2026-11-04 · AywaSync 1.0.15). 옛 워커는 `classId`가 실린 대상을 전부 수학 반 보드로
 * 보고 '반 보드 연결이 확인되지 않습니다'로 실패시킨다(오발송은 아니다) — 그래서 앱은 이 값이 참일 때만 영어 대상에 반을 싣는다.
 * 키가 없으면 미지원(fail-safe = 지금까지처럼 `(영어)이름` 1인 보드 경로).
 */
export function workerSupportsNoticeEnglishRoom(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const caps = (raw as Record<string, unknown>).caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return (caps as Record<string, unknown>).noticeEnglishRoom === true;
}

/**
 * 이 워커가 **반 공지의 이미지 첨부**를 지원하는 버전인가 — 하트비트 `last_results.caps.classNoticeImages`(2026-10-03).
 * 구버전은 큐 행의 이미지를 모르고 **글만 올린 뒤 '발송 완료'로 적는다** — 그래서 앱은 이 값이 참일 때만 이미지를 받아 준다.
 * 키가 없으면 미지원(fail-safe).
 */
export function workerSupportsClassNoticeImages(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const caps = (raw as Record<string, unknown>).caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return (caps as Record<string, unknown>).classNoticeImages === true;
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
  // 업로드 멈춤·용량 확인 실패는 **맨 앞** — 카드의 결과 줄은 300px에서 잘려서 끝에 붙이면 경고가 보이지 않는다.
  const video = formatVideoStorage(results.videoStorage);
  if (video) rows[video.error ? "unshift" : "push"](video);
  return rows;
}

const GB = 1024 ** 3; // Drive 화면의 'GB'와 같은 단위
const COMPRESS_LABEL: Readonly<Record<string, string>> = {
  ok: "압축 켜짐",
  missing: "압축 꺼짐(ffmpeg 없음)",
  off: "압축 꺼짐(설정)",
};

/**
 * '영상 보관' 줄 — 워커 하트비트 `last_results.videoStorage`(2026-10-01, video-drive-quota.mjs).
 * Drive 남은 공간이 문턱 아래면 워커가 영상 업로드를 멈추므로 붉게 알린다. 대기 영상이 없어 용량을 아직 안 봤고
 * 압축도 안 해 봤으면 줄이 없다(구워커도 키가 없어 없음). 압축 건수는 싣지 않는다 — 워커 재시작마다 0이 되는 수라 기간이 거짓이 된다.
 */
export function formatVideoStorage(raw: unknown): WorkerResultRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const at = typeof v.checkedAt === "string" ? kstHHMM(v.checkedAt) : "";
  const free = typeof v.freeBytes === "number" && Number.isFinite(v.freeBytes) ? v.freeBytes : null;
  const gb = (n: number) => `${(n / GB).toFixed(n >= 100 * GB ? 0 : 1)}GB`;
  const paused = v.paused === true && free !== null;
  // 조치가 필요한 상태어를 시각 바로 뒤에 — 카드 줄이 잘려도 보이게. 확인 실패 때의 남은 공간은 직전 값이라 뒤로.
  const parts: string[] = [];
  if (paused) parts.push(`업로드 멈춤 — Drive 남은 ${gb(free)}`);
  if (v.quotaError === true) parts.push("용량 확인 실패");
  if (!paused && free !== null) parts.push(`Drive 남은 ${gb(free)}`);
  const compress = typeof v.ffmpeg === "string" && Object.hasOwn(COMPRESS_LABEL, v.ffmpeg) ? COMPRESS_LABEL[v.ffmpeg] : undefined;
  if (compress) parts.push(compress);
  if (!parts.length) return null;
  return { key: "video", label: "영상 보관", text: [at, ...parts].filter(Boolean).join(" · "), error: paused || v.quotaError === true };
}

/**
 * 이 워커가 **Cloud Run 없이 자체 게시하는 버전**인가 — 하트비트 `last_results.caps.nativePublish`(2026-07-29).
 *
 * 워커는 zip 물리 이관이라 앱보다 늦게 갱신된다. 구버전 워커는 첨부 없는 리포트를 **edutrix Firebase의
 * Cloud Run 함수**로 게시하는데, 그 프로젝트를 소등하면 그 순간부터 전 발송이 실패한다 —
 * 그런데 앱·DB와는 완전히 호환돼 **이관 전까지는 화면상 아무 이상이 없다**(적대 검증 2026-07-29 P1).
 * 그래서 "이관됐는가"를 원격에서 볼 수 있는 유일한 신호가 이 값이다. 키가 없으면 **구워커로 본다**(fail-safe).
 */
export function workerSupportsNativePublish(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const caps = (raw as Record<string, unknown>).caps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return false;
  return (caps as Record<string, unknown>).nativePublish === true;
}

