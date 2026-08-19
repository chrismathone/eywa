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
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  SEASON_LABEL,
  SEASONS,
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
}: {
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  stops: ShuttleStop[];
  students: AssignableStudent[];
  selectedRunId: string | null;
  canWrite: boolean;
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
      <PageHeader
        eyebrow="셔틀"
        title="노선 편성"
        embedLabel={`${SEASON_LABEL[season]} 노선`}
        description="차량·회차별 정류장 순서와 승하차 학생을 편성합니다."
        actions={
          <>
            {/* 인쇄는 플로팅 창 + A4 규약 — `(print)` 라우트를 새 창으로 연다(design-conventions). */}
            <Button variant="outline" onClick={() => window.open(`/shuttle/route?season=${season}`, "_blank")}>
              오늘 노선표 인쇄
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open(`/shuttle/route?season=${season}&d=all`, "_blank")}
            >
              전체 편성표 인쇄
            </Button>
            {canWrite && (
              <Button variant="outline" onClick={() => setStopDialogOpen(true)}>
                정류장 관리
              </Button>
            )}
          </>
        }
      />

      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        {SEASONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => router.push(`/shuttle?season=${s}`)}
            className={`rounded-pill flex h-10 items-center px-3.5 text-[12.5px] font-bold whitespace-nowrap transition-colors ${
              s === season
                ? "bg-primary text-primary-foreground"
                : "border-line text-text-dim hover:bg-muted border"
            }`}
          >
            {SEASON_LABEL[s]}
          </button>
        ))}
        {!canWrite && (
          <span className="text-text-faint text-[12px] whitespace-nowrap">
            열람 전용 — 편성은 사무실에서 수정합니다
          </span>
        )}
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-3 py-2 text-[12.5px]">
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
            className={`-mb-px min-h-11 border-b-2 px-3 text-[13px] font-bold ${
              pane === p.key
                ? "border-primary text-primary"
                : "text-text-dim hover:text-text border-transparent"
            }`}
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
          <span className="border-primary/40 bg-card text-text rounded-pill border px-2.5 py-1 text-[12px] font-bold shadow-lg">
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
          onClose={() => setStopDialogOpen(false)}
          onError={setError}
        />
      )}

      {activeRun && (
        <p className="text-text-faint text-[11.5px]">
          {runTitle(activeRun)} — 정류장 {activeRun.stops.filter((s) => s.kind === "stop").length}곳 ·
          배정 {activeRun.stops.reduce((n, s) => n + s.riders.length, 0)}명
        </p>
      )}
    </DndContext>
  );
}
