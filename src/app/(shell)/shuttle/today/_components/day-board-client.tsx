"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
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
import { saveShuttleTodayPrefs } from "@/features/shuttle/today/server/today-prefs";
import { countProgress, groupRunsByVehicle, sumProgress } from "@/features/shuttle/today/today-board";
import { tripState } from "@/features/shuttle/today/trip-state";
import type { RideHit } from "@/features/shuttle/today/ride-search";
import { useShuttleLive } from "@/features/shuttle/live/use-shuttle-live";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import { RideExceptionDialog } from "./ride-exception-dialog";
import { RideJump } from "./ride-jump";
import { RiderContactsProvider } from "./rider-contacts";
import { RiderAttendanceProvider } from "./rider-attendance";
import type { RiderAttendance } from "@/features/shuttle/today/rider-attendance";
import type { RiderContact } from "@/features/shuttle/server/rider-contacts";
import { RunPanel } from "./run-panel";
import { ShuttleDayNav } from "../../_components/shuttle-day-nav";
import { VehicleHeader } from "./vehicle-header";
import { VehicleTabs } from "./vehicle-tabs";

/**
 * 오늘 등하원 — 회차마다 그날 예정 명단을 펼치고 한 줄씩 탑승/미탑승을 찍는다.
 *
 * 📱 **이 화면은 모바일이 1순위다**(원장 2026-08-19: *"셔틀 선생님은 모바일을 대부분 이용하시니까"*
 *    → *"아주 필요한 기능만 잘 있도록 호차 구분 및 시간 정리 등하원 체크 용이하게"*).
 *    · 날짜·시즌 칩은 `.toolbar-rail`로 눕힌다(좁은 화면에서 4줄로 감기던 자리).
 *    · **호차로 묶는다** — 차가 여럿이면 평평한 회차 목록에서 "지금 몇 호차를 보는지"가 사라져
 *      남의 차 회차를 자기 차로 착각한다. 호차 머리는 스크롤 중에도 붙어 있다(sticky).
 *    · **시각이 먼저다** — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다(정렬도 시각 순).
 *    · **호차 토글**로 내 차만 본다(사용자 2026-10-20 — 옛 등원/하원 드롭다운 대체, 고른 호차는 계정에 남는다).
 *    · **학생 찾아가기** — 이름을 고르면 그 호차·회차로 가서 그 줄을 비춘다(목록은 거르지 않는다).
 *    · 회차는 **접힌 채로 시작**하고 아직 안 찍은 회차만 펼친다 — 폰에서 7회차를 다 펼치면
 *      다 끝난 회차를 지나 스크롤해야 오늘 할 일이 나온다.
 *    · 진행 요약(찍은 수/전체)을 호차·회차 머리에 둬서 **접힌 채로도 남은 일이 보인다**.
 *    PC는 2열 그리드 그대로 — 넓은 화면에선 한눈에 다 보이는 게 맞다.
 *
 * ⚠️ 묶음·정렬·집계는 순수 [`today-board.ts`](@/features/shuttle/today/today-board)가 한다(Vitest) —
 *    이 파일은 그리기만. 새 집계를 여기서 손으로 세지 말 것.
 *
 * 🔴 아직 안 찍은 줄은 **회색 '미기록'**이지 미탑승이 아니다 — 안 찍은 걸 미탑승으로 읽으면
 *    아침 내내 전원이 미탑승으로 보이고 그게 출결 신호로 새어나간다(roster 주석).
 */
export function DayBoardClient({
  showTrack = false,
  date,
  season,
  vehicles,
  runs,
  logs,
  canWrite,
  initialVehicle,
  exceptions,
  exceptionsReady,
  students,
  today,
  trips,
  tripsReady,
  tenantId,
  contacts = {},
  attendance = {},
}: {
  /** 실시간 위치 탭을 붙일까 — 원장·관리자·총괄만(서버 `isShuttleAdmin`이 정한다). */
  showTrack?: boolean;
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  canWrite: boolean;
  /** 계정에 저장된 호차 보기(`users.ui_prefs.shuttleToday.vehicle`, null = 전체) — 열 때마다 다시 누르지 않게. */
  initialVehicle: string | null;
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
  /** 학생·학부모 전화번호(studentId → 번호) — 기록 권한이 있을 때만 페이지가 싣는다. 없으면 빈칸. */
  contacts?: Record<string, RiderContact>;
  /** 하원 줄의 그날 출석(studentId → 출석 줄) — 셔틀 관리자일 때만 페이지가 싣는다. */
  attendance?: Record<string, RiderAttendance[]>;
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
   * 호차 보기 — 화면은 즉시 바꾸고 **계정 저장은 뒤따른다**(반응속도 1순위).
   * ⚠️ 주소에 안 싣는 이유는 서버 왕복(스켈레톤 깜빡임)을 피하기 위해서지만, 그렇다고 휘발시키면
   *    열 때마다 내 차를 다시 눌러야 한다 → 보기 설정은 **계정 귀속**이 규칙이다(`users.ui_prefs`).
   */
  const [vehicleKey, setVehicleKey] = useState<string | null>(initialVehicle);
  function pickVehicle(next: string | null) {
    setVehicleKey(next);
    // 저장 실패는 조용히 넘긴다 — 지금 화면은 이미 바뀌었고, 다음 방문에 옛 값으로 열릴 뿐이다.
    void saveShuttleTodayPrefs({ vehicle: next });
  }
  /** 찾아간 줄 — 그려진 뒤 그 줄로 스크롤하고 잠깐 비춘다. */
  const [jumpKey, setJumpKey] = useState<{ key: string; n: number } | null>(null);

  const tripByRun = useMemo(() => new Map(trips), [trips]);
  /**
   * [종료]를 누르면 그 회차를 **접는다**(사용자 2026-10-21 "종료를 누르면 창이 닫히게") — 손으로 한 번 열거나 닫은 회차는
   * `manualOpen`이 기본 판정(종료 = 접힘)을 이겨서 종료 뒤에도 펼친 채 남았다. 그래서 **종료로 바뀌는 순간** 그 회차의
   * 손 기록을 지운다. 처음 열 때 이미 끝난 회차는 건드리지 않는다(이전 값으로 시작).
   */
  const endedIds = useMemo(() => trips.filter(([, t]) => t?.endedAt).map(([id]) => id).sort().join(","), [trips]);
  const prevEnded = useRef(endedIds);
  useEffect(() => {
    const before = new Set(prevEnded.current.split(",").filter(Boolean));
    prevEnded.current = endedIds;
    const newly = endedIds.split(",").filter((id) => id && !before.has(id));
    if (newly.length === 0) return;
    setManualOpen((m) => {
      if (!newly.some((id) => id in m)) return m;
      const next = { ...m };
      for (const id of newly) delete next[id];
      return next;
    });
  }, [endedIds]);

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

  /**
   * 숫자(요약 줄 · 호차 머리·토글의 "N명 남음")는 **보기 필터와 무관하게 그날 DB 전체**(편성 × 기록)로 센다
   * (사용자 2026-10-06 "보이는 기준말고 확실하게 디비에 남은 기준으로"). 호차 토글은 **그리는 호차만** 좁힌다.
   */
  const allGroups = useMemo(() => groupRunsByVehicle(byRun, vehicles), [byRun, vehicles]);
  const totals = useMemo(() => sumProgress(allGroups), [allGroups]);
  const progressByKey = useMemo(() => new Map(allGroups.map((g) => [g.key, g.progress])), [allGroups]);
  /**
   * 고른 호차가 그날 없으면(그 차가 오늘 안 돈다 · 차 이름이 바뀌었다) **전체**를 보인다 — 빈 화면으로 열면
   * "오늘 아무도 안 탄다"로 읽힌다. 저장값은 그대로 둔다(내일 그 차가 돌면 다시 그 차로 열린다).
   */
  const shownKey = vehicleKey && allGroups.some((g) => g.key === vehicleKey) ? vehicleKey : null;
  const groups = useMemo(
    () => (shownKey ? allGroups.filter((g) => g.key === shownKey) : allGroups),
    [allGroups, shownKey],
  );

  /** 학생 찾아가기 — 다른 호차를 보는 중이면 그 차로 옮기고, 그 회차를 펼친 뒤 그 줄을 비춘다. */
  function jumpTo(hit: RideHit) {
    if (shownKey && shownKey !== hit.vehicleKey) pickVehicle(hit.vehicleKey);
    setManualOpen((m) => ({ ...m, [hit.runId]: true }));
    setJumpKey((j) => ({ key: hit.rowKey, n: (j?.n ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!jumpKey) return;
    // 그려진 뒤(펼침·호차 전환이 반영된 다음 프레임)에 찾는다.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-ride-key="${CSS.escape(jumpKey.key)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      // 🔑 클래스를 붙이지 않고 Web Animations로 비춘다 — React가 다시 그려도 지워지지 않고, 끝나면 흔적이 없다.
      el.animate(
        [
          { boxShadow: "0 0 0 3px var(--primary)" },
          { boxShadow: "0 0 0 3px var(--primary)", offset: 0.6 },
          { boxShadow: "0 0 0 0 transparent" },
        ],
        { duration: 1800, easing: "ease-out" },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [jumpKey]);

  const href = (d: string, s: Season = season) => `/shuttle/today?d=${d}&season=${s}`;

  /**
   * 일회성 변경을 **이 화면에서 조정할 수 있나** — 0229a 적용 × 기록 권한 × 오늘 이후 날짜.
   * 🔴 지난 날짜는 읽기만 한다(그날의 기록이라 지우지 않는다). 서버가 같은 판정을 다시 한다([[#77]]).
   */
  const canEditException = canWrite && exceptionsReady && date >= today;

  return (
    <RiderContactsProvider value={contacts}>
    <RiderAttendanceProvider value={attendance}>
    <div className="flex min-h-0 flex-col gap-3">
      {/* 📐 **면 전환 + 날짜 + 시즌을 한 줄로**(2026-09-03, 원장 *"한 페이지에 정보가 너무 많다"*). 날짜 이동은 앱
          전역 PeriodNav + 시즌 드롭다운(공용 ShuttleDayNav — 옛 outline 아이콘 버튼 둘 + 알약 칩 둘, 디자인 v5 17단계).
          탭 바는 `min-w-0`으로 줄어들고 남는 폭을 날짜·시즌이 쓴다. 좁아지면 `toolbar-rail`이 눕혀 한 줄을 유지한다.
          🔴 FaceTabs는 **공용 컴포넌트라 손대지 않는다** — 수납·학생상세 등이 같이 쓴다. 여기선 감싸는 자리만 바꾼다. */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full lg:basis-auto">
          <FaceTabs faces={shuttleFaces(season, { track: showTrack })} active={SHUTTLE_TODAY_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ShuttleDayNav date={date} today={today} season={season} hrefFor={href} />
      </div>

      {/* 🚌 호차 토글 + 학생 찾아가기(사용자 2026-10-20) — 옛 `등하원: 전체` 드롭다운 자리.
          ⚠️ 툴바 레일 **밖**의 한 줄이다: 찾기 결과 겹판이 폰 `.toolbar-rail`(overflow 잘림) 안에선 안 보인다. */}
      {allGroups.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <VehicleTabs groups={allGroups} progressByKey={progressByKey} value={shownKey} onPick={pickVehicle} />
          {/* 넓은 화면(마우스)에선 아래 요약 줄의 미탑승 옆으로 간다(사용자 2026-10-21) — 여기는 폰·좁은 창·터치 자리.
              조건은 툴바 레일 규칙(globals.css .toolbar-rail 모바일 절)의 반대다: 레일이면 겹판이 잘리므로 레일 밖에 둔다. */}
          <div className="sm:ml-auto lg:pointer-fine:hidden">
            <RideJump groups={allGroups} onPick={jumpTo} />
          </div>
        </div>
      )}

      {/* 요약을 **한 레일**로 — 폰에서 상단 크롬이 세 줄이 되면 첫 호차까지 스크롤이 필요하다
          ("모바일 상단 크롬 = 한 줄" 규약 · 제보의 "아주 필요한 기능만"). */}
      <div className={`${SHUTTLE_TOOLBAR} text-sm`}>
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
        {/* 학생 찾기 — 넓은 화면(마우스)에선 탑승·미탑승 바로 옆(사용자 2026-10-21). 이때는 레일이 아니라 겹판이 안 잘린다. */}
        {allGroups.length > 0 && (
          <div className="hidden lg:pointer-fine:block">
            <RideJump groups={allGroups} onPick={jumpTo} />
          </div>
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
          {/* 호차 토글은 그날 도는 차만 세우고, 고른 차가 없으면 전체로 접힌다 — 여기 오면 그날 정말 아무도 안 탄다. */}
          이 날짜에 타기로 되어 있는 학생이 없습니다.
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

      {/* 🚌 **호차는 옆으로, 회차는 밑으로**(사용자 2026-10-16 "호차가 밑으로 나열이자나 이걸 옆으로 · 내용은 밑으로") —
          호차마다 한 열. 몇 열이 서는지는 **이 판의 실제 폭**으로 정한다(열 하나 최소 24rem — 그보다 좁으면 종전처럼 위아래로 쌓인다, 폰 포함). */}
      {/* 📐 **폰과 같은 모양**(사용자 2026-10-21 "폰화면에서 보는 뷰랑 최대한 비슷하게 · 굳이 꽉 채우지 않아도 돼") —
          호차 열은 **폰 폭(26rem ≈ 416px)으로 고정**하고 왼쪽부터 나란히 선다. 열이 넓으면 학생 줄이 "이름 | 버튼" 가로 배치로
          바뀌어(@lg/row) 폰과 딴 화면이 됐다. 판이 좁으면(폰) 종전대로 한 열을 꽉 채운다. 호차 하나만 볼 때도 같은 폭. */}
      {/* ↔️ **전체 = 호차를 한 줄로**(사용자 2026-10-28 "전체로 하면 있는 호차들을 전부 가로로 정렬") — 넓은 판에서도 다음 줄로
          접지 않고 옆으로 이어 세운다(넘치면 가로 스크롤). 한 호차만 볼 때·폰 폭은 종전 그대로. */}
      <div className="@container/board">
       <div className={shownKey ? undefined : "@xl/board:overflow-x-auto @xl/board:pb-2"}>
       <div
         className={`grid grid-cols-1 items-start gap-4 ${
           shownKey ? "@xl/board:grid-cols-[repeat(auto-fill,26rem)]" : "@xl/board:grid-flow-col @xl/board:auto-cols-[26rem] @xl/board:grid-cols-none"
         }`}
       >
      {groups.map((group) => (
        <section key={group.key} className="flex min-w-0 flex-col gap-2">
          <VehicleHeader group={group} progress={progressByKey.get(group.key) ?? group.progress} />
          {/* 그 호차의 회차는 위에서 아래로(시간순) — 열 안에서 내용이 밑으로 밀린다. */}
          <div className="flex flex-col gap-3">
            {group.runs.map(({ run, rows }) => {
              const progress = countProgress(rows);
              // 🔑 오늘은 **[종료]를 누르기 전까지 펼친 채**(사용자 2026-10-21 "마지막 학생까지 누르면 바로 좁혀지더라 — 종료까지 누른 뒤로").
              //    지난 날짜·운행 기록 표가 없는 DB는 종전대로 "안 찍은 줄이 남았나"로 연다(종료 기록이 없는 옛 회차가 전부 펼쳐지지 않게).
              const trip = tripByRun.get(run.id) ?? null;
              const autoOpen = tripsReady && date === today ? tripState(trip) !== "done" : progress.unmarked > 0;
              const open = manualOpen[run.id] ?? autoOpen;
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
                  trip={trip}
                  tripsReady={tripsReady}
                  today={today}
                />
              );
            })}
          </div>
        </section>
      ))}
       </div>
       </div>
      </div>
    </div>
    </RiderAttendanceProvider>
    </RiderContactsProvider>
  );
}
