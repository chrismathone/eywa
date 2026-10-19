"use server";

import { after } from "next/server";
import { logAction } from "@/features/audit/server/log";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { isMemoSheetSubject } from "../doc";
import { packedSheetSchema, type PackedSheet } from "../pack";
import { memoSheetAccess } from "./access";
import { loadMemoSheet } from "./store";

/**
 * 메모 시트 저장 — 화면은 고칠 때마다(잠깐 멈춘 뒤) 문서 통째를 보낸다.
 * 🔴 **version 비교**: 화면이 들고 있던 version일 때만 갈아끼운다. 다르면 다른 사람이 먼저 저장한 것 —
 *    덮지 않고 최신 판을 돌려줘 화면이 고르게 한다(늦게 저장한 사람이 앞 저장을 조용히 되돌리는 것 방지, [[#142]]).
 * 🔴 게이트 = 화면과 같은 `memoSheetAccess`(#77). 내용 검증 = 화면이 쓰는 것과 같은 스키마(pack.ts).
 * 감사로그(`timetable_memo_sheet_save`)는 같은 사람이 10분 안에 또 저장하면 한 줄로 친다(자동 저장이라 줄이 폭증한다).
 */

export type SaveMemoSheetResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; conflict: true; version: number; packed: PackedSheet; updatedAt: string | null }
  | { ok: false; conflict?: false; error: string };

const TABLE = "timetable_memo_sheets";
const AUDIT_ACTION = "timetable_memo_sheet_save";
const AUDIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;

export async function saveMemoSheet(input: { subject: string; packed: unknown; baseVersion: number }): Promise<SaveMemoSheetResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "다시 로그인해 주세요" };
  if (!isMemoSheetSubject(input.subject)) return { ok: false, error: "이 과목에는 시트가 없습니다" };
  if (!(await memoSheetAccess(user)).canEdit) return { ok: false, error: "시트를 고칠 권한이 없습니다" };
  const parsed = packedSheetSchema.safeParse(input.packed);
  if (!parsed.success) return { ok: false, error: "저장할 수 없는 값이 있습니다. 마지막으로 고친 칸을 확인해 주세요." };
  const doc = parsed.data;
  // 바이트로 잰다(DB 검사 `octet_length`와 같은 단위 — 한글은 한 글자 3바이트).
  if (Buffer.byteLength(JSON.stringify(doc), "utf8") > MAX_BYTES) return { ok: false, error: "시트가 너무 큽니다. 쓰지 않는 행·열을 지워 주세요." };
  const base = input.baseVersion;
  if (!Number.isInteger(base) || base < 0) return { ok: false, error: "잘못된 요청입니다" };

  const admin = createAdminClient();
  const savedAt = new Date().toISOString();
  const row = { doc, updated_at: savedAt, updated_by: user.id };
  const fallback = "시트를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  let version: number;
  if (base === 0) {
    const { error } = await admin.from(TABLE).insert({ tenant_id: user.tenantId, subject: input.subject, version: 1, ...row });
    if (error) {
      if (error.code === "23505") return conflict(user.tenantId, input.subject);
      return { ok: false, error: explainDbError(error, { scope: "timetableMemo.save.insert", fallback }).message };
    }
    version = 1;
  } else {
    const { data, error } = await admin
      .from(TABLE)
      .update({ ...row, version: base + 1 })
      .eq("tenant_id", user.tenantId)
      .eq("subject", input.subject)
      .eq("version", base)
      .select("version")
      .maybeSingle();
    if (error) return { ok: false, error: explainDbError(error, { scope: "timetableMemo.save.update", fallback }).message };
    if (!data) return conflict(user.tenantId, input.subject);
    version = data.version as number;
  }

  const actorId = user.id;
  const tenantId = user.tenantId;
  const subject = input.subject;
  after(async () => {
    const since = new Date(Date.now() - AUDIT_WINDOW_MS).toISOString();
    const { data: recent } = await createAdminClient()
      .from("audit_logs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .eq("action", AUDIT_ACTION)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0 && version > 1) return;
    await logAction({
      action: AUDIT_ACTION,
      targetType: "timetable_memo_sheet",
      targetLabel: "시간표 메모 시트",
      metadata: { subject, version, rows: doc.rows, cols: doc.cols, cells: doc.cells.length },
    });
  });
  return { ok: true, version, savedAt };
}

async function conflict(tenantId: string, subject: string): Promise<SaveMemoSheetResult> {
  const latest = await loadMemoSheet(tenantId, subject);
  if (latest.status !== "ok") return { ok: false, error: "시트를 다시 불러오지 못했습니다. 새로고침해 주세요." };
  return { ok: false, conflict: true, version: latest.version, packed: latest.packed, updatedAt: latest.updatedAt };
}
