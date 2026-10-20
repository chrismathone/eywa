import "server-only";

/**
 * 미룸·당김 **표식 읽기·쓰기** — 서버 전용 IO. 키 모양은 [`shift-key.ts`](../shift-key.ts) 한 곳.
 *
 * 0381a가 표식에 `lane`(교재)·`pos`(자리)를 더했다(원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김"*).
 * 🔴 **앱은 0381a 적용 전에도 돈다**([[#95]]) — eywa는 SQL을 손으로 적용해서 배포와 적용 사이에 늘 간격이 있다.
 *    · 읽기: 새 열을 못 읽으면 옛 열로 다시 읽는다(전부 칸 표식).
 *    · 쓰기: 칸 표식은 옛 방식으로 쓴다. **줄 표식은 쓸 수 없다**(`laneMissing`) — 호출부(shift-relay)가 그 칸에
 *      그 교재 한 차수뿐일 때만 교시 통째로 대신하고, 아니면 이유를 밝혀 거절한다(조용히 바꾸면 줄 하나를 민다더니
 *      교시 통째로 밀린다).
 * 🔴 칸 표식을 지울 땐 `lane = ''`까지 건다 — 안 걸면 같은 칸의 줄 표식까지 함께 지운다.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { parseMarkerKey, type ShiftKind } from "../shift-key";

type Admin = ReturnType<typeof createAdminClient>;

export const MARKER_COLS = "id, class_id, plan_date, slot_start, kind, lane, pos";
export const LEGACY_MARKER_COLS = "id, class_id, plan_date, slot_start, kind";

export const LANE_MIGRATION_NEEDED = "줄마다 미루고 당기려면 마이그레이션 0381a가 필요합니다 — 적용한 뒤 다시 시도해 주세요";

/** 0381a 전이라 `lane`·`pos` 열이 없다는 오류인가(던진 Error든 PostgREST 오류 객체든). */
export function isMissingLaneColumn(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  const msg = String(e.message ?? (error instanceof Error ? error.message : error));
  if (e.code === "42703") return true;
  return /\b(lane|pos)\b/.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

/**
 * 표식 조회 — 새 열로 읽고, 열이 없으면 옛 열로 다시 읽는다. `run`은 열 목록을 받아 조회를 돌려준다
 * (호출부마다 거르는 조건이 달라 쿼리는 그쪽이 만든다).
 */
export async function withMarkerCols<T>(run: (cols: string) => Promise<T>): Promise<T> {
  try {
    return await run(MARKER_COLS);
  } catch (e) {
    if (!isMissingLaneColumn(e)) throw e;
    return run(LEGACY_MARKER_COLS);
  }
}

/**
 * 표식 한 개를 쓴다(`kind = null`이면 지운다). 성공이면 null, 아니면 화면에 보일 문구.
 * @param key `shift-key.ts` 모양(칸 표식 또는 줄 표식).
 */
export async function writeMarker(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  key: string;
  kind: ShiftKind | null;
  actor: string;
}): Promise<{ error: { code?: string; message?: string } | null; laneMissing?: boolean }> {
  const { admin, tenantId, classId, kind, actor } = input;
  const p = parseMarkerKey(input.key);
  if (!p) return { error: { message: "invalid marker key" } };
  const cell = { tenant_id: tenantId, class_id: classId, plan_date: p.date, slot_start: p.slot };
  const table = () => admin.from("class_lesson_shifts");
  const now = new Date().toISOString();

  if (kind === null) {
    const { error } = await table().delete().match({ ...cell, lane: p.lane, pos: p.pos });
    if (!error || !isMissingLaneColumn(error)) return { error };
    // 0381a 전 — 표가 칸 표식뿐이다. 줄 표식은 애초에 있을 수 없으니 지울 것도 없다.
    if (p.lane !== "") return { error: null };
    return { error: (await table().delete().match(cell)).error };
  }

  const { error } = await table().upsert(
    { ...cell, lane: p.lane, pos: p.pos, kind, created_by: actor, updated_at: now },
    { onConflict: "tenant_id,class_id,plan_date,slot_start,lane,pos" },
  );
  if (!error || !isMissingLaneColumn(error)) return { error };
  if (p.lane !== "") return { error, laneMissing: true };
  return {
    error: (
      await table().upsert(
        { ...cell, kind, created_by: actor, updated_at: now },
        { onConflict: "tenant_id,class_id,plan_date,slot_start" },
      )
    ).error,
  };
}
