import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { carryFolded } from "@/lib/folded-read";
import { classTeacherIdsInRange, slotOverlapsRange, type AxisSlot } from "../teacher-axis";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { homeroomTeachersInRange, type HomeroomPeriod } from "@/features/classes/teacher-as-of";

/**
 * 강사 귀속 축(`teacher-axis.ts`)의 **조회 쪽** — 순수 판정에 필요한 재료만 읽어 온다.
 *
 * 🔴 순수/IO를 가른 이유: 판정 규칙은 Vitest로 잠그고(모호·자리·유효기간), 조회는 여기 한 곳에만 둔다.
 *    화면마다 `class_schedules`를 각자 긁으면 유효기간 조건이 갈라져 같은 반이 화면마다 다른 담당을
 *    갖는다(이미 `slotLiveOnDate`류가 세 벌로 복제됐던 자리다).
 */

export type AxisTeacher = { id: string; name: string; active: boolean };

type ClassSelectRow = {
  id: string;
  class_name: string;
  subject: string;
  report_optout: boolean | null;
  closed_at: string | null;
  teacher: { id?: string; display_name?: string; status?: string } | { id?: string; display_name?: string; status?: string }[] | null;
};

type SlotRow = {
  class_id: string;
  day_of_week: string;
  start_time: string | null;
  teacher_id: string | null;
  slot_teacher_label: string | null;
  valid_from: string;
  valid_to: string | null;
};

/**
 * `[from, to]`와 겹치는 **교시 담당 배선**(teacher_id가 실제로 있는 줄만) — classId → 슬롯.
 *
 * ⚠️ 자리(LAB·JJ)는 `teacher_id`가 구조적으로 null이라 이 조회에 애초에 안 걸린다(2026-07-29 실측
 *    90/90). 라벨로 거르지 말 것 — 라벨 검사는 사람 닉네임까지 잘못 걸러낸다.
 * ⚠️ 전건 select가 아니다: 기간으로 좁히고 `.range` 페이지네이션(B2). 실측(2026-08-18) 이 필터를 통과하는
 *    행은 한 달 기준 200줄 미만이다.
 * React `cache`라 같은 요청 안에서 반이 몇 개든 **왕복 1회**다(강사 전체 보기는 반마다 매트릭스를 부른다).
 */
export const loadSlotAxisByClass = cache(
  async (from: string, to: string): Promise<Map<string, AxisSlot[]>> => {
    // 🔴 `.or()`에 문자열을 보간하므로 형식을 먼저 잠근다(월 파라미터는 URL에서 온다).
    //    어긋나면 **빈 맵** = 교시 축만 접히고 종전 담임 축으로 안전하게 강등된다(화면은 안 죽는다).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Map();
    const supabase = await createClient();
    const rows = await fetchAllPaged<SlotRow>((f, t) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .not("teacher_id", "is", null)
        .lte("valid_from", to)
        .or(`valid_to.is.null,valid_to.gte.${from}`)
        // OFFSET 페이지 안정용 unique 정렬(B2).
        .order("id", { ascending: true })
        .range(f, t),
    );
    const byClass = new Map<string, AxisSlot[]>();
    for (const r of rows) {
      const slot: AxisSlot = {
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        teacherId: r.teacher_id,
        slotTeacherLabel: r.slot_teacher_label,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      };
      // SQL로 이미 좁혔지만 최종 판정은 순수 함수가 한다(조건이 두 벌이면 갈라진다).
      if (!slotOverlapsRange(slot, from, to)) continue;
      (byClass.get(r.class_id) ?? byClass.set(r.class_id, []).get(r.class_id)!).push(slot);
    }
    return byClass;
  },
);

/**
 * 교시 담당으로 등장하는 사람들의 표시 이름 — 담임이 아닌 사람도 강사 드롭다운에 서야 하기 때문
 * (Florence Park는 담임 반이 0개라 종전 목록엔 이름조차 없었다).
 * ⚠️ 자리(LAB·JJ)는 위 조회에서 이미 빠졌다 — `users`로 해석하면 가짜 강사가 명부·급여에 붙는다.
 */
export const loadAxisTeacherNames = cache(async (ids: string[]): Promise<Map<string, AxisTeacher>> => {
  if (ids.length === 0) return new Map();
  const rows = await (async () => {
    const supabase = await createClient();
    return fetchInChunks<{ id: string; display_name: string | null; status: string | null }>(ids, (chunk) =>
      supabase.from("users").select("id, display_name, status").in("id", chunk),
    );
  })();
  const out = new Map<string, AxisTeacher>();
  for (const r of rows) {
    if (!r.display_name) continue; // 이름을 못 찾으면 옵션에서 뺀다(화면에 uuid 금지)
    out.set(r.id, { id: r.id, name: r.display_name, active: r.status !== "inactive" });
  }
  return out;
});

/** 출석부 반 목록 한 줄 — 반 메타 + 그 달 교시 담당 + 스코프 판정용 합집합. */
export type ClassAxisRow = {
  id: string;
  className: string;
  subject: string;
  /** 수업보고서 미발송(0174a) — 출결 파생의 "보고서 없음 = 결석" 규칙을 끄는 데 쓴다. */
  reportOptout: boolean;
  /** 특강 토글(`classes.is_special`, 0133a) **그대로** — 판정은 이름 폴백까지 보는 `isSpecialLecture()`로. */
  isSpecial: boolean;
  /** 반 담임(`classes.teacher_id`). */
  teacherId: string | null;
  teacherName: string | null;
  teacherActive: boolean;
  /** 그 달 교시 담당(담임과 겹칠 수 있다). 자리(LAB·JJ)는 사람이 아니라 안 들어온다. */
  slotTeachers: AxisTeacher[];
  /** 조회 기간에 담임이었던 이전 강사. 현재 수업 편집 권한을 부여하는 목록은 아니다. */
  historicalTeachers: AxisTeacher[];
  homeroomHistory: HomeroomPeriod[];
  /** 현재 담임 ∪ 기간 내 이전 담임 ∪ 교시 담당 — 출석부 조회 범위. */
  taughtBy: string[];
};

/**
 * 활성 반 + 그 달 강사 축 — **요청당 1회**(React cache).
 *
 * 🔴 왜 캐시가 중요한가: 강사 전체 보기는 `getMonthlyAttendanceMatrix`를 **반마다** 부른다(반 10개면 11번).
 *    반 목록·교시 배선은 호출마다 같은 답이라, 캐시가 없으면 같은 조회가 열 번 넘게 돈다(B6과 같은 결).
 * ⚠️ 여기서 **강사로 좁히지 않는다** — 좁히는 판정은 호출부가 `taughtBy`로 한다(캐시 키를 사람마다
 *    쪼개지 않기 위해서이기도 하다).
 */
export const loadClassAxisRows = cache(async (from: string, to: string): Promise<ClassAxisRow[]> => {
  const supabase = await createClient();
  // 반 목록·교시 배선·담임 이력은 서로 독립이라 병렬(B4).
  // 🔴 이 목록은 **강사 스코프의 whitelist**로 쓰인다(taughtBy로 좁힌다) → bare select 금지, 페이지네이션(B2).
  //    지금은 활성 반 110행이라 한 장에 들어오지만, 1000행을 넘기면 PostgREST가 **에러 없이 잘라** 그 강사의
  //    반이 조용히 사라진다. 잘림이 곧 "내 반이 없다"가 되는 자리라 상한을 두지 않는다.
  const [classRows, slotAxis, historyIndex] = await Promise.all([
    fetchAllPaged<ClassSelectRow>((f, t) =>
      supabase
        .from("classes")
        .select("id, class_name, subject, report_optout, is_special, closed_at, teacher:teacher_id ( id, display_name, status )")
        .eq("is_active", true)
        .order("class_name")
        .order("id", { ascending: true }) // OFFSET 페이지 안정용 unique 정렬(B2)
        .range(f, t),
    ),
    loadSlotAxisByClass(from, to),
    getHomeroomHistoryIndex(),
  ]);

  // 🔴 **종강한 반은 그 뒤 기간에서 뺀다** (원장 제보 2026-09-10: *"0명인 학생 반은 왜 뜨는거야?
  //    수업도 종강처리 된거같은데"* — `[특강] 고등개별`·`[특강]중2-2 문제 풀이반`이 8/27 종강인데
  //    9월 출석부에 `0명 시수 0`으로 서 있었다).
  //    `closed_at`을 찍어도 `is_active`는 true로 남아서, 활성만 보던 이 목록엔 계속 걸렸다.
  //    ⚠️ **그 반이 실제로 돌던 달에는 그대로 보여야 한다** — 지난 달 출석부는 기록이라 감추면 안 된다.
  //       그래서 "종강일이 조회 구간 시작보다 앞설 때"만 뺀다(일별 출결이 쓰던 `closed_at >= date`와 같은 규약).
  const liveRows = classRows.filter((c) => !c.closed_at || c.closed_at >= from);

  // 교시 담당으로만 등장하는 사람(담임 반이 0개인 강사)도 이름이 필요하다 — 한 번에 조회.
  const axisNames = await loadAxisTeacherNames([
    ...new Set([
      ...[...slotAxis.values()].flatMap((slots) => slots.map((s) => s.teacherId).filter((v): v is string => !!v)),
      ...liveRows.flatMap((c) => homeroomTeachersInRange(historyIndex.get(c.id) ?? [], from, to)),
    ]),
  ]);

  // 담임 이력을 못 읽은 채 만든 목록이면 표식을 옮겨 싣는다(`folded-read.ts`) — 이전 담임 축(`taughtBy`·`homeroomHistory`)이
  // 빈 채라, 이 목록을 금액으로 쓰는 자리(프리랜서 명세서)는 넘긴 뒤의 칸까지 그 사람 몫으로 센다. 화면은 읽지 않는다.
  return carryFolded(historyIndex, liveRows.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { id?: string; display_name?: string; status?: string }
      | undefined;
    const homeroomTeacherId = teacher?.id ?? null;
    const slots = slotAxis.get(c.id as string) ?? [];
    const homeroomHistory = historyIndex.get(c.id) ?? [];
    const historicalIds = homeroomTeachersInRange(homeroomHistory, from, to);
    return {
      id: c.id as string,
      className: c.class_name as string,
      subject: c.subject as string,
      reportOptout: (c as { report_optout?: boolean | null }).report_optout === true,
      isSpecial: (c as { is_special?: boolean | null }).is_special === true,
      teacherId: homeroomTeacherId,
      teacherName: teacher?.display_name ?? null,
      // 담임이 퇴직(inactive)이어도 반은 살려 둔다 — 재원생이 다니는 반을 숨기면 출결을 찍을 길이 없다.
      teacherActive: teacher ? teacher.status !== "inactive" : true,
      homeroomHistory,
      historicalTeachers: historicalIds.filter((id) => id !== homeroomTeacherId).map((id) => axisNames.get(id)).filter((t): t is AxisTeacher => !!t),
      slotTeachers: classTeacherIdsInRange({ homeroomTeacherId: null, slots, from, to })
        .map((id) => axisNames.get(id))
        .filter((t): t is AxisTeacher => !!t),
      taughtBy: [...new Set([...classTeacherIdsInRange({ homeroomTeacherId, slots, from, to }), ...historicalIds])],
    };
  }));
});

/**
 * **이 사용자가 출석부에서 볼 수 있는 반** — 강사(겸직 강사뷰·'다른 강사 뷰' 포함)는 자기가 가르치는
 * 반만, 사무실은 전체.
 *
 * 🔴 출석부 표면이 늘 때마다 `effectiveTeacherId()` + `taughtBy.includes()`를 각자 적으면, 언젠가 한
 *    곳이 담임(`classes.teacher_id`)으로만 좁혀 교시 담당 강사의 반을 통째로 잃거나(2026-08-18에
 *    고친 그 버그) 반대로 남의 반을 흘린다. 판정은 **여기 한 줄**뿐이고
 *    (`getMonthlyAttendanceMatrix`·허브 학생 검색이 같이 쓴다) 화면은 결과만 받는다([[#77]]).
 * ⚠️ 좁히는 근거는 `taughtBy`(담임 ∪ 그 기간 교시 담당) — 자리(LAB·JJ)는 사람이 아니라 안 들어온다.
 * ⚠️ 캐시는 `loadClassAxisRows` 쪽에 있다(사람별로 키를 쪼개지 않기 위해) — 여기선 필터만 한다.
 */
export async function loadVisibleClassAxisRows(from: string, to: string): Promise<ClassAxisRow[]> {
  const tId = await effectiveTeacherId();
  const rows = await loadClassAxisRows(from, to);
  // 좁힌 목록은 새 배열이라 접힘 표식을 옮겨 싣는다(이력을 못 읽으면 이전 담임 반이 이 필터에서 빠진다).
  return tId ? carryFolded(rows, rows.filter((c) => c.taughtBy.includes(tId))) : rows;
}
