import "server-only";
import {ManagementInputError} from "../errors";
import {createAdminClient} from "@/lib/supabase/admin";
import {fetchAllPaged} from "@/lib/supabase/batch";
import {kstToday} from "@/lib/date-kst";
import {managementAccess} from "./access";
import {parseMakeeduExport,compareMakeeduExport,makeeduStudentFields,makeeduInvoiceFields,sha256,type MakeeduStudent,type MakeeduInvoice} from "../makeedu-export";
import {parseEcountMonthly,compareEcountMonthly} from "../ecount-monthly";
import {accountingSchema,monthSchema,type StoredReport} from "../model";
import {sourceEvidenceSchema,type SourceEvidence} from "../reviews";
import {logDbError} from "@/lib/supabase/db-error";

export function collectionPlanHash(evidence:SourceEvidence[]){return sha256(JSON.stringify(evidence.map(e=>({source:e.source,month:e.month,sourceHash:e.sourceHash,comparedHash:e.comparedHash})).sort((a,b)=>a.month.localeCompare(b.month))));}
export async function previewCollection(source:"makeedu"|"ecount",month:string,bytes:Buffer,sourceName:string){
  return previewCollectionFor(await managementAccess(true),source,month,bytes,sourceName);
}
/** Server-only entry; caller must validate the owner or a scoped collection device. */
export async function previewCollectionFor(user:{id:string;tenantId:string},source:"makeedu"|"ecount",month:string,bytes:Buffer,sourceName:string){
  const db=createAdminClient();monthSchema.parse(month);
  if(month>kstToday().slice(0,7))throw new ManagementInputError("미래 월의 수납 자료는 아직 비교하지 않습니다");
  let evidence:SourceEvidence[];
  if(source==="makeedu"){
    const parsed=await parseMakeeduExport(bytes);
    const [students,invoices,proofs]=await Promise.all([
      fetchAllPaged<MakeeduStudent>((f,t)=>db.from("students").select(makeeduStudentFields).eq("tenant_id",user.tenantId).order("id").range(f,t)),
      fetchAllPaged<MakeeduInvoice>((f,t)=>db.from("invoices").select(makeeduInvoiceFields).eq("tenant_id",user.tenantId).eq("period",month).order("id").range(f,t)),
      db.from("management_source_batches").select("evidence").eq("tenant_id",user.tenantId).eq("source","makeedu").eq("month",month).eq("source_hash",parsed.sourceHash).order("created_at",{ascending:false}).limit(100),
    ]);
    if(proofs.error){logDbError(proofs.error,"management.collection_proofs");throw new ManagementInputError("기존 학생 식별 근거를 읽지 못했습니다");}
    const verified=(proofs.data??[]).flatMap(p=>sourceEvidenceSchema.parse(p.evidence).verifiedIdentities??[]);
    evidence=[compareMakeeduExport(parsed,month,sourceName,students,invoices,verified)];
  }else{
    const parsed=await parseEcountMonthly(bytes);
    const result=await db.from("management_accounting_reports").select("id,version,document,updated_at").eq("tenant_id",user.tenantId).in("period_start",parsed.documents.map(d=>`${d.month}-01`));
    if(result.error){logDbError(result.error,"management.collection_ledgers");throw new ManagementInputError("저장된 월별 원장을 읽지 못했습니다");}
    const reports:StoredReport[]=(result.data??[]).map(r=>({...r,document:accountingSchema.parse(r.document)}));
    evidence=parsed.documents.map(p=>{const ledger=reports.find(r=>r.document.sourceKind==="ledger"&&r.document.start===`${p.month}-01`);if(!ledger)throw new ManagementInputError(`${p.month}: 계정별원장 CSV를 회계 영역에서 먼저 검토·저장해 주세요`);return compareEcountMonthly(p,ledger,sourceName,parsed.sourceHash);});
  }
  const prior=await db.from("management_source_batches").select("source,month,source_hash,compared_hash").eq("tenant_id",user.tenantId).eq("source",source).in("compared_hash",evidence.map(e=>e.comparedHash));
  if(prior.error){logDbError(prior.error,"management.collection_prior");throw new ManagementInputError("기존 수집 이력을 확인하지 못했습니다");}
  const alreadyRecorded=evidence.filter(e=>(prior.data??[]).some(p=>p.month===e.month&&p.source_hash===e.sourceHash&&p.compared_hash===e.comparedHash)).map(e=>e.month);
  return {evidence,planHash:collectionPlanHash(evidence),alreadyRecorded};
}
