import { redirect } from "next/navigation";
import { getLoyaltyRanking } from "@/features/student-contribution/server/ranking-query";
import { LoyaltyRanking } from "@/features/student-contribution/components/loyalty-ranking";
export const metadata = { title: "학생 로열티 랭킹 — 에이와" };
export const maxDuration = 120;
export default async function RankingPage() {
  const data = await getLoyaltyRanking();
  if (!data) redirect("/");
  return <LoyaltyRanking data={data} />;
}
