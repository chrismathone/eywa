import { z } from "zod";
import { blankCampaign, type CampaignDocument } from "./model";

export const annualDecisions = { repeat: "재진행", improve: "개선하여 진행", new: "새로 기획" } as const;
export const annualPlanningSchema = z.object({
  targetYear: z.number().int().min(2024).max(2099),
  referenceIds: z.array(z.uuid()).max(12),
  decision: z.enum(["repeat", "improve", "new"]),
  reason: z.string().trim().min(2, "기획·변경 이유를 두 글자 이상 남겨 주세요").max(1500),
  considerations: z.string().trim().max(2000),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.referenceIds).size !== p.referenceIds.length) ctx.addIssue({code:"custom",message:"같은 참고 행사를 중복 선택할 수 없습니다"});
  if (p.decision !== "new" && !p.referenceIds.length) ctx.addIssue({code:"custom",message:"재진행·개선의 근거가 되는 과거 행사를 선택해 주세요"});
});
export type AnnualPlanning = z.infer<typeof annualPlanningSchema>;
export type AnnualReference = {
  id: string;
  document: Pick<CampaignDocument,"title"|"start"|"end"|"channel"|"state"|"audience"|"objective"|"season"|"budget"|"actualCost">;
  retrospective: string; nextAction: string; planning: AnnualPlanning|null;
};
export type AnnualMetric = {id:string; enrollments:number|null; revenue:number|null; cpe:number|null; roi:number|null; gaps:string[]};
export function referenceYears(year:number) { return [year-3,year-2,year-1]; }
export function dateInYear(date:string,year:number) {
  const [,month,day]=date.split("-").map(Number);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return `${year}-${String(month).padStart(2,"0")}-${String(Math.min(day,last)).padStart(2,"0")}`;
}
/** Reuse only plan fields. Historic evidence stays on the source campaign. */
export function draftFromReference(source:AnnualReference,year:number):CampaignDocument {
  const d=source.document,start=dateInYear(d.start,year);
  const end=new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate()+Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000));
  return {...blankCampaign(start),title:d.title,channel:d.channel,objective:d.objective,season:d.season,audience:d.audience,end:end.toISOString().slice(0,10)};
}
/** Rows must have already been scoped by the server to the current tenant. */
export function validateAnnualReferences(planning:AnnualPlanning,start:string,id:string,rows:{id:string;document:{start:string;state:string}}[]) {
  if(Number(start.slice(0,4))!==planning.targetYear)throw Error("기획 연도와 행사 시작 연도가 다릅니다");
  const years=referenceYears(planning.targetYear);
  if(planning.referenceIds.some(ref=>ref===id||!rows.some(r=>r.id===ref&&r.document.state!=="duplicate"&&years.includes(Number(r.document.start.slice(0,4))))))throw Error("같은 학원의 직전 3개년 행사만 참고할 수 있습니다. 원본을 다시 확인해 주세요");
}
