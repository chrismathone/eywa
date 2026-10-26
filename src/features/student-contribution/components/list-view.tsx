import { redirect } from "next/navigation";
import { getContributionList } from "@/features/student-contribution/server/queries";
import { ContributionList } from "@/features/student-contribution/components/contribution-list";
export async function ListView() {
  const data = await getContributionList();
  if (!data) redirect("/");
  return <ContributionList data={data} />;
}
