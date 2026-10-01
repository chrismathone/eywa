import { notFound } from "next/navigation";
import { Harness } from "./harness";

// ⚠️ 임시 검증 하네스 — 커밋하지 않는다.
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string; role?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  return <Harness mode={sp.mode ?? "editor"} role={sp.role ?? "desk"} />;
}
