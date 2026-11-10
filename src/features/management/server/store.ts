import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountingSchema, accountingTotals } from "../model";
import { managementAccess } from "./access";
import { ManagementInputError } from "../errors";
import { logDbError } from "@/lib/supabase/db-error";

export async function saveAccounting(input:unknown,expectedVersion:number) {
  const user=await managementAccess(true);
  const report=accountingSchema.parse(input);
  if(report.complete&&!accountingTotals(report).ready)throw new ManagementInputError("대사가 맞지 않는 자료는 검토 대기 상태로 저장해 주세요");
  const result=await createAdminClient().rpc("save_management_accounting",{
    p_tenant:user.tenantId,p_actor:user.id,p_document:report,p_expected_version:expectedVersion,
  });
  if(result.error){if(result.error.message.includes("version_conflict"))throw new ManagementInputError("다른 사용자가 같은 기간을 수정했습니다. 새로고침 후 확인해 주세요");logDbError(result.error,"management.save_accounting");throw new ManagementInputError("손익 자료를 저장하지 못했습니다");}
  return result.data;
}
