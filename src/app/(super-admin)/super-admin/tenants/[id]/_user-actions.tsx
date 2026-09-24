"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { ASSIGNABLE_ROLES } from "@/features/super-admin/labels";
import {
  changeUserRole,
  resetUserPassword,
  setUserActive,
} from "@/features/super-admin/server/actions";

/**
 * 계정 한 줄의 관리 동작 — 역할 변경 · 활성/비활성 · 비밀번호 재설정(2단계 확인).
 * ⚠️ 역할 선택지는 `ASSIGNABLE_ROLES`(= `ROLE_LABEL`) — 여기 사본을 두지 말 것(종전 사본은 "상담"·"뷰어"로
 *    직원관리의 "상담사"·"참관"과 이름이 갈려 있었다).
 * ⚠️ 역할 고르기 = 포털 메뉴(`DropdownMenu`) — 표·카드 안에서 잘리지 않고 폰 키보드를 안 띄운다. 고르는 즉시 저장한다.
 */
export function UserActions({
  userId,
  tenantId,
  tenantName,
  currentRole,
  status,
}: {
  userId: string;
  tenantId: string;
  tenantName: string;
  currentRole: string;
  status: string;
}) {
  const [roleState, roleAction, rolePending] = useActionState(changeUserRole, undefined);
  const [pwState, pwAction, pwPending] = useActionState(resetUserPassword, undefined);
  const [activeState, activeAction, activePending] = useActionState(setUserActive, undefined);
  const [role, setRole] = useState(currentRole);
  const [confirmReset, setConfirmReset] = useState(false);
  const isActive = status === "active";
  const error = roleState?.error || pwState?.error || activeState?.error;
  // 저장이 거절되면 서버 값으로 되돌려 보인다 — 고른 값이 그대로 남으면 "바뀐 줄" 안다.
  const shownRole = roleState?.error ? currentRole : role;

  const ids = (fd: FormData) => {
    fd.set("userId", userId);
    fd.set("tenantId", tenantId);
    fd.set("tenantName", tenantName);
    return fd;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 🔴 검색형 드롭다운(SearchableSelect)을 쓰지 않는다(원장 2026-09-25 폰 캡처) — 팝업이 카드 안에 그려져
          카드의 overflow에 잘렸고([[#128]]), 열자마자 검색칸에 포커스가 가 폰 키보드가 화면 절반을 덮었다.
          역할은 7개뿐이라 검색이 필요 없다 → 포털로 뜨는 메뉴(잘리지 않음·키보드 없음). */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`역할 변경: ${ASSIGNABLE_ROLES.find((r) => r.value === shownRole)?.label ?? "알 수 없음"}`}
          className={`${TOOLBAR_SELECT} w-28 cursor-pointer justify-between gap-1`}
        >
          <span className="truncate">{ASSIGNABLE_ROLES.find((r) => r.value === shownRole)?.label ?? "알 수 없음"}</span>
          <EyIcon name="chevronDown" size={16} strokeWidth={1.8} className="shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-36">
          <DropdownMenuRadioGroup
            value={shownRole}
            onValueChange={(next) => {
              if (typeof next !== "string" || !next || next === shownRole) return;
              setRole(next);
              const fd = ids(new FormData());
              fd.set("role", next);
              startTransition(() => roleAction(fd));
            }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <DropdownMenuRadioItem key={r.value} value={r.value} className="min-h-9 text-base">
                {r.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <form action={(fd) => activeAction(ids(fd))}>
        <input type="hidden" name="active" value={(!isActive).toString()} />
        <Button type="submit" variant={isActive ? "outline" : "default"} disabled={activePending}>
          {isActive ? "비활성화" : "활성화"}
        </Button>
      </form>

      {confirmReset ? (
        <form
          action={(fd) => {
            setConfirmReset(false);
            pwAction(ids(fd));
          }}
          className="inline-flex items-center gap-1"
        >
          <Button type="submit" variant="destructive">
            재설정 확인
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmReset(false)}>
            취소
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>
          비밀번호 재설정
        </Button>
      )}

      {rolePending ? <span className="text-foreground text-xs">역할 저장 중…</span> : null}
      {pwPending ? <span className="text-foreground text-xs">비밀번호 재설정 중…</span> : null}
      {pwState?.tempPassword ? (
        <span className="bg-green-soft text-green rounded-md px-2 py-0.5 text-xs font-bold">
          임시 비밀번호 <span className="font-mono select-all">{pwState.tempPassword}</span>
        </span>
      ) : null}
      {error ? <span className="text-danger text-xs font-medium">{error}</span> : null}
    </div>
  );
}
