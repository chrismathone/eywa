import { z } from "zod";
import type { KnowledgeGraph } from "@/features/management/model";
import type { MarketingInputRecord } from "./input-model";

export const channels = { flyer:"학교 앞 전단지", banner:"현수막", elevator:"엘리베이터 광고", delivery:"택배차 광고", seminar:"설명회·간담회", event:"학원 행사", blog:"블로그·콘텐츠", social:"SNS·온라인", referral:"소개", other:"기타·분류 필요" } as const;
export const seasons = { new_term:"신학기", summer:"여름방학", winter:"겨울방학", midterm:"중간고사", final:"기말고사", transition:"진학·예비학년", always:"상시·기타" } as const;
export const states = { review:"원본 확인 필요", planned:"예정", held:"진행 확인", cancelled:"취소", duplicate:"중복 제외" } as const;
export const objectives = { acquisition:"신규 모집", retention:"재원생 관계·유지", brand:"인지도" } as const;
const amount=z.number().int().min(0).max(1e12).nullable();
const safeUrl=z.url().refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password;},"https 원본 링크를 입력해 주세요");
export const sourceSchema=z.object({provider:z.enum(["notion","calendar","drive","manual","ecount"]),key:z.string().min(1).max(300),title:z.string().min(1).max(240),url:safeUrl,excerpt:z.string().max(3000),observedAt:z.iso.datetime()}).strict();
export const campaignSchema=z.object({title:z.string().trim().min(1).max(240),channel:z.enum(Object.keys(channels) as [keyof typeof channels,...(keyof typeof channels)[]]),objective:z.enum(["acquisition","retention","brand"]),start:z.iso.date(),end:z.iso.date(),precision:z.enum(["day","month"]),state:z.enum(["review","planned","held","cancelled","duplicate"]),season:z.enum(Object.keys(seasons) as [keyof typeof seasons,...(keyof typeof seasons)[]]),audience:z.string().trim().max(240),budget:amount,actualCost:amount,costBasis:z.string().max(1000),variableCost:amount,measurementClosed:z.boolean(),note:z.string().max(4000),sources:z.array(sourceSchema).max(30),duplicateOf:z.uuid().nullable()}).strict().superRefine((d,c)=>{
  if(d.start>d.end)c.addIssue({code:"custom",message:"행사 기간 순서를 확인해 주세요"});
  if(d.actualCost!==null&&!d.costBasis.trim())c.addIssue({code:"custom",message:"실제 비용의 원장·영수증·배부 근거가 필요합니다"});
  if(d.measurementClosed&&(d.state!=="held"||d.precision!=="day"||d.actualCost===null))c.addIssue({code:"custom",message:"진행일·실제 비용을 확인한 행사만 측정 마감할 수 있습니다"});
  if(d.state==="duplicate"&&!d.duplicateOf)c.addIssue({code:"custom",message:"중복 원본이 연결될 대표 행사를 선택해 주세요"});
  if(d.state!=="duplicate"&&d.duplicateOf)c.addIssue({code:"custom",message:"대표 행사는 중복 제외 상태에서만 지정합니다"});
  if(new Set(d.sources.map(s=>s.provider+":"+s.key)).size!==d.sources.length)c.addIssue({code:"custom",message:"동일한 원본이 중복되었습니다"});
});
export type CampaignDocument=z.infer<typeof campaignSchema>;
export type Campaign={id:string;origin_key:string;version:number;document:CampaignDocument;updated_at:string};
export const touchSchema=z.object({campaignId:z.uuid(),studentId:z.uuid().nullable(),consultationId:z.uuid().nullable(),date:z.iso.date(),kind:z.enum(["inquiry","invited","attended"]),basis:z.enum(["qr","self_report","staff_record"]),reference:z.string().trim().min(1).max(1000),verified:z.boolean(),active:z.boolean()}).strict().superRefine((d,c)=>{
  if(!d.studentId&&!d.consultationId)c.addIssue({code:"custom",message:"학생 또는 상담을 ID로 연결해 주세요"});
  if(d.kind==="inquiry"&&!d.consultationId)c.addIssue({code:"custom",message:"문의 접점에는 실제 입학상담 기록을 연결해 주세요"});
});
export type TouchDocument=z.infer<typeof touchSchema>;
export type Touch={id:string;version:number;document:TouchDocument;updated_at:string};
export type Person={id:string;name:string;school:string|null;grade:string|null;enrolledAt:string|null;firstClass:string|null};
export type Intake={id:string;studentId:string|null;name:string;date:string|null;path:string|null};
export type Bill={id:string;studentId:string;month:string;net:number;status:string};
export type AttributionModel="first"|"last"|"linear";
export const modelLabels:Record<AttributionModel,string>={first:"최초 접점",last:"최종 접점",linear:"접점 균등 배분"};
export type Allocation={campaignId:string;studentId:string;enrolledOn:string;weight:number;touchIds:string[];invoiceIds:string[];revenue:number|null;mature:boolean};
export type CampaignResult={id:string;contacts:number;inquiries:number;invited:number;attended:number;enrollments:number;uniqueEnrollments:number;revenue:number|null;cpe:number|null;roas:number|null;roi:number|null;ready:boolean;revenueReady:boolean;gaps:string[];allocations:Allocation[]};
export type MarketingData={today:string;observedAt:string;campaigns:Campaign[];touches:Touch[];people:Person[];intakes:Intake[];bills:Bill[];year:number;yearCoverage:{year:number;months:number;net:number}[];inputRecords?:MarketingInputRecord[];operations?:import("./operations-model").Operation[];workItems?:import("./operations-model").WorkItem[]};
export type MarketingGraph=KnowledgeGraph & {model:AttributionModel;lookbackDays:number;revenueWindow:string};
export function blankCampaign(today:string):CampaignDocument {return {title:"",channel:"other",objective:"acquisition",start:today,end:today,precision:"day",state:"planned",season:"always",audience:"",budget:null,actualCost:null,costBasis:"",variableCost:null,measurementClosed:false,note:"",sources:[],duplicateOf:null};}
