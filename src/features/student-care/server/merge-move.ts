import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";
import { isCareStorageMissing } from "./errors";

/**
 * 병합이 약속을 잃지 않게 — 약속 표는 서버 전용(정책 0개)이고 병합 DB 함수는 호출한 사람 권한(security invoker)으로 돌아
 * 그 안에서 못 옮긴다. admin + 지점 필터로 병합 **전에** 옮기고, 병합이 실패하면 되돌린다.
 * 표·칸이 없으면(SQL s2_0028·s2_0029 미적용) 옮길 것이 없다(#95).
 */

type Doc = { content?: { sourceId?: string | null } & Record<string, unknown> } & Record<string, unknown>;
type Row = { id: string; version: number; student_id: string | null; intake_id?: string | null; source_id: string | null; document: Doc };
type Fields = { student_id: string | null; intake_id?: string | null; source_id: string | null; document: Doc };
/** 옮긴 약속 하나 — 되돌릴 때 쓴다(옮기기 전 칸 · 옮긴 뒤 버전). */
export type MovedCare = { id: string; before: Fields; version: number };

/** 버전을 올려 칸을 바꾸고(열려 있던 화면은 '다른 변경'으로 새로 읽게) 이력 한 줄을 남긴다. 이력은 best-effort. */
async function rewrite(admin: ReturnType<typeof createAdminClient>, tenantId: string, actorId: string, id: string, fromVersion: number, patch: Fields, reason: string, logIt: boolean) {
  const up = await admin.from("student_care_commitments").update({ ...patch, version: fromVersion + 1, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).eq("version", fromVersion).select("id");
  if (up.error || (up.data ?? []).length !== 1) {
    if (up.error) logDbError(up.error, "student-care.merge.consultations.move", { commitmentId: id });
    return false;
  }
  if (logIt) {
    const ev = await admin.from("student_care_events").insert({ tenant_id: tenantId, commitment_id: id, version: fromVersion + 1, actor_id: actorId, kind: "merge_moved", reason, document: patch.document });
    if (ev.error) logDbError(ev.error, "student-care.merge.consultations.event", { commitmentId: id });
  }
  return true;
}

/**
 * 신규 콜&상담 병합 — 진 쪽 상담에 걸린 약속을 이긴 쪽 상담으로 옮긴다(**병합이 진 쪽을 지우기 전에**).
 *  · 등록 전 약속(학생 없음) = 이긴 쪽 상담으로 + 병합 뒤 이긴 쪽의 학생(`finalStudentId`)에게(안 이으면 입학상담 약속 화면에서 숨는다 ·
 *    병합이 학생을 바꾸는 경우까지 — 학생 연결 트리거는 null → 값만 본다).
 *  · 학생에게 이어진 약속 = 병합 뒤 이긴 쪽의 학생(`finalStudentId`)과 같은 학생일 때만 옮긴다 — 다른 학생이면 그대로 둔다
 *    (진 쪽이 지워지면 출처 칸만 비워지고 그 학생의 약속으로 남는다 · 다른 학생의 상담에 잇으면 저장이 영영 막힌다).
 * 🔴 안 옮기면 진 쪽 삭제 때 등록 전 약속은 트리거가 함께 지운다(s2_0029). 실패하면 이미 옮긴 것을 되돌리고 `ok: false`(병합을 멈춘다).
 */
export async function moveCareToMergeWinner(args: {
  tenantId: string; actorId: string; winnerId: string; finalStudentId: string | null; loserIds: string[];
}): Promise<{ ok: true; moved: MovedCare[] } | { ok: false }> {
  const { tenantId, actorId, winnerId, finalStudentId, loserIds } = args;
  if (loserIds.length === 0) return { ok: true, moved: [] };
  const admin = createAdminClient();
  const list = loserIds.join(",");
  const full = await admin.from("student_care_commitments").select("id,version,student_id,intake_id,source_id,document").eq("tenant_id", tenantId).or(`intake_id.in.(${list}),source_id.in.(${list})`);
  let error = full.error;
  let rows = (full.data ?? []) as Row[];
  // s2_0028만 적용된 DB — 입학상담 칸(intake_id)도 이력 종류 'merge_moved'도 없다. 출처(source_id)만 옮기고 이력은 남기지 않는다.
  let extended = true;
  if (full.error && ["42703", "PGRST204"].includes(full.error.code ?? "")) {
    extended = false;
    const lite = await admin.from("student_care_commitments").select("id,version,student_id,source_id,document").eq("tenant_id", tenantId).in("source_id", loserIds);
    error = lite.error;
    rows = (lite.data ?? []) as Row[];
  }
  if (error) {
    if (isCareStorageMissing(error)) return { ok: true, moved: [] };
    logDbError(error, "student-care.merge.consultations.read");
    return { ok: false };
  }
  const losers = new Set(loserIds);
  const moved: MovedCare[] = [];
  for (const row of rows) {
    const intakeOnly = !row.student_id;
    if (!intakeOnly && row.student_id !== finalStudentId) continue;
    const before: Fields = { student_id: row.student_id, source_id: row.source_id, document: row.document, ...(extended ? { intake_id: row.intake_id ?? null } : {}) };
    const content = row.document?.content;
    const patch: Fields = {
      student_id: intakeOnly ? finalStudentId : row.student_id,
      source_id: row.source_id && losers.has(row.source_id) ? winnerId : row.source_id,
      document: content?.sourceId && losers.has(content.sourceId) ? { ...row.document, content: { ...content, sourceId: winnerId } } : row.document,
      ...(extended ? { intake_id: row.intake_id && losers.has(row.intake_id) ? winnerId : (row.intake_id ?? null) } : {}),
    };
    if (!(await rewrite(admin, tenantId, actorId, row.id, row.version, patch, "신규 콜&상담 병합으로 이긴 쪽 상담에 옮김", extended))) {
      await revertCareMerge(tenantId, actorId, moved, extended);
      return { ok: false };
    }
    moved.push({ id: row.id, before, version: row.version + 1 });
  }
  return { ok: true, moved };
}

/** 병합 DB 함수가 실패했을 때 — 옮긴 약속을 옮기기 전 칸으로 되돌린다(버전은 한 번 더 올린다 · 이력도 남긴다). */
export async function revertCareMerge(tenantId: string, actorId: string, moved: readonly MovedCare[], logIt = true): Promise<void> {
  if (moved.length === 0) return;
  const admin = createAdminClient();
  for (const m of moved) {
    const ok = await rewrite(admin, tenantId, actorId, m.id, m.version, m.before, "병합이 실패해 옮기기를 되돌림", logIt);
    if (!ok) logDbError(new Error("약속 옮기기를 되돌리지 못했습니다"), "student-care.merge.consultations.revert", { commitmentId: m.id });
  }
}

/**
 * 원생 병합 — 진 쪽 학생의 약속을 남는 학생으로(보조 이동 · 실패해도 병합은 멈추지 않고 로그만 — 소개한 원생 옮기기와 같은 결).
 * 증거로 이은 상담·원생상담은 병합이 함께 옮기므로 그대로 이어진다. ⚠️ 수업보고서는 병합 대상 밖이라 진 쪽 학생 앞 보고서 증거는
 * 완료 확인 때 학생이 달라 확인에 실패한다 — 내용 변경(새 차수)으로 증거를 다시 고르면 된다(알려진 한계).
 */
export async function moveCareToKeeperStudent(tenantId: string, mergeeId: string, keeperId: string): Promise<number> {
  try {
    const res = await createAdminClient().from("student_care_commitments").update({ student_id: keeperId }, { count: "exact" }).eq("tenant_id", tenantId).eq("student_id", mergeeId);
    if (res.error) {
      if (!isCareStorageMissing(res.error)) logDbError(res.error, "student-care.merge.students");
      return 0;
    }
    return res.count ?? 0;
  } catch (e) {
    // 보조 이동 — 어떤 실패도 병합(이미 기록을 옮긴 뒤)을 멈추지 않는다.
    logDbError(e, "student-care.merge.students");
    return 0;
  }
}
