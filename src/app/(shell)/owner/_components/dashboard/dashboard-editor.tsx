"use client";

import { useMemo, useRef } from "react";
import { toast } from "sonner";
import type { MenuKey } from "@/lib/permissions";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { editOf, itemsOf, type EditBoard } from "@/features/dashboard/layout/board-edit";
import { BUNDLE_LABELS, BUNDLE_RULES, type Bundle, type DashboardSettings } from "@/features/dashboard/layout/types";
import type { DashboardMembers } from "@/features/dashboard/layout/members";
import { SectionForm } from "../section-form";
import { AssignedStaff } from "./assigned-staff";
import { BoardEditor } from "./board-editor";
import { BoardPreview } from "./board-preview";
import { EditorActions, RoleBar } from "./editor-toolbar";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { useDashboardEditor } from "./use-editor";
import e from "./editor.module.css";
import b from "./board-editor.module.css";

export type DashboardEditorProps = {
  initial: DashboardSettings;
  /** 역할 묶음이 열 수 있는 메뉴(그 학원의 역할 권한 + 꺼진 기능) — 서버가 계산(`bundleMenus`). */
  roleMenus: Record<Bundle, MenuKey[]>;
  /** 과목 관리자 배치를 따로 둘 과목(운영실 과목 묶음마다 하나). */
  subjects: { key: string; label: string }[];
  /** 역할마다 지금 해당하는 직원 수. */
  members: DashboardMembers;
  /**
   * 읽기 권한(학원 설정 쓰기 없음 — 저장 액션과 같은 판정, page.tsx) — 편집 단추와 저장 바를 그리지 않고 칸 목록은 바꿀 수 없다.
   * ⚠️ 역할 전환 줄(RoleBar)도 페이지 fieldset(owner/page.tsx `disabled={!canEditSettings}`) 안이라 비활성이다(2026-11-05 리뷰).
   */
  readOnly?: boolean;
};

/**
 * 학원 설정 '대시보드 관리' — 역할마다 새 대시보드(한눈에 보기 / 오늘 운영 / 경영 현황)에 무엇을 세울지(원장 2026-11-09 재구성).
 * 왼쪽 = 화면의 자리 그대로 나눈 칸 목록, 오른쪽 = 그 역할이 실제로 보는 모양(서버와 같은 권한 판정). 저장은 아래 저장 바(역할 모두 한 번에).
 */
export function DashboardEditor({ initial, roleMenus, subjects, members, readOnly = false }: DashboardEditorProps) {
  const ed = useDashboardEditor(initial, subjects.map((s) => s.key));
  const { role, commit, undo, redo, subject, setSubject } = ed;
  // 동시 저장 = 마지막 저장이 이긴다(원장 2026-10-14) — 저장 기준과 달라진 배치(`ed.touched`)만 보낸다.
  const submittedRef = useRef<DashboardSettings | null>(null);
  const menus = useMemo(() => new Set(roleMenus[role]), [roleMenus, role]);
  const board = useMemo(() => editOf(ed.items), [ed.items]);
  const change = (next: EditBoard) => commit(itemsOf(next));
  const subjectChoice = subjects.find((s) => s.key === subject) ?? null;
  const applicableMembers = role === "subject" && subject ? { ...members, people: members.people.filter((p) => p.subjectKeys.includes(subject)) } : members;

  useEditorShortcuts(!readOnly, undo, redo);

  return (
    <SectionForm
      section="dashboard"
      payload={ed.payload}
      extraFields={{ dashboardPart: "layouts", dashboardTouched: JSON.stringify(ed.touched) }}
      onSubmit={() => { submittedRef.current = ed.payload; }}
      onSaved={() => { if (submittedRef.current) ed.markSaved(submittedRef.current); }}
      readOnly={readOnly}
    >
      <div className={e.editor}>
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
              canUndo={ed.canUndo}
              canRedo={ed.canRedo}
              isDefault={ed.status[role].isDefault}
              subjects={subjects}
              subject={subject}
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
        <div className={b.layout}>
          <BoardEditor key={`${role}:${subject}`} board={board} role={role} menus={menus} readOnly={readOnly} onChange={change} />
          <BoardPreview items={ed.items} role={role} menus={menus} subjectLabel={role === "subject" ? subjectChoice?.label : undefined} />
        </div>
      </div>
    </SectionForm>
  );
}
