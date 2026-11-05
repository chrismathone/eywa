"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import type { MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { newItem, sameItems } from "@/features/dashboard/layout/engine";
import { CARDS, cardDef, type SizePreset } from "@/features/dashboard/layout/registry";
import { previewSnapshot } from "@/features/dashboard/layout/preview";
import { BUNDLE_LABELS, BUNDLE_RULES, MAX_ITEMS, isKpiId, type Bundle, type DashboardSettings, type Item } from "@/features/dashboard/layout/types";
import { SectionForm } from "../section-form";
import { addRow, appendItem, positionItems, uniformKpiItems, type KpiWidth } from "@/features/dashboard/layout/fixed-grid";
import { Button } from "@/components/ui/button";
import { CardInspector } from "./card-inspector";
import { EditBoard } from "./edit-board";
import { EditorActions, RoleBar } from "./editor-toolbar";
import { SPRING } from "./geometry";
import { ListBoard, UnusedList } from "./list-board";
import { RolePreview } from "./role-preview";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { useDashboardEditor } from "./use-editor";
import { WidgetGallery } from "./widget-gallery";
import { AssignedStaff } from "./assigned-staff";
import { RowEditor } from "./row-editor";
import type { DashboardMembers } from "@/features/dashboard/layout/members";
import e from "./editor.module.css";

export type DashboardEditorProps = {
  initial: DashboardSettings;
  /** 역할 묶음이 열 수 있는 메뉴(그 학원의 역할 권한 + 꺼진 기능) — 서버가 계산(`bundleMenus`). */
  roleMenus: Record<Bundle, MenuKey[]>;
  /** 과목 관리자 미리보기 과목(운영실 과목 묶음마다 하나). */
  subjects: { key: string; label: string }[];
  /** 역할마다 지금 해당하는 직원 수. */
  members: DashboardMembers;
  /** 원장 시점 원본 스냅샷 — 서버가 흘려 보낸다(첫 화면을 막지 않게, B7). 실패하면 null. */
  preview: Promise<OverviewSnapshot | null>;
  /**
   * 읽기 권한(학원 설정 쓰기 없음 — 저장 액션과 같은 판정, page.tsx) — 편집 도구 줄('편집'·기본값 등)과 저장 바를 그리지 않고
   * 편집 얼굴(끌기·크기·서랍·갤러리)로 들어가지 않는다(원장 2026-11-05). ⚠️ 역할 전환 줄(RoleBar)·과목 전환도 일반 단추라
   * 페이지 fieldset(owner/page.tsx `disabled={!canEditSettings}`) 안에서 비활성이다 — 읽기 사용자는 지금 고른 역할의 배치만 본다
   * (이번 변경 전부터 같다). 보기 전환까지 열려면 그 조작을 fieldset 밖으로 옮길 것(2026-11-05 리뷰).
   */
  readOnly?: boolean;
};

/** 갤러리·편집 얼굴용 — 모든 카드를 기본 크기로 놓은 배치. */
const ALL_ITEMS: Item[] = CARDS.map((c) => newItem(c.id));

/** 캔버스로 끌어 편집하기엔 좁은 폭 — 이 아래는 한 줄 목록 편집. */
const LIST_BELOW = 720;

/**
 * 학원 설정 '대시보드 관리' — 역할마다 운영실에 무엇을 어디에 얼마나 크게 놓을지(원장 2026-10-01 *"카드 및 위치, 카드 크기 등등 다양하게"*).
 * 처음엔 그 역할의 **실데이터 미리보기**, '편집'을 누르면 위젯 편집(끌기·크기·서랍·갤러리), '완료'로 돌아온다. 저장은 아래 저장 바(다섯 역할 한 번에).
 */
export function DashboardEditor({ initial, roleMenus, subjects, members, preview, readOnly = false }: DashboardEditorProps) {
  const ed = useDashboardEditor(initial, subjects.map((s) => s.key));
  const { role, selected, commit, select, restore, undo, redo } = ed;
  // 읽기 권한이면 편집 얼굴로 들어가지 않는다 — 도구 줄을 그리지 않으므로 켤 길도 없지만, 상태가 남아도 막는다.
  const editing = ed.editing && !readOnly;
  const items = useMemo(() => editing ? positionItems(ed.items) : ed.items, [ed.items, editing]);
  const [full, setFull] = useState<OverviewSnapshot | null | "failed">(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const { subject, setSubject } = ed;
  // 동시 저장 = 마지막 저장이 이긴다(원장 2026-10-14) — 저장 기준(처음 받은 값 → 내가 저장할 때마다 그 값)과 달라진 배치(`ed.touched`)만 보낸다.
  const submittedRef = useRef<DashboardSettings | null>(null);
  const [width, setWidth] = useState(1200);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    let alive = true;
    preview.then(
      (s) => alive && setFull(s ?? "failed"),
      () => alive && setFull("failed"),
    );
    return () => {
      alive = false;
    };
  }, [preview]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const menus = useMemo(() => new Set(roleMenus[role]), [roleMenus, role]);
  const subjectChoice = subjects.find((s) => s.key === subject) ?? null;
  const applicableMembers = role === "subject" && subject ? { ...members, people: members.people.filter((p) => p.subjectKeys.includes(subject)) } : members;
  const original = full && full !== "failed" ? full : null;
  const previewSubject = role === "subject" ? subjectChoice : null;
  // 편집 얼굴·갤러리의 값 — 모든 카드를 놓았다고 치고 이 역할로 다듬은 스냅샷(권한 밖 영역 제거 · 담당 과목으로 좁힘).
  // 금액은 카드 옵션(이번 달 수납 '금액 보이기')을 따라 얼굴이 고른다(`summaryOf`의 amounts).
  const snapshot = useMemo(
    () => (original ? previewSnapshot(original, { role, items: ALL_ITEMS, menus, subject: previewSubject }) : null),
    [original, role, menus, previewSubject],
  );
  // 역할마다 같은 위젯 목록(원장 2026-10-14) — 과목 관리자도 다 넣을 수 있고, 과목으로 못 나누는 카드는 '(학원 전체)'로 보인다.
  const unused = useMemo(() => CARDS.filter((c) => !items.some((i) => i.id === c.id)).map((c) => c.id), [items]);
  const selectedItem = items.find((i) => i.id === selected) ?? null;

  const onRemoved = useCallback(
    (id: string, before: Item[]) => {
      const at = before.findIndex((i) => i.id === id);
      const removed = before[at];
      if (!removed) return;
      const name = removed.title ?? cardDef(id)?.label ?? "구역 제목";
      toast(`'${name}'을(를) 뺐습니다`, {
        action: { label: "되돌리기", onClick: () => restore(role, removed, at, subject) },
      });
    },
    [restore, role, subject],
  );
  const add = useCallback(
    (id: string, z?: SizePreset) => {
      const cur = itemsRef.current;
      if (cur.some((i) => i.id === id)) return;
      if (cur.length >= MAX_ITEMS) return toast.info(`카드와 구역 제목은 ${MAX_ITEMS}개까지 넣을 수 있습니다`);
      const next = appendItem(cur, newItem(id, z));
      if (next.length <= cur.length && !next.some((i) => i.id === id)) return toast.info("카드를 놓을 공간이 부족합니다. 기존 카드 위치를 조절해 주세요.");
      commit(next);
      toast(`'${cardDef(id)?.label}'을(를) 맨 뒤에 넣었습니다`);
    },
    [commit],
  );
  const addHeading = useCallback(() => {
    const id = `heading:${Date.now().toString(36)}`;
    const cur = itemsRef.current;
    if (cur.length >= MAX_ITEMS) return toast.info(`카드와 구역 제목은 ${MAX_ITEMS}개까지 넣을 수 있습니다`);
    commit(appendItem(cur, newItem(id, undefined, "새 구역")));
    select(id);
  }, [commit, select]);
  const appendRow = useCallback(() => {
    const next = addRow(itemsRef.current, crypto.randomUUID());
    if (next.length === itemsRef.current.length) return toast.info("더 이상 행을 추가할 수 없습니다");
    commit(next);
  }, [commit]);
  const uniformKpis = useCallback((width: KpiWidth) => {
    const next = uniformKpiItems(itemsRef.current, width);
    if (sameItems(next, itemsRef.current)) return void toast.info("이미 같은 크기로 정렬되어 있거나 정렬할 공간이 부족합니다");
    commit(next);
    toast("KPI 크기를 통일했습니다 · 되돌리기로 취소할 수 있습니다");
  }, [commit]);

  useEditorShortcuts(editing, undo, redo);

  const listMode = width < LIST_BELOW;
  return (
    <SectionForm
      section="dashboard"
      payload={ed.payload}
      extraFields={{ dashboardPart: "layouts", dashboardTouched: JSON.stringify(ed.touched) }}
      onSubmit={() => { submittedRef.current = ed.payload; }}
      onSaved={() => { if (submittedRef.current) ed.markSaved(submittedRef.current); }}
      readOnly={readOnly}
    >
      <div ref={rootRef} className={e.editor} style={{ "--spring-linear": SPRING } as CSSProperties}>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <div className="flex min-w-0 flex-col gap-3">
        <RoleBar role={role} status={ed.status} onRole={ed.setRole} />
        <p className={e.roleInfo}>
          <b>{BUNDLE_LABELS[role]}</b>
          <span>{BUNDLE_RULES[role]}</span>
          <span>{members.failed ? "직원 조회 실패" : `지금 ${applicableMembers.people.filter((p) => p.bundle === role && p.canOpen).length}명`}</span>
          <span>{ed.status[role].isDefault ? "기본 배치 사용 중" : "직접 구성한 배치"}</span>
        </p>
        {readOnly ? null : <EditorActions
          role={role}
          editing={editing}
          canUndo={ed.canUndo}
          canRedo={ed.canRedo}
          isDefault={ed.status[role].isDefault}
          subjects={subjects}
          subject={subject}
          onEditing={ed.setEditing}
          onGallery={() => setGalleryOpen(true)}
          onHeading={addHeading}
          hasKpis={items.some((i) => isKpiId(i.id))}
          onUniformKpis={uniformKpis}
          onUndo={undo}
          onRedo={redo}
          onCopy={(from) => {
            commit(ed.draftOf(from).map((i) => ({ ...i })));
            toast(`${BUNDLE_LABELS[from]} 배치를 가져왔습니다 · 되돌리기로 취소할 수 있습니다`);
          }}
          onCopySubject={(from) => {
            const items = ed.draftOfSubject(from);
            if (!items) return;
            commit(items.map((i) => ({ ...i })));
            toast(`${subjects.find((s) => s.key === from)?.label ?? from} 배치를 가져왔습니다 · 되돌리기로 취소할 수 있습니다`);
          }}
          onReset={() => {
            commit(defaultItems(role));
            toast(`${BUNDLE_LABELS[role]} 배치를 기본값으로 되돌렸습니다`);
          }}
          onSubject={setSubject}
        />}
        </div>
        <AssignedStaff members={applicableMembers} bundle={role} />
        </div>
        {editing ? (
          <div className={e.stage} data-inspector={selectedItem ? "" : undefined}>
            <div className="flex min-w-0 flex-col gap-3">
              {listMode || !original ? (
                <>
                  <RowEditor items={items} onCommit={commit} />
                  <ListBoard items={items} role={role} menus={menus} selected={selected} onSelect={select} onCommit={commit} onRemoved={onRemoved} />
                  <Button type="button" variant="outline" onClick={appendRow}>+ 하단에 행 추가</Button>
                  <UnusedList ids={unused} onAdd={(id) => add(id)} />
                </>
              ) : (
                <EditBoard
                  key={`${role}:${subject}`}
                  items={items}
                  unused={unused}
                  onAddRow={appendRow}
                  selected={selected}
                  renderPreview={(next) => <RolePreview full={original} role={role} items={next} menus={menus} subject={previewSubject} />}
                  onSelect={select}
                  onCommit={commit}
                  onRemoved={onRemoved}
                  onAdd={(id) => add(id)}
                />
              )}
            </div>
            {selectedItem ? (
              <CardInspector key={selectedItem.id} item={selectedItem} items={items} role={role} menus={menus} onCommit={commit} onRemoved={onRemoved} onClose={() => select(null)} />
            ) : null}
          </div>
        ) : full === null ? (
          <p className={e.note}>{readOnly ? "실데이터 미리보기를 불러오는 중입니다…" : "실데이터 미리보기를 불러오는 중입니다… 그동안 ‘편집’을 눌러 배치를 바꿀 수 있습니다."}</p>
        ) : full === "failed" ? (
          <p className={e.note} data-tone="danger">
            {readOnly ? "미리보기 데이터를 불러오지 못했습니다(새로고침하면 다시 불러옵니다)." : "미리보기 데이터를 불러오지 못했습니다. 배치 편집·저장은 그대로 할 수 있습니다(새로고침하면 다시 불러옵니다)."}
          </p>
        ) : (
          <RolePreview full={full} role={role} items={items} menus={menus} subject={previewSubject} />
        )}
        <WidgetGallery open={galleryOpen && !readOnly} onOpenChange={setGalleryOpen} items={items} role={role} menus={menus} snapshot={snapshot} onAdd={add} />
      </div>
    </SectionForm>
  );
}
