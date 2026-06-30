import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";

export type DuplicateGroup = {
  key: string;
  students: {
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
    status: string;
    enrolledAt: string | null;
  }[];
};

/**
 * 중복 의심 학생 그룹. 두 신호를 union-find로 병합 (F6):
 *  (a) 이름+학년+학교가 모두 같음 (기존 자연키)
 *  (b) 이름+학년이 같고 학부모 연락처(숫자만)가 동일 — 학교칸만 다르거나 비어도 잡음
 * 같은 컴포넌트에 2명 이상이면 중복 후보.
 */
export async function findDuplicateStudents(): Promise<DuplicateGroup[]> {
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
  }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, grade, school, status, enrolled_at, parent_phone")
      .neq("status", "withdrawn")
      .order("id")
      .range(from, to),
  );
  if (data.length === 0) return [];

  // 같은 키를 공유하는 학생들을 엮을 버킷 구성
  const buckets = new Map<string, string[]>();
  const addToBucket = (key: string, id: string) => {
    const arr = buckets.get(key) ?? [];
    arr.push(id);
    buckets.set(key, arr);
  };
  for (const r of data) {
    const base = `${r.name.toLowerCase().trim()}::${r.grade ?? ""}`;
    addToBucket(`nat::${base}::${r.school ?? ""}`, r.id);
    const phone = (r.parent_phone ?? "").replace(/\D/g, "");
    if (phone) addToBucket(`ph::${base}::${phone}`, r.id);
  }

  // union-find: 버킷 내 학생들을 같은 컴포넌트로 합침
  const parent = new Map<string, string>(data.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const ids of buckets.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // 컴포넌트별로 학생 모으기 → 2명 이상만
  const byId = new Map(data.map((r) => [r.id, r]));
  const comps = new Map<string, DuplicateGroup>();
  for (const r of data) {
    const root = find(r.id);
    const g = comps.get(root) ?? { key: root, students: [] };
    const s = byId.get(r.id)!;
    g.students.push({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      status: s.status,
      enrolledAt: s.enrolled_at,
    });
    comps.set(root, g);
  }

  return Array.from(comps.values()).filter((g) => g.students.length >= 2);
}

export type OrphanReport = {
  studentsWithoutEnrollments: { id: string; name: string; status: string }[];
  classesWithoutSchedules: { id: string; className: string; isActive: boolean }[];
  enrollmentsWithoutEndDate: number; // 모순 — withdrawn 학생인데 end_date=null
};

export async function findOrphans(): Promise<OrphanReport> {
  const supabase = await createClient();

  // status='enrolled'인데 활성 enrollment 0개 / withdrawn인데 활성 enrollment 남음.
  //   ⚠️ 과거엔 enrolledIds(수백 개)를 .in()에 넣어 URL이 HTTP 414로 실패→error를 삼켜 전원
  //   오탐했음(F8/F1). 쿼리를 뒤집어 활성 enrollment의 student_id 집합을 먼저 받아 메모리 차집합을
  //   구한다. ⚠️ 그 집합/학생 목록이 무페이징이면 1000행 silent 절단으로 정합성 깨짐 → fetchAllPaged
  //   로 전건(셋 다 독립이라 병렬).
  const [enrolled, activeEnrollments, withdrawnStudents] = await Promise.all([
    fetchAllPaged<{ id: string; name: string; status: string }>((from, to) =>
      supabase.from("students").select("id, name, status").eq("status", "enrolled").range(from, to),
    ),
    fetchAllPaged<{ student_id: string }>((from, to) =>
      supabase.from("enrollments").select("student_id").is("end_date", null).range(from, to),
    ),
    fetchAllPaged<{ id: string }>((from, to) =>
      supabase.from("students").select("id").eq("status", "withdrawn").range(from, to),
    ),
  ]);

  const withEnrollment = new Set(activeEnrollments.map((e) => e.student_id));
  const studentsWithoutEnrollments = enrolled
    .filter((s) => !withEnrollment.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, status: s.status }));

  // 2) is_active=true 반 중 schedule 0개
  const { data: classes } = await supabase
    .from("classes")
    .select("id, class_name, is_active")
    .eq("is_active", true);
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select("class_id")
    .in("class_id", classIds);
  const withSchedule = new Set((schedules ?? []).map((s) => s.class_id));
  const classesWithoutSchedules = (classes ?? [])
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

