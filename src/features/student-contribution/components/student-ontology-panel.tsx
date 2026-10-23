import { Suspense } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import { getContributionStudents } from "../server/directory";
import { getContributionGate } from "../server/access";
import { ContributionHeader } from "./contribution-shell";
import { ContributionStudentPanel } from "./student-panel";
import { CurrentConnections, ConnectionSkeleton } from "./current-connections";
import { StoredSummary } from "./stored-summary";

async function Heading({ studentId }: { studentId: string }) {
  const [students, gate] = await Promise.all([getContributionStudents(), getContributionGate()]);
  const student = students.find((s) => s.id === studentId && !s.is_test);
  if (!student) return null;
  return <ContributionHeader title={`${student.name}의 기록과 기여도`} description="현재 연결부터 누적 점수의 근거까지 한곳에서 확인하세요." active="students" canConfigure={gate?.canConfigure}
    actions={<Link href="/student-contribution" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted">원생 목록</Link>} />;
}
export function StudentOntologyPanel({ studentId, month }: { studentId: string; month?: string }) {
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <Suspense fallback={<ConnectionSkeleton label="학생 기록" />}><Heading studentId={studentId} /></Suspense>
    <Suspense fallback={<ConnectionSkeleton />}><CurrentConnections studentId={studentId} /></Suspense>
    <Suspense fallback={null}><StoredSummary studentId={studentId} /></Suspense>
    <Suspense fallback={<ConnectionSkeleton label="월별 기여도" />}><ContributionStudentPanel studentId={studentId} month={month} /></Suspense>
  </div>;
}
