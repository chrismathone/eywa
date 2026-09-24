import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentSuperAdmin } from "@/lib/auth/super-admin";

// /admin은 두 관리자 동선의 기존 진입점이다. 순수 super_admin은 users 행이 없을 수 있으므로
// 학원 셸 바깥에서 판정하고, 실제 권한은 각 목적지의 레이아웃/페이지에서 다시 확인한다.
export default async function AdminRedirect() {
  if (await getCurrentSuperAdmin()) redirect("/super-admin/tenants");
  if (!(await getCurrentUser())) redirect("/login");
  redirect("/owner?tab=data");
}
