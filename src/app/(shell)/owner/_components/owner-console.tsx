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
    <div className="space-y-5">
      <nav className="border-border flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition ${
              tab === t.key
                ? "border-primary text-primary"
                : "text-text-dim hover:text-foreground border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {tab === "operations" ? <OperationsSection initial={settings.operations} /> : null}
      {tab === "billing" ? <BillingSection initial={settings.billing} /> : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
    </div>
  );
}
