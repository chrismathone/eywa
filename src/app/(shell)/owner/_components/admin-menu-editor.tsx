"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { configuredHubGroups, HUB_GROUPS, SUPPORT_GROUPS, type HubDest, type HubGroup } from "@/lib/menu-hub";
import { FIXED_GROUP_IDS, MAX_NAV_GROUPS, isFixedDestination, isMenuHiddenByLayout, type MenuLayoutRow, type MenuGroupLayoutRow } from "@/features/owner/menu-layout";
import { placeNavigationGroup, placeNavigationMenu } from "@/features/owner/navigation-placement";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { MenuIconPicker } from "./menu-icon-picker";
import { useWriteLock } from "./write-lock-context";
import { LibraryMenu, MenuDropEnd, NavigationDragRow, navigationKeyboardCoordinates, type NavigationDrag, type NavigationDrop, type NavigationHover } from "./navigation-drag";

const ADMIN_SOURCE = [...HUB_GROUPS, ...SUPPORT_GROUPS];
const field = "border-line bg-card min-w-0 rounded-lg border px-3 py-2 text-sm";
const button = "border-line hover:bg-bg-soft rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-35";

export function AdminMenuEditor({ menus, groups, onMenus, onGroups, source = ADMIN_SOURCE, fixedContent, menuHint }: {
  menus: MenuLayoutRow[]; groups: MenuGroupLayoutRow[];
  onMenus: (rows: MenuLayoutRow[]) => void; onGroups: (rows: MenuGroupLayoutRow[]) => void;
  source?: HubGroup[]; fixedContent?: ReactNode; menuHint?: (d: HubDest) => string | undefined;
}) {
  const originals = source;
  const catalog = originals.flatMap((g) => g.items).filter((d) => !isFixedDestination(d.href));
  const [selected, setSelected] = useState(() => source.find((g) => !FIXED_GROUP_IDS.has(g.id))?.id ?? "class");
  const [adding, setAdding] = useState(true);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState<NavigationDrag | null>(null);
  const [hover, setHover] = useState<NavigationHover | null>(null);
  const [notice, setNotice] = useState("");
  // 🔴 읽기 권한(쓰기 잠금)이면 탭 추가·삭제·순서 이동·메뉴 담기를 그리지 않는다(write-lock-context.tsx).
  //    ⚠️ 탭 고르기·관리자뷰/강사뷰 전환도 일반 단추라 SectionForm·페이지 fieldset 안에서 비활성이다 — 읽기 사용자는 처음 보이는
  //    탭 구성만 본다(이번 변경 전부터 같다 · 2026-11-05 리뷰).
  const { locked } = useWriteLock();
  const dragSnapshot = useRef<NavigationDrag | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: navigationKeyboardCoordinates }),
  );
  const resolved = configuredHubGroups(originals, menus, groups, true);
  const editable = resolved.filter((g) => !FIXED_GROUP_IDS.has(g.id) && !g.hidden);
  const current = editable.find((g) => g.id === selected) ?? editable[0];
  const groupSlots = new Set([...groups.map((g) => g.id), ...editable.map((g) => g.id)]).size;
  const allDestinations = resolved.flatMap((g) => g.items);

  const patchMenu = (href: string, patch: Partial<MenuLayoutRow>) => {
    const found = menus.find((r) => r.href === href);
    onMenus([...menus.filter((r) => r.href !== href), { ...found, href, ...patch }]);
  };
  const patchGroup = (id: string, patch: Partial<MenuGroupLayoutRow>) => {
    const found = groups.find((r) => r.id === id);
    onGroups([...groups.filter((r) => r.id !== id), { ...found, id, ...patch }]);
  };
  const reorderGroups = (index: number, delta: number) => {
    const anchor = editable[index + delta];
    if (anchor) onGroups(placeNavigationGroup(groups, resolved, editable[index].id, anchor.id, delta > 0 ? "after" : "before"));
  };
  const reorderMenus = (index: number, delta: number) => {
    const anchor = current?.items[index + delta];
    if (anchor) onMenus(placeNavigationMenu(menus, resolved, current.items[index].href, current.id, { href: anchor.href, edge: delta > 0 ? "after" : "before" }));
  };
  const moveMenu = (d: HubDest, groupId: string) => {
    onMenus(placeNavigationMenu(menus, resolved, d.href, groupId, undefined, true));
  };

  // 손끝이 들어간 행만 받는다. 영역 밖이나 고정 탭에 놓으면 이동하지 않는다.
  const collisionDetection: CollisionDetection = (args) => {
    pointer.current = args.pointerCoordinates;
    const kind = args.active.data.current?.kind;
    const containers = args.droppableContainers.filter((c) => {
      const target = c.data.current as NavigationDrop | undefined;
      return target && (kind === "menu" || (kind === "group" && target.kind === "group"));
    });
    const point = args.pointerCoordinates ?? { x: args.collisionRect.left + args.collisionRect.width / 2, y: args.collisionRect.top + args.collisionRect.height / 2 };
    return pointerWithin({ ...args, droppableContainers: containers, pointerCoordinates: point });
  };
  const dropPosition = (event: DragMoveEvent): NavigationHover | null => {
    const target = event.over?.data.current as NavigationDrop | undefined;
    if (!event.over || !target) return null;
    const edge = pointer.current ? (pointer.current.y < event.over.rect.top + event.over.rect.height / 2 ? "before" : "after") : event.delta.y < 0 ? "before" : "after";
    return { id: String(event.over.id), target, edge };
  };
  const updateHover = (event: DragMoveEvent) => {
    const next = dropPosition(event);
    setHover((prev) => prev?.id === next?.id && prev?.edge === next?.edge ? prev : next);
  };
  const clearDrag = () => { dragSnapshot.current = null; setDragging(null); setHover(null); pointer.current = null; };
  const finishDrag = (event: DragEndEvent) => {
    const source = dragSnapshot.current;
    const position = dropPosition(event);
    clearDrag();
    if (!source || !position) return;
    const { target, edge } = position;
    if (source.kind === "group") {
      if (target.kind !== "group" || target.groupId === source.groupId) return;
      onGroups(placeNavigationGroup(groups, resolved, source.groupId, target.groupId, edge));
      setNotice(`‘${source.label}’ 탭의 위치를 옮겼습니다.`);
      return;
    }
    const parent = resolved.find((g) => g.items.some((d) => d.href === source.href));
    if (target.kind === "group" && parent?.id === target.groupId && !isMenuHiddenByLayout(source.href, menus)) return;
    const next = placeNavigationMenu(menus, resolved, source.href, target.groupId, target.kind === "menu" ? { href: target.href, edge } : undefined, source.fromLibrary);
    if (next === menus) return;
    onMenus(next);
    setSelected(target.groupId); setDeleting(false);
    const destination = resolved.find((g) => g.id === target.groupId);
    setNotice(`${destination?.label ?? "탭"}에 ‘${source.label}’ 메뉴를 놓았습니다.`);
  };

  const library = catalog.filter((d) => `${d.label} ${allDestinations.find((x) => x.href === d.href)?.label ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const hoverFolder = dragging?.kind === "menu" && hover?.target.kind === "group" ? hover.target.groupId : null;

  return <DndContext id={dragId} sensors={sensors} collisionDetection={collisionDetection} autoScroll={{ threshold: { x: 0.08, y: 0.08 }, acceleration: 5 }}
    onDragStart={({ active }) => { const data = active.data.current as NavigationDrag; dragSnapshot.current = data; setDragging(data); setNotice(""); }}
    onDragMove={updateHover} onDragOver={updateHover} onDragEnd={finishDrag} onDragCancel={() => { clearDrag(); setNotice("이동을 취소했습니다."); }}
    accessibility={{
      screenReaderInstructions: { draggable: "스페이스로 집고 방향키로 이동한 뒤 스페이스로 놓으세요. Escape로 취소합니다. 화살표 버튼과 소속 탭 선택으로도 이동할 수 있습니다." },
      announcements: {
        onDragStart: ({ active }) => `${active.data.current?.label ?? "메뉴"} 집기.`,
        onDragOver: ({ over }) => over ? `${over.data.current?.label ?? "메뉴"}에 놓을 수 있습니다.` : "놓을 위치 밖입니다.",
        onDragEnd: ({ over }) => over ? "이동을 마쳤습니다. 변경한 구성은 저장하면 적용됩니다." : "위치를 바꾸지 않았습니다.",
        onDragCancel: () => "이동을 취소했습니다.",
      },
    }}>
    <div className="space-y-4">
      <div className="border-line bg-bg-soft flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        {fixedContent ?? <><span className="text-text-dim text-xs font-bold">기본 사용</span>
        {originals.filter((g) => FIXED_GROUP_IDS.has(g.id)).map((g) => <span key={g.id} className="flex items-center gap-2 text-sm font-semibold"><MenuGlyph name={g.icon} size={18} />{g.label}</span>)}
        <span className="text-text-faint text-xs">항상 기본 위치와 이름으로 표시됩니다.</span></>}
      </div>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs">
        {locked ? <span /> : <p className="text-text-dim">메뉴를 집어 왼쪽 탭에 담으세요. 손잡이를 끌면 탭과 메뉴의 순서도 바뀝니다.</p>}
        <span role="status" className="text-primary font-semibold">{hoverFolder ? `${resolved.find((g) => g.id === hoverFolder)?.label}에 놓기` : notice}</span>
      </div>
      <div className="border-line grid overflow-visible rounded-xl border lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-line bg-bg-soft/40 border-b p-3 lg:border-r lg:border-b-0" aria-label="편집할 큰 탭">
          <div className="lg:sticky lg:top-3">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-bold">왼쪽 탭</h3>
              {locked ? null : <button type="button" className="text-primary text-xs font-bold disabled:opacity-35" disabled={groupSlots >= MAX_NAV_GROUPS} onClick={() => {
                const id = `custom-${crypto.randomUUID()}`;
                onGroups([...groups.filter((r) => !editable.some((g) => g.id === r.id)),
                  ...editable.map((g, order) => ({ ...groups.find((r) => r.id === g.id), id: g.id, order })),
                  { id, label: "새 탭", icon: "folder", order: editable.length }]);
                setSelected(id); setAdding(true); setDeleting(false);
              }}>+ 탭 추가</button>}
            </div>
            <ul className="space-y-2 p-1 lg:max-h-[70dvh] lg:overflow-y-auto" aria-label="탭 순서 및 메뉴 담기">{editable.map((g, index) => <NavigationDragRow key={g.id} id={`group:${g.id}`}
              drag={{ kind: "group", groupId: g.id, label: g.label, icon: g.icon }} drop={{ kind: "group", groupId: g.id, label: g.label }}
              hover={dragging?.kind === "group" ? hover : null} folderOver={hoverFolder === g.id}
              className={`flex items-center gap-0.5 rounded-lg p-1 ${current?.id === g.id ? "bg-primary-soft" : "hover:bg-bg-soft"}`}>
              <button type="button" aria-pressed={current?.id === g.id} onClick={() => { setSelected(g.id); setDeleting(false); }} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm font-semibold">
                <MenuGlyph name={g.icon} size={22} />
                <span className="min-w-0 flex-1 break-words">{g.label}{hoverFolder === g.id ? <span className="text-primary block text-xs">여기에 담기</span> : null}</span>
                <span className="text-text-faint text-xs">{g.items.filter((d) => !isMenuHiddenByLayout(d.href, menus)).length}</span>
              </button>
              {locked ? null : <div className="flex shrink-0"><button type="button" aria-label={`${g.label} 탭 위로`} disabled={index === 0} onClick={() => reorderGroups(index, -1)} className="p-1 disabled:opacity-25">↑</button><button type="button" aria-label={`${g.label} 탭 아래로`} disabled={index === editable.length - 1} onClick={() => reorderGroups(index, 1)} className="p-1 disabled:opacity-25">↓</button></div>}
            </NavigationDragRow>)}</ul>
          </div>
        </aside>
        <section className="min-w-0 p-3 sm:p-5" aria-label="탭과 내부 메뉴 편집">
          {current ? <>
            <div className="mb-5 flex flex-wrap items-end gap-3">
              <MenuIconPicker value={current.icon} label={current.label} onChange={(icon) => patchGroup(current.id, { icon })} />
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold">큰 탭 이름<input className={field} aria-label="큰 탭 이름" maxLength={24} value={groups.find((g) => g.id === current.id)?.label ?? current.label} onChange={(e) => patchGroup(current.id, { label: e.target.value })} /></label>
              {locked ? null : <button type="button" className={`${button} text-danger`} onClick={() => setDeleting(!deleting)}>탭 삭제</button>}
            </div>
            {deleting && !locked ? <div className="border-danger/30 bg-danger-soft mb-4 rounded-lg border p-3 text-sm"><p>이 탭과 안의 메뉴를 숨깁니다. 메뉴는 보관함에서 다른 탭에 다시 담을 수 있습니다.</p><div className="mt-2 flex gap-2"><button type="button" className={button} onClick={() => { patchGroup(current.id, { hidden: true }); setDeleting(false); }}>삭제하기</button><button type="button" className={button} onClick={() => setDeleting(false)}>취소</button></div></div> : null}
            <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-sm font-bold">내부 메뉴 <span className="text-text-faint">{current.items.length}</span></h4>{locked ? null : <button type="button" aria-expanded={adding} className={`${button} text-primary`} onClick={() => setAdding(!adding)}>{adding ? "보관함 접기" : "+ 메뉴 추가"}</button>}</div>
            <div className={`grid items-start gap-4 ${adding && !locked ? "xl:grid-cols-[minmax(0,1fr)_250px]" : ""}`}>
              <div className="min-w-0">
                <ul className="space-y-3" aria-label={`${current.label} 내부 메뉴`}>{current.items.map((d, index) => {
                  const row = menus.find((r) => r.href === d.href);
                  const hidden = isMenuHiddenByLayout(d.href, menus);
                  return <NavigationDragRow key={d.href} id={`menu:${d.href}`} drag={{ kind: "menu", href: d.href, label: d.label, icon: d.icon }}
                    drop={{ kind: "menu", groupId: current.id, href: d.href, label: d.label }} hover={dragging?.kind === "menu" && dragging.href !== d.href ? hover : null}
                    className={`border-line flex items-start gap-1 rounded-xl border px-2 py-3 ${hidden ? "bg-bg-soft" : "bg-card"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" aria-label={`${d.originalLabel} 표시`} checked={!hidden} onChange={() => patchMenu(d.href, { hidden: !hidden })} className="accent-primary size-4 shrink-0" />
                        <MenuIconPicker value={d.icon} label={d.originalLabel ?? d.label} onChange={(icon) => patchMenu(d.href, { icon })} />
                        <input aria-label={`${d.originalLabel} 메뉴 이름`} maxLength={40} className={`${field} w-full flex-1`} value={row?.label ?? d.label} onChange={(e) => patchMenu(d.href, { label: e.target.value })} />
                        {locked ? null : <><button type="button" className="p-1 disabled:opacity-25" aria-label={`${d.originalLabel} 위로`} disabled={index === 0} onClick={() => reorderMenus(index, -1)}>↑</button><button type="button" className="p-1 disabled:opacity-25" aria-label={`${d.originalLabel} 아래로`} disabled={index === current.items.length - 1} onClick={() => reorderMenus(index, 1)}>↓</button></>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-text-faint">기본 이름: {d.originalLabel}{d.teacherOnly ? " · 담당 반이 있는 계정" : ""}{hidden ? " · 숨김" : ""}</span><select aria-label={`${d.originalLabel} 소속 탭`} className="border-line bg-card max-w-full rounded-md border px-2 py-1" value={current.id} onChange={(e) => moveMenu(d, e.target.value)}>{editable.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></div>
                      {menuHint?.(d) ? <p className="text-text-dim mt-2 text-xs leading-relaxed">{menuHint(d)}</p> : null}
                    </div>
                  </NavigationDragRow>;
                })}</ul>
                {locked ? null : <MenuDropEnd groupId={current.id} label={current.label} empty={current.items.length === 0} active={dragging?.kind === "menu"} />}
              </div>
              {adding && !locked ? <aside className="border-line bg-bg-soft/50 order-first min-w-0 rounded-xl border p-3 xl:sticky xl:top-3 xl:order-last" aria-label="메뉴 보관함">
                <h4 className="text-sm font-bold">메뉴 보관함</h4>
                <p className="text-text-dim mt-1 mb-3 text-xs">메뉴를 끌어 탭이나 원하는 순서에 놓으세요. 클릭하면 현재 탭에 담깁니다.</p>
                <input aria-label="추가할 메뉴 검색" placeholder="이름으로 메뉴 찾기" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} mb-2 w-full`} />
                <div className="max-h-60 space-y-1 overflow-y-auto overscroll-contain pr-1 xl:max-h-[60dvh]">{library.map((d) => {
                  const parent = resolved.find((g) => g.items.some((x) => x.href === d.href));
                  const shown = allDestinations.find((x) => x.href === d.href) ?? d;
                  const hidden = parent?.hidden || isMenuHiddenByLayout(d.href, menus);
                  const present = parent?.id === current.id && !hidden;
                  return <LibraryMenu key={d.href} drag={{ kind: "menu", href: d.href, label: shown.label, icon: shown.icon }} present={present}
                    location={hidden ? "숨김 · 다시 담기" : present ? `${current.label}에 담김` : `${parent?.label ?? ""}에서 이동`} onAdd={() => moveMenu(d, current.id)} />;
                })}{library.length === 0 ? <p className="text-text-faint py-6 text-center text-sm">찾는 메뉴가 없습니다.</p> : null}</div>
              </aside> : null}
            </div>
          </> : <p className="text-text-dim py-10 text-center text-sm">{locked ? "구성한 탭이 없습니다." : "‘탭 추가’로 메뉴를 구성해 주세요."}</p>}
        </section>
      </div>
    </div>
    {dragging ? createPortal(<DragOverlay dropAnimation={null} zIndex={10000} style={{ width: 240 }}>
      <div className="border-primary bg-card text-foreground shadow-modal pointer-events-none flex items-center gap-3 rounded-xl border-2 px-4 py-3"><MenuGlyph name={dragging.icon} size={28} /><span className="min-w-0 break-words text-sm font-bold">{dragging.label}</span></div>
    </DragOverlay>, document.body) : null}
  </DndContext>;
}
