import { redirect } from "next/navigation";
import { getContributionList } from "@/features/student-contribution/server/queries";
import { ContributionList } from "@/features/student-contribution/components/contribution-list";
export const metadata = { title: "원생 기여도 — 에이와" };
export const maxDuration = 120;
export default async function StudentContributionPage() {
  const data = await getContributionList();
  if (!data) redirect("/");
  return <ContributionList data={data} />;
}
