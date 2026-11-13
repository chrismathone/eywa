"use client";

import { EyIcon, MENU_ICON } from "@/components/icons/aywa-icons";
import type { ConnectedApp } from "@/features/connected-apps/apps";

export function MobileConnectedApps({ apps, onNavigate }: { apps: readonly ConnectedApp[]; onNavigate: () => void }) {
  if (!apps.length) return null;
  return <section aria-label="연결 앱" className="border-line border-t pt-3">
    <h2 className="text-text-dim mb-1 text-xs font-bold">연결 앱</h2>
    <ul className="grid gap-1">
      {apps.map(app => <li key={app.feature}>
        <a href={app.launchPath} target="_blank" rel="noopener noreferrer" onClick={onNavigate}
          className="hover:bg-bg-soft flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium">
          <EyIcon name={MENU_ICON[app.permission]} size={18} strokeWidth={1.8} className="shrink-0" />
          <span className="min-w-0 break-words">{app.label}</span>
          <EyIcon name="externalLink" size={12} strokeWidth={1.8} className="ml-auto shrink-0 opacity-70" />
        </a>
      </li>)}
    </ul>
  </section>;
}
