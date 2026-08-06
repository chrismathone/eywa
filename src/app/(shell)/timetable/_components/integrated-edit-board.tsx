"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { saveIntegrationGroups } from "@/features/owner/server/subject-actions";
import {
  OTHERS_GROUP_ID,
  groupRichCards,
  type RichCardGroup,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { POOL_ID, dedupeGroups, moveClass, reorderGroups, type GroupDraft } from "@/features/timetable/lib/group-assign";
import type { GroupPreset } from "@/features/timetable/lib/group-presets";
import { DEFAULT_OTHERS_TITLE } from "@/features/timetable/lib/integration-groups";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { TimetableZoomArea } from "./font-size-toggle";
import { GroupPresetBar } from "./group-preset-bar";
import { RichCardGroupBoard, ClassColumn, NAME_H, type ColumnCommon } from "./rich-card-group";

/**
 * 통합뷰 **'그룹 설정'(배치 편집) 모드** — 통합뷰 그 자체에서 반(=열)을 잡아 다른 줄로 끌어 옮긴다
 * (원장 2026-08-06 *"따로 그룹 설정 모드가 있는 게 아니라, 통합뷰에서 편집모드를 누르고 통합뷰의
 * 그 자체를 드래그하고 싶은거야"* → 별도 창(칩 보드)은 폐지했다).
 *
 * 왜 창이 아니라 표 위인가: 칩 보드는 **결과를 상상해야** 했다 — 어느 줄에 놓으면 표가 어떻게 되는지는
 * 저장하고 닫아 봐야 알았다. 여기선 놓는 순간 그 자리에서 진짜 표가 다시 그려진다
 * (교시축·요일축·명단 행수까지 줄 구성에 따라 바뀌므로 "칩만 옮기는 미리보기"로는 대체가 안 된다).
 *
 * 구현 요점:
 * · 편집 중엔 **수업명 행만** 그린다(`namesOnly`) — 원장이 먼저 짚은 렉 때문. 서식은 읽기 화면과
 *   **같은 컴포넌트**라 색·폭·모서리가 저절로 일치한다(따로 그리면 설정 화면과 실제 통합뷰가 갈라진다).
 * · 드롭마다 서버 왕복 없이 [`groupRichCards`](src/features/timetable/lib/class-grid.ts)(순수)를 **클라에서
 *   다시 돌린다**. 카드(무거운 쪽)는 서버가 1회 만들어 넘긴다.
 * · 상태 전이는 순수 모듈 [group-assign.ts](src/features/timetable/lib/group-assign.ts)에 있다.
 * · ⚠️ zoom 래퍼는 **DndContext 안쪽**에 둔다. 바깥이면 `position:fixed`인 DragOverlay가 zoom 좌표계로
 *   들어가 커서와 어긋난다(font-size-toggle.tsx 주석 참조).
 * · ⚠️ 편집 중엔 '기타(미배정)' 줄을 **항상 보여준다**(저장된 설정이 숨김이어도). 줄에서 뺀 반이
 *   화면에서 사라지면 "반이 없어졌다"가 된다 — 숨김 설정은 배지로 알린다.
 */
export function IntegratedEditBoard({
  subject,
  cards,
  config,
  teacherColors,
  subjectSoftClass,
  initialGroups,
  initialEnabled,
  initialShowOthers,
  initialOthersTitle,
  initialPresets,
  doneHref,
}: {
  subject: string;
  /** 서버가 1회 만든 반 카드 — 줄 배정만 바꿔 가며 클라에서 섹션을 다시 만든다. */
  cards: RichClassCard[];
  config: PeriodsConfig;
  teacherColors: TeacherColorMap;
  subjectSoftClass: string;
  initialGroups: GroupDraft[];
  /** 지금 커스텀 줄을 실제로 쓰고 있는지. 끄면 'N교시 시작' 자동 묶음으로 돌아간다(줄 정의는 보관). */
  initialEnabled: boolean;
  initialShowOthers: boolean;
  initialOthersTitle: string;
  initialPresets: GroupPreset[];
  /** 편집을 끝내고 돌아갈 통합뷰 주소(같은 과목·주·필터). */
  doneHref: string;
}) {
  const router = useRouter();
  // 5px 임계값 — 없으면 제목 입력·버튼 클릭이 드래그로 먹힌다(창 보드와 같은 값).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // 커스텀 줄이 아직 없으면 **지금 보이는 자동 섹션 그대로** 줄로 만들어 시작한다 — 빈 화면에서
  // 처음부터 쌓게 하면 아무도 안 쓴다(편집 모드의 첫 화면 = 방금까지 보던 그 표여야 한다).
  // id는 렌더 결정적(seed-N)이라 SSR/CSR이 갈리지 않는다.
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    initialGroups.length
      ? dedupeGroups(initialGroups)
      : groupRichCards(cards, config).map((g, i) => ({
          id: `seed-${i}`,
          title: g.label,
          classIds: g.cards.map((c) => c.classId),
        })),
  );
  // 처음 짜는 경우(저장된 줄이 아예 없음)는 켠 상태로 시작한다 — 안 그러면 줄을 다 짜고 저장해도
  // 화면이 자동 묶음 그대로라 "저장이 안 됐네"가 된다. 이미 설정을 가진 과목은 저장된 값을 존중.
  const [enabled, setEnabled] = useState(initialEnabled || initialGroups.length === 0);
  const [showOthers, setShowOthers] = useState(initialShowOthers);
  const [othersTitle, setOthersTitle] = useState(initialOthersTitle);
  const [presets, setPresets] = useState<GroupPreset[]>(initialPresets);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [over, setOver] = useState<{ containerId: string; classId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saving, startSave] = useTransition();

  const dirty = useMemo(
    () =>
      enabled !== initialEnabled ||
      showOthers !== initialShowOthers ||
      othersTitle !== initialOthersTitle ||
      JSON.stringify(presets) !== JSON.stringify(initialPresets) ||
      JSON.stringify(groups) !== JSON.stringify(dedupeGroups(initialGroups)),
    [
      groups,
      enabled,
      showOthers,
      othersTitle,
      presets,
      initialGroups,
      initialEnabled,
      initialShowOthers,
      initialOthersTitle,
      initialPresets,
    ],
  );

  // 화면에 쓸 제목 = 비어 있으면 자리표시("줄 N"). 저장도 같은 값을 쓴다(입력칸 placeholder와 일치).
  const titled = useMemo(
    () => groups.map((g, i) => ({ ...g, title: g.title.trim() || `줄 ${i + 1}` })),
    [groups],
  );
  const sections = useMemo(
    () =>
      groupRichCards(cards, config, new Set(), {
        groups: titled,
        showOthers: true, // 편집 중엔 항상 — 뺀 반이 사라지지 않게(위 주석)
        othersTitle: othersTitle.trim() || DEFAULT_OTHERS_TITLE,
      }),
    [cards, config, titled, othersTitle],
  );

  function onDragStart({ active }: DragStartEvent) {
    setDragLabel(String(active.data.current?.label ?? ""));
  }
  function onDragOver({ over: o }: DragOverEvent) {
    const d = o?.data.current;
    setOver(d ? { containerId: String(d.containerId), classId: d.type === "class" ? String(d.classId) : null } : null);
  }
  function onDragEnd({ active, over: o }: DragEndEvent) {
    setDragLabel(null);
    setOver(null);
    const a = active.data.current;
    const d = o?.data.current;
    if (!a || !d) return; // 칸 밖에서 놓음 = 무동작(엉뚱한 줄로 안 튄다)
    // '기타' 섹션은 진짜 줄이 아니라 **미배정**이다 — 거기 놓기 = 모든 줄에서 빼기.
    const target = d.containerId === OTHERS_GROUP_ID ? POOL_ID : String(d.containerId);
    const before = d.type === "class" ? String(d.classId) : null;
    setGroups((gs) => moveClass(gs, String(a.classId), target, before));
  }

  function addGroup() {
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `g${Date.now()}`;
    setGroups((gs) => [...gs, { id, title: `${gs.length + 1}번째 줄`, classIds: [] }]);
  }
  function moveRow(id: string, dir: -1 | 1) {
    setGroups((gs) => {
      const i = gs.findIndex((g) => g.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= gs.length) return gs;
      return reorderGroups(gs, id, gs[j].id);
    });
  }

  function leave() {
    if (dirty && !confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    router.push(doneHref, { scroll: false });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await saveIntegrationGroups({
        subject,
        enabled,
        groups: titled,
        showOthers,
        othersTitle,
        presets,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(doneHref, { scroll: false });
      router.refresh();
    });
  }

  const rowIndexOf = (id: string | undefined) => groups.findIndex((g) => g.id === id);
  const seenRows = new Set<string>(); // 한 줄이 평일/주말 두 섹션으로 갈릴 때 머리글 컨트롤은 첫 섹션에만

  return (
    <DndContext
      id="integrated-group-edit"
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragLabel(null);
        setOver(null);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="border-primary/40 bg-primary-soft/40 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2">
          <span className="text-primary text-[12px] font-bold">그룹 설정 중</span>
          <span className="text-text-dim text-[11px]">
            반 이름을 <b>잡고 끌어</b> 다른 줄에 놓으세요(줄 안에서 놓으면 좌우 순서). 담임·교시·명단은
            끄는 동안만 접어 둡니다 — 저장하면 원래 통합뷰로 돌아갑니다.
          </span>
          <label className="text-text-dim ml-auto flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            커스텀 줄 사용
            <span className="text-text-faint">(끄면 ‘N교시 시작’ 자동 묶음)</span>
          </label>
          <label className="text-text-dim flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            미배정 줄 표시
          </label>
          <input
            value={othersTitle}
            onChange={(e) => setOthersTitle(e.target.value)}
            placeholder={DEFAULT_OTHERS_TITLE}
            maxLength={30}
            aria-label="미배정 묶음 제목"
            className="border-line focus:border-primary bg-card w-32 rounded-lg border px-2 py-0.5 text-[11px] outline-none"
          />
        </div>

        <GroupPresetBar
          presets={presets}
          onChange={setPresets}
          current={{ groups: titled, showOthers, othersTitle }}
          onLoad={(body) => {
            setGroups(dedupeGroups(body.groups));
            setShowOthers(body.showOthers);
            setOthersTitle(body.othersTitle);
          }}
        />

        {/* ⚠️ zoom은 DndContext 안쪽 — 바깥이면 fixed인 DragOverlay가 커서와 어긋난다. */}
        <TimetableZoomArea>
          <div className="space-y-4">
            {sections.map((section) => {
              const isOthers = section.customGroupId === OTHERS_GROUP_ID;
              const rowId = section.customGroupId;
              const first = !isOthers && !!rowId && !seenRows.has(rowId);
              if (rowId && !isOthers) seenRows.add(rowId);
              const ri = rowIndexOf(rowId);
              return (
                <EditSection
                  key={section.key}
                  section={section}
                  containerId={isOthers ? OTHERS_GROUP_ID : (rowId ?? OTHERS_GROUP_ID)}
                  subjectSoftClass={subjectSoftClass}
                  teacherColors={teacherColors}
                  over={over}
                  header={
                    isOthers ? (
                      <>
                        <span className="text-foreground text-[13px] font-bold whitespace-nowrap">{section.label}</span>
                        <span className="border-line text-text-dim rounded-full border px-1.5 py-0.5 text-[10px]">
                          미배정
                        </span>
                        {!showOthers ? (
                          <span className="text-warning inline-flex items-center gap-1 text-[11px]">
                            <AlertTriangle size={12} aria-hidden="true" />
                            저장하면 이 줄은 통합뷰에서 숨겨집니다
                          </span>
                        ) : null}
                      </>
                    ) : first ? (
                      <>
                        <span className="inline-flex shrink-0 flex-col">
                          <button
                            type="button"
                            onClick={() => moveRow(rowId!, -1)}
                            disabled={ri <= 0}
                            aria-label="줄 위로"
                            className="text-text-faint hover:text-foreground disabled:opacity-25"
                          >
                            <ChevronUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(rowId!, 1)}
                            disabled={ri < 0 || ri >= groups.length - 1}
                            aria-label="줄 아래로"
                            className="text-text-faint hover:text-foreground disabled:opacity-25"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </span>
                        <span className="text-text-faint num shrink-0 text-[11px]">{ri + 1}</span>
                        <input
                          value={groups[ri]?.title ?? ""}
                          onChange={(e) =>
                            setGroups((gs) => gs.map((g) => (g.id === rowId ? { ...g, title: e.target.value } : g)))
                          }
                          placeholder={`줄 ${ri + 1}`}
                          maxLength={30}
                          aria-label="줄 제목"
                          className="border-line focus:border-primary text-foreground w-52 rounded-lg border px-2 py-0.5 text-[13px] font-bold outline-none"
                        />
                      </>
                    ) : (
                      <span className="text-foreground text-[13px] font-bold whitespace-nowrap">{section.label}</span>
                    )
                  }
                  action={
                    first ? (
                      <button
                        type="button"
                        onClick={() => setGroups((gs) => gs.filter((g) => g.id !== rowId))}
                        title="줄 삭제 — 이 줄의 반은 미배정으로 내려갑니다"
                        className="text-text-faint hover:text-danger ml-auto inline-flex shrink-0 items-center gap-1 text-[11px]"
                      >
                        <Trash2 className="size-3" />줄 삭제
                      </button>
                    ) : null
                  }
                />
              );
            })}
            <button
              type="button"
              onClick={addGroup}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border border-dashed px-3 py-1.5 text-[12px]"
            >
              <Plus className="size-3" />줄 추가
            </button>
          </div>
        </TimetableZoomArea>

        {/* 저장 바 — 창 데이터입력 폼 규약과 같은 하단 고정. 되돌릴 수 없는 건 저장뿐이라 여기 모은다. */}
        <div className="border-line bg-card/95 sticky bottom-0 z-30 flex flex-wrap items-center gap-2 rounded-t-xl border-t px-3 py-2 backdrop-blur">
          {error ? <span className="text-danger text-[12px]">{error}</span> : null}
          {confirmLeave ? (
            <span className="text-warning text-[12px]">저장하지 않은 변경이 있습니다 — 한 번 더 누르면 버립니다.</span>
          ) : null}
          <span className="text-text-faint text-[11px]">
            줄 {groups.length}개 · 반 {cards.length}개
          </span>
          <button
            type="button"
            onClick={leave}
            className="text-text-dim hover:text-foreground ml-auto px-3 py-1 text-xs"
          >
            {confirmLeave ? "그냥 나가기" : "편집 끝내기"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : null}
            저장
          </button>
        </div>
      </div>

      {/* ⚠️ 끌고 있는 열은 실제 카드(176px)가 아니라 **이름 알약**으로 그린다 — 카드를 통째로 띄우면
          커서 아래가 다 가려 어디에 놓는지가 안 보인다. */}
      <DragOverlay dropAnimation={null}>
        {dragLabel ? (
          <span className="border-primary bg-card text-foreground pointer-events-none inline-flex cursor-grabbing items-center rounded-full border px-2.5 py-1 text-[12px] font-bold shadow-lg">
            {dragLabel}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** 한 줄(섹션) — 머리글(제목·순서·삭제) + 실제 통합뷰 보드. 섹션 전체가 '맨 뒤에 놓기' 드롭 칸이다. */
function EditSection({
  section,
  containerId,
  subjectSoftClass,
  teacherColors,
  over,
  header,
  action,
}: {
  section: RichCardGroup;
  containerId: string;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  over: { containerId: string; classId: string | null } | null;
  header: React.ReactNode;
  action: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `box:${section.key}`, data: { type: "box", containerId } });
  // 카드 위가 아니라 **줄의 빈 곳**에 있을 때만 줄 전체를 밝힌다(카드 앞 삽입 표시와 겹치면 시끄럽다).
  const boxActive = isOver && over?.classId === null;
  return (
    <section
      ref={setNodeRef}
      className={`bg-card shadow-card w-max max-w-full overflow-hidden rounded-2xl ring-2 transition ${
        boxActive ? "ring-primary" : "ring-transparent"
      }`}
    >
      <div className="border-line/70 flex items-center gap-2.5 border-b px-4 py-2.5">
        <span
          className="bg-primary-soft text-primary flex size-6 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <EyIcon name="clock" size={13} />
        </span>
        {header}
        <span className="text-text-dim shrink-0 text-[12px] whitespace-nowrap">{section.cards.length}개 수업</span>
        {action}
      </div>
      {/* trailing = '맨 뒤' 자리. 카드 사이(=그 앞에 끼우기)만 있으면 맨 뒤로 보내는 길이 없다. */}
      <RichCardGroupBoard
        group={section}
        subjectSoftClass={subjectSoftClass}
        teacherColors={teacherColors}
        namesOnly
        renderCard={(card, common) => (
          <DraggableColumn
            key={card.classId}
            card={card}
            common={common}
            containerId={containerId}
            insertBefore={over?.classId === card.classId}
          />
        )}
        trailing={
          <div
            className={`border-line text-text-faint flex w-14 shrink-0 items-center justify-center border-l border-dashed text-center text-[10px] leading-tight ${
              boxActive ? "bg-primary-soft text-primary" : ""
            }`}
            style={{ height: NAME_H }}
          >
            맨 뒤
          </div>
        }
      />
    </section>
  );
}

/** 반=열 하나 — 손잡이(헤더)로 끌고, 자기 자신도 '이 앞에 끼우기' 드롭 칸이다. */
function DraggableColumn({
  card,
  common,
  containerId,
  insertBefore,
}: {
  card: RichClassCard;
  common: ColumnCommon;
  containerId: string;
  insertBefore: boolean;
}) {
  const data = { type: "class", classId: card.classId, containerId, label: card.className };
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `col:${card.classId}`,
    data,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: `slot:${card.classId}`, data });
  return (
    <ClassColumn
      card={card}
      {...common}
      edit={{
        setNodeRef: (el) => {
          setDragRef(el);
          setDropRef(el);
        },
        handleProps: { ...attributes, ...listeners },
        dragging: isDragging,
        insertBefore: insertBefore && !isDragging,
      }}
    />
  );
}

/**
 * 반 칩만 끌리므로 후보는 '반' 또는 '줄 칸'뿐 — **반 위가 줄 칸보다 우선**이다(줄 칸이 반을 품고 있어
 * 그냥 두면 "어느 반 앞"인지가 안 잡히고 항상 맨 뒤로 간다). 키보드 드래그는 포인터 좌표가 없어
 * `closestCenter` 폴백(없으면 키보드로는 옮길 수 없다).
 */
const collision: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);
  const onCard = hits.filter((h) => args.droppableContainers.find((c) => c.id === h.id)?.data.current?.type === "class");
  return onCard.length ? onCard : hits;
};
