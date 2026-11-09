import { z } from "zod";
import type { Campaign, CampaignDocument } from "./model";
import { annualPlanningSchema, type AnnualReference } from "./annual-planning-model";

export const operationTemplates = {
  seminar: { label: "설명회", version: 1, tasks: [
    [-35,"기획","대상·주제·목표 및 연사 확정"],[-28,"준비","기획안·포스터·신청 안내 제작"],
    [-21,"준비","운영 방향·장소·신청 동선 점검"],[-14,"홍보","블로그·SNS·학교·아파트 홍보 집행"],
    [-14,"초대","1차 안내·담임 초대·전화상담"],[-14,"준비","1차 리허설"],
    [-7,"준비","자료집·설문·선물·체크리스트 준비"],[-7,"초대","2차 초대·신청 확인"],
    [-7,"준비","2차 리허설"],[-3,"초대","최종 참석 안내"],[-1,"준비","현수막·자료·좌석·다과 최종 점검"],
    [0,"현장","접수·참석 확인·현장 운영"],[1,"후속","상담 연결·설문·후기 정리"],[7,"회고","비용 대사·성과 검토·다음 행사 개선"]
  ] },
  flyer: { label: "전단 배부", version: 1, tasks: [
    [-21,"기획","대상 학교·아파트·목적·배부일 확정"],[-21,"준비","문안·사은품·QR 신청 경로 기획"],
    [-14,"준비","전단 디자인 확정·인쇄 주문"],[-7,"홍보","온라인 안내·신청 경로 점검"],
    [-7,"준비","인쇄물 검수·접기·포장"],[-3,"배정","학교별 강사·아르바이트 동선 배정"],
    [-1,"준비","운반·물량·준비물 최종 확인"],[0,"현장","배부·실제 물량·현장 사진 기록"],
    [7,"후속","문의 연결·실제 비용·회고 기록"]
  ] },
  custom: { label: "직접 기획", version: 1, tasks: [[-7,"기획","기획·담당자·준비 사항 확정"],[0,"현장","실행 결과 기록"],[7,"회고","성과 검토·개선 사항 기록"]] }
} as const;
export type TemplateKey = keyof typeof operationTemplates;
export const operationSchema = z.object({
  annualPlanning: annualPlanningSchema.optional(),
  template: z.enum(["seminar","flyer","custom"]), ownerId: z.uuid(),
  location: z.string().trim().max(240), brief: z.string().trim().max(4000),
  targetAttendees: z.number().int().min(0).max(100000).nullable(),
  targetEnrollments: z.number().int().min(0).max(100000).nullable(),
  retrospective: z.string().max(4000), nextAction: z.string().max(2000),
  resources: z.array(z.object({title:z.string().trim().min(1).max(200),url:z.url().refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password;})}).strict()).max(20)
}).strict();
export type OperationDocument=z.infer<typeof operationSchema>;
export type Operation={campaign_id:string;document:OperationDocument;version:number;template_version:number};
export const taskDocumentSchema=z.object({title:z.string().trim().min(2).max(240),phase:z.string().trim().min(1).max(40),due:z.iso.date(),offset:z.number().int().min(-366).max(366).nullable(),assigneeId:z.uuid().nullable(),status:z.enum(["open","done","cancelled"]),result:z.string().max(2000),evidenceUrl:z.union([z.literal(""),z.url().refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password;})])}).strict().refine(d=>d.status!=="done"||d.result.trim().length>=2,"완료한 결과를 두 글자 이상 남겨 주세요");
export type WorkItem={id:string;campaign_id:string;version:number;document:z.infer<typeof taskDocumentSchema>};
const planSchema=z.object({title:z.string().trim().min(1).max(240),start:z.iso.date(),end:z.iso.date(),channel:z.string(),objective:z.string(),season:z.string(),audience:z.string().max(240),budget:z.number().int().min(0).max(1e12).nullable(),actualCost:z.number().int().min(0).max(1e12).nullable(),costBasis:z.string().max(1000),state:z.enum(["planned","held","cancelled"])}).strict();
export const operationRequestSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("plan"),requestId:z.uuid(),id:z.uuid(),expectedVersion:z.number().int().min(0),expectedOperationVersion:z.number().int().min(0),plan:planSchema,operation:operationSchema}).strict(),
  z.object({action:z.literal("task"),requestId:z.uuid(),id:z.uuid(),campaignId:z.uuid(),expectedVersion:z.number().int().min(0),document:taskDocumentSchema}).strict()
]);
export type OperationRequest=z.infer<typeof operationRequestSchema>;
export function offsetDate(date:string,offset:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function nextYearDate(date:string){const [year,month,day]=date.split("-").map(Number);const last=new Date(Date.UTC(year+1,month,0)).getUTCDate();return `${year+1}-${String(month).padStart(2,"0")}-${String(Math.min(day,last)).padStart(2,"0")}`;}
export function instantiateTasks(template:TemplateKey,start:string,ownerId:string){return operationTemplates[template].tasks.map(([offset,phase,title])=>({title,phase,due:offsetDate(start,offset),offset,assigneeId:ownerId,status:"open" as const,result:"",evidenceUrl:""}));}
export function blankOperation(ownerId:string,template:TemplateKey="seminar"):OperationDocument{return {template,ownerId,location:"",brief:"",targetAttendees:null,targetEnrollments:null,retrospective:"",nextAction:"",resources:[]};}
/** New cycles carry plans, never observations or previous completion evidence. */
export function copyPlan(c:CampaignDocument,o:OperationDocument,date:string){
  const duration=Math.round((Date.parse(c.end)-Date.parse(c.start))/86400000);
  const operation={...o,retrospective:"",nextAction:"",resources:[]};delete operation.annualPlanning;
  return {plan:{title:c.title,start:date,end:offsetDate(date,duration),channel:c.channel,objective:c.objective,season:c.season,audience:c.audience,budget:c.budget,actualCost:null,costBasis:"",state:"planned" as const},operation};
}
export type OperationSummary=Pick<Campaign,"id"|"version"|"updated_at"> & {document:Pick<CampaignDocument,"title"|"start"|"end"|"channel"|"state"|"audience">;adopted:boolean};
export type OperationsData={today:string;actorId:string;canPlan:boolean;canWork:boolean;canAnalyze:boolean;canEditCost:boolean;annualReferences:AnnualReference[];campaigns:OperationSummary[];tasks:WorkItem[];staff:{id:string;name:string}[];selected:{campaign:Campaign;operation:Operation|null;tasks:WorkItem[];inputs:import("./input-model").MarketingInputRecord[];touches:import("./model").Touch[];people:{id:string;type:"student"|"consultation";name:string;detail:string}[];canRecordStudents:boolean;canRecordIntakes:boolean}|null};
