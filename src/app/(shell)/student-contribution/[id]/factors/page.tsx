import { notFound, redirect } from "next/navigation";
import { getContributionGate } from "@/features/student-contribution/server/access";
import { getFactorWorkspace } from "@/features/student-contribution/server/factor-query";
import { FactorWorkspace } from "@/features/student-contribution/components/factor-workspace";
export const metadata={title:"42팩터 로열티 정밀분석 — 에이와"};
export const maxDuration=120;
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{month?:string}>}) {
  if(!(await getContributionGate()))redirect("/");
  const [{id},{month}]=await Promise.all([params,searchParams]);
  const data=await getFactorWorkspace(id,month);if(!data)notFound();
  return <FactorWorkspace key={`${id}-${data.month}`} data={data} />;
}
