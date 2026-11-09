import { getContributionSettingsPreview } from "../server/queries";
import { ContributionSettings } from "./settings-form";
export async function ContributionSettingsFace() {
  const data = await getContributionSettingsPreview();
  if (!data?.gate.canConfigure) return <p>로열티 설정을 열람할 권한이 없습니다.</p>;
  return <ContributionSettings data={data} />;
}
