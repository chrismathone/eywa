"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { addDays, formatKoreanDate } from "@/lib/date-kst";
import { cn } from "@/lib/utils";
import {
  DIRECTION_LABEL,
  SEASONS,
  SEASON_LABEL,
  type Season,
  type ShuttleRun,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_CHIP_ON,
} from "@/features/shuttle/control-size";
import { SHUTTLE_TODAY_PATH, shuttleFaces } from "@/features/shuttle/faces";
import {
  mergePlanAndLog,
  plannedRidesOn,
  type RideException,
} from "@/features/shuttle/roster";
import { saveShuttleTodayPrefs } from "@/features/shuttle/server/today-prefs";
import {
  countProgress,
  filterByDirection,
  groupRunsByVehicle,
  sumProgress,
  type DirectionFilter,
} from "@/features/shuttle/today-board";
import { useShuttleLive } from "@/features/shuttle/use-shuttle-live";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import { RideExceptionDialog } from "./ride-exception-dialog";
import { RunPanel } from "./run-panel";
import { VehicleHeader } from "./vehicle-header";

/** 등하원 필터 칩 — 아침엔 등원만, 저녁엔 하원만 본다(폰에서 목록이 절반이 된다). */
const DIR_FILTERS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "in", label: DIRECTION_LABEL.in },
  { value: "out", label: DIRECTION_LABEL.out },
];

/**
 * 오늘 등하원 — 회차마다 그날 예정 명단을 펼치고 한 줄씩 탑승/미탑승을 찍는다.
 *
 * 📱 **이 화면은 모바일이 1순위다**(원장 2026-08-19: *"셔틀 선생님은 모바일을 대부분 이용하시니까"*
 *    → *"아주 필요한 기능만 잘 있도록 호차 구분 및 시간 정리 등하원 체크 용이하게"*).
 *    · 날짜·시즌 칩은 `.toolbar-rail`로 눕힌다(좁은 화면에서 4줄로 감기던 자리).
 *    · **호차로 묶는다** — 차가 여럿이면 평평한 회차 목록에서 "지금 몇 호차를 보는지"가 사라져
 *      남의 차 회차를 자기 차로 착각한다. 호차 머리는 스크롤 중에도 붙어 있다(sticky).
 *    · **시각이 먼저다** — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다(정렬도 시각 순).
 *    · **등원/하원 칩**으로 반을 덜어낸다 — 아침엔 등원만 보면 된다.
 *    · 회차는 **접힌 채로 시작**하고 아직 안 찍은 회차만 펼친다 — 폰에서 7회차를 다 펼치면
 *      다 끝난 회차를 지나 스크롤해야 오늘 할 일이 나온다.
 *    · 진행 요약(찍은 수/전체)을 호차·회차 머리에 둬서 **접힌 채로도 남은 일이 보인다**.
 *    PC는 2열 그리드 그대로 — 넓은 화면에선 한눈에 다 보이는 게 맞다.
 *
 * ⚠️ 묶음·정렬·집계는 순수 [`today-board.ts`](@/features/shuttle/today-board)가 한다(Vitest) —
 *    이 파일은 그리기만. 새 집계를 여기서 손으로 세지 말 것.
 *
 * 🔴 아직 안 찍은 줄은 **회색 '미기록'**이지 미탑승이 아니다 — 안 찍은 걸 미탑승으로 읽으면
 *    아침 내내 전원이 미탑승으로 보이고 그게 출결 신호로 새어나간다(roster 주석).
 */
export function DayBoardClient({
  date,
  season,
  vehicles,
  runs,
  logs,
  absentStudentIds,
  canWrite,
  initialDirection,
  exceptions,
  exceptionsReady,
  students,
  today,
  trips,
  tripsReady,
  tenantId,
}: {
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  /** 그날 출결이 결석·사유결석인 학생 — 🔴 표시만(셔틀 배정·기록을 바꾸지 않는다). */
  absentStudentIds: string[];
  canWrite: boolean;
  /** 계정에 저장된 등하원 보기(`users.ui_prefs.shuttleToday`) — 저녁마다 다시 누르지 않게. */
  initialDirection: DirectionFilter;
  /** 그날만의 예정 변경(0229a) — 오늘만 탐 / 오늘만 안 탐. */
  exceptions: RideException[];
  /** 0229a 적용 여부. false면 **버튼 자체를 안 그린다**(없는 기능을 약속하지 않는다, [[#95]]). */
  exceptionsReady: boolean;
  /** '오늘만 탑승'에 세울 재원생 — 기록 권한이 없으면 빈 배열이다(페이지가 안 싣는다). */
  students: AssignableStudent[];
  /** KST 오늘 — 지난 날짜는 예외를 **읽기만** 한다(그날의 기록이다). */
  today: string;
  /**
   * 그날 회차별 운행 기록(0243a). Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 받는다.
   * 🔴 `tripsReady`가 false면 상태를 **아예 안 그린다** — 표가 없어 전부 null인 것을 그리면
   *    실제로 돌고 있는 차가 "출발 전"으로 보인다([[#95]] 규약).
   */
  trips: [string, ShuttleTrip][];
  tripsReady: boolean;
  /** 실시간 채널 키. 빈 문자열이면 채널을 안 연다(비로그인·조회 실패). */
  tenantId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  /** 사람이 직접 접거나 편 회차 — 여기 없으면 "미기록이 남았나"로 자동 판정한다. */
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const [exceptionOpen, setExceptionOpen] = useState(false);
  /**
   * 등하원 보기 — 화면은 즉시 바꾸고 **계정 저장은 뒤따른다**(반응속도 1순위).
   * ⚠️ 주소에 안 싣는 이유는 서버 왕복(스켈레톤 깜빡임)을 피하기 위해서지만, 그렇다고 휘발시키면
   *    저녁마다 하원을 다시 눌러야 한다 → 보기 설정은 **계정 귀속**이 규칙이다(`users.ui_prefs`).
   */
  const [dirFilter, setDirFilter] = useState<DirectionFilter>(initialDirection);
  function pickDirection(next: DirectionFilter) {
    setDirFilter(next);
    // 저장 실패는 조용히 넘긴다 — 지금 화면은 이미 바뀌었고, 다음 방문에 옛 값으로 열릴 뿐이다.
    void saveShuttleTodayPrefs({ direction: next });
  }

  const absentSet = useMemo(() => new Set(absentStudentIds), [absentStudentIds]);
  const tripByRun = useMemo(() => new Map(trips), [trips]);

  /**
   * 실시간 반영 — 내가 찍으면 알리고(publish), 남이 찍으면 이 화면도 따라 갱신된다.
   * 🔑 `enabled`를 오늘로 좁히는 이유: 지난 날짜를 열어 둔 화면은 바뀔 일이 없는데 WebSocket만 연다.
   */
  const live = useShuttleLive({ tenantId, date, enabled: Boolean(tenantId) && date === today });

  /** 액션이 성공했을 때 — 내 화면을 갱신하고 같은 날짜를 보는 다른 화면을 깨운다. */
  const done = (kind: "boarding" | "trip" | "exception") => () => {
    router.refresh();
    live.publish(kind);
  };

  /** 회차별 그날 줄 — 예정 × 기록. 기록은 회차 축으로 붙는다. */
  const byRun = useMemo(() => {
    const logsByRun = new Map<string, BoardingLog[]>();
    for (const l of logs) {
      if (!l.runId) continue;
      const list = logsByRun.get(l.runId) ?? [];
      list.push(l);
      logsByRun.set(l.runId, list);
    }
    return runs
      .map((run) => ({
        run,
        rows: mergePlanAndLog(plannedRidesOn(run, date, exceptions), logsByRun.get(run.id) ?? []),
      }))
      .filter(({ rows }) => rows.length > 0);
  }, [runs, logs, date, exceptions]);

  /** 화면에 실제로 그릴 것 — 등하원 필터를 먹인 뒤 호차로 묶는다(정렬·집계는 순수 모듈). */
  const groups = useMemo(
    () => groupRunsByVehicle(filterByDirection(byRun, dirFilter), vehicles),
    [byRun, dirFilter, vehicles],
  );
  /** 위 요약은 **보고 있는 것**의 합이다(필터를 걸면 같이 줄어야 "남은 일"이 맞는다). */
  const totals = useMemo(() => sumProgress(groups), [groups]);
  /** 필터 칩에 붙일 방향별 남은 수 — 누르기 전에 어느 쪽에 일이 남았는지 보인다. */
  const remainByDir = useMemo(() => {
    const of = (d: DirectionFilter) =>
      countProgress(filterByDirection(byRun, d).flatMap((r) => r.rows)).unmarked;
    return { all: of("all"), in: of("in"), out: of("out") };
  }, [byRun]);

  const href = (d: string, s: Season = season) => `/shuttle/today?d=${d}&season=${s}`;

  /**
   * 일회성 변경을 **이 화면에서 조정할 수 있나** — 0229a 적용 × 기록 권한 × 오늘 이후 날짜.
   * 🔴 지난 날짜는 읽기만 한다(그날의 기록이라 지우지 않는다). 서버가 같은 판정을 다시 한다([[#77]]).
   */
  const canEditException = canWrite && exceptionsReady && date >= today;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 📐 **면 전환 + 날짜 + 시즌을 한 줄로**(2026-09-03, 원장 *"한 페이지에 정보가 너무 많다"*).
          종전엔 탭 / 날짜·시즌 / 요약이 각각 한 줄이라 **상단만 330px**였다 — 창 높이의 절반이
          머리라 첫 학생이 겨우 보였다. 탭 바는 `min-w-0`으로 줄어들고(안에서 가로 스크롤),
          남는 폭을 날짜·시즌이 쓴다. 좁아지면 `toolbar-rail`이 눕혀 한 줄을 유지한다.
          🔴 FaceTabs는 **공용 컴포넌트라 손대지 않는다** — 수납·학생상세 등이 같이 쓴다.
             여기선 감싸는 자리만 바꾼다.
          ⚠️ 앞·뒤 이동은 ←/→ **글자**가 아니라 아이콘이다 — 글리프는 폰트·플랫폼마다 크기가 널뛰어
             같은 줄의 버튼과 밑선이 어긋나고, 한글 자모로 오인되기도 한다([[#12]]). */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_TODAY_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <Button
          variant="outline"
          aria-label="어제"
          className={SHUTTLE_ACTION}
          render={<Link href={href(addDays(date, -1))} />}
        >
          <EyIcon name="chevronLeft" size={16} />
        </Button>
        <span className="text-foreground px-1 text-sm font-bold whitespace-nowrap">
          {formatKoreanDate(date)}
        </span>
        <Button
          variant="outline"
          aria-label="내일"
          className={SHUTTLE_ACTION}
          render={<Link href={href(addDays(date, 1))} />}
        >
          <EyIcon name="chevronRight" size={16} />
        </Button>
        {SEASONS.map((s) => (
          <Link
            key={s}
            href={href(date, s)}
            aria-current={s === season ? "page" : undefined}
            className={cn(SHUTTLE_CHIP, s === season ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF)}
          >
            {SEASON_LABEL[s]}
          </Link>
        ))}
      </div>

      {/* 등하원 + 요약을 **한 레일**로 — 폰에서 상단 크롬이 세 줄이 되면 첫 호차까지 스크롤이 필요하다
          ("모바일 상단 크롬 = 한 줄" 규약 · 제보의 "아주 필요한 기능만"). 칩의 남은 수는 **필터와 무관한
          전체 기준**이라 누르기 전에 어느 쪽에 일이 있는지 보인다. */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5" role="radiogroup" aria-label="등하원 보기">
          {DIR_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={dirFilter === f.value}
              onClick={() => pickDirection(f.value)}
              className={cn(SHUTTLE_CHIP, dirFilter === f.value ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF)}
            >
              {f.label}
              {remainByDir[f.value] > 0 && (
                <span className={`num text-xs ${dirFilter === f.value ? "" : "text-amber"}`}>
                  {remainByDir[f.value]}
                </span>
              )}
            </button>
          ))}
        </span>
        {/* 📐 **0인 숫자를 색 알약으로 강조하지 않는다**(2026-09-03). 아침엔 탑승·미탑승이 둘 다 0이라
            초록·빨강 알약 두 개가 아무 뜻 없이 눈을 끌었고, 정작 할 일인 '미기록'이 그 사이에 묻혔다.
            🔴 '미기록 N'은 **옆 칩의 '전체 N'과 같은 값**이라 아예 뺐다(같은 숫자를 두 번 세지 않는다) —
               할 일의 크기는 칩이 이미 말한다. 여기 남는 건 **일어난 일**(탑승·미탑승)뿐이고,
               0이면 흐린 글자, 하나라도 있으면 그때 색 알약이 된다.
            🔴 필터를 걸면 이 숫자는 **보고 있는 것**의 합이다 — 무엇의 합인지 밝히지 않으면 옆 칩의
               전체 기준 숫자와 어긋나 보인다. */}
        <span className="text-text-dim whitespace-nowrap">
          {dirFilter !== "all" && `${DIRECTION_LABEL[dirFilter]} `}예정{" "}
          <span className="num text-foreground font-bold">{totals.planned}</span>명
        </span>
        {totals.boarded > 0 ? (
          <Pill color={TONE_COLOR.positive}>탑승 {totals.boarded}</Pill>
        ) : (
          <span className="text-text-faint whitespace-nowrap">
            탑승 <span className="num">0</span>
          </span>
        )}
        {totals.missed > 0 ? (
          <Pill color={TONE_COLOR.critical}>미탑승 {totals.missed}</Pill>
        ) : (
          <span className="text-text-faint whitespace-nowrap">
            미탑승 <span className="num">0</span>
          </span>
        )}
        {/* 🔑 일회성 변경은 **한 자리에** 모은다 — 줄마다 '오늘 안 탐'을 붙이면 바로 옆 '미탑승'과
            섞여 찍힌다(다른 축이다). 게다가 전화를 받은 데스크는 이름으로 찾지, 회차를 스크롤하지 않는다.
            🔴 `exceptionsReady`(0229a 적용) 전에는 **버튼을 아예 안 그린다** — 없는 기능을 약속하면
               눌렀을 때 한글 에러만 나온다([[#95]]). */}
        {canWrite && exceptionsReady && (
          <Button
            variant="outline"
            className={cn(SHUTTLE_ACTION, "ml-auto")}
            onClick={() => setExceptionOpen(true)}
          >
            일회성 변경
            {exceptions.length > 0 && (
              <span className="num text-text-dim">{exceptions.length}</span>
            )}
          </Button>
        )}
        {!canWrite && (
          <span className="text-text-faint whitespace-nowrap">열람 전용</span>
        )}
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {groups.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          {/* 🔴 "없다"의 뜻을 가른다 — 필터 때문에 빈 것을 그날 아무도 안 탄 것처럼 말하지 않는다. */}
          {byRun.length === 0 || dirFilter === "all"
            ? "이 날짜에 타기로 되어 있는 학생이 없습니다."
            : `${DIRECTION_LABEL[dirFilter]}으로 타는 학생이 없습니다 — '전체'를 누르면 다 보입니다.`}
        </div>
      )}

      {exceptionOpen && (
        <RideExceptionDialog
          date={date}
          today={today}
          canEdit={canEditException}
          // 🔴 정류장 선택지는 **회차 전부**에서 만든다 — 그날 명단(byRun)은 "타는 사람이 있는
          //    회차"만 남긴 목록이라, 오늘 아무도 안 타는 회차엔 학생을 넣을 수 없게 된다.
          allRuns={runs}
          // 🔴 '오늘 안 탐' 후보는 등하원 필터를 **걸기 전** 명단이다 — '등원'만 보고 있다고 해서
          //    하원 학생을 못 빼면 안 된다(필터는 보기일 뿐 할 수 있는 일을 줄이지 않는다).
          runRows={byRun}
          vehicles={vehicles}
          students={students}
          exceptions={exceptions}
          onClose={() => setExceptionOpen(false)}
          onError={setError}
          onDone={done("exception")}
        />
      )}

      {groups.map((group) => (
        <section key={group.vehicleId} className="flex flex-col gap-2">
          <VehicleHeader group={group} dirFilter={dirFilter} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {group.runs.map(({ run, rows }) => {
              const progress = countProgress(rows);
              const open = manualOpen[run.id] ?? progress.unmarked > 0;
              return (
                <RunPanel
                  key={run.id}
                  run={run}
                  rows={rows}
                  progress={progress}
                  open={open}
                  onToggle={() => setManualOpen((m) => ({ ...m, [run.id]: !open }))}
                  absentSet={absentSet}
                  date={date}
                  canWrite={canWrite}
                  canEditException={canEditException}
                  onError={setError}
                  onDone={done("boarding")}
                  onTripDone={done("trip")}
                  trip={tripByRun.get(run.id) ?? null}
                  tripsReady={tripsReady}
                  today={today}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
