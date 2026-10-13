"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "@/components/icons/aywa-icon-compat";
import { clearRecovery, listRecovery, recordingScopeKey, recoverRecording, type RecordingMeta, type RecordingScope, type RecoveryKind } from "@/lib/recording-recovery";

/** Suggest only backups for the account and record currently being edited. */
export function RecordingRecoveryNotice({ kind, scope, selectedId, disabled, onRestore }: {
  kind: RecoveryKind;
  scope: RecordingScope | null;
  selectedId?: string | null;
  disabled?: boolean;
  onRestore: (file: File, meta: RecordingMeta) => void;
}) {
  const key = scope ? `${kind}:${recordingScopeKey(scope)}` : "";
  const [loaded, setLoaded] = useState<{ key: string; records: RecordingMeta[] }>({ key: "", records: [] });
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveKey = useRef(key);
  useEffect(() => {
    liveKey.current = key;
    return () => { liveKey.current = ""; };
  }, [key]);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // The key contains exactly the scope fields used for filtering, without display labels.
    const serialized = key.slice(kind.length + 1);
    const [tenantId, userId, recordKey] = JSON.parse(serialized) as string[];
    void listRecovery(kind, { tenantId, userId, recordKey, label: "" }).then((records) => {
      if (!cancelled) setLoaded({ key, records });
    });
    return () => { cancelled = true; };
  }, [key, kind, revision, selectedId]);

  // A -> B hides A immediately, including while B's asynchronous lookup is still running.
  const records = loaded.key === key ? loaded.records.filter((r) => r.id !== selectedId) : [];
  if (records.length === 0) return null;

  async function restore(meta: RecordingMeta) {
    setWorking(true);
    setError(null);
    try {
      const file = await recoverRecording(meta.id);
      if (liveKey.current !== key) return;
      if (file) onRestore(file, meta);
      else setError("녹음을 불러오지 못했습니다. PC에 저장된 백업 파일을 선택해 주세요.");
    } finally { setWorking(false); }
  }
  async function discard(id: string) {
    setWorking(true);
    try {
      await clearRecovery(id);
      setRevision((n) => n + 1);
    } finally { setWorking(false); }
  }

  return (
    <div className="border-chart-3/40 bg-chart-3/5 flex items-start gap-3 rounded-md border px-4 py-3">
      <History className="text-chart-3 mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-foreground text-sm font-medium">{scope?.label} · 아직 저장하지 않은 녹음이 있습니다</p>
        {records.map((meta) => (
          <div key={meta.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{new Date(meta.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
            <button type="button" onClick={() => void restore(meta)} disabled={disabled || working} className="text-foreground hover:text-chart-3 font-medium disabled:opacity-40">복구하기</button>
            <button type="button" onClick={() => void discard(meta.id)} disabled={disabled || working} className="text-muted-foreground hover:text-foreground disabled:opacity-40">녹음 지우기</button>
          </div>
        ))}
        {error ? <p className="text-danger text-xs">{error}</p> : null}
      </div>
    </div>
  );
}
