import { redirect } from "next/navigation";
import { getContributionGate } from "@/features/student-contribution/server/access";
import { ContributionStudentPanel } from "@/features/student-contribution/components/student-panel";
export const metadata = { title: "원생 기여도 상세 — 에이와" };
export const maxDuration = 120;
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  if (!(await getContributionGate())) redirect("/");
  const [{ id }, { month }] = await Promise.all([params, searchParams]);
  return <ContributionStudentPanel studentId={id} month={month} />;
}
