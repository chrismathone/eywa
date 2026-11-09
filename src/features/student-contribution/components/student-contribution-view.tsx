import { Suspense } from "react";
import { StudentOntologyPanel } from "./student-ontology-panel";
import { StudentContributionScope } from "./student-contribution-scope";
import { ConnectionSkeleton } from "./current-connections";
import { OntologyView } from "./ontology-view";
import { ReferralView } from "./referral-view";
import { SettingsView } from "./settings-view";
import { ListView } from "./list-view";
import { getContributionGate } from "../server/access";

export async function StudentContributionView({ studentId, params }: { studentId: string; params: Record<string, string | undefined> }) {
  const section = params.contribution;
  const gate = await getContributionGate();
  if (!gate) return <p>충성도 기록을 열람할 수 없습니다.</p>;
  const denied = (section === "referrals" || section === "settings") && !gate.canConfigure;
  return <StudentContributionScope studentId={studentId} back={params.back}>
    <Suspense fallback={<ConnectionSkeleton label="충성도와 기록" />}>
      {denied ? <><p role="status" className="mb-4 text-sm">이 메뉴를 열람할 권한이 없어 학생의 충성도를 표시합니다.</p><StudentOntologyPanel studentId={studentId} month={params.month} /></>
        : section === "ontology" ? <OntologyView searchParams={Promise.resolve(params)} />
        : section === "referrals" ? <ReferralView />
        : section === "settings" ? <SettingsView />
        : section === "list" ? <ListView />
        : <StudentOntologyPanel studentId={studentId} month={params.month} />}
    </Suspense>
  </StudentContributionScope>;
}
