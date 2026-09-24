import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { MODULES, type ModuleId } from "@/lib/modules";

export async function UnavailableFeatureContent({ id }: { id: ModuleId | null }) {
  const user = await getCurrentUser();
  const canEnable = user?.systemRole === "master" || (user ? await isCurrentUserSuperAdmin() : false);
  const label = id ? MODULES[id].label : "이 기능";

  return (
    <div className="mx-auto w-full max-w-xl py-10">
      <EmptyState
        title={`이 학원에서는 ${label} 기능을 사용하지 않습니다`}
        description={
          canEnable
            ? "학원 설정의 '기능' 면에서 켤 수 있습니다."
            : "필요하면 원장님께 기능을 켜 달라고 요청해 주세요."
        }
        action={
          canEnable ? (
            <Link href="/owner?tab=modules" className="text-primary font-semibold underline underline-offset-4">
              학원 설정 › 기능 열기
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
