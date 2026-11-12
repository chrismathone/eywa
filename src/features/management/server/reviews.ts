import "server-only";
import {ManagementInputError} from "../errors";
import {createAdminClient} from "@/lib/supabase/admin";
import {fetchAllPaged} from "@/lib/supabase/batch";
import {managementAccess} from "./access";
import {sourceEvidenceSchema,reviewUpdateSchema,type ReviewBatch,type ReviewEvent,type SourceEvidence} from "../reviews";
import {logDbError} from "@/lib/supabase/db-error";

export async function loadSourceReviews(month:string):Promise<ReviewBatch[]>{
  const user=await managementAccess(),db=createAdminClient();
  const {data,error}=await db.from("management_source_batches").select("id,source,month,evidence,created_at").eq("tenant_id",user.tenantId).eq("month",month).order("created_at",{ascending:false}).limit(100);
  if(error){logDbError(error,"management.load_reviews");throw new ManagementInputError("원본 대사 기록을 불러오지 못했습니다");}
  const batches=(data??[]).map(b=>({...b,evidence:sourceEvidenceSchema.parse(b.evidence)}));
  if(!batches.length)return [];
  const events=await fetchAllPaged<ReviewEvent>((f,t)=>db.from("management_review_events").select("batch_id,issue_key,version,status,owner,due_date,note,created_at").eq("tenant_id",user.tenantId).in("batch_id",batches.map(b=>b.id)).order("created_at").order("batch_id").order("issue_key").order("version").range(f,t));
  return batches.map(b=>({...b,events:events.filter(e=>e.batch_id===b.id)}));
}
export async function saveSourceEvidenceBatch(inputs:SourceEvidence[]){
  return saveSourceEvidenceBatchFor(await managementAccess(true),inputs);
}
/** Server-only; context comes from a verified owner/device, never request JSON. */
export async function saveSourceEvidenceBatchFor(user:{id:string;tenantId:string},inputs:SourceEvidence[]){
  const db=createAdminClient();
  if(!inputs.length||inputs.length>60)throw new ManagementInputError("한 번에 1~60개월 자료를 처리해 주세요");
  const values=inputs.map(input=>{const e=sourceEvidenceSchema.parse(input);return {tenant_id:user.tenantId,source:e.source,month:e.month,source_hash:e.sourceHash,compared_hash:e.comparedHash,evidence:e,created_by:user.id};});
  const result=await db.from("management_source_batches").upsert(values,{onConflict:"tenant_id,source,month,source_hash,compared_hash",ignoreDuplicates:true}).select("id");
  if(result.error){logDbError(result.error,"management.save_evidence");throw new ManagementInputError("수집 결과를 저장하지 못했습니다. 같은 파일로 다시 시도할 수 있습니다");}
  return {inserted:result.data.length,duplicates:values.length-result.data.length};
}
export async function appendReview(input:unknown){
  const user=await managementAccess(true),v=reviewUpdateSchema.parse(input);
  const {data,error}=await createAdminClient().rpc("append_management_review",{p_tenant:user.tenantId,p_actor:user.id,p_batch:v.batchId,p_issue:v.issueKey,p_expected:v.expectedVersion,p_status:v.status,p_owner:v.owner,p_due:v.dueDate,p_note:v.note});
  if(error){if(error.message.includes("version_conflict"))throw new ManagementInputError("다른 사용자가 먼저 기록했습니다. 새로고침 후 확인해 주세요");if(error.message.includes("review_issue_not_found"))throw new ManagementInputError("확인 항목을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요");logDbError(error,"management.append_review");throw new ManagementInputError("확인 기록을 저장하지 못했습니다");}return data as number;
}
