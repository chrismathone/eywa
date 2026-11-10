import { notFound } from "next/navigation";
import { Harness } from "./harness";

// 샘플 전용 경로. 운영 빌드에서는 열리지 않는다.
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  return <Harness mode={sp.mode ?? "editor"} />;
}
