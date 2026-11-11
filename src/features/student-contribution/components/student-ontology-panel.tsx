import { Suspense } from "react";
import { StudentDetailActions } from "./student-detail-actions";
import { getContributionStudents } from "../server/directory";
import { getContributionGate } from "../server/access";
import { ContributionHeader } from "./contribution-shell";
import { ContributionStudentPanel } from "./student-panel";
import { CurrentConnections, ConnectionSkeleton } from "./current-connections";
import { StoredSummary } from "./stored-summary";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ContributionLink } from "./student-contribution-scope";
import { ContributionDetailHeadingSkeleton, ContributionEmbeddedHeadingSkeleton } from "@/app/(shell)/student-contribution/_components/contribution-skeleton";
import "./loyalty-detail.css";

async function Heading({ studentId }: { studentId: string }) {
  const [students, gate] = await Promise.all([getContributionStudents(), getContributionGate()]);
  const student = students.find((s) => s.id === studentId && !s.is_test);
  if (!student) return null;
  return <ContributionHeader title={`${student.name}의 로열티와 기록`} description="월별 점수와 계산 근거를 확인하세요." embedLabel={`${student.name} · 로열티와 기록`} active="students" canConfigure={gate?.canConfigure}
    actions={<StudentDetailActions studentId={studentId} />} />;
}
/** `embedded` = 원생 상세 안(로열티 범위) — 머리가 머리글이 아니라 제목·설명 한 덩어리라 스켈레톤도 그 모양(contribution-shell.tsx). */
export function StudentOntologyPanel({ studentId, month, embedded = false }: { studentId: string; month?: string; embedded?: boolean }) {
  return <div className="loyalty-detail w-full min-w-0 space-y-5 pb-6">
    {/* 머리가 맨 위 — 조회를 기다리는 동안엔 같은 자리·같은 모양의 머리 스켈레톤(앱 표준: 머리글 → 본문). */}
    <Suspense fallback={embedded ? <ContributionEmbeddedHeadingSkeleton /> : <ContributionDetailHeadingSkeleton />}><Heading studentId={studentId} /></Suspense>
    {/* 시안: 상세에서 랭킹으로 돌아가는 길 — 머리 밖이라 머리(탭)가 늦게 뜨거나 못 떠도 늘 보인다. */}
    <ContributionLink href="/student-contribution/ranking" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-semibold hover:bg-secondary"><EyIcon name="chevronLeft" size={16} />로열티 랭킹으로</ContributionLink>
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
