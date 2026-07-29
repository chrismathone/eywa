/**
 * 워커 로그 회전 규칙(순수 함수 — Vitest).
 *
 * 배경(원장 지적 2026-07-29): `watch.log`가 한 파일에 계속 쌓여 열기 어려울 만큼 길어졌다.
 * 데몬은 15초마다 폴하며 상태 전이·발송 결과를 남기므로 며칠만 지나도 수만 줄이 된다.
 *
 * 설계: **`watch.log` = 항상 "오늘 로그"**를 유지하고, 날짜가 바뀌면 그 파일을 `watch-YYYY-MM-DD.log`로
 * 넘긴 뒤 새로 시작한다(옮기는 쪽이 아니라 **남기는 쪽**이 날짜를 갖는다).
 * 🔴 이 방향을 고른 이유: 연동 PC 안내문·문서·원장 지시가 전부 "로그는 `watch.log`를 보세요"로 되어 있다.
 * 오늘 로그의 이름이 매일 바뀌면 그 안내가 전부 거짓이 되고, 비엔지니어 담당자가 어느 파일을 열어야 할지
 * 알 수 없다. 이름을 고정하면 기존 안내가 그대로 유효하고 과거분만 날짜로 쌓인다.
 *
 * 날짜 기준은 **KST**다(로그 타임스탬프와 같은 기준 — 자정 경계에서 파일과 줄의 날짜가 어긋나지 않게).
 */

/** 기본 보관 일수 — 이보다 오래된 `watch-*.log`는 지운다. env CLASSNOTE_LOG_KEEP_DAYS로 조정. */
export const DEFAULT_KEEP_DAYS = 30;
/** 하루 안에서도 이 크기를 넘으면 회전(폭주 로그 방어) — 파일명에 `_HHmm`이 붙는다. */
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const LIVE_NAME = "watch.log";
const ARCHIVE_RE = /^watch-(\d{4}-\d{2}-\d{2})(?:_\d{4})?\.log$/;

/** ms → KST 기준 'YYYY-MM-DD'. UTC+9 고정 오프셋(한국은 서머타임 없음) — kstStamp와 같은 계산. */
export function kstDate(ms) {
  const k = new Date(ms + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

/** ms → KST 'HHmm'(같은 날 크기 초과로 여러 번 회전할 때 이름 충돌 방지용). */
export function kstHHmm(ms) {
  const k = new Date(ms + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

/**
 * 지금 watch.log를 넘겨야 하는가.
 * - `date`: 파일이 마지막으로 쓰인 날(KST)이 오늘이 아니다 → 그 날짜로 보관.
 * - `size`: 오늘 파일인데 상한을 넘었다 → 오늘 날짜 + 시각 접미사로 보관.
 * 파일이 없거나(첫 기동) 판단 불가면 `{ rotate: false }`.
 */
export function needsRotation({ mtimeMs, sizeBytes, nowMs, maxBytes = DEFAULT_MAX_BYTES }) {
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(sizeBytes)) return { rotate: false, reason: null };
  if (sizeBytes === 0) return { rotate: false, reason: null }; // 빈 파일은 넘길 것이 없다
  const fileDate = kstDate(mtimeMs);
  if (fileDate !== kstDate(nowMs)) return { rotate: true, reason: "date", archiveDate: fileDate };
  if (sizeBytes >= maxBytes) return { rotate: true, reason: "size", archiveDate: fileDate };
  return { rotate: false, reason: null };
}

/** 보관 파일명 — date 회전은 `watch-2026-07-28.log`, size 회전은 `watch-2026-07-29_1432.log`. */
export function archiveName({ archiveDate, reason, nowMs }) {
  return reason === "size" ? `watch-${archiveDate}_${kstHHmm(nowMs)}.log` : `watch-${archiveDate}.log`;
}

/** 이미 있는 이름이면 `_HHmm`(그래도 겹치면 `_HHmmss`)을 붙여 **덮어쓰지 않는다** — 로그는 소실이 곧 손실. */
export function uniqueArchiveName(name, exists, nowMs) {
  if (!exists(name)) return name;
  const stem = name.replace(/\.log$/, "");
  const withMin = `${stem}_${kstHHmm(nowMs)}.log`;
  if (!exists(withMin)) return withMin;
  for (let i = 1; i < 100; i++) {
    const alt = `${stem}_${kstHHmm(nowMs)}-${i}.log`;
    if (!exists(alt)) return alt;
  }
  return `${stem}_${nowMs}.log`; // 현실적으로 도달 불가 — 마지막 안전망
}

/**
 * 지울 보관 로그 목록 — `watch-YYYY-MM-DD[_HHmm].log` 중 keepDays보다 오래된 것.
 * ⚠️ 살아 있는 `watch.log`와 형식이 다른 파일은 **절대 건드리지 않는다**(provision-last-run.txt 등 동거).
 */
export function pruneList(names, { nowMs, keepDays = DEFAULT_KEEP_DAYS }) {
  const cutoff = kstDate(nowMs - keepDays * 86_400_000);
  return names.filter((n) => {
    if (n === LIVE_NAME) return false;
    const m = ARCHIVE_RE.exec(n);
    return !!m && m[1] < cutoff; // 'YYYY-MM-DD' 사전순 = 날짜순
  });
}

export { LIVE_NAME };
