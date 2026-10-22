"use server";

import { after } from "next/server";
import { logAction } from "@/features/audit/server/log";
import { memoSheetAccess } from "@/features/timetable-memo/server/access";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { clampMemoSize, isCellMemoSubject, isYmd, MEMO_BODY_MAX, MEMO_LABEL_MAX, memoPlaceLabel, normalizeMemoBody, type CellMemo } from "../rules";
import { CELL_MEMO_COLS, CELL_MEMO_TABLE, isCellMemoTableMissing, loadCellMemoRow, loadTeacherIndex, rowToCellMemo, toCellMemo, type CellMemoRow } from "./store";

/**
 * 칸 메모 저장 · 지우기 · 상자 크기 — 화면은 입력하는 대로(잠깐 멈춘 뒤) 부른다(저장 버튼 없음).
 * 🔴 게이트 = 화면과 같은 `memoSheetAccess`(#77 — 보기 = 시간표 열람 · 편집 = 시간표 '전체' · 강사 화면 없음). 서버가 다시 판정한다.
 * 🔴 **version 비교**: 화면이 들고 있던 version일 때만 바꾼다. 다르면 다른 사람이 먼저 고친 것 — 덮지 않고 최신을 돌려준다.
 * 🔴 admin 키(정책 0개) → 모든 쓰기에 tenant_id. 감사로그 = 추가·수정·삭제(이전 내용은 metadata.before).
 *    같은 사람이 이어서 고치는 자동 저장은 10분 안이면 한 줄로 친다(앞 수정자가 다른 사람이면 언제나 남긴다).
 */

type Conflict = { ok: false; conflict: true; latest: CellMemo | null };
type Failure = { ok: false; conflict?: false; error: string };
export type CellMemoSaveResult = { ok: true; memo: CellMemo } | Conflict | Failure;
export type CellMemoDeleteResult = { ok: true } | Conflict | Failure;

const UNAVAILABLE = "메모를 저장할 준비가 아직 끝나지 않았습니다. 잠시 뒤 다시 시도해 주세요.";
const BAD = "잘못된 요청입니다";
const ACTION = { add: "timetable_cell_memo_add", update: "timetable_cell_memo_update", delete: "timetable_cell_memo_delete" } as const;
const AUDIT_WINDOW_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function editor(): Promise<CurrentUser | Failure> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "다시 로그인해 주세요" };
  if (!(await memoSheetAccess(user)).canEdit) return { ok: false, error: "메모를 고칠 권한이 없습니다" };
  return user;
}

function fail(e: unknown, scope: string, fallback: string): Failure {
  if (isCellMemoTableMissing(e as { message?: string; code?: string })) return { ok: false, error: UNAVAILABLE };
  return { ok: false, error: explainDbError(e, { scope, fallback }).message };
}

/** 저장 행 → 화면 메모(수정자 이름까지 — 직원 조회 한 번). */
async function named(tenantId: string, row: CellMemoRow, col: string): Promise<CellMemo> {
  return toCellMemo(row, await loadTeacherIndex(tenantId), col)!;
}

async function conflictWith(tenantId: string, row: CellMemoRow | null, col: string): Promise<Conflict> {
  return { ok: false, conflict: true, latest: row ? await named(tenantId, row, col) : null };
}

type Place = { memoId: string; subject: string; date: string; startMin: number; col: string };

function audit(kind: keyof typeof ACTION, user: CurrentUser, place: Place, extra: { before?: string; collapsible?: boolean }) {
  const { tenantId, id: actorId } = user;
  after(async () => {
    if (extra.collapsible) {
      const since = new Date(Date.now() - AUDIT_WINDOW_MS).toISOString();
      const { data: recent } = await createAdminClient()
        .from("audit_logs")
        .select("metadata")
        .eq("tenant_id", tenantId)
        .eq("actor_id", actorId)
        .in("action", [ACTION.add, ACTION.update])
        .gte("created_at", since)
        .limit(100);
      if ((recent ?? []).some((r) => (r.metadata as { memoId?: unknown } | null)?.memoId === place.memoId)) return;
    }
    await logAction({
      action: ACTION[kind],
      targetType: "timetable_cell_memo",
      targetLabel: memoPlaceLabel(place.date, place.startMin, place.col),
      metadata: { ...place, ...(extra.before !== undefined ? { before: extra.before } : {}) },
    });
  });
}

export async function saveCellMemo(input: {
  subject: string; date: string; col: string; startMin: number;
  id: string | null; baseVersion: number; body: string; width?: number | null; height?: number | null;
}): Promise<CellMemoSaveResult> {
  const user = await editor();
  if (!("tenantId" in user)) return user;
  const col = typeof input.col === "string" ? input.col.trim() : "";
  const { subject, date, startMin, id, baseVersion: base } = input;
  if (!isCellMemoSubject(subject) || !isYmd(date) || !Number.isInteger(startMin) || startMin < 0 || startMin > 1439) return { ok: false, error: BAD };
  if (!col || col.length > MEMO_LABEL_MAX || !Number.isInteger(base) || base < 0) return { ok: false, error: BAD };
  if (id === null ? base !== 0 : typeof id !== "string" || !UUID.test(id) || base < 1) return { ok: false, error: BAD };
  const body = normalizeMemoBody(input.body);
  if (body === null) return { ok: false, error: "비어 있는 메모는 저장하지 않습니다" };
  if (body === "too_long") return { ok: false, error: `메모는 ${MEMO_BODY_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다` };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  try {
    if (id === null) {
      const teacherKey = (await loadTeacherIndex(user.tenantId)).resolver.keyOf(col);
      const size = input.width != null || input.height != null ? clampMemoSize(input.width, input.height) : null;
      const { data, error } = await admin
        .from(CELL_MEMO_TABLE)
        .insert({
          tenant_id: user.tenantId, subject, memo_date: date, teacher_key: teacherKey, teacher_label: col, start_min: startMin, body,
          box_w: size?.width ?? null, box_h: size?.height ?? null, version: 1,
          created_by: user.id, updated_by: user.id, created_at: now, updated_at: now,
        })
        .select(CELL_MEMO_COLS)
        .single();
      if (error) {
        // 같은 칸에 다른 사람이 먼저 메모를 달았다 — 그 메모를 돌려준다(덮지 않는다).
        if (error.code === "23505") return conflictWith(user.tenantId, await loadCellMemoRow(user.tenantId, { subject, date, teacherKey, startMin }), col);
        return fail(error, "timetableCellMemo.insert", "메모를 저장하지 못했습니다");
      }
      const row = data as CellMemoRow;
      audit("add", user, { memoId: row.id, subject, date, startMin, col }, {});
      return { ok: true, memo: rowToCellMemo(row, col, user.displayName) };
    }

    const prev = await loadCellMemoRow(user.tenantId, { id });
    if (!prev || prev.version !== base) return conflictWith(user.tenantId, prev, col);
    if (prev.body === body) return { ok: true, memo: await named(user.tenantId, prev, col) };
    const { data, error } = await admin
      .from(CELL_MEMO_TABLE)
      .update({ body, version: base + 1, updated_at: now, updated_by: user.id })
      .eq("tenant_id", user.tenantId)
      .eq("id", id)
      .eq("version", base)
      .select(CELL_MEMO_COLS)
      .maybeSingle();
    if (error) return fail(error, "timetableCellMemo.update", "메모를 저장하지 못했습니다");
    if (!data) return conflictWith(user.tenantId, await loadCellMemoRow(user.tenantId, { id }), col);
    const row = data as CellMemoRow;
    audit("update", user, { memoId: row.id, subject: row.subject, date: row.memo_date, startMin: row.start_min, col }, {
      before: prev.body,
      collapsible: prev.updated_by === user.id,
    });
    return { ok: true, memo: rowToCellMemo(row, col, user.displayName) };
  } catch (e) {
    return fail(e, "timetableCellMemo.save", "메모를 저장하지 못했습니다");
  }
}

export async function deleteCellMemo(input: { id: string; baseVersion: number; col: string }): Promise<CellMemoDeleteResult> {
  const user = await editor();
  if (!("tenantId" in user)) return user;
  const { id, baseVersion: base } = input;
  const col = typeof input.col === "string" ? input.col.trim().slice(0, MEMO_LABEL_MAX) : "";
  if (typeof id !== "string" || !UUID.test(id) || !Number.isInteger(base) || base < 1) return { ok: false, error: BAD };
  try {
    const prev = await loadCellMemoRow(user.tenantId, { id });
    if (!prev) return { ok: true }; // 이미 지워졌다 — 바라던 결과와 같다.
    if (prev.version !== base) return conflictWith(user.tenantId, prev, col || prev.teacher_label);
    const { data, error } = await createAdminClient()
      .from(CELL_MEMO_TABLE)
      .delete()
      .eq("tenant_id", user.tenantId)
      .eq("id", id)
      .eq("version", base)
      .select("id");
    if (error) return fail(error, "timetableCellMemo.delete", "메모를 지우지 못했습니다");
    if (!data || data.length === 0) return conflictWith(user.tenantId, await loadCellMemoRow(user.tenantId, { id }), col || prev.teacher_label);
    audit("delete", user, { memoId: id, subject: prev.subject, date: prev.memo_date, startMin: prev.start_min, col: col || prev.teacher_label }, {
      before: prev.body,
    });
    return { ok: true };
  } catch (e) {
    return fail(e, "timetableCellMemo.delete", "메모를 지우지 못했습니다");
  }
}

/** 상자 크기만 — 내용 수정이 아니라 version·수정 시각·수정자를 바꾸지 않는다(구글 시트와 같은 결 · 감사로그 없음). */
export async function resizeCellMemo(input: { id: string; width: number; height: number }): Promise<{ ok: true } | Failure> {
  const user = await editor();
  if (!("tenantId" in user)) return user;
  if (typeof input.id !== "string" || !UUID.test(input.id)) return { ok: false, error: BAD };
  const size = clampMemoSize(input.width, input.height);
  const { data, error } = await createAdminClient()
    .from(CELL_MEMO_TABLE)
    .update({ box_w: size.width, box_h: size.height })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "timetableCellMemo.resize", "크기를 저장하지 못했습니다");
  return data ? { ok: true } : { ok: false, error: "메모를 찾지 못했습니다" };
}
