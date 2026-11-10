import "server-only";

/**
 * 등록상담이 **실제로 어느 반에 배정됐는지** — 칸반의 '반 배정 완료' 표식과 **같은 사실**을 화면에 편다.
 *
 * 🔴 판정을 새로 만들지 않는다. 배정은 `outcome`이 아니라 **연결 학생의 미종료 수강**에서 나오는
 *    파생값이고([`board-stages.ts`](../board-stages.ts) `stageOfCard`), 그 셈은 원래 상세 쿼리 안에
 *    head-count 한 줄로 박혀 있었다. 여기로 꺼내 **세는 쪽(`countAssignedClasses`)과 펴는 쪽
 *    (`getAssignedClasses`)이 같은 필터 한 벌**(`assignedQuery`)을 타게 했다 — 갈라지면 배지는
 *    "반 배정 완료"라는데 카드엔 아무 반도 안 서는 화면이 된다.
 *
 * ⚠️ **조회 실패를 '배정 없음'으로 위장하지 않는다.** `AssignedClasses`는 성공(rows)과 실패(error)를
 *    다른 모양으로 돌려주고, 화면이 그 둘을 다른 문장으로 적는다(빈 배열로 삼키면 반이 있는 학생이
 *    "아직 배정된 반이 없습니다"로 보인다 = 데스크가 배정을 한 번 더 한다).
 *
 * ⚠️ **반 이름은 `classes.class_name` 그대로 쓴다**(`resolveClassNameAsOf`를 태우지 않는다) — 이 카드의
 *    기준일은 **오늘**이고 예약된 개명은 아직 그 반의 이름이 아니기 때문이다("그 날짜의 이름" 규약은
 *    날짜 축을 가진 표면(시간표 칸·자리판)의 것이다). 그래서 스냅샷 조회 왕복도 더하지 않는다.
 *    ⚠️ 이 카드에 **주(週)·미래 날짜 축이 생기면** 그때는 `resolveClassNameAsOf`를 태울 것.
 */

import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig, enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import { groupSchedule, type ScheduleGroup } from "@/features/classes/schedule-periods";
import { slotPhase } from "@/features/classes/schedule-summary";
import { consultClassKeys, type ConsultClassKeys } from "../consult-subject";
import { explainDbError } from "@/lib/supabase/db-error";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type AssignedClassRow = {
  /**
   * 수강 행 id — 화면 key. 🔴 `classId`를 key로 쓰면 안 된다: 같은 반을 **오늘 끝내고 오늘 다시 여는**
   * 수강(재등록·분리등원 재편)이 두 행으로 잡혀 같은 키가 겹친다(GiST는 겹치는 기간만 막는다).
   */
  enrollmentId: string;
  classId: string;
  className: string;
  /** 한글 과목 라벨 — 학원설정 단일 소스(`buildSubjectMaps`). raw 키를 화면에 내지 않는다. */
  subjectLabel: string;
  teacherName: string | null;
  /**
   * "월·목 1-3교시" 묶음.
   * · `[]` = 유효 교시가 하나도 없다(화면 '시간 미정')
   * · `null` = **교시를 못 읽었다**(화면 '시간 확인 불가') — 🔴 실패를 빈 배열로 뭉치지 말 것.
   *   "시간 미정"은 사실 주장이라, 조회가 죽었을 때 그렇게 적으면 화면이 거짓말을 한다.
   */
  schedule: ScheduleGroup[] | null;
  /** 휴원(on_hold) 수강 — 반은 배정돼 있지만 지금은 안 나온다. 화면이 표식을 붙인다. */
  onHold: boolean;
};

/** 성공/실패를 **모양으로** 가른다 — 호출부가 실수로 빈 배열과 뭉치지 못하게. */
export type AssignedClasses = { ok: true; rows: AssignedClassRow[] } | { ok: false; error: string };

/**
 * 배정 판정 필터 — **이 한 곳**이 "배정됐다"의 정의다.
 *  · 연결 학생의 수강일 것
 *  · 아직 안 끝났을 것(종료일 없음 또는 오늘 이후)
 *  · 상담 과목이 적혀 있으면 **그 과목 반만**(교차과목 오매몰 차단 — 영어 상담이 수학 수강 때문에
 *    '배정 완료'로 묻히지 않게. 상담 과목이 비어 있으면 전 과목 폴백). 과목 글자 → 반 과목 키는
 *    [`consultClassKeys`](../consult-subject.ts) 한 벌(2026-10-23 — 옛 이관 상담의 '수학'·'EIE'·'영어, 수학'도 그 반을 찾는다 ·
 *    못 읽는 글자('영수'·'고등특강')는 **배정 없음** — 조회 없이 0건)
 *
 * 🔴 반 임베드는 과목 필터가 없어도 `!inner`로 **항상** 건다 — 세는 쿼리와 펴는 쿼리가 같은 집합을
 *    보게 하려는 것이다(한쪽만 조인하면 반 행이 안 읽히는 순간 두 값이 갈린다).
 * ⚠️ `end_date.gte`는 엄밀히는 **프리필터**다([[#125]] — 반이동으로 닫힌 수강이 그 하루 겹칠 수 있다).
 *    여기서 조이지 않는 이유는 이 조건이 칸반 '반 배정 완료' 배지가 쓰던 조건 **그대로**이기 때문이다.
 *    조이려면 목록 쪽(`assignedCountFor`)과 **함께** 조일 것 — 한쪽만 고치면 배지와 카드가 갈린다.
 */
function assignedQuery(
  supabase: SupabaseClient,
  studentId: string,
  classKeys: ConsultClassKeys,
  select: string,
  options?: { count: "exact"; head: boolean },
) {
  const q = supabase
    .from("enrollments")
    .select(select, options)
    .eq("student_id", studentId)
    .or(`end_date.is.null,end_date.gte.${kstToday()}`);
  return classKeys ? q.in("class.subject", [...classKeys]) : q;
}

/**
 * 상담 과목 글자 → 볼 반 과목 키(`null` = 과목 모름 → 전 과목 · `[]` = 못 읽음 → 배정 없음). 설정은 요청 캐시라 왕복이 더 안 든다.
 * 🔴 세는 쪽·펴는 쪽·이름 목록이 전부 여기를 지난다 — 한쪽만 글자 비교로 남으면 배지와 카드가 갈린다.
 */
async function classKeysFor(subject: string | null): Promise<ConsultClassKeys> {
  if (!subject?.trim()) return null;
  const settings = await getTenantSettings();
  return consultClassKeys(subject, settings.operations.subjects);
}

/** 상담 과목 기준 배정 반 **개수**(행을 안 받는 count — B2). */
export async function countAssignedClasses(
  supabase: SupabaseClient,
  studentId: string | null,
  subject: string | null,
): Promise<number> {
  if (!studentId) return 0;
  const classKeys = await classKeysFor(subject);
  if (classKeys?.length === 0) return 0;
  const { count, error } = await assignedQuery(supabase, studentId, classKeys, "*, class:class_id!inner ( subject )", {
    count: "exact",
    head: true,
  });
  if (error) throw new Error("수강 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return count ?? 0;
}

/**
 * 상담 과목 기준 배정 반의 **이름·과목 키**(운영실 '전일 / 이달 신규' 팝업 — 원장 2026-10-22 *"반배정된 반이름과 과목 보이게"*).
 * 개수와 같은 필터(`assignedQuery`)라 이 목록이 비면 배지도 '배정 전'이다. 같은 반이 두 수강 행(오늘 끝내고 오늘 다시 연 수강)으로
 * 잡혀도 한 번만 · 이름 순. 조회 실패는 던진다(빈 목록 = '배정 전'으로 위장하지 않는다).
 */
export async function listAssignedClassNames(
  supabase: SupabaseClient,
  studentId: string | null,
  subject: string | null,
): Promise<{ name: string; subject: string | null }[]> {
  if (!studentId) return [];
  const classKeys = await classKeysFor(subject);
  if (classKeys?.length === 0) return [];
  type Klass = { class_name: string; subject: string | null };
  const { data, error } = await assignedQuery(supabase, studentId, classKeys, "id, class:class_id!inner ( class_name, subject )");
  if (error) throw new Error("배정 반을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const seen = new Map<string, { name: string; subject: string | null }>();
  for (const row of (data ?? []) as unknown as { class: Klass | Klass[] | null }[]) {
    const klass = Array.isArray(row.class) ? row.class[0] : row.class;
    if (klass) seen.set(`${klass.subject ?? ""}|${klass.class_name}`, { name: klass.class_name, subject: klass.subject ?? null });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

type SchedRow = {
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
};

type ClassEmbed = {
  id: string;
  class_name: string;
  subject: string;
  teacher: { display_name?: string } | { display_name?: string }[] | null;
};

type EnrollmentEmbedRow = {
  id: string;
  on_hold: boolean | null;
  attendance_days: string[] | null;
  class: ClassEmbed | ClassEmbed[] | null;
};

/** 배정 반 상세(반 이름·과목·담임·요일/교시). 학생 연결이 없으면 **빈 목록**(실패가 아니다). */
export async function getAssignedClasses(
  studentId: string | null,
  subject: string | null,
): Promise<AssignedClasses> {
  if (!studentId) return { ok: true, rows: [] };
  const classKeys = await classKeysFor(subject);
  if (classKeys?.length === 0) return { ok: true, rows: [] };
  const supabase = await createClient();

  const { data, error } = await assignedQuery(
    supabase,
    studentId,
    classKeys,
    // [[#94]] — 임베드는 FK를 명시(`class_id`·`teacher_id`)한다. 안 적으면 남이 FK를 하나 더 다는 날
    //          PGRST201로 이 카드가 통째로 죽는다.
    `id, on_hold, attendance_days,
     class:class_id!inner ( id, class_name, subject, teacher:teacher_id ( display_name ) )`,
  );
  if (error) return { ok: false, error: explainDbError(error, { scope: "enrollment.assigned-classes.getAssignedClasses", fallback: "배정 반을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const rows = (data ?? []) as unknown as EnrollmentEmbedRow[];
  const flat = rows
    .map((r) => ({ row: r, klass: (Array.isArray(r.class) ? r.class[0] : r.class) ?? null }))
    .filter((r): r is { row: EnrollmentEmbedRow; klass: ClassEmbed } => !!r.klass);
  if (flat.length === 0) return { ok: true, rows: [] };

  const classIds = [...new Set(flat.map((r) => r.klass.id))];

  // 서로 독립이라 병렬(B4). 설정은 React cache라 같은 요청 안에서는 왕복이 더 안 든다.
  // ⚠️ 교시 조회만 따로 `catch`한다 — 시간을 못 읽었다고 **반 이름·담임까지 감추면** 지금 화면에서
  //    가장 중요한 정보를 잃는다. 카드는 살리되 실패는 `schedule: null`로 **드러낸다**(빈 배열로
  //    삼키면 교시가 멀쩡한 반이 "시간 미정"으로 보인다 — 이 파일이 막으려는 바로 그 거짓말).
  const [scheds, settings] = await Promise.all([
    // 반 몇 개짜리 `.in()`이라 414도 1000행 절단도 닿지 않지만, error를 삼키지 않는 헬퍼를 쓴다(B3).
    fetchInChunks<SchedRow>(classIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to")
        .in("class_id", chunk),
    ).catch(() => null),
    getTenantSettings(),
  ]);

  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const today = kstToday();

  const slotsByClass = new Map<string, SchedRow[]>();
  for (const s of scheds ?? []) {
    const arr = slotsByClass.get(s.class_id) ?? [];
    arr.push(s);
    slotsByClass.set(s.class_id, arr);
  }

  return {
    ok: true,
    rows: flat.map(({ row, klass }) => {
      // ⚠️ `class_schedules`는 운영 이력을 함께 담는다([[#88]]) — 만료 배치를 그대로 그리면 이제 안 하는
      //    교시가 현재 시간표로 보인다. 판정은 반 상세·시간표와 같은 `slotPhase`.
      const live = (slotsByClass.get(klass.id) ?? []).filter(
        (s) =>
          slotPhase(
            {
              dayOfWeek: s.day_of_week,
              startTime: String(s.start_time),
              endTime: String(s.end_time),
              validFrom: s.valid_from,
              validTo: s.valid_to,
            },
            today,
          ) === "current",
      );
      // 분리등원(그 학생이 실제로 나오는 요일)이 있으면 그 요일만 — 반 전체 요일을 적으면 이 학생이
      // 안 나오는 날까지 "배정된 시간"으로 읽힌다(학생 상세 '수업' 탭과 같은 규칙).
      const attKo = (row.attendance_days ?? []).map((d) => enumDayToKo(d as DayOfWeek));
      return {
        enrollmentId: row.id,
        classId: klass.id,
        className: klass.class_name,
        subjectLabel: subjectMaps.labelOf(klass.subject),
        teacherName: teacherNameOf(klass.teacher),
        schedule:
          scheds === null
            ? null
            : groupSchedule(
                live.map((s) => ({
                  day: s.day_of_week as DayOfWeek,
                  startTime: String(s.start_time).slice(0, 5),
                  endTime: String(s.end_time).slice(0, 5),
                })),
                klass.subject,
                attKo,
                periodsConfig,
              ),
        onHold: !!row.on_hold,
      };
    }),
  };
}

function teacherNameOf(
  t: { display_name?: string } | { display_name?: string }[] | null | undefined,
): string | null {
  const one = Array.isArray(t) ? t[0] : t;
  return one?.display_name ?? null;
}
