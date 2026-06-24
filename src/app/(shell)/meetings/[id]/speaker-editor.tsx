"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  updateMeetingSpeakers,
  type UpdateMeetingSpeakersState,
} from "@/features/meetings/server/actions";
import type { StaffOption } from "@/features/meetings/server/queries";
import type { TranscriptUtterance } from "@/components/transcript-section";

const FREE = "__free__"; // 자유입력 옵션 sentinel

/**
 * 회의 전사 화자(A/B/C) → 직원 매핑 수동 편집. AssemblyAI/AI가 부정확할 때 실제 화자를 교정한다.
 * 직원 드롭다운(SearchableSelect) 선택 시 라벨=직원명·staffId 저장(미래 업무연계 기반). "직접 입력"은 자유 라벨.
 */
export function SpeakerEditor({
  meetingId,
  utterances,
  speakerRoles,
  speakerStaff,
  staffOptions,
}: {
  meetingId: string;
  utterances: TranscriptUtterance[];
  speakerRoles: Record<string, string> | null;
  speakerStaff: Record<string, string> | null;
  staffOptions: StaffOption[];
}) {
  // 전사에 등장하는 화자 키(A,B,…) 순서 유지 distinct.
  const speakers = useMemo(() => {
    const seen: string[] = [];
    for (const u of utterances) if (!seen.includes(u.speaker)) seen.push(u.speaker);
    return seen;
  }, [utterances]);

  const staffById = useMemo(() => new Map(staffOptions.map((s) => [s.id, s])), [staffOptions]);
  const options = useMemo(
    () => [
      { value: FREE, label: "직접 입력 / 직원 아님" },
      ...staffOptions.map((s) => ({
        value: s.id,
        label: s.name,
        hint: s.jobTitle ?? undefined,
      })),
    ],
    [staffOptions],
  );

  const [editing, setEditing] = useState(false);
  // speaker → { staffId, label }. 초기값: speaker_staff(직원연결) 우선, 없으면 ai_speaker_roles 라벨.
  const [rows, setRows] = useState<Record<string, { staffId: string; label: string }>>({});
  const [state, action] = useActionState<UpdateMeetingSpeakersState, FormData>(
    updateMeetingSpeakers,
    undefined,
  );
  const handled = useRef(false);

  function openEditor() {
    const init: Record<string, { staffId: string; label: string }> = {};
    for (const sp of speakers) {
      const staffId = speakerStaff?.[sp] ?? "";
      init[sp] = { staffId, label: staffId ? "" : (speakerRoles?.[sp] ?? "") };
    }
    setRows(init);
    handled.current = false;
    setEditing(true);
  }

  useEffect(() => {
    if (state?.ok && !handled.current) {
      handled.current = true;
      setEditing(false);
    }
  }, [state]);

  if (speakers.length === 0) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
      >
        <Users className="size-3.5" />
        화자 지정 ({speakers.length}명)
        <Pencil className="size-3" />
      </button>
    );
  }

  // 저장 payload: { A: { label, staffId }, ... }. 직원 선택 시 label=직원명, staffId 채움. 자유입력은 label만.
  const mapping: Record<string, { label: string; staffId: string | null }> = {};
  for (const sp of speakers) {
    const r = rows[sp];
    if (r?.staffId && r.staffId !== FREE) {
      mapping[sp] = { label: staffById.get(r.staffId)?.name ?? "", staffId: r.staffId };
    } else {
      mapping[sp] = { label: (r?.label ?? "").trim(), staffId: null };
    }
  }

  return (
    <form action={action} className="border-line bg-card space-y-3 rounded-md border p-4">
      <input type="hidden" name="id" value={meetingId} />
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
      <div className="flex items-center justify-between">
        <h3 className="text-foreground flex items-center gap-1.5 text-[13px] font-semibold">
          <Users className="size-3.5" />화자 지정
        </h3>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-text-faint hover:text-foreground rounded-sm p-1 transition"
          aria-label="취소"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-text-faint text-[11px]">
        각 화자를 직원으로 지정하면 회의 업무 연계의 기반이 됩니다. 직원이 아니면 “직접 입력”으로 이름을 적으세요.
      </p>

      <div className="space-y-2">
        {speakers.map((sp) => {
          const r = rows[sp] ?? { staffId: "", label: "" };
          const usingStaff = !!r.staffId && r.staffId !== FREE;
          return (
            <div key={sp} className="flex flex-wrap items-center gap-2">
              <span className="text-primary w-12 shrink-0 text-[13px] font-semibold">화자 {sp}</span>
              <div className="min-w-[180px] flex-1">
                <SearchableSelect
                  options={options}
                  value={r.staffId || FREE}
                  onValueChange={(v) =>
                    setRows((prev) => ({
                      ...prev,
                      [sp]: { staffId: v === FREE ? "" : v, label: v === FREE ? (prev[sp]?.label ?? "") : "" },
                    }))
                  }
                  placeholder="직원 선택"
                  ariaLabel={`화자 ${sp} 직원 지정`}
                />
              </div>
              {!usingStaff ? (
                <input
                  value={r.label}
                  onChange={(e) =>
                    setRows((prev) => ({ ...prev, [sp]: { staffId: "", label: e.target.value } }))
                  }
                  placeholder="이름/역할 직접 입력"
                  className="border-border bg-background text-foreground min-w-[140px] flex-1 rounded-md border px-2 py-1 text-[13px]"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <SaveBtn />
        {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
      </div>
    </form>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      저장
    </Button>
  );
}
