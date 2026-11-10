import { notFound, unstable_rethrow } from "next/navigation";
import { loadArchive } from "@/features/marketing-archive/server";
import { ArchiveWorkspace } from "@/features/marketing-archive/workspace";
export const metadata={title:"홍보·마케팅 행사 아카이브 — 에이와"};
export const dynamic="force-dynamic";
export default async function Page(){
  let data;try{data=await loadArchive();}catch(e){unstable_rethrow(e);notFound();}
  return <ArchiveWorkspace data={data}/>;
}
