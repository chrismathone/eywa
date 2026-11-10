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
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Loader2, Plus, RotateCcw, Trash2 } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { saveIntegrationGroups } from "@/features/owner/server/subject-actions";
import {
  OTHERS_GROUP_ID,
  groupRichCards,
  type RichCardGroup,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { withEmptyRowSections } from "@/features/timetable/lib/edit-rows";
import { POOL_ID, dedupeGroups, moveClass, reorderGroups, type GroupDraft } from "@/features/timetable/lib/group-assign";
import { normalizePresets, type GroupPreset } from "@/features/timetable/lib/group-presets";
import { DEFAULT_OTHERS_TITLE } from "@/features/timetable/lib/integration-groups";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import { TimetableZoomArea } from "./font-size-toggle";
import { GroupPresetBar } from "./group-preset-bar";
import { RichCardGroupBoard, ClassColumn, NAME_H, type ColumnCommon } from "./rich-card-group";
import { clearTimetableUnsaved, useTimetableUnsavedGuard } from "./timetable-unsaved";

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
  initialCompactSections,
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
  /**
   * 지금 '1시간 단위'로 접혀 있는 줄(sectionKey 목록) — 통합뷰에서 토글을 없애고 **여기로 옮겼다**
   * (원장 2026-08-13 *"1시간 단위는 그룹설정에서만 세팅 가능하도록"*).
   * ⚠️ 저장 위치는 지금까지와 같은 **내 계정**(users.ui_prefs.timetable.compact1h[과목])이다 — 줄 배치는
   *    학원 공통 설정이지만 이 토글은 보는 사람 취향이라 통합뷰가 원래 쓰던 그릇을 그대로 쓴다.
   */
  initialCompactSections: number[];
  /** 편집을 끝내고 돌아갈 통합뷰 주소(같은 과목·주·필터). */
  doneHref: string;
}) {
  const router = useRouter();
  const inFrame = useInFrame();
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
  // 고스트를 원본 헤더와 똑같이 그리려면 라벨만으론 부족하다(반 저장색). 카드를 통째로 들고 있는다.
  const [dragCard, setDragCard] = useState<RichClassCard | null>(null);
  /** 지금 끌고 있는 **줄**(반이 아니라 줄 자체) — 같은 DndContext를 쓰고 `data.type`으로 갈린다. */
  const [dragRow, setDragRow] = useState<{ id: string; title: string } | null>(null);
  const [over, setOver] = useState<{ containerId: string; classId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [saving, startSave] = useTransition();
  /** '시간표 적용' 뒤 통합뷰로 떠나는 중 — 풀 문서 이동은 트랜지션 밖이라 `saving`이 먼저 풀린다(그 사이 재클릭 방지). */
  const [leaving, setLeaving] = useState(false);
  const [presetSaving, startPresetSave] = useTransition();
  const [presetError, setPresetError] = useState<string | null>(null);
  // '1시간 단위'(줄별) — 보관함과 같은 **즉시 저장**이다. 하단 '시간표 적용'에 묶으면 줄 배치를 안 바꾸고
  // 이것만 켜러 온 사람이 "적용"까지 눌러야 하고, 안 누르면 조용히 사라진다.
  const [compactKeys, setCompactKeys] = useState<number[]>(() =>
    [...new Set(initialCompactSections)].sort((a, b) => a - b),
  );
  const [, startCompactSave] = useTransition();

  /**
   * 보관함(저장된 배치) 추가·삭제 — **그 자리에서 서버에 쓴다**.
   *
   * 🔴 버튼이 "이름 붙여 저장"이라고 말해 놓고 하단 '저장'을 눌러야 남는 구조였더니, 이름만 짓고
   * 나간 사용자에겐 **저장했다고 해놓고 안 남는** 거짓말이 됐다(원장 2026-08-06 "저장한 걸 어디서
   * 불러오나?").
   * ⚠️ 이때 함께 쓰는 배치는 **지금 편집 중인 것이 아니라 저장돼 있던 것**(initial*)이다 — 보관함만
   * 만지는 동작이라, 아직 확정 안 한 편집이 딸려 저장되면 "저장 안 눌렀는데 적용됨"이 된다.
   */
  function persistPresets(next: GroupPreset[]) {
    setPresets(next); // 화면은 즉시
    setPresetError(null);
    startPresetSave(async () => {
      const res = await saveIntegrationGroups({
        subject,
        enabled: initialEnabled,
        groups: initialGroups,
        showOthers: initialShowOthers,
        othersTitle: initialOthersTitle,
        presets: next,
      });
      if (res.error) {
        setPresetError(res.error);
        return;
      }
      // 🔴 서버가 찍은 '누가·언제'를 받아 목록에 반영한다 — 안 하면 방금 저장한 항목이
      //    "저장자 미상 · 시각 없음"으로 남는다(새로고침해야 보이는 값 = 없는 값).
      if (res.presets) setPresets(normalizePresets(res.presets, othersTitle));
    });
  }

  /**
   * 줄 하나의 '1시간 단위' 켜기/끄기 — 화면은 즉시, 저장은 계정(과목별)으로 곧장.
   * ⚠️ 키는 **줄의 순번에서 나온 sectionKey**라, 켜 둔 뒤 줄 순서를 바꾸면 다른 줄로 따라간다
   *    (통합뷰가 원래 쓰던 키라 그대로 둔다 — 순서를 바꿨으면 다시 확인할 것).
   */
  function toggleCompact(sectionKey: number) {
    const next = compactKeys.includes(sectionKey)
      ? compactKeys.filter((k) => k !== sectionKey)
      : [...compactKeys, sectionKey].sort((a, b) => a - b);
    setCompactKeys(next);
    // 표시 취향이라 실패해도 편집을 막지 않는다(다음 저장 때 다시 시도된다).
    startCompactSave(async () => {
      await saveTimetableViewPrefs({ compact1h: { [subject]: next } });
    });
  }

  // ⚠️ 보관함(presets)은 여기 안 넣는다 — 그쪽은 **즉시 저장**되므로(persistPresets) 비교에 넣으면
  //    프리셋 하나 만든 뒤 영영 '미저장' 상태로 남고, '초기화'가 이미 저장된 보관함을 되돌리려 든다.
  const dirty = useMemo(
    () =>
      enabled !== initialEnabled ||
      showOthers !== initialShowOthers ||
      othersTitle !== initialOthersTitle ||
      JSON.stringify(groups) !== JSON.stringify(dedupeGroups(initialGroups)),
    [groups, enabled, showOthers, othersTitle, initialGroups, initialEnabled, initialShowOthers, initialOthersTitle],
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
  // 반이 0개인 줄도 자리를 잡아 준다(드롭 칸이 없으면 새 줄에 반을 넣을 수가 없다) — 규칙은
  // [edit-rows.ts](src/features/timetable/lib/edit-rows.ts) 한 곳, 편집 보드에서만.
  const rowSections = useMemo(() => withEmptyRowSections(sections, titled), [sections, titled]);

  function onDragStart({ active }: DragStartEvent) {
    const a = active.data.current;
    if (a?.type === "row") {
      setDragRow({ id: String(a.rowId), title: String(a.title ?? "") });
      setDragCard(null);
      return;
    }
    setDragCard((a?.card as RichClassCard | undefined) ?? null);
  }
  function onDragOver({ active, over: o }: DragOverEvent) {
    const d = o?.data.current;
    // 줄을 끌 때는 "어느 반 앞"이 뜻이 없다 — 줄 전체만 밝힌다(카드 삽입 표시가 켜지면 시끄럽다).
    if (active.data.current?.type === "row") {
      setOver(d ? { containerId: String(d.containerId), classId: null } : null);
      return;
    }
    setOver(d ? { containerId: String(d.containerId), classId: d.type === "class" ? String(d.classId) : null } : null);
  }
  function onDragEnd({ active, over: o }: DragEndEvent) {
    setDragCard(null);
    setDragRow(null);
    setOver(null);
    const a = active.data.current;
    const d = o?.data.current;
    if (!a || !d) return; // 칸 밖에서 놓음 = 무동작(엉뚱한 줄로 안 튄다)
    // 줄 자체를 끌었으면 **줄 순서**를 바꾼다(원장 2026-08-14 *"그룹 위치를 드래그해서 이동하고싶은데"*).
    // ⚠️ 미배정('기타')은 진짜 줄이 아니라 순서에 낄 수 없다 — 거기 놓으면 무동작(제자리).
    if (a.type === "row") {
      const target = String(d.containerId);
      if (target === OTHERS_GROUP_ID || target === String(a.rowId)) return;
      setGroups((gs) => reorderGroups(gs, String(a.rowId), target));
      return;
    }
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
    clearTimetableUnsaved(); // 내 네비에 내 경고가 또 뜨지 않게 먼저 푼다
    router.push(doneHref, { scroll: false });
  }

  /**
   * 초기화 — **저장돼 있던 상태**로 되돌린다(원장 2026-08-06 "처음상태로 갈 수 있도록").
   * ⚠️ '자동 묶음으로 리셋'이 아니다: 저장된 배치가 있으면 그 배치로, 아직 없으면 진입할 때 씨뿌린
   * 자동 섹션으로 — 어느 쪽이든 **이 창을 열었을 때 보던 화면**으로 돌아온다(사람이 기대하는 '처음').
   * 되돌리기는 화면에서만 일어나고 저장은 안 한다 — 실수로 눌러도 '저장' 전엔 DB가 안 바뀐다.
   */
  function resetToInitial() {
    setGroups(
      initialGroups.length
        ? dedupeGroups(initialGroups)
        : groupRichCards(cards, config).map((g, i) => ({
            id: `seed-${i}`,
            title: g.label,
            classIds: g.cards.map((c) => c.classId),
          })),
    );
    setEnabled(initialEnabled || initialGroups.length === 0);
    setShowOthers(initialShowOthers);
    setOthersTitle(initialOthersTitle);
    // ⚠️ 보관함(presets)은 되돌리지 않는다 — 이미 서버에 저장된 것이라, 되돌리면 화면만 옛 목록으로
    //    어긋난다(초기화는 '아직 반영 안 한 배치'를 버리는 동작이지 저장된 걸 지우는 게 아니다).
    setError(null);
    setConfirmLeave(false);
    setConfirmReset(false);
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
      // ⚠️ 미저장 해제가 이동보다 **먼저** — 뒤면 풀 문서 이동에 beforeunload '떠나시겠습니까?'가 뜬다.
      clearTimetableUnsaved(); // 반영했으니 미저장 아님
      // 🔴 `router.push`가 아니라 풀 문서 이동 — 서버 액션 직후의 push는 액션 응답이 이 편집 화면 트리를
      //    다시 적용하면서 삼켜진다(#102: 반영됐는데 편집 화면에 머문다). 풀 로드라 통합뷰는 새 배치로
      //    새로 그려진다(refresh 불필요). 스크롤은 맨 위로 돌아간다(옛 `scroll:false`는 클라 이동에만 있던 것).
      setLeaving(true);
      window.location.assign(inFrame ? withEmbed(doneHref) : doneHref);
    });
  }

  // 주·과목·구분·뷰 전환(ParamLink)·창 닫기·새로고침에 확인을 붙인다 — 편집이 조용히 사라지던 것.
  useTimetableUnsavedGuard(dirty);

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
        setDragCard(null);
        setOver(null);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* 편집 바 = **한 줄**(원장 2026-08-06 "2행으로 존재하는데 1개로 개편"). 보관함 컨트롤은
            래퍼 없이 여기 얹히고, 목록만 열렸을 때 `w-full`로 아랫줄에 펼쳐진다. */}
        <div className="border-primary/40 bg-primary-soft/40 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2">
          <span className="text-primary shrink-0 text-xs font-bold">그룹 설정 중</span>
          <span className="text-text-dim text-xs">
            반 이름을 <b>잡고 끌어</b> 다른 줄에 놓으세요.
          </span>
          <label className="text-text-dim flex shrink-0 items-center gap-1.5 text-xs" title="끄면 ‘N교시 시작’ 자동 묶음으로 돌아갑니다(줄 정의는 보관)">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            커스텀 줄
          </label>
          <label className="text-text-dim flex shrink-0 items-center gap-1.5 text-xs">
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            미배정 줄
          </label>
          <input
            value={othersTitle}
            onChange={(e) => setOthersTitle(e.target.value)}
            placeholder={DEFAULT_OTHERS_TITLE}
            maxLength={30}
            aria-label="미배정 묶음 제목"
            title="미배정 줄의 제목"
            className="border-line focus:border-primary bg-card w-24 shrink-0 rounded-lg border px-2 py-0.5 text-xs outline-none"
          />
          <GroupPresetBar
            presets={presets}
            onChange={persistPresets}
            saving={presetSaving}
            error={presetError}
            current={{ groups: titled, showOthers, othersTitle }}
            onLoad={(body) => {
              setGroups(dedupeGroups(body.groups));
              setShowOthers(body.showOthers);
              setOthersTitle(body.othersTitle);
            }}
          />
        </div>

        {/* ⚠️ zoom은 DndContext 안쪽 — 바깥이면 fixed인 DragOverlay가 커서와 어긋난다. */}
        <TimetableZoomArea>
          <div className="space-y-4">
            {rowSections.map((section) => {
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
                  // 한 줄이 평일/주말 두 섹션으로 갈리면 토글은 **평일 섹션에만**(주말은 교시 체계가 없어
                  // 압축 대상이 아니다 — section.compactable이 그걸 판정한다).
                  compact={
                    section.compactable && (first || isOthers)
                      ? {
                          on: compactKeys.includes(section.sectionKey),
                          onToggle: () => toggleCompact(section.sectionKey),
                        }
                      : null
                  }
                  header={
                    isOthers ? (
                      <>
                        <span className="text-foreground text-sm font-bold whitespace-nowrap">{section.label}</span>
                        <span className="border-line text-text-dim rounded-full border px-1.5 py-0.5 text-xs">
                          미배정
                        </span>
                        {!showOthers ? (
                          <span className="text-amber inline-flex items-center gap-1 text-xs">
                            <AlertTriangle size={12} aria-hidden="true" />
                            저장하면 이 줄은 통합뷰에서 숨겨집니다
                          </span>
                        ) : null}
                      </>
                    ) : first ? (
                      <>
                        <RowDragHandle rowId={rowId!} title={groups[ri]?.title || `줄 ${ri + 1}`} />
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
                        <span className="text-text-faint num shrink-0 text-xs">{ri + 1}</span>
                        <input
                          value={groups[ri]?.title ?? ""}
                          onChange={(e) =>
                            setGroups((gs) => gs.map((g) => (g.id === rowId ? { ...g, title: e.target.value } : g)))
                          }
                          placeholder={`줄 ${ri + 1}`}
                          maxLength={30}
                          aria-label="줄 제목"
                          className="border-line focus:border-primary text-foreground w-52 rounded-lg border px-2 py-0.5 text-sm font-bold outline-none"
                        />
                      </>
                    ) : (
                      <span className="text-foreground text-sm font-bold whitespace-nowrap">{section.label}</span>
                    )
                  }
                  action={
                    first ? (
                      <button
                        type="button"
                        onClick={() => setGroups((gs) => gs.filter((g) => g.id !== rowId))}
                        title="줄 삭제 — 이 줄의 반은 미배정으로 내려갑니다"
                        className="text-text-faint hover:text-danger ml-auto inline-flex shrink-0 items-center gap-1 text-xs"
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
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border border-dashed px-3 py-1.5 text-xs"
            >
              <Plus className="size-3" />줄 추가
            </button>
          </div>
        </TimetableZoomArea>

        {/* 저장 바 — 창 데이터입력 폼 규약과 같은 하단 고정. 되돌릴 수 없는 건 저장뿐이라 여기 모은다.
            sticky-save-bar 마커 = main 하단 패딩 제거(바 밀착, globals.css [[#110]]). */}
        <div className="sticky-save-bar border-line bg-card/95 sticky bottom-0 z-30 flex flex-wrap items-center gap-2 rounded-t-xl border-t px-3 py-2 backdrop-blur">
          {error ? <span className="text-danger text-xs">{error}</span> : null}
          {confirmLeave ? (
            <span className="text-amber text-xs">아직 적용하지 않은 변경이 있습니다 — 한 번 더 누르면 버립니다.</span>
          ) : null}
          <span className="text-text-faint text-xs">
            줄 {groups.length}개 · 반 {cards.length}개
          </span>
          {/* 되돌리기 — 화면만 되돌린다(저장 전이라 DB 무변). 되돌릴 게 없으면 아예 안 보인다. */}
          {dirty ? (
            confirmReset ? (
              <span className="text-amber ml-auto inline-flex items-center gap-2 text-xs">
                지금까지 옮긴 걸 버리고 처음 상태로?
                <button type="button" onClick={resetToInitial} className="text-danger font-bold hover:underline">
                  되돌리기
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="text-text-dim hover:text-foreground"
                >
                  취소
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                title="이 창을 열었을 때 보던 배치로 되돌립니다(시간표에는 아직 적용되지 않습니다)"
                className="text-text-dim hover:text-foreground ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs"
              >
                <RotateCcw className="size-3" />
                되돌리기
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={leave}
            className={`text-text-dim hover:text-foreground px-3 py-1 text-xs ${dirty ? "" : "ml-auto"}`}
          >
            {confirmLeave ? "그냥 나가기" : "편집 끝내기"}
          </button>
          {/* 🔴 이름이 '저장'이면 위 보관함의 '저장'과 같은 말이 되어 헷갈린다(원장 2026-08-06) →
              **'시간표 적용'**. 이쪽만 통합뷰를 바꾸고, 위쪽은 보관함에만 넣는다. 되돌릴 수 없는
              유일한 동작이라 확인을 한 번 받는다. */}
          {confirmApply ? (
            <span className="text-amber inline-flex items-center gap-2 text-xs">
              이 배치를 시간표에 적용할까요?
              <button
                type="button"
                onClick={save}
                disabled={saving || leaving}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {saving || leaving ? <Loader2 className="size-3 animate-spin" /> : null}
                적용
              </button>
              <button
                type="button"
                onClick={() => setConfirmApply(false)}
                className="text-text-dim hover:text-foreground"
              >
                취소
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmApply(true)}
              disabled={saving || leaving}
              title="지금 화면의 배치를 시간표에 적용합니다"
              className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
            >
              시간표 적용
            </button>
          )}
        </div>
      </div>

      {/* 🔴 고스트는 **끌고 있는 칸을 꽉 채워야** 커서와 안 어긋난다(원장 2026-08-06 "마우스 위치와
          드래그할때 위치가 서로 어긋나는데"). dnd-kit `DragOverlay`의 상자는 **원본 열의 rect**
          (176×40)인데 그 안에 작은 알약을 그리면 알약이 상자 **좌상단**에 붙어, 이름 가운데를 잡았을 때
          잡은 만큼(최대 176px) 왼쪽에 뜬다. `h-full w-full`이면 잡은 지점이 고스트 안에서 그대로라
          "잡은 자리를 그대로 들고 있는" 느낌이 된다. 색도 원본 헤더와 같게(어느 반인지 즉시 읽힌다).
          ⚠️ 카드 전체(수백 px)를 띄우던 시절의 '커서가 가려진다' 걱정은 수업명만 그리는 지금은 없다. */}
      <DragOverlay dropAnimation={null}>
        {dragCard ? (
          <div
            className={`border-primary text-foreground pointer-events-none flex h-full w-full cursor-grabbing items-center justify-center rounded-sm border-2 px-1 text-center text-sm font-bold shadow-lg ${
              dragCard.bgColor ? "" : `${subjectSoftClass} bg-card`
            }`}
            style={
              dragCard.bgColor
                ? { background: dragCard.bgColor, color: dragCard.textColor ?? "var(--ink)" }
                : undefined
            }
          >
            <span className="overflow-hidden whitespace-nowrap text-clip">{dragCard.className}</span>
          </div>
        ) : dragRow ? (
          <span className="bg-card border-primary text-foreground shadow-card pointer-events-none inline-flex cursor-grabbing items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-sm font-bold whitespace-nowrap">
            <GripVertical className="size-3.5" aria-hidden="true" />
            {dragRow.title}
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
  compact,
}: {
  section: RichCardGroup;
  containerId: string;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  over: { containerId: string; classId: string | null } | null;
  header: React.ReactNode;
  action: React.ReactNode;
  /** 이 줄의 '1시간 단위' — null이면 대상이 아닌 섹션(주말·같은 줄의 둘째 섹션). */
  compact: { on: boolean; onToggle: () => void } | null;
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
        <span className="text-text-dim shrink-0 text-xs whitespace-nowrap">{section.cards.length}개 수업</span>
        {/* '1시간 단위' — 통합뷰 섹션 헤더에 있던 토글의 새 자리(원장 2026-08-13). 이 줄에 교시 체계가
            다른 반이 섞여 있으면 체계별로 표를 나눠 그린다(빈 교시 행이 서로를 가리지 않게). */}
        {compact ? (
          <label
            title="이 줄에 교시 체계가 다른 반이 섞여 있으면 체계별로 나눠 그립니다 (내 화면에만 적용)"
            className="text-text-dim hover:text-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs whitespace-nowrap"
          >
            <input type="checkbox" checked={compact.on} onChange={compact.onToggle} />
            1시간 단위
          </label>
        ) : null}
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
            className={`border-line text-text-faint flex w-14 shrink-0 items-center justify-center border-l border-dashed text-center text-xs leading-tight ${
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

/**
 * 줄 손잡이 — **줄 자체**를 끌어 순서를 바꾼다(반 칩과 같은 DndContext, `data.type`으로 갈린다).
 * 위/아래 화살표는 그대로 둔다 — 멀리 옮길 땐 드래그가, 한 칸은 화살표가 빠르다.
 */
function RowDragHandle({ rowId, title }: { rowId: string; title: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `row:${rowId}`,
    data: { type: "row", rowId, title },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      title="끌어서 줄 순서 바꾸기"
      aria-label="줄 순서 바꾸기(끌기)"
      className={`text-text-faint hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
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
  const data = { type: "class", classId: card.classId, containerId, card };
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
