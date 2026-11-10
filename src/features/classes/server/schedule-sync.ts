import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { isCurrentSlot, type PriorSlot } from "../schedule-preserve";
import { lookupLabSeparateIds } from "./lab-separate";
import { explainDbError } from "@/lib/supabase/db-error";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * 반 수정의 스케줄 동기화 범위 = **현재 유효한 행만**.
 *
 * 🔴 왜: `class_schedules`에는 지난 배치가 `valid_to`로 마감된 채 남아 있다(영어 시트 구조 가져오기
 *    0087a가 옛 배치를 2026-07-02로 닫고 새 배치를 07-03부터 넣은 결과 — 실측 372행 전부 이미 만료,
 *    살아있는 행과 만료 행을 함께 가진 활성 반 26개). 옛 `delete().eq("class_id", id)`는 그 이력까지
 *    쓸어갔다. 반 메모 한 줄만 고쳐 저장해도 3~6월 시간표 기록이 영구 소멸한다(타임머신이 거짓말하게 됨).
 * 🔴 덤으로 **비결정 라벨 오염**도 사라진다: 만료 행이 섞여 있으면 (요일,시작) 중복이 83그룹 생기고
 *    그 전부가 옛/현 라벨이 다르다 → 짝짓기가 옛 행을 집으면 "지난 학기 강사"가 현재 행에 되살아난다.
 *    유효 행만 보면 중복은 **0그룹**이라 짝짓기가 유일해진다(실측).
 */
const currentFilter = (today: string) => `valid_to.is.null,valid_to.gte.${today}`;

/**
 * delete 전에 읽어 두는 **현재 유효한** 기존 스케줄 — 폼이 안 보내는 컬럼을 재삽입 때 되살리기 위한 것.
 * ⚠️ error를 `?? []`로 삼키지 않는다(규칙 B3). 빈 배열로 떨어지면 `preserveScheduleFields`가 전 행을
 *    "신규"로 보고 라벨·기간을 null로 재작성하는데, 그 시점엔 이미 delete가 끝나 복구가 불가능하다.
 */
export async function loadCurrentSlots(
  supabase: Db,
  classId: string,
  today: string,
): Promise<{
  rows?: PriorSlot[];
  error?: string;
  /**
   * 0271a '따로 수업(*LAB)' 칸을 읽었는가. false면 호출부는 **insert에서 `lab_separate`를 빼고** 폼 값도
   * 무시한다 — 칸이 없는 DB에 키를 실으면 delete 뒤 insert 전체가 실패해 그 반의 교시가 사라진다([[#95]]).
   */
  labSeparateSupported?: boolean;
}> {
  // 한 반의 슬롯 = 요일×교시라 수십 행 상한(폼 파서도 80 상한) → 페이징 불필요.
  // 표식은 **따로 fail-soft로** 받는다(lab-separate.ts 주석) — 이 조회에 컬럼을 끼우면 0271a 전엔 저장이 전부 막힌다.
  const [{ data, error }, labLookup] = await Promise.all([
    supabase
      .from("class_schedules")
      .select(
        // teacher_id·classroom_id는 **이력 판정용**(담당·강의실이 바뀌면 옛 값을 마감 행으로 남긴다,
        // planSlotArchives). 빠뜨리면 변경 감지가 항상 "안 바뀜"이 돼 이력이 조용히 안 쌓인다.
        "id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group",
      )
      .eq("class_id", classId)
      .or(currentFilter(today))
      // 결정적 순서 — 무기한·최신 행이 먼저 소비되게(정렬 없는 shift()는 DB 물리순서 의존이라 재현 불가).
      .order("valid_to", { ascending: false, nullsFirst: true })
      .order("valid_from", { ascending: false })
      .order("start_time"),
    lookupLabSeparateIds(supabase, { kind: "class", classId }),
  ]);
  // 🔴 표식 조회의 **일시 실패**도 멈춘다 — "칸 없음"으로 읽고 진행하면 delete 뒤 재insert가 기본값(false)으로
  //    그 반의 '따로 수업(*LAB)' 표식을 전부 조용히 끈다(적대적 리뷰 2026-09-17). 칸이 없는 것만 "지원 안 함"이다.
  if (error || labLookup === "error") {
    return { error: "기존 시간표를 읽지 못해 저장을 중단했습니다. 잠시 후 다시 시도해주세요." };
  }
  const labIds = labLookup === "missing" ? null : labLookup.ids;
  return {
    labSeparateSupported: labIds !== null,
    rows: (data ?? [])
      // DB 필터를 한 번 더 코드에서 확인 — 만료 행이 한 줄이라도 섞이면 옛 라벨이 되살아난다.
      .filter((r) => isCurrentSlot(r.valid_to, today))
      .map((r) => ({
        dayOfWeek: r.day_of_week,
        startTime: String(r.start_time),
        endTime: String(r.end_time),
        validFrom: r.valid_from,
        validTo: r.valid_to,
        teacherId: r.teacher_id ?? null,
        classroomId: r.classroom_id ?? null,
        slotTeacherLabel: r.slot_teacher_label,
        slotRoomLabel: r.slot_room_label,
        periodLabel: r.period_label,
        mergeGroup: r.merge_group,
        ...(labIds ? { labSeparate: labIds.has(String(r.id)) } : {}),
      })),
  };
}

/** 재삽입 직전 삭제 — **현재 유효한 행만**. 만료 행(운영 이력)은 그대로 둔다. */
export async function deleteCurrentSlots(
  supabase: Db,
  classId: string,
  today: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("class_schedules")
    .delete()
    .eq("class_id", classId)
    .or(currentFilter(today));
  return error ? { error: explainDbError(error, { scope: "classes.schedule-sync.deleteCurrentSlots", fallback: "스케줄 저장 실패 — 잠시 후 다시 시도해 주세요", op: "delete" }).message } : {};
}
