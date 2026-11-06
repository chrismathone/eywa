import { notFound } from "next/navigation";
import { Harness } from "./harness";

// 샘플 전용 경로(연결 탐색 네트워크 보기). 운영 빌드에서는 열리지 않는다.
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { c } = await searchParams;
  return <Harness initial={c ?? "student:s1"} />;
}
