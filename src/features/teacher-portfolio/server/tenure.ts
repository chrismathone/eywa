import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import type { ActivityTeacherChange, Tenure } from "../model/homeroom-history";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 재직 기간 재료(2026-11-11 — 퇴원관리 '강사별 퇴원율 추이'에서 강사평가 담당 판정으로 옮겼다).
 *
 * 퇴사한 강사의 퇴사일 — `users`에 퇴사일 칸이 없어 학원 비서와 같은 순서로 찾는다(`assistant/server/prompt.ts` '재직 기간 끝'):
 * ① 계약 이력의 퇴사 메모(`staff_contracts` kind='note' · terms에 '퇴사' · start_date — 직원관리 퇴사 처리가 남기는 줄) 중 가장 늦은 날
 * ② 없으면 퇴사 처리 감사 기록(`audit_logs` staff_status_change → inactive)의 날(한국 날짜 — 실제보다 늦게 처리했을 수 있다)
 * ③ 둘 다 없으면 모른다(null — 자르지 않는다: 근무한 달을 지우는 쪽이 더 나쁘다).
 * 🔴 admin으로 읽는다 → tenant_id 필수(#104). 대상은 재직 중이 아닌 사람만 넘긴다(복직한 사람의 옛 퇴사 줄로 자르지 않게).
 */
export async function loadResignDates(admin: SupabaseClient, tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const notes = await fetchInChunks<{ user_id: string; start_date: string | null }>([...userIds], (chunk) =>
    admin.from("staff_contracts").select("user_id, start_date").eq("tenant_id", tenantId).eq("kind", "note")
      .ilike("terms", "%퇴사%").in("user_id", chunk));
  for (const n of notes) {
    if (!n.start_date || !YMD.test(n.start_date)) continue;
    if (!out.has(n.user_id) || out.get(n.user_id)! < n.start_date) out.set(n.user_id, n.start_date);
  }
  const rest = userIds.filter((id) => !out.has(id));
  if (!rest.length) return out;
  const audits = await fetchInChunks<{ created_at: string; user_id: string | null }>(rest, (chunk) =>
    admin.from("audit_logs").select("created_at, user_id:metadata->>userId").eq("tenant_id", tenantId)
      .eq("action", "staff_status_change").eq("metadata->>to", "inactive").in("metadata->>userId", chunk));
  for (const a of audits) {
    if (!a.user_id) continue;
    const day = kstToday(new Date(a.created_at));
    if (!out.has(a.user_id) || out.get(a.user_id)! < day) out.set(a.user_id, day);
  }
  return out;
}

/**
 * 지점 직원의 재직 기간 — 입사일(`users.hire_date`) · 퇴사일(재직 중이 아닌 사람만 `loadResignDates`). 둘 다 모르면 넣지 않는다(자르지 않는다).
 * 강사평가 스냅숏과 퇴원관리 담당 판정(`loadChurnSource`)이 같은 함수로 읽는다 — 화면마다 재직 기간이 갈리지 않게.
 */
export async function loadTenure(admin: SupabaseClient, tenantId: string): Promise<Map<string, Tenure>> {
  const users = await fetchAllPaged<{ id: string; hire_date: string | null; status: string | null }>((a, b) =>
    admin.from("users").select("id, hire_date, status").eq("tenant_id", tenantId).order("id").range(a, b));
  const resign = await loadResignDates(admin, tenantId, users.filter((u) => u.status !== "active").map((u) => u.id));
  const out = new Map<string, Tenure>();
  for (const u of users) {
    const hireDate = u.hire_date ?? null;
    // 입사일보다 앞선 퇴사 기록은 옛 재직의 것(재입사 — 실측: 2026-01 입사 · 2023-02 퇴사 메모) — 지금 재직을 자르지 않는다.
    const raw = resign.get(u.id) ?? null;
    const resignDate = raw && hireDate && raw < hireDate.slice(0, 10) ? null : raw;
    if (hireDate || resignDate) out.set(u.id, { hireDate, resignDate });
  }
  return out;
}

/**
 * 반 담임 변경 — DB 트리거가 모든 쓰기 경로를 남기는 `activity_log`(classes.teacher_id old→new). 감사로그에 안 남는 일괄 인계·시트 적용 등까지
 * 담임 이력에 들어오게 한다(`homeroom-history.ts mergeHomeroomChanges` · 실측 2026-11-11: 교체 132건 중 62건이 감사로그에 없었다).
 * 🔴 admin → tenant_id 필수(#104) · 전건 페이징(B2).
 */
export async function loadTeacherChanges(admin: SupabaseClient, tenantId: string): Promise<ActivityTeacherChange[]> {
  const rows = await fetchAllPaged<{ row_id: string | null; created_at: string; old: string | null; new: string | null }>((a, b) =>
    admin.from("activity_log").select("row_id, created_at, old:changed->teacher_id->>old, new:changed->teacher_id->>new")
      .eq("tenant_id", tenantId).eq("table_name", "classes").not("changed->teacher_id", "is", null)
      .order("created_at").order("id").range(a, b) as unknown as PromiseLike<{ data: { row_id: string | null; created_at: string; old: string | null; new: string | null }[] | null; error: { message: string } | null }>);
  return rows.flatMap((r) => r.row_id ? [{ classId: r.row_id, at: r.created_at, oldTeacherId: r.old ?? null, newTeacherId: r.new ?? null }] : []);
}

/**
 * 지운 계정 → 지금 계정(같은 사람). 직원 계정을 다시 만들며 옛 계정을 지운 일이 있다(실측 2026-11-11: 김태건·이수연·전양원·육소희·크리스틴·Dom
 * — 반 담임이 옛 계정 id로 남았다가 새 계정으로 바뀐 줄이 activity_log에 '담임 변경'으로 남는다). 지운 계정의 이름(`activity_log` users DELETE의
 * target_label)이 지금 계정 하나의 이름·영문 이름과 같을 때만 잇는다 — 둘 이상이면 잇지 않는다(동명이인을 합치지 않게).
 */
export async function loadTeacherAliases(admin: SupabaseClient, tenantId: string): Promise<Map<string, string>> {
  const [users, deleted] = await Promise.all([
    fetchAllPaged<{ id: string; display_name: string | null; english_name: string | null }>((a, b) =>
      admin.from("users").select("id, display_name, english_name").eq("tenant_id", tenantId).order("id").range(a, b)),
    fetchAllPaged<{ row_id: string | null; target_label: string | null }>((a, b) =>
      admin.from("activity_log").select("row_id, target_label").eq("tenant_id", tenantId).eq("table_name", "users").eq("op", "DELETE")
        .order("created_at").order("id").range(a, b)),
  ]);
  const key = (s: string | null) => (s ?? "").trim().toLowerCase();
  const byName = new Map<string, string[]>();
  for (const u of users) for (const n of new Set([key(u.display_name), key(u.english_name)])) if (n) (byName.get(n) ?? byName.set(n, []).get(n)!).push(u.id);
  const live = new Set(users.map((u) => u.id));
  const out = new Map<string, string>();
  for (const d of deleted) {
    if (!d.row_id || live.has(d.row_id)) continue;
    const hits = [...new Set(byName.get(key(d.target_label)) ?? [])];
    if (hits.length === 1) out.set(d.row_id, hits[0]!);
  }
  return out;
}
