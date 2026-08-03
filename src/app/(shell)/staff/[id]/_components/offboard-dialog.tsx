"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ExternalLink, Loader2, TriangleAlert } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { handoverAndDeactivate, type OffboardState } from "@/features/staff/server/actions";
import type { AssistClassRow, HomeroomClassRow } from "@/features/staff/server/queries";
import { Modal } from "./dialog-bits";

export type HandoverTeacher = { id: string; name: string; subjects: string[] };

/**
 * 퇴사 다이얼로그 — 담임인 진행중 반이 있을 때만 뜬다.
 *
 * 예전엔 경고만 하고 "각 반 상세에서 하나씩 인수인계하세요"라고 떠넘겼다(원장 지적 2026-08-03:
 * "일일이 모두 옮기고 퇴사처리하면 효율이 떨어진다"). 이제 **여기서 한 번에** 넘긴다 — 강사 한 명을
 * 고르고 넘길 반을 체크하면 담임과 오늘 이후 교시 배치가 함께 옮겨간 뒤 퇴사 처리된다.
 *
 * ⚠️ 과목으로 후보를 **하드 필터하지 않는다** — 같은 과목 강사를 위로 정렬하고 힌트만 붙인다.
 *    (subjects[] 미기재 강사가 실제로 있어 필터로 좁히면 그 사람에겐 인계 자체가 불가능해진다.)
 * ⚠️ 성공해도 자동으로 닫지 않고 결과 화면으로 바꾼다 — 몇 개 반이 실제로 옮겨졌는지 보여주고,
 *    "성공 상태로 재오픈 → 즉시 닫힘"(#67) 함정도 피한다.
 */
export function OffboardDialog({
  staffId,
  displayName,
  classes,
  assistClasses,
  teacherOptions,
  onClose,
}: {
  staffId: string;
  displayName: string;
  classes: HomeroomClassRow[];
  /** 담임은 아니지만 교시로 들어가는 진행중 반 — 인계 안 하면 시간표에 퇴직자가 남는다. */
  assistClasses: AssistClassRow[];
  teacherOptions: HandoverTeacher[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<OffboardState, FormData>(handoverAndDeactivate, undefined);
  const subjects = useSubjectMaps();
  const [newTeacherId, setNewTeacherId] = useState("");
  // 기본 = 전부 선택("전부 넘기기"가 이 화면의 목적). 체크를 풀어 일부만 남길 수 있다.
  const [picked, setPicked] = useState<string[]>(() => classes.map((c) => c.id));
  const [pickedAssist, setPickedAssist] = useState<string[]>(() => assistClasses.map((c) => c.id));

  // 이 강사가 맡던 과목 = 후보 정렬 기준. 담임은 보통 한 과목이지만 여러 과목이어도 전부 본다.
  const ownSubjects = useMemo(
    () => [...new Set([...classes, ...assistClasses].map((c) => c.subject))],
    [classes, assistClasses],
  );
  const options = useMemo(
    () =>
      teacherOptions
        .filter((t) => t.id !== staffId)
        .map((t) => {
          const match = t.subjects.some((s) => ownSubjects.includes(s));
          return {
            value: t.id,
            label: t.name,
            match,
            hint: t.subjects.length
              ? t.subjects.map((s) => subjects.labelOf(s)).join("·")
              : "과목 미지정",
          };
        })
        .sort((a, b) => Number(b.match) - Number(a.match)),
    [teacherOptions, staffId, ownSubjects, subjects],
  );

  if (state?.ok) {
    return (
      <Modal title="퇴사 처리 완료" desc={displayName} width="md" onClose={onClose}>
        <div className="space-y-3">
          <p className="text-primary inline-flex items-start gap-1.5 text-sm font-medium">
            <Check className="mt-0.5 size-4 shrink-0" />
            {state.movedClasses || state.movedSlots
              ? `${state.movedClasses ? `반 ${state.movedClasses}개를 ` : "교시 담당을 "}${state.newTeacherName ?? "새 강사"} 강사에게 인계하고 퇴사 처리했습니다.`
              : "퇴사 처리했습니다."}
          </p>
          {state.movedSlots ? (
            <p className="text-text-dim text-xs">
              시간표 교시 {state.movedSlots}개의 담당 강사도 함께 옮겼습니다(지난 교시는 기록이라
              그대로 둡니다).
            </p>
          ) : null}
          {state.homeroomCount ? (
            <p className="text-amber text-xs">
              아직 이 강사가 담임인 진행중 반이 {state.homeroomCount}개 남아 있습니다 —
              수업목록에서 확인해 주세요.
            </p>
          ) : null}
          <footer className="flex justify-end pt-1">
            <Button type="button" size="sm" onClick={onClose}>
              닫기
            </Button>
          </footer>
        </div>
      </Modal>
    );
  }

  const selectedTeacher = teacherOptions.find((t) => t.id === newTeacherId) ?? null;
  // 과목이 안 맞아도 막지 않는다 — 확인만 시킨다(설정 밖 과목·미기재 강사가 실제로 있다).
  const mismatched = selectedTeacher
    ? [
        ...new Set(
          [
            ...classes.filter((c) => picked.includes(c.id)),
            ...assistClasses.filter((c) => pickedAssist.includes(c.id)),
          ]
            .filter((c) => !selectedTeacher.subjects.includes(c.subject))
            .map((c) => c.subject),
        ),
      ]
    : [];
  const allPicked = picked.length === classes.length;
  const totalPicked = picked.length + pickedAssist.length;

  return (
    <Modal title="퇴사 처리" desc={displayName} width="md" onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={staffId} />

        <p className="text-amber inline-flex items-start gap-1.5 text-sm font-medium">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {[
            classes.length ? `담임인 진행중 반 ${classes.length}개` : null,
            assistClasses.length ? `교시로 들어가는 반 ${assistClasses.length}개` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          가 남아 있습니다.
        </p>
        <p className="text-text-dim text-xs">
          인계하지 않고 퇴사 처리하면 배정이 그대로 남아 시간표·출석부에 ‘(퇴직)’ 강사로 계속
          표시됩니다. 넘겨받을 강사를 고르면 담임과{" "}
          <span className="text-foreground font-medium">오늘 이후 교시 배치</span>가 함께 옮겨집니다
          (지난 교시는 기록이라 그대로 둡니다).
        </p>

        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">넘겨받을 강사</span>
          <SearchableSelect
            name="newTeacherId"
            options={options}
            value={newTeacherId}
            onValueChange={setNewTeacherId}
            placeholder="강사 선택"
            searchPlaceholder="이름으로 검색..."
            ariaLabel="넘겨받을 강사"
          />
          <p className="text-text-faint text-xs">같은 과목 강사가 위에 표시됩니다.</p>
        </div>

        {classes.length > 0 ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-foreground text-sm font-medium">
                넘길 담임 반 <span className="num text-primary">{picked.length}</span>
                <span className="num">/{classes.length}</span>
              </span>
              <button
                type="button"
                onClick={() => setPicked(allPicked ? [] : classes.map((c) => c.id))}
                className="text-primary cursor-pointer text-xs hover:underline"
              >
                {allPicked ? "전체 해제" : "전체 선택"}
              </button>
            </div>
            <ul className="border-line divide-line max-h-40 divide-y overflow-y-auto rounded-md border">
              {classes.map((c) => (
                <li key={c.id}>
                  <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="classIds"
                      value={c.id}
                      checked={picked.includes(c.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id),
                        )
                      }
                      className="accent-primary size-3.5 shrink-0"
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {c.className}
                    </span>
                    <span className="text-text-faint shrink-0 text-[11px]">
                      {subjects.labelOf(c.subject)}
                    </span>
                    {c.pendingTeacherName ? (
                      <span className="text-primary shrink-0 text-[11px]">
                        예약됨 → {c.pendingTeacherName}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 담임은 남의 것이라 그대로 두고 **교시 담당만** 넘긴다 — 안 넘기면 시간표에 퇴직자가 남는다. */}
        {assistClasses.length > 0 ? (
          <div>
            <span className="text-foreground mb-1 block text-sm font-medium">
              교시로 들어가는 다른 반{" "}
              <span className="num text-primary">{pickedAssist.length}</span>
              <span className="num">/{assistClasses.length}</span>
              <span className="text-text-faint ml-1 text-xs font-normal">담임은 그대로 둡니다</span>
            </span>
            <ul className="border-line divide-line max-h-32 divide-y overflow-y-auto rounded-md border">
              {assistClasses.map((c) => (
                <li key={c.id}>
                  <label className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="assistClassIds"
                      value={c.id}
                      checked={pickedAssist.includes(c.id)}
                      onChange={(e) =>
                        setPickedAssist((p) =>
                          e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id),
                        )
                      }
                      className="accent-primary size-3.5 shrink-0"
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {c.className}
                    </span>
                    <span className="text-text-faint shrink-0 text-[11px]">
                      {subjects.labelOf(c.subject)} · 교시 {c.slotCount}개
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mismatched.length > 0 ? (
          <p className="text-amber text-xs">
            {selectedTeacher?.name} 강사의 담당 과목에{" "}
            {mismatched.map((s) => subjects.labelOf(s)).join("·")}이(가) 없습니다. 그대로 인계할 수
            있지만 한 번 확인해 주세요.
          </p>
        ) : null}

        <WindowLink
          href={`/classes?teacher=${staffId}`}
          title="수업목록"
          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
        >
          수업목록에서 이 강사의 반 모두 보기
          <ExternalLink className="size-3" />
        </WindowLink>

        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}

        <footer className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          {/* 클릭한 submit 버튼의 name/value만 전송된다 — 서버가 mode로 인계 여부를 가른다. */}
          <SubmitBtn name="mode" value="skip" variant="outline" label="인계 없이 퇴사 처리" />
          <SubmitBtn
            disabled={!newTeacherId || totalPicked === 0}
            label={`${totalPicked}개 반 인계 후 퇴사`}
          />
        </footer>
      </form>
    </Modal>
  );
}

function SubmitBtn({
  label,
  name,
  value,
  variant,
  disabled,
}: {
  label: string;
  name?: string;
  value?: string;
  variant?: "outline";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      name={name}
      value={value}
      variant={variant}
      disabled={pending || disabled}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}
