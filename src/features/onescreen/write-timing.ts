/**
 * 수업보고서 **작성 시간 기록**(원장 2026-10-28 *"선생님별 평균 작성시간 · 카드형인지 표형식인지 · 어떤 영역 작성시간이 제일 긴지"* →
 * *"응 기록 추가해줘"*). 원스크린에서 칸을 고칠 때마다 행(학생 × 과목)별로 영역의 손댄 횟수·걸린 시간을 모으고, 보고서를
 * 저장·발송하는 순간 한 줄로 넘긴다(표 `lesson_report_write_timings`, s2_0001).
 *
 * 순수 함수 모듈 — 화면(write-timing-store.ts)과 서버(검증)가 같이 쓴다. ⚠️ `"use client"`·`server-only`를 붙이지 말 것([[#61]] · [[#81]]).
 *
 * 시간을 영역에 붙이는 규칙:
 * - **손으로 고친 것만** 시간을 받는다 — 직전 손댄 때(어느 행이든)부터 지금까지를 이번 영역 몫으로 친다. 단 그 사이가
 *   {@link IDLE_GAP_MS}를 넘으면 자리를 비웠던 것으로 보고 붙이지 않는다(쉬는 시간이 한 영역에 몰리지 않게).
 * - 일괄 입력·이전값 가져오기로 들어간 값은 횟수만 센다(`bulk`·`prev`) — 한 번의 동작이 수십 행에 들어가 시간을 나눌 수 없다.
 * - 자동작성은 기다린 시간을 `autowrite` 영역에 따로 적는다(선생님 손 시간과 섞지 않는다).
 * - 한 칸에 글자를 칠 때마다 세면 횟수가 글자 수가 되므로, 같은 영역을 {@link SAME_EDIT_MS} 안에 다시 고치면 한 번으로 본다.
 */

export const WRITE_FIELDS = [
  "progress", // 진도·성격·교재 학년
  "textbook",
  "dailyTest",
  "checkTest",
  "attitude", // 태도 + 태도 의견
  "homework", // 숙제 완성도 + 미제출 사유
  "understanding",
  "note", // 특이사항 · 사랑의 한마디
  "makeup", // 보강 사유
  "homeworkToday", // 오늘의 숙제 · 영상 숙제 마감
  "nextTest",
  "draft", // 보고서 본문을 직접 고친 것
  "trend", // 학습 추세 글
  "autowrite", // 자동작성 기다린 시간
] as const;
export type WriteField = (typeof WRITE_FIELDS)[number];
export type WriteHow = "hand" | "bulk" | "prev";
export type WriteView = "card" | "grid";
export type SendMode = "single" | "bulk";

export const IDLE_GAP_MS = 90_000;
export const SAME_EDIT_MS = 5_000;

export type FieldStat = { edits: number; ms: number; bulk: number; prev: number; first: number; last: number };
export type RowTiming = {
  start: number;
  fields: Partial<Record<WriteField, FieldStat>>;
  card: number; // 카드에서 손댄 횟수
  grid: number; // 표에서 손댄 횟수
};

const emptyStat = (now: number): FieldStat => ({ edits: 0, ms: 0, bulk: 0, prev: 0, first: now, last: 0 });

/** 한 번 고친 것을 행 기록에 더한다. `prevAt` = 직전에 손댄 때(어느 행이든 — 화면 하나에서 한 사람이 쓰니까). */
export function addEdit(
  row: RowTiming | undefined,
  field: WriteField,
  how: WriteHow,
  view: WriteView,
  now: number,
  prevAt: number | null,
): RowTiming {
  const r: RowTiming = row ? { ...row, fields: { ...row.fields } } : { start: now, fields: {}, card: 0, grid: 0 };
  const st = { ...(r.fields[field] ?? emptyStat(now)) };
  if (how === "hand") {
    const gap = prevAt == null ? 0 : now - prevAt;
    if (gap > 0 && gap <= IDLE_GAP_MS) st.ms += gap;
    if (st.edits === 0 || now - st.last > SAME_EDIT_MS) {
      st.edits += 1;
      r[view] += 1;
    }
  } else st[how] += 1;
  st.last = now;
  r.fields[field] = st;
  return r;
}

/** 자동작성 한 번 — 요청부터 글이 올 때까지 기다린 시간. */
export function addAutowrite(row: RowTiming | undefined, startedAt: number, endedAt: number): RowTiming {
  const r: RowTiming = row ? { ...row, fields: { ...row.fields } } : { start: startedAt, fields: {}, card: 0, grid: 0 };
  const st = { ...(r.fields.autowrite ?? emptyStat(startedAt)) };
  st.edits += 1;
  st.ms += Math.max(0, endedAt - startedAt);
  st.last = endedAt;
  r.fields.autowrite = st;
  return r;
}

/** 서버로 넘기는 한 줄(보고서 한 건). 시각은 첫 손댄 때부터의 초. */
export type WriteTimingPayload = {
  startedAt: string | null;
  totalMs: number | null;
  activeMs: number;
  sendView: WriteView;
  sendMode: SendMode;
  queued: boolean;
  editsCard: number;
  editsGrid: number;
  fields: Partial<Record<WriteField, { edits: number; ms: number; bulk: number; prev: number; firstSec: number; lastSec: number }>>;
};

export function toPayload(
  row: RowTiming | undefined,
  now: number,
  send: { view: WriteView; mode: SendMode; queued: boolean },
): WriteTimingPayload {
  const fields: WriteTimingPayload["fields"] = {};
  let active = 0;
  for (const f of WRITE_FIELDS) {
    const st = row?.fields[f];
    if (!st) continue;
    if (f !== "autowrite") active += st.ms;
    fields[f] = {
      edits: st.edits,
      ms: Math.round(st.ms),
      bulk: st.bulk,
      prev: st.prev,
      firstSec: Math.round((st.first - row!.start) / 1000),
      lastSec: Math.round((st.last - row!.start) / 1000),
    };
  }
  return {
    startedAt: row ? new Date(row.start).toISOString() : null,
    totalMs: row ? Math.max(0, Math.round(now - row.start)) : null,
    activeMs: Math.round(active),
    sendView: send.view,
    sendMode: send.mode,
    queued: send.queued,
    editsCard: row?.card ?? 0,
    editsGrid: row?.grid ?? 0,
    fields,
  };
}

const DAY_MS = 86_400_000;
const int = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null;

/** 서버 쪽 검증 — 화면이 보낸 값을 믿지 않는다. 모양이 틀리면 null(그 줄은 버린다). 값은 하루 안으로 자른다. */
export function sanitizePayload(raw: unknown): WriteTimingPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const view = p.sendView === "grid" ? "grid" : p.sendView === "card" ? "card" : null;
  const mode = p.sendMode === "bulk" ? "bulk" : p.sendMode === "single" ? "single" : null;
  if (!view || !mode) return null;
  const startedAt = typeof p.startedAt === "string" && !Number.isNaN(Date.parse(p.startedAt)) ? new Date(p.startedAt).toISOString() : null;
  const fields: WriteTimingPayload["fields"] = {};
  const rawFields = p.fields && typeof p.fields === "object" ? (p.fields as Record<string, unknown>) : {};
  for (const f of WRITE_FIELDS) {
    const v = rawFields[f];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    fields[f] = {
      edits: int(o.edits, 10_000) ?? 0,
      ms: int(o.ms, DAY_MS) ?? 0,
      bulk: int(o.bulk, 10_000) ?? 0,
      prev: int(o.prev, 10_000) ?? 0,
      firstSec: int(o.firstSec, 86_400) ?? 0,
      lastSec: int(o.lastSec, 86_400) ?? 0,
    };
  }
  return {
    startedAt,
    totalMs: int(p.totalMs, DAY_MS),
    activeMs: int(p.activeMs, DAY_MS) ?? 0,
    sendView: view,
    sendMode: mode,
    queued: p.queued === true,
    editsCard: int(p.editsCard, 100_000) ?? 0,
    editsGrid: int(p.editsGrid, 100_000) ?? 0,
    fields,
  };
}
