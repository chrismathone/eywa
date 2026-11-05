import { requireAccess } from "@/lib/auth/require-access";
import { ExploreLanding } from "@/features/explore/components/explore-landing";

export const metadata = { title: "연결 탐색 — 에이와" };

/** 연결 탐색 첫 화면 — 중심을 아직 안 골랐을 때(검색으로 시작). 중심이 있으면 `/explore/<종류>/<id>`. */
export default async function ExploreLandingPage() {
  await requireAccess("students");
  return <ExploreLanding />;
}
