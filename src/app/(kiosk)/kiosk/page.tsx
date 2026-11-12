import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveKioskDevice } from "@/features/attendance/kiosk/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { KioskKeypad } from "./_components/keypad";

// 무인 키오스크 화면. 비로그인 공개(proxy PUBLIC), 실제 보안은 디바이스 토큰(httpOnly 쿠키).
// 쿠키가 유효한 등록 기기가 아니면 안내만 노출(체크인 불가).
export default async function KioskPage() {
  const device = await resolveKioskDevice();
  if (device?.state === "off") notFound();

  if (!device) {
    // 로그인한 사람의 학원이 키오스크 기능을 꺼 두었으면 **없는 주소**(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
    // 비로그인 기기는 어느 학원인지 알 수 없어(주소에 지점이 없다 — C안) 종전 안내 그대로.
    const user = await getCurrentUser();
    if (user && (!isModuleEnabled((await getTenantSettings()).modules.disabled, "kiosk") ||
      !(await isLaboratoryMenuAvailable(user.tenantId, "kiosk_settings")))) notFound();
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-text-dim text-sm">이 기기는 키오스크로 등록되지 않았습니다.</div>
        <p className="text-text-faint max-w-sm text-sm leading-relaxed">
          학원 관리자 계정으로 로그인한 뒤 <span className="text-foreground font-medium">키오스크 설정</span>에서
          이 기기를 등록하면 출석 체크인이 활성화됩니다.
        </p>
        <Link
          href="/kiosk-settings"
          className="border-border text-foreground hover:bg-bg-soft rounded-md border px-4 py-2 text-sm"
        >
          키오스크 설정으로 이동
        </Link>
      </main>
    );
  }

  return <KioskKeypad academyName={device.academyName} />;
}
