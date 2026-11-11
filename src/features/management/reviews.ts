import {z} from "zod";
import {reportedFinancialsSchema} from "./reported-financials";

export const reviewStatuses=["open","reviewing","waiting","recheck"] as const;
export const reviewLabels:Record<typeof reviewStatuses[number],string>={open:"미확인",reviewing:"확인 중",waiting:"자료 대기",recheck:"조치 후 재검산 필요"};
const month=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const sourceIdentitySchema=z.object({sourceRow:z.number().int().min(2).max(20000),rowHash:hash,studentId:z.uuid(),makeeduId:z.string().regex(/^\d{1,30}$/),reference:z.string().min(1).max(300)}).strict();
export type SourceIdentity=z.infer<typeof sourceIdentitySchema>;
export const sourceEvidenceSchema=z.object({
  source:z.enum(["ecount","makeedu"]),month,sourceName:z.string().min(1).max(200),sourceHash:hash,
  comparedHash:hash,observedAt:z.iso.datetime(),summary:z.string().min(1).max(500),
  reportedFinancials:reportedFinancialsSchema.optional(),
  verifiedIdentities:z.array(sourceIdentitySchema).max(500).optional(),
  facts:z.array(z.object({label:z.string().max(120),sourceValue:z.number().finite().nullable(),aywaValue:z.number().finite().nullable(),unit:z.enum(["원","명","건"]),reference:z.string().max(200)}).strict()).max(30),
  issues:z.array(z.object({key:z.string().regex(/^[a-z0-9_-]{1,80}$/),title:z.string().min(1).max(120),detail:z.string().min(1).max(1000),nextAction:z.string().min(1).max(600),href:z.string().regex(/^\/(?:students\/[a-f0-9-]{36}|billing(?:\/stats)?(?:\?period=20\d{2}-\d{2})?|dashboard\/management#accounting)$/).optional()}).strict()).max(30),
}).strict().refine(v=>new Set(v.issues.map(i=>i.key)).size===v.issues.length,"중복 확인 항목").refine(v=>!v.reportedFinancials||v.source==="ecount","회계 근거는 ECOUNT 자료에만 저장합니다").refine(v=>!v.verifiedIdentities||v.source==="makeedu","학생 식별 근거의 소스를 확인해 주세요");
export type SourceEvidence=z.infer<typeof sourceEvidenceSchema>;
export const reviewUpdateSchema=z.object({batchId:z.uuid(),issueKey:z.string().regex(/^[a-z0-9_-]{1,80}$/),expectedVersion:z.number().int().nonnegative(),status:z.enum(reviewStatuses),owner:z.string().trim().max(80),dueDate:z.iso.date().nullable(),note:z.string().trim().min(1).max(2000)}).strict();
export type ReviewUpdate=z.infer<typeof reviewUpdateSchema>;
export type ReviewEvent={batch_id:string;issue_key:string;version:number;status:ReviewUpdate["status"];owner:string;due_date:string|null;note:string;created_at:string};
export type ReviewBatch={id:string;source:string;month:string;evidence:SourceEvidence;created_at:string;events:ReviewEvent[]};
export function latestReview(events:ReviewEvent[],key:string){return events.filter(e=>e.issue_key===key).reduce<ReviewEvent|undefined>((a,e)=>!a||e.version>a.version?e:a,undefined);}
