import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { menuGate } from "@/lib/auth/menu-gate";
import type { MenuKey } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { workRequestSchema, validateWorkTransition, type WorkRecord } from "./model";

/**
 * 업무 작성센터 서버 — aywa-next(c694e027d)의 업무 서식 저장을 옮겼다(2026-11-11 · 표 s2_0065).
 * 문 = 역할·권한 '업무 작성센터'(work_records). 작성 = 그 권한 쓰기(전체·담당) · 검토 = 원장·관리자·매니저 + 그 권한 '전체'.
 * 작성 중 문서는 본인에게만 · 검토자는 검토 요청·확인된 문서만 받는다(남의 초안은 안 본다).
 */
const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];
const REVIEW_ROLES = ["master", "admin", "manager"];

export async function workAccess() {
  const gate = await menuGate("work_records");
  if (!gate || !STAFF_ROLES.includes(gate.user.systemRole)) throw Error("업무 작성 권한을 확인해 주세요");
  const reviewRole = REVIEW_ROLES.includes(gate.user.systemRole);
  // seeReview = 검토함을 읽는가(지점 보기에서도 원장 자리 그대로) · canReview = 실제로 검토를 저장할 수 있는가.
  return { user: gate.user, canWrite: gate.write, canReview: gate.manage && reviewRole, seeReview: gate.readAll && reviewRole };
}

/** 바로가기 카드가 보는 메뉴 — 각 화면의 문과 같은 권한(#77). */
const SHORTCUT_KEYS = ["okr", "work_records", "ecs", "mcs", "teacher_onescreen", "lesson_reports", "consultations", "enrollment", "newcomers", "students", "meetings", "approvals", "documents"] as const satisfies readonly MenuKey[];

export async function loadWorkRecords() {
  const gate = await workAccess(), db = createAdminClient();
  const [rows, access] = await Promise.all([
    fetchAllPaged<WorkRecord>((a, b) => {
      let q = db.from("academy_work_records").select("id,author_id,version,document,updated_at").eq("tenant_id", gate.user.tenantId);
      q = gate.seeReview ? q.or(`author_id.eq.${gate.user.id},document->>state.in.(submitted,reviewed)`) : q.eq("author_id", gate.user.id);
      return q.order("updated_at", { ascending: false }).order("id").range(a, b);
    }),
    Promise.all(SHORTCUT_KEYS.map(async (key) => ({ key, read: await canAccessTenant(gate.user.systemRole, key) }))),
  ]);
  return { rows, actorId: gate.user.id, canWrite: gate.canWrite, canReview: gate.canReview, seeReview: gate.seeReview, today: kstToday(), access };
}
export type WorkRecordsData = Awaited<ReturnType<typeof loadWorkRecords>>;

export async function saveWorkRecord(raw: unknown) {
  const input = workRequestSchema.parse(raw), gate = await workAccess();
  if (input.action === "review" ? !gate.canReview : !gate.canWrite) throw Error(input.action === "review" ? "문서를 검토할 권한이 없습니다" : "업무 문서 작성 권한이 없습니다");
  const db = createAdminClient();
  const { data: old, error } = await db.from("academy_work_records").select("id,author_id,version,document,updated_at").eq("tenant_id", gate.user.tenantId).eq("id", input.id).maybeSingle();
  if (error) throw Error("기록을 확인하지 못했습니다");
  // 버전이 앞선 재시도는 저장 함수의 요청 장부가 판정한다(같은 요청 = 같은 결과 · 바뀐 옛 요청 = 충돌).
  if (!old || old.version === input.version) validateWorkTransition(old as WorkRecord | null, input.document, gate.user.id, gate.canReview, input.action);
  const saved = await db.rpc("save_academy_work_record", { p_tenant: gate.user.tenantId, p_actor: gate.user.id, p_request: input.requestId, p_id: input.id, p_expected: input.version, p_review: input.action === "review", p_document: input.document });
  if (saved.error) {
    console.error("[work-records] save", saved.error.code, saved.error.message);
    const m = saved.error.message;
    throw Error(m.includes("version_conflict") ? "다른 변경이 있습니다. 새로고침 후 확인해 주세요." : m.includes("invalid_document") ? "문서 내용을 확인해 주세요. 제목은 2자 이상, 검토 요청에는 목적·내용·결과가 필요하고 너무 긴 문서는 나누어 저장합니다." : "저장하지 못했습니다. 권한과 문서 상태를 확인해 주세요.");
  }
  return saved.data as { id: string; version: number };
}
