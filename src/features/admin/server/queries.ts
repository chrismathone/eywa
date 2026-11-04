import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WITHDRAW_CANDIDATE_DAYS, selectWithdrawCandidates } from "../withdraw-candidates";
import { groupSameNameStudents } from "../same-name";
import {
  groupDuplicateCandidates,
  loneSuspects,
  type DuplicateReason,
} from "../duplicate-candidates";

export type DuplicateGroup = {
  key: string;
  /** 이 그룹이 후보가 된 근거 — 화면이 행마다 "무엇이 같아서 후보인지"를 적는다. */
  reasons: DuplicateReason[];
  students: {
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
    status: string;
    enrolledAt: string | null;
    /** 동기화가 이름 충돌로 자동 구분(접미사)한 학생 — '정상 확인'(학생 상세·데이터 정리)이 내린다. */
    dupSuspect: boolean;
  }[];
};

export type DuplicateStudent = DuplicateGroup["students"][number];

/** 데이터 정리 '중복 의심 학생' 면의 재료 — 병합 후보 그룹 + 짝 없는 '의심' 학생(원장 2026-10-14). */
export type DuplicateReview = { groups: DuplicateGroup[]; loneSuspects: DuplicateStudent[] };

/**
 * 중복 의심 학생 그룹. 판정·근거·정렬은 순수 모듈
 * [`groupDuplicateCandidates`](../duplicate-candidates.ts)가 **단일 소스**이고 여기서는 재료만 읽는다.
 *
 * 🔴 접미사 신호(`auto_suffix`)가 여기 붙어 있는 이유는 그 파일 주석 참조 — 요약하면, 동기화가
 *    `권민서` → `권민서A`처럼 이름을 갈라 놓으면 "이름이 글자까지 같아야 한다"는 옛 두 신호로는
 *    **영원히** 후보가 못 돼서, 학생 상세 배너가 가리키는 이 화면이 늘 비어 있었다(원장 2026-09-10).
 * 🔴 **자동 병합은 없다** — 이 함수는 후보만 만들고, 합치는 것은 사람이 `mergeStudents`를 누를 때다.
 */
export async function findDuplicateStudents(): Promise<DuplicateReview> {
  const supabase = await createClient();
  // ⚠️ 퇴원(withdrawn)생은 중복 후보에서 제외한다. 자연키 유니크 인덱스가 `WHERE status<>'withdrawn'`이라
  //    퇴원생은 애초에 중복 충돌 대상이 아니고, 병합(mergeStudents)은 mergee를 withdrawn으로 만든다.
  //    포함하면 병합 후에도 keeper와 같은 키(이름+학년/전화)로 계속 2명 그룹으로 잡혀 "병합했는데
  //    목록에 그대로 남는" 버그가 난다([[#66]] 계열). 전건 무페이징 select는 1000행 silent 절단 위험(B2)
  //    → fetchAllPaged로 전건(id 정렬 = 페이지 경계 안정).
  const data = await fetchAllPaged<{
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
    status: string;
    enrolled_at: string | null;
    parent_phone: string | null;
    parent2_phone: string | null;
    dup_suspect: boolean | null;
  }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, grade, school, status, enrolled_at, parent_phone, parent2_phone, dup_suspect")
      .neq("status", "withdrawn")
      .order("id")
      .range(from, to),
  );
  if (data.length === 0) return { groups: [], loneSuspects: [] };

  const inputs = data.map((r) => ({
    id: r.id,
    name: r.name,
    grade: r.grade,
    school: r.school,
    parentPhone: r.parent_phone,
    parent2Phone: r.parent2_phone, // 보호자2(s2_0024) — 같은 판정(duplicateReasons)이 보호자 번호 둘을 다 본다
    dupSuspect: r.dup_suspect === true,
    status: r.status,
    enrolledAt: r.enrolled_at,
  }));
  const groups = groupDuplicateCandidates(inputs);
  const toStudent = (s: (typeof inputs)[number]): DuplicateStudent => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    school: s.school,
    status: s.status,
    enrolledAt: s.enrolledAt,
    dupSuspect: s.dupSuspect === true,
  });

  return {
    groups: groups.map((g) => ({ key: g.key, reasons: g.reasons, students: g.students.map(toStudent) })),
    loneSuspects: loneSuspects(inputs, groups).map(toStudent),
  };
}

/** '같은 이름' 섹션의 한 줄 — 데스크가 **같은 사람인지 다른 사람인지** 고를 근거를 나란히 싣는다. */
export type SameNameStudentRow = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  status: string;
  parentPhone: string | null;
  /** 지금 듣고 있는 반의 **과목 한글 라벨**(빈 배열 = 수업 없음). raw 키를 화면에 내보내지 않는다. */
  subjects: string[];
};

export type SameNameStudentGroup = { key: string; name: string; students: SameNameStudentRow[] };

/**
 * **같은 이름을 쓰는 학생** — 데이터 정리 면의 별도 섹션(원장 2026-08-20).
 *
 * 🔴 중복 의심(통합)과 **다른 물건**이다. 판정·제외 규칙은 순수 모듈
 *    [`groupSameNameStudents`](../same-name.ts)가 단일 소스이고(이미 통합 섹션에 잡힌 그룹은 뺀다),
 *    여기서는 **근거 재료를 붙이는 일**만 한다. 이 섹션의 행동은 통합이 아니라 *"이름을 구분하라"*다.
 * 🔴 **이름을 자동으로 바꾸지 않는다** — 개명은 사람이 학생 상세에서 한다(강사 소급 퇴원 사고 이후,
 *    학생 기록을 자동으로 바꾸는 경로는 만들지 않는다는 결정).
 */
export async function findSameNameStudents(): Promise<SameNameStudentGroup[]> {
  const supabase = await createClient();
  // 퇴원생 제외 = 목록에 안 뜨는 사람은 헷갈릴 일도 없다(중복 의심 쿼리와 같은 결).
  // 전건 무페이징 select는 1000행 silent 절단(B2) → fetchAllPaged(id 정렬 = 페이지 경계 안정).
  const [rows, settings] = await Promise.all([
    fetchAllPaged<{
      id: string;
      name: string;
      grade: string | null;
      school: string | null;
      status: string;
      parent_phone: string | null;
      parent2_phone: string | null;
      dup_suspect: boolean | null;
    }>((from, to) =>
      supabase
        .from("students")
        .select("id, name, grade, school, status, parent_phone, parent2_phone, dup_suspect")
        .neq("status", "withdrawn")
        .order("id")
        .range(from, to),
    ),
    getTenantSettings(),
  ]);

  const groups = groupSameNameStudents(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      grade: r.grade,
      school: r.school,
      parentPhone: r.parent_phone,
      // 보호자2 번호도 — 통합 섹션이 그 번호로 잡은 쌍을 여기서도 빼야 두 섹션에 같은 쌍이 동시에 뜨지 않는다.
      parent2Phone: r.parent2_phone,
      // 통합 섹션이 접미사 신호로 이미 잡는 쌍인지 판단하려면 이 표식이 필요하다(두 섹션 중복 노출 방지).
      dupSuspect: r.dup_suspect === true,
      status: r.status,
    })),
  );
  if (groups.length === 0) return [];

  // 근거(수강 과목)는 **그룹에 든 학생만** 조회한다 — 평소 0~1그룹이라 몇 명뿐이다.
  const ids = groups.flatMap((g) => g.students.map((s) => s.id));
  const today = kstToday();
  const live = await fetchInChunks<{ student_id: string; class_id: string }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id")
      .in("student_id", chunk)
      .eq("on_hold", false)
      .or(`end_date.is.null,end_date.gte.${today}`),
  );
  const classIds = [...new Set(live.map((e) => e.class_id))];
  const classes = await fetchInChunks<{ id: string; subject: string | null }>(classIds, (chunk) =>
    supabase.from("classes").select("id, subject").in("id", chunk),
  );

  // 과목 라벨은 **학원설정 단일 소스** — 코드에 과목 라벨을 박지 않는다.
  const { labelOf } = buildSubjectMaps(settings.operations.subjects);
  const subjectOfClass = new Map(classes.map((c) => [c.id, c.subject]));
  const subjectsByStudent = new Map<string, Set<string>>();
  for (const e of live) {
    const subject = subjectOfClass.get(e.class_id);
    if (!subject) continue; // 과목 미지정 반은 라벨이 없다 — 빈 값을 지어내지 않는다
    const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
    set.add(labelOf(subject));
    subjectsByStudent.set(e.student_id, set);
  }

  return groups.map((g) => ({
    key: g.key,
    name: g.name,
    students: g.students.map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      status: s.status,
      parentPhone: s.parentPhone,
      subjects: [...(subjectsByStudent.get(s.id) ?? [])].sort((a, b) => a.localeCompare(b, "ko")),
    })),
  }));
}

export type OrphanReport = {
  /** 재원인데 활성 수강 0 + **마지막 수강 종료가 30일 이상 지난** 학생만(자동 퇴원 후보). */
  studentsWithoutEnrollments: {
    id: string;
    name: string;
    status: string;
    /** 마지막 수강 종료일(없으면 등록일) — 원장이 "왜 후보인지" 판단하는 근거. */
    lastEndedAt: string | null;
  }[];
  classesWithoutSchedules: { id: string; className: string; isActive: boolean }[];
  enrollmentsWithoutEndDate: number; // 모순 — withdrawn 학생인데 end_date=null
};

export async function findOrphans(): Promise<OrphanReport> {
  const supabase = await createClient();

  // status='enrolled'인데 활성 enrollment 0개 / withdrawn인데 활성 enrollment 남음.
  //   ⚠️ 과거엔 enrolledIds(수백 개)를 .in()에 넣어 URL이 HTTP 414로 실패→error를 삼켜 전원
  //   오탐했음(F8/F1). 쿼리를 뒤집어 활성 enrollment의 student_id 집합을 먼저 받아 메모리 차집합을
  //   구한다. ⚠️ 그 집합/학생 목록이 무페이징이면 1000행 silent 절단으로 정합성 깨짐 → fetchAllPaged
  //   로 전건(넷 다 독립이라 병렬). 페이지를 넘겨 읽는 조회는 **id 순**으로 고정한다 — 순서가 없으면 페이지 경계에서
  //   같은 행이 두 번 나오거나 빠질 수 있다.
  const [enrolled, allEnrollments, withdrawnStudents, classes] = await Promise.all([
    fetchAllPaged<{ id: string; name: string; status: string; enrolled_at: string | null }>(
      (from, to) =>
        supabase
          .from("students")
          .select("id, name, status, enrolled_at")
          .eq("status", "enrolled")
          .order("id")
          .range(from, to),
    ),
    // 활성 판정 + 마지막 종료일(30일 게이트)을 한 번에 — end_date가 둘 다에 필요해 전건을 한 번만 읽는다.
    fetchAllPaged<{ student_id: string; end_date: string | null }>((from, to) =>
      supabase.from("enrollments").select("student_id, end_date").order("id").range(from, to),
    ),
    fetchAllPaged<{ id: string }>((from, to) =>
      supabase.from("students").select("id").eq("status", "withdrawn").order("id").range(from, to),
    ),
    // 운영 중인 반 — 종전엔 무페이징이라 1,000개에서 조용히 잘렸고, 조회 오류도 빈 목록으로 삼켰다.
    fetchAllPaged<{ id: string; class_name: string; is_active: boolean }>((from, to) =>
      supabase.from("classes").select("id, class_name, is_active").eq("is_active", true).order("id").range(from, to),
    ),
  ]);

  const withEnrollment = new Set(
    allEnrollments.filter((e) => e.end_date === null).map((e) => e.student_id),
  );
  // 학생별 마지막 수강 종료일 — 30일 게이트의 기준점.
  const lastEndedByStudent = new Map<string, string>();
  for (const e of allEnrollments) {
    if (!e.end_date) continue;
    const prev = lastEndedByStudent.get(e.student_id);
    if (!prev || e.end_date > prev) lastEndedByStudent.set(e.student_id, e.end_date);
  }

  // ⚠️ 30일 게이트(원장 확정 2026-07-15): 수강이 없어졌다고 바로 퇴원 후보로 올리지 않는다.
  // 반 폐지·종강은 그 반 수강을 종료시키므로(enrollment-lifecycle.ts) 학생이 '수업 없는 재원생'으로
  // 잠시 남는데, 그건 **퇴원이 아니라 재배정 대기**다(대시보드 '반 미배정 재원생'이 잡아준다).
  // 즉시 후보로 올리면 원장이 새 반에 배정하기도 전에 퇴원시켜버린다 → 마지막 수강 종료 후 30일 경과분만.
  // 수강 이력이 아예 없는 학생은 등록일을 기준으로(신규 등록 직후 학생 보호). 둘 다 없으면 후보 제외(보수적).
  const cutoff = addDays(kstToday(), -WITHDRAW_CANDIDATE_DAYS);
  const studentsWithoutEnrollments = selectWithdrawCandidates(
    enrolled
      .filter((s) => !withEnrollment.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        lastEndedAt: lastEndedByStudent.get(s.id) ?? s.enrolled_at ?? null,
      })),
    cutoff,
  );

  // 2) 운영 중인 반 가운데 스케줄 기록이 **한 줄도 없는** 반(지난 기록까지 포함 — 유효 기간은 보지 않는다).
  // 🔴 `class_schedules`는 이력을 함께 담아([[#88]]) 100반 묶음 하나가 1,000행을 넘는다. 종전의 단일 `.in()` 무페이징 조회는
  //    ① 반이 많으면 주소가 너무 길어 실패하고(414) 그 오류를 삼켜 **모든 반이 '스케줄 없음'**으로 나왔고([[#53]]),
  //    ② 1,000행에서 잘려 꼬리에 걸린 반이 '스케줄 없음'으로 나왔다([[#54]]). 묶음 × 페이지로 전건을 읽고 오류는 던진다
  //    (면이 받아 "불러오지 못했습니다"로 안내한다 — 잘못된 목록을 보여 주지 않는다).
  const classIds = classes.map((c) => c.id);
  const schedules = await fetchAllPagedInChunks<{ class_id: string }>(classIds, (chunk, from, to) =>
    supabase.from("class_schedules").select("class_id").in("class_id", chunk).order("id").range(from, to),
  );
  const withSchedule = new Set(schedules.map((s) => s.class_id));
  const classesWithoutSchedules = classes
    .filter((c) => !withSchedule.has(c.id))
    .map((c) => ({ id: c.id, className: c.class_name, isActive: c.is_active }));

  // withdrawn 학생인데 active enrollment 남음 — 위 withEnrollment 집합 재사용(대량 .in() 불필요).
  const orphanEnrollments = withdrawnStudents.filter((s) => withEnrollment.has(s.id)).length;

  return {
    studentsWithoutEnrollments,
    classesWithoutSchedules,
    enrollmentsWithoutEndDate: orphanEnrollments,
  };
}

