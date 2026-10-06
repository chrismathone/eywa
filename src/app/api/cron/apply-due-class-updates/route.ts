import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import {
  CLASS_UPDATES_APPLIED_KIND,
  SCHEDULED_CLASS_UPDATE_FLOOR,
  dueClassUpdates,
  shouldApplyClassroom,
  shouldApplyName,
  shouldApplyTeacher,
  type ClassUpdate,
  type SnapshotClassUpdates,
} from "@/features/timetable/due-class-updates";
import { readScheduledGroupPlan } from "@/features/timetable/scheduled-groups";
import { applyScheduledGroupPlan } from "@/features/owner/server/scheduled-groups";
import { tenantSettingsTag } from "@/features/owner/server/queries";
import { normalizeClassName, reservedClassNameReason } from "@/features/classes/class-name";

/**
 * 예약 적용이 미뤄 둔 **담임·기본 강의실·반 이름·통합뷰 그룹 배치**를 기한이 된 날 반영하는 cron.
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
 * ⚠️ 통합뷰 그룹 배치(원장 2026-08-29 *"그룹설정까지 예약걸면 안되는거야?"*)도 시간 축이 없어 같은 문제다 —
 *    같은 스냅샷에 실어 여기서 함께 재생한다(취소 ×가 스냅샷을 되돌리면 이 예약도 같이 사라진다).
 */
export const dynamic = "force-dynamic";

const MAX_SNAPSHOTS = 50; // 하루 상한 — 무한 스캔 금지(B2). 예약은 보통 0~2건이다.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstToday();
  const supabase = createAdminClient();

  // 기한이 됐고 아직 안 되돌린 배치 스냅샷. payload는 필요한 가지만 뽑는다(before/apply 전체는 무겁다).
  const { data: snapRows, error: snapErr } = await supabase
    .from("timetable_snapshots")
    .select(
      "id, tenant_id, reference_date, updates:payload->apply->classUpdates, groups:payload->apply->integrationGroups",
    )
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
    groups: unknown;
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
        // 옛 스냅샷엔 이 키가 없어 PostgREST가 null을 준다 — 모양이 안 맞으면 null(있는 척 금지).
        groups: readScheduledGroupPlan(r.groups),
      })),
    today,
  );

  let applied = 0;
  let groupsApplied = 0;
  for (const snap of due) {
    const tenantId = rows.find((r) => r.id === snap.snapshotId)!.tenant_id;
    let appliedHere = 0;
    // 적용하지 않은 반 이름(규칙 위반) — 표식·감사로그에 **이유와 함께** 남긴다(조용히 '적용됨'으로 넘기지 않는다).
    const skippedNames: { classId: string; name: string; reason: string }[] = [];
    for (const u of snap.updates) {
      if (!u?.classId) continue;
      // 현재 값을 읽어 "예약 시점 그대로인가"를 본다 — 사람이 손댄 반은 그대로 둔다.
      const { data: cur } = await supabase
        .from("classes")
        .select("teacher_id, classroom_id, class_name")
        .eq("id", u.classId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!cur) continue;
      const patch: Record<string, string> = {};
      // 감사로그 `class_update`와 **같은 모양**(field/from/to) — 화면이 "변경: 반 이름 A → B"로 렌더한다.
      const changes: { field: string; from: string | null; to: string | null }[] = [];
      if (shouldApplyTeacher(u, cur.teacher_id)) {
        patch.teacher_id = u.teacherId!;
        changes.push({ field: "담임", from: cur.teacher_id, to: u.teacherId! });
      }
      if (shouldApplyClassroom(u, cur.classroom_id)) {
        patch.classroom_id = u.classroomId!;
        changes.push({ field: "강의실", from: cur.classroom_id, to: u.classroomId! });
      }
      // 예약 당시엔 없던 규칙(2026-09-30)에 걸리는 이름은 적용하지 않는다 — ClassNote 1인 보드·전체방 이름과 겹친다.
      // 담임·강의실은 그대로 적용하고, 이름만 빠진 사실을 감사로그(`skipped`)·표식에 이유와 함께 남긴다.
      const reservedName = shouldApplyName(u, cur.class_name) ? reservedClassNameReason(u.className) : null;
      const skipped = reservedName ? [{ field: "반 이름", to: normalizeClassName(u.className), reason: reservedName }] : [];
      if (reservedName) {
        skippedNames.push({ classId: u.classId, name: normalizeClassName(u.className), reason: reservedName });
        console.warn(`[예약 적용] 반 이름 변경 건너뜀 — "${normalizeClassName(u.className)}": ${reservedName}`);
      }
      if (shouldApplyName(u, cur.class_name) && normalizeClassName(u.className) && !reservedName) {
        // 시트에서 온 이름이라 공백이 섞일 수 있다 — 저장값과 감사로그가 같은 글자이게 정리해서 쓴다(class-name.ts).
        patch.class_name = normalizeClassName(u.className!);
        changes.push({ field: "반 이름", from: cur.class_name, to: patch.class_name });
      }
      if (Object.keys(patch).length === 0) {
        if (skipped.length) {
          const { error: skipAuditErr } = await supabase.from("audit_logs").insert({
            tenant_id: tenantId,
            actor_id: null,
            actor_name: "시스템(시간표 예약 적용)",
            action: "class_update",
            target_type: "class",
            target_label: cur.class_name,
            metadata: { classId: u.classId, changed: [], changes: [], skipped, scheduledFrom: snap.effectiveDate, snapshotId: snap.snapshotId },
          });
          if (skipAuditErr) reportError(skipAuditErr, { where: "apply-due-class-updates:audit-skip", classId: u.classId });
        }
        continue;
      }
      const { error } = await supabase
        .from("classes")
        .update(patch)
        .eq("id", u.classId)
        .eq("tenant_id", tenantId);
      if (error) {
        reportError(error, { where: "apply-due-class-updates:update", classId: u.classId });
        continue;
      }
      // 🔴 감사로그는 **선택이 아니다**. ① 반 이름 변경은 이력이 남는 유일한 자리다(이름 컬럼엔 시간 축이
      //    없어 지난 화면에도 새 이름이 보인다 — "그때는 무엇이었나"가 여기에만 남는다).
      //    ② 담임 전이는 지난 주 담임 복원(`teacher-as-of`)이 `class_handover_apply`·`class_update` 로그를
      //    읽어 되살린다 — cron이 조용히 바꾸면 그 전이가 이력에서 통째로 빠진다.
      // ⚠️ `logAction`은 세션 사용자가 있어야 동작한다(cron엔 없다) → admin으로 직접 넣고 actor는 시스템.
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor_id: null,
        actor_name: "시스템(시간표 예약 적용)",
        action: "class_update",
        target_type: "class",
        target_label: patch.class_name ?? cur.class_name,
        metadata: {
          classId: u.classId,
          changed: changes.map((c) => c.field),
          changes,
          scheduledFrom: snap.effectiveDate,
          snapshotId: snap.snapshotId,
          ...(skipped.length ? { skipped } : {}),
          // 이전 담임도 함께 — 없으면 담임 이력이 "이 날부터 새 담임"만 알아, 그 전 구간을 맡았던 사람이 이력에서 빠진다
          // (손으로 바꾼 로그·시트 가져오기 로그는 이미 남긴다. 출석부가 '그 달에 담임이었나'를 이 이력으로 본다).
          ...(patch.teacher_id ? { newTeacherId: patch.teacher_id, previousTeacherId: cur.teacher_id ?? null } : {}),
        },
      });
      // 기록 실패가 본 작업을 되돌리진 않는다(logAction과 같은 best-effort) — 대신 보이게 남긴다.
      if (auditErr) reportError(auditErr, { where: "apply-due-class-updates:audit", classId: u.classId });
      applied += 1;
      appliedHere += 1;
    }
    // ── 통합뷰 그룹 배치(줄) 예약 ────────────────────────────────────────────
    // 🔴 **반 이름 재생 뒤에** 돈다. 배치는 반 **id**로 가리키므로 순서가 결과를 바꾸진 않지만,
    //    이름이 먼저 정리돼야 실패 시 로그를 사람이 읽고 판단할 수 있다.
    // ⚠️ 그룹 적용 실패가 담임·이름 재생을 되돌리지 않는다(각자 독립) — 대신 표식에 남긴다.
    let groupResult: { status: string; reason?: string; groups?: number } | null = null;
    if (snap.groups) {
      try {
        groupResult = await applyScheduledGroupPlan(supabase, tenantId, snap.groups);
        if (groupResult.status === "applied") {
          groupsApplied += 1;
          // 학원 설정은 tenantId별 `unstable_cache`라 비워야 창들이 새 배치를 본다(B6).
          // ⚠️ Route Handler에선 `updateTag`를 못 쓴다 — `revalidateTag(tag, "max")`가 정본.
          //    이게 실패해도 캐시 TTL(300초) 백스톱이 있어 00:30 기준 몇 분 안에 반영된다.
          revalidateTag(tenantSettingsTag(tenantId), "max");
          await supabase.from("audit_logs").insert({
            tenant_id: tenantId,
            actor_id: null,
            actor_name: "시스템(시간표 예약 적용)",
            action: "owner_integration_groups_update",
            target_type: "tenant_settings",
            target_label: snap.groups.subject,
            metadata: {
              subject: snap.groups.subject,
              groups: snap.groups.groups.length,
              scheduledFrom: snap.effectiveDate,
              snapshotId: snap.snapshotId,
            },
          });
        } else if (groupResult.status !== "skipped") {
          reportError(new Error(groupResult.reason ?? "그룹 배치 예약 적용 실패"), {
            where: "apply-due-class-updates:groups",
            snapshotId: snap.snapshotId,
          });
        }
      } catch (e) {
        // 🔴 그룹 하나 때문에 cron 전체가 죽으면 담임·이름 재생 표식이 안 남아 다음 날 통째로 다시 돈다.
        groupResult = { status: "error", reason: "그룹 배치 적용 중 오류" };
        reportError(e, { where: "apply-due-class-updates:groups", snapshotId: snap.snapshotId });
      }
    }

    // 표식 — 실패한 반이 있어도 남긴다(다음 날 같은 걸 통째로 다시 시도하면 사람이 손댄 값을 덮을 위험).
    await supabase.from("timetable_import_logs").insert({
      tenant_id: tenantId,
      week_label: snap.effectiveDate,
      snapshot_id: snap.snapshotId,
      result: {
        kind: CLASS_UPDATES_APPLIED_KIND,
        classes: snap.updates.length,
        applied: appliedHere,
        ...(skippedNames.length ? { skippedNames } : {}),
        ...(groupResult ? { groups: groupResult } : {}),
      },
      actor_id: null,
    });
  }

  return NextResponse.json({ ok: true, snapshots: due.length, applied, groupsApplied });
}
