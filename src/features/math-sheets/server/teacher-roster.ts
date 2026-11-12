import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { logDbError } from "@/lib/supabase/db-error";
import { addDays, kstToday } from "@/lib/date-kst";
import { buildStudentBookPlans } from "@/features/textbooks/book-plans";
import { getMathCatalogBooks, getStudentBookOrders } from "@/features/textbooks/server/math-assignment-queries";
import { getMathBookTargets } from "@/features/textbooks/server/math-book-plan-queries";
import { getAllSchoolExamPeriods } from "@/features/textbooks/server/school-exam-queries";
import { normalizeSchoolName } from "@/features/schools/school-name";
import type { RoadmapStatus } from "@/features/textbooks/book-roadmap";
import { SENT_REPORT_OR } from "../lib/sent-reports";
import { NO_HOMEROOM_LABEL } from "../landing-tracks";
import { mcsVisibleClassFilter } from "./access";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/**
 * MCS **선생님별 보기** — 선생님이 맡은 학생 목록과 학생마다 교재 3개월 진행(원장 2026-10-20 *"뷰를 선생님 별로해서
 * 선생님이 맡고있는 학생들 리스트가 뜨고 리스트는 학생이름 - 16차시 기준 하고 클릭하면 상세로"*).
 *
 * 🔑 '맡는다' = 그 반의 담임(`classes.teacher_id`) — 랜딩의 담임 묶음과 같은 축. 한 선생님의 여러 반에 같은 학생이면 한 줄.
 * 🔑 진행 숫자는 반 시트 카드와 **같은 함수**(`buildStudentBookPlans`)·같은 재료(그 반 발송 보고서)로 센다.
 * 🔴 스코프·과목 조건은 랜딩과 같다(`mcsVisibleClassFilter`) — 랜딩에 없는 반의 학생이 여기 서면 안 된다.
 */
export type TeacherStudentRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string;
  /** 지금 3개월 창 — 두 권 · 나간 차시/전체. 주문 기록이 없으면 null. */
  window: { name: string; done: number | null; total: number } | null;
  status: RoadmapStatus | null;
  difference: number | null;
  /** 지금 쓰는 교재(원장 2026-10-20 *"현재 사용하는 교재이름 노출"*) — 최근 진도가 걸린 권, 없으면 지금 3개월 창 첫 권. */
  bookName: string | null;
  /** 교재 이름이 둘 이상이면(다른 시리즈) 그 수. */
  bookCount: number;
};
export type TeacherGroup = { teacherName: string; students: TeacherStudentRow[] };

const REPORT_LOOKBACK_DAYS = 180;

export async function getMathTeacherRoster(): Promise<{ ok: true; groups: TeacherGroup[]; today: string; textbooksOn: boolean } | { ok: false; error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const [access, settings] = await Promise.all([accessLevelTenant(user.systemRole, "mcs"), getTenantSettings()]);
  if (access === "none") return { ok: false, error: "접근 권한이 없습니다" };
  const tenantId = user.tenantId;
  const textbooksOn = isModuleEnabled(settings.modules.disabled, "textbooks");
  const today = kstToday();
  const admin = createAdminClient();

  const [classRes, filter] = await Promise.all([
    admin.from("classes").select("id, class_name, teacher_id").eq("tenant_id", tenantId).eq("subject", "math")
      .eq("is_active", true).or(`closed_at.is.null,closed_at.gte.${today}`).order("class_name"),
    mcsVisibleClassFilter(),
  ]);
  if (classRes.error) {
    logDbError(classRes.error, "math-sheets.getMathTeacherRoster");
    return { ok: false, error: "반 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  const classes = (classRes.data ?? []).filter((c) => !filter || filter(String(c.id)));
  if (classes.length === 0) return { ok: true, groups: [], today, textbooksOn };
  const classIds = classes.map((c) => String(c.id));
  const teacherIds = [...new Set(classes.map((c) => c.teacher_id).filter(Boolean).map(String))];

  try {
    const [enrRows, teachers, catalog] = await Promise.all([
      fetchAllPagedInChunks<{ class_id: string; student_id: string; start_date: string | null; end_date: string | null; is_transferred: boolean | null }>(classIds, (chunk, f, t) =>
        admin.from("enrollments").select("id, class_id, student_id, start_date, end_date, is_transferred").eq("tenant_id", tenantId)
          .in("class_id", chunk).or(`end_date.is.null,end_date.gte.${today}`).order("id").range(f, t)),
      fetchInChunks<{ id: string; display_name: string | null }>(teacherIds, (chunk) =>
        admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk)),
      textbooksOn ? getMathCatalogBooks(tenantId) : Promise.resolve([]),
    ]);
    // end_date 조건은 프리필터일 뿐 — 반이동(반열림)은 그날 이미 새 반이라 같은 함수로 다시 본다([[#125]]).
    const current = enrRows.filter((e) => (!e.start_date || e.start_date.slice(0, 10) <= today)
      && !isEnrollmentEndedOn(e.end_date?.slice(0, 10), today, e.is_transferred === true));
    const studentIds = [...new Set(current.map((e) => String(e.student_id)))];
    const [students, textbookData] = await Promise.all([
      fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null; withdrawn_at: string | null }>(studentIds, (chunk) =>
        admin.from("students").select("id, name, school, grade, withdrawn_at").eq("tenant_id", tenantId).in("id", chunk)),
      textbooksOn
        ? Promise.all([
            getStudentBookOrders(tenantId, studentIds),
            fetchAllPagedInChunks<{ student_id: string; class_id: string | null; report_date: string; textbook: string | null; progress: string | null }>(studentIds, (chunk, f, t) =>
              admin.from("lesson_reports").select("id, student_id, class_id, report_date, textbook, progress").eq("tenant_id", tenantId)
                .in("student_id", chunk).or(SENT_REPORT_OR).is("revoked_at", null)
                .gte("report_date", addDays(today, -REPORT_LOOKBACK_DAYS)).order("id").range(f, t)),
            getMathBookTargets(tenantId, studentIds),
            // 학교별 내신기간 — 학원 전체를 받아 나란히(B4). 실패해도 기본표로 계산한다.
            getAllSchoolExamPeriods(tenantId),
          ])
        : Promise.resolve(null),
    ]);
    const orders = textbookData?.[0] ?? null;
    const reports = textbookData?.[1] ?? [];
    const targets = textbookData?.[2] ?? null;
    const schoolExams = textbookData?.[3] ?? null;
    const studentById = new Map(students.filter((s) => !s.withdrawn_at || s.withdrawn_at.slice(0, 10) > today).map((s) => [String(s.id), s]));
    const teacherName = new Map(teachers.map((t) => [String(t.id), t.display_name]));
    const classById = new Map(classes.map((c) => [String(c.id), c]));
    const reportsByKey = new Map<string, { date: string; textbook: string | null; progress: string | null }[]>();
    for (const r of reports) {
      const key = `${r.student_id}|${r.class_id}`;
      const list = reportsByKey.get(key) ?? [];
      list.push({ date: r.report_date, textbook: r.textbook, progress: r.progress });
      reportsByKey.set(key, list);
    }

    const groups = new Map<string, Map<string, TeacherStudentRow>>();
    for (const e of [...current].sort((a, b) => String(classById.get(String(a.class_id))?.class_name).localeCompare(String(classById.get(String(b.class_id))?.class_name), "ko"))) {
      const cls = classById.get(String(e.class_id));
      const s = studentById.get(String(e.student_id));
      if (!cls || !s) continue;
      const teacher = (cls.teacher_id && teacherName.get(String(cls.teacher_id))) || NO_HOMEROOM_LABEL;
      const rows = groups.get(teacher) ?? new Map<string, TeacherStudentRow>();
      if (rows.has(s.id)) continue;
      const plans = textbooksOn && targets && schoolExams ? buildStudentBookPlans({
        orders: orders?.get(s.id) ?? [],
        catalog: catalog ?? [],
        reports: reportsByKey.get(`${s.id}|${cls.id}`) ?? [],
        grade: s.grade,
        targets: targets.byStudent.get(s.id),
        examOverrides: schoolExams.byKey.get(normalizeSchoolName(s.school)) ?? [],
        referenceDate: today,
        today,
      }) : null;
      const r = plans?.roadmaps[0];
      const w = r?.window;
      rows.set(s.id, {
        studentId: s.id, name: s.name, school: s.school, grade: s.grade, classId: String(cls.id), className: String(cls.class_name),
        window: w ? { name: w.books.map((b) => b.title).join(" · "), done: w.done, total: w.total } : null,
        bookName: r?.position?.title ?? w?.books[0]?.title ?? null,
        status: r?.status ?? null,
        difference: r?.difference ?? null,
        bookCount: plans?.roadmaps.length ?? 0,
      });
      groups.set(teacher, rows);
    }
    return {
      ok: true,
      today,
      textbooksOn,
      groups: [...groups.entries()]
        .map(([teacherName, rows]) => ({ teacherName, students: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")) }))
        .sort((a, b) => (a.teacherName === NO_HOMEROOM_LABEL ? 1 : b.teacherName === NO_HOMEROOM_LABEL ? -1 : a.teacherName.localeCompare(b.teacherName, "ko"))),
    };
  } catch (e) {
    logDbError(e as { message?: string }, "math-sheets.getMathTeacherRoster");
    return { ok: false, error: "학생 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}
