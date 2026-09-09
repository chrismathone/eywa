import { notFound } from "next/navigation";
import { BookOpen } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getExamClassOptions,
  getExamDetail,
  getExamScoreRows,
} from "@/features/exams/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { BatchScoreGrid } from "../_components/batch-score-grid";
import { EditExamTrigger, type ExamFormValue, type ExamClassOption } from "../_components/exam-form-dialog";
import { ExamDeleteButton } from "../_components/exam-delete-button";

const TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };

export default async function ExamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ class?: string }>;
}) {
  await requireAccess("exams");
  const { id } = await params;
  const sp = await searchParams;

  const exam = await getExamDetail(id);
  if (!exam) notFound();

  const classOptions = await getExamClassOptions(exam.subject, exam.scope);
  const selectedClassId = sp.class ?? classOptions[0]?.id ?? null;
  const rows = selectedClassId ? await getExamScoreRows(id, selectedClassId) : [];

  const [settings, allClasses] = await Promise.all([getTenantSettings(), getClassesList({ active: "active" })]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const meta = { label: subjects.labelOf(exam.subject), color: subjects.colorOf(exam.subject) };
  // 수정 다이얼로그의 시험범위(반별) 선택용 — 전체 활성 반(폼이 과목으로 필터).
  const allClassOptions: ExamClassOption[] = allClasses.map((c) => ({
    id: c.id,
    className: c.className,
    subject: c.subject,
  }));
  const editValue: ExamFormValue = {
    id: exam.id,
    name: exam.name,
    subject: exam.subject,
    examType: exam.examType,
    examDate: exam.examDate,
    maxScore: exam.maxScore,
    notes: exam.notes,
    scope: exam.scope,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="bg-card shadow-card rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill color={meta.color}>{meta.label}</Pill>
              <span className="text-text-dim text-xs">{TYPE_LABEL[exam.examType] ?? exam.examType}</span>
              <span className="text-text-faint num text-xs">{exam.examDate}</span>
              {exam.maxScore != null ? (
                <span className="text-text-faint text-xs">만점 {exam.maxScore}</span>
              ) : null}
            </div>
            <h1 className="text-foreground text-xl font-bold leading-tight">{exam.name}</h1>
            {exam.notes ? <p className="text-text-dim text-sm">{exam.notes}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <EditExamTrigger exam={editValue} classOptions={allClassOptions} />
            <ExamDeleteButton examId={exam.id} />
          </div>
        </div>

        {/* 전체 통계 (모든 반 합산) — 좁은 폭에선 2열(값+% 세로붕괴 방지), sm↑ 4열 */}
        <div className="border-line mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-center sm:grid-cols-4">
          <Stat label="응시" value={exam.stats.count} unit="명" />
          <Stat label="평균" value={exam.stats.avg} unit={exam.stats.avgPct != null ? `(${exam.stats.avgPct}%)` : ""} />
          <Stat label="최고" value={exam.stats.max} unit="" />
          <Stat label="최저" value={exam.stats.min} unit="" />
        </div>
      </header>

      {/* 반 선택 → 일괄 입력 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro mr-1">반 선택</span>
        {classOptions.length === 0 ? (
          <span className="text-text-faint text-xs">
            {meta.label} 과목으로 운영 중인 반이 없습니다.
          </span>
        ) : (
          <FilterSelect
            paramName="class"
            value={selectedClassId}
            options={classOptions.map((c) => ({
              value: c.id,
              label: `${c.className} (${c.studentCount}명)`,
            }))}
            ariaLabel="반 선택"
            searchable={classOptions.length > 12}
            // 고른 반의 점수 행이 아래를 채운다 = ECS·출석부와 같은 "지금 어느 반" 자리(원장 2026-08-18).
            // 여기엔 "전체"가 없고 늘 한 반이 잡혀 있어 표기가 항상 켜진다.
            marker
            // 폭은 내용 폭 — 출석부(attendance/page.tsx)와 같은 방식. 표기 기본 폭 `MARKER_WIDTH`(300px)는
            // 21px 시절 예산이라 v5(text-2xl 28px)에선 `중등E_초등 브릿지 A (12명)`이 말줄임으로 잘린다.
            // 2026-09-08 v5 글자 기준 실측: 예산 300 − border 2 − px-3.5 28 − gap 8 − chevron 16 = 246px
            // < 반 이름만 ≈262px(인원까지 ≈346px). 부모가 flex-wrap이라 좁으면 줄이 접힌다.
            // 🔴 MARKER_WIDTH 자체는 ECS·MCS 상단 바가 같이 쓰므로 여기서 건드리지 않는다.
            className="w-auto"
          />
        )}
      </div>

      {classOptions.length === 0 ? null : rows.length === 0 ? (
        <EmptyState
          image="students"
          icon={() => <BookOpen size={32} strokeWidth={1.8} />}
          title="이 반에 재원 학생이 없습니다"
        />
      ) : (
        <BatchScoreGrid examId={exam.id} maxScore={exam.maxScore} rows={rows} />
      )}
    </div>
  );
}

// BigStat 톤(문법 ②) — 큰 tabular 숫자 + 작은 dim 라벨. 카드 안 in-place 스탯이라 아톰 대신 톤만 이식.
function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <p className="text-text-dim text-sm font-medium">{label}</p>
      <p className="mt-1.5 flex items-baseline justify-center gap-1">
        <span className="num text-foreground text-3xl font-bold leading-none tracking-tight">
          {value ?? "—"}
        </span>
        {unit ? <span className="text-text-dim text-sm font-medium">{unit}</span> : null}
      </p>
    </div>
  );
}
