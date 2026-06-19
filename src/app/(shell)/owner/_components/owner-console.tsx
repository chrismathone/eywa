"use client";

import { useState } from "react";
import type { TenantSettings } from "@/features/owner/settings-types";
import { ProfileSection } from "./profile-section";
import { OperationsSection } from "./operations-section";
import { BillingSection } from "./billing-section";
import { NotificationsSection } from "./notifications-section";

const TABS = [
  { key: "profile", label: "프로필·브랜드" },
  { key: "operations", label: "운영 체계" },
  { key: "billing", label: "수납·청구" },
  { key: "notifications", label: "알림·연동·약관" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function OwnerConsole({ settings }: { settings: TenantSettings }) {
  const [tab, setTab] = useState<TabKey>("profile");

  return (
    // 마스터-디테일: 좁은 창은 세로 스택(상단 가로탭 + 본문), 넓은 창(lg+)은 좌측 세로탭 + 우측 본문이
    // 가로폭을 채운다. 고정 좁은 max-w 중앙정렬로 좌우 여백을 낭비하지 않는다(디자인 시스템 § 반응형 폭 규약).
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <nav className="border-border flex flex-wrap gap-1 border-b pb-2 lg:flex-col lg:gap-0.5 lg:border-b-0 lg:pb-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-2 text-left text-[13px] font-semibold transition ${
              tab === t.key
                ? "bg-primary/10 text-primary"
                : "text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-5 min-w-0 lg:mt-0">
        {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
        {tab === "operations" ? <OperationsSection initial={settings.operations} /> : null}
        {tab === "billing" ? <BillingSection initial={settings.billing} /> : null}
        {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      </div>
    </div>
  );
}
