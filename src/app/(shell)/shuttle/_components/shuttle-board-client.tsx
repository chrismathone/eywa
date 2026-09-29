"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ExcelImportButton } from "@/components/excel-import/excel-import-button";
import { cn } from "@/lib/utils";
import { SHUTTLE_PHONE_CONTROLS, SHUTTLE_ROW_TEXT, SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";
import { SHUTTLE_BOARD_PATH, shuttleFaces } from "@/features/shuttle/faces";
import {
  SEASON_LABEL,
  runTitle,
  type Season,
  type ShuttleRun,
  type ShuttleStop,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import {
  assignRider,
  moveRider,
  removeRider,
  reorderRunStops,
} from "@/features/shuttle/server/actions";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import { RunColumn } from "./run-column";
import { StopColumn } from "./stop-column";
import { StudentPool } from "./student-pool";
import { StopMasterDialog } from "./stop-master-dialog";
import { ShuttleSeasonSelect } from "./shuttle-day-nav";
import { ShuttlePrintMenu } from "./shuttle-print-menu";

/**
 * 셔틀 노선 편성 보드 — 3열(회차 / 노선 / 학생). 편집은 드래그&드롭이 기본이다
 * (원장 2026-08-19: *"아주 직관적이고 손쉽게 드래그드랍으로 편하게"*).
 *
 * 드래그 규칙 4가지 — 모두 같은 DndContext, `data.type`으로 갈린다(통합뷰 편집 보드와 같은 관용구):
 *  · 학생 풀 → 정류장 = 배정(기본 승/하차는 그 회차 성격, 요일은 평일로 시작 후 칩에서 조정)
 *  · 배정 칩 → 다른 정류장 = 이동
 *  · 배정 칩 → 학생 풀 = 배정 해제
 *  · 정류장 손잡이 → 위아래 = 노선 순서 변경(sort_order 전체 재부여)
 *
 * 📱 **좁은 화면은 3열을 탭으로 접는다**(다열 보드 규약) — 세로로 쌓으면 학생 풀을 보려고 노선
 *    290줄을 지나야 한다. 다만 **탭이 갈리면 드래그로 건너갈 수 없으므로**, 정류장 카드의
 *    '+ 학생' 버튼(비드래그 경로)이 폰에서의 기본 배정 수단이다 — 드래그는 PC의 빠른 길이다.
 * 📱 터치는 `TouchSensor`(길게 눌러 250ms) — 임계값 없이 붙이면 손가락 스크롤이 전부 드래그가 된다.
 *
 * ⚠️ DragOverlay는 `position:fixed`라 **transform 걸린 조상이 있으면 커서와 어긋난다**([[#98]]) —
 *    이 트리의 래퍼는 flex/grid만 쓴다(-translate-x-1/2 같은 센터링 금지).
 */
const PANES = [
  { key: "runs", label: "회차" },
  { key: "route", label: "노선" },
  { key: "students", label: "학생" },
] as const;
type PaneKey = (typeof PANES)[number]["key"];

export function ShuttleBoardClient({
  season,
  vehicles,
  runs,
  stops,
  students,
  selectedRunId,
  canWrite,
  canImport = false,
  coordsReady,
}: {
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  stops: ShuttleStop[];
  students: AssignableStudent[];
  selectedRunId: string | null;
  canWrite: boolean;
  /** 엑셀로 넣기(정류장·승하차) — 서버가 올리기 주소와 같은 `canManageTenant`로 정한 값. */
  canImport?: boolean;
  /** 0244a(정류장 좌표) 적용 여부 — 정류장 관리 다이얼로그가 위치 입력을 그릴지 판단한다([[#95]]). */
  coordsReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [pane, setPane] = useState<PaneKey>("route");

  // 5px 임계값 — 없으면 칩 안 요일 토글·시각 입력 클릭이 드래그로 먹힌다(통합뷰와 같은 값).
  // 터치는 거리가 아니라 **시간**으로 가른다 — 손가락은 스크롤하며 늘 몇 px 움직인다.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  /** 이 시즌에 이미 배정된 학생 id — 풀에서 흐리게 표시(중복 배정 자체는 막지 않는다: 회차마다 탄다). */
  const assignedIds = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs) for (const s of run.stops) for (const r of s.riders) set.add(r.studentId);
    return set;
  }, [runs]);

  function run(action: () => Promise<{ error?: string; notice?: string } | undefined>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  /** 비드래그 배정 경로 — 폰에서 정류장 카드의 '+ 학생'이 이걸 부른다. */
  function assign(runStopId: string, studentId: string) {
    if (!activeRun) return;
    const fd = new FormData();
    fd.set("runStopId", runStopId);
    fd.set("studentId", studentId);
    fd.set("ioKind", activeRun.direction);
    fd.set("weekdays", "mon,tue,wed,thu,fri"); // 평일로 시작 — 칩에서 바로 줄인다
    run(() => assignRider(fd));
  }

  function onDragStart(e: DragStartEvent) {
    setDragLabel((e.active.data.current?.label as string) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = e;
    if (!over || !canWrite || !activeRun) return;
    const a = active.data.current as
      | { type: "student"; studentId: string; label: string }
      | { type: "rider"; riderId: string; label: string }
      | { type: "stopRow"; runStopId: string; label: string }
      | undefined;
    const o = over.data.current as
      | { type: "stop"; runStopId: string }
      | { type: "pool" }
      | { type: "stopRow"; runStopId: string }
      | undefined;
    if (!a || !o) return;

    // ① 학생 풀 → 정류장 = 배정
    if (a.type === "student" && o.type === "stop") {
      assign(o.runStopId, a.studentId);
      return;
    }
    // ② 배정 칩 → 다른 정류장 = 이동
    if (a.type === "rider" && o.type === "stop") {
      run(() => moveRider(a.riderId, o.runStopId));
      return;
    }
    // ③ 배정 칩 → 학생 풀 = 해제
    if (a.type === "rider" && o.type === "pool") {
      const fd = new FormData();
      fd.set("id", a.riderId);
      run(() => removeRider(fd));
      return;
    }
    // ④ 정류장 손잡이 → 다른 정류장 자리 = 순서 변경
    if (a.type === "stopRow" && (o.type === "stopRow" || o.type === "stop")) {
      const ids = activeRun.stops.map((s) => s.id);
      const from = ids.indexOf(a.runStopId);
      const to = ids.indexOf(o.runStopId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...ids];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      run(() => reorderRunStops(activeRun.id, next));
    }
  }

  // 머리의 값(§4 설명 문장 대신) — 보드가 이미 실은 것만 센다(추가 조회 0). 🔴 `students`는 배정 **가능한** 재원생 전원이라
  //    '학생 N명'이라 적으면 거짓 숫자다(리뷰 2026-09-04) — 배정된 사람은 `assignedIds`.
  const boardSummary = `차량 ${vehicles.length}대 · 회차 ${runs.length}개 · 정류장 ${stops.length}곳 · 배정 ${assignedIds.size}명`;

  return (
    <DndContext
      // SSR 하이드레이션 불일치 방지 — dnd-kit은 명시 id가 없으면 자동 id를 만든다([[#51]]).
      id="shuttle-board"
      sensors={sensors}
      collisionDetection={(args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args))}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      {/* 머리(지시서 §10, 디자인 v5 17단계 2026-09-04): 설명 문장 → 값(차량·회차·정류장·학생 수) · 상시 버튼 =
          Primary '정류장 관리'(쓰기 권한) + 텍스트 '인쇄 ▾'(오늘 노선표·전체 편성표 — 옛 outline 셋).
          📱 인쇄는 **거친 포인터**(손으로 쓰는 기기)에서 감춘다(원장 2026-08-19: *"모바일에서는 인쇄 버튼 필요 없을거같은데"*)
             — 폭 기준(`md:`)이면 좁은 플로팅 창에서도 사라져서, 기준은 폭이 아니라 포인터다. 순수 CSS(JS 조건 마운트는
             첫 페인트에 번쩍이는 CLS + hydration 불일치). */}
      <PageHeader
        eyebrow="셔틀"
        title="노선 편성"
        embedLabel={`${SEASON_LABEL[season]} 노선 · ${boardSummary}`}
        description={boardSummary}
        actions={
          // 📱 머리 버튼도 폰에선 44px — 툴바 래퍼와 같은 변수 덮어쓰기(SHUTTLE_PHONE_CONTROLS).
          <span className={`flex items-center gap-2 ${SHUTTLE_PHONE_CONTROLS}`}>
            <span className="pointer-coarse:hidden">
              <ShuttlePrintMenu season={season} />
            </span>
            {canImport ? (
              <span className="pointer-coarse:hidden">
                <ExcelImportButton kind="shuttle" variant="ghost" label="엑셀로 넣기" />
              </span>
            ) : null}
            {canWrite && <Button onClick={() => setStopDialogOpen(true)}>정류장 관리</Button>}
          </span>
        }
      />

      {/* 📐 **면 전환 + 시즌을 한 줄로**(2026-09-03, 원장 *"한 페이지에 정보가 너무 많다"*). 시즌은 `시즌: 학기중`
          드롭다운(§10 — 옛 알약 칩 둘). 탭을 `min-w-0`로 줄이고 남는 폭을 시즌이 쓴다.
          📱 폰엔 사이드바(하부탭)가 없어 '오늘 등하원'으로 갈 길이 이 탭뿐이다(faces.ts).
          🔴 FaceTabs는 공용 컴포넌트라 손대지 않는다 — 감싸는 자리만 바꾼다. */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_BOARD_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ShuttleSeasonSelect season={season} hrefFor={(s) => `${SHUTTLE_BOARD_PATH}?season=${s}`} />
        {!canWrite && (
          <span className="text-text-faint text-sm whitespace-nowrap">
            열람 전용 — 편성은 사무실에서 수정합니다
          </span>
        )}
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      {/* 📱 좁은 화면 = 탭 전환(한 번에 한 면). lg부터는 탭바가 사라지고 3열이 전부 펼쳐진다. */}
      <nav className="border-line flex gap-1 border-b lg:hidden" aria-label="보기 전환">
        {PANES.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPane(p.key)}
            aria-current={pane === p.key ? "page" : undefined}
            className={cn(
              "-mb-px min-h-11 cursor-pointer border-b-2 px-3 font-bold",
              SHUTTLE_ROW_TEXT,
              pane === p.key
                ? "border-primary text-primary"
                : "text-text-dim hover:text-foreground border-transparent",
            )}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(190px,15rem)_minmax(0,1fr)_minmax(200px,17rem)]">
        <div className={pane === "runs" ? "flex min-h-0 flex-col lg:flex" : "hidden lg:flex lg:min-h-0 lg:flex-col"}>
          <RunColumn
            season={season}
            vehicles={vehicles}
            runs={runs}
            activeRunId={activeRun?.id ?? null}
            canWrite={canWrite}
            onError={setError}
            onPick={() => setPane("route")}
          />
        </div>
        <div className={pane === "route" ? "flex min-h-0 flex-col lg:flex" : "hidden lg:flex lg:min-h-0 lg:flex-col"}>
          <StopColumn
            run={activeRun}
            stops={stops}
            students={students}
            canWrite={canWrite}
            pending={pending}
            onError={setError}
            onAssign={assign}
          />
        </div>
        <div
          className={pane === "students" ? "flex min-h-0 flex-col lg:flex" : "hidden lg:flex lg:min-h-0 lg:flex-col"}
        >
          <StudentPool students={students} assignedIds={assignedIds} canWrite={canWrite} />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragLabel ? (
          <span className="border-primary/40 bg-card text-foreground rounded-pill border px-2.5 py-1 text-xs font-bold shadow-lg">
            {dragLabel}
          </span>
        ) : null}
      </DragOverlay>

      {stopDialogOpen && (
        <StopMasterDialog
          stops={stops}
          // '노선 N곳'을 펼치려면 어느 노선이 그 정류장을 쓰는지가 필요한데, 보드가 이미 싣고 있다
          // (추가 조회 0). 시즌 라벨을 함께 넘겨 "지금 보는 시즌 기준"임을 화면에 적는다.
          runs={runs}
          vehicles={vehicles}
          seasonLabel={SEASON_LABEL[season]}
          coordsReady={coordsReady}
          onClose={() => setStopDialogOpen(false)}
          onError={setError}
        />
      )}

      {activeRun && (
        <p className="text-text-faint text-xs">
          {runTitle(activeRun)} — 정류장 {activeRun.stops.filter((s) => s.kind === "stop").length}곳 ·
          배정 {activeRun.stops.reduce((n, s) => n + s.riders.length, 0)}명
        </p>
      )}
    </DndContext>
  );
}
