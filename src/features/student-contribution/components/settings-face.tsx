import { getContributionList } from "../server/queries";
import { ContributionSettings } from "./settings-form";
export async function ContributionSettingsFace() {
  const data = await getContributionList();
  if (!data?.gate.canConfigure) return <p>기여도 설정을 열람할 권한이 없습니다.</p>;
  return <ContributionSettings data={data} />;
}
