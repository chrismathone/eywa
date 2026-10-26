import { redirect } from "next/navigation";
import { getContributionSettingsPreview } from "@/features/student-contribution/server/queries";
import { ContributionSettings } from "@/features/student-contribution/components/settings-form";
export async function SettingsView() {
  const data = await getContributionSettingsPreview();
  if (!data?.gate.canConfigure) redirect("/student-contribution");
  return <ContributionSettings data={data} />;
}
