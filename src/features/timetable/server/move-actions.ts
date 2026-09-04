"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import {
  blockersText,
  buildClassMoveIndex,
  buildClassMoveLookup,
  isSeatSlot,
  moveBlockers,
  slotRoomIdOf,
  slotRoomNameOf,
  slotRoomTokOf,
  slotTeacherOf,
  toMinutes,
  toTimeString,
  type PlacedWindow,
} from "../lib/class-move";
import { getTeacherScheduleBlocks, getWeeklyScheduleWithStudents } from "./queries";

/**
 * 반 블록(화면의 한 칸 = 배치 여러 줄)을 **다른 요일·교시로 옮긴다** — 시간표에서 반 이름 머리를 끌어 놓았을 때의 저장 경로.
 *
 * 🔴 **단위는 블록이다**(배치 한 줄이 아니라) — 격자는 같은 반의 연속 교시·같은 그룹 요일을 한 칸으로 병합해
 *    그리고(실측 2026-09-04: 영어는 (반,요일) 121칸이 전부 교시 2개 이상), 한 줄만 옮기면 화면은 통째로 간
 *    것처럼 보이는데 나머지 줄이 제자리에 남는다.
 * 🔴 **덮어쓰지 않고 갈아 끼운다**(0087a 구조 가져오기·`planSlotArchives`와 같은 temporal 규약):
 *    옛 행은 `valid_to = 적용일 − 1`로 **마감**하고 새 행을 `valid_from = 적용일`로 넣는다. 그래야
 *    **이미 찍힌 출결이 고아가 되지 않는다** — 출결은 `attendance_records.slot_start`로 그 시각에 매달려
 *    있어서([[#126]]), 행을 제자리에서 고치면 지난 기록이 사라진 교시를 가리킨다.
 * 🔴 **적용일 이후에 이미 찍힌 출결이 있으면 거절**한다 — 그 기록은 옛 시각에 매달려 있는데 그날부터
 *    배치가 바뀌면 고아가 된다. 사람이 그 기록을 먼저 정리해야 한다(조용히 옮기지 않는다).
 * 🔴 **갈 수 있는 자리인지 서버가 다시 판정한다**(#77) — 학생(전 과목)·강사·강의실·같은 반 넷을 화면과
 *    **같은 함수**(`moveBlockers`)로 확인한다. 화면 색인은 페이지를 연 시점의 스냅샷이라, 그사이 다른
 *    사람이 넣은 배치와 부딪힐 수 있다(가져오기 `applyStructureImport`가 충돌 목록을 재계산하는 것과 같은 결).
 * 🔴 **길이는 유지**한다 — 목적지 교시가 40분이어도 60분 수업은 60분이다(시수·급여).
 * 🔴 게이트는 `canManageTenant("classes")` — `canWriteTenant`는 scoped 강사도 통과한다(page.tsx와 같은 게이트, #77).
 */
export type MoveClassSlotResult = { ok: true; moved: number } | { ok: false; error: string };

type SlotRow = {
  id: string;
  tenant_id: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
  teacher_id: string | null;
  classroom_id: string | null;
  slot_teacher_label: string | null;
  slot_room_label: string | null;
  period_label: string | null;
  merge_group: string | null;
};

export async function moveClassSlots(input: {
  /** 이 블록이 함께 옮기는 배치들과 각자의 도착 자리. 한 줄짜리 블록이면 1건. */
  moves: { slotId: string; toDay: string; toStart: string }[];
  /** 적용일(YYYY-MM-DD). 미지정 = 오늘(KST). 과거는 거절한다(소급하면 지난 출결이 어긋난다). */
  effectiveDate?: string;
}): Promise<MoveClassSlotResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { ok: false, error: "시간표를 편집할 권한이 없습니다" };
  }
  const moves = input.moves ?? [];
  if (moves.length === 0) return { ok: false, error: "옮길 배치가 없습니다" };
  if (new Set(moves.map((m) => m.slotId)).size !== moves.length) {
    return { ok: false, error: "같은 배치가 두 번 들어 있습니다" };
  }
  const today = kstToday();
  const effective = (input.effectiveDate ?? today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { ok: false, error: "적용일이 올바르지 않습니다" };
  if (effective < today) {
    return { ok: false, error: "지난 날짜로는 옮길 수 없습니다 — 오늘 이후로 정해 주세요" };
  }

  const admin = createAdminClient();
  const { data: rows, error: readErr } = await admin
    .from("class_schedules")
    .select(
      "id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group",
    )
    .in("id", moves.map((m) => m.slotId))
    .eq("tenant_id", user.tenantId);
  if (readErr) return { ok: false, error: "배치를 읽지 못했습니다. 잠시 후 다시 시도해 주세요" };
  const byId = new Map<string, SlotRow>((rows ?? []).map((r) => [String(r.id), r as SlotRow]));
  if (byId.size !== moves.length) {
    return { ok: false, error: "옮길 배치를 찾지 못했습니다(이미 바뀌었을 수 있습니다). 화면을 새로 고쳐 주세요" };
  }
  const classIds = new Set([...byId.values()].map((r) => r.class_id));
  if (classIds.size !== 1) return { ok: false, error: "한 번에 한 반만 옮길 수 있습니다" };
  const classId = [...classIds][0]!;

  // 옮긴 뒤 각 배치가 차지할 자리(길이 유지) — 판정·저장이 같은 값을 쓴다.
  const windows: PlacedWindow[] = [];
  for (const m of moves) {
    const row = byId.get(m.slotId)!;
    if (row.valid_to && String(row.valid_to).slice(0, 10) < effective) {
      return { ok: false, error: "이미 끝난 배치입니다 — 화면을 새로 고친 뒤 다시 시도해 주세요" };
    }
    // 🔴 **적용일보다 늦게 시작하는 예약 행은 건드리지 않는다**(적대 리뷰 2026-09-04) — 옮기면 그 행이
    //    지워지고 새 행이 적용일부터 열려 **예약이 앞당겨지고**, 예약 스냅샷
    //    (`timetable_snapshots…apply.inserts[].id`, 0231a/0234a 취소·역추적)이 가리키던 id가 고아가 된다.
    const from = row.valid_from ? String(row.valid_from).slice(0, 10) : null;
    if (from && from > effective) {
      return {
        ok: false,
        error: `${from}부터 시작하도록 예약된 배치입니다 — 그 날짜 이후로 적용일을 정하거나 예약을 먼저 취소해 주세요`,
      };
    }
    const toStart = m.toStart.length === 5 ? `${m.toStart}:00` : m.toStart;
    if (!/^\d{2}:\d{2}:\d{2}$/.test(toStart)) return { ok: false, error: "옮길 시각이 올바르지 않습니다" };
    const dur = toMinutes(String(row.end_time)) - toMinutes(String(row.start_time));
    if (dur <= 0) return { ok: false, error: "수업 길이를 계산하지 못했습니다" };
    windows.push({ slotId: m.slotId, day: m.toDay, start: toStart, end: toTimeString(toMinutes(toStart) + dur) });
  }
  const unchanged = windows.every((w) => {
    const row = byId.get(w.slotId)!;
    return row.day_of_week === w.day && String(row.start_time).slice(0, 5) === w.start.slice(0, 5);
  });
  if (unchanged) return { ok: false, error: "같은 자리입니다" };

  // 🔴 화면이 아니라 **여기서** 다시 판정한다(#77) — 재료는 적용일 그 주의 전 과목 슬롯(화면과 같은 조회).
  const weekSlots = await getWeeklyScheduleWithStudents({ referenceDate: effective });
  const mine = weekSlots.find((s) => s.id === moves[0]!.slotId);
  if (!mine) {
    return { ok: false, error: "옮길 배치를 시간표에서 찾지 못했습니다 — 화면을 새로 고친 뒤 다시 시도해 주세요" };
  }
  // 강사 근무 블록(감독·회의·연차)도 화면과 **같이** 태운다 — 안 태우면 서버가 화면보다 느슨해진다.
  const blocks = mine.subject ? await getTeacherScheduleBlocks(mine.subject, effective) : [];
  const lookup = buildClassMoveLookup(buildClassMoveIndex([...weekSlots, ...blocks], [classId]));
  // 🔴 축(강사·강의실·자리)은 **줄마다** 읽는다 — 한 블록에 그 반의 자리(LAB·JJ) 교시와 정규 교시가 섞일 수
  //    있어서 기준 줄 한 벌로 판정하면 자리 줄이 전체 축을 끄거나(강사 이중배정 통과) 거짓 빨강이 된다.
  //    ⚠️ 오프셋(row/day)은 여기선 안 쓴다 — 도착 자리는 이미 `windows`로 정해져 있다(화면이 계산한 값을
  //    그대로 믿지 않고 위에서 배치를 다시 읽어 길이를 계산했다).
  const byWeek = new Map(weekSlots.map((s2) => [s2.id, s2]));
  const parts = moves.map((m) => {
    const src = byWeek.get(m.slotId);
    return {
      slotId: m.slotId,
      rowOffset: 0,
      dayOffset: 0,
      durMin: 0,
      teacher: src ? slotTeacherOf(src) : null,
      roomId: src ? slotRoomIdOf(src) : null,
      roomTok: src ? slotRoomTokOf(src) : "",
      roomName: src ? slotRoomNameOf(src) : "",
      // 재료에서 못 찾은 줄은 **자리로 치지 않는다** — 자리로 치면 그 줄의 축이 조용히 꺼진다(느슨한 쪽).
      seat: src ? isSeatSlot(src) : false,
    };
  });
  const blockers = moveBlockers({ slotId: mine.id, classId, parts }, windows, lookup);
  if (blockers.length > 0) {
    return { ok: false, error: `그 자리로는 옮길 수 없습니다 — ${blockersText(blockers)}` };
  }

  // 🔴 적용일 이후 그 칸으로 이미 찍힌 출결 — 옮기면 그 기록이 사라진 교시에 매달린다([[#126]]).
  // ⚠️ **요일까지 봐야 한다** — 월·목이 같은 시각인 반은 시각만으로 세면 목요일 기록 때문에 월요일 이동이
  //    막힌다(적대 리뷰 2026-09-04). 날짜에서 요일을 도출해 그 줄의 요일과 같은 것만 센다.
  // ⚠️ `slot_start`가 비어 있는 기록은 교시에 매달려 있지 않아 옮겨도 고아가 되지 않는다(대상 아님).
  for (const w of windows) {
    const row = byId.get(w.slotId)!;
    let rows2: { date: string }[];
    try {
      rows2 = await fetchAllPaged<{ date: string }>((from, to) =>
        admin
          .from("attendance_records")
          .select("date")
          .eq("tenant_id", user.tenantId)
          .eq("class_id", row.class_id)
          .gte("date", effective)
          .eq("slot_start", String(row.start_time))
          .order("date")
          .range(from, to),
      );
    } catch {
      return { ok: false, error: "출결 기록을 확인하지 못해 중단했습니다" };
    }
    const stuck = rows2.filter((r) => weekdayOf(String(r.date)) === row.day_of_week).length;
    if (stuck > 0) {
      return {
        ok: false,
        error: `적용일 이후에 이 교시로 찍힌 출결이 ${stuck}건 있습니다 — 그 기록을 먼저 정리한 뒤 옮겨 주세요`,
      };
    }
  }

  // 감사로그에 적을 반 이름(없어도 저장은 진행 — 로그는 본 작업을 막지 않는다).
  const { data: klass } = await admin
    .from("classes")
    .select("class_name")
    .eq("id", classId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const className = klass?.class_name ?? null;

  const cutoff = shiftDay(effective, -1);
  /**
   * 되돌리기 일지 — 트랜잭션이 없으니 **한 것을 그대로 되짚어** 원복한다(보상 트랜잭션).
   * 🔴 옛 코드는 새 행만 지우고 **이미 마감·삭제한 옛 행은 그대로 뒀다** — 중간에 실패하면 그 반이 적용일부터
   *    교시를 잃은 채 화면엔 "되돌렸습니다"가 떴다(삭제분은 복구 불가, 적대 리뷰 2026-09-04).
   */
  const journal: (
    | { kind: "inserted"; id: string }
    | { kind: "closed"; id: string; prevValidTo: string | null }
    | { kind: "deleted"; row: SlotRow }
  )[] = [];
  const undo = async () => {
    // 역순으로 되짚는다(넣은 것은 지우고, 마감은 원래 날짜로, 지운 행은 **원래 id 그대로** 다시 넣는다).
    for (const j of [...journal].reverse()) {
      if (j.kind === "inserted") {
        await admin.from("class_schedules").delete().eq("id", j.id).eq("tenant_id", user.tenantId);
      } else if (j.kind === "closed") {
        await admin
          .from("class_schedules")
          .update({ valid_to: j.prevValidTo })
          .eq("id", j.id)
          .eq("tenant_id", user.tenantId);
      } else {
        // 🔴 id를 그대로 되살린다 — 예약 스냅샷·감사로그가 그 id를 가리킨다.
        await admin.from("class_schedules").insert(j.row);
      }
    }
  };

  // 줄마다 **넣고 곧바로 마감**한다(짝으로) — 중간에 실패해도 되짚을 것이 명확하다.
  for (const w of windows) {
    const row = byId.get(w.slotId)!;
    // 새 행 — 라벨·강사·강의실·묶음은 그대로 승계한다(폼이 안 보내는 값을 잃지 않는 `preserveScheduleFields`와 같은 결).
    const { data: created, error: insErr } = await admin
      .from("class_schedules")
      .insert({
        tenant_id: row.tenant_id,
        class_id: row.class_id,
        day_of_week: w.day,
        start_time: w.start,
        end_time: w.end,
        valid_from: effective,
        valid_to: row.valid_to,
        teacher_id: row.teacher_id,
        classroom_id: row.classroom_id,
        slot_teacher_label: row.slot_teacher_label,
        slot_room_label: row.slot_room_label,
        // 교시 이름은 시각을 따라가지 못하므로 버린다(옛 `3교시` 라벨이 새 시각에 남으면 거짓이 된다).
        period_label: null,
        merge_group: row.merge_group,
      })
      .select("id")
      .single();
    if (insErr || !created) {
      await undo();
      return { ok: false, error: "새 배치를 넣지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요" };
    }
    journal.push({ kind: "inserted", id: String(created.id) });

    // 옛 행 — 적용일 전에 시작했으면 **마감**, 적용일에 시작했으면(=아직 하루도 안 산 행) 지운다.
    const validFrom = row.valid_from ? String(row.valid_from).slice(0, 10) : null;
    const closing =
      validFrom && validFrom < effective
        ? admin.from("class_schedules").update({ valid_to: cutoff }).eq("id", row.id).eq("tenant_id", user.tenantId)
        : admin.from("class_schedules").delete().eq("id", row.id).eq("tenant_id", user.tenantId);
    const { error: closeErr } = await closing;
    if (closeErr) {
      await undo();
      return { ok: false, error: "옛 배치를 마감하지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요" };
    }
    journal.push(
      validFrom && validFrom < effective
        ? { kind: "closed", id: row.id, prevValidTo: row.valid_to }
        : { kind: "deleted", row },
    );
  }
  const createdIds = journal.filter((j) => j.kind === "inserted").map((j) => (j as { id: string }).id);

  await logAction({
    action: "class_schedule_move",
    targetType: "class",
    targetLabel: className ?? undefined,
    metadata: {
      classId,
      effectiveDate: effective,
      moves: windows.map((w) => {
        const row = byId.get(w.slotId)!;
        return {
          slotId: w.slotId,
          from: { day: row.day_of_week, start: String(row.start_time), end: String(row.end_time) },
          to: { day: w.day, start: w.start, end: w.end },
        };
      }),
      newSlotIds: createdIds,
    },
  });
  revalidatePath("/timetable");
  return { ok: true, moved: windows.length };
}


/** `YYYY-MM-DD` → 요일 키(`mon`…) — 출결 기록이 **그 줄의 요일**인지 가르는 데 쓴다(UTC 결정적). */
function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day] ?? "";
}

/** `YYYY-MM-DD` ± 일수(UTC 결정적 — KST 날짜 문자열 산술의 앱 관례). */
function shiftDay(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
