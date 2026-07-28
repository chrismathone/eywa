import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { GENDER_OPTIONS } from "@/features/enrollment/form-config";
import { normalizePricingMode, pricingModeLabel } from "@/features/billing/tuition-catalog";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import {
  checklistHabits,
  checklistToPairs,
  formatSchedule,
  rankPrepClasses,
  type PrepClassFact,
  type PrepFacts,
} from "@/features/enrollment/prep-brief";
import type { IntakeChecklist } from "@/features/enrollment/intake-checklist";

/**
 * 사전 브리프의 **사실 스냅샷 수집** — 상담 1건 기준으로 eywa DB에서 상담자가 알아야 할 것을 전부 모은다.
 * (접수 폼 + 개설 반·정원·시간·강사 + 수강료 단가표 + 교재 + 같은 학교/학년 재원생 집계 + 형제자매 후보
 *  + 같은 학생의 이전 접수 + 학원 정책).
 *
 * 성능 규칙 준수:
 * - 서로 독립인 조회는 전부 `Promise.all` (B4).
 * - 인원 집계는 `count: exact, head: true`로 행을 안 받는다 (B2 — 전건 fetch는 1000행에서 조용히 잘린다).
 * - 반 id 다건 조회는 `fetchInChunks` (B3 — 큰 `.in()`은 414 + error 삼킴).
 *
 * ⚠️ 개인정보: 학부모 전화번호·주소·학생 연락처는 **facts에 담지 않는다**(브리프는 AI 프롬프트로 나가고
 *   인쇄물로 출력된다). 형제자매 후보는 연락처 매칭으로 *찾되* 결과는 이름·학년·학교만 싣는다.
 */
export async function collectPrepFacts(consultationId: string): Promise<PrepFacts | null> {
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone,
       parent_relation, parent_request, subject, gender, career_goal, siblings, siblings_details,
       safety_notes, shuttle_bus_request, consultation_path, intake_checklist`,
    )
    .eq("id", consultationId)
    .maybeSingle();
  if (!c) return null;

  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectLabel = c.subject ? subjectMaps.labelOf(c.subject) : null;
  const school = c.prospect_school?.trim() || null;
  const grade = c.prospect_grade?.trim() || null;
  const parentPhone = c.parent_phone?.trim() || null;

  // 전부 서로 독립 → 한 번에(B4). 각 쿼리는 자기 안에서 count/head 또는 좁은 필터를 쓴다.
  const [
    classRows,
    tuitionRows,
    textbookRows,
    totalCount,
    sameSchoolCount,
    sameGradeCount,
    siblingRows,
    priorRows,
  ] = await Promise.all([
    supabase
      .from("classes")
      .select(
        `id, class_name, subject, notes, classroom:classroom_id ( capacity ),
         teacher:teacher_id ( display_name )`,
      )
      .eq("is_active", true)
      .is("closed_at", null),
    supabase
      .from("tuition_catalog")
      .select("category, name, price, pricing_mode, note")
      .eq("is_active", true)
      .neq("category", "할인")
      .order("category"),
    supabase
      .from("textbook_catalog")
      .select("title, subject, grade_level")
      .eq("is_active", true)
      .limit(200),
    supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "enrolled").eq("is_test", false),
    school
      ? supabase
          .from("students")
          .select("*", { count: "exact", head: true })
          .eq("status", "enrolled")
          .eq("is_test", false)
          .eq("school", school)
      : Promise.resolve({ count: 0 }),
    grade
      ? supabase
          .from("students")
          .select("*", { count: "exact", head: true })
          .eq("status", "enrolled")
          .eq("is_test", false)
          .eq("grade", grade)
      : Promise.resolve({ count: 0 }),
    // 형제자매 후보 — 학부모 연락처가 같은 재원생. 연락처가 없으면 조회 자체를 안 한다(전건 스캔 금지).
    parentPhone
      ? supabase
          .from("students")
          .select("id, name, school, grade")
          .eq("status", "enrolled")
          .eq("parent_phone", parentPhone)
          .limit(6)
      : Promise.resolve({ data: [] }),
    // 앞서 들어온 같은 학생의 다른 접수(반복 QR 제출) — 상담에서 같은 질문을 반복하지 않게.
    // ⚠️ 이름-only 매칭 금지(동명이인 fan-out) — getSiblingConsultations와 동일한 자연키
    //    (이름+학교+학년, null은 is null 정확 매칭)로 좁힌다(적대 검수 2026-07-28).
    (() => {
      let q = supabase
        .from("enrollment_consultations")
        .select("id, consultation_date, consulted_at, outcome, subject")
        .eq("prospect_name", c.prospect_name)
        .neq("id", consultationId);
      q = school ? q.eq("prospect_school", school) : q.is("prospect_school", null);
      q = grade ? q.eq("prospect_grade", grade) : q.is("prospect_grade", null);
      return q.order("consulted_at", { ascending: false }).limit(5);
    })(),
  ]);

  // 현원 — 표시 후보가 될 반만 청크 조회(B3). 전건 enrollments fetch는 절단 위험(B2).
  const classes = classRows.data ?? [];
  const classIds = classes.map((row) => row.id);
  const enrolledByClass = new Map<string, number>();
  if (classIds.length > 0) {
    const enrollments = await fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
      supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", chunk),
    );
    for (const e of enrollments) enrolledByClass.set(e.class_id, (enrolledByClass.get(e.class_id) ?? 0) + 1);
  }

  // 요일·시작시각 — 후보로 좁히기 전 전체 반에 대해 한 번(같은 청크 규칙).
  const scheduleByClass = new Map<string, { day: string; start: string | null }[]>();
  if (classIds.length > 0) {
    const scheds = await fetchInChunks<{ class_id: string; day_of_week: string; start_time: string | null }>(
      classIds,
      (chunk) =>
        supabase.from("class_schedules").select("class_id, day_of_week, start_time").in("class_id", chunk),
    );
    for (const s of scheds) {
      const list = scheduleByClass.get(s.class_id) ?? [];
      if (!list.some((x) => x.day === s.day_of_week)) list.push({ day: s.day_of_week, start: s.start_time });
      scheduleByClass.set(s.class_id, list);
    }
  }

  const candidates: Omit<PrepClassFact, "gradeMatched">[] = classes.map((row) => {
    const teacher = (Array.isArray(row.teacher) ? row.teacher[0] : row.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(row.classroom) ? row.classroom[0] : row.classroom) as
      | { capacity?: number | null }
      | undefined;
    return {
      id: row.id,
      className: row.class_name,
      subjectLabel: subjectMaps.labelOf(row.subject),
      teacherName: teacher?.display_name ?? null,
      scheduleLabel: formatSchedule(scheduleByClass.get(row.id) ?? []),
      seats: room?.capacity ?? null,
      enrolled: enrolledByClass.get(row.id) ?? 0,
      notes: row.notes ?? null,
    };
  });

  // 형제자매 후보의 **현재 수강 반** — 상담에서 가장 강한 카드("형 OO는 지금 이 반입니다").
  // 후보가 있을 때만 도는 추가 왕복이라 위 Promise.all에 넣지 않았다(없으면 쿼리 자체가 없다).
  const siblingStudents = (siblingRows.data ?? []) as { id: string; name: string; school: string | null; grade: string | null }[];
  const siblingClasses = new Map<string, string[]>();
  if (siblingStudents.length > 0) {
    const rows = await fetchInChunks<{ student_id: string; class: { class_name?: string } | { class_name?: string }[] | null }>(
      siblingStudents.map((s) => s.id),
      (chunk) =>
        supabase
          .from("enrollments")
          .select("student_id, class:class_id ( class_name )")
          .is("end_date", null)
          .in("student_id", chunk),
    );
    for (const row of rows) {
      const cls = (Array.isArray(row.class) ? row.class[0] : row.class) as { class_name?: string } | null;
      const name = cls?.class_name;
      if (!name) continue;
      const list = siblingClasses.get(row.student_id) ?? [];
      if (!list.includes(name)) list.push(name);
      siblingClasses.set(row.student_id, list);
    }
  }

  const checklist = (c.intake_checklist ?? null) as IntakeChecklist | null;
  const siblingsText = [c.siblings, c.siblings_details].filter(Boolean).join(" · ") || null;

  return {
    student: {
      name: c.prospect_name,
      grade,
      school,
      subjectLabel,
      genderLabel: c.gender ? (GENDER_OPTIONS.find((g) => g.value === c.gender)?.label ?? null) : null,
      careerGoal: c.career_goal?.trim() || null,
      request: c.parent_request?.trim() || null,
      shuttleRequest: !!c.shuttle_bus_request,
      siblingsText,
      safetyNotes: c.safety_notes?.trim() || null,
      consultationPath: c.consultation_path?.trim() || null,
    },
    parent: { name: c.parent_name?.trim() || null, relation: c.parent_relation?.trim() || null },
    checklist: checklist ? checklistToPairs(checklist) : [],
    habits: checklist ? checklistHabits(checklist) : [],
    priorConsults: (priorRows.data ?? []).map((p) => ({
      date: (p.consultation_date as string | null) ?? kstDate(p.consulted_at as string),
      outcomeLabel: OUTCOME_PILL[p.outcome as string]?.label ?? "대기",
      subjectLabel: p.subject ? subjectMaps.labelOf(p.subject as string) : null,
    })),
    siblings: siblingStudents.map((s) => ({
      name: s.name,
      school: s.school ?? null,
      grade: s.grade ?? null,
      classNames: siblingClasses.get(s.id) ?? [],
    })),
    classes: rankPrepClasses(candidates, { subjectKeyLabel: subjectLabel, grade }),
    tuition: (tuitionRows.data ?? [])
      .filter((t) => !subjectLabel || matchesSubjectCategory(t.category as string, subjectLabel))
      .slice(0, 12)
      .map((t) => ({
        category: t.category as string,
        name: t.name as string,
        price: Number(t.price ?? 0),
        // "회당 단가"/"월 단가" 라벨 — 미지정(null)은 null 유지("미지정"이란 단어를 학부모 문서에 안 흘림).
        modeLabel: normalizePricingMode(t.pricing_mode as string | null)
          ? pricingModeLabel(t.pricing_mode as string | null)
          : null,
        note: (t.note as string | null) ?? null,
      })),
    textbooks: (textbookRows.data ?? [])
      .filter((t) => !c.subject || t.subject === c.subject)
      .slice(0, 10)
      .map((t) => ({
        title: t.title as string,
        subjectLabel: t.subject ? subjectMaps.labelOf(t.subject as string) : "—",
        gradeLevel: (t.grade_level as string | null) ?? null,
      })),
    peers: {
      total: totalCount.count ?? 0,
      sameSchool: sameSchoolCount.count ?? 0,
      sameGrade: sameGradeCount.count ?? 0,
    },
    policy: {
      academyName: settings.profile.name || "학원",
      dueDay: settings.billing.dueDay ?? null,
      latePolicy: settings.billing.latePolicy?.trim() || null,
      shuttleEnabled: !!settings.operations.shuttle?.enabled,
      shuttleFee: settings.operations.shuttle?.fee?.trim() || null,
      shuttleRoutes: (settings.operations.shuttle?.routes ?? []).map((r) => r.label).filter(Boolean),
    },
  };
}

/** 상담 과목과 단가표 분류(수학/영어/EIE/국어…)의 느슨한 대응 — 라벨이 서로 포함되면 같은 과목으로 본다. */
function matchesSubjectCategory(category: string, subjectLabel: string): boolean {
  const a = category.trim();
  const b = subjectLabel.trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** timestamptz → KST 날짜(YYYY-MM-DD). 표시는 KST 고정(전역 규칙). */
function kstDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
