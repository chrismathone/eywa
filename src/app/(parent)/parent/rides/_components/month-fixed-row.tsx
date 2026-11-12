import { addDays } from "@/lib/date-kst";
import { RegularRideDialog } from "@/features/shuttle/parent/components/regular-ride-dialog";
import { dayCodeOf } from "@/features/shuttle/roster";
import { loadParentRideLegsFor } from "@/features/shuttle/parent/server/parent-ride-data";
import type { ParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { dayLabel, type DayCode } from "@/features/shuttle/types";

const WEEKDAYS: DayCode[] = ["mon", "tue", "wed", "thu", "fri"];

/**
 * 월별 화면의 **고정시간 변경**(사용자 2026-10-02) — 요일을 누르면 그 요일의 고정시간 창이 뜬다.
 * 🔑 요일별 화면은 지난 요일 칩에서 수정 모드가 안 켜지므로(같은 날 결정), 이번 주에 이미 지난 요일의 고정시간은
 *    여기서 바꾼다 — 매주 반복이라 어느 요일이든 늘 열려 있다(쉬는 날이어도 된다).
 * 🔑 창·저장은 요일별 화면과 **같은 부품·같은 서버 액션**(`RegularRideDialog` → `changeRegularRide`)이다. 새 저장 경로 없음.
 * 🔑 무거운 재료(호차 전체 노선 · 그 요일의 고정 자리)는 요일을 **고른 뒤에만** 읽는다(`fixed=wed`).
 */
export async function MonthFixedRow({
  viewer,
  kid,
  today,
  fixed,
  hrefFor,
}: {
  viewer: ParentViewer;
  kid: { id: string; name: string };
  today: string;
  /** 고른 요일(주소 `fixed=`) — 없거나 틀리면 요일 칩만. */
  fixed: string | undefined;
  /** 요일 칩 주소(null = 고르기 해제). */
  hrefFor: (day: DayCode | null) => string;
}) {
  const picked = WEEKDAYS.find((d) => d === fixed) ?? null;
  // 그 요일의 가장 가까운 날(오늘 포함) — 서버 액션과 같은 기준('오늘이면 지난 회차 잠금' 판정용).
  const onDate = picked ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i)).find((d) => dayCodeOf(d) === picked)! : null;
  const data = onDate ? await loadParentRideLegsFor(viewer, [kid.id], onDate, "term", false, true) : null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
      <span className="font-bold">매주 고정시간 변경</span>
      {WEEKDAYS.map((d) => (
        <a
          key={d}
          href={hrefFor(d === picked ? null : d)}
          aria-current={d === picked ? "true" : undefined}
          className={`flex h-7 w-8 items-center justify-center rounded-full font-bold ${
            d === picked ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-[var(--shadow-card)]"
          }`}
        >
          {dayLabel(d)}
        </a>
      ))}
      {picked && onDate && data ? (
        // key — 요일을 바꾸면 창을 새로 연다.
        <RegularRideDialog
          key={picked}
          kids={[{ id: kid.id, name: kid.name }]}
          weekday={picked}
          onDate={onDate}
          today={today}
          regular={data.regular}
          fleet={data.fleet}
          defaultOpen
        />
      ) : null}
    </div>
  );
}
