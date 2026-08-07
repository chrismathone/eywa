"use client";

/**
 * **오늘 ECS — 학생 기록(태도·특이사항)** 팝오버(2026-08-07).
 *
 * 주간 시트는 교시(slot)마다 학생 표를 그려 태도·특이사항을 받는다. 오늘 화면은 "반 하나 = 학생 한 줄"이라
 * 그 축이 없다 — 그래서 **교시별 칸을 팝오버 안에** 넣는다.
 *
 * 🔴 **한 칸으로 뭉개지 않는다**: 영어 반은 하루 2~3교시가 흔하고(실측), 기록은 교시마다 따로 있다.
 *    아무 교시에나 저장하면 주간 시트에서 다른 줄에 뜨거나 남의 교시 기록을 덮는다.
 * 🔴 저장은 주간 시트와 **같은 액션**(`upsertStudentMark`) — 표만 다르고 데이터·게이트는 한 벌이다.
 *    (수강 자격·편집 권한 검증은 서버가 한다. 화면은 실패하면 되돌리고 이유를 말한다.)
 */
import { useState } from "react";
import { toast } from "sonner";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";
import { FieldSelect } from "@/features/onescreen/components/field-select";
import { ATTITUDE } from "@/features/onescreen/attitude";
import { upsertStudentMark } from "../server/actions";

export type StudentMark = { status: string | null; progressNote: string | null };
export type MarkMap = Record<string, StudentMark>;

/** 교시 한 줄 — 태도(드롭다운) + 특이사항(입력). 특이사항은 **blur에 저장**(타이핑마다 왕복하지 않는다). */
function SlotRow({
  slotStart,
  label,
  studentName,
  mark,
  canEdit,
  onSave,
}: {
  slotStart: string;
  label: string;
  studentName: string;
  mark: StudentMark | undefined;
  canEdit: boolean;
  onSave: (slotStart: string, next: StudentMark) => void;
}) {
  const status = mark?.status ?? null;
  const saved = mark?.progressNote ?? "";
  // 🔴 특이사항은 **제어 상태**여야 한다(적대적 리뷰 2026-08-07): 비제어 input이면 ① 타이핑 뒤 blur 전에
  //    태도를 고를 때 저장 payload가 **옛 텍스트**로 나가 방금 친 글이 날아가고 ② 저장 실패로 롤백해도
  //    화면 값은 잘못된 채 남는다. 서버 값이 바뀌면(다른 창에서 고침) 그때 따라간다.
  const [note, setNote] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setNote(saved);
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-text-faint text-[11px] font-bold">{label}</p>
      {canEdit ? (
        <>
          <FieldSelect
            options={ATTITUDE}
            value={status}
            ariaLabel={`${studentName} ${label} 태도`}
            // 아직 저장 안 된 텍스트(note)를 함께 싣는다 — 태도 저장이 그 글을 지우지 않게.
            onSelect={(v) => onSave(slotStart, { status: v, progressNote: note.trim() || null })}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`${studentName} ${label} 특이사항`}
            placeholder="특이사항 (예: PL 7, 20개 / PV 4)"
            className="border-line bg-card focus:border-primary h-8 w-full min-w-0 rounded-lg border px-2 text-[12px] outline-none transition-colors"
            // 저장은 blur에서 한 번(타이핑마다 왕복하지 않는다) — 팝오버를 닫아도 blur가 먼저 난다.
            onBlur={() => {
              if (note.trim() === saved.trim()) return; // 손대지 않았으면 왕복하지 않는다
              onSave(slotStart, { status, progressNote: note.trim() || null });
            }}
          />
        </>
      ) : (
        // 읽기 전용이어도 **값은 보여준다** — 숨기면 "썼는데 사라졌다"가 된다(주간 시트와 같은 규약).
        <p className="text-text-dim text-[12px] whitespace-pre-line">
          {[status, saved].filter(Boolean).join(" · ") || "—"}
        </p>
      )}
    </div>
  );
}

export function TodayMarkPopover({
  classId,
  date,
  studentId,
  studentName,
  slots,
  marks,
  canEdit,
  onChange,
}: {
  classId: string;
  date: string;
  studentId: string;
  studentName: string;
  /** 그 반의 그날 교시들(시각·라벨) — 화면에 보이는 순서 그대로. */
  slots: { slotStart: string; label: string }[];
  marks: MarkMap;
  canEdit: boolean;
  /** 낙관 갱신·롤백 — 부모(보드)가 상태를 들고 있다. null = 그 칸을 비움. */
  onChange: (slotStart: string, next: StudentMark | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const filled = slots.filter((s) => marks[s.slotStart]?.status || marks[s.slotStart]?.progressNote).length;

  function save(slotStart: string, next: StudentMark) {
    const prev = marks[slotStart];
    onChange(slotStart, next);
    void upsertStudentMark({
      classId,
      studentId,
      markDate: date,
      slotStart,
      status: next.status,
      progressNote: next.progressNote,
    }).then((r) => {
      if (!r.ok) {
        onChange(slotStart, prev ?? null); // 되돌린다 — 화면엔 남고 서버엔 없는 상태 방지
        toast.error(r.error);
      }
    });
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`shrink-0 cursor-pointer rounded-full p-1 transition ${
          filled > 0 ? "text-primary" : "text-text-faint hover:text-foreground"
        }`}
        title={
          filled > 0
            ? `${studentName} 태도·특이사항 ${filled}건 — 열어서 고치기`
            : `${studentName} 태도·특이사항 입력`
        }
        aria-label={`${studentName} 태도·특이사항`}
      >
        <EyIcon name="note" size={13} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-64 rounded-lg border p-3 outline-none">
            <p className="text-foreground mb-2 text-[13px] font-bold">{studentName}</p>
            <div className="flex flex-col gap-2.5">
              {slots.map((s) => (
                <SlotRow
                  key={s.slotStart}
                  slotStart={s.slotStart}
                  label={s.label}
                  studentName={studentName}
                  mark={marks[s.slotStart]}
                  canEdit={canEdit}
                  onSave={save}
                />
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
