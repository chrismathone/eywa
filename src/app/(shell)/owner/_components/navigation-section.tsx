"use client";

import { useMemo, useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { MenuKey } from "@/lib/permissions";
import { adminEditorSource } from "@/features/owner/navigation-editor-source";
import { type MenuLayoutRow, type MenuGroupLayoutRow } from "@/features/owner/menu-layout";
import { navigationRevision } from "@/features/owner/normalize-navigation";
import type { NavigationSettings } from "@/features/owner/settings-types";
import { SectionForm } from "./section-form";
import { AdminMenuEditor } from "./admin-menu-editor";
import { TeacherMenuEditor } from "./teacher-menu-editor";

export function NavigationSection({ initial, teacherOpen, teacherPersonal, closedMenus, onPreview, onViewChange, readOnly = false }: {
  initial: NavigationSettings; teacherOpen: readonly MenuKey[];
  /** 읽기 권한 — 저장 바·복원·편집 단추를 그리지 않는다(저장 액션과 같은 판정, page.tsx). */
  readOnly?: boolean;
  /** 개인별 메뉴 권한으로 누군가에게 연 메뉴 — 강사 역할에 꺼져 있어도 강사뷰 편집기에 남긴다. */
  teacherPersonal?: readonly MenuKey[];
  /** 이 지점에서 아무도 열 수 없는 메뉴(꺼 둔 기능 · 보강 모드 · 실험실 · 라이선스) — 편집기에 세우지 않는다. */
  closedMenus?: readonly MenuKey[];
  /** 로컬 dev 미리보기만 제공하는 저장 대체 함수. 운영 저장은 SectionForm의 단일 경로. */
  onPreview?: (settings: NavigationSettings) => void;
  onViewChange?: (view: "admin" | "teacher") => void;
}) {
  const [view, setView] = useState<"admin" | "teacher">("admin");
  const adminSource = useMemo(() => adminEditorSource(closedMenus), [closedMenus]);
  const [menus, setMenus] = useState<MenuLayoutRow[]>(initial.menus);
  const [groups, setGroups] = useState<MenuGroupLayoutRow[]>(initial.groups ?? []);
  const [confirmReset, setConfirmReset] = useState(false);
  const [teacherMenus, setTeacherMenus] = useState<MenuLayoutRow[]>(initial.teacherMenus);
  const [teacherGroups, setTeacherGroups] = useState<MenuGroupLayoutRow[]>(initial.teacherGroups ?? []);
  const payload: NavigationSettings = { menus, groups, teacherMenus, teacherGroups };
  const changeView = (next: "admin" | "teacher") => { setView(next); setConfirmReset(false); onViewChange?.(next); };
  const incoming = navigationRevision(initial);
  const [baseline, setBaseline] = useState(incoming);
  const [seenInitial, setSeenInitial] = useState(incoming);
  // 서버 갱신은 깨끗한 폼에만 반영한다. 작성 중인 폼은 기존 baseline을 유지해 덮어쓰기 저장을 거부한다.
  if (incoming !== seenInitial) {
    setSeenInitial(incoming);
    const draft = navigationRevision(payload);
    if (draft === baseline) {
      setMenus(initial.menus); setGroups(initial.groups ?? []);
      setTeacherMenus(initial.teacherMenus); setTeacherGroups(initial.teacherGroups ?? []);
      setBaseline(incoming);
    } else if (draft === incoming) setBaseline(incoming);
  }
  const content = <>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-foreground text-xl font-bold">탭 및 메뉴 구성</h3><p className="text-text-dim mt-1 text-sm">학원에 맞는 이름과 메뉴로 업무 공간을 구성하세요.</p></div>
        <ToolbarSegment label="구성할 화면"><ToolbarSegmentItem active={view === "admin"} onClick={() => changeView("admin")}>관리자뷰</ToolbarSegmentItem><ToolbarSegmentItem active={view === "teacher"} onClick={() => changeView("teacher")}>강사뷰</ToolbarSegmentItem></ToolbarSegment>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-text-dim max-w-3xl text-xs leading-relaxed">{view === "admin" ? "왼쪽에서 탭을 고른 뒤 이름·아이콘을 바꾸고 내부 메뉴를 배치하세요. 사이드바·휴대폰 메뉴·검색에 함께 적용됩니다. 화면 안의 탭(수납의 환불 요청서·회차 확정, 셔틀의 오늘 등하원 등)은 그 화면 위에서 오가므로 여기에 따로 담지 않습니다." : "강사 ‘내 메뉴’에 원하는 폴더를 만들고 메뉴를 끌어 담으세요. 탭과 내부 메뉴의 이름·아이콘·순서를 자유롭게 정할 수 있습니다."}<br />학원 전체에 적용되며, 직원마다 권한이 있는 메뉴만 보입니다. 메뉴를 숨겨도 기존 접근 권한은 바뀌지 않습니다.</p>
        {readOnly ? null : <button type="button" onClick={() => setConfirmReset(!confirmReset)} className="border-line hover:bg-bg-soft rounded-lg border px-3 py-2 text-xs font-semibold">{view === "admin" ? "관리자뷰" : "강사뷰"} 기본 구성 복원</button>}
      </div>
      {confirmReset && !readOnly ? <div className="border-line bg-bg-soft flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"><p className="flex-1">{view === "admin" ? "관리자뷰" : "강사뷰"}의 탭·이름·아이콘·배치를 기본 구성으로 되돌립니다. 저장하면 적용됩니다.</p><button type="button" className="text-primary font-bold" onClick={() => { if (view === "admin") { setMenus([]); setGroups([]); } else { setTeacherMenus([]); setTeacherGroups([]); } setConfirmReset(false); }}>기본 구성으로 되돌리기</button><button type="button" onClick={() => setConfirmReset(false)}>취소</button></div> : null}
    </div>
    {view === "admin" ? <AdminMenuEditor menus={menus} groups={groups} onMenus={setMenus} onGroups={setGroups} source={adminSource} /> : <TeacherMenuEditor menus={teacherMenus} groups={teacherGroups} teacherOpen={teacherOpen} teacherPersonal={teacherPersonal} onMenus={setTeacherMenus} onGroups={setTeacherGroups} />}
  </>;
  return onPreview ? <div className="space-y-6">{content}<button type="button" onClick={() => onPreview(payload)} className="bg-primary text-primary-foreground rounded-xl px-5 py-3 font-bold">미리보기에 적용</button></div> : <SectionForm section="navigation" payload={payload} navigationBaseline={baseline} readOnly={readOnly}>{content}</SectionForm>;
}
