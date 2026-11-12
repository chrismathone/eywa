"use client";

import { useActionState } from "react";
import { setTenantWindowMode } from "@/features/super-admin/server/actions";
import type { TenantLicenseRow } from "@/features/super-admin/server/queries";
import { licenseAllows, licenseExplicitlyOn } from "@/lib/license/rule";
import { modeFromFlags, SHELL_MODES, SHELL_MODE_LABEL, type ShellMode } from "@/lib/license/shell-mode";

/** 한 줄 설명 — 고르기 전에 무엇이 달라지는지 알 수 있게(원장 2026-10-01). */
const HINT: Record<ShellMode, string> = {
  windows: "메뉴마다 플로팅 창으로 엽니다(여러 창을 동시에).",
  keepalive: "한 화면씩 크게 열고, 다른 메뉴로 가도 이전 화면(입력·스크롤)을 최근 5개까지 2시간 동안 보관합니다.",
  single: "일반 웹앱처럼 본문 하나만 바꿉니다(떠난 화면은 사라짐).",
};

/**
 * 화면 방식 — 창 모드 / 단일 화면(이전 화면 유지) / 단일 화면 **셋 중 하나**(원장 2026-10-01). 켜기·끄기 스위치 한 줄이 아니라 고르는 줄이다.
 * 판정은 서버·화면이 같은 순수 함수(`modeFromFlags`) — 행이 없으면 창 모드(기존 지점 그대로).
 * ⚠️ 방식을 바꾸면 그 지점 사용자의 브라우저에 쌓인 창·유지 화면은 **다음 접속 때 전부 닫히고 빈 상태로** 시작한다(의도).
 */
export function WindowModeRow({
  tenantId,
  windowModeRow,
  keepaliveRow,
}: {
  tenantId: string;
  windowModeRow?: TenantLicenseRow;
  keepaliveRow?: TenantLicenseRow;
}) {
  const [state, action, pending] = useActionState(setTenantWindowMode, undefined);
  const current = modeFromFlags({
    windowMode: windowModeRow ? licenseAllows({ is_active: windowModeRow.isActive, expires_at: windowModeRow.expiresAt }) : true,
    keepalive: keepaliveRow ? licenseExplicitlyOn({ is_active: keepaliveRow.isActive, expires_at: keepaliveRow.expiresAt }) : false,
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-foreground text-sm font-bold">화면 방식(PC 관리자뷰)</span>
        <form action={action} className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="화면 방식">
          <input type="hidden" name="tenantId" value={tenantId} />
          {SHELL_MODES.map((m) => (
            <button
              key={m}
              type="submit"
              name="mode"
              value={m}
              role="radio"
              aria-checked={current === m}
              disabled={pending || current === m}
              className={`h-(--control-h) cursor-pointer rounded-lg px-3 text-sm font-medium transition disabled:cursor-default ${
                current === m ? "bg-primary text-primary-foreground" : "border-line text-foreground hover:bg-muted border disabled:opacity-60"
              }`}
            >
              {SHELL_MODE_LABEL[m]}
            </button>
          ))}
        </form>
      </div>
      <p className="text-foreground text-xs">
        {HINT[current]}
        {windowModeRow || keepaliveRow ? "" : " (기본값)"}
      </p>
      <p className="text-foreground text-xs">방식을 바꾸면 이 지점 직원들의 열린 창·보관 화면은 다음 접속 때 모두 닫히고 빈 상태로 시작합니다.</p>
      {state?.error ? <p className="text-danger text-xs font-medium">{state.error}</p> : null}
    </li>
  );
}
