import "server-only";
import { findSamePersonConsultations } from "./same-person-query";
import { isModuleEnabled } from "@/lib/modules";

import { createClient } from "@/lib/supabase/server";

/** 세션 client와 admin client 어느 쪽이든 받는다(공개 접수 자동 생성 경로용). */
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
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
  tuitionFitsLevel,
  type PrepClassFact,
  type PrepFacts,
} from "@/features/enrollment/prep-brief";
import type { IntakeChecklist } from "@/features/enrollment/intake-checklist";
import { settingsToPeriodsConfig, weekdayFullPeriodMinutes } from "@/features/timetable/lib/periods";
import { kstToday } from "@/lib/date-kst";
import { briefFactLines } from "@/features/enrollment/brief-facts";
import { timeToMin } from "@/features/timetable/lib/ten-minute-grid";

/**
 * 사전 브리프의 **사실 스냅샷 수집** — 상담 1건 기준으로 aywa DB에서 상담자가 알아야 할 것을 전부 모은다.
 * (접수 폼 + 개설 반·정원·시간·강사 + 수강료 단가표 + 교재 + 같은 학교/학년 재원생 집계 + 형제자매 후보
 *  + 같은 학생의 이전 접수 + 학원 정책).
 *
 * 성능 규칙 준수:
 * - 서로 독립인 조회는 전부 `Promise.all` (B4).
 * - 인원 집계는 `count: exact, head: true`로 행을 안 받는다 (B2 — 전건 fetch는 1000행에서 조용히 잘린다).
 * - 반 id 다건 조회는 `fetchAllPagedInChunks` (B3 — 큰 `.in()`은 414 + error 삼킴 · 청크 안에서도 1000행 절단 — B2).
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
  const { data: c, error: headError } = await head.maybeSingle();
  if (headError) throw new Error(`상담을 읽지 못했습니다: ${headError.message}`);
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
  // 양방향 — QR이 축약형('칠성초')이고 학생 DB가 전체형('칠성초등학교')인 경우도 있다(검수 2026-11-11 · Codex).
  const short = normalizeSchool(school);
  const full = short?.replace(/초$/, "초등학교").replace(/중$/, "중학교").replace(/고$/, "고등학교") ?? null;
  const schoolCandidates = school
    ? [...new Set([school, short, full].filter((v): v is string => !!v))]
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
        `id, class_name, subject, notes, english_track,
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
    // 보호자2 연락처(s2_0022)도 본다 — 상담에 적힌 번호가 그 원생의 보호자2(예: 어머니) 번호일 수 있다. 칸마다 `.in()`으로
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

  // 🔴 조회 실패를 '반 없음'·'0명'으로 삼키지 않는다 — 거짓 사실이 브리프에 동결됐다(검수 2026-11-11 · #138). 실패면 던져
  //    생성이 실패로 끝나고 직전 브리프가 남는다.
  for (const [what, r] of [["개설 반", classRows], ["수강료 단가표", tuitionRows], ["교재", textbookRows], ["재원생 수", totalCount], ["같은 학교 재원생 수", sameSchoolCount], ["같은 학년 재원생 수", sameGradeCount]] as const) {
    const error = (r as { error?: { message?: string } | null }).error;
    if (error) throw new Error(`브리프 자료(${what})를 읽지 못했습니다: ${error.message ?? ""}`);
  }

  // 현원 — 표시 후보가 될 반만 청크 + 페이지 조회(B3 · 청크 안에서도 1000행이 넘으면 잘린다 — fetchAllPagedInChunks).
  // 🔴 지금 다니는 수강만 센다: 시작일 ≤ 오늘 · (끝 없음 또는 끝 ≥ 오늘) — 예전엔 끝 없음만 세서 시작 전 예정 수강이 들어가고
  //    끝날 날이 정해진 지금 수강은 빠졌다(검수 2026-11-11 · Codex).
  const today = kstToday();
  const classes = classRows.data ?? [];
  const classIds = classes.map((row) => row.id);
  const enrolledByClass = new Map<string, number>();
  if (classIds.length > 0) {
    const enrollments = await fetchAllPagedInChunks<{ class_id: string }>(classIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("id, class_id")
        .eq("tenant_id", tenantId)
        .lte("start_date", today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .in("class_id", chunk)
        .order("id")
        .range(from, to),
    );
    for (const e of enrollments) enrolledByClass.set(e.class_id, (enrolledByClass.get(e.class_id) ?? 0) + 1);
  }

  // 요일·시각 — 후보로 좁히기 전 전체 반에 대해 한 번(같은 청크 규칙).
  // ⚠️ `class_schedules`는 **운영 이력을 함께 담는다**([[#88]] 실측 1,068행 중 480행 만료) → 끝난 배치를
  //    같이 읽으면 상담지에 **지금 안 하는 요일·시각**이 찍힌다. 살아 있는 행만 본다.
  // ⚠️ end_time도 받는다 — 반교시 판정(교시 하나를 통째로 채우는 날이 있는가)이 길이를 봐야 한다.
  // 🔴 지금 유효한 배치(valid_from ≤ 오늘)와 앞으로 시작하는 배치를 가른다(#88 · 검수 2026-11-11) — 예전엔 끝나지 않은 행을
  //    모두 모아 시간표 가져오기로 요일을 바꿔 둔 반이 적용일 전까지 '월·화·목·금'처럼 없는 주 4회로 찍혔다.
  const slotsByClass = await loadClassSlots(supabase, tenantId, classIds, today);
  // 완교시 기준(분)은 **과목별**로 다르다(영어는 그룹이 없어 null=판정 안 함) — 한 번만 계산해 재사용.
  const fullPeriodCache = new Map<string, number | null>();
  const fullPeriodMinOf = (subject: string): number | null => {
    const hit = fullPeriodCache.get(subject);
    if (hit !== undefined) return hit;
    const v = weekdayFullPeriodMinutes(subject, settingsToPeriodsConfig(settings.operations));
    fullPeriodCache.set(subject, v);
    return v;
  };

  const candidates: (Omit<PrepClassFact, "gradeMatched"> & { halfPeriod: boolean; closedOut: boolean; eie: boolean })[] = classes.map((row) => {
    const teacher = (Array.isArray(row.teacher) ? row.teacher[0] : row.teacher) as
      | { display_name?: string }
      | undefined;
    const slots = slotsByClass.get(row.id);
    return {
      id: row.id,
      className: row.class_name,
      subjectLabel: subjectMaps.labelOf(row.subject),
      teacherName: teacher?.display_name ?? null,
      scheduleLabel: slots?.label ?? null,
      // 🔴 정원은 싣지 않는다 — 강의실 수용 인원은 반 모집 정원이 아니다(운영 후보 354개 중 319개가 10 · 검수 2026-11-11).
      seats: null,
      enrolled: enrolledByClass.get(row.id) ?? 0,
      notes: row.notes ?? null,
      // 반교시 반은 제안 후보에서 뺀다(원장 2026-08-04) — 판정 근거는 시간 길이뿐, 반 이름이 아니다.
      halfPeriod: isHalfPeriodClass(slots?.slots ?? [], fullPeriodMinOf(row.subject)),
      // 배치가 모두 끝났고(지금·앞으로 둘 다 없음) 지금 다니는 학생도 없는 반(끝난 특강 등)은 후보에서 뺀다.
      closedOut: isClosedOutClass(slots?.liveCount ?? 0, enrolledByClass.get(row.id) ?? 0),
      // EiE(초등 영어 프로그램)는 중·고 학생 후보에서 뺀다(rankPrepClasses).
      eie: (row as { english_track?: string | null }).english_track === "eie",
    };
  });

  // 형제자매 후보의 **현재 수강 반** — 상담에서 가장 강한 카드("형 OO는 지금 이 반입니다").
  // 후보가 있을 때만 도는 추가 왕복이라 위 Promise.all에 넣지 않았다(없으면 쿼리 자체가 없다).
  // ⚠️ 본인 제외 — 연락처 정규화를 고치면 이미 재원 중인 **상담 당사자 본인**이 자기 "형제자매 후보"로
  //    뜬다(QR 기존재원생 접수는 흔하다). 연결된 학생 id로 걸러낸다.
  // 상담 당사자가 이미 재원생이면 그 사실과 현재 수강 반을 사실로 싣는다(감사 #9d).
  let enrolledNow: { classNames: string[]; classLines?: string[] } | null = null;
  // 재원생 본인의 지금 반 · 그 수업 시간 — 후보에서 그 반과 시간이 겹치는 반을 뺀다(합의 8 · 적대 리뷰 2026-11-11).
  const ownClassIds = new Set<string>();
  const ownBusy: { day: string; start: string | null; end: string | null }[] = [];
  if (linkedStudentId) {
    const { data: selfRow, error: selfError } = await supabase
      .from("students")
      .select("id, status, enrollments:enrollments ( start_date, end_date, class_id, class:class_id ( class_name, subject ) )")
      .eq("tenant_id", tenantId)
      .eq("id", linkedStudentId)
      .maybeSingle();
    if (selfError) throw new Error(`브리프 자료(재원생 본인)를 읽지 못했습니다: ${selfError.message}`);
    if (selfRow?.status === "enrolled") {
      const rows = (selfRow.enrollments ?? []) as {
        start_date: string | null;
        end_date: string | null;
        class_id: string | null;
        class: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[] | null;
      }[];
      // 지금 다니는 수강(현원과 같은 기준)
      const current = rows.filter((r) => (!r.start_date || r.start_date <= today) && (r.end_date == null || r.end_date >= today));
      const byClass = new Map<string, string>();
      const otherSubject = new Set<string>(); // 상담 과목과 다른 과목 반 — 시간 겹침은 이 반들만 본다(같은 과목 반 변경 상담이면 같은 시간대 수준별 반도 후보다 · 재리뷰)
      for (const r of current) {
        const cl = (Array.isArray(r.class) ? r.class[0] : r.class) as { class_name?: string; subject?: string } | null;
        if (r.class_id && cl?.class_name) byClass.set(r.class_id, cl.class_name);
        if (r.class_id && cl?.subject && cl.subject !== c.subject) otherSubject.add(r.class_id);
      }
      // 지금 수업의 요일·시각 — 겹치는 반을 제안하지 않게(검수 2026-11-11 · B11).
      const ownSlots = await loadClassSlots(supabase, tenantId, [...byClass.keys()], today);
      for (const id of byClass.keys()) ownClassIds.add(id);
      for (const [id, v] of ownSlots) if (otherSubject.has(id)) ownBusy.push(...v.slots);
      enrolledNow = {
        classNames: [...new Set(byClass.values())],
        classLines: [...byClass].map(([id, name]) => {
          const label = ownSlots.get(id)?.label;
          return label ? `${name} ${label}` : name;
        }),
      };
    }
  }

  const siblingStudents = ((siblingRows.data ?? []) as {
    id: string; name: string; school: string | null; grade: string | null;
  }[]).filter((s) => s.id !== linkedStudentId);
  const siblingClasses = new Map<string, string[]>();
  if (siblingStudents.length > 0) {
    const rows = await fetchAllPagedInChunks<{ student_id: string; class: { class_name?: string } | { class_name?: string }[] | null }>(
      siblingStudents.map((s) => s.id),
      (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select("id, student_id, class:class_id ( class_name )")
          .eq("tenant_id", tenantId)
          .lte("start_date", today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .in("student_id", chunk)
          .order("id")
          .range(from, to),
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
    // 학부모가 '기타'에 직접 쓴 글은 선택지와 따로 — 사실 블록에서 학부모 글 묶음으로 간다(검수 2026-11-11 · Codex).
    checklist: checklist ? checklistToPairs(checklist, { separateEtc: true }) : [],
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
    classes: rankPrepClasses(
      candidates.filter((c) => !ownClassIds.has(c.id) && !overlapsBusy(slotsByClass.get(c.id)?.slots ?? [], ownBusy)),
      { subjectKeyLabel: subjectLabel, grade },
    ),
    // 🔴 과목·학교급을 먼저 거른 뒤 12행 — 예전엔 과목만 거르고 정렬 앞 12행을 잘라 초등 수학 상담에 중·고 단가만, 중등 영어에
    //    EIE(초등 프로그램) 단가만 실렸다(검수 2026-11-11 · #84). 다른 학교급을 이름에 적은 단가는 빼고, EIE는 초등·미취학에만.
    tuition: (tuitionRows.data ?? [])
      .filter((t) => !subjectLabel || matchesSubjectCategory(t.category as string, subjectLabel))
      .filter((t) => tuitionFitsLevel(`${t.category} ${t.name}`, gradeToken(grade)))
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
      // 학원 설정 → 상담 양식 '학원 운영 안내' 원문(빈칸 제외 · 2026-11-12). 브리프 화면·인쇄가 이 스냅샷을 그대로 싣는다.
      operations: briefFactLines(settings.consultations.briefFacts),
    },
  };
}

/** timestamptz → KST 날짜(YYYY-MM-DD). 표시는 KST 고정(전역 규칙). */
function kstDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

type SlotRow = { class_id: string; day_of_week: string; start_time: string | null; end_time: string | null; valid_from: string | null; valid_to: string | null };

/**
 * 반별 시간표 — 지금 유효한 배치(valid_from ≤ 오늘 ≤ valid_to)만 라벨·반교시 판정에 쓴다. 지금 배치가 없으면 가장 이른 앞으로의
 * 배치를 'M월 D일부터 …'로(배치 적용일 — 개강일·등원 시작일이 아니다). `liveCount` = 지금 + 앞으로 배치 수(끝난 반 판정).
 * 청크 × 페이지 조회(이력 표라 청크 하나가 1000행을 넘는다 — CLAUDE.md B2).
 */
async function loadClassSlots(
  supabase: SupabaseLike,
  tenantId: string,
  classIds: string[],
  today: string,
): Promise<Map<string, { label: string | null; slots: { day: string; start: string | null; end: string | null }[]; liveCount: number }>> {
  const out = new Map<string, { label: string | null; slots: { day: string; start: string | null; end: string | null }[]; liveCount: number }>();
  if (classIds.length === 0) return out;
  const rows = await fetchAllPagedInChunks<SlotRow>(classIds, (chunk, from, to) =>
    supabase
      .from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time, valid_from, valid_to")
      .eq("tenant_id", tenantId)
      .in("class_id", chunk)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("id")
      .range(from, to),
  );
  const byClass = new Map<string, SlotRow[]>();
  for (const r of rows) (byClass.get(r.class_id) ?? byClass.set(r.class_id, []).get(r.class_id)!).push(r);
  for (const [id, list] of byClass) {
    const current = list.filter((r) => !r.valid_from || r.valid_from.slice(0, 10) <= today);
    const upcoming = list.filter((r) => r.valid_from && r.valid_from.slice(0, 10) > today);
    let use = current;
    let prefix = "";
    if (current.length === 0 && upcoming.length > 0) {
      const first = upcoming.map((r) => r.valid_from!.slice(0, 10)).sort()[0]!;
      use = upcoming.filter((r) => r.valid_from!.slice(0, 10) === first);
      prefix = `${Number(first.slice(5, 7))}월 ${Number(first.slice(8, 10))}일부터(예정) `;
    }
    const slots = use.map((r) => ({ day: r.day_of_week, start: r.start_time, end: r.end_time }));
    // 라벨용 = 요일별 **가장 이른 시각** 1건(같은 요일에 연속 교시 슬롯이 여러 개다 — 실측 106반 중 102반).
    const firsts: { day: string; start: string | null }[] = [];
    for (const s of slots) {
      const prev = firsts.find((x) => x.day === s.day);
      if (!prev) firsts.push({ day: s.day, start: s.start });
      else if (s.start && (!prev.start || s.start < prev.start)) prev.start = s.start;
    }
    const label = formatSchedule(firsts);
    out.set(id, { label: label ? `${prefix}${label}` : null, slots, liveCount: current.length + upcoming.length });
  }
  return out;
}

/** 두 시간표가 같은 요일에 시간이 겹치는가(지금 다니는 수업과 겹치는 반은 제안하지 않는다). 시각을 모르면 겹치지 않는 것으로 본다. */
function overlapsBusy(
  slots: readonly { day: string; start: string | null; end: string | null }[],
  busy: readonly { day: string; start: string | null; end: string | null }[],
): boolean {
  for (const a of slots) {
    const as = timeToMin(a.start ?? ""), ae = timeToMin(a.end ?? "");
    if (as == null || ae == null) continue;
    for (const b of busy) {
      if (a.day !== b.day) continue;
      const bs = timeToMin(b.start ?? ""), be = timeToMin(b.end ?? "");
      if (bs == null || be == null) continue;
      if (as < be && bs < ae) return true;
    }
  }
  return false;
}
