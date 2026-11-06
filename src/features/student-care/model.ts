import { z } from "zod";
import { daysBetween } from "@/features/newcomers/onboarding-items";

/**
 * 상담 약속·인계 — 요구 → 약속(목표일·담당자) → 담당자 인수 → 실제 기록으로 이행 증거 → 관리자 완료 확인.
 * AX 인계본(2026-11-03)에서 이식(원장 2026-11-05 *"전부 가져온다"*). 순수 모듈이라 화면·서버가 같이 쓴다(server-only 금지 — #61).
 */
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1, "내용을 입력해 주세요").max(max);
export const careContentSchema = z.object({
  need: text(3000), promise: text(2000), criterion: text(1000),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
    const date = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, "올바른 목표일을 입력해 주세요"),
  ownerId: uuid, subject: z.string().trim().max(60), sourceId: uuid.nullable(),
}).strict();
export type CareContent = z.infer<typeof careContentSchema>;
export const evidenceSchema = z.object({
  kind: z.enum(["consultation", "lesson_report", "english_sheet", "math_sheet"]), recordId: uuid, note: text(1000),
}).strict();
export type CareEvidenceInput = z.infer<typeof evidenceSchema>;
export type CareEvidenceKind = CareEvidenceInput["kind"];
export const careDocumentSchema = z.object({
  revision: z.number().int().positive(), content: careContentSchema,
  state: z.enum(["open", "completed", "cancelled"]),
  acknowledged: z.object({ by: uuid, at: z.string().datetime() }).nullable(),
  evidence: z.array(evidenceSchema.extend({ revision: z.number().int().positive(), by: uuid, at: z.string().datetime() })).max(300),
  closed: z.object({ by: uuid, at: z.string().datetime(), reason: text(1000) }).nullable(),
}).strict();
export type CareDocument = z.infer<typeof careDocumentSchema>;
export type CareRecord = { id: string; studentId: string | null; intakeId?: string | null; version: number; document: CareDocument; updatedAt: string };
export const careTargetSchema = z.union([
  z.object({ studentId: uuid }).strict(), z.object({ intakeId: uuid }).strict(),
]);
export type CareTarget = z.infer<typeof careTargetSchema>;
export const targetHref = (target: CareTarget) => "studentId" in target ? careHref(target.studentId) : `/enrollment/${target.intakeId}/care`;
export const careCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), content: careContentSchema }).strict(),
  z.object({ kind: z.literal("revise"), content: careContentSchema, reason: text(1000) }).strict(),
  z.object({ kind: z.literal("acknowledge") }).strict(),
  z.object({ kind: z.literal("evidence"), evidence: evidenceSchema }).strict(),
  z.object({ kind: z.literal("complete"), reason: text(1000) }).strict(),
  z.object({ kind: z.literal("cancel"), reason: text(1000) }).strict(),
]);
export type CareCommand = z.infer<typeof careCommandSchema>;
/** `proxy` = '다른 강사 뷰'로 그 강사 명의를 쓰는 중 — 본인 확인(인수 확인)은 대신 하지 않는다(#154 · 전자결재 서명과 같은 결). */
export type CareActor = { id: string; canManage: boolean; canContribute: boolean; proxy: boolean };

/** 화면 문구 — 증거 종류(영문 키를 화면에 흘리지 않는다). */
export const EVIDENCE_KIND_LABEL: Record<CareEvidenceKind, string> = {
  consultation: "상담", lesson_report: "수업보고서", english_sheet: "영어 강사 시트", math_sheet: "수학 강사 시트",
};
/** 화면·감사로그 문구 — 저장 종류(이력 `student_care_events.kind`). 모르는 값은 '변경'으로. */
export const CARE_EVENT_LABEL: Record<string, string> = {
  create: "등록", revise: "내용 변경", acknowledge: "인수 확인", evidence: "기록 추가",
  complete: "완료 확인", cancel: "취소", student_linked: "학생 등록 연결",
};

/** 내용 변경은 새 버전이다. 이전 버전의 인수·증거를 새 버전의 완료 근거로 쓰지 않는다. */
export function transitionCare(current: CareDocument | null, command: CareCommand, actor: CareActor, at: string): CareDocument {
  if (["create", "revise", "complete", "cancel"].includes(command.kind) && !actor.canManage) throw new Error("약속을 관리할 권한이 없습니다");
  if (command.kind === "create") {
    if (current) throw new Error("이미 등록된 약속입니다");
    return { revision: 1, content: command.content, state: "open", acknowledged: null, evidence: [], closed: null };
  }
  if (!current) throw new Error("약속을 찾을 수 없습니다");
  if (command.kind === "revise") return { ...current, revision: current.revision + 1, content: command.content, state: "open", acknowledged: null, closed: null };
  if (current.state !== "open") throw new Error("종료된 약속입니다. 변경 사유를 남겨 새 버전으로 열어 주세요");
  if (command.kind === "acknowledge") {
    if (current.content.ownerId !== actor.id || !actor.canContribute) throw new Error("담당자 본인만 인수 확인할 수 있습니다");
    if (actor.proxy) throw new Error("담당자 본인만 인수 확인할 수 있습니다(강사뷰에서는 대신 확인하지 않습니다)");
    if (current.acknowledged) throw new Error("이미 인수 확인했습니다");
    return { ...current, acknowledged: { by: actor.id, at } };
  }
  if (command.kind === "evidence") {
    if (!actor.canManage && !(actor.canContribute && current.content.ownerId === actor.id)) throw new Error("이 약속의 증거를 제출할 권한이 없습니다");
    if (current.evidence.some((e) => e.revision === current.revision && e.kind === command.evidence.kind && e.recordId === command.evidence.recordId)) throw new Error("이번 버전에 이미 연결된 기록입니다");
    return careDocumentSchema.parse({ ...current, evidence: [...current.evidence, { ...command.evidence, revision: current.revision, by: actor.id, at }] });
  }
  if (command.kind === "complete") {
    if (!current.acknowledged) throw new Error("담당자 인수 확인이 필요합니다");
    if (!current.evidence.some((e) => e.revision === current.revision)) throw new Error("이번 버전의 이행 증거가 필요합니다");
  }
  return { ...current, state: command.kind === "complete" ? "completed" : "cancelled", closed: { by: actor.id, at, reason: command.reason } };
}

export function careStatus(doc: CareDocument, today: string, enrolledOn: string | null) {
  return {
    overdue: doc.state === "open" && doc.content.dueOn < today,
    handoffPending: doc.state === "open" && !doc.acknowledged,
    continuing: doc.state === "open" && !!enrolledOn && daysBetween(enrolledOn, today) > 90,
    currentEvidence: doc.evidence.filter((e) => e.revision === doc.revision),
  };
}

export const careHref = (studentId: string) => `/students/${studentId}/care`;
export const evidenceHref = (kind: CareEvidenceKind, id: string) => kind === "consultation" ? `/consultations/${id}` : kind === "english_sheet" || kind === "math_sheet" ? `/students/care/evidence/${kind}/${id}` : `/lesson_reports/${id}/print`;
