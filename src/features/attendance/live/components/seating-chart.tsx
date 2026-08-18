"use client";

/**
 * 데스크 좌석표 — **지금/예정/지난 띠 → 층 → 강의실(칠판+좌석)**. 칸 = 그 반의 오늘 학생 하나.
 *
 * 🔴 종전엔 시간축이 없어 **하루치가 한 화면에 통째로** 깔렸다(원장 2026-08-18: *"1개의 수업에 대해서만
 *    수업인데, 마치 전부 수업하는 것처럼"*). 실측(화요일 13:23 KST): 그날 살아 있는 슬롯 102개 중
 *    진행 중 **1개**, 나머지 101개는 시작 전. 게다가 헤더 색이 진행·종료를 같은 네이비로 칠해
 *    끝난 반과 지금 하는 반이 구분되지 않았다.
 * 🔴 **끝난 수업을 감추지는 않는다** — 지나간 교시도 찍어야 한다([[#105]]). 지난 띠는 미입력이 남으면
 *    아예 펼친 채로 두고(원장 2026-08-18), 그 안에서 미입력 카드만 앰버로 세운다(`seating-tone.ts`).
 *    다 찍은 지난 수업은 테두리만 남겨 조용히 물러난다 — 색이 말하는 건 시간이 아니라 "할 일이 남았나"다.
 * ⚠️ 판정 시각은 **서버**가 읽어 `slot.band`로 내려준다([[#108]] — 여기서 현재 시각을 읽으면 SSR과
 *    갈려 하이드레이션이 깨진다). 이 파일엔 `Date`가 없어야 한다.
 */
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { SEAT_MARK_LABEL, SEAT_MARK_TONE } from "../mark-state";
import { NOW_BAND_LABEL, splitByNowBand, type NowBand } from "../now-band";
import { groupSeatPeriods, isSeatRoom } from "../seating-bands";
import { foldSeating, seatingSummary, type SeatingClass } from "../seating";
import { groupSeatingFloors, type SeatingRoom as SeatingRoomGroup } from "../seating-floors";
import type { LiveBoard } from "../types";
import { SeatingRoom } from "./seating-room";

const LEGEND: Array<keyof typeof SEAT_MARK_LABEL> = [
  "present",
  "absent",
  "late",
  "unmarked",
  "waiting",
];

/** 띠 한 줄에 붙는 설명 — "왜 접혀 있나"를 사람 말로 적는다(raw 코드 노출 금지). */
const BAND_HINT: Record<NowBand, string> = {
  now: "이 시각에 실제로 열려 있는 수업입니다.",
  upcoming: "2시간 안에 시작합니다.",
  later: "", // 섹션으로 그리지 않는다(머리줄 개수로만)
  past: "이미 끝났습니다 — 미입력이 남은 반은 앰버로 표시하고 접지 않습니다.",
};

export function SeatingChart({ board }: { board: LiveBoard }) {
  const slots = board.teachers.flatMap((t) => t.slots);
  const classes = foldSeating(slots);
  if (classes.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="이 날은 수업이 없습니다"
        description="시간표에 열린 수업이 없습니다."
      />
    );
  }
  // 🔴 요약은 **하루 전체**가 분모다. 화면을 시간으로 나눈다고 "입력 12/240"이 "1/8"로 줄면
  //    그날 얼마나 남았는지를 아무도 못 본다(집계 분모 불변 규칙).
  const sum = seatingSummary(classes);
  const allGroups = splitByNowBand(classes);
  /**
   * 🔴 화면에 띠로 그리는 건 **지금 · 곧 시작(2시간 내) · 지난** 셋뿐이다(원장 2026-08-18:
   *    *"지금 수업 및 다음 수업 정도만"*, *"그냥 예정 수업은 없애자"*). 그보다 뒤에 시작하는 반은
   *    지금 손댈 수 있는 일이 아니라서 자리만 차지하고, 그 탓에 정작 지금 반이 밀려 내려갔다.
   * ⚠️ 대신 **개수는 머리줄에 적는다** — 통째로 지우면 "오늘 수업이 이게 다인가"로 읽힌다.
   *    (하루 전체 분모인 미출결·입력 합계는 위에서 이미 그대로 보여 준다.)
   */
  const groups = allGroups.filter((g) => g.band !== "later");
  const nowCount = groups.find((g) => g.band === "now")?.items.length ?? 0;
  const laterCount = allGroups.find((g) => g.band === "later")?.items.length ?? 0;
  // 처음 열릴 띠 = 지금 → (없으면) 예정 → (없으면) 지난. 밤늦게 열어도 빈 화면이 되지 않는다.
  const firstBand = groups[0]?.band;
  /**
   * 🔴 **지난 띠는 미입력이 남아 있으면 접지 않는다**(원장 2026-08-18: 조치 대상은 눈에 걸려야 한다).
   *    시간으로 접는 규칙이 조치 목록을 지우면 고치기도 전에 사라진다([[#105]]).
   */
  const openOf = (band: NowBand, list: SeatingClass[]) =>
    band === "now" || band === firstBand || (band === "past" && seatingSummary(list).unmarked > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-bold">
          미출결 <span className="num text-att-absent-ink">{sum.unmarked}</span>
          <span className="text-text-faint mx-1.5">·</span>
          결석 <span className="num text-att-absent-ink">{sum.absent}</span>
          <span className="text-text-faint mx-1.5">·</span>
          입력{" "}
          <span className={`num ${sum.recorded >= sum.expected ? "text-primary" : "text-amber"}`}>
            {sum.recorded}/{sum.expected}
          </span>
          {board.isToday && (
            <>
              <span className="text-text-faint mx-1.5">·</span>
              지금 수업 중 <span className="num text-primary">{nowCount}</span>개 반
              {laterCount > 0 && (
                <span className="text-text-faint">
                  <span className="mx-1.5">·</span>
                  2시간 뒤 <span className="num">{laterCount}</span>개 반
                </span>
              )}
            </>
          )}
        </p>
        <ul className="ml-auto flex flex-wrap items-center gap-2">
          {LEGEND.map((k) => (
            <li
              key={k}
              className={`rounded-lg px-2 py-0.5 text-[12px] font-bold ${SEAT_MARK_TONE[k]}`}
            >
              {SEAT_MARK_LABEL[k]}
            </li>
          ))}
        </ul>
      </header>

      {/* 지난 날짜엔 '지금'이 없다 — 놓친 날을 메우러 여는 자리라 띠로 나누지 않고 그대로 편다. */}
      {board.isToday ? (
        groups.map((group) => (
          <BandSection
            key={group.band}
            band={group.band}
            classes={group.items}
            date={board.date}
            open={openOf(group.band, group.items)}
          />
        ))
      ) : (
        <FloorList classes={classes} date={board.date} />
      )}
    </div>
  );
}

/** 시간 띠 하나 — 지금은 펼쳐서, 나머지는 접어서. 접혀도 남은 미출결 수는 띠에 적는다. */
function BandSection({
  band,
  classes,
  date,
  open,
}: {
  band: NowBand;
  classes: SeatingClass[];
  date: string;
  open: boolean;
}) {
  const unmarked = seatingSummary(classes).unmarked;
  const alert = band === "past" && unmarked > 0;
  return (
    <details open={open} className={`rounded-2xl border ${alert ? "border-amber" : "border-line"}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className={`text-base font-bold ${band === "now" ? "text-primary" : "text-text-dim"}`}>
          {NOW_BAND_LABEL[band]}
        </span>
        <span className="num text-text-dim text-sm">{classes.length}개 반</span>
        {unmarked > 0 && (
          <span className={`num text-sm font-bold ${band === "past" ? "text-amber" : "text-att-absent-ink"}`}>
            미출결 {unmarked}
          </span>
        )}
        <span className="text-text-faint ml-auto text-xs">{BAND_HINT[band]}</span>
      </summary>
      <div className="px-3 pt-1 pb-3">
        <FloorList classes={classes} date={date} />
      </div>
    </details>
  );
}

function FloorList({ classes, date }: { classes: SeatingClass[]; date: string }) {
  return (
    <div className="space-y-6">
      {groupSeatingFloors(classes).map((floor) => (
        <section key={floor.key} className="space-y-4">
          <h2 className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-bold">{floor.label}</span>
            {floor.unmarked > 0 && (
              <span className="text-att-absent-ink text-sm font-bold">미출결 {floor.unmarked}</span>
            )}
          </h2>
          <div className="space-y-4">
            {floor.rooms.map((room) => (
              <SeatingRoomBlock key={room.key} date={date} room={room} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * 일반 방 = 4열(교시 폭). 랩실(603호)·JJ실(305호)만 시트처럼 시각 한 줄.
 */
function SeatingRoomBlock({ date, room }: { date: string; room: SeatingRoomGroup }) {
  const bands = isSeatRoom(room) ? groupSeatPeriods(room.classes) : null;
  return (
    <div className="space-y-2">
      <h3 className="text-base font-bold">{room.roomName}</h3>
      {bands ? (
        <div className="space-y-3">
          {bands.map((band) => (
            <div key={band.start} className="space-y-1.5">
              <p className="text-text-dim text-xs font-bold">
                {band.end && band.end !== band.start ? `${band.start}~${band.end}` : band.start}
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-3">
                {band.classes.map((klass) => (
                  <SeatingRoom key={klass.classId} date={date} klass={klass} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 items-start gap-3">
          {room.classes.map((klass) => (
            <SeatingRoom key={klass.classId} date={date} klass={klass} />
          ))}
        </div>
      )}
    </div>
  );
}
