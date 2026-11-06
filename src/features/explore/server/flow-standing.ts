import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { studentStatusLabel } from "@/features/students/status/status-labels";

/**
 * 원생 흐름 분석 프롬프트의 ‘지금 상태’ 재료 — 재원·휴원·퇴원과 지금 다니는 반(원장 2026-11-06 *"재원 퇴원 휴원 상태 구분해서 분석할 수 있도록"*).
 * 갱신([`flow-insights.ts`](./flow-insights.ts) `refreshFlowInsight`)만 쓴다 — 세션 없는 밤 배치에서도 돌아 admin 클라이언트 + 지점 필터.
 */
type Admin = ReturnType<typeof createAdminClient>;
export type CurrentClasses = { active: string[]; onHold: string[]; upcoming: { name: string; from: string }[] };

/**
 * 오늘 다니는 반(시작했고 종료가 지나지 않은 수강 — 반 이동은 반열림 · `isEnrollmentEndedOn` 한 곳) · 대기(on_hold) 반 · 배정 예정(오늘 뒤 시작).
 * 🔑 예정 수강은 흐름의 기록이 아니다(아직 일어나지 않았다) — 지금 상태 줄에 '배정 예정'으로만 싣는다.
 */
export async function loadCurrentClasses(admin: Admin, tenantId: string, studentId: string, today: string): Promise<CurrentClasses> {
  const { data, error } = await admin
    .from("enrollments")
    .select("start_date, end_date, is_transferred, on_hold, class:class_id ( class_name )")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    // 프리필터(#125) — 답은 아래 isEnrollmentEndedOn.
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (error) throw new Error(`수강 조회 실패: ${error.message}`);
  const out: CurrentClasses = { active: [], onHold: [], upcoming: [] };
  type Row = { start_date: string; end_date: string | null; is_transferred: boolean | null; on_hold: boolean | null; class: { class_name?: string } | { class_name?: string }[] | null };
  for (const e of (data ?? []) as Row[]) {
    if (isEnrollmentEndedOn(e.end_date, today, e.is_transferred ?? false)) continue;
    const name = (Array.isArray(e.class) ? e.class[0] : e.class)?.class_name ?? "반";
    if (e.start_date > today) out.upcoming.push({ name, from: e.start_date });
    else (e.on_hold ? out.onHold : out.active).push(name);
  }
  return { active: [...new Set(out.active)], onHold: [...new Set(out.onHold)], upcoming: out.upcoming.sort((a, b) => a.from.localeCompare(b.from)) };
}

/**
 * 프롬프트의 '지금 상태' 한 줄 — 재원(다니는 반 · 대기 중인 반 · 배정 예정 · 퇴원 예정) · 휴원(원생 전체) · 퇴원(날짜). 상태 이름은 원생 상태 라벨 그대로.
 * 🔑 반 하나만 쉬는 것은 휴원이 아니라 '과목 대기'다(원장 2026-09-16 · `hold-selection.ts`) — '휴원'은 원생 전체 휴원에만.
 * `classes` = null이면 반을 못 읽은 것(보조 재료라 갱신은 계속 — 상태 이름만 싣는다).
 */
export function standingLine(status: string, withdrawnOn: string | null, classes: CurrentClasses | null, today: string): string {
  // 퇴원일이 비면 날짜 없이 '퇴원'만(모델이 날짜를 지어내지 않게 — 자리표시자 금지 · '기록 없음' 같은 재료 문구도 싣지 않는다).
  if (status === "withdrawn") return `퇴원${withdrawnOn ? `(${withdrawnOn})` : ""} — 지금 다니는 반 없음`;
  const head = status === "on_hold" ? "휴원(원생 전체)" : (studentStatusLabel(status) ?? "상태 모름");
  // 반을 못 읽었으면 상태만(‘못 읽음’을 적으면 모델이 그 말을 분석에 옮긴다).
  if (!classes) return head;
  const parts: string[] = [];
  if (classes.active.length) parts.push(`수강 중 ${classes.active.join(", ")}`);
  // 원생 전체 휴원이면 반도 모두 쉰다 — '그 반만 쉼'은 재원생의 과목 대기에만.
  if (classes.onHold.length) parts.push(`${status === "on_hold" ? "쉬는 반" : "대기 중인 반(그 반만 쉼)"} ${classes.onHold.join(", ")}`);
  if (classes.upcoming.length) parts.push(`배정 예정 ${classes.upcoming.map((u) => `${u.name}(${u.from}부터)`).join(", ")}`);
  if (withdrawnOn && withdrawnOn > today) parts.push(`퇴원 예정 ${withdrawnOn}`);
  return `${head} — ${parts.length ? parts.join(" · ") : "지금 다니는 반 없음"}`;
}
