"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { Toolbar, ToolbarButton, ToolbarDivider, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { BUNDLE_LABELS, BUNDLES, type Bundle } from "@/features/dashboard/layout/types";
import { DASHBOARD_ROLES, DASHBOARD_ROLE_LABELS, ROLE_BUNDLE, roleOfBundle } from "@/features/dashboard/layout/roles";

/** 역할 고르기 — 저장 안 한 편집이 있는 역할엔 점(●), 직접 구성한 역할엔 '직접'. */
export function RoleBar({
  role,
  status,
  onRole,
}: {
  role: Bundle;
  status: Record<Bundle, { isDefault: boolean; dirty: boolean }>;
  onRole: (b: Bundle) => void;
}) {
  return (
    <Toolbar>
      <ToolbarSegment label="역할" wrap>
        {DASHBOARD_ROLES.map((r) => {
          const b = ROLE_BUNDLE[r];
          const dirty = status[b].dirty || (r === "admin" && status.desk.dirty);
          return <ToolbarSegmentItem key={r} active={roleOfBundle(role) === r} onClick={() => onRole(b)} aria-label={`${DASHBOARD_ROLE_LABELS[r]} 배치${dirty ? " (저장 안 한 변경 있음)" : ""}`}>
            {DASHBOARD_ROLE_LABELS[r]}
            {dirty ? <span aria-hidden> ●</span> : !status[b].isDefault ? <span aria-hidden className="opacity-70"> · 직접</span> : null}
          </ToolbarSegmentItem>
        })}
      </ToolbarSegment>
      {roleOfBundle(role) === "admin" ? <ToolbarSegment label="관리자 배치">
        <ToolbarSegmentItem active={role === "subject"} onClick={() => onRole("subject")}>과목 운영형</ToolbarSegmentItem>
        <ToolbarSegmentItem active={role === "desk"} onClick={() => onRole("desk")}>경영지원형</ToolbarSegmentItem>
      </ToolbarSegment> : null}
    </Toolbar>
  );
}

/**
 * 편집 동작 줄 — '편집' ↔ '완료'가 맨 앞(iOS처럼 진입·끝이 분명), 편집 중에만 위젯 추가·구역 제목·되돌리기·복사가 선다.
 * '기본값으로'는 코드의 기본 배치로 되돌린다(되돌리기로 취소 가능). 과목 관리자는 미리보기 과목을 고른다.
 */
export function EditorActions(p: {
  role: Bundle;
  editing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isDefault: boolean;
  subjects: readonly { key: string; label: string }[];
  subject: string | null;
  onEditing: (on: boolean) => void;
  onGallery: () => void;
  onHeading: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: (from: Bundle) => void;
  onReset: () => void;
  onSubject: (key: string) => void;
}) {
  return (
    <Toolbar>
      <ToolbarButton variant="primary" onClick={() => p.onEditing(!p.editing)} aria-pressed={p.editing}>
        <EyIcon name={p.editing ? "check" : "edit"} aria-hidden />
        {p.editing ? "완료" : "편집"}
      </ToolbarButton>
      {p.editing ? (
        <>
          <ToolbarButton onClick={p.onGallery}>
            <EyIcon name="plus" aria-hidden />
            위젯 추가
          </ToolbarButton>
          <ToolbarButton onClick={p.onHeading}>구역 제목 넣기</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton onClick={p.onUndo} disabled={!p.canUndo} aria-keyshortcuts="Control+Z">
            <EyIcon name="undo" aria-hidden />
            되돌리기
          </ToolbarButton>
          <ToolbarButton onClick={p.onRedo} disabled={!p.canRedo} aria-keyshortcuts="Control+Shift+Z">
            다시 하기
          </ToolbarButton>
          <ToolbarDivider />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex items-center gap-0.5 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
                />
              }
            >
              다른 역할 배치 복사
              <EyIcon name="chevronDown" size={18} className="opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {BUNDLES.filter((b) => b !== p.role).map((b) => (
                <DropdownMenuItem key={b} onClick={() => p.onCopy(b)}>
                  {BUNDLE_LABELS[b]} 배치로 바꾸기
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      <ToolbarButton onClick={p.onReset} disabled={p.isDefault}>
        기본값으로
      </ToolbarButton>
      {p.role === "subject" && p.subjects.length > 0 ? (
        <ToolbarSegment label="미리보기 과목" className="ml-auto">
          {p.subjects.map((s) => (
            <ToolbarSegmentItem key={s.key} active={p.subject === s.key} onClick={() => p.onSubject(s.key)}>
              {s.label}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      ) : null}
    </Toolbar>
  );
}
