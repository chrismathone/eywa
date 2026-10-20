"use client";
import { agentPolicy, type AgentPolicy } from "../policy";

export function AgentPolicyFields({ value, onChange }: { value: unknown; onChange: (v: AgentPolicy) => void }) {
  const policy = agentPolicy(value);
  return <div className="space-y-4">
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-bold">상담 후속조치 관리</legend>
      {([
        ["off", "사용 안 함"], ["observe", "관찰 — 감지·처리 기록, 추가 알림 없음"],
        ["active", "사용 — 담당자와 관리자에게 처리·결과 알림"],
      ] as const).map(([mode,label]) => <label key={mode} className="flex items-center gap-2 text-sm">
        <input type="radio" name="management-agent-mode" checked={policy.mode === mode} onChange={() => onChange({ ...policy, mode })} />{label}
      </label>)}
    </fieldset>
    <label className="flex flex-wrap items-center gap-2 text-sm">미접수 확인 기준
      <input type="number" min={1} max={14} value={policy.acknowledgeDays} className="border-line w-20 rounded-lg border p-2" onChange={(e) => onChange({ ...policy, acknowledgeDays: Number(e.target.value) })} />일
    </label>
    <label className="flex flex-wrap items-center gap-2 text-sm">지연 건 재알림 간격
      <input type="number" min={1} max={30} value={policy.reminderDays} className="border-line w-20 rounded-lg border p-2" onChange={(e) => onChange({ ...policy, reminderDays: Number(e.target.value) })} />일
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={policy.notionAlerts} onChange={(e) => onChange({ ...policy, notionAlerts: e.target.checked })} />노션에도 알림 요약 전달
    </label>
    <p className="text-text-dim text-xs">처리와 결과 확인은 에이와에서 합니다. 슬랙은 기존 연동의 ‘상담 후속조치 처리·결과’ 알림 규칙을 사용합니다. 노션은 알림 전용 연결 설정이 필요합니다.</p>
  </div>;
}
