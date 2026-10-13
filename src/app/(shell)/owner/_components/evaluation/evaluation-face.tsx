import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { loadEvaluationConfig, loadPreviewRaws } from "@/features/teacher-portfolio/server/evaluation-store";
import { loadPresets } from "@/features/teacher-portfolio/server/preset-store";
import { getPortfolioGate, portfolioMonthKeys } from "@/features/teacher-portfolio/server/queries";
import { EvaluationEditor } from "./evaluation-editor";

/**
 * 학원 설정 → 강사평가(원장 2026-10-13). 원장 게이트(직원 포트폴리오와 같은 문)를 지난 사람만 본다 — 저장도 같은 문.
 * 미리보기는 이번 달(없으면 지난달) 강사별 **원래 수치**에 고친 설정을 얹어 화면에서 바로 다시 낸다(서버를 다시 안 다녀온다).
 */
export async function EvaluationFace() {
  const gate = await getPortfolioGate();
  if (!gate) return null;
  const admin = createAdminClient();
  const [current, previous] = portfolioMonthKeys();
  // 저장 액션과 같은 쓰기 판정(읽기 전용 보기·쓰기 권한) — 화면에서 미리 잠근다(저장해 보고 나서야 거절되지 않게).
  const [loaded, currentRows, saved, readOnly] = await Promise.all([
    loadEvaluationConfig(admin, gate.tenantId),
    loadPreviewRaws(admin, gate.tenantId, current),
    // 구성 목록은 곁가지 — 못 읽어도 설정 화면은 연다(기본 제공 구성은 그대로 쓸 수 있다).
    loadPresets(admin, gate.tenantId).catch((e: unknown) => {
      reportWarning("강사평가 구성 목록 조회 실패", { scope: "EvaluationFace", message: e instanceof Error ? e.message : String(e) });
      return { presets: [], tableMissing: false };
    }),
    (async () => {
      const user = await getCurrentUser({ teacherView: true });
      return !user || Boolean(await readonlyTeacherViewError()) || !(await canWriteTenant(user.systemRole, "class_review"));
    })(),
  ]);
  const month = currentRows.length ? current : previous;
  const rows = currentRows.length ? currentRows : await loadPreviewRaws(admin, gate.tenantId, previous);
  const users = await fetchInChunks<{ id: string; display_name: string | null }>(rows.map((r) => r.teacherId), (ids) =>
    admin.from("users").select("id, display_name").eq("tenant_id", gate.tenantId).in("id", ids));
  const nameOf = new Map(users.map((u) => [u.id, u.display_name || "강사"]));
  return (
    <EvaluationEditor
      initial={loaded.config}
      tableMissing={loaded.tableMissing}
      readOnly={readOnly}
      presets={saved.presets.map((p) => ({ id: p.id, name: p.name, config: p.config }))}
      presetsMissing={saved.tableMissing}
      preview={{
        month,
        rows: rows.map((r) => ({ teacherId: r.teacherId, name: nameOf.get(r.teacherId) ?? "강사", raws: r.raws }))
          .sort((a, b) => a.name.localeCompare(b.name, "ko")),
      }}
    />
  );
}
