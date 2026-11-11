import { requireSampleViewer } from "@/features/organization-okr/sample-access";
import { sampleOkrWorkspace } from "@/features/organization-okr/sample-data";
import { OkrWorkspace } from "@/features/organization-okr/workspace";

export const metadata = { title: "조직·OKR — 에이와" };

/** 조직·OKR 시안 — 🔴 DB를 읽지 않는다(예시 값). 저장은 안내만 띄운다. */
export default async function Page({ searchParams }: { searchParams: Promise<{ goal?: string }> }) {
  await requireSampleViewer();
  return <OkrWorkspace data={sampleOkrWorkspace()} selectedId={(await searchParams).goal}/>;
}
