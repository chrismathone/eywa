import { requireAccess } from "@/lib/auth/require-access";
import {
  getAttendanceCodeStats,
  getKioskDevices,
  getRecentCheckins,
  getRecentNotifications,
} from "@/features/attendance/kiosk/server/queries";
import { AssignCodesForm, RegisterDeviceForm, RevokeDeviceButton } from "./_components/forms";

// 원장(master) 전용 키오스크 설정. 사이드바 미노출 — 직접 URL + requireAccess 가드.
export const dynamic = "force-dynamic";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default async function KioskSettingsPage() {
  await requireAccess("kiosk_settings");
  const [stats, devices, checkins, notifications] = await Promise.all([
    getAttendanceCodeStats(),
    getKioskDevices(),
    getRecentCheckins(20),
    getRecentNotifications(20),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-6">
      <header>
        <h1 className="text-foreground text-xl font-bold">출석 키오스크 설정</h1>
        <p className="text-text-dim mt-1 text-[13px] leading-relaxed">
          태블릿을 현관에 두면 학생이 출석번호를 입력해 스스로 등하원을 체크하고, 학부모에게 알림이 갑니다.
          <span className="text-gold"> 현재 알림은 발송 시뮬레이션</span>(실제 전송 없음)이며, 카카오 채널
          연동 후 실발송으로 전환됩니다.
        </p>
      </header>

      {/* 1. 출석번호 발급 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">출석번호</h2>
        <p className="text-text-dim mt-1 text-[13px]">
          학생 휴대폰 뒷 4자리(없으면 학부모) 기준으로 발급되며, 겹치면 5자리로 분기합니다.
        </p>
        <p className="text-foreground mt-2 text-[13px]">
          발급 완료 <span className="font-semibold">{stats.withCode}</span> / {stats.total}명
        </p>
        <div className="mt-3">
          <AssignCodesForm />
        </div>
      </section>

      {/* 2. 키오스크 기기 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">키오스크 기기</h2>
        <p className="text-text-dim mt-1 text-[13px]">
          출석 체크에 쓸 태블릿(이 브라우저)을 등록합니다. 분실 시 폐기하면 즉시 차단됩니다.
        </p>
        <div className="mt-3">
          <RegisterDeviceForm />
        </div>
        {devices.length > 0 ? (
          <ul className="border-border mt-4 divide-y rounded-md border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{d.name}</span>
                  {d.isActive ? (
                    <span className="text-primary text-[11px]">활성</span>
                  ) : (
                    <span className="text-text-faint text-[11px]">폐기됨</span>
                  )}
                  <span className="text-text-faint text-[11px]">최근 사용 {fmt(d.lastSeenAt)}</span>
                </span>
                {d.isActive ? <RevokeDeviceButton deviceId={d.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-[12px]">등록된 기기가 없습니다.</p>
        )}
      </section>

      {/* 3. 발송 시뮬레이션 피드 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">알림 발송 (시뮬레이션)</h2>
        {notifications.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="border-border rounded-md border px-3 py-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">
                    {n.kind === "checkin" ? "등원" : "하원"} · {n.recipientMasked ?? "수신번호 없음"}
                  </span>
                  <span className="text-gold text-[11px]">{n.status}</span>
                </div>
                <p className="text-text-dim mt-1">{n.message}</p>
                <p className="text-text-faint mt-0.5 text-[11px]">{fmt(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-[12px]">아직 발송 내역이 없습니다.</p>
        )}
      </section>

      {/* 4. 등하원 현황 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">최근 등하원</h2>
        {checkins.length > 0 ? (
          <ul className="border-border mt-3 divide-y rounded-md border">
            {checkins.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                <span className="text-foreground font-medium">{c.studentName}</span>
                <span className="text-text-dim text-[12px]">
                  등원 {fmt(c.checkedInAt)} · 하원 {fmt(c.checkedOutAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-[12px]">아직 등하원 기록이 없습니다.</p>
        )}
      </section>
    </div>
  );
}
