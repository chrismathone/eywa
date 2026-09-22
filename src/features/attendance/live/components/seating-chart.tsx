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
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { SeatingEditProvider } from "./seating-edit-context";
import { CalendarDays } from "@/components/icons/aywa-icon-compat";
import { SearchScopeChip, StudentSearchToggle } from "@/features/attendance/components/student-search-box";
import {
  SubjectFilterSelect,
  SubjectScopeChip,
  useSubjectFilter,
} from "@/features/attendance/components/subject-filter-chips";
import { matchesSubjectFilter } from "@/features/attendance/live/view-prefs";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
} from "@/features/attendance/student-search";
import { SEAT_MARK_LABEL, SEAT_MARK_TONE } from "../mark-state";
import { NOW_BAND_LABEL, laterStartPrefix, splitByNowBand, type NowBand } from "../now-band";
import { groupSeatPeriods, isSeatRoom } from "../seating-bands";
import { foldSeating, seatingSummary, type SeatingClass } from "../seating";
import { groupSeatingFloors, type SeatingRoom as SeatingRoomGroup } from "../seating-floors";
import type { LiveBoard } from "../types";
import { SeatingRoom } from "./seating-room";

/**
 * 범례 — 칸에 실제로 나올 수 있는 색 전부.
 * ⚠️ `excused`(공결)는 결석과 **같은 라벨·같은 색**이라 뺀다(같은 알약이 두 번 서면 다른 뜻으로 읽힌다).
 * 🔴 2026-09-08 보강·조퇴 추가 — 그전엔 이 화면이 둘을 출석·지각에 접어 범례가 필요 없었다.
 */
const LEGEND: Array<keyof typeof SEAT_MARK_LABEL> = [
  "present",
  "late",
  "early_leave",
  "makeup",
  "absent",
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

export function SeatingChart({
  board,
  /** 계정에 저장된 과목 필터(2026-08-20) — 검색과 달리 **다음 방문에도 남는다**. */
  initialSubject = "all",
}: {
  board: LiveBoard;
  initialSubject?: string;
}) {
  /**
   * 학생 검색(원장 2026-08-19) — **클라 필터**다(서버 왕복 0, URL·계정 저장 없음).
   * 화면을 떠나면 사라진다: 다음에 열었을 때 필터가 걸려 있으면 "오늘 수업이 하나뿐"으로 읽힌다.
   */
  const [query, setQuery] = useState("");
  const searching = isSearchActive(query);
  const subject = useSubjectFilter(initialSubject);
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
  //    그날 얼마나 남았는지를 아무도 못 본다(집계 분모 불변 규칙). 과목 필터도 이 숫자를 안 건드린다.
  const sum = seatingSummary(classes);
  /**
   * 🔴 과목 필터도 좁히는 축은 검색과 같은 **반 카드**다 — 카드 안 명단은 절대 안 줄인다(아래 검색
   *    주석의 "색이 거짓말한다"가 똑같이 적용된다).
   * 🔴 **띠(지금·곧·지난)는 반드시 이 좁힌 집합에서 나눠야 한다.** 전체 기준으로 나눈 띠를 쓰면
   *    "처음 열릴 띠"가 그 과목에 없는 띠로 잡혀 **모든 띠가 접힌 채** 열린다(빈 화면처럼 보인다).
   */
  const subjectClasses = classes.filter((c) => matchesSubjectFilter(subject.value, c.subject));
  // 머리줄의 '지금 수업 중 N개 반'·'HH:MM부터 N개 반'은 위 미출결·입력과 **같은 자**여야 한다 =
  // 하루 전체(학생 검색도 이 숫자를 안 건드린다). 좁힌 사실은 아래 범위 칩이 말한다.
  const dayGroups = splitByNowBand(classes);
  const allGroups = splitByNowBand(subjectClasses);
  /**
   * 🔴 화면에 띠로 그리는 건 **지금 · 곧 시작(2시간 내) · 지난** 셋뿐이다(원장 2026-08-18:
   *    *"지금 수업 및 다음 수업 정도만"*, *"그냥 예정 수업은 없애자"*). 그보다 뒤에 시작하는 반은
   *    지금 손댈 수 있는 일이 아니라서 자리만 차지하고, 그 탓에 정작 지금 반이 밀려 내려갔다.
   * ⚠️ 대신 **개수는 머리줄에 적는다** — 통째로 지우면 "오늘 수업이 이게 다인가"로 읽힌다.
   *    (하루 전체 분모인 미출결·입력 합계는 위에서 이미 그대로 보여 준다.)
   */
  const groups = allGroups.filter((g) => g.band !== "later");
  const nowCount = dayGroups.find((g) => g.band === "now")?.items.length ?? 0;
  const laterItems = dayGroups.find((g) => g.band === "later")?.items ?? [];
  const laterCount = laterItems.length;
  // 🔴 "2시간 뒤"라고 적지 않는다 — 그건 접는 기준(앞창)의 이름이지 그 수업이 언제인지가 아니다.
  //    새벽 2시에 오후 2시 수업을 "2시간 뒤"라고 말했다(원장 2026-08-30). 문구는 now-band 단일 소스.
  const laterPrefix = laterStartPrefix(laterItems.map((c) => c.blockStart));
  // 처음 열릴 띠 = 지금 → (없으면) 예정 → (없으면) 지난. 밤늦게 열어도 빈 화면이 되지 않는다.
  const firstBand = groups[0]?.band;
  /**
   * 🔴 **지난 띠는 미입력이 남아 있으면 접지 않는다**(원장 2026-08-18: 조치 대상은 눈에 걸려야 한다).
   *    시간으로 접는 규칙이 조치 목록을 지우면 고치기도 전에 사라진다([[#105]]).
   */
  const openOf = (band: NowBand, list: SeatingClass[]) =>
    band === "now" || band === firstBand || (band === "past" && seatingSummary(list).unmarked > 0);

  /**
   * 검색 결과 — **그 학생이 있는 반 카드만 남기고**(나머지는 안 그린다) 그 안에서 학생 칸을 강조한다.
   *
   * 🔴 **카드 안 명단은 안 줄인다.** 이 화면의 단위는 학생 줄이 아니라 **반 카드**이고, 카드 머리는
   *    그 반의 상태를 말한다(`미입력 N`·앰버 띠 = `pendingCountOf`). 카드 안에서 안 걸린 학생을 빼면
   *    미입력 4명짜리 반이 "입력 완료"로 조용히 칠해진다 — 숫자가 아니라 **색이 거짓말한다**.
   *    그래서 좁히는 축은 카드, 찾은 학생은 테두리로 짚어 준다(둘 다 즉시 눈에 들어온다).
   * 🔴 검색 중엔 시간 띠(지금·곧·지난)로 나누지 않고 **한 덩어리로 편다**: 띠는 `<details>`라 접혀 있을 수
   *    있어서, 찾는 학생이 접힌 띠 안에 있으면 "검색했는데 없다"가 된다(사라진 게 아니라 접힌 것).
   */
  const hit = (s: { studentName: string; schoolGrade: string | null }) =>
    matchesStudentSearch(query, [s.studentName, s.schoolGrade]);
  const shownClasses = searching ? subjectClasses.filter((c) => c.students.some(hit)) : subjectClasses;
  const matchIds = new Set(
    searching ? subjectClasses.flatMap((c) => c.students.filter(hit).map((s) => s.studentId)) : [],
  );

  return (
    // 편집 가능 여부는 **보드 단위 사실 하나** — 칸(SeatingCell)이 컨텍스트로 읽는다.
    // 안 내리면 읽기 전용 역할·7일 지난 날짜에서도 알약이 눌리는 것처럼 보인다([[#103]]).
    <SeatingEditProvider canEdit={board.canEdit}>
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
                  {laterPrefix} <span className="num">{laterCount}</span>개 반
                </span>
              )}
            </>
          )}
        </p>
        {/* 학생 검색 — 이름을 치면 그 학생이 있는 반만 남는다. 위 합계(미출결·결석·입력)는 **하루 전체**
            기준 그대로라(집계 분모 불변 규칙) 걸린 필터를 칩으로 크게 밝힌다. */}
        <StudentSearchToggle
          value={query}
          onChange={setQuery}
          inputWidth="w-[104px]"
          chip={<SearchScopeChip shown={shownClasses.length} total={subjectClasses.length} unit="개 반" totalsNote="위 합계는 하루 전체 기준" />}
        />
        {/* 과목 필터 — 좁히는 축은 검색과 같은 **반 카드**다(계정 저장). 위 합계는 하루 전체 기준 그대로. */}
        <SubjectFilterSelect value={subject.value} onPick={subject.pick} pending={subject.pending} />
        <SubjectScopeChip
          subject={subject.value}
          shown={subjectClasses.length}
          total={classes.length}
          unit="개 반"
          totalsNote="위 합계는 하루 전체 기준"
        />
        <ul className="ml-auto flex flex-wrap items-center gap-2">
          {LEGEND.map((k) => (
            <li
              key={k}
              className={`rounded-lg px-2 py-0.5 text-xs font-bold ${SEAT_MARK_TONE[k]}`}
            >
              {SEAT_MARK_LABEL[k]}
            </li>
          ))}
        </ul>
      </header>

      {/* 검색 중엔 띠를 접지 않고 한 덩어리로(위 shownClasses 주석). 0명이면 왜 비었는지 말한다. */}
      {searching ? (
        shownClasses.length === 0 ? (
          <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-4">
            <span className="text-foreground text-sm font-bold">
              {/* 과목까지 좁혀 놓고 검색한 것이면 그 사실을 말한다 — "이 날 수업에 없다"는 거짓말이 된다. */}
              {emptySearchMessage(query, subject.active ? "지금 고른 과목의 이 날 수업" : "이 날 수업")}
            </span>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
            >
              검색 지우기
            </button>
          </div>
        ) : (
          <FloorList classes={shownClasses} date={board.date} highlight={matchIds} />
        )
      ) : /* 지난 날짜엔 '지금'이 없다 — 놓친 날을 메우러 여는 자리라 띠로 나누지 않고 그대로 편다. */
      subjectClasses.length === 0 ? (
        // 이 과목에 그날 수업 자체가 없을 때만 — 띠가 비는 건(전부 '이후 수업') 종전에도 정상 상태다.
        <EmptySubjectNotice onReset={() => subject.pick("all")} />
      ) : board.isToday ? (
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
        <FloorList classes={subjectClasses} date={board.date} />
      )}
    </div>
    </SeatingEditProvider>
  );
}

/**
 * 고른 과목에 그날 수업이 없을 때 — **왜 비었는지**를 사람 말로 밝히고 되돌릴 버튼을 준다.
 * (빈 화면만 두면 "출결이 사라졌다"로 읽힌다 — 학생 검색 0건 안내와 같은 규약.)
 */
function EmptySubjectNotice({ onReset }: { onReset: () => void }) {
  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-4">
      <span className="text-foreground text-sm font-bold break-keep">
        고른 과목에는 이 날 수업이 없습니다 — 과목을 ‘전체’로 되돌리면 다시 보입니다.
      </span>
      <button
        type="button"
        onClick={onReset}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
      >
        전체 보기
      </button>
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

function FloorList({
  classes,
  date,
  /** 검색에 걸린 학생 id — 그 칸만 테두리로 짚는다(없으면 아무 칸도 강조하지 않는다). */
  highlight,
}: {
  classes: SeatingClass[];
  date: string;
  highlight?: ReadonlySet<string>;
}) {
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
              <SeatingRoomBlock key={room.key} date={date} room={room} highlight={highlight} />
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
function SeatingRoomBlock({
  date,
  room,
  highlight,
}: {
  date: string;
  room: SeatingRoomGroup;
  highlight?: ReadonlySet<string>;
}) {
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
                  <SeatingRoom key={klass.classId} date={date} klass={klass} highlight={highlight} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 items-start gap-3">
          {room.classes.map((klass) => (
            <SeatingRoom key={klass.classId} date={date} klass={klass} highlight={highlight} />
          ))}
        </div>
      )}
    </div>
  );
}
