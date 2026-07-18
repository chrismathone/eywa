// 발송 허용 시간창(학원설정 report.classnoteSendWindowStart/End) 순수 로직 — 워커·테스트 공유.
// 목적: 밤 수업 보고서가 밤에 학부모 폰을 울리지 않게, 창 밖이면 워커가 발송 주기를 건너뛴다(큐 보존).
// 원칙(fail-open): 파싱 실패·한쪽만 채움·시작=종료 = **무제한(창 없음)** — 설정 실수로 발송이 영영
// 멈추는 것(fail-closed)보다 "즉시 발송되는 기존 동작"이 안전하다. 차단이 필요한 긴급 상황은 킬스위치
// (classnoteSendEnabled)가 담당하고, 이 창은 배달 시각 조절만 담당한다.
// board-safety.mjs kstSchoolYear와 동일하게 KST는 Intl(Asia/Seoul)로 계산(워커 PC 로컬 TZ 무관).

/** "HH:MM" → 자정 기준 분(0~1439). 형식이 아니면 null. */
export function parseHM(s) {
  if (typeof s !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 설정 문자열 2개 → 창 {startMin, endMin} 또는 null(무제한).
 * null 조건: 한쪽이라도 비었거나 형식 오류, 또는 시작=종료(길이 0 창은 의미 없음 — 무제한으로).
 * start > end는 유효한 **자정 넘김 창**(예 21:00~08:00 = 밤~아침에만 발송).
 */
export function resolveSendWindow(startStr, endStr) {
  const startMin = parseHM(startStr);
  const endMin = parseHM(endStr);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  return { startMin, endMin };
}

/** 현재 KST 자정 기준 분. Intl(Asia/Seoul)이라 워커 PC 로컬 타임존과 무관. */
export function kstMinutesOfDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // en-GB hour12:false는 자정을 "00"으로 주지만, 일부 런타임의 "24" 표기 방어(24:00 → 0:00).
  return ((h % 24) * 60 + m) % 1440;
}

/**
 * 창 안인가? window null(무제한) = 항상 true.
 * 일반 창(start < end): start ≤ m < end. 자정 넘김 창(start > end): m ≥ start 또는 m < end.
 * 경계: 시작 분은 포함, 종료 분은 제외(09:00~21:00이면 21:00 정각부터 대기).
 */
export function isWithinSendWindow(window, minutes = kstMinutesOfDay()) {
  if (!window) return true;
  const { startMin, endMin } = window;
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

/** 로그·강사 안내용 창 라벨(예 "09:00~21:00"). window null이면 "". */
export function formatSendWindow(window) {
  if (!window) return "";
  const f = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  return `${f(window.startMin)}~${f(window.endMin)}`;
}
