"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { mapPool } from "@/lib/async-pool";
import { isMissingColumnError, lookupLabSeparateIds } from "@/features/classes/server/lab-separate";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isMissingOriginColumn, MOVE_GAP_ORIGIN } from "@/features/textbooks/server/shift-markers";
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
import { daySplitStudents, nextDay, SLOT_ANCHORS, slotAnchorBlockText, type SlotAnchorHit } from "../lib/slot-anchors";
import {
  blockCarryOffsets,
  carryConflicts,
  carryConflictText,
  carryGapDates,
  carryGroups,
  carryKeepsOrder,
  carryRounds,
  carrySlotPicks,
  carrySummary,
  dateList,
  dayPaceKeepsDays,
  mondayOf,
  parseSlotMemoKey,
  picksConflictText,
  shiftYmd,
  slotMemoKey,
  weekdayOf,
  type CarryItem,
  type CarryOccupant,
  type PicksPlan,
} from "../lib/slot-carry";
import { getTeacherScheduleBlocks, getWeeklyScheduleWithStudents } from "./queries";
import { logDbError } from "@/lib/supabase/db-error";

const DAY_KEYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

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
 * 🔴 **적용일 이후 그 교시에 매달린 기록은 새 교시로 함께 옮긴다**(`SLOT_ANCHORS` — 수업 계획·학생 기록·미룸 표식·Shouting 체크·
 *    자리 이동 + 수업 시트 교시 메모 · 원장 2026-10-28 (가)안) — 배치만 옮기면 기록이 옛 시각에 남아 고아가 된다. 요일이 바뀌면
 *    같은 주의 새 요일로, 그날이 적용일보다 앞이면 **블록 전체**를 다음 주로(`blockCarryOffsets`). 옮겨 갈 자리에 기록이 있으면
 *    덮어쓰지 않고 막는다. 교재 배정의 고른 교시(`slot_picks`)엔 새 칸을 더한다(`carrySlotPicks`).
 *    **출결이 있으면 거절**한다(실제로 찍힌 기록·급여 — 시스템이 고치지 않는다) — 마지막 출결 다음 날로 적용일을 권한다.
 * 🔴 **오늘 수업이 있는 교시는 오늘부터 옮기지 않는다** — 열려 있는 출석·시트 화면이 옛 교시로 저장한다([[#126]]).
 * 🔴 **분리등원 학생이 있으면 요일을 바꾸지 않는다** — `attendance_days`는 요일만 적어, 요일을 옮기면 학생이 명단에서 빠지거나
 *    다른 교시에 더해진다(`daySplitStudents`).
 * 🔴 **갈 수 있는 자리인지 서버가 다시 판정한다**(#77) — 학생(전 과목)·강사·강의실·같은 반 넷을 화면과
 *    **같은 함수**(`moveBlockers`)로 확인한다. 화면 색인은 페이지를 연 시점의 스냅샷이라, 그사이 다른
 *    사람이 넣은 배치와 부딪힐 수 있다(가져오기 `applyStructureImport`가 충돌 목록을 재계산하는 것과 같은 결).
 * 🔴 **길이는 유지**한다 — 목적지 교시가 40분이어도 60분 수업은 60분이다(시수·급여).
 * 🔴 게이트는 `canManageTenant("classes")` — `canWriteTenant`는 scoped 강사도 통과한다(page.tsx와 같은 게이트, #77).
 */
/** `carried` = 함께 옮긴 기록 한 줄(없으면 빠진다 — 화면이 알린다). */
export type MoveClassSlotResult = { ok: true; moved: number; carried?: string } | { ok: false; error: string };

/** 수업 시트 교시 메모 — 날짜·교시가 열쇠 글자(`slot:날짜:HH:MM`)에 들어 있어 `SLOT_ANCHORS` 모양이 아니다. */
const MEMO_TABLE = "class_sheet_memos";
const MEMO_LABEL = "교시 메모";
/** 칸 목록을 값으로 이어 만든 select는 타입이 추론되지 않는다 — 읽은 줄은 칸 이름으로 꺼내 쓴다(저장소 관례: calendar·grades). */
type RowsPage = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
/** 함께 옮기기 한 단계에서 동시에 쓰는 묶음 수. */
const CARRY_PARALLEL = 8;

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
  /**
   * LAB '따로 수업(*LAB)' 표식(0271a) — **따로 읽어 채운다**(아래 조회에 컬럼을 끼우면 0271a 전엔 드래그가 전부 막힌다).
   * undefined = 못 읽었다 → insert에서 칸을 뺀다(칸 없는 DB에 키를 실으면 insert가 실패한다).
   */
  lab_separate?: boolean;
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
  const [{ data: rows, error: readErr }, labLookup] = await Promise.all([
    admin
      .from("class_schedules")
      .select(
        "id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group",
      )
      .in("id", moves.map((m) => m.slotId))
      .eq("tenant_id", user.tenantId),
    // 옮긴 LAB 교시가 '따로 수업(*LAB)' 표식을 잃지 않게 — 새 행·되돌리기 행 모두 이 값을 싣는다.
    lookupLabSeparateIds(admin, { kind: "ids", ids: moves.map((m) => m.slotId), tenantId: user.tenantId }),
  ]);
  // 표식 조회 실패도 멈춘다 — 모른 채 옮기면 새 행이 기본값(false)으로 들어가 표식이 사라진다. 칸이 없으면(missing) 키를 뺀다.
  if (readErr || labLookup === "error") return { ok: false, error: "배치를 읽지 못했습니다. 잠시 후 다시 시도해 주세요" };
  const labIds = labLookup === "missing" ? null : labLookup.ids;
  const byId = new Map<string, SlotRow>(
    (rows ?? []).map((r) => {
      const row = r as SlotRow;
      return [String(r.id), labIds ? { ...row, lab_separate: labIds.has(String(r.id)) } : row];
    }),
  );
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
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(toStart)) return { ok: false, error: "옮길 시각이 올바르지 않습니다" };
    if (!DAY_KEYS.has(m.toDay)) return { ok: false, error: "옮길 요일이 올바르지 않습니다" };
    const dur = toMinutes(String(row.end_time)) - toMinutes(String(row.start_time));
    if (dur <= 0) return { ok: false, error: "수업 길이를 계산하지 못했습니다" };
    if (toMinutes(toStart) + dur > 24 * 60) return { ok: false, error: "수업이 자정을 넘깁니다 — 더 이른 시각으로 옮겨 주세요" };
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

  // 🔴 오늘 수업이 있는 교시는 오늘부터 옮기지 않는다 — 열려 있는 출석·수업 시트 화면이 옛 교시 목록을 들고 있어 옮긴 뒤에도
  //    옛 시각으로 저장한다([[#126]] "수업 시간 중에는 배치 시각을 건드리지 말 것" · 되돌린 2분 뒤 없어진 칸에 6명이 찍혔다).
  if (effective === today && windows.some((w) => byId.get(w.slotId)!.day_of_week === weekdayOf(today))) {
    return {
      ok: false,
      error: `오늘 수업이 있는 교시는 오늘부터 옮길 수 없습니다 — 열려 있는 출석 화면이 옛 교시로 기록합니다. 적용일을 ${nextDay(today)} 이후로 정해 주세요`,
    };
  }

  // 🔴 적용일 이후 그 교시에 매달린 기록(`SLOT_ANCHORS`) — 배치만 옮기면 옛 시각에 남아 화면에서 사라진다([[#126]]).
  //    **출결은 막는다**(실제로 찍힌 기록이고 급여로 흐른다 — 시스템이 고치지 않는다). 나머지(수업 계획·학생 기록·미룸 표식·
  //    Shouting 체크·자리 이동)와 수업 시트 교시 메모는 **새 교시로 함께 옮긴다**(원장 2026-10-28 (가)안 — 같은 주의 새 요일,
  //    그날이 적용일보다 앞이면 블록 전체를 다음 주 · `blockCarryOffsets`). 아래에서 판정을 다 끝낸 뒤 배치를 쓰고 나서 옮긴다.
  // ⚠️ **요일까지 봐야 한다** — 월·목이 같은 시각인 반은 시각만으로 세면 목요일 기록까지 옮긴다(적대 리뷰 2026-09-04).
  //    날짜에서 요일을 도출해 그 줄의 요일과 같은 것만 · 그 배치가 끝나는 날(`valid_to`)까지만.
  // ⚠️ `slot_start`가 비어 있는 출결(하루 단위 기록)은 교시에 매달려 있지 않다 — 요일을 옮기면 수업 없는 요일 칸에 남지만
  //    월간 격자는 모든 날짜를 그리고 귀속은 담임으로 가서 사라지지 않는다(대상 아님).
  // 🔴 날짜 칸은 표마다 다르다(`SLOT_ANCHORS`) — 종전엔 출결을 없는 칸 `date`(실제 `session_date`)로 읽어 PostgREST가 늘 오류를 냈고,
  //    반 옮기기가 한 번도 저장되지 않았다(운영 감사로그 class_schedule_move 0건 · 3.0 연습본 재현 → 원장 지시로 넘겨받음 2026-10-28).
  //    칸 이름(유니크 열쇠 칸 포함)은 시험이 SQL 정의와 대조한다.
  const readFailed = { ok: false as const, error: "옮기기 전에 확인할 기록을 읽지 못해 중단했습니다. 잠시 후 다시 시도해 주세요" };
  const hits = new Map<string, SlotAnchorHit>();
  const carry: CarryItem[] = [];
  // 🔴 한 주 밀림은 줄별 날짜가 수업 차례를 뒤집으면 **블록 전체로** 정한다(`blockCarryOffsets`) — 줄마다만 정하면 두 요일
  //    블록에서 한 요일만 밀려 차례가 뒤집힌다(화·금 → 월·목, 적용일 금 · 적대 리뷰 2026-10-28).
  const block = blockCarryOffsets(
    windows.map((w) => {
      const row = byId.get(w.slotId)!;
      return { fromDay: row.day_of_week, toDay: w.day, fromSlot: String(row.start_time), toSlot: w.start };
    }),
    effective,
  );
  const daysOf = new Map(windows.map((w, n) => [w.slotId, block.days[n]!]));
  // 교시 메모는 그 반 것을 한 번에 읽는다(적용일 주 월요일부터 — 옮겨 갈 자리도 적용일 이후라 같은 목록이 '차지한 자리'를 겸한다).
  let memos: { id: string; week_start: string; memo_key: string }[];
  try {
    memos = await fetchAllPaged<{ id: string; week_start: string; memo_key: string }>((from, to) =>
      admin
        .from(MEMO_TABLE)
        .select("id, week_start, memo_key")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId)
        .like("memo_key", "slot:%")
        .gte("week_start", mondayOf(effective))
        .order("week_start")
        .order("id")
        .range(from, to),
    );
  } catch (e) {
    logDbError(e, `timetable.moveClassSlots.${MEMO_TABLE}`);
    return readFailed;
  }
  // 칸 × 표 조회는 서로 독립이다 — 먼저 한꺼번에(동시 6개) 읽고, 판정·기록은 **종전과 같은 순서**로 한다(B12 · 칸 4개 × 표 6개 = 24번 직렬 왕복이었다).
  type AnchorRead = { found: Record<string, unknown>[] } | { table: string; error: unknown };
  const live = windows.flatMap((w) => {
    const row = byId.get(w.slotId)!;
    const until = row.valid_to ? String(row.valid_to).slice(0, 10) : null;
    const slot = String(row.start_time);
    const days = daysOf.get(w.slotId)!;
    // 제자리 줄(요일·시각 그대로 · 한 주 밀림 없음 — 다른 요일 그룹 표로 끌면 생긴다)은 기록이 이미 제자리다. 옮기지도 막지도
    // 않는다 — 같은 값으로 고쳐 쓰면 수정 시각만 바뀌고 '함께 옮긴 기록'으로 잘못 센다(적대 리뷰 2026-10-28).
    if (days === 0 && slot.slice(0, 5) === w.start.slice(0, 5)) return [];
    return [{ w, row, until, slot, days }];
  });
  const reads = await mapPool(
    live.flatMap((l) => SLOT_ANCHORS.map((a) => ({ l, a }))),
    6,
    async ({ l, a }): Promise<AnchorRead> => {
      const keyColumns: readonly string[] = a.carry?.keyColumns ?? [];
      try {
        const found = await fetchAllPaged<Record<string, unknown>>((from, to) => {
          let q = admin
            .from(a.table)
            .select(["id", a.dateColumn, ...keyColumns].join(", "))
            .eq("tenant_id", user.tenantId)
            .eq("class_id", l.row.class_id)
            .eq("slot_start", l.slot)
            .gte(a.dateColumn, effective);
          if (l.until) q = q.lte(a.dateColumn, l.until);
          return q.order(a.dateColumn).order("id").range(from, to) as unknown as RowsPage;
        });
        return { found };
      } catch (error) {
        return { table: a.table, error };
      }
    },
  );
  const readError = reads.find((r): r is { table: string; error: unknown } => "error" in r);
  if (readError) {
    logDbError(readError.error, `timetable.moveClassSlots.${readError.table}`);
    return readFailed;
  }
  let readAt = 0;
  for (const { w, row, until, slot, days } of live) {
    const take = (table: string, label: string, id: string, date: string, keyRest: string, slotInKey: boolean) => {
      carry.push({ table, label, id, fromDate: date, fromSlot: slot, toDate: shiftYmd(date, days), toSlot: w.start, keyRest, slotInKey, until });
    };
    for (const a of SLOT_ANCHORS) {
      const keyColumns: readonly string[] = a.carry?.keyColumns ?? [];
      const found = (reads[readAt++] as { found: Record<string, unknown>[] }).found;
      for (const r of found) {
        const d = String(r[a.dateColumn]).slice(0, 10);
        if (weekdayOf(d) !== row.day_of_week) continue;
        if (a.carry) {
          take(a.table, a.label, String(r.id), d, keyColumns.map((c) => String(r[c] ?? "")).join("|"), a.carry.slotInKey);
          continue;
        }
        const h = hits.get(a.label) ?? { label: a.label, count: 0, lastDate: "" };
        h.count += 1;
        if (d > h.lastDate) h.lastDate = d;
        hits.set(a.label, h);
      }
    }
    for (const m of memos) {
      const p = parseSlotMemoKey(m.memo_key);
      if (!p || p.slot !== slot || p.date < effective || (until && p.date > until) || weekdayOf(p.date) !== row.day_of_week) continue;
      take(MEMO_TABLE, MEMO_LABEL, m.id, p.date, "", true);
    }
  }
  if (hits.size > 0) return { ok: false, error: slotAnchorBlockText([...hits.values()]) };
  // 그 반의 적용일 이후 **계획 줄의 칸(요일|HH:MM)·날짜** — 옮기는 교시엔 줄이 없고 제자리 교시에만 있어도 교재 계산과 그 줄이
  // 어긋날 수 있다(3차 리뷰 2026-10-28). 비는 회차 표식·휴원일·시작일 판정은 **그 칸을 고르는 배정의 줄**이 어디까지 있나로
  // 범위를 잡는다(반 전체로 잡으면 이미 끝난 교재 칸까지 막히고 수업일이 비워진다 · 재검토 2026-10-28). 차례 검사는 줄이 하나라도 있으면.
  let lineCells: { cell: string; date: string }[];
  try {
    lineCells = (
      await fetchAllPaged<{ plan_date: string; slot_start: string }>((from, to) =>
        admin
          .from("class_sheet_plan_lines")
          .select("plan_date, slot_start")
          .eq("tenant_id", user.tenantId)
          .eq("class_id", classId)
          .gte("plan_date", effective)
          .order("plan_date")
          .order("id")
          .range(from, to),
      )
    ).map((l) => {
      const date = String(l.plan_date).slice(0, 10);
      return { cell: `${weekdayOf(date)}|${String(l.slot_start).slice(0, 5)}`, date };
    });
  } catch (e) {
    logDbError(e, "timetable.moveClassSlots.planLines");
    return readFailed;
  }
  const horizon = lineCells.length > 0 ? lineCells.reduce((m, l) => (l.date > m ? l.date : m), lineCells[0]!.date) : null;
  // 안전장치 — 요일 순서를 뒤바꾸는 이동(화·금 → 목·월)이면 기록을 옮긴 뒤 수업 차례가 뒤집힌다(`carryKeepsOrder`).
  if (
    (carry.length > 0 || horizon !== null) &&
    !carryKeepsOrder(
      windows.map((w) => {
        const row = byId.get(w.slotId)!;
        return { fromDay: row.day_of_week, fromSlot: String(row.start_time), toSlot: w.start, days: daysOf.get(w.slotId)! };
      }),
      effective,
    )
  ) {
    return { ok: false, error: "옮기면 수업 차례(요일·교시 순서)가 뒤바뀌어 기록을 함께 옮길 수 없습니다 — 요일 순서가 같은 자리로 옮겨 주세요" };
  }

  // 옮겨 갈 자리를 이미 차지한 기록(같은 반 · 도착 날짜 범위 · 모든 교시) — 덮어쓰지 않고, 두 교시가 한 교시로 모이거나 배치가 끝나는
  // 날 뒤로 넘어가도 막는다(`carryConflicts`). 판정을 다 끝낸 뒤에만 쓴다(쓰는 도중에 막히면 되돌릴 일이 늘어난다).
  if (carry.length > 0) {
    const occupants: CarryOccupant[] = [];
    for (const m of new Set(carry.map((i) => i.table)).has(MEMO_TABLE) ? memos : []) {
      const p = parseSlotMemoKey(m.memo_key);
      if (p) occupants.push({ table: MEMO_TABLE, id: m.id, date: p.date, slot: p.slot, keyRest: "", slotInKey: true });
    }
    // 표마다 독립 조회 — 함께 읽고(B12) 결과는 표 순서대로 담는다.
    const occTables = [...new Set(carry.map((i) => i.table))].flatMap((table) => {
      const a = table === MEMO_TABLE ? undefined : SLOT_ANCHORS.find((x) => x.table === table);
      return a?.carry ? [{ table, a, carryCfg: a.carry }] : [];
    });
    const occReads = await mapPool(occTables, 6, async ({ table, a, carryCfg }) => {
      const dates = carry.filter((i) => i.table === table).map((i) => i.toDate).sort();
      try {
        const found = await fetchAllPaged<Record<string, unknown>>((from, to) =>
          admin
            .from(a.table)
            .select(["id", a.dateColumn, "slot_start", ...carryCfg.keyColumns].join(", "))
            .eq("tenant_id", user.tenantId)
            .eq("class_id", classId)
            .gte(a.dateColumn, dates[0]!)
            .lte(a.dateColumn, dates[dates.length - 1]!)
            .order(a.dateColumn)
            .order("id")
            .range(from, to) as unknown as RowsPage,
        );
        return { found } as const;
      } catch (error) {
        return { error } as const;
      }
    });
    for (let i = 0; i < occTables.length; i++) {
      const { table, a, carryCfg } = occTables[i]!;
      const read = occReads[i]!;
      if ("error" in read) {
        logDbError(read.error, `timetable.moveClassSlots.occupied.${a.table}`);
        return readFailed;
      }
      for (const r of read.found) {
        occupants.push({
          table,
          id: String(r.id),
          date: String(r[a.dateColumn]).slice(0, 10),
          slot: String(r.slot_start),
          keyRest: carryCfg.keyColumns.map((c) => String(r[c] ?? "")).join("|"),
          slotInKey: carryCfg.slotInKey,
        });
      }
    }
    const conflicts = carryConflicts(carry, occupants);
    if (conflicts.length > 0) return { ok: false, error: carryConflictText(conflicts) };
  }
  const rounds = carryRounds(carry);
  if (!rounds) return { ok: false, error: "기록을 새 교시로 옮길 순서를 정하지 못했습니다 — 블록을 나눠서 옮겨 주세요" };

  // 🔴 교재 배정의 고른 교시(`class_textbook_plans.slot_picks` = "요일|HH:MM[|자리]")도 따라가게 — 옛 칸을 고른 배정에 새 칸을
  //    **더한다**(`carrySlotPicks` · 적대 리뷰 2026-10-28). 안 하면 월간계획이 적용일 이후 그 교재를 새 칸에 앉히지 못하고 새 칸의
  //    미룸·당김이 종전 방식으로 떨어진다. 더한 결과가 틀려지는 경우(옮겨 갈 칸을 다른 뜻으로 이미 고름 · 지난 수업과 겹침 …)는 막는다.
  let picksChanges: { id: string; prev: string[]; next: string[]; updatedAt: string }[] = [];
  /**
   * 🔴 옮긴 뒤 **비는 회차**(`carryGapDates`)에 쓸 칸 미룸 표식(lane='' · pos=0 · skip = 그 교시를 통째로 건너뜀, 0282a) — (가)안은
   *    새 요일 첫 회차를 비워 두는데 교재 계산은 그 회차에도 차수를 앉혀 옮긴 계획 줄과 한 칸씩 어긋난다. 그 상태로 미루기를 누르면
   *    릴레이가 차수 하나를 잃었다(적대 리뷰 2026-10-28). 그 칸을 고르는 배정이 있고 그 회차 뒤에 그 반의 계획 줄이 있을 때만 쓴다.
   */
  let gapMarks: { date: string; slot: string }[] = [];
  /** 비는 회차에 이미 있던 강사 칸 skip — 출처만 이동으로 바꾼다(안 바꾸면 원래 계획이 그 회차를 센다 · 리뷰 2026-10-28). */
  let gapRelabel: string[] = [];
  {
    const [{ data: planRows, error: planErr }, { data: schedRows, error: schedErr }] = await Promise.all([
      admin
        .from("class_textbook_plans")
        .select("id, textbook_id, start_date, slot_picks, pace, updated_at")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId)
        .eq("is_active", true)
        .order("id"),
      admin
        .from("class_schedules")
        .select("id, day_of_week, start_time, valid_from, valid_to")
        .eq("tenant_id", user.tenantId)
        .eq("class_id", classId),
    ]);
    if (planErr || schedErr) {
      logDbError(planErr ?? schedErr, "timetable.moveClassSlots.slotPicks");
      return readFailed;
    }
    const plans: (PicksPlan & { updatedAt: string; dayPace: boolean })[] = [];
    // null = 옛 축 방식 — 칸이 아니라 축으로 고르므로 따라갈 것이 없다(비는 회차·시작일·하루 단위 검사는 모든 교시를 센다고 본다).
    const axisPlans: { startDate: string; dayPace: boolean }[] = [];
    for (const r of planRows ?? []) {
      const picks = Array.isArray(r.slot_picks) ? (r.slot_picks as unknown[]).map(String) : [];
      const startDate = String(r.start_date).slice(0, 10);
      const dayPace = r.pace === "day";
      if (picks.length === 0) {
        axisPlans.push({ startDate, dayPace });
        continue;
      }
      plans.push({ id: String(r.id), textbookId: String(r.textbook_id), startDate, picks, updatedAt: String(r.updated_at), dayPace });
    }
    const cellOf = (k: string) => k.split("|").slice(0, 2).join("|");
    // 하루 단위로 세는 배정 — 같은 날 교시가 갈리거나 두 요일이 한 요일로 모이면 차수가 늘거나 준다(3차 리뷰 2026-10-28 · 운영 0건).
    {
      const activeRows = (schedRows ?? []).filter(
        (s) =>
          (!s.valid_from || String(s.valid_from).slice(0, 10) <= effective) &&
          (!s.valid_to || String(s.valid_to).slice(0, 10) >= effective),
      );
      const toDayOf = new Map(windows.map((w) => [w.slotId, w.day]));
      const pairsFor = (picks: readonly string[] | null) =>
        activeRows
          .filter((s) => !picks || picks.some((k) => cellOf(k) === `${s.day_of_week}|${String(s.start_time).slice(0, 5)}`))
          .map((s) => ({ fromDay: String(s.day_of_week), toDay: toDayOf.get(String(s.id)) ?? String(s.day_of_week) }));
      const split = [
        ...plans.filter((p) => p.dayPace).map((p) => pairsFor(p.picks)),
        ...axisPlans.filter((p) => p.dayPace).map(() => pairsFor(null)),
      ].some((pairs) => !dayPaceKeepsDays(pairs));
      if (split) {
        return {
          ok: false,
          error:
            "하루 단위로 차수를 세는 교재 배정이 걸린 교시라, 같은 날 교시를 서로 다른 요일로 나누거나 두 요일을 한 요일로 모을 수 없습니다 — 그날 교시를 함께 같은 요일로 옮겨 주세요",
        };
      }
    }
    const picked = carrySlotPicks({
      plans,
      moves: windows.map((w) => {
        const row = byId.get(w.slotId)!;
        return { fromDay: row.day_of_week, fromStart: String(row.start_time).slice(0, 5), toDay: w.day, toStart: w.start.slice(0, 5) };
      }),
      schedules: (schedRows ?? []).map((s) => ({
        day: String(s.day_of_week),
        start: String(s.start_time),
        validFrom: s.valid_from ? String(s.valid_from).slice(0, 10) : null,
        validTo: s.valid_to ? String(s.valid_to).slice(0, 10) : null,
      })),
      effective,
    });
    if (picked.conflicts.length > 0) {
      const { data: books } = await admin
        .from("textbooks")
        .select("id, title")
        .eq("tenant_id", user.tenantId)
        .in("id", [...new Set(picked.conflicts.map((c) => c.textbookId))]);
      const titleOf = (id: string) => (books ?? []).find((b) => String(b.id) === id)?.title ?? "이름을 읽지 못한 교재";
      return { ok: false, error: picksConflictText(picked.conflicts, titleOf) };
    }
    const updatedAtOf = new Map(plans.map((p) => [p.id, p.updatedAt]));
    picksChanges = picked.changes.map((c) => ({ ...c, updatedAt: updatedAtOf.get(c.id)! }));

    if (horizon !== null) {
      // 🔴 휴원일도 본다 — 옛 요일만 휴원이면 그 주 새 회차가 비고, 새 요일만 휴원이면 계획이 휴원일로 가 계산이 한 칸씩 어긋난다
      //    (3차 리뷰 2026-10-28: 한 요일 블록 × 휴원일 하나 1260건 전부 어긋남). 배정 시작일이 옛·새 날짜 사이에 끼어도 어긋난다.
      let holidays: Record<string, string>;
      try {
        holidays = buildHolidayMap((await getTenantSettingsByTenantId(user.tenantId, { failOnReadError: true })).operations.holidays);
      } catch (e) {
        logDbError(e, "timetable.moveClassSlots.holidays");
        return readFailed;
      }
      // 옮긴 뒤 그 칸(요일|HH:MM)을 고르는 배정 — 새 칸을 더한 목록 기준.
      const nextOf = new Map(picksChanges.map((c) => [c.id, c.next]));
      // 옮기는 옛 칸의 줄은 옮겨 갈 날짜로 센다(제자리 줄 +7 포함).
      const daysOfCell = new Map(
        windows.map((w) => {
          const row = byId.get(w.slotId)!;
          return [`${row.day_of_week}|${String(row.start_time).slice(0, 5)}`, daysOf.get(w.slotId)!];
        }),
      );
      const lineDates = lineCells.map((l) => ({ cell: l.cell, date: shiftYmd(l.date, daysOfCell.get(l.cell) ?? 0) }));
      /** 그 배정이 세는 칸(옛 칸 + 더한 칸 · 축 방식은 모든 칸)의 마지막 계획 줄 날짜 — 없으면 null. */
      const lastLineOf = (cells: ReadonlySet<string> | null) =>
        lineDates.reduce<string | null>((m, l) => ((!cells || cells.has(l.cell)) && (m === null || l.date > m) ? l.date : m), null);
      const counted = [
        ...plans.map((p) => ({
          startDate: p.startDate,
          cells: new Set([...p.picks, ...(nextOf.get(p.id) ?? [])].map(cellOf)),
        })),
        ...axisPlans.map((p) => ({ startDate: p.startDate, cells: null as ReadonlySet<string> | null })),
      ].map((p) => ({ ...p, last: lastLineOf(p.cells) }));
      const onHoliday = new Set<string>();
      const straddled = new Set<string>();
      for (const w of windows) {
        const row = byId.get(w.slotId)!;
        const cell = `${w.day}|${w.start.slice(0, 5)}`;
        // 그 칸을 세고 줄이 남아 있는 배정만 — 줄이 없거나 이미 끝난 배정은 어긋날 줄이 없다.
        const pickers = counted.filter((p) => p.last !== null && (!p.cells || p.cells.has(cell)));
        if (pickers.length === 0) continue;
        const cellHorizon = pickers.reduce((m, p) => (p.last! > m ? p.last! : m), pickers[0]!.last!);
        const starts = pickers.filter((p) => p.last! >= p.startDate).map((p) => p.startDate);
        const until = row.valid_to ? String(row.valid_to).slice(0, 10) : null;
        const r = carryGapDates({ toDay: w.day, days: daysOf.get(w.slotId)!, effective, until, horizon: cellHorizon, holidays, starts });
        for (const date of r.gaps) gapMarks.push({ date, slot: w.start });
        for (const d of r.onHoliday) onHoliday.add(d);
        for (const d of r.straddled) straddled.add(d);
      }
      if (onHoliday.size > 0) {
        const dates = [...onHoliday].sort();
        return {
          ok: false,
          error: `옮기면 수업 계획이 휴원일(${dateList(dates)})로 갑니다 — 교재 계산은 휴원일을 건너뛰어 그 뒤 차수가 한 칸씩 어긋납니다. 적용일을 ${dateList([dates.at(-1)!])} 뒤로 잡거나 다른 요일로 옮겨 주세요`,
        };
      }
      if (straddled.size > 0) {
        const dates = [...straddled].sort();
        return {
          ok: false,
          error: `교재 배정 시작일(${dateList(dates)})이 옮기기 전후 날짜 사이에 끼어 그 배정의 첫 회차가 계획 줄과 한 칸 어긋납니다 — 적용일을 ${dateList([dates.at(-1)!])} 이후로 잡아 주세요`,
        };
      }
    }
    if (gapMarks.length > 0) {
      // 그 칸에 표식이 이미 있으면(배치 없던 칸의 남은 표식) 덮어쓰지 않고 막는다 — 같은 칸 미룸이면 이미 비어 있으니 건너뛴다.
      const dates = gapMarks.map((g) => g.date).sort();
      const readMarks = (cols: string) =>
        admin
          .from("class_lesson_shifts")
          .select(cols)
          .eq("tenant_id", user.tenantId)
          .eq("class_id", classId)
          .gte("plan_date", dates[0]!)
          .lte("plan_date", dates[dates.length - 1]!)
          .returns<{ id: string; plan_date: string; slot_start: string; kind: string; lane: string; origin?: string }[]>();
      // s2_0005 전이면 출처 없이(그때는 바꿀 출처도 없다).
      let { data: marks, error: markErr } = await readMarks("id, plan_date, slot_start, kind, lane, origin");
      if (isMissingOriginColumn(markErr)) ({ data: marks, error: markErr } = await readMarks("id, plan_date, slot_start, kind, lane"));
      if (markErr) {
        logDbError(markErr, "timetable.moveClassSlots.gapMarks");
        return readFailed;
      }
      // 함께 옮겨 갈 표식은 빼고 본다(제자리 줄이 블록과 함께 한 주 밀리면 그 칸의 표식은 다음 주로 떠난다 — 쓰기는 기록 뒤라 안 부딪힌다).
      const leaving = new Set(carry.filter((i) => i.table === "class_lesson_shifts").map((i) => i.id));
      const at = (g: { date: string; slot: string }) =>
        (marks ?? []).filter(
          (m) => !leaving.has(String(m.id)) && String(m.plan_date).slice(0, 10) === g.date && String(m.slot_start) === g.slot,
        );
      const taken = gapMarks.filter((g) => at(g).some((m) => m.lane !== "" || m.kind !== "skip"));
      if (taken.length > 0) {
        return { ok: false, error: carryConflictText([{ label: "미룸·당김 표식", kind: "occupied", dates: taken.map((g) => g.date).sort() }]) };
      }
      gapRelabel = gapMarks.flatMap((g) => at(g).filter((m) => m.origin === "manual").map((m) => String(m.id)));
      gapMarks = gapMarks.filter((g) => at(g).length === 0);
    }
  }

  // 🔴 분리등원(요일 지정) 학생 — 요일을 옮기면 그 학생이 블록에서 빠지거나(옛 요일만 다님) 다른 교시에 더해진다(새 요일만 다님).
  //    학생 충돌 판정(`moveBlockers`)도 도착 요일로 학생을 걸러서 옛 요일 학생은 보지 않는다 — 막아야 둘 다 맞는다(리뷰 2026-10-28).
  //    ⚠️ "등원 요일을 먼저 바꾸라"고 권하지 않는다 — 등원 요일 편집은 반의 지금 요일만 고르게 하고, `attendance_days`엔 날짜 축이
  //    없어 미래 적용일 이동엔 맞는 순서가 없다(모든 요일로 풀면 그 즉시 다른 요일 명단에 섞인다).
  const dayChanges = windows
    .map((w) => ({ from: byId.get(w.slotId)!.day_of_week, to: w.day }))
    .filter((c) => c.from !== c.to);
  if (dayChanges.length > 0) {
    // 종료일은 넉넉히 읽고 규약 함수로 거른다(반이동 종료일은 그날 이미 새 반 — `isEnrollmentEndedOn`).
    const { data: enr, error: enrErr } = await admin
      .from("enrollments")
      .select("student_id, attendance_days, end_date, is_transferred, student:student_id ( name )")
      .eq("tenant_id", user.tenantId)
      .eq("class_id", classId)
      .or(`end_date.is.null,end_date.gte.${effective}`);
    if (enrErr) {
      logDbError(enrErr, "timetable.moveClassSlots.enrollments");
      return { ok: false, error: "수강생을 확인하지 못해 중단했습니다. 잠시 후 다시 시도해 주세요" };
    }
    const names = daySplitStudents(
      (enr ?? []).map((e) => {
        const s = (Array.isArray(e.student) ? e.student[0] : e.student) as { name?: string } | null;
        return {
          name: s?.name ?? "이름 없음",
          attendanceDays: (e.attendance_days as string[] | null) ?? null,
          endDate: (e.end_date as string | null) ?? null,
          isTransferred: e.is_transferred === true,
        };
      }),
      dayChanges,
      effective,
    );
    if (names.length > 0) {
      const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` 외 ${names.length - 3}명` : "");
      return {
        ok: false,
        error: `요일을 정해 다니는 학생(분리등원 · ${shown})이 있는 반은 요일을 옮길 수 없습니다 — 옮기면 그 학생이 명단에서 빠지거나 다른 교시에 더해집니다. 같은 요일 안에서 시각만 옮겨 주세요`,
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

  const cutoff = shiftYmd(effective, -1);
  /**
   * 되돌리기 일지 — 트랜잭션이 없으니 **한 것을 그대로 되짚어** 원복한다(보상 트랜잭션).
   * 🔴 옛 코드는 새 행만 지우고 **이미 마감·삭제한 옛 행은 그대로 뒀다** — 중간에 실패하면 그 반이 적용일부터
   *    교시를 잃은 채 화면엔 "되돌렸습니다"가 떴다(삭제분은 복구 불가, 적대 리뷰 2026-09-04).
   * `carried` = 함께 옮긴 기록 한 묶음(같은 출발·도착 칸) — 되짚을 땐 원래 (날짜, 교시)로. 옮긴 순서를 거꾸로 밟으므로 유니크가
   * 도중에 부딪히지 않는다(`carryRounds`). `picks` = 새 칸을 더하기 전의 교재 배정 고른 교시.
   */
  const journal: (
    | { kind: "inserted"; id: string }
    | { kind: "closed"; id: string; prevValidTo: string | null }
    | { kind: "deleted"; row: SlotRow }
    | { kind: "carried"; table: string; label: string; ids: string[]; fromDate: string; fromSlot: string; toDate: string; toSlot: string }
    | { kind: "picks"; id: string; prev: string[]; updatedAt: string }
    | { kind: "gapMarks"; ids: string[] }
    | { kind: "gapOrigin"; ids: string[] }
  )[] = [];
  /** 그 표에서 (날짜, 교시)를 바꾸는 값 — 교시 메모는 열쇠 글자와 주(월요일)를 함께 바꾼다(DB CHECK: 열쇠 날짜가 그 주 안). */
  const carryPatch = (table: string, date: string, slot: string): Record<string, string> => {
    if (table === MEMO_TABLE) return { week_start: mondayOf(date), memo_key: slotMemoKey(date, slot) };
    const a = SLOT_ANCHORS.find((x) => x.table === table)!;
    return { [a.dateColumn]: date, slot_start: slot };
  };
  /**
   * 그 (날짜, 교시)에 **아직 있는** 줄만 고친다 — 판정과 쓰기 사이에 시트 미룸·줄 옮기기·릴레이가 같은 줄을 옮겼으면 낡은 날짜로
   * 덮어쓰지 않고 건너뛴다(적대 리뷰 2026-10-28). 건너뛴 줄은 일지·요약에서 빠진다(실제로 바뀐 줄만 센다).
   */
  const carryWhere = (table: string, date: string, slot: string): [string, string][] => {
    if (table === MEMO_TABLE) return [["memo_key", slotMemoKey(date, slot)]];
    const a = SLOT_ANCHORS.find((x) => x.table === table)!;
    return [
      [a.dateColumn, date],
      ["slot_start", slot],
    ];
  };
  /**
   * 되짚기 — 실패한 단계가 있으면 clean=false(화면에 "되돌렸습니다"라고 거짓말하지 않는다 · 리뷰 2026-10-28).
   * `stranded` = 옛 교시로 되돌리지 못한 기록(표·날짜) — 배치는 옛 자리로 돌아가므로 그 기록은 **배치 없는 새 교시에 남아**
   * 수업 시트에서 사라진다. 손으로 되살릴 수 있게 표·id·출발/도착을 로그에 남기고 안내에도 적는다(적대 리뷰 2026-10-28).
   */
  const undo = async (): Promise<{ clean: boolean; stranded: { label: string; dates: string[] }[] }> => {
    let clean = true;
    const stranded = new Map<string, string[]>();
    const check = (error: unknown, context?: Record<string, unknown>) => {
      if (!error) return false;
      clean = false;
      logDbError(error, "timetable.moveClassSlots.undo", { classId, ...context });
      return true;
    };
    // 역순으로 되짚는다(넣은 것은 지우고, 마감은 원래 날짜로, 지운 행은 **원래 id 그대로** 다시 넣는다).
    for (const j of [...journal].reverse()) {
      if (j.kind === "gapOrigin") {
        check(
          (
            await admin
              .from("class_lesson_shifts")
              .update({ origin: "manual" })
              .in("id", j.ids)
              .eq("tenant_id", user.tenantId)
              .eq("class_id", classId)
          ).error,
          { gapOriginIds: j.ids },
        );
      } else if (j.kind === "gapMarks") {
        check(
          (await admin.from("class_lesson_shifts").delete().in("id", j.ids).eq("tenant_id", user.tenantId).eq("class_id", classId))
            .error,
          { gapMarkIds: j.ids },
        );
      } else if (j.kind === "picks") {
        // 우리가 쓴 뒤 남이 그 배정을 또 고쳤으면(수정 시각이 다르면) 덮어쓰지 않는다 — 그 변경을 지우게 된다(3차 리뷰 2026-10-28).
        const { data: back, error } = await admin
          .from("class_textbook_plans")
          .update({ slot_picks: j.prev })
          .eq("id", j.id)
          .eq("tenant_id", user.tenantId)
          .eq("updated_at", j.updatedAt)
          .select("id");
        check(error ?? ((back ?? []).length !== 1 ? new Error("그사이 교재 배정이 바뀌어 되돌리지 않았습니다") : null), {
          planId: j.id,
          slotPicks: j.prev,
        });
      } else if (j.kind === "carried") {
        if (j.ids.length === 0) continue;
        let q = admin
          .from(j.table)
          .update(carryPatch(j.table, j.fromDate, j.fromSlot))
          .in("id", j.ids)
          .eq("tenant_id", user.tenantId)
          .eq("class_id", classId);
        for (const [c, v] of carryWhere(j.table, j.toDate, j.toSlot)) q = q.eq(c, v);
        const { data: back, error } = await q.select("id");
        // 오류가 없어도 덜 돌아왔으면(그사이 누가 그 줄을 또 옮기거나 지웠다) 실패로 친다 — 못 돌린 줄만 적는다.
        const returned = new Set((back ?? []).map((r) => String((r as { id: unknown }).id)));
        const left = error ? j.ids : j.ids.filter((id) => !returned.has(id));
        const failed = check(error ?? (left.length > 0 ? new Error("되돌린 줄 수가 모자랍니다") : null), {
          table: j.table,
          ids: left,
          from: `${j.fromDate} ${j.fromSlot}`,
          to: `${j.toDate} ${j.toSlot}`,
        });
        if (failed) stranded.set(j.label, [...(stranded.get(j.label) ?? []), j.toDate]);
      } else if (j.kind === "inserted") {
        check((await admin.from("class_schedules").delete().eq("id", j.id).eq("tenant_id", user.tenantId)).error);
      } else if (j.kind === "closed") {
        check(
          (await admin.from("class_schedules").update({ valid_to: j.prevValidTo }).eq("id", j.id).eq("tenant_id", user.tenantId))
            .error,
        );
      } else {
        // 🔴 id를 그대로 되살린다 — 예약 스냅샷·감사로그가 그 id를 가리킨다.
        const { error } = await admin.from("class_schedules").insert(j.row);
        // 칸이 없거나 스키마 캐시가 늦어 실패했으면 **표식 없이** 한 번 더 — 행 보존이 표식 보존보다 먼저다(재리뷰 2026-09-17).
        if (error && isMissingColumnError(error)) {
          const withoutLab = { ...j.row };
          delete withoutLab.lab_separate;
          check((await admin.from("class_schedules").insert(withoutLab)).error);
        } else check(error);
      }
    }
    return { clean, stranded: [...stranded].map(([label, dates]) => ({ label, dates: [...new Set(dates)].sort() })) };
  };
  const undoneText = async (what: string) => {
    const { clean, stranded } = await undo();
    if (clean) return `${what} 되돌렸습니다. 잠시 후 다시 시도해 주세요`;
    const left = stranded.map((s) => `${s.label} ${dateList(s.dates)}`).join(" · ");
    return left
      ? `${what} 되돌리기도 일부 실패했습니다 — 옛 교시로 되돌리지 못한 기록(${left})이 배치 없는 새 교시에 남아 수업 시트에서 보이지 않습니다. 시간표를 새로 고쳐 이 반 배치를 확인하고 관리자에게 알려 주세요`
      : `${what} 되돌리기도 일부 실패했습니다 — 시간표를 새로 고쳐 이 반 배치를 확인해 주세요`;
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
        ...(row.lab_separate === undefined ? {} : { lab_separate: row.lab_separate }),
      })
      .select("id")
      .single();
    if (insErr || !created) {
      logDbError(insErr, "timetable.moveClassSlots");
      return { ok: false, error: await undoneText("새 배치를 넣지 못해") };
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
      logDbError(closeErr, "timetable.moveClassSlots.close");
      return { ok: false, error: await undoneText("옛 배치를 마감하지 못해") };
    }
    journal.push(
      validFrom && validFrom < effective
        ? { kind: "closed", id: row.id, prevValidTo: row.valid_to }
        : { kind: "deleted", row },
    );
  }
  // 기록을 새 교시로 — 배치를 다 쓴 뒤에(여기서 실패하면 기록과 배치를 함께 되짚는다). 단계(`carryRounds`)마다, 같은 출발·도착
  // 칸끼리 한 번에 쓴다 · 한 단계의 묶음은 서로 무관해 8개씩 동시에(몇 달 치 계획이면 묶음이 수십 개다). 실제로 바뀐 줄만 일지에
  // 남긴다(그사이 지워진 줄은 되돌릴 것도 없다) — 동시에 쓴 묶음 중 하나가 실패해도 성공한 묶음은 일지에 들어간 뒤 되짚는다.
  for (const round of rounds) {
    const groups = carryGroups(round);
    for (let k = 0; k < groups.length; k += CARRY_PARALLEL) {
      const batch = groups.slice(k, k + CARRY_PARALLEL);
      const results = await Promise.all(
        batch.map((g) => {
          let q = admin
            .from(g.table)
            .update(carryPatch(g.table, g.toDate, g.toSlot))
            .in("id", g.ids)
            .eq("tenant_id", user.tenantId)
            .eq("class_id", classId);
          for (const [c, v] of carryWhere(g.table, g.fromDate, g.fromSlot)) q = q.eq(c, v);
          return q.select("id");
        }),
      );
      let carryErr: unknown = null;
      results.forEach(({ data: done, error }, n) => {
        const g = batch[n]!;
        if (error) {
          carryErr ??= error;
          logDbError(error, "timetable.moveClassSlots.carry", { classId, table: g.table });
          return;
        }
        journal.push({
          kind: "carried",
          table: g.table,
          label: g.label,
          ids: (done ?? []).map((r) => String((r as { id: unknown }).id)),
          fromDate: g.fromDate,
          fromSlot: g.fromSlot,
          toDate: g.toDate,
          toSlot: g.toSlot,
        });
      });
      if (carryErr) return { ok: false, error: await undoneText("기록을 새 교시로 옮기지 못해 배치와 기록을") };
    }
  }
  // 교재 배정 고른 교시 — 기록까지 옮긴 뒤에. 판정 뒤 그사이 배정이 바뀌었으면(수정 시각이 다르면) 낡은 목록으로 덮어쓰지 않고 되짚는다.
  for (const c of picksChanges) {
    const { data: done, error } = await admin
      .from("class_textbook_plans")
      .update({ slot_picks: c.next })
      .eq("id", c.id)
      .eq("tenant_id", user.tenantId)
      .eq("class_id", classId)
      .eq("updated_at", c.updatedAt)
      .select("id, updated_at");
    if (error || (done ?? []).length !== 1) {
      if (error) logDbError(error, "timetable.moveClassSlots.slotPicks", { classId, planId: c.id });
      return {
        ok: false,
        error: await undoneText(error ? "교재 배정 교시를 고치지 못해 배치와 기록을" : "그사이 교재 배정이 바뀌어 배치와 기록을"),
      };
    }
    journal.push({ kind: "picks", id: c.id, prev: c.prev, updatedAt: String(done![0]!.updated_at) });
  }
  // 비는 회차의 칸 미룸 표식 — 맨 끝에(옮겨 떠날 표식이 그 칸을 비운 뒤라 유니크가 안 부딪힌다).
  if (gapMarks.length > 0) {
    // `origin = 'timetable_move'` — 원래 계획(달력 판정·비교·현황)도 이 회차를 건너뛴다(s2_0005). 칸이 없으면(적용 전) 없이 쓴다.
    const insertGaps = (origin: boolean) =>
      admin
        .from("class_lesson_shifts")
        .insert(
          gapMarks.map((g) => ({
            tenant_id: user.tenantId,
            class_id: classId,
            plan_date: g.date,
            slot_start: g.slot,
            kind: "skip",
            lane: "",
            pos: 0,
            created_by: user.id,
            ...(origin ? { origin: MOVE_GAP_ORIGIN } : {}),
          })),
        )
        .select("id");
    let { data: made, error } = await insertGaps(true);
    if (isMissingOriginColumn(error)) ({ data: made, error } = await insertGaps(false));
    if (error || (made ?? []).length !== gapMarks.length) {
      if (error) logDbError(error, "timetable.moveClassSlots.gapMarks", { classId });
      if (made && made.length > 0) journal.push({ kind: "gapMarks", ids: made.map((r) => String(r.id)) });
      return { ok: false, error: await undoneText("비는 회차에 미룸 표식을 쓰지 못해 배치와 기록을") };
    }
    journal.push({ kind: "gapMarks", ids: made!.map((r) => String(r.id)) });
  }
  if (gapRelabel.length > 0) {
    const { data: relabeled, error } = await admin
      .from("class_lesson_shifts")
      .update({ origin: MOVE_GAP_ORIGIN })
      .in("id", gapRelabel)
      .eq("tenant_id", user.tenantId)
      .eq("class_id", classId)
      .eq("origin", "manual")
      .select("id");
    if (error) {
      logDbError(error, "timetable.moveClassSlots.gapOrigin", { classId });
      return { ok: false, error: await undoneText("비는 회차 미룸 표식의 출처를 바꾸지 못해 배치와 기록을") };
    }
    if ((relabeled ?? []).length > 0) journal.push({ kind: "gapOrigin", ids: relabeled!.map((r) => String(r.id)) });
  }
  // 요약은 실제로 바뀐 줄로 센다(판정 뒤 그사이 지워지거나 옮겨진 줄은 빠진다).
  const movedIds = new Set(journal.flatMap((j) => (j.kind === "carried" ? j.ids.map((id) => `${j.table}|${id}`) : [])));
  const movedItems = carry.filter((i) => movedIds.has(`${i.table}|${i.id}`));
  const carried = carrySummary(
    movedItems,
    block.pushed,
    picksChanges.length,
    gapMarks.map((g) => g.date),
  );
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
      // 한글 요약은 감사로그 화면이 그대로 보여 준다(영문 키 폴백은 한글 값만 그린다) · 표별 건수는 원문(툴팁)에.
      ...(carried ? { carried, carriedCounts: countByTable(movedItems) } : {}),
      // 새 칸을 더한 교재 배정(되돌릴 때 원래 목록이 필요하다 — 원문 툴팁에 남는다).
      ...(picksChanges.length > 0 ? { slotPicks: picksChanges.map((c) => ({ planId: c.id, before: c.prev, after: c.next })) } : {}),
    },
  });
  // 배치를 읽는 화면 모두(시간표 저장 `master-sheet-actions`와 같은 범위 + 그 반 상세).
  revalidatePath("/timetable");
  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/students", "layout");
  revalidatePath("/ecs");
  revalidatePath("/attendance");
  if (carried) {
    // 함께 옮긴 기록을 읽는 화면(수업 시트·월간계획·원스크린 — 수업 시트 저장과 같은 범위).
    revalidatePath(`/ecs/${classId}`, "layout");
    revalidatePath("/textbooks");
    revalidatePath("/onescreen");
  }
  return carried ? { ok: true, moved: windows.length, carried } : { ok: true, moved: windows.length };
}

/** 표별 건수(감사로그 원문용). */
function countByTable(items: readonly CarryItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.table] = (out[i.table] ?? 0) + 1;
  return out;
}
