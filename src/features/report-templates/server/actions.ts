"use server";

/**
 * 사용자 템플릿 — 목록·저장·삭제 서버 액션(내 템플릿만).
 *
 * 🔑 목록도 서버 액션이다 — 원스크린 첫 화면(강사 전원이 매일 여는 자리)이 이 표를 읽지 않게
 *    템플릿 칸을 **열 때** 가져온다([[#95]]: 전원이 매일 쓰는 경로에 새 표를 끼우지 않는다).
 * 🔴 게이트: 로그인한 직원 + (저장·삭제는) '다른 강사 뷰'(열람 전용)가 아닐 것. 내 것만 고치므로 메뉴 권한은 보지 않는다
 *    (강사·겸직 관리자·사무실 모두 자기 템플릿은 가진다). '내'는 강사뷰면 대상 강사다(actor 주석).
 * 🔴 admin 클라이언트라 RLS를 우회한다 → 모든 조회·변경에 tenant_id·owner_id를 명시한다
 *    (template-guard.test.ts가 호출 모양을 잠근다).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { BUILTIN_ENGLISH_TEMPLATES, TEMPLATE_SUBJECT, type ReportTemplate } from "../defaults";
import { checkTemplateInput } from "../validate";

type Fail = { ok: false; error: string };

const NOT_READY = "템플릿 저장소가 아직 준비되지 않았습니다(DB 적용 전). 기본 템플릿은 그대로 쓸 수 있습니다.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 표가 아직 없는가(SQL 미적용). 🔴 **표 없음만** 본다 — 'does not exist'·PGRST201/202를 넓게 잡으면 컬럼 없음(42703)
 * 같은 다른 사실까지 "DB 적용 전"으로 둔갑하고 reportError도 건너뛴다(원인 단정 금지, 적대 리뷰 2026-09-10).
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /42P01|PGRST205|Could not find the table/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

/**
 * 템플릿의 주인 — '다른 강사 뷰'면 **대상 강사 X**(원장 2026-11-05 강사뷰 전수: X 화면에 A의 템플릿이 뜨고 A 소유로 저장되던 것).
 * 읽기(목록)는 열람 전용 강사뷰에서도 X의 템플릿을 보여 준다 — 저장·삭제만 막는다(write).
 */
async function actor(write: boolean): Promise<{ tenantId: string; userId: string } | Fail> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.systemRole === "student") return { ok: false, error: "로그인이 필요합니다." };
  if (write) {
    const readonly = await readonlyTeacherViewError();
    if (readonly) return { ok: false, error: readonly };
  }
  return { tenantId: user.tenantId, userId: user.id };
}

function toTemplate(row: { id: string; name: string; body: string }): ReportTemplate {
  return { id: row.id, name: row.name, body: row.body, builtIn: false };
}

/** 내 템플릿 목록 — 맨 앞은 항상 기본 템플릿(둘: 기본 · 인재원 결과지). 표가 없거나 조회가 실패해도 기본 템플릿은 준다. */
export async function listMyReportTemplates(): Promise<{ templates: ReportTemplate[]; notice: string | null }> {
  const who = await actor(false);
  if ("ok" in who) return { templates: [...BUILTIN_ENGLISH_TEMPLATES], notice: who.error };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("report_templates")
    .select("id, name, body")
    .eq("tenant_id", who.tenantId)
    .eq("owner_id", who.userId)
    .eq("subject", TEMPLATE_SUBJECT)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { templates: [...BUILTIN_ENGLISH_TEMPLATES], notice: NOT_READY };
    reportError(error, { scope: "report-templates", step: "list" });
    return { templates: [...BUILTIN_ENGLISH_TEMPLATES], notice: "내 템플릿을 불러오지 못했습니다. 기본 템플릿으로 계속할 수 있습니다." };
  }
  return { templates: [...BUILTIN_ENGLISH_TEMPLATES, ...(data ?? []).map(toTemplate)], notice: null };
}

/** 저장 — id가 있으면 내 템플릿 수정, 없으면 새로 만들기. 기본 템플릿은 고칠 수 없다(복사해서 만든다). */
export async function saveMyReportTemplate(input: {
  id?: string | null;
  name: string;
  body: string;
}): Promise<{ ok: true; template: ReportTemplate } | Fail> {
  const who = await actor(true);
  if ("ok" in who) return who;
  if (input.id && !UUID_RE.test(input.id)) {
    return { ok: false, error: "기본 템플릿은 고칠 수 없습니다. '복사해서 새로 만들기'로 내 템플릿을 만들어 주세요." };
  }
  const checked = checkTemplateInput(input);
  if (!checked.ok) return checked;

  const admin = createAdminClient();
  const res = input.id
    ? await admin
        .from("report_templates")
        .update({ name: checked.name, body: checked.body, updated_at: new Date().toISOString() })
        .eq("tenant_id", who.tenantId)
        .eq("owner_id", who.userId)
        .eq("id", input.id)
        .select("id, name, body")
        .maybeSingle()
    : await admin
        .from("report_templates")
        .insert({
          tenant_id: who.tenantId,
          owner_id: who.userId,
          subject: TEMPLATE_SUBJECT,
          name: checked.name,
          body: checked.body,
        })
        .select("id, name, body")
        .single();
  if (res.error) {
    if (isMissingTable(res.error)) return { ok: false, error: NOT_READY };
    if (res.error.code === "23505") return { ok: false, error: "같은 이름의 템플릿이 이미 있습니다. 이름을 바꿔 주세요." };
    reportError(res.error, { scope: "report-templates", step: "save" });
    return { ok: false, error: "템플릿을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!res.data) return { ok: false, error: "템플릿을 찾지 못했습니다(이미 지워졌을 수 있습니다)." };
  return { ok: true, template: toTemplate(res.data) };
}

/** 삭제 — 내 템플릿만. 기본 템플릿은 지울 수 없다. */
export async function deleteMyReportTemplate(id: string): Promise<{ ok: true } | Fail> {
  const who = await actor(true);
  if ("ok" in who) return who;
  if (!UUID_RE.test(id ?? "")) return { ok: false, error: "기본 템플릿은 지울 수 없습니다." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("report_templates")
    .delete()
    .eq("tenant_id", who.tenantId)
    .eq("owner_id", who.userId)
    .eq("id", id);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: NOT_READY };
    reportError(error, { scope: "report-templates", step: "delete" });
    return { ok: false, error: "템플릿을 지우지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true };
}
