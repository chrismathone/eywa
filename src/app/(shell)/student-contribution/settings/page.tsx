import { redirect } from "next/navigation";
import { getContributionSettingsPreview } from "@/features/student-contribution/server/queries";
import { ContributionSettings } from "@/features/student-contribution/components/settings-form";
export const metadata = { title: "기여도 배점 설정 — 에이와" };
export default async function Page() {
  const data = await getContributionSettingsPreview();
  if (!data?.gate.canConfigure) redirect("/student-contribution");
  return <ContributionSettings data={data} />;
}
