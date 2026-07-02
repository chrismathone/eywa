"use client";

import { useActionState, useState } from "react";
import {
  changeUserRole,
  resetUserPassword,
  setUserActive,
} from "@/features/super-admin/server/actions";

const ROLE_OPTIONS = [
  { value: "master", label: "owner" },
  { value: "admin", label: "관리자" },
  { value: "manager", label: "매니저" },
  { value: "teacher", label: "강사" },
  { value: "counselor", label: "상담" },
  { value: "accountant", label: "회계" },
  { value: "viewer", label: "뷰어" },
];

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
  const [roleState, roleAction] = useActionState(changeUserRole, undefined);
  const [pwState, pwAction, pwPending] = useActionState(resetUserPassword, undefined);
  const [activeState, activeAction, activePending] = useActionState(setUserActive, undefined);
  const [confirmReset, setConfirmReset] = useState(false);
  const isActive = status === "active";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* 역할 변경 */}
      <form action={roleAction} className="inline-flex items-center gap-1">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="tenantName" value={tenantName} />
        <select
          name="role"
          defaultValue={currentRole}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="border-line bg-background text-foreground rounded-sm border px-1.5 py-0.5 text-[11px]"
          aria-label="역할 변경"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </form>

      {/* 활성/비활성 */}
      <form action={activeAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="tenantName" value={tenantName} />
        <input type="hidden" name="active" value={(!isActive).toString()} />
        <button
          type="submit"
          disabled={activePending}
          className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${
            isActive
              ? "border-line text-text-dim hover:text-danger"
              : "border-primary text-primary"
          }`}
        >
          {isActive ? "비활성화" : "활성화"}
        </button>
      </form>

      {/* 비번 재설정 */}
      {confirmReset ? (
        <form action={pwAction} className="inline-flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="tenantName" value={tenantName} />
          <button
            type="submit"
            disabled={pwPending}
            className="bg-danger rounded-sm px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {pwPending ? "…" : "확인"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(false)}
            className="text-text-dim text-[11px]"
          >
            취소
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="border-line text-text-dim hover:text-foreground rounded-sm border px-2 py-0.5 text-[11px]"
        >
          비번 재설정
        </button>
      )}

      {/* 결과 표시 */}
      {pwState?.tempPassword ? (
        <span className="text-primary font-mono text-[11px]">
          임시 비번: <strong>{pwState.tempPassword}</strong>
        </span>
      ) : null}
      {(roleState?.error || pwState?.error || activeState?.error) ? (
        <span className="text-danger text-[10px]">
          {roleState?.error || pwState?.error || activeState?.error}
        </span>
      ) : null}
    </div>
  );
}
