/**
 * 셔틀 차량 위치(0382a, 사용자 2026-10-15 "GPS 기능") — 기사 폰이 보내고 지도가 그리는 모양과 판정.
 * 🔑 순수 모듈 — 서버 액션(받기 검증)과 화면(끊김 표시)이 같은 규칙을 쓴다.
 */

/** 지도에 그릴 차 한 대(회차 하나의 최신 위치). */
export type VehiclePosition = {
  runId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  heading: number | null;
  speedMps: number | null;
  /** 서버가 받은 시각(ISO). "N초 전"은 이 값 기준 — 기기 시계는 틀릴 수 있다. */
  receivedAt: string;
  /** 출발 뒤 기록(탑승·미탑승·하차)이 찍힌 가장 뒤 칸 번호 — 없으면 0(학원 출발). 노선도 🚌의 바닥. */
  doneIndex: number;
};

/** 폰이 보내는 값(서버 액션 입력). */
export type PositionReport = {
  runId: string;
  lat: number;
  lng: number;
  accuracyM?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  measuredAt?: string | null;
};

/** 폰이 보내는 간격(ms) — 10초면 1회차(30분)에 180번, 데이터·배터리 부담이 작다. */
export const SEND_EVERY_MS = 10_000;
/** 지도가 다시 읽는 간격(ms). */
export const POLL_EVERY_MS = 10_000;
/** 이보다 오래 소식이 없으면 '위치 끊김'(초) — 전송 간격의 6배. */
export const STALE_AFTER_S = 60;
/** 이보다 오래된 좌표는 보내지 않는다(초) — GPS가 멈춘 채 옛 좌표를 "방금"으로 계속 보내지 않게(2026-10-19 2분 34초 묵은 좌표가 찍혔다). */
export const FIX_MAX_AGE_S = 30;
/** 이보다 오차가 크면 '대략적 위치'로 본다(m) — GPS가 아니라 와이파이·기지국으로 잡은 값이다. 폰의 '정확한 위치'가 꺼졌거나 실내다. */
export const ROUGH_ACCURACY_M = 50;
/** 이보다 오차가 크면 받지 않는다(m) — 실내·GPS 꺼짐의 기지국 추정 위치(수 km)로 차가 튀지 않게. */
export const MAX_ACCURACY_M = 300;

const finiteOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * 받은 값 검증 — 통과하면 저장할 값, 아니면 한글 사유.
 * 🔴 지어내지 않는다: 좌표가 이상하거나 오차가 너무 크면 버린다(지도에 엉뚱한 곳을 찍지 않는다).
 */
export function checkReport(
  input: PositionReport,
): { ok: true; value: Required<PositionReport> } | { ok: false; error: string } {
  const lat = finiteOrNull(input.lat);
  const lng = finiteOrNull(input.lng);
  if (!input.runId || typeof input.runId !== "string") return { ok: false, error: "회차를 찾지 못했습니다" };
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: "위치 값이 올바르지 않습니다" };
  if (lat === 0 && lng === 0) return { ok: false, error: "위치 값이 올바르지 않습니다" };
  const accuracyM = finiteOrNull(input.accuracyM);
  if (accuracyM !== null && accuracyM > MAX_ACCURACY_M) return { ok: false, error: `위치 오차가 너무 큽니다(±${Math.round(accuracyM)}m)` };
  const heading = finiteOrNull(input.heading);
  const speedMps = finiteOrNull(input.speedMps);
  const measuredAt = typeof input.measuredAt === "string" && !Number.isNaN(Date.parse(input.measuredAt)) ? input.measuredAt : null;
  return {
    ok: true,
    value: {
      runId: input.runId,
      lat,
      lng,
      accuracyM,
      heading: heading !== null && heading >= 0 && heading < 360 ? heading : null,
      speedMps: speedMps !== null && speedMps >= 0 ? speedMps : null,
      measuredAt,
    },
  };
}

/** 받은 지 몇 초 지났나(음수는 0). */
export function ageSeconds(receivedAt: string, now: number): number {
  const t = Date.parse(receivedAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.max(0, Math.round((now - t) / 1000));
}

/** "방금" · "25초 전" · "3분 전". */
export function ageLabel(seconds: number): string {
  if (!Number.isFinite(seconds)) return "알 수 없음";
  if (seconds < 5) return "방금";
  if (seconds < 60) return `${seconds}초 전`;
  return `${Math.floor(seconds / 60)}분 전`;
}
