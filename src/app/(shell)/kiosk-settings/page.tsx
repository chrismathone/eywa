import { requireAccess } from "@/lib/auth/require-access";
import {
  getAttendanceCodeStats,
  getKakaoChannelStatus,
  getKioskDevices,
  getRecentCheckins,
  getRecentNotifications,
} from "@/features/attendance/kiosk/server/queries";
import {
  AssignCodesForm,
  KakaoChannelForm,
  RegisterDeviceForm,
  RevokeDeviceButton,
  TestAlimtalkForm,
} from "./_components/forms";

// 원장(master) 전용 키오스크 설정. 사이드바 미노출 — 직접 URL + requireAccess 가드.
export const dynamic = "force-dynamic";
// 제목이 없으면 루트 기본값(로그인 전 '브랜드 학원' 이름)으로 떨어져 다른 지점에서도 그 학원 이름이 탭에 뜬다.
export const metadata = { title: "출석 키오스크 설정 — aywa" };

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
  const [stats, devices, checkins, notifications, kakao] = await Promise.all([
    getAttendanceCodeStats(),
    getKioskDevices(),
    getRecentCheckins(20),
    getRecentNotifications(20),
    getKakaoChannelStatus(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-6">
      <header>
        <h1 className="text-foreground text-xl font-bold">출석 키오스크 설정</h1>
        <p className="text-text-dim mt-1 text-sm leading-relaxed">
          태블릿을 현관에 두면 학생이 출석번호를 입력해 스스로 등하원을 체크하고, 학부모에게 알림이 갑니다.
          등원 시각이 수업 시간과 맞으면 <span className="text-foreground">출석부에도 자동 출석 처리</span>됩니다(현재
          시각 수업이 하나로 특정될 때만, 강사가 이미 입력한 출결은 보존).
          <span className="text-gold"> 현재 알림은 발송 시뮬레이션</span>(실제 전송 없음)이며, 카카오 채널
          연동 후 실발송으로 전환됩니다.
        </p>
      </header>

      {/* 넓은 창은 2열, 좁은 창(lg 미만)은 1열로 접힘 — 디자인 시스템 § 반응형 폭 규약 */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      {/* 1. 출석번호 발급 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">출석번호</h2>
        <p className="text-text-dim mt-1 text-sm">
          학생 휴대폰 뒷 4자리(없으면 학부모) 기준으로 발급되며, 겹치면 5자리로 분기합니다.
        </p>
        <p className="text-foreground mt-2 text-sm">
          발급 완료 <span className="font-bold">{stats.withCode}</span> / {stats.total}명
        </p>
        <div className="mt-3">
          <AssignCodesForm />
        </div>
      </section>

      {/* 2. 키오스크 기기 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">키오스크 기기</h2>
        <p className="text-text-dim mt-1 text-sm">
          출석 체크에 쓸 태블릿(이 브라우저)을 등록합니다. 분실 시 폐기하면 즉시 차단됩니다.
        </p>
        <div className="mt-3">
          <RegisterDeviceForm />
        </div>
        {devices.length > 0 ? (
          <ul className="border-border mt-4 divide-y rounded-md border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text-faint micro shrink-0">기기 #{d.deviceNo}</span>
                    <span className="text-foreground font-medium">{d.name}</span>
                    <span className="text-text-dim shrink-0 text-xs">{d.deviceType}</span>
                    {d.isActive ? (
                      <span className="text-primary shrink-0 text-xs">활성</span>
                    ) : (
                      <span className="text-text-faint shrink-0 text-xs">폐기됨</span>
                    )}
                  </div>
                  <div className="text-text-faint mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <span>등록 IP {d.registeredIp ?? "—"}</span>
                    <span>최근 IP {d.lastSeenIp ?? "—"}</span>
                    <span>최근 사용 {fmt(d.lastSeenAt)}</span>
                  </div>
                </div>
                {d.isActive ? <RevokeDeviceButton deviceId={d.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-xs">등록된 기기가 없습니다.</p>
        )}
      </section>

      {/* 3. 발송 시뮬레이션 피드 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">알림 발송 (시뮬레이션)</h2>
        {notifications.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="border-border rounded-md border px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">
                    {n.kind === "checkin" ? "등원" : "하원"} · {n.recipientMasked ?? "수신번호 없음"}
                  </span>
                  <span className="text-gold text-xs">{n.status}</span>
                </div>
                <p className="text-text-dim mt-1">{n.message}</p>
                <p className="text-text-faint mt-0.5 text-xs">{fmt(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-xs">아직 발송 내역이 없습니다.</p>
        )}
      </section>

      {/* 3.5 카카오 알림톡 연동 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground text-sm font-bold">카카오 알림톡 연동</h2>
          {kakao.live ? (
            <span className="text-primary shrink-0 text-xs font-medium">활성 · 실발송</span>
          ) : kakao.configured && !kakao.licenseActive ? (
            <span className="text-amber shrink-0 text-xs font-medium">라이선스 대기</span>
          ) : (
            <span className="text-text-faint shrink-0 text-xs font-medium">미설정 · 시뮬레이션</span>
          )}
        </div>
        <p className="text-text-dim mt-1 text-sm leading-relaxed">
          학원 명의 카카오 비즈채널 인증 → 발신프로필 키(pfId) 발급 → 등하원 정보성 템플릿 2종 사전심사(1~3
          영업일)를 마친 뒤, 아래에 pfId와 승인된 템플릿 ID를 입력하세요. 라이선스(<span className="font-mono">kakao_messaging</span>)가
          켜지고 정보가 모두 채워지면 <span className="text-foreground">코드 변경 없이 실발송으로 전환</span>됩니다.
          그 전까지는 발송 시뮬레이션으로 동작합니다(실제 전송 없음).
        </p>
        <div className="mt-4">
          <KakaoChannelForm status={kakao} />
        </div>
        {kakao.lastError ? (
          <p className="text-danger mt-3 text-xs">최근 발송 오류: {kakao.lastError}</p>
        ) : null}
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-text-dim mb-2 text-xs">
            연동이 활성화되면 원장 본인 번호로 등원 알림톡을 한 건 보내 도달을 확인할 수 있습니다.
          </p>
          <TestAlimtalkForm />
        </div>
      </section>

      {/* 4. 등하원 현황 */}
      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="text-foreground text-sm font-bold">최근 등하원</h2>
        {checkins.length > 0 ? (
          <ul className="border-border mt-3 divide-y rounded-md border">
            {checkins.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-foreground font-medium">{c.studentName}</span>
                <span className="text-text-dim text-xs">
                  등원 {fmt(c.checkedInAt)} · 하원 {fmt(c.checkedOutAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-faint mt-3 text-xs">아직 등하원 기록이 없습니다.</p>
        )}
      </section>
      </div>
    </div>
  );
}
