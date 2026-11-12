import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { monthRange } from "@/lib/date-kst";
import { pickTopWorker, type ClassWorker, type WorkerCount } from "../class-worker";

/**
 * 그 달 반별 **"누가 수업했나"** — 규칙·문구는 [`class-worker.ts`](../class-worker.ts) 단일 소스.
 *
 * 근거 순서: 수업보고서 작성자 → (없으면) 출결 기록자 → (없으면) 없음.
 * ⚠️ **보고서가 있는 반은 출결을 아예 안 물어본다** — 두 번째 왕복이 필요한 반만 좁혀서 묻는다.
 * ⚠️ admin 클라이언트라 `tenant_id` 필터 필수([[#104]]). 반 id는 수십 개라 청크(B3).
 * 🔴 반 100개 × 한 달 보고서·출결은 한 청크가 1,000행을 넘는다 → `fetchAllPagedInChunks` + `.order("id")`(B2 — 청크 안 절단이면
 *    꼬리 반의 이름이 사라지거나 최다 1명이 바뀐다). 조회 실패는 로그를 남기고 그 근거만 비운다(표시 전용 라벨 — 화면을 막지 않는다).
 */
export async function getMonthlyClassWorkers(
  tenantId: string,
  month: string,
  classIds: readonly string[],
): Promise<Map<string, ClassWorker>> {
  const out = new Map<string, ClassWorker>();
  if (classIds.length === 0) return out;
  const { from, to } = monthRange(month);
  const admin = createAdminClient();

  const reports = await fetchAllPagedInChunks<{ class_id: string; teacher_name: string | null }>(
    [...classIds],
    (chunk, f, t) =>
      admin
        .from("lesson_reports")
        .select("class_id, teacher_name")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .gte("report_date", from)
        .lte("report_date", to)
        .order("id")
        .range(f, t),
  ).catch((e: unknown) => logFail("lesson_reports", e));
  tally(reports.map((r) => ({ classId: r.class_id, name: r.teacher_name })), "report", out);

  // 보고서가 없는 반만 출결로 — 영어가 여기 해당한다(보고서를 aywa에 안 쓴다).
  const rest = classIds.filter((id) => !out.has(id));
  if (rest.length === 0) return out;
  const marks = await fetchAllPagedInChunks<{ class_id: string; recorded_by: string | null }>([...rest], (chunk, f, t) =>
    admin
      .from("attendance_records")
      .select("class_id, recorded_by")
      .eq("tenant_id", tenantId)
      .in("class_id", chunk)
      .gte("session_date", from)
      .lte("session_date", to)
      .order("id")
      .range(f, t),
  ).catch((e: unknown) => logFail("attendance_records", e));
  const ids = [...new Set(marks.map((m) => m.recorded_by).filter((v): v is string => !!v))];
  const nameOf = new Map<string, string>();
  if (ids.length > 0) {
    const users = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
    ).catch((e: unknown) => logFail("users", e));
    for (const u of users) if (u.display_name) nameOf.set(u.id, u.display_name);
  }
  tally(
    marks.map((m) => ({ classId: m.class_id, name: m.recorded_by ? (nameOf.get(m.recorded_by) ?? null) : null })),
    "attendance",
    out,
  );
  return out;
}

function logFail(table: string, e: unknown): never[] {
  console.error(`[class-worker] ${table} 조회 실패 — 그 근거 없이 표시합니다`, e);
  return [];
}

/** (반, 이름) 건수를 세어 반마다 최다 1명을 담는다 — 이미 담긴 반은 건드리지 않는다(근거 우선순위 보존). */
function tally(
  rows: readonly { classId: string; name: string | null }[],
  source: ClassWorker["source"],
  out: Map<string, ClassWorker>,
): void {
  const byClass = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const m = byClass.get(r.classId) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) + 1);
    byClass.set(r.classId, m);
  }
  for (const [classId, counts] of byClass) {
    if (out.has(classId)) continue;
    const list: WorkerCount[] = [...counts].map(([name, count]) => ({ name, count }));
    const top = pickTopWorker(list, source);
    if (top) out.set(classId, top);
  }
}
