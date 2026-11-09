import { Suspense } from "react";
import { StudentDetailActions } from "./student-detail-actions";
import { getContributionStudents } from "../server/directory";
import { getContributionGate } from "../server/access";
import { ContributionHeader } from "./contribution-shell";
import { ContributionStudentPanel } from "./student-panel";
import { CurrentConnections, ConnectionSkeleton } from "./current-connections";
import { StoredSummary } from "./stored-summary";
import { EyIcon } from "@/components/icons/aywa-icons";

async function Heading({ studentId }: { studentId: string }) {
  const [students, gate] = await Promise.all([getContributionStudents(), getContributionGate()]);
  const student = students.find((s) => s.id === studentId && !s.is_test);
  if (!student) return null;
  return <ContributionHeader title={`${student.name}의 로열티와 기록`} description="월별 점수와 계산 근거를 확인하세요." active="students" canConfigure={gate?.canConfigure}
    actions={<StudentDetailActions studentId={studentId} />} />;
}
export function StudentOntologyPanel({ studentId, month }: { studentId: string; month?: string }) {
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <Suspense fallback={<ConnectionSkeleton label="학생 기록" />}><Heading studentId={studentId} /></Suspense>
    <Suspense fallback={<ConnectionSkeleton label="월별 로열티" />}><ContributionStudentPanel studentId={studentId} month={month} /></Suspense>
    <details key={studentId} id={`current-connections-${studentId}`} tabIndex={-1} className="group rounded-xl border border-line" aria-label="현재 연결">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <span><span className="block font-semibold">현재 연결</span><span className="mt-1 block text-xs">현재 수강·담당자, 상담·메모와 최근 기록 요약</span></span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-primary"><span className="group-open:hidden">펼치기</span><span className="hidden group-open:inline">접기</span><span className="group-open:rotate-180"><EyIcon name="chevronDown" size={16} /></span></span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <Suspense fallback={<ConnectionSkeleton />}><CurrentConnections studentId={studentId} /></Suspense>
        <section id={`record-summary-${studentId}`} tabIndex={-1} aria-label="저장된 요약" className="scroll-mt-4"><Suspense fallback={<ConnectionSkeleton label="최근 기록 요약" />}><StoredSummary studentId={studentId} /></Suspense></section>
      </div>
    </details>
  </div>;
}
