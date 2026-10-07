import type { ReactNode } from "react";
import { ModuleBoundary } from "@/components/module-boundary";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { EnglishNameProvider } from "@/features/class-sheets/components/english-name-context";

export default async function EcsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const enabled = !!user && await canWriteTenant(user.systemRole, "student_english_name");
  return <ModuleBoundary id="ecs"><EnglishNameProvider enabled={enabled}>{children}</EnglishNameProvider></ModuleBoundary>;
}
