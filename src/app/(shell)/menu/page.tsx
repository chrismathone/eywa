import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canAccess } from "@/lib/permissions";
import { landingPath } from "@/lib/auth/teacher-home";

export const metadata = { title: "업무 선택 — aywa" };

/** 이전 메뉴 주소는 대시보드로 연결한다. 접근 제한 계정의 안전한 착지점은 유지한다. */
export default async function MenuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const matrix = await getUserPermMatrix();
  if (canAccess(user.systemRole, "dashboard", matrix)) redirect("/dashboard");
  const home = await landingPath(user.systemRole, matrix);
  if (home !== "/menu") redirect(home);
  return (
    <div className="flex min-h-96 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-foreground text-xl font-bold">업무를 선택해 주세요</h1>
      <p className="text-text-dim text-sm">메뉴에서 이용할 수 있는 업무를 열 수 있습니다.</p>
    </div>
  );
}
