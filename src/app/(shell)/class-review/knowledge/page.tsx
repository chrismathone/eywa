import { notFound } from "next/navigation";
import { loadTeacherHub,TeacherHubError } from "@/features/teacher-hub/server";
import { TeacherHubWorkspace } from "@/features/teacher-hub/workspace";
export const metadata={title:"강사 지식그래프 — 에이와"};
export const maxDuration=120;
export default async function Page({searchParams}:{searchParams:Promise<{teacher?:string;month?:string}>}){
  const sp=await searchParams;
  let data;
  try{data=await loadTeacherHub({teacherId:sp.teacher,month:sp.month});}
  catch(e){if(e instanceof TeacherHubError&&[403,404].includes(e.status))notFound();throw e;}
  return data?<TeacherHubWorkspace key={`${data.teacher.id}:${data.month}`} data={data}/>:<div className="p-8">연결할 강사 자료가 없습니다.</div>;
}
