import { PageHeader } from "@/components/page-header";
import { formatKoreanDate } from "@/lib/date-kst";
import { EcsFaceTabs, EcsDayNav } from "@/app/(shell)/ecs/_components/today-nav";
import { SeatDayClient } from "./seat-day-client";
import type { SeatDayResult } from "../server/seat-day-types";

/**
 * ECS **305** 면 — 사무실·강사 모두 연다(오늘 면의 24반 폭탄과 달리 타임 단위).
 * 기록은 반 시트 JJ 칸과 같다.
 */
export function EcsSeatDayFace({ res, showToday }: { res: SeatDayResult; showToday: boolean }) {
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="305 · JJ실" description="집중자율수업실 출석" />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const { data } = res;
  const isToday = data.date === data.today;
  const n = data.periods.reduce((acc, p) => acc + p.students.length, 0);
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="수업 운영"
        title="305 · JJ실"
        description={`${isToday ? "오늘" : formatKoreanDate(data.date)} · 집중자율수업실 · ${data.periods.length}타임 · ${n}명`}
        embedLabel={`305 · JJ실 · ${isToday ? "오늘" : data.date.slice(5)}`}
      />
      <div className="bg-card shadow-card toolbar-rail flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <EcsFaceTabs face="room" showToday={showToday} />
        <EcsDayNav date={data.date} today={data.today} view="room" />
      </div>
      {data.periods.length === 0 ? (
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {isToday ? "오늘은" : "이 날은"} 305호 JJ 수업이 없습니다. 다른 날짜를 보시거나 주간 시트에서 반별로
          확인하세요.
        </p>
      ) : (
        <>
          <SeatDayClient key={data.date} data={data} />
          <p className="text-text-dim px-1 text-[12px]">
            이 표는 영어 반 시트의 JJ 칸과 같은 기록입니다. 반 카드에서도 그대로 보입니다.
          </p>
        </>
      )}
    </div>
  );
}
