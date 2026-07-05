// 영어 강사뷰 10분 격자 축 — 시트 "강사별영어시간표"의 10분 단위 행을 그대로 미러.
// 순수 모듈 (클라/서버 공용 — server-only 금지 [[#61]]).
//
// 시트는 14:20부터 10분 행으로 내려가며 수업 블록을 세로 병합으로 그린다. eywa 강사뷰도
// 같은 축을 쓰되, 행 목록은 "슬롯 데이터 범위 ∪ 폴백(14:20~22:00)"으로 만들어
// 빈 주에도 시트 프레임(46행)이 유지되고, 범위 밖 슬롯이 있으면 바깥쪽 라운딩으로 확장된다.

export const STEP_MIN = 10;

/** 시트 프레임 기본 범위 — 통합영어시간표 교시(14:20~22:00, 46행). */
export const ENGLISH_GRID_FALLBACK = { start: "14:20", end: "22:00" };

export type TenMinuteRow = {
  /** 행 시작 "HH:MM" — td key·시각 라벨 겸용 */
  key: string;
  /** 자정 기준 분 */
  startMin: number;
  /** 정시(HH:00) — 라벨·격자선 강조용 */
  isHour: boolean;
};

/** "HH:MM" | "HH:MM:SS" → 자정 기준 분. 파싱 실패 시 null (throw 금지). */
export function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(min) ? min : null;
}

const minToHM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const floorStep = (min: number) => Math.floor(min / STEP_MIN) * STEP_MIN;
const ceilStep = (min: number) => Math.ceil(min / STEP_MIN) * STEP_MIN;

/**
 * 슬롯들로 10분 행 축 구성 — 데이터 min~max를 바깥쪽 라운딩 후 폴백 범위와 합집합.
 * 빈 배열이어도 폴백 프레임을 반환(빈 주 렌더 보장).
 */
export function buildTenMinuteRows(
  slots: readonly { startTime: string; endTime: string }[],
  fallback: { start: string; end: string } = ENGLISH_GRID_FALLBACK,
): TenMinuteRow[] {
  let lo = timeToMin(fallback.start) ?? 860;
  let hi = timeToMin(fallback.end) ?? 1320;
  for (const s of slots) {
    const a = timeToMin(s.startTime);
    const b = timeToMin(s.endTime);
    if (a != null) lo = Math.min(lo, floorStep(a));
    if (b != null) hi = Math.max(hi, ceilStep(b));
  }
  const rows: TenMinuteRow[] = [];
  for (let m = lo; m < hi; m += STEP_MIN) {
    rows.push({ key: minToHM(m), startMin: m, isHour: m % 60 === 0 });
  }
  return rows;
}

/**
 * 슬롯 → {index, span}. start는 내림·end는 올림으로 10분 정렬, 축 범위로 클램프,
 * span ≥ 1 보장 — 역전/동일 시각/파싱 실패 어떤 입력에도 throw하지 않는다.
 */
export function slotRowSpan(
  rows: readonly TenMinuteRow[],
  startTime: string,
  endTime: string,
): { index: number; span: number } {
  if (rows.length === 0) return { index: 0, span: 1 };
  const lo = rows[0]!.startMin;
  const hi = rows[rows.length - 1]!.startMin + STEP_MIN;
  const rawStart = timeToMin(startTime);
  const rawEnd = timeToMin(endTime);
  const start = Math.min(Math.max(rawStart != null ? floorStep(rawStart) : lo, lo), hi - STEP_MIN);
  const end = Math.min(Math.max(rawEnd != null ? ceilStep(rawEnd) : start + STEP_MIN, start + STEP_MIN), hi);
  const index = (start - lo) / STEP_MIN;
  const span = (end - start) / STEP_MIN;
  return { index, span };
}

/**
 * 한 컬럼(강사×요일)의 행별 피복 슬롯 — covering: 행 시작이 [슬롯 start, 슬롯 end) 안이면 피복.
 * (half-open: 15:00~15:40 슬롯은 15:00·15:10·15:20·15:30 행을 덮고 15:40 행은 안 덮는다.)
 */
export function buildCoveringRows<T extends { startTime: string; endTime: string }>(
  rows: readonly TenMinuteRow[],
  slots: readonly T[],
): T[][] {
  const out: T[][] = rows.map(() => []);
  for (const s of slots) {
    const { index, span } = slotRowSpan(rows, s.startTime, s.endTime);
    for (let i = index; i < index + span && i < out.length; i++) out[i]!.push(s);
  }
  return out;
}
