"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { careCommandSchema, careTargetSchema, careHref, targetHref, transitionCare, type CareEvidenceKind } from "../model";
import { careAccess, careStorageMessage, careStudent } from "./access";
import { CARE_COLUMNS, careRow } from "./queries";
import { intakeCareAccess } from "./intake-access";
import { careReferences, verifyEvidence } from "./records";
import { isCareStorageMissing } from "./errors";
import { logDbError } from "@/lib/supabase/db-error";

/** 우리 도메인 검증 메시지만 화면에 전달한다. DB·인증 기반층의 원문은 전달하지 않는다. */
function publicMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const expected = /^(로그인이 필요|약속을 |학생을 |담당자 본인|이미 |종료된 약속|이 약속|이번 버전|담당자 인수|증거 원본|다른 변경)/;
  return expected.test(message) ? message : fallback;
}

const requestSchema = z.object({ studentId: z.string().uuid().optional(), intakeId: z.string().uuid().optional(), id: z.string().uuid(), version: z.number().int().nonnegative(), command: careCommandSchema }).strict().refine((v) => !!v.studentId !== !!v.intakeId);
export async function saveCare(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "목표일·담당자·필수 내용을 확인해 주세요" };
  const { intakeId, id, version, command } = parsed.data;
  const target = intakeId ? { intakeId } : { studentId: parsed.data.studentId! };
  try {
    const intakeAccess = intakeId ? await intakeCareAccess(intakeId) : null;
    const studentId = intakeAccess ? intakeAccess.intake.studentId : parsed.data.studentId!;
    const access = intakeAccess ?? await careAccess(studentId!);
    const student = studentId ? await careStudent(studentId, access.user.tenantId) : null;
    const admin = createAdminClient();
    const result = await admin.from("student_care_commitments").select(CARE_COLUMNS).eq("tenant_id", access.user.tenantId).eq(intakeId ? "intake_id" : "student_id", intakeId ?? studentId!).eq("id", id).maybeSingle();
    if (result.error) return { ok: false, error: careStorageMessage(result.error) };
    const current = result.data ? careRow(result.data) : null;
    if (intakeId && current && current.studentId !== studentId) return { ok: false, error: "학생 연결이 변경되었습니다. 학생 기록에서 약속을 확인해 주세요" };
    if (current && !access.readAll && current.document.content.ownerId !== access.user.id) return { ok: false, error: "이 약속을 처리할 권한이 없습니다" };
    if ((current?.version ?? 0) !== version) return { ok: false, error: careStorageMessage({ code: "40001" }) };
    const next = transitionCare(current?.document ?? null, command, access.actor, new Date().toISOString());
    if (command.kind === "create" || command.kind === "revise") {
      const sourceId = next.content.sourceId;
      if (intakeId && sourceId !== intakeId) return { ok: false, error: "이 약속의 입학상담 원본은 변경할 수 없습니다" };
      if (sourceId && !intakeId) {
        if (!(await canAccessTenant(access.user.systemRole, "enrollment"))) return { ok: false, error: "입학상담 원본을 열람할 권한이 없습니다" };
        const source = await (await createClient()).from("enrollment_consultations").select("id").eq("tenant_id", access.user.tenantId).eq("student_id", studentId).eq("id", sourceId).maybeSingle();
        if (source.error || !source.data) return { ok: false, error: "이 학생의 입학상담 기록을 확인하지 못했습니다" };
      }
    }
    if ((command.kind === "evidence" || command.kind === "complete") && !studentId) return { ok: false, error: "학생 등록 후 이행 증거를 연결해 주세요" };
    if (command.kind === "evidence") await verifyEvidence(access.user, studentId!, command.evidence, access.readAll);
    if (command.kind === "complete") await Promise.all(next.evidence.filter((e) => e.revision === next.revision).map((e) => verifyEvidence(access.user, studentId!, e, access.readAll)));
    const extended = !!intakeId || next.evidence.some((e) => e.kind === "english_sheet" || e.kind === "math_sheet");
    const saved = await admin.rpc(extended ? "save_student_care_v2" : "save_student_care", { ...(extended ? { p_intake: intakeId ?? null } : {}), p_tenant: access.user.tenantId, p_student: studentId, p_id: id, p_actor: access.user.id,
      p_expected: version, p_kind: command.kind, p_reason: "reason" in command ? command.reason : null, p_document: next });
    if (saved.error) {
      // 시트 증거(v2 함수)는 s2_0029가 있어야 한다 — 그 함수만 없으면 무엇을 고르면 되는지 알린다.
      if (extended && saved.error.code === "PGRST202") return { ok: false, error: "강사 시트 기록 증거는 아직 준비되지 않았습니다. 상담·수업보고서 기록을 골라 주세요." };
      if (!isCareStorageMissing(saved.error) && saved.error.code !== "40001") logDbError(saved.error, "student-care.save", { commitmentId: id, kind: command.kind });
      return { ok: false, error: careStorageMessage(saved.error) };
    }
    // 감사로그(원장 2026-09-09 "기능 추가·변동은 모두") — 이력 표(student_care_events)와 별개로 감사 화면에도 남긴다. 실패해도 저장은 그대로(best-effort).
    await logAction({
      action: "student_care_save",
      targetType: studentId ? "student" : "enrollment_consultations",
      targetLabel: student?.name ?? intakeAccess?.intake.name ?? null,
      metadata: {
        studentId: studentId ?? null, intakeId: intakeId ?? null, commitmentId: id, kind: command.kind,
        revision: next.revision, version: typeof saved.data === "number" ? saved.data : version + 1,
        reason: "reason" in command ? command.reason : null,
        evidenceKind: command.kind === "evidence" ? command.evidence.kind : null,
      },
    });
    if (studentId) {
      revalidatePath(careHref(studentId));
      revalidatePath(`/explore/student/${studentId}`, "layout");
    }
    revalidatePath(targetHref(target));
    revalidatePath("/students/care");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicMessage(error, "약속 기록을 저장하지 못했습니다. 입력 내용을 확인해 주세요.") };
  }
}

export type CareEvidenceOption = { kind: CareEvidenceKind; id: string; label: string };
/** '기록 추가' 창이 열릴 때만 부른다(연결 탐색 첫 화면은 후보를 읽지 않는다 — 상담·보고서·시트 최근 50건씩). */
export async function listCareEvidenceOptions(studentId: string): Promise<{ ok: true; options: CareEvidenceOption[]; warning: string | null } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(studentId).success) return { ok: false, error: "학생을 확인하지 못했습니다" };
  try {
    const access = await careAccess(studentId);
    if (!access.actor.canManage && !access.actor.canContribute) return { ok: false, error: "이 약속의 증거를 제출할 권한이 없습니다" };
    const references = await careReferences(access.user, studentId, false, access.readAll);
    return { ok: true, options: references.evidence.map(({ kind, id, label }) => ({ kind, id, label })), warning: references.warning };
  } catch (error) {
    return { ok: false, error: publicMessage(error, "기록 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  }
}

export async function getCareHistory(input: string | { intakeId: string }, id: string) {
  const parsed = careTargetSchema.safeParse(typeof input === "string" ? { studentId: input } : input);
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return { error: "기록을 찾을 수 없습니다", events: [] };
  const target = parsed.data;
  const intakeAccess = "intakeId" in target ? await intakeCareAccess(target.intakeId) : null;
  const access = intakeAccess ?? await careAccess("studentId" in target ? target.studentId : undefined);
  const admin = createAdminClient();
  let query = admin.from("student_care_commitments").select("id").eq("tenant_id", access.user.tenantId).eq("intakeId" in target ? "intake_id" : "student_id", "intakeId" in target ? target.intakeId : target.studentId).eq("id", id);
  if (intakeAccess) query = intakeAccess.intake.studentId ? query.eq("student_id", intakeAccess.intake.studentId) : query.is("student_id", null);
  if (!access.readAll) query = query.eq("owner_id", access.user.id);
  const record = await query.maybeSingle();
  if (record.error || !record.data) return { error: "약속을 확인하지 못했습니다", events: [] };
  const result = await admin.from("student_care_events").select("version,kind,reason,created_at,document").eq("tenant_id", access.user.tenantId).eq("commitment_id", id).order("version", { ascending: false }).limit(100);
  return { error: result.error ? careStorageMessage(result.error) : null, events: result.data ?? [] };
}
