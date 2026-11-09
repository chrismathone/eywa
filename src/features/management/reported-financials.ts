import {z} from "zod";
import type {ReviewBatch} from "./reviews";

const amount=z.number().int().min(-1e12).max(1e12);
export const reportedFinancialsSchema=z.object({
  basis:z.literal("ecount_report"),company:z.string().min(1).max(160),
  closedThrough:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),confirmedAt:z.iso.datetime(),
  scopeNote:z.string().min(1).max(500),reference:z.string().min(1).max(200),
  revenue:amount,cost:amount,profit:amount,ledgerRevenue:amount,ledgerCost:amount,
  nonOperatingIncome:amount,nonOperatingCost:amount,profitBeforeTax:amount,
  labor:z.object({management:amount,partTime:amount,instructors:amount,executives:amount,bonus:amount,retirement:amount,insurance:amount,welfare:amount}).strict(),
  vehicleInstallments:amount,vehicleKind:z.literal("purchase_principal_and_interest"),
  adjustmentStatus:z.literal("pending"),costAccountCount:z.number().int().positive().max(500),costAccountHash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((v,ctx)=>{
  if(v.revenue-v.cost!==v.profit||v.profit+v.nonOperatingIncome-v.nonOperatingCost!==v.profitBeforeTax)
    ctx.addIssue({code:"custom",message:"보고서 손익 산식이 맞지 않습니다"});
  if(v.revenue!==v.ledgerRevenue||v.cost!==v.ledgerCost)
    ctx.addIssue({code:"custom",message:"보고서 분류 기준 원장 대사가 맞지 않습니다"});
});
export type ReportedFinancials=z.infer<typeof reportedFinancialsSchema>;
export const laborLabels:Record<keyof ReportedFinancials["labor"],string>={management:"경영팀 급여",partTime:"아르바이트 급여",instructors:"강사 급여",executives:"임원 급여",bonus:"상여금",retirement:"퇴직급여",insurance:"4대 보험료",welfare:"복리후생비"};

/** Only the latest comparison can support metrics; never fall back to superseded evidence. */
export function reportedFinancialView(batches:ReviewBatch[],month:string){
  const batch=batches.filter(b=>b.source==="ecount"&&b.month===month).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0];
  const f=batch?.evidence.reportedFinancials;
  if(!batch||!f)return null;
  const labor=Object.values(f.labor).reduce((a,b)=>a+b,0),closed=month<=f.closedThrough;
  return {batchId:batch.id,month,financials:f,labor,closed,
    margin:closed&&f.revenue>0?f.profit/f.revenue*100:null,
    laborRatio:closed&&f.revenue>0?labor/f.revenue*100:null,
    managementReady:false as const};
}
