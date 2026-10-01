import "server-only";

import { notFound } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canManageParentAccountsRole } from "../parent-access";

/** 지금 사용자가 학부모 계정을 다룰 수 있으면 그 사용자, 아니면 null. 판정 = `canManageParentAccountsRole`. */
export async function parentAccountsActor(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const isSuperAdmin = await isCurrentUserSuperAdmin();
  return canManageParentAccountsRole(user.systemRole, isSuperAdmin) ? user : null;
}

/** 화면 게이트 — 자격이 없으면 404(있는 화면인지조차 알리지 않는다). */
export async function requireParentAccountsAccess(): Promise<CurrentUser> {
  const user = await parentAccountsActor();
  if (!user) notFound();
  return user;
}
