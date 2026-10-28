import { recordReportWriteTimings } from "./server/write-timing-actions";
import {
  addAutowrite,
  addEdit,
  toPayload,
  type RowTiming,
  type SendMode,
  type WriteField,
  type WriteHow,
  type WriteTimingPayload,
  type WriteView,
} from "./write-timing";

/**
 * 원스크린 작성 시간 기록의 **화면 쪽 보관함**(규칙은 write-timing.ts). 모듈에 둔다 — 날짜를 옮기면 화면이 다시 그려져도
 * 그날 모은 기록이 남게(키에 날짜를 넣는다). 새로고침하면 사라진다(그 뒤 고친 것만 잰다 — 저장 값은 그대로).
 * 🔴 기록은 보고서 저장·발송을 절대 막지 않는다: 보내기는 모아서 뒤에, 실패는 버린다.
 */

const rows = new Map<string, RowTiming>();
let lastHandAt: number | null = null;
let origin: WriteHow = "hand";

const keyOf = (date: string, studentId: string, subjectName: string) => `${date}|${studentId}|${subjectName}`;

/** 일괄 입력·이전값 가져오기 동안 들어간 값은 그 방식으로 센다. 동기 함수만 감싼다(비동기는 {@link beginOrigin}). */
export function withWriteOrigin<T>(how: WriteHow, fn: () => T): T {
  const before = origin;
  origin = how;
  try {
    return fn();
  } finally {
    origin = before;
  }
}

/** 비동기 일괄 동작용 — 돌려받은 함수로 되돌린다(finally에서). */
export function beginWriteOrigin(how: WriteHow): () => void {
  const before = origin;
  origin = how;
  return () => {
    origin = before;
  };
}

export function markWrite(date: string, studentId: string, subjectName: string, field: WriteField, view: WriteView): void {
  const now = Date.now();
  const k = keyOf(date, studentId, subjectName);
  rows.set(k, addEdit(rows.get(k), field, origin, view, now, lastHandAt));
  // 일괄 동작도 '지금 손을 움직였다'로 친다 — 대화상자를 채운 시간이 다음 칸 몫으로 붙지 않게.
  lastHandAt = now;
}

export function markAutowrite(date: string, studentId: string, subjectName: string, startedAt: number): void {
  const now = Date.now();
  const k = keyOf(date, studentId, subjectName);
  rows.set(k, addAutowrite(rows.get(k), startedAt, now));
  lastHandAt = now; // 기다린 시간이 다음 칸 몫으로 붙지 않게
}

const pending: { reportId: string; timing: WriteTimingPayload }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 3_000;
const MAX_BATCH = 200;

function flush(): void {
  timer = null;
  const batch = pending.splice(0, MAX_BATCH);
  if (!batch.length) return;
  void recordReportWriteTimings(batch).catch(() => {});
  if (pending.length) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * 저장·발송된 보고서 한 건의 기록을 떼어 서버로 보낼 줄에 올린다. 뗀 행은 비운다 — 같은 보고서를 다시 고쳐 보내면 그 사이 것만 잰다.
 * 일괄 발송은 수십 건이 이어지므로 모았다가 한 번에 보낸다.
 */
export function queueWriteTiming(
  reportId: string,
  date: string,
  studentId: string,
  subjectName: string,
  send: { view: WriteView; mode: SendMode; queued: boolean },
): void {
  const k = keyOf(date, studentId, subjectName);
  const timing = toPayload(rows.get(k), Date.now(), send);
  rows.delete(k);
  pending.push({ reportId, timing });
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}
