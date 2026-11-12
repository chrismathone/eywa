import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getMathSheetMonth } from "@/features/math-sheets/server/month-queries";
import { getMathClassOptions } from "@/features/math-sheets/server/landing";
import { countRosterPhases, rosterExtraParts } from "@/features/math-sheets/lib/roster";
import { LearningOverview } from "@/features/math-sheets/components/learning-overview";
import { getMathLearningData } from "@/features/math-sheets/server/learning-queries";
import { canResetMathLearningGoals } from "@/features/math-sheets/server/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMathClassTextbooks } from "@/features/textbooks/server/math-assignment-queries";
import { MathTextbookProvider } from "@/features/math-sheets/components/math-textbook-context";
import type { BookWindow } from "@/features/textbooks/book-window";
import { buildStudentBookPlans, type StudentBookPlans } from "@/features/textbooks/book-plans";
import { getMathBookTargets, getRecentReportsAllClasses } from "@/features/textbooks/server/math-book-plan-queries";
import { getSchoolExamPeriods } from "@/features/textbooks/server/school-exam-queries";
import { normalizeSchoolName } from "@/features/schools/school-name";
import { learningClassDates } from "@/features/math-sheets/lib/learning-class-dates";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

export const metadata: Metadata = { title: "수학 강사 시트 · 월간 — 에이와" };

/**
 * MCS **월간 뷰** — 반 1개 × 달 1개(진도표 ↔ 진도 레일).
 *
 * ECS와 나란한 화면이지만 **축이 다르다**: 영어는 영역 × 날짜, 수학은 **학생 × 수업일**이다.
 * 수학은 같은 반 같은 날에도 학생마다 다른 교재를 나가서(실측 2026-08: 2명 이상 묶음의 79%)
 * 반 한 줄짜리 계획으로는 사실을 담을 수 없다.
 * 게이트는 조회 안의 `requireMcsClassAccess`([[#77]] "모든 표면이 같은 게이트를").
 */
export default async function McsMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { classId } = await params;
  const query = await searchParams;
  const month = typeof query.month === "string" ? query.month : undefined;
  const student = typeof query.student === "string" ? query.student : undefined;
  const initialQuery = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
  // 반 전환 드롭다운 목록은 시트와 **독립**이라 나란히 받는다(B4) — 가벼운 목록이지 랜딩 집계가 아니다.
  const [res, options] = await Promise.all([
    getMathSheetMonth(classId, month ?? null),
    getMathClassOptions(month ?? null),
  ]);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="수학 강사 시트 · 월간" description="반별 월간 진도" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
          <Link href="/mcs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { data } = res;
  // 집중 보기에서 과거 날짜로 이동해도 보고서가 최근 30건에서 잘리지 않게 한다.
  // 같은 반 학생 전환은 이미 조회한 자료를 사용한다.
  // 셋 다 시트 조회(게이트 통과) 뒤의 독립 조회 — 함께 받는다(B4).
  // 교재 배정은 시트 게이트(`getMathSheetMonth` 안 `requireMcsClassAccess`)를 이미 지난 반만 읽는다.
  const [user, settings] = await Promise.all([getCurrentUser(), getTenantSettings()]);
  const textbooksOn = isModuleEnabled(settings.modules.disabled, "textbooks");
  const studentIds = data.students.map((s) => s.studentId);
  const [learning, canResetGoals, textbooks, targets, allReports, schoolExams] = await Promise.all([
    getMathLearningData(classId, data, { allRecords: true }),
    // 전체 목표 '초기화'(배정 취소)는 **원장 이상급**(원장 2026-09-18) — 화면과 서버가 같은 함수를 본다([[#77]]).
    canResetMathLearningGoals(user),
    user && textbooksOn ? getMathClassTextbooks(user.tenantId, classId, studentIds) : null,
    // 교재 전체 목표 — 사람이 고른 목표 권 · 다른 반(수요일 개별심화) 교재 기록. 둘 다 실패해도 화면은 산다.
    user && textbooksOn ? getMathBookTargets(user.tenantId, studentIds) : null,
    user && textbooksOn ? getRecentReportsAllClasses(user.tenantId, studentIds) : null,
    // 학교별 내신기간(없으면 기본표) — 실패해도 기본표로 계산한다.
    user && textbooksOn ? getSchoolExamPeriods(user.tenantId, data.students.map((s) => s.school)) : null,
  ]);
  // 🔴 줄 수를 "학생 N명"이라 적지 않는다 — 행에는 이 달 중 나간 사람과 아직 안 들어온 사람이
  //    섞여 있다(카드와 **같은 함수**로 센다).
  const counts = countRosterPhases(data.students.map((s) => s.rosterPhase));
  // 카드 툴팁과 **같은 문구**로 적는다(각자 지으면 같은 수를 다른 이름으로 부른다).
  const extraLabel = rosterExtraParts(counts);
  // 필터 밖의 반으로 바로 들어와도 드롭다운이 "지금 보는 반"을 잃지 않게 맨 앞에 끼운다(ECS 월간과 같은 규약).
  const classOptions = options.some((o) => o.id === classId)
    ? options
    : [{ id: classId, name: data.className }, ...options];
  // 교재 전체 목표(원장 2026-10-20 "중3 11월말까지 3개월당 2권 · 내신기간 제외") + 지금 3개월 창.
  // 수업일은 목표 계획과 **같은 함수**로 센다. 재료(주문·보고서)는 서버에 남기고 결과만 내려보낸다.
  const windows: Record<string, BookWindow> = {};
  const plans: Record<string, StudentBookPlans> = {};
  if (textbooks) {
    const { catalog, orders, reports } = textbooks.sources;
    for (const s of data.students) {
      const p = buildStudentBookPlans({
        orders: orders.get(s.studentId) ?? [],
        catalog,
        // 레일과 같은 기준일까지의 기록만(과거 달을 보면 그 달 끝까지).
        reports: (reports.get(s.studentId) ?? []).filter((r) => r.date <= learning.referenceDate),
        allReports: allReports?.get(s.studentId) ?? [],
        grade: s.grade,
        targets: targets?.byStudent.get(s.studentId),
        examOverrides: schoolExams?.byKey.get(normalizeSchoolName(s.school)) ?? [],
        referenceDate: learning.referenceDate,
        classDates: (from, to) => learningClassDates(s.studentId, learning.context, from, to),
      });
      plans[s.studentId] = p;
      if (p.roadmaps[0]) windows[s.studentId] = p.roadmaps[0].window;
    }
  }
  const overview = (
    <LearningOverview
      // 달·반이 바뀌면 클라 상태(보기·목표 편집 큐)를 새로 세운다 — 옛 달의 목표가 남으면
      // 새 달 화면에 남의 값이 잠깐 비친다.
      key={`${classId}:${data.month}:${student ?? ""}`}
      data={data}
      learning={learning}
      initialStudentId={student}
      initialQuery={initialQuery}
      classOptions={classOptions}
      canResetGoals={canResetGoals}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`수학 강사 시트 · 월간 — ${data.className}`}
          description={[
            data.monthLabel,
            `수업 ${data.days.length}일`,
            `학생 ${counts.on}명`,
            ...extraLabel,
          ].join(" · ")}
        />
      </div>
      <div className="min-h-0 flex-1">
        {textbooksOn ? (
          <MathTextbookProvider
            value={{
              classId,
              status: textbooks?.status ?? "failed",
              classBook: textbooks?.classBook ?? null,
              byStudent: textbooks?.byStudent ?? {},
              choices: textbooks?.choices ?? [],
              now: textbooks?.now ?? {},
              windows,
              plans,
              targetStatus: targets?.status ?? "failed",
              schoolExams: { status: schoolExams?.status ?? "failed", rows: schoolExams?.rows ?? [] },
              // 배정 쓰기 = 목표 쓰기와 같은 게이트(서버 액션이 같은 함수로 다시 본다).
              canWrite: data.canEdit,
            }}
          >
            {overview}
          </MathTextbookProvider>
        ) : (
          overview
        )}
      </div>
    </div>
  );
}
