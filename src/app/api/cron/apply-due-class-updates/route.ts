import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import {
  CLASS_UPDATES_APPLIED_KIND,
  SCHEDULED_CLASS_UPDATE_FLOOR,
  dueClassUpdates,
  shouldApplyClassroom,
  shouldApplyTeacher,
  type ClassUpdate,
  type SnapshotClassUpdates,
} from "@/features/timetable/due-class-updates";

/**
 * 예약 적용이 미뤄 둔 **담임·기본 강의실**을 기한이 된 날 반영하는 cron.
 *
 * 원장 2026-08-28: *"담임도 미래에 바뀌도록 해야겠는데"* + 자동 적용 선택. 배치는 `valid_from`으로 그날
 * 저절로 갈리지만 담임은 반 단위 단일 값이라 축이 없어, 0234a가 예약 적용 시 **안 바꾸고 스냅샷에만
 * 남겨 둔다**. 여기서 그 `classUpdates`를 재생한다.
 *
 * 🔴 **슬롯은 건드리지 않는다** — 가져오기가 시트대로 이미 정확히 넣었다. 기존 인수인계 적용
 *    (`applyHandover`)이 슬롯 담당까지 옮기는 것과 다른 점이고, 그게 이 경로를 따로 둔 이유다.
 * 🔴 **현재 값이 아직 예약 시점 그대로일 때만** 바꾼다 — 그 사이 사람이 손으로 정한 담임을 덮어쓰지 않는다.
 * ⚠️ 되돌린 스냅샷(`restored_at`)은 건너뛴다. 이미 재생한 스냅샷은 표식 로그로 거른다(두 번 안 돈다).
 * ⚠️ admin 클라이언트 = RLS 우회 → 모든 쓰기에 **tenant_id 명시 필터**.
 */
export const dynamic = "force-dynamic";

const MAX_SNAPSHOTS = 50; // 하루 상한 — 무한 스캔 금지(B2). 예약은 보통 0~2건이다.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstToday();
  const supabase = createAdminClient();

  // 기한이 됐고 아직 안 되돌린 배치 스냅샷. payload는 필요한 가지만 뽑는다(before/apply 전체는 무겁다).
  const { data: snapRows, error: snapErr } = await supabase
    .from("timetable_snapshots")
    .select("id, tenant_id, reference_date, updates:payload->apply->classUpdates")
    .lte("reference_date", today)
    .gt("reference_date", SCHEDULED_CLASS_UPDATE_FLOOR) // ⚠️ 바닥은 순수 모듈이 단일 소스(여기 숫자를 박지 말 것)
    .order("reference_date")
    .limit(MAX_SNAPSHOTS);
  if (snapErr) {
    reportError(snapErr, { where: "apply-due-class-updates:snapshots" });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
  const rows = (snapRows ?? []) as unknown as {
    id: string;
    tenant_id: string;
    reference_date: string;
    updates: ClassUpdate[] | null;
  }[];
  if (rows.length === 0) return NextResponse.json({ ok: true, applied: 0, snapshots: 0 });

  // 이미 재생했거나 되돌린 스냅샷 제외 — 표식은 둘 다 `timetable_import_logs`에 있다.
  const ids = rows.map((r) => r.id);
  const { data: logs } = await supabase
    .from("timetable_import_logs")
    .select("snapshot_id, restored_at, kind:result->>kind")
    .in("snapshot_id", ids);
  const skip = new Set<string>();
  for (const l of (logs ?? []) as unknown as {
    snapshot_id: string | null;
    restored_at: string | null;
    kind: string | null;
  }[]) {
    if (!l.snapshot_id) continue;
    if (l.restored_at || l.kind === CLASS_UPDATES_APPLIED_KIND) skip.add(l.snapshot_id);
  }

  const due: SnapshotClassUpdates[] = dueClassUpdates(
    rows
      .filter((r) => !skip.has(r.id))
      .map((r) => ({
        snapshotId: r.id,
        effectiveDate: String(r.reference_date).slice(0, 10),
        updates: Array.isArray(r.updates) ? r.updates : [],
      })),
    today,
  );

  let applied = 0;
  for (const snap of due) {
    const tenantId = rows.find((r) => r.id === snap.snapshotId)!.tenant_id;
    let appliedHere = 0;
    for (const u of snap.updates) {
      if (!u?.classId) continue;
      // 현재 값을 읽어 "예약 시점 그대로인가"를 본다 — 사람이 손댄 반은 그대로 둔다.
      const { data: cur } = await supabase
        .from("classes")
        .select("teacher_id, classroom_id")
        .eq("id", u.classId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!cur) continue;
      const patch: Record<string, string> = {};
      if (shouldApplyTeacher(u, cur.teacher_id)) patch.teacher_id = u.teacherId!;
      if (shouldApplyClassroom(u, cur.classroom_id)) patch.classroom_id = u.classroomId!;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase
        .from("classes")
        .update(patch)
        .eq("id", u.classId)
        .eq("tenant_id", tenantId);
      if (error) {
        reportError(error, { where: "apply-due-class-updates:update", classId: u.classId });
        continue;
      }
      applied += 1;
      appliedHere += 1;
    }
    // 표식 — 실패한 반이 있어도 남긴다(다음 날 같은 걸 통째로 다시 시도하면 사람이 손댄 값을 덮을 위험).
    await supabase.from("timetable_import_logs").insert({
      tenant_id: tenantId,
      week_label: snap.effectiveDate,
      snapshot_id: snap.snapshotId,
      result: { kind: CLASS_UPDATES_APPLIED_KIND, classes: snap.updates.length, applied: appliedHere },
      actor_id: null,
    });
  }

  return NextResponse.json({ ok: true, snapshots: due.length, applied });
}
