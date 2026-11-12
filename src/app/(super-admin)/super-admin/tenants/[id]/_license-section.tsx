"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, fmtNum } from "@/components/super-admin/parts";
import { SEAT_FEATURES, TOGGLE_FEATURES, WINDOW_KEEPALIVE_KEY } from "@/features/super-admin/labels";
import { WindowModeRow } from "./_window-mode-row";
import { upsertTenantLicense, toggleTenantLicense } from "@/features/super-admin/server/actions";
import type { TenantLicenseRow } from "@/features/super-admin/server/queries";
import { licenseAllows, seatLimitOf } from "@/lib/license/rule";

/**
 * 학원 라이선스 — 좌석 제한(숫자) + 기능 켜기·끄기. 기능 이름은 `labels.ts` 단일 소스(서버 액션 검증과 같은 목록).
 * ⚠️ 켜짐 스위치는 `role="switch"` + `aria-checked` — 색만으로 상태를 말하지 않게 옆에 '켜짐/꺼짐' 글자를 둔다.
 */
export function LicenseSection({
  tenantId,
  licenses,
  enrolledCount,
}: {
  tenantId: string;
  licenses: TenantLicenseRow[];
  /** 지금 재원생 수 — 좌석 게이트(`seatBlockReason`)와 같은 기준(status = enrolled). `used_seats` 칸은 아무도 안 채워 늘 0이라 안 쓴다. */
  enrolledCount: number;
}) {
  const byFeature = new Map(licenses.map((l) => [l.feature, l]));

  return (
    <Panel title="라이선스" description="좌석 수와 기능 사용 여부를 정합니다." flush>
      <ul className="divide-line divide-y">
        {SEAT_FEATURES.map((f) => (
          <SeatRow
            key={f.key}
            tenantId={tenantId}
            feature={f.key}
            label={f.label}
            license={byFeature.get(f.key)}
            enrolledCount={enrolledCount}
          />
        ))}
        {TOGGLE_FEATURES.map((f) =>
          // 화면 방식은 켜기·끄기가 아니라 셋 중 하나 — 창 모드 행(window_mode)과 이전 화면 유지 행(window_keepalive)을 한 줄로 합쳐 고른다.
          f.key === "window_mode" ? (
            <WindowModeRow
              key={f.key}
              tenantId={tenantId}
              windowModeRow={byFeature.get("window_mode")}
              keepaliveRow={byFeature.get(WINDOW_KEEPALIVE_KEY)}
            />
          ) : (
            <ToggleRow
              key={f.key}
              tenantId={tenantId}
              feature={f.key}
              label={f.label}
              license={byFeature.get(f.key)}
              defaultOn={f.defaultOn}
            />
          ),
        )}
      </ul>
    </Panel>
  );
}

type RowProps = { tenantId: string; feature: string; label: string; license?: TenantLicenseRow };

function SeatRow({ tenantId, feature, label, license, enrolledCount }: RowProps & { enrolledCount: number }) {
  const [state, action, pending] = useActionState(upsertTenantLicense, undefined);
  // 한도 판정 = 게이트와 같은 함수(`seatLimitOf` — 행 없음·끔·비어 있음 = 제한 없음).
  const limit = seatLimitOf(license ? { is_active: license.isActive, max_seats: license.maxSeats } : null);
  const usage = `재원 ${fmtNum(enrolledCount)}명 / ${limit === null ? "제한 없음" : `최대 ${fmtNum(limit)}석`}`;
  const full = limit !== null && enrolledCount >= limit;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-bold">{label}</p>
        <p className={`num text-xs ${full ? "text-danger font-bold" : "text-foreground"}`}>
          {usage}
          {full ? " — 가득 참(새 재원 등록이 막힙니다)" : ""}
        </p>
      </div>
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="feature" value={feature} />
        <Input
          type="number"
          name="maxSeats"
          min={0}
          defaultValue={license?.maxSeats ?? ""}
          placeholder="비우면 제한 없음"
          aria-label={`${label} 최대 좌석`}
          className="num h-(--control-h) w-36 text-right"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </form>
      {state?.error ? <p className="text-danger w-full text-right text-xs font-medium">{state.error}</p> : null}
    </li>
  );
}

function ToggleRow({ tenantId, feature, label, license, defaultOn }: RowProps & { defaultOn: boolean }) {
  const [state, action, pending] = useActionState(toggleTenantLicense, undefined);
  // 스위치는 **실제 동작**을 그린다 — 행이 없으면 기능별 기본값, 있으면 게이트와 같은 판정(끔·만료 = 꺼짐).
  const isOn = license ? licenseAllows({ is_active: license.isActive, expires_at: license.expiresAt }) : defaultOn;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
      <span className="text-foreground text-sm font-bold">{label}</span>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="feature" value={feature} />
        <input type="hidden" name="nextActive" value={(!isOn).toString()} />
        <span className={`text-sm font-medium ${isOn ? "text-green" : "text-foreground"}`}>
          {isOn ? "켜짐" : "꺼짐"}
          {license ? "" : " (기본값)"}
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={isOn}
          disabled={pending}
          aria-label={`${label} ${isOn ? "끄기" : "켜기"}`}
          className={`inline-flex h-6 w-11 cursor-pointer items-center rounded-full px-0.5 transition disabled:opacity-60 ${
            isOn ? "bg-green justify-end" : "bg-muted border-line justify-start border"
          }`}
        >
          <span className="bg-card size-5 rounded-full shadow-sm" />
        </button>
      </form>
      {state?.error ? <p className="text-danger w-full text-right text-xs font-medium">{state.error}</p> : null}
    </li>
  );
}
