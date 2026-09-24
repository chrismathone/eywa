import { redirect } from "next/navigation";
import { UnavailableFeatureContent } from "@/components/unavailable-feature-content";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MODULE_IDS, type ModuleId } from "@/lib/modules";

export const metadata = { title: "쓰지 않는 기능 — aywa" };

/**
 * 꺼진 기능(모듈)의 주소로 들어왔을 때의 안내 — 말없이 대시보드로 보내지 않는다(2026-09-22 빈 지점 점검:
 * 주소를 치면 운영실이 뜨는데 이유를 모른다). `requireAccess`가 거부 이유가 "모듈 꺼짐"일 때만 여기로 보낸다.
 * 침산은 꺼진 모듈이 없어 이 화면에 올 일이 없다.
 */
export default async function UnavailableFeaturePage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { feature } = await searchParams;
  const id = (MODULE_IDS as readonly string[]).includes(feature ?? "") ? (feature as ModuleId) : null;
  return <UnavailableFeatureContent id={id} />;
}
