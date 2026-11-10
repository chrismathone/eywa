import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 시안 화면(연간 마케팅·조직 OKR·경영 관리)의 문 — 한 벌(리뷰 C9 — 두 폴더에 똑같은 사본이 있었다) · 원장(master)·관리자(admin)·매니저(manager)만. 새 권한 키·새 표를 쓰지 않는다.
 * 원래 화면의 권한 판정(새 메뉴 키가 필요)을 대신한다. 메뉴·권한 키는 시안을 정식으로 들일 때 정한다.
 */
export async function requireSampleViewer() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["master", "admin", "manager"].includes(user.systemRole) && !(await isCurrentUserSuperAdmin())) redirect("/dashboard");
  return user;
}
