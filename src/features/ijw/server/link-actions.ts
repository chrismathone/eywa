"use server";

/**
 * aywa 학생 ↔ 인재원 학생 **짝 잇기·끊기**(students.ijw_student_id, 0259a).
 *
 * 🔴 게이트 = 학생 기록 관리(students **full**) — 학생 행을 바꾸는 일이라 강사(scoped)는 막는다
 *    (canManageStudentRecords와 같은 판정, 원장 2026-08-18 "강사는 열람 전용"). 감사로그를 남긴다.
 * 🔴 인재원 아이디는 **인재원 학생 목록에 실제로 있는 것만** 받는다 — 화면이 준 문자열을 믿지 않는다(#77).
 * 🔴 '한 번에 연결'은 **화면이 보여 준 짝 ∩ 서버가 다시 계산한 유일 짝**만 잇는다 — 클라 목록만 믿지도, 서버 목록을
 *    통째로 잇지도 않는다(확인한 것과 이어진 것이 같아야 한다, match.ts).
 * 🔴 감사로그는 **짝마다 한 줄**(학생 이름이 라벨) — 잘못 이은 짝을 나중에 이름으로 찾아 되짚을 수 있게.
 *    끊을 때도 **무엇이 걸려 있었는지**(옛 인재원 아이디)를 남긴다(적대 리뷰 2026-09-10).
 * ⚠️ 이미 짝이 있는 학생·이미 쓰인 아이디는 건드리지 않는다(유니크 인덱스가 최후 방어).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { reportError } from "@/lib/observability/report-error";
import { IJW_SCHEMAS } from "../contract";
import { isMissingIjwColumn } from "../db-errors";
import { IJW_PATHS, ijwGet } from "./client";
import { getIjwLinkSuggestions } from "./links";
import { pushIjwProfiles } from "./profile-push";

type Fail = { ok: false; error: string };
/** 한 짝의 결과 — 일괄 연결이 "건너뜀(그사이 연결됨)"과 "저장 실패"를 가르려고 원인을 싣는다. */
type LinkOne = { ok: true; name: string } | (Fail & { cause: "skip" | "db" });

const DENIED = "학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다";
const NOT_READY = "짝 칸이 아직 준비되지 않았습니다(DB 적용 전).";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function manager(): Promise<{ tenantId: string } | Fail> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canManageTenant(user.systemRole, "students"))) return { ok: false, error: DENIED };
  return { tenantId: user.tenantId };
}

/** 한 학생 잇기 — 그 학생에 짝이 없고, 그 아이디가 아직 아무에게도 안 걸렸을 때만. */
async function linkOne(tenantId: string, studentId: string, ijwId: string): Promise<LinkOne> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("students")
    .update({ ijw_student_id: ijwId })
    .eq("tenant_id", tenantId)
    .eq("id", studentId)
    .is("ijw_student_id", null)
    .select("name")
    .maybeSingle();
  if (error) {
    if (isMissingIjwColumn(error)) return { ok: false, error: NOT_READY, cause: "db" };
    if (error.code === "23505")
      return { ok: false, error: "이 인재원 아이디는 이미 다른 학생에게 연결돼 있습니다.", cause: "skip" };
    reportError(error, { scope: "ijw-link", step: "link" });
    return { ok: false, error: "연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", cause: "db" };
  }
  if (!data) return { ok: false, error: "이미 연결된 학생이거나 찾을 수 없는 학생입니다.", cause: "skip" };
  return { ok: true, name: (data as { name: string }).name };
}

export async function linkIjwStudent(input: { studentId: string; ijwId: string }): Promise<{ ok: true } | Fail> {
  const who = await manager();
  if ("ok" in who) return who;
  if (!UUID_RE.test(input.studentId ?? "")) return { ok: false, error: "학생 정보가 올바르지 않습니다." };
  const ijwId = (input.ijwId ?? "").trim();
  if (!ijwId) return { ok: false, error: "인재원 아이디가 비어 있습니다." };
  // 인재원에 실제로 있는 아이디인가 — 화면이 보낸 문자열을 그대로 믿지 않는다.
  const roster = await ijwGet(who.tenantId, IJW_PATHS.students(), IJW_SCHEMAS.students);
  if (!roster.ok) return { ok: false, error: roster.message };
  const target = roster.data.students.find((s) => s.ijwId === ijwId);
  if (!target) return { ok: false, error: "인재원 학생 목록에 없는 아이디입니다." };
  const res = await linkOne(who.tenantId, input.studentId, ijwId);
  if (!res.ok) return { ok: false, error: res.error };
  await logAction({
    action: "student_ijw_link",
    targetType: "student",
    targetLabel: res.name,
    metadata: { studentId: input.studentId, ijwId, ijwName: target.name },
  });
  // 새로 이은 학생의 학교·학년·생일을 인재원에 보낸다(원장 2026-10-08) — 응답 뒤에, 실패해도 연결은 그대로.
  const tenantId = who.tenantId;
  after(() => pushIjwProfiles(tenantId, { studentIds: [input.studentId] }));
  revalidatePath("/exams");
  return { ok: true };
}

/**
 * 짝 맞춘 학생 **전원**의 학교·학년·생년월일을 인재원에 지금 보낸다(원장 2026-10-08 *"전부 보내줘"*) — 하루 한 번 cron과 같은 일을
 * 사람이 바로 돌린다. 게이트는 짝 잇기와 같다(학생 기록 관리).
 */
export async function pushIjwProfilesNow(): Promise<
  { ok: true; sent: number; updated: number; notFound: number; invalid: number } | Fail
> {
  const who = await manager();
  if ("ok" in who) return who;
  const res = await pushIjwProfiles(who.tenantId);
  if (!res.ok) return { ok: false, error: res.message };
  await logAction({
    action: "ijw_profile_push",
    targetType: "student",
    targetLabel: `${res.sent}명`,
    metadata: {
      sent: res.sent,
      updated: res.updated,
      notFound: res.notFound.slice(0, 50),
      invalid: res.invalid.slice(0, 50),
    },
  });
  return { ok: true, sent: res.sent, updated: res.updated, notFound: res.notFound.length, invalid: res.invalid.length };
}

/** 짝 끊기 — 걸려 있던 아이디를 먼저 읽어 **그 값일 때만** 지우고(동시 변경 보호), 옛 아이디를 감사로그에 남긴다. */
export async function unlinkIjwStudent(studentId: string): Promise<{ ok: true; ijwId: string } | Fail> {
  const who = await manager();
  if ("ok" in who) return who;
  if (!UUID_RE.test(studentId ?? "")) return { ok: false, error: "학생 정보가 올바르지 않습니다." };
  const admin = createAdminClient();
  const { data: cur, error: readErr } = await admin
    .from("students")
    .select("name, ijw_student_id")
    .eq("tenant_id", who.tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (readErr) {
    if (isMissingIjwColumn(readErr)) return { ok: false, error: NOT_READY };
    reportError(readErr, { scope: "ijw-link", step: "unlink-read" });
    return { ok: false, error: "연결을 끊지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const row = cur as { name: string; ijw_student_id: string | null } | null;
  if (!row) return { ok: false, error: "학생을 찾지 못했습니다." };
  if (!row.ijw_student_id) return { ok: false, error: "이미 연결이 끊긴 학생입니다. 화면을 새로 고쳐 주세요." };
  const { data, error } = await admin
    .from("students")
    .update({ ijw_student_id: null })
    .eq("tenant_id", who.tenantId)
    .eq("id", studentId)
    .eq("ijw_student_id", row.ijw_student_id)
    .select("id")
    .maybeSingle();
  if (error) {
    reportError(error, { scope: "ijw-link", step: "unlink" });
    return { ok: false, error: "연결을 끊지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!data) return { ok: false, error: "그사이 연결이 바뀌었습니다. 화면을 새로 고쳐 주세요." };
  await logAction({
    action: "student_ijw_unlink",
    targetType: "student",
    targetLabel: row.name,
    metadata: { studentId, ijwId: row.ijw_student_id },
  });
  revalidatePath("/exams");
  return { ok: true, ijwId: row.ijw_student_id };
}

const BULK_MAX = 200;

/**
 * '한 번에 연결' — **화면이 보여 준 짝**만, 그것도 누르는 순간 서버가 다시 계산해 **여전히 유일한 것**만 잇는다.
 * 🔴 입력 없이 서버 목록을 통째로 잇던 첫 구현은 확인 목록에 3쌍이 떠 있어도 그사이 생긴 4번째 짝까지 이었다
 *    (적대 재리뷰 2026-09-10). 이제 화면에 없던 짝은 잇지 않고, 화면에 있었지만 더는 유일하지 않은(또는 그사이 이어진)
 *    짝은 `dropped`로 돌려준다 — 화면이 누구인지 적는다.
 */
export async function linkIjwUniqueMatches(input: { pairs: { ijwId: string; studentId: string }[] }): Promise<
  { ok: true; linked: number; dropped: string[]; skipped: string[]; failed: number } | Fail
> {
  const who = await manager();
  if ("ok" in who) return who;
  const raw = Array.isArray(input?.pairs) ? input.pairs : null;
  if (!raw || raw.length === 0) return { ok: false, error: "연결할 짝이 없습니다." };
  if (raw.length > BULK_MAX) return { ok: false, error: `한 번에 ${BULK_MAX}명까지만 연결할 수 있습니다.` };
  const shown = new Map<string, string>(); // 화면이 보여 준 짝: ijwId → studentId
  for (const p of raw) {
    const ijwId = typeof p?.ijwId === "string" ? p.ijwId.trim() : "";
    const studentId = typeof p?.studentId === "string" ? p.studentId : "";
    if (!ijwId || ijwId.length > 100 || !UUID_RE.test(studentId)) {
      return { ok: false, error: "연결할 짝 정보가 올바르지 않습니다. 화면을 새로 고쳐 주세요." };
    }
    shown.set(ijwId, studentId);
  }
  const res = await getIjwLinkSuggestions(who.tenantId);
  if (!res.ok) return { ok: false, error: res.message };
  if (res.columnMissing) return { ok: false, error: NOT_READY };
  const nowUnique = new Map<string, { studentId: string; ijwName: string }>();
  for (const s of res.suggestions) if (s.unique) nowUnique.set(s.ijw.ijwId, { studentId: s.unique.id, ijwName: s.ijw.name });
  const pairs: { studentId: string; ijwId: string; ijwName: string }[] = [];
  const dropped: string[] = [];
  for (const [ijwId, studentId] of shown) {
    const u = nowUnique.get(ijwId);
    if (u && u.studentId === studentId) pairs.push({ studentId, ijwId, ijwName: u.ijwName });
    else dropped.push(ijwId);
  }
  const skipped: string[] = [];
  let failed = 0;
  const done: { studentId: string; ijwId: string; ijwName: string; studentName: string }[] = [];
  // 10개씩 — 한꺼번에 수백 개를 쏘면 DB 연결을 붙잡는다.
  for (let i = 0; i < pairs.length; i += 10) {
    const chunk = pairs.slice(i, i + 10);
    const results = await Promise.all(chunk.map((p) => linkOne(who.tenantId, p.studentId, p.ijwId)));
    results.forEach((r, k) => {
      if (r.ok) done.push({ ...chunk[k]!, studentName: r.name });
      else if (r.cause === "db") failed++;
      else skipped.push(chunk[k]!.ijwId);
    });
  }
  // 🔴 짝마다 한 줄 — "N명" 한 줄은 학생 이름으로 찾을 수 없어 잘못 이은 짝을 되짚지 못한다.
  for (let i = 0; i < done.length; i += 10) {
    await Promise.all(
      done.slice(i, i + 10).map((d) =>
        logAction({
          action: "student_ijw_link_bulk",
          targetType: "student",
          targetLabel: d.studentName,
          metadata: { studentId: d.studentId, ijwId: d.ijwId, ijwName: d.ijwName },
        }),
      ),
    );
  }
  if (done.length > 0) // 이번에 이은 학생들의 학교·학년·생일을 인재원에 보낸다(원장 2026-10-08) — 응답 뒤에.
  if (done.length) {
    const tenantId = who.tenantId;
    const ids = done.map((d) => d.studentId);
    after(() => pushIjwProfiles(tenantId, { studentIds: ids }));
  }
  revalidatePath("/exams");
  return { ok: true, linked: done.length, dropped, skipped, failed };
}
