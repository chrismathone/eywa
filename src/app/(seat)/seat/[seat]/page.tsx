import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";
import { readSeatPinSession, resolvePinSigningSecret } from "@/features/attendance/seat/server/pin-session";
import {
  parseSeatKey,
  pickPeriodIndex,
  SEAT_NAME,
  SEAT_ROOM,
} from "@/features/attendance/seat/seat";
import { kstToday } from "@/lib/date-kst";
import { SeatBoard } from "@/app/(shell)/attendance/seat/[seat]/_components/seat-board";
import { SeatPinForm } from "./pin-form";

/**
 * 🔴 `noindex` — 이 주소는 로그인 없이 열리고 통과하면 **학생 명단**이 나온다. 검색엔진에 실리면
 * 주소가 새는 순간 비밀번호만 남는다(4자리). 크롤러가 못 담게 막는다.
 */
export const metadata: Metadata = {
  title: "자리 출석부",
  robots: { index: false, follow: false, nocache: true },
};

function kstNowHm(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * 랩실 공개 출석부 — 로그인 없음. PIN 쿠키가 있어야 오늘·이 자리 명단만 보인다.
 * 지난 날짜·다른 자리·학생 상세로 가는 길을 만들지 않는다.
 */
export default async function PublicSeatPage({
  params,
  searchParams,
}: {
  params: Promise<{ seat: string }>;
  searchParams: Promise<{ start?: string }>;
}) {
  const { seat: seatParam } = await params;
  const { start: startParam } = await searchParams;
  const seat = parseSeatKey(seatParam);
  if (!seat) notFound();

  const branding = await getPublicBranding();
  const labels = brandLabels(branding);
  const session = await readSeatPinSession();

  if (!session || session.seat !== seat) {
    const blocked = !branding || !resolvePinSigningSecret();
    if (blocked) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-foreground text-lg font-bold">지금은 이 화면을 쓸 수 없습니다</p>
          <p className="text-text-dim max-w-sm text-sm">관리자에게 문의해 주세요.</p>
        </main>
      );
    }
    return <SeatPinForm seat={seat} seatName={SEAT_NAME[seat]} academyLine={labels.academyLine} />;
  }

  const date = kstToday();
  const day = await getPublicSeatDay(session.tenantId, seat, date);
  const fallbackIdx = pickPeriodIndex(day.periods, kstNowHm());
  const idx = startParam ? day.periods.findIndex((p) => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-3 px-3 py-4 sm:px-5">
      <header className="shrink-0">
        <p className="text-text-dim text-xs font-medium">{labels.academyLine}</p>
        <h1 className="text-foreground text-xl font-bold tracking-tight">
          {SEAT_NAME[seat]} {SEAT_ROOM[seat]}
        </h1>
        <p className="text-text-dim text-sm">오늘</p>
      </header>
      {day.periods.length === 0 || !period ? (
        <EmptyState image="students" title={`오늘은 ${SEAT_NAME[seat]} 수업이 없습니다`} />
      ) : (
        <SeatBoard
          seat={seat}
          date={date}
          periods={day.periods.map((p) => ({
            start: p.start,
            ends: p.ends,
            classIds: p.slots.map((s) => s.classId),
          }))}
          activeStart={period.start}
          rosters={day.rosterByPeriod[period.start] ?? []}
          readOnly={false}
          hrefFor={`/seat/${seat}?start=`}
        />
      )}
    </div>
  );
}
