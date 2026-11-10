import { blueprint } from "./blueprint";
/** Explicit business meaning; never infer a workbook column from its position. */
export const auditSources = [
  {table:"students",sheet:"10_학생",select:"id,name,grade,enrolled_at,makeedu_id,notes,is_test",scope:"전체 학생 · 병합·검증용 제외 · 원본ID는 MakeEdu ID 기준",map:{"학생ID":"id","학생명":"name","학년":"grade","등록일":"enrolled_at","원본ID":"makeedu_id"}},
  {table:"classes",sheet:"12_강좌",select:"id,class_name,subject,teacher_id,is_active",scope:"현재 활성 강좌",map:{"강좌명":"class_name","과목":"subject","담임ID":"teacher_id"}},
  {table:"users",sheet:"11_직원",select:"id,display_name,job_title,department,hire_date,status,system_role",scope:"현재 활성 직원",map:{"성명":"display_name","직책":"job_title","소속팀":"department","입사일":"hire_date"}},
] as const;
export function auditFieldKey(sheet:string,label:string) {
  const field=blueprint.find(s=>s.id===sheet)?.fields.find(f=>f.label===label);
  if(!field)throw Error("정의 사전의 검사 항목을 확인해 주세요");
  return `field:${sheet}:${field.id}`;
}
