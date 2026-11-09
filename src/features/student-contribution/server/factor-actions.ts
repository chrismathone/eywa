"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContributionWrite } from "./access";
import { getLiveContext } from "./live-context";
import { FACTORS, FACTOR_MODEL, validMonth, validateValue } from "../model/factors";

export async function saveContributionFactor(input:{studentId:string;month:string;factorId:string;value:unknown;state:string;evidence:string;version:number}) {
  const gate=await requireContributionWrite();
  const c=await getLiveContext(input.studentId);
  if(!c||c.tenant!==gate.tenantId)return {ok:false,message:"학생 기록에 접근할 수 없습니다."};
  const factor=FACTORS.find(f=>f.id===input.factorId);
  if(!factor||!validMonth(input.month)||input.month>c.today.slice(0,7)||!Number.isSafeInteger(input.version)||input.version<0||input.version>100000)
    return {ok:false,message:"학생·조회 월·항목을 확인해 주세요."};
  if(!["measured","na","reset"].includes(input.state)||typeof input.evidence!=="string"||input.evidence.trim().length<3||input.evidence.length>2000)
    return {ok:false,message:"상태와 3~2,000자의 확인 근거를 입력해 주세요."};
  if(input.state==="measured"&&!validateValue(factor,input.value))return {ok:false,message:"값의 단위와 허용 범위를 확인해 주세요."};
  const {error}=await createAdminClient().from("student_contribution_factor_records").insert({
    tenant_id:gate.tenantId,student_id:input.studentId,month:input.month,factor_id:factor.id,
    value:input.state==="measured"?input.value:null,state:input.state,evidence:input.evidence.trim(),version:input.version+1,actor_id:gate.userId,model_version:FACTOR_MODEL,
  });
  if(error)return {ok:false,message:error.code==="23505"||error.code==="P0001"?"다른 기록이 먼저 저장되었거나 학생 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.":"저장하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요."};
  revalidatePath(`/student-contribution/${input.studentId}/factors`);
  return {ok:true,message:"확인 근거와 변경 이력을 저장했습니다."};
}
