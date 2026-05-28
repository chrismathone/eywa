"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ExternalLink, Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  connectGoogleSheets,
  disconnectSheets,
  syncSheetsNow,
  type ConnectState,
  type DisconnectState,
  type SyncState,
} from "@/features/integrations/server/actions";
import type { IntegrationStatus } from "@/features/integrations/server/queries";

function ConnectBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
      시트 생성 & 연결
    </Button>
  );
}

function SyncBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      지금 동기화
    </Button>
  );
}

function DisconnectBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      연결 해제
    </Button>
  );
}

export function SheetsClient({ status }: { status: IntegrationStatus }) {
  const [connectState, connectAction] = useActionState<ConnectState, FormData>(
    connectGoogleSheets,
    undefined,
  );
  const [syncState, syncAction] = useActionState<SyncState, FormData>(syncSheetsNow, undefined);
  const [, disconnectAction] = useActionState<DisconnectState, FormData>(
    disconnectSheets,
    undefined,
  );

  if (!status.connected) {
    return (
      <section className="bg-card border-border rounded-md border p-6">
        <h2 className="text-foreground text-base font-semibold">Google Sheets 연결</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          eywa의 service account가 새 시트를 생성하고, 입력한 이메일에 writer 권한을 부여합니다.
        </p>
        <form action={connectAction} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">
              공유 받을 Google 이메일
            </label>
            <input
              name="email"
              type="email"
              required
              placeholder="chrismathone@gmail.com"
              className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <ConnectBtn />
        </form>
        {connectState?.error ? (
          <p className="text-chart-4 mt-2 text-sm">{connectState.error}</p>
        ) : null}
        <div className="text-muted-foreground mt-4 text-[11px] space-y-1 border-t pt-3">
          <p>
            <strong>필요 환경변수:</strong> GOOGLE_SERVICE_ACCOUNT_KEY (JSON 키 또는 base64)
          </p>
          <p>scope: drive, spreadsheets</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-6">
      <div className="inline-flex items-center gap-2">
        <CheckCircle2 className="text-chart-2 size-4" />
        <h2 className="text-foreground text-base font-semibold">연결됨</h2>
      </div>

      <dl className="space-y-2 text-sm">
        <Row label="공유 이메일" value={status.sharedWithEmail ?? "—"} />
        <Row
          label="시트 URL"
          value={
            status.spreadsheetUrl ? (
              <a
                href={status.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-chart-1 inline-flex items-center gap-1 hover:underline"
              >
                Google Sheets 열기
                <ExternalLink className="size-3" />
              </a>
            ) : (
              "—"
            )
          }
        />
        <Row
          label="마지막 동기화"
          value={
            status.lastSyncedAt
              ? new Date(status.lastSyncedAt).toLocaleString("ko-KR")
              : "아직 없음"
          }
        />
        {status.lastError ? <Row label="마지막 오류" value={<span className="text-chart-4">{status.lastError}</span>} /> : null}
      </dl>

      <div className="flex items-center gap-2 border-t pt-4">
        <form action={syncAction}>
          <SyncBtn />
        </form>
        <form action={disconnectAction}>
          <DisconnectBtn />
        </form>
      </div>

      {syncState?.error ? (
        <p className="text-chart-4 text-sm">{syncState.error}</p>
      ) : null}
      {syncState?.ok ? (
        <p className="text-chart-2 text-sm">동기화 완료</p>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  );
}
