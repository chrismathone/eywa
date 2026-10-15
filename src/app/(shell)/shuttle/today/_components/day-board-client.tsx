"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { HrefSelect } from "@/components/href-select";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
  DIRECTION_LABEL,
  type Season,
  type ShuttleRun,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";
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
import { ShuttleDayNav } from "../../_components/shuttle-day-nav";
import { VehicleHeader } from "./vehicle-header";

/** 등하원 보기 드롭다운 항목 — 아침엔 등원만, 저녁엔 하원만 본다(폰에서 목록이 절반이 된다). */
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
  /**
   * 오류 띠는 보드 맨 위에 하나다 — 폰에서 아래쪽 회차의 [종료]가 "누구누구 학생 확인이 필요합니다"로 막히면
   * 띠가 화면 밖이라 아무 일도 없는 것처럼 보였다(사용자 2026-10-07). 띠가 뜨면 보이는 곳까지 끌어온다.
   */
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
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
  /**
   * 숫자(요약 줄 · 호차 머리의 "N명 남음")는 **보기 필터와 무관하게 그날 DB 전체**(편성 × 기록)로 센다
   * (사용자 2026-10-06 "보이는 기준말고 확실하게 디비에 남은 기준으로"). 필터는 **그리는 회차만** 좁힌다 —
   * 숫자까지 따라 줄면 등원만 보는 중에 하원 미기록이 화면에서 사라진다.
   */
  const allGroups = useMemo(() => groupRunsByVehicle(byRun, vehicles), [byRun, vehicles]);
  const totals = useMemo(() => sumProgress(allGroups), [allGroups]);
  const progressByVehicle = useMemo(
    () => new Map(allGroups.map((g) => [g.vehicleId, g.progress])),
    [allGroups],
  );

  const href = (d: string, s: Season = season) => `/shuttle/today?d=${d}&season=${s}`;

  /**
   * 일회성 변경을 **이 화면에서 조정할 수 있나** — 0229a 적용 × 기록 권한 × 오늘 이후 날짜.
   * 🔴 지난 날짜는 읽기만 한다(그날의 기록이라 지우지 않는다). 서버가 같은 판정을 다시 한다([[#77]]).
   */
  const canEditException = canWrite && exceptionsReady && date >= today;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 📐 **면 전환 + 날짜 + 시즌을 한 줄로**(2026-09-03, 원장 *"한 페이지에 정보가 너무 많다"*). 날짜 이동은 앱
          전역 PeriodNav + 시즌 드롭다운(공용 ShuttleDayNav — 옛 outline 아이콘 버튼 둘 + 알약 칩 둘, 디자인 v5 17단계).
          탭 바는 `min-w-0`으로 줄어들고 남는 폭을 날짜·시즌이 쓴다. 좁아지면 `toolbar-rail`이 눕혀 한 줄을 유지한다.
          🔴 FaceTabs는 **공용 컴포넌트라 손대지 않는다** — 수납·학생상세 등이 같이 쓴다. 여기선 감싸는 자리만 바꾼다. */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_TODAY_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ShuttleDayNav date={date} today={today} season={season} hrefFor={href} />
      </div>

      {/* 등하원 + 요약을 **한 레일**로 — 폰에서 상단 크롬이 세 줄이 되면 첫 호차까지 스크롤이 필요하다
          ("모바일 상단 크롬 = 한 줄" 규약 · 제보의 "아주 필요한 기능만"). */}
      <div className={`${SHUTTLE_TOOLBAR} text-sm`}>
        {/* 등하원 보기 = `등하원: 전체` 드롭다운(§10 — 옛 알약 칩 셋). 계정 귀속 상태(URL 아님)라 `HrefSelect`의 **값 모드**
            (`onSelect`) — 목록이 Portal이라 폰의 `.toolbar-rail`(overflow-y hidden) 안에서도 열리고 검색 입력이 없다
            (`SearchableSelect`는 인라인 목록이라 잘려서 안 열렸다 — 셔틀 리뷰 🔴 2026-09-04). 항목 옆 남은 수 hint는
            뺐다 — 남은 명수는 호차 머리 하나만 말한다(사용자 2026-10-06). */}
        <HrefSelect
          axisLabel="등하원"
          ariaLabel="등하원 보기"
          value={dirFilter}
          onSelect={(v) => pickDirection(v as DirectionFilter)}
          options={DIR_FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
          }))}
        />
        {/* 📐 **0인 숫자를 색 알약으로 강조하지 않는다**(2026-09-03). 아침엔 탑승·미탑승이 둘 다 0이라
            초록·빨강 알약 두 개가 아무 뜻 없이 눈을 끌었고, 정작 할 일인 '미기록'이 그 사이에 묻혔다.
            🔴 **'미기록 N'은 닫힌 상태에서도 보여야 한다** — 옛 칩이 방향별 남은 수를 상시 보였는데 드롭다운으로 접으며
               사라졌다(셔틀 리뷰 🟠 2026-09-04). 할 일(미기록)은 caution, 일어난 일(탑승·미탑승)은 positive/critical —
               전부 0이면 흐린 글자. 방향별 분할은 드롭다운 항목의 hint가 든다.
            🔑 이 숫자는 **필터와 무관한 그날 전체**다(사용자 2026-10-06) — 드롭다운 hint와 같은 기준이라 서로 안 어긋난다. */}
        <span className="text-text-dim whitespace-nowrap">
          전체 예정{" "}
          <span className="num text-foreground font-bold">{totals.planned}</span>명
        </span>
        {totals.unmarked > 0 ? (
          <Pill color={TONE_COLOR.caution}>미기록 {totals.unmarked}</Pill>
        ) : (
          <span className="text-text-faint whitespace-nowrap">
            미기록 <span className="num">0</span>
          </span>
        )}
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
          // 이 면의 상시 버튼 하나 = Primary(§10) — 모양은 main의 v5 규약 그대로 두고,
          // 이름만 셔틀 세션의 개칭을 따른다(일회성 변경 → 오늘만 승하차).
          <Button className="ml-auto" onClick={() => setExceptionOpen(true)}>
            오늘만 승하차
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
        <div ref={errorRef} role="alert" className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-3 py-2 text-xs">
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
          <VehicleHeader
            group={group}
            progress={progressByVehicle.get(group.vehicleId) ?? group.progress}
            dirFilter={dirFilter}
          />
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
