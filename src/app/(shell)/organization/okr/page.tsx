import { requireOkrViewer } from "@/features/organization-okr/access";
import { loadOkrWorkspace } from "@/features/organization-okr/server";
import { OkrWorkspace } from "@/features/organization-okr/workspace";

export const metadata = { title: "조직·OKR — 에이와" };

/** 조직·OKR — 문 = '조직·OKR' 권한(okr · 기본값 원장만). 기록 = organization_okr(s2_0050) · 저장은 /api/organization/okr. */
export default async function Page({ searchParams }: { searchParams: Promise<{ goal?: string }> }) {
  await requireOkrViewer();
  const [data, params] = await Promise.all([loadOkrWorkspace().catch((e) => { console.error("[organization-okr] load", e); return null; }), searchParams]);
  if (!data) return <section className="p-8"><h1>조직·OKR</h1><p>목표 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요. 열람·아르바이트 계정은 목표를 쓰지 않습니다.</p></section>;
  return <OkrWorkspace data={data} selectedId={params.goal}/>;
}
