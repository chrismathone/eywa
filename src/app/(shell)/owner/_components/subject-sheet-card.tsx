"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2 } from "@/components/icons/aywa-icon-compat";
import {
  setSheetsExportEnabled,
  setSubjectSheetTarget,
} from "@/features/integrations/server/actions";
import type { IntegrationStatus } from "@/features/integrations/server/queries";
import { writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 과목별 구글 시트 내보내기 카드 — 토글(ON/OFF) + 대상 시트 ID 등록 + 상태(동기화/오류) + 열기.
 * 수학·영어를 **서로 다른 전용 시트**로 분리(전체 덮어쓰기라 한 시트 공유 불가).
 */
export function SubjectSheetCard({
  subject,
  label,
  status,
  canEdit = true,
}: {
  subject: string;
  label: string;
  status: IntegrationStatus;
  /** 연동 설정 쓰기(토글·시트 ID 저장 액션과 같은 판정) — 없으면 스위치·칸을 잠그고 저장 단추를 그리지 않는다. */
  canEdit?: boolean;
}) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [sheetId, setSheetId] = useState(status.spreadsheetId ?? "");
  const [savedId, setSavedId] = useState(status.spreadsheetId ?? "");
  const [toggling, startToggle] = useTransition();
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    if (toggling) return;
    const next = !enabled;
    setErr(null);
    startToggle(async () => {
      const res = await setSheetsExportEnabled(subject, next);
      if (res?.error) setErr(res.error);
      else setEnabled(next);
    });
  }

  function save() {
    if (saving) return;
    setErr(null);
    setMsg(null);
    startSave(async () => {
      const res = await setSubjectSheetTarget(subject, sheetId);
      if (res?.error) setErr(res.error);
      else {
        setSavedId(sheetId.trim());
        setMsg("저장됨");
      }
    });
  }

  const openUrl = savedId ? `https://docs.google.com/spreadsheets/d/${savedId}/edit` : null;
  const dirty = sheetId.trim() !== savedId;

  return (
    <section className="border-border bg-card space-y-3 rounded-2xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground text-sm font-bold">{label} 시간표</h3>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${label} 시트 내보내기 연동`}
          onClick={toggle}
          disabled={toggling || !canEdit}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            enabled ? "bg-primary" : "bg-line-strong"
          }`}
        >
          <span
            className={`flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          >
            {toggling ? <Loader2 className="text-text-dim size-3 animate-spin" /> : null}
          </span>
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-text-dim block text-xs font-medium">Google Sheets ID</label>
        <div className="flex items-center gap-2">
          <input
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            placeholder={canEdit ? "시트 URL의 /d/ 뒤 문자열" : writeLockedPlaceholder("integration_settings")}
            disabled={!canEdit}
            spellCheck={false}
            className="border-line bg-bg-soft focus:border-primary min-w-0 flex-1 rounded-md border px-2.5 py-1.5 font-mono text-xs outline-none"
          />
          {canEdit ? (
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              저장
            </button>
          ) : null}
        </div>
      </div>

      <div className="text-text-faint flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            <ExternalLink className="size-3" />
            시트 열기
          </a>
        ) : (
          <span>대상 시트를 등록하면 &apos;시트로 보내기&apos; 버튼이 시간표에 나타납니다.</span>
        )}
        {status.lastSyncedAt ? (
          <span>마지막 동기화 {new Date(status.lastSyncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
        ) : null}
        {msg ? <span className="text-primary">{msg}</span> : null}
      </div>

      {/* 자동 반영 안내 — 연동 ON + 수동 반영 이력이 있으면 새벽 4시 cron이 자동 push(사람 편집 감지 시 건너뜀).
          ⚠️ 재개 조건: '가져오기'(읽기)만으론 시트 최종수정자가 사람이라 계속 건너뜀 → '시트로 보내기'(쓰기)까지 해야 재개. */}
      <p className="text-text-faint text-xs">
        연동이 켜져 있으면 매일 새벽 4시에 자동 반영됩니다. 시트에 직접 편집한 내용이 있으면 그날 자동 반영은
        건너뛰어 편집을 보호합니다. 편집분을 앱에 반영한 뒤(‘시트에서 가져오기’) ‘시트로 보내기’까지 하면 다음
        새벽부터 자동 반영이 재개됩니다.
      </p>

      {err ? (
        <p className="text-danger text-xs">{err}</p>
      ) : status.lastError ? (
        <p className="text-chart-4 text-xs">마지막 오류: {status.lastError}</p>
      ) : null}
    </section>
  );
}
