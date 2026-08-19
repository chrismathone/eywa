import "server-only";

/**
 * 보강이 메울 **결석 후보** 조회 — 확인창의 목록 재료(원장 2026-08-19 *"이전 수업을 이월해 보강"*).
 *
 * 🔴 **수강 여부로 거르지 않는다.** 반을 옮긴 학생의 옛 반 결석이 곧 이월 보강 대상이므로, 출결 기록
 *    자체를 후보로 삼는다. 지금 수강 중이 아닌 반은 화면에 '이전 반'으로 밝힌다(고르는 사람이 알아야 한다).
 * ⚠️ 창은 **1년**이다(아래 WINDOW_DAYS) — 90일로 좁혔더니 실측 이월 후보 249쌍 중 174쌍이 창 밖이었다.
 * ⚠️ 결석만이 아니라 **공결(excused)** 도 넣는다 — 사유 있는 결석도 보강 대상이다.
 *
 * 🔴 **과목은 앵커 classId로 여기서 조회한다**(원장 제보 2026-08-19: 수학 반 보강인데 영어 결석이
 *    후보로 떠 잘못 고르면 영어 결석 칸에 메모가 갔다). 반 id만 받아 `classes.subject`를 서버가 읽는다 —
 *    부르는 쪽이 과목을 정하면 화면마다 기준이 갈리고, 그 반과 무관한 과목으로 목록을 열 수 있다.
 *    실측: 후보 1,041건 중 수학 앵커에서 147건이 빠진다.
 * ⚠️ **이건 목록(표시) 기준이지 쓰기 강제가 아니다** — [`noteMakeupAgainstAbsence`](./makeup-note-action.ts)는
 *    `absentClassId`의 과목을 검사하지 않는다(직접 입력 경로도 있다). "과목이 다르면 저장이 막힌다"고 읽지 말 것.
 */

import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { buildAbsenceOptions, type AbsenceRow, type MakeupAbsenceList } from "../makeup-options";

// 이월 보강은 지난 학기 결석까지 거슬러 간다 — 90일로 자르면 실측 이월 후보(지금 수강 아닌 반의 결석)
// 249쌍 중 174쌍(70%)이 창 밖으로 떨어졌다. 1년으로 연다.
const WINDOW_DAYS = 365;
/** 한 학생 1년 결석은 실측 최다 수십 행 — 상한은 방어용이다(B2). */
const MAX_ROWS = 1000;

/** 아무것도 못 찾았을 때의 빈 한 벌 — 화면은 이걸 받아 '직접 입력'으로 폴백한다. */
const EMPTY: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

/**
 * @param anchorClassId 지금 보강을 넣는 반 — 그 반의 과목과 맞는 결석만 남긴다(없으면 안 거른다).
 */
export async function getMakeupAbsenceOptions(
  studentId: string,
  makeupDate: string,
  anchorClassId?: string | null,
): Promise<MakeupAbsenceList> {
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(makeupDate)) return EMPTY;
  const supabase = await createClient();
  const from = addDays(makeupDate, -WINDOW_DAYS);

  // B4 — 넷은 서로 독립이라 함께 던진다(앵커가 없으면 뒤 둘은 아예 안 돈다).
  const [{ data: rows, error }, { data: enrolls }, anchorSubject, settings] = await Promise.all([
    supabase
      .from("attendance_records")
      // ⚠️ 임베드는 FK 이름을 명시한다(#94 — 컬럼이 늘면 맨몸 임베드는 300으로 죽는다).
      // ⚠️ FK 힌트 이름은 **그 표의 실제 제약 이름**이다(#94). drizzle 명명이라 `_fkey`가 아니라
      //    `attendance_records_class_id_classes_id_fk` — 옆 파일(lesson_reports)의 이름을 베끼면
      //    PostgREST가 400(PGRST200)을 뱉고 목록이 **언제나 비어** "결석 기록이 없습니다"로 위장한다.
      .select(
        "class_id, session_date, note, slot_start, classes!attendance_records_class_id_classes_id_fk(class_name, subject)",
      )
      .eq("student_id", studentId)
      .in("status", ["absent", "excused"])
      .gte("session_date", from)
      .lte("session_date", makeupDate)
      .order("session_date", { ascending: false })
      .limit(MAX_ROWS),
    // 지금 수강 중인 반 — '이전 반' 표시용(없어도 목록은 나온다).
    supabase.from("enrollments").select("class_id").eq("student_id", studentId).is("end_date", null),
    // 🔴 기준 과목은 **서버가 반 id로 읽는다** — 클라가 준 과목 문자열을 믿으면 필터가 없는 것과 같다.
    loadAnchorSubject(supabase, anchorClassId),
    // 과목 라벨은 학원설정이 단일 소스 — 필터가 걸릴 때만 필요하다(앵커가 없으면 조회도 안 한다).
    loadSettings(!!anchorClassId),
  ]);
  if (error) {
    // 조용히 빈 목록으로 두면 "결석이 없네?"로 오해된다 — 로그를 남기고 화면은 직접 입력으로 폴백한다.
    console.error("[makeup-options] 결석 후보 조회 실패", error.message);
    return EMPTY;
  }

  const current = new Set((enrolls ?? []).map((e) => e.class_id as string));
  type Embedded = { class_name?: string | null; subject?: string | null };
  const raw: AbsenceRow[] = (rows ?? []).map((r) => {
    const c = r.classes as Embedded | Embedded[] | null;
    const cls = Array.isArray(c) ? c[0] : c;
    return {
      classId: r.class_id as string,
      className: cls?.class_name ?? null,
      // 판정 전용 — 화면엔 안 나간다(라벨은 아래 subjectLabel 한 곳에서만 만든다).
      subject: cls?.subject ?? null,
      date: String(r.session_date),
      // 이미 보강으로 메운 결석은 그 칸 메모에 표시가 남는다 — 목록에서 '보강 완료'로 가른다.
      note: (r.note as string | null) ?? null,
      // 교시 — 하루 여러 교시를 도는 반에서 어느 수업의 결석인지 화면이 밝힌다(라벨은 순수부에서).
      slotStart: (r.slot_start as string | null) ?? null,
    };
  });
  const list = buildAbsenceOptions(raw, makeupDate, current, anchorSubject);
  return { ...list, ...(subjectLabelOf(anchorSubject, settings) ?? {}) };
}

/**
 * 앵커 반의 과목 키 — **못 읽으면 null**(= 아무것도 안 거른다).
 * 🔴 권한 밖·삭제된 반·조회 실패 어느 쪽이든 폴백은 "안 거른다"다. 여기서 예외를 흘리면 위 `Promise.all`이
 *    통째로 실패해 호출부가 빈 목록을 받는데, 그건 화면에 **"결석이 없습니다"** 로 보인다(결석은 있는데).
 */
async function loadAnchorSubject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  anchorClassId: string | null | undefined,
): Promise<string | null> {
  if (!anchorClassId) return null;
  try {
    const { data, error } = await supabase
      .from("classes")
      .select("subject")
      .eq("id", anchorClassId)
      .maybeSingle();
    // ⚠️ **조용히 열어 두지 않는다** — supabase-js는 쿼리 실패에 throw하지 않으므로, 로그가 없으면 필터가
    //    꺼진 채 옛 동작으로 돌아간 것을 아무도 모른다(화면은 매일 멀쩡해 보인다, [[#89]]).
    if (error) console.error("[makeup-options] 앵커 반 과목 조회 실패 — 과목 필터를 끕니다", error.message);
    return (data?.subject as string | null) ?? null;
  } catch (e) {
    console.error("[makeup-options] 앵커 반 과목 조회 예외 — 과목 필터를 끕니다", e);
    return null;
  }
}

/** 학원설정 — 라벨에만 쓴다. 같은 이유로 fail-soft(설정을 못 읽으면 화면이 "이 과목"이라고 말한다). */
async function loadSettings(need: boolean) {
  if (!need) return null;
  try {
    return await getTenantSettings();
  } catch (e) {
    console.error("[makeup-options] 학원설정 조회 실패 — 과목 라벨 없이 표시합니다", e);
    return null;
  }
}

/**
 * 기준 과목의 화면 라벨 — 학원설정 단일 소스(`buildSubjectMaps.labelOf`).
 * 🔴 설정에도 레거시 폴백에도 없는 키는 `labelOf`가 **raw 키를 그대로 돌려준다** — 그건 화면에 내보내지
 *    않는다(`math`·`english` 노출 금지). 그때는 라벨 없이 "이 과목"으로 말하게 둔다.
 */
function subjectLabelOf(
  subject: string | null,
  settings: Awaited<ReturnType<typeof getTenantSettings>> | null,
): { subjectLabel: string } | null {
  if (!subject || !settings) return null;
  const label = buildSubjectMaps(settings.operations.subjects).labelOf(subject);
  return label && label !== subject ? { subjectLabel: label } : null;
}
