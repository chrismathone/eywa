import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getStudentAttendanceStats,
  getStudentById,
  getStudentEnrollments,
  type CareFocus,
} from "@/features/students/server/queries";
import { RunCareAiButton } from "./run-care-ai-button";

export const metadata = { title: "학생 상세 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

const STATUS_COLOR: Record<string, string> = {
  enrolled: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  prospect: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  consulted: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  on_hold: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  withdrawn: "text-muted-foreground bg-muted border-border",
};

const PRIORITY_COLOR: Record<CareFocus["priority"], string> = {
  high: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  medium: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  low: "text-chart-1 bg-chart-1/10 border-chart-1/20",
};

const PRIORITY_LABEL: Record<CareFocus["priority"], string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
};

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("students");
  const { id } = await params;
  const [student, enrollments, attendance] = await Promise.all([
    getStudentById(id),
    getStudentEnrollments(id),
    getStudentAttendanceStats(id, 30),
  ]);

  if (!student) notFound();

  const hasCareAi = student.aiCareSummary !== null;

  return (
    <div className="space-y-6">
      <Link
        href="/students"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        학생목록으로
      </Link>

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">학생</p>
          <h1 className="display text-foreground text-3xl">{student.name}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {student.grade ? <span>{student.grade}</span> : null}
            {student.school ? <span>· {student.school}</span> : null}
            {student.studentCode ? (
              <span className="num">· 학번 {student.studentCode}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${
              STATUS_COLOR[student.status] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {STATUS_LABEL[student.status] ?? student.status}
          </span>
          {student.status === "enrolled" ? (
            <RunCareAiButton studentId={student.id} hasExisting={hasCareAi} />
          ) : null}
        </div>
      </header>

      {hasCareAi ? (
        <section className="bg-card border-border space-y-4 rounded-lg border p-5">
          <header className="flex items-baseline justify-between">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="text-chart-4 size-4" />
              <h2 className="text-foreground text-sm font-semibold">AI 케어 인사이트</h2>
            </div>
            <div className="text-muted-foreground flex items-center gap-3 text-[10px]">
              {student.aiCareGeneratedAt ? (
                <span className="num">
                  {new Date(student.aiCareGeneratedAt).toLocaleDateString("ko-KR")} 생성
                </span>
              ) : null}
              {student.aiCareModelVersion ? (
                <span className="num font-mono">{student.aiCareModelVersion}</span>
              ) : null}
            </div>
          </header>

          <div className="space-y-2">
            <p className="eyebrow">종합 요약</p>
            <p className="text-foreground text-sm leading-relaxed">{student.aiCareSummary}</p>
          </div>

          {student.aiCareFocus && student.aiCareFocus.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow">주의 영역</p>
              <ul className="space-y-2">
                {student.aiCareFocus.map((f, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5"
                  >
                    <span
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                        PRIORITY_COLOR[f.priority]
                      }`}
                    >
                      {PRIORITY_LABEL[f.priority]}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-foreground text-sm font-medium">{f.area}</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {f.recommendation}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="bg-card border-border space-y-4 rounded-lg border p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold tracking-tight">프로필</h2>
          <dl className="space-y-3 text-sm">
            <Field label="담임" value={student.primaryTeacherName} />
            <Field label="부담임" value={student.secondaryTeacherName} />
            <Field label="학부모" value={student.parentName} />
            <Field label="연락처" value={student.parentPhone} mono />
            <Field label="등록일" value={student.enrolledAt} mono />
            {student.withdrawnAt ? <Field label="퇴원일" value={student.withdrawnAt} mono /> : null}
          </dl>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="bg-card border-border rounded-lg border p-5">
            <header className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">최근 30일 출결</h2>
              <p className="text-muted-foreground num text-xs">총 {attendance.total}건</p>
            </header>
            <div className="grid grid-cols-4 gap-4">
              <Stat label="출석률" value={`${attendance.rate.toFixed(1)}%`} highlight="text-chart-2" />
              <Stat label="출석" value={String(attendance.present)} unit="건" />
              <Stat label="결석" value={String(attendance.absent)} unit="건" highlight="text-chart-4" />
              <Stat label="지각" value={String(attendance.late)} unit="건" highlight="text-chart-3" />
            </div>
          </section>

          <section className="bg-card border-border rounded-lg border">
            <header className="border-border flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">수강 중인 반</h2>
                <p className="text-muted-foreground num text-xs">{enrollments.length}건</p>
              </div>
            </header>
            {enrollments.length === 0 ? (
              <div className="text-muted-foreground px-5 py-8 text-center text-sm">
                등록된 반이 없습니다
              </div>
            ) : (
              <ul className="divide-border divide-y">
                {enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{e.className}</p>
                      <p className="text-muted-foreground text-xs">
                        {SUBJECT_LABEL[e.subject] ?? e.subject} ·{" "}
                        <span className="num">{e.startDate}</span>
                        {e.endDate ? <> ~ <span className="num">{e.endDate}</span></> : <> ~ 현재</>}
                      </p>
                    </div>
                    {e.onHold ? (
                      <span className="text-chart-3 bg-chart-3/10 border-chart-3/20 rounded-md border px-2 py-0.5 text-xs font-medium">
                        휴원
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className={`text-foreground text-sm ${mono ? "num" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span> : null}
      </p>
    </div>
  );
}
