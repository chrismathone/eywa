import "server-only";
import { findSamePersonConsultations } from "./same-person-query";
import { isModuleEnabled } from "@/lib/modules";

import { createClient } from "@/lib/supabase/server";

/** 세션 client와 admin client 어느 쪽이든 받는다(공개 접수 자동 생성 경로용). */
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings, getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { GENDER_OPTIONS } from "@/features/enrollment/form-config";
import { normalizePricingMode, pricingModeLabel } from "@/features/billing/tuition-catalog";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import {
  checklistHabits,
  checklistToPairs,
  formatSchedule,
  gradeToken,
  isClosedOutClass,
  isHalfPeriodClass,
  matchesSubjectCategory,
  normalizeSchool,
  phoneVariants,
  rankPrepClasses,
  type PrepClassFact,
  type PrepFacts,
} from "@/features/enrollment/prep-brief";
import type { IntakeChecklist } from "@/features/enrollment/intake-checklist";
import { settingsToPeriodsConfig, weekdayFullPeriodMinutes } from "@/features/timetable/lib/periods";
import { kstToday } from "@/lib/date-kst";

/**
 * 사전 브리프의 **사실 스냅샷 수집** — 상담 1건 기준으로 aywa DB에서 상담자가 알아야 할 것을 전부 모은다.
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
export async function collectPrepFacts(
  consultationId: string,
  /**
   * 세션이 없는 호출부(학부모 QR 공개접수 → 자동 생성)를 위한 주입.
   * ⚠️ admin client는 RLS를 우회하므로 **tenantId 필수** — 아래 모든 쿼리가 명시 tenant 필터를 건다
   *   (공개 경로의 tenantId는 검증된 접수 토큰에서만 오며 조작 불가).
   */
  opts: { client?: SupabaseLike; tenantId?: string } = {},
): Promise<PrepFacts | null> {
  const supabase = (opts.client ?? (await createClient())) as SupabaseLike;

  let head = supabase
    .from("enrollment_consultations")
    .select(
      `id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone,
       parent_relation, parent_request, subject, gender, career_goal, siblings, siblings_details,
       safety_notes, shuttle_bus_request, consultation_path, intake_checklist, student_id`,
    )
    .eq("id", consultationId);
  if (opts.tenantId) head = head.eq("tenant_id", opts.tenantId);
  const { data: c } = await head.maybeSingle();
  if (!c) return null;

  // 이후 모든 조회의 격리 키 — 세션 경로에선 RLS와 이중 방어, admin 경로에선 유일한 방어선이다.
  const tenantId = c.tenant_id as string;
  const settings = opts.tenantId
    ? await getTenantSettingsByTenantId(tenantId)
    : await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectLabel = c.subject ? subjectMaps.labelOf(c.subject) : null;
  const school = c.prospect_school?.trim() || null;
  const grade = c.prospect_grade?.trim() || null;
  const linkedStudentId = (c as { student_id?: string | null }).student_id ?? null;
  // 형제 후보 조회는 하이픈/무하이픈 두 포맷을 함께 던진다(본인은 아래에서 제외).
  const phoneCandidates = phoneVariants(c.parent_phone);
  // 같은 학교 재원생 집계 — "칠성초등학교"(QR) ↔ "칠성초"(학생 DB) 분열 때문에 정규화 변형을 함께 본다.
  const schoolCandidates = school
    ? [...new Set([school, normalizeSchool(school)].filter((v): v is string => !!v))]
    : [];

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
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("closed_at", null),
    supabase
      .from("tuition_catalog")
      .select("category, name, price, pricing_mode, note")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .neq("category", "할인")
      // ⚠️ 2차 정렬 없이 자르면 어떤 12행이 실릴지 비결정이었다(수학 43행 중 앞머리가 '고등 수능·킬러'라
      //    중1 상담지에 고등 단가만 실리는 일이 생긴다). 분류→이름 고정 정렬로 결정화.
      .order("category")
      .order("name"),
    supabase
      .from("textbook_catalog")
      .select("title, subject, grade_level")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(200),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "enrolled")
      .eq("is_test", false),
    schoolCandidates.length > 0
      ? supabase
          .from("students")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "enrolled")
          .eq("is_test", false)
          .in("school", schoolCandidates)
      : Promise.resolve({ count: 0 }),
    grade
      ? supabase
          .from("students")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "enrolled")
          .eq("is_test", false)
          .eq("grade", grade)
      : Promise.resolve({ count: 0 }),
    // 형제자매 후보 — 학부모 연락처가 같은 재원생. 연락처가 없으면 조회 자체를 안 한다(전건 스캔 금지).
    // ⚠️ QR 접수는 하이픈 없는 숫자("01000009100")로 들어오고 학생 DB는 하이픈 표기가 96%라
    //    원문 eq로는 형제를 못 찾는다(실측 QR 29건 중 8건 누락) → 포맷 변형을 함께 조회한다.
    // 보호자2 연락처(s2_0024)도 본다 — 상담에 적힌 번호가 그 원생의 보호자2(예: 어머니) 번호일 수 있다. 칸마다 `.in()`으로
    // 따로 묻고 합친다(번호 원문이 섞여 있어 `.or()` 글자로 엮지 않는다 — `.in()`이 값을 감싼다). 실패한 쪽은 빈 결과(종전과 같다).
    phoneCandidates.length > 0
      ? Promise.all(
          (["parent_phone", "parent2_phone"] as const).map((col) =>
            supabase
              .from("students")
              .select("id, name, school, grade")
              .eq("tenant_id", tenantId)
              .eq("status", "enrolled")
              .eq("is_test", false)
              .in(col, phoneCandidates)
              .limit(8),
          ),
        ).then((results) => {
          const seen = new Set<string>();
          const data = results
            .flatMap((r) => r.data ?? [])
            .filter((s) => !seen.has(s.id) && !!seen.add(s.id))
            .slice(0, 8);
          return { data };
        })
      : Promise.resolve({ data: [] }),
    // 앞서 들어온 같은 학생의 다른 접수(반복 QR 제출 · 재방문) — 상담에서 같은 질문을 반복하지 않게.
    // 판정 = 카드 'N건' 배지·상세 '다른 상담'과 같은 한 벌(`same-person.ts` — 원생 연결 · 이름+학교+학년 · 이름+연락처).
    // ⚠️ 이름-only 매칭 금지(동명이인 fan-out) · 연결된 학생이 있으면 그 연결도 열쇠(진급·전학으로 자연키가 바뀐 접수).
    findSamePersonConsultations(supabase, c, { tenantId, limit: 5 }).then((data) => ({ data })),
  ]);

  // 현원 — 표시 후보가 될 반만 청크 조회(B3). 전건 enrollments fetch는 절단 위험(B2).
  const classes = classRows.data ?? [];
  const classIds = classes.map((row) => row.id);
  const enrolledByClass = new Map<string, number>();
  if (classIds.length > 0) {
    const enrollments = await fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("class_id")
        .eq("tenant_id", tenantId)
        .is("end_date", null)
        .in("class_id", chunk),
    );
    for (const e of enrollments) enrolledByClass.set(e.class_id, (enrolledByClass.get(e.class_id) ?? 0) + 1);
  }

  // 요일·시각 — 후보로 좁히기 전 전체 반에 대해 한 번(같은 청크 규칙).
  // ⚠️ `class_schedules`는 **운영 이력을 함께 담는다**([[#88]] 실측 1,068행 중 480행 만료) → 끝난 배치를
  //    같이 읽으면 상담지에 **지금 안 하는 요일·시각**이 찍힌다. 살아 있는 행만 본다.
  // ⚠️ end_time도 받는다 — 반교시 판정(교시 하나를 통째로 채우는 날이 있는가)이 길이를 봐야 한다.
  const today = kstToday();
  const slotsByClass = new Map<string, { day: string; start: string | null; end: string | null }[]>();
  if (classIds.length > 0) {
    const scheds = await fetchInChunks<{
      class_id: string;
      day_of_week: string;
      start_time: string | null;
      end_time: string | null;
    }>(classIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .or(`valid_to.is.null,valid_to.gte.${today}`),
    );
    for (const s of scheds) {
      (slotsByClass.get(s.class_id) ?? slotsByClass.set(s.class_id, []).get(s.class_id)!).push({
        day: s.day_of_week,
        start: s.start_time,
        end: s.end_time,
      });
    }
  }
  /** 라벨용 = 요일별 **가장 이른 시각** 1건. ⚠️ 같은 요일에 연속 교시 슬롯이 여러 개다(실측 106반 중 102반) —
   *  "첫 행 승자"로 두면 PostgREST 반환 순서에 따라 등원 시각이 17:15로 찍힌다. */
  const scheduleOf = (classId: string): { day: string; start: string | null }[] => {
    const out: { day: string; start: string | null }[] = [];
    for (const s of slotsByClass.get(classId) ?? []) {
      const prev = out.find((x) => x.day === s.day);
      if (!prev) out.push({ day: s.day, start: s.start });
      else if (s.start && (!prev.start || s.start < prev.start)) prev.start = s.start;
    }
    return out;
  };
  // 완교시 기준(분)은 **과목별**로 다르다(영어는 그룹이 없어 null=판정 안 함) — 한 번만 계산해 재사용.
  const fullPeriodCache = new Map<string, number | null>();
  const fullPeriodMinOf = (subject: string): number | null => {
    const hit = fullPeriodCache.get(subject);
    if (hit !== undefined) return hit;
    const v = weekdayFullPeriodMinutes(subject, settingsToPeriodsConfig(settings.operations));
    fullPeriodCache.set(subject, v);
    return v;
  };

  const candidates: (Omit<PrepClassFact, "gradeMatched"> & { halfPeriod: boolean; closedOut: boolean })[] = classes.map((row) => {
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
      scheduleLabel: formatSchedule(scheduleOf(row.id)),
      seats: room?.capacity ?? null,
      enrolled: enrolledByClass.get(row.id) ?? 0,
      notes: row.notes ?? null,
      // 반교시 반은 제안 후보에서 뺀다(원장 2026-08-04) — 판정 근거는 시간 길이뿐, 반 이름이 아니다.
      halfPeriod: isHalfPeriodClass(slotsByClass.get(row.id) ?? [], fullPeriodMinOf(row.subject)),
      // 배치가 모두 끝났고 지금 다니는 학생도 없는 반(끝난 특강 등)은 후보에서 뺀다 — `slotsByClass`는 위에서 살아 있는 행만 담았다.
      closedOut: isClosedOutClass(slotsByClass.get(row.id)?.length ?? 0, enrolledByClass.get(row.id) ?? 0),
    };
  });

  // 형제자매 후보의 **현재 수강 반** — 상담에서 가장 강한 카드("형 OO는 지금 이 반입니다").
  // 후보가 있을 때만 도는 추가 왕복이라 위 Promise.all에 넣지 않았다(없으면 쿼리 자체가 없다).
  // ⚠️ 본인 제외 — 연락처 정규화를 고치면 이미 재원 중인 **상담 당사자 본인**이 자기 "형제자매 후보"로
  //    뜬다(QR 기존재원생 접수는 흔하다). 연결된 학생 id로 걸러낸다.
  // 상담 당사자가 이미 재원생이면 그 사실과 현재 수강 반을 사실로 싣는다(감사 #9d).
  let enrolledNow: { classNames: string[] } | null = null;
  if (linkedStudentId) {
    const { data: selfRow } = await supabase
      .from("students")
      .select("id, status, enrollments:enrollments ( end_date, class:class_id ( class_name ) )")
      .eq("tenant_id", tenantId)
      .eq("id", linkedStudentId)
      .maybeSingle();
    if (selfRow?.status === "enrolled") {
      const rows = (selfRow.enrollments ?? []) as {
        end_date: string | null;
        class: { class_name?: string } | { class_name?: string }[] | null;
      }[];
      const names = rows
        .filter((r) => r.end_date == null)
        .map((r) => {
          const cl = (Array.isArray(r.class) ? r.class[0] : r.class) as { class_name?: string } | null;
          return cl?.class_name ?? null;
        })
        .filter((n): n is string => !!n);
      enrolledNow = { classNames: [...new Set(names)] };
    }
  }

  const siblingStudents = ((siblingRows.data ?? []) as {
    id: string; name: string; school: string | null; grade: string | null;
  }[]).filter((s) => s.id !== linkedStudentId);
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
      enrolledNow,
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
      // 학년대(초/중/고)까지 맞춘다 — 안 걸면 중1 상담지에 초등 교재가 실린다(math 활성 141권).
      .filter((t) => {
        const lvl = gradeToken(grade)?.charAt(0);
        const g = (t.grade_level as string | null)?.trim();
        return !lvl || !g || g.startsWith(lvl);
      })
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
      shuttleEnabled: !!settings.operations.shuttle?.enabled && isModuleEnabled(settings.modules.disabled, "shuttle"),
      shuttleFee: settings.operations.shuttle?.fee?.trim() || null,
      shuttleRoutes: (settings.operations.shuttle?.routes ?? []).map((r) => r.label).filter(Boolean),
    },
  };
}

/** timestamptz → KST 날짜(YYYY-MM-DD). 표시는 KST 고정(전역 규칙). */
function kstDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
