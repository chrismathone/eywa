"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, GraduationCap, MessagesSquare, UserX } from "@/components/icons/eywa-icon-compat";
import { cn } from "@/lib/utils";
import { ColumnCards } from "./column-cards";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";
import { setEnrollmentOutcome } from "@/features/enrollment/server/actions";
import {
  BOARD_STAGES,
  dropBlockReason,
  outcomeForDrop,
  stageOfCard,
  type BoardStageColor,
  type BoardStageKey,
} from "@/features/enrollment/board-stages";

/**
 * 칸 색 — 🔴 **아이콘이 아니라 머리 줄 배경**이 색을 갖는다(원장 2026-09-01 *"상단부분 아이콘 색상을
 * 두지말고 배경색상으로 교체하자"*). 종전엔 26px짜리 색 칩 하나뿐이라 네 칸이 멀리서 보면 다 똑같았다.
 */
const HEADER_BG: Record<BoardStageColor, string> = {
  green: "bg-green-soft",
  blue: "bg-blue-soft",
  amber: "bg-amber-soft",
  neutral: "bg-bg-soft",
};

/**
 * 칸 테두리 — 원장 2026-09-01 *"테두리 더 진하게 각 칸반별로"*. 카드의 기본 헤어라인 링(팔레트 v4
 * `--shadow-card` 첫 레이어)만으론 칸 경계가 거의 안 보였다 → 칸 색을 **띤 실선**을 한 겹 더 두른다.
 * ⚠️ 색은 머리 배경과 **같은 색상**이다(같은 칸이 두 색을 갖지 않게).
 */
const COLUMN_BORDER: Record<BoardStageColor, string> = {
  green: "border-green/45",
  blue: "border-blue/45",
  amber: "border-amber/45",
  neutral: "border-line-strong",
};

function columnIcon(key: BoardStageKey) {
  switch (key) {
    case "before":
      return <CalendarClock size={16} strokeWidth={1.8} />;
    case "consulted":
      return <MessagesSquare size={16} strokeWidth={1.8} />;
    case "unregistered":
      return <UserX size={16} strokeWidth={1.8} />;
    case "enrolled":
      return <GraduationCap size={16} strokeWidth={1.8} />;
  }
}

/**
 * 등록상담 칸반 보드 — **4칸**(상담 전 · 상담 완료 · 미등록 · 등록 완료, 원장 2026-09-01).
 * - xl(넓은 화면): 4열 그리드로 모든 컬럼 동시 노출.
 * - xl 미만(좁은 화면): 상단 탭바로 컬럼을 전환해 한 번에 1개만 보여 세로 스크롤을 줄인다.
 *
 * 🔑 **드래그로 칸을 앞뒤로 옮긴다.** 칸:outcome이 1:N이라 대표값 규칙이 필요한데(원래 값이 그 칸
 *    안이면 유지) 판정은 전부 [board-stages](@/features/enrollment/board-stages) 순수 모듈이 한다.
 *    쓰기는 상세 '상태 변경' 드롭다운과 **같은 서버 액션**(`setEnrollmentOutcome`)을 탄다 — 경로가
 *    갈리면 부수효과(revalidate·전환 가드)가 한쪽에만 붙는다.
 *
 * ⚠️ 좁은 화면은 한 번에 한 칸만 보이므로 **드래그로 칸을 건너갈 수 없다** — 그쪽의 정식 경로는
 *    카드를 열어 '상태 변경'이다(셔틀 편성 보드의 '+ 학생'과 같은 결).
 * ⚠️ 센서는 `MouseSensor` 하나다. `PointerSensor`를 쓰면 **손가락 스크롤이 5px에서 드래그로 바뀌어**
 *    폰에서 목록을 못 내린다(좁은 화면에선 드래그가 쓸모도 없다).
 * ⚠️ `DragOverlay`는 position:fixed라 transform 걸린 조상이 있으면 커서와 어긋난다([[#98]]) —
 *    이 트리의 래퍼는 grid/flex만 쓴다.
 */
export function EnrollmentKanban({
  items,
  nowMs,
  canWrite,
}: {
  items: ConsultationListRow[];
  nowMs: number;
  /** 등록상담 쓰기 권한. 화면 조건은 게이트가 아니다 — 서버 액션이 같은 판정을 다시 한다([[#77]]). */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState<ConsultationListRow | null>(null);
  /**
   * 보드 위 한 줄 안내. `warn` = 못 옮긴 이유 / `info` = 옮기긴 했는데 알아야 할 것.
   * 🔴 성공에도 안내가 필요한 경우가 있다 — '등록 완료'는 **한 방향**이라(뒤로는 '미등록'뿐) 드래그
   *    한 번으로 잠기는데, 옛 드롭다운은 상세 화면을 열고 고르는 절차라 실수가 어려웠다.
   */
  const [notice, setNotice] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [, startTransition] = useTransition();
  /**
   * 낙관적 이동 — `{ 상담 id: { from: 서버가 준 outcome, to: 방금 보낸 outcome } }`.
   * 🔑 서버 값이 아직 `from`일 때만 덮어쓴다 → 새로고침으로 서버가 따라잡으면 **저절로 무효**가 되고,
   *    그 사이 누가 다른 값으로 바꿨으면 진실이 이긴다(effect에서 setState 하지 않는다, [[#25]]).
   */
  const [moves, setMoves] = useState<Record<string, { from: string; to: string }>>({});
  /**
   * 방금 옮긴 카드 — 받는 칸이 그 카드가 있는 페이지를 펴게 한다.
   * 🔴 없으면 "옮겼는데 없어졌다"가 난다: 카드는 상담일 역순으로 꽂혀서, 페이지가 여러 장인 칸에
   *    오래된 상담을 놓으면 2·3페이지로 들어가 **원래 칸에서는 사라지고 새 칸엔 안 보인다.**
   */
  const [movedId, setMovedId] = useState<string | null>(null);

  // 5px 임계값 — 없으면 카드 클릭(창 열기)이 드래그로 먹힌다.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }));

  const outcomeOf = (c: ConsultationListRow): string => {
    const m = moves[c.id];
    return m && c.outcome === m.from ? m.to : c.outcome;
  };
  const stageOf = (c: ConsultationListRow): BoardStageKey =>
    stageOfCard({ outcome: outcomeOf(c), assignedClassCount: c.assignedClassCount });

  const columns = BOARD_STAGES.map((stage) => ({
    stage,
    cards: items.filter((c) => stageOf(c) === stage.key),
  }));

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const cardId = e.active.data.current?.cardId as string | undefined;
    const target = e.over?.data.current?.stage as BoardStageKey | undefined;
    if (!cardId || !target || !canWrite) return;
    const card = items.find((c) => c.id === cardId);
    if (!card) return;

    const current = outcomeOf(card);
    const from = { outcome: current, assignedClassCount: card.assignedClassCount };
    if (stageOfCard(from) === target) return; // 제자리 = 아무 일도 안 한다(빈 저장 금지)

    const blocked = dropBlockReason(from, target);
    if (blocked) {
      setNotice({ tone: "warn", text: blocked });
      return;
    }
    const next = outcomeForDrop(target, current);
    if (next === current) return;

    setNotice(null);
    // 낙관적 이동의 기준점은 **서버가 준 값**(card.outcome)이다 — 화면 값(current)으로 잡으면
    // 연달아 끌었을 때 서버가 아직 옛 값이라 덮어쓰기가 끊기고 카드가 되돌아간다.
    setMoves((m) => ({ ...m, [card.id]: { from: card.outcome, to: next } }));
    setMovedId(card.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", card.id);
      fd.set("outcome", next);
      const res = await setEnrollmentOutcome(undefined, fd);
      if (res?.error) {
        // 실패 = 원위치 + 한글 사유(서버가 만든 문장 그대로 — raw 코드가 아니다).
        setMoves((m) => {
          const rest = { ...m };
          delete rest[card.id];
          return rest;
        });
        setMovedId(null);
        setNotice({ tone: "warn", text: res.error });
        return;
      }
      // 되돌리기가 좁아지는 이동만 알린다(나머지는 조용히 — 성공 토스트가 매번 뜨면 아무도 안 읽는다).
      if (target === "enrolled") {
        setNotice({
          tone: "info",
          text: "'등록 완료'로 옮겼습니다 — 이 상태는 '미등록'으로만 되돌릴 수 있습니다(상세 화면의 '상태 변경'도 같은 규칙).",
        });
      }
      router.refresh();
    });
  }

  return (
    <DndContext
      // SSR 하이드레이션 불일치 방지 — dnd-kit은 명시 id가 없으면 자동 id를 만든다([[#51]]).
      id="enrollment-kanban"
      sensors={sensors}
      collisionDetection={(args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args))}
      onDragStart={(e: DragStartEvent) => {
        setNotice(null);
        setMovedId(null);
        setDragging(items.find((c) => c.id === e.active.data.current?.cardId) ?? null);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {notice ? (
        <div
          className={cn(
            "mb-3 flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
            notice.tone === "warn"
              ? "border-amber/30 bg-amber-soft text-amber"
              : "border-blue/30 bg-blue-soft text-blue",
          )}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 font-bold opacity-70 hover:opacity-100"
            aria-label="안내 닫기"
          >
            닫기
          </button>
        </div>
      ) : null}

      {/* 좁은 화면 전용 탭바 — xl(4열)부터 숨김 */}
      <div className="mb-2.5 flex gap-1.5 overflow-x-auto xl:hidden">
        {columns.map((col, i) => (
          <button
            key={col.stage.key}
            type="button"
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
              i === active
                ? "bg-foreground text-background"
                : "bg-bg-soft text-text-dim hover:text-foreground"
            }`}
          >
            {col.stage.label}
            <span className="num text-sm opacity-70">{col.cards.length}</span>
          </button>
        ))}
      </div>

      {/* 컬럼 그리드 — xl에서 4열, 좁으면 활성 탭 1개만 노출 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        {columns.map((col, i) => (
          <StageColumn
            key={col.stage.key}
            stageKey={col.stage.key}
            label={col.stage.label}
            color={col.stage.color}
            cards={col.cards}
            nowMs={nowMs}
            canWrite={canWrite}
            visible={i === active}
            dragging={!!dragging}
            focusId={movedId}
            onUserPaged={() => setMovedId(null)}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="bg-card shadow-card text-foreground rounded-xl px-3.5 py-2.5 text-lg font-bold">
            {dragging.prospectName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function StageColumn({
  stageKey,
  label,
  color,
  cards,
  nowMs,
  canWrite,
  visible,
  dragging,
  focusId,
  onUserPaged,
}: {
  stageKey: BoardStageKey;
  label: string;
  color: BoardStageColor;
  cards: ConsultationListRow[];
  nowMs: number;
  canWrite: boolean;
  /** 좁은 화면에서 이 칸이 활성 탭인지(넓은 화면은 항상 보인다). */
  visible: boolean;
  /** 지금 무언가를 끌고 있는지 — 놓을 자리를 눈에 띄게 한다. */
  dragging: boolean;
  /** 방금 옮긴 카드 id(이 칸에 없으면 무시된다) — ColumnCards가 그 페이지를 편다. */
  focusId: string | null;
  onUserPaged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stageKey}`,
    data: { stage: stageKey },
    disabled: !canWrite,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-card shadow-card min-h-[280px] flex-col rounded-3xl border transition-shadow xl:flex",
        COLUMN_BORDER[color],
        visible ? "flex" : "hidden",
        // 끌고 있을 때만 놓을 자리를 표시 — 평소엔 위 칸 색 테두리 그대로.
        dragging && canWrite && "ring-line ring-2",
        isOver && "ring-primary ring-2",
      )}
    >
      {/* 컬럼 헤더 — 칸 색을 **띠로** 깐다(위 HEADER_BG 주석). 아이콘은 색 칩을 벗고 라벨과 같은 톤으로.
          ⚠️ `rounded-t-3xl`은 컨테이너(rounded-3xl)와 같은 반경 — 안 맞추면 띠가 모서리를 네모로 덮는다. */}
      <header
        className={cn(
          "border-line flex items-center justify-between rounded-t-3xl border-b px-4 py-2.5",
          HEADER_BG[color],
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-dim flex items-center justify-center">{columnIcon(stageKey)}</span>
          <h3 className="text-foreground text-base font-bold">{label}</h3>
        </div>
        <span className="flex items-baseline gap-0.5">
          <span className="num text-foreground text-xl leading-none font-bold">{cards.length}</span>
          <span className="text-text-faint text-sm">건</span>
        </span>
      </header>
      {cards.length === 0 ? (
        <div className="text-text-faint flex flex-1 items-center justify-center px-4 text-sm">
          없음
        </div>
      ) : (
        <ColumnCards
          cards={cards}
          nowMs={nowMs}
          stage={stageKey}
          draggable={canWrite}
          focusId={focusId}
          onUserPaged={onUserPaged}
        />
      )}
    </div>
  );
}
