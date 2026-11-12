import "server-only";

import { notFound } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canOpenShuttleAdmin } from "../../admin-access";

/**
 * 지금 사용자가 학부모 계정을 다룰 수 있으면 그 사용자, 아니면 null. 판정 = `canOpenShuttleAdmin`(셔틀 권한 + '셔틀 관리자 화면' 권한 · 운영 계정 —
 * 원장 2026-11-10 결정 · 기본 원장·관리자 · 전에는 코드의 역할 비교였다). 원장·관리자 칸만 바꿀 수 있어 학부모 계정 DB 정책(0320a)과 어긋나지 않는다.
 * 🔑 역할은 **화면 주인** — 강사뷰(다른 강사 뷰)면 검증된 대상의 역할이다. 셔틀 화면(requireShuttleView)·관리자 면(isShuttleAdmin)과
 *    같은 신원이어야 한다: 실제 계정(원장) 역할로 보면 강사 X의 화면에 [학부모 계정] 버튼과 로그인 이메일·연락처가 섰다
 *    (2026-11-05 강사뷰 신원 적대 리뷰). 쓰기(발급·삭제)는 이와 별개로 읽기 강사뷰를 맨 앞에서 막는다(parent-actions.ts).
 */
export async function parentAccountsActor(): Promise<CurrentUser | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  const [matrix, isSuperAdmin] = await Promise.all([getUserPermMatrix(), isCurrentUserSuperAdmin()]);
  return canOpenShuttleAdmin(user.systemRole, matrix, isSuperAdmin) ? user : null;
}

/** 화면 게이트 — 자격이 없으면 404(있는 화면인지조차 알리지 않는다). */
export async function requireParentAccountsAccess(): Promise<CurrentUser> {
  const user = await parentAccountsActor();
  if (!user) notFound();
  return user;
}
