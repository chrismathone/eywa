import { NextResponse } from "next/server";
import { loadTeacherHub,TeacherHubError } from "@/features/teacher-hub/server";
export const maxDuration=120;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;const data=await loadTeacherHub({teacherId:id,month:new URL(request.url).searchParams.get("month")??undefined});if(!data)return NextResponse.json({error:"강사 자료 없음"},{status:404});return NextResponse.json(data.graph,{headers:{"Cache-Control":"private, no-store","Content-Disposition":`attachment; filename="teacher-graph-${data.month}.json"`}});}
  catch(e){return NextResponse.json({error:e instanceof TeacherHubError?e.message:"강사 자료를 불러오지 못했습니다"},{status:e instanceof TeacherHubError?e.status:503,headers:{"Cache-Control":"private, no-store"}});}
}
