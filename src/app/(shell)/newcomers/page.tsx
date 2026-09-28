import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getNewcomers } from "@/features/newcomers/server/queries";
import { parseBoardFilters } from "@/features/newcomers/board-model";
import { NewcomerBoard } from "./_components/newcomer-board";

export const metadata = { title: "신규생 관리 — 에이와" };
export default async function NewcomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAccess("newcomers");
  const [view, canWrite, params] = await Promise.all([
    getNewcomers(), canWriteTenant(viewer.systemRole, "newcomers"), searchParams,
  ]);
  const initialFilters = parseBoardFilters({ get: (key) => typeof params[key] === "string" ? params[key] : null });
  return <NewcomerBoard view={view} canWrite={canWrite} initialFilters={initialFilters} />;
}
