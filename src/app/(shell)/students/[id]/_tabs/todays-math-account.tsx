import { SheetText } from "@/features/teacher-view/interface-label";
import { accountStateLabel, type StudentMathAccount } from "@/features/integrations/todays-math/student-status";

const kst = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });

// 오늘 수학 학생 로그인 계정 — 발급은 오늘 수학에서 원장님이 한다. 여기는 보기만.
export function TodaysMathAccountCard({ account }: { account: StudentMathAccount | null }) {
  const note = !account ? <SheetText value={"오늘 수학에서 발급해요"} />
    : account.lastLoginAt ? <><SheetText value={"마지막 로그인 "} />{kst.format(new Date(account.lastLoginAt))}</>
    : <SheetText value={"아직 로그인 전이에요"} />;
  return <div className="bg-card border-line rounded-xl border p-4">
    <dt className="text-text-dim text-sm"><SheetText value={"학생 계정"} /></dt>
    <dd className="mt-2 text-lg font-semibold"><SheetText value={accountStateLabel(account)} /></dd>
    <dd className="text-text-dim mt-1 text-xs">{note}</dd>
  </div>;
}
