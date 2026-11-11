import { requireAccess } from "@/lib/auth/require-access";
import { Pill } from "@/components/atoms/pill";
import { DEMO_STUDENT } from "@/features/my-learning/data";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectKeyOfName } from "@/features/owner/subjects";
import { KpiGrid } from "@/features/my-learning/components/kpi-grid";
import { ScoreTrendChart } from "@/features/my-learning/components/score-trend-chart";
import { CurriculumProgress } from "@/features/my-learning/components/curriculum-progress";
import { AttendanceCalendar } from "@/features/my-learning/components/attendance-calendar";
import { RecentRecords } from "@/features/my-learning/components/recent-records";

export const metadata = { title: "내 학습 현황 — 에이와" };

/**
 * 내 학습 현황 — 학생 전용 누적 대시보드.
 * 데모 충실 이식: 정적 결정적 데이터(DEMO_STUDENT), DB·AI 미연동. 학생 로그인 후 착지점.
 */
export default async function MyLearningPage() {
  await requireAccess("my_learning");
  // 과목 라벨·색 = 학원설정(운영 enum 하드코딩 금지) — 셸 레이아웃과 같은 캐시된 읽기다.
  const subjectMaps = buildSubjectMaps((await getTenantSettings()).operations.subjects);
  const { student, history, curriculum, stat } = DEMO_STUDENT;
  const subjectNames = student.subjects.map((s) => s.name);
  const subjectKeys = [
    ...new Set(
      student.subjects.map((s) => {
        const key = subjectKeyOfName(s.name, subjectMaps.options);
        return key ? subjectMaps.labelOf(key) : s.name;
      }),
    ),
  ];
  const att = student.attendance;
  const attColor = att === "지각" ? "amber" : att === "조퇴" ? "blue" : att === "결석" ? "danger" : "primary";

  return (
    <div className="mx-auto max-w-[680px] space-y-4">
      <header className="bg-card border-line shadow-card rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <p className="micro text-text-faint">최근 4주 · 학습 누적 현황</p>
          <Pill color={attColor}>{att}</Pill>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div>
            <h1 className="text-foreground text-2xl leading-tight font-bold">
              {student.name} 님, 환영해요
            </h1>
            <p className="text-text-dim text-sm">
              {student.grade} {student.tag} · {subjectKeys.join(" · ")}
            </p>
          </div>
        </div>
      </header>

      <KpiGrid stat={stat} />
      <ScoreTrendChart history={history} subjects={subjectNames} />
      <CurriculumProgress curriculum={curriculum} subjectMaps={subjectMaps} />
      <AttendanceCalendar history={history} />
      <RecentRecords history={history} />
    </div>
  );
}
