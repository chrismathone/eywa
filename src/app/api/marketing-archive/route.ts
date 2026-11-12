import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { findArchiveStudents, saveArchive } from "@/features/marketing-archive/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try{return NextResponse.json({students:await findArchiveStudents(new URL(request.url).searchParams.get("q")??"")});}
  catch(e){unstable_rethrow(e);return NextResponse.json({error:"원생 검색 권한 또는 입력을 확인해 주세요"},{status:403});}
}
export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"요청 출처를 확인해 주세요"},{status:403});
  if(Number(request.headers.get("content-length")??0)>50000)return NextResponse.json({error:"입력 내용이 너무 큽니다"},{status:413});
  try{return NextResponse.json({record:await saveArchive(await request.json())});}
  catch(e){unstable_rethrow(e);return NextResponse.json({error:e instanceof Error?e.message:"저장하지 못했습니다"},{status:400});}
}
