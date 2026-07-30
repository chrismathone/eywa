"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Layers, Loader2, X } from "@/components/icons/eywa-icon-compat";
import { saveIntegrationGroups } from "@/features/owner/server/subject-actions";
import { DEFAULT_OTHERS_TITLE } from "@/features/timetable/lib/integration-groups";
import {
  dedupeGroups,
  unassignedOf,
  type ClassOption,
  type GroupDraft,
} from "@/features/timetable/lib/group-assign";
import { GroupSettingsBoard } from "./group-settings-board";

/**
 * 통합뷰 '그룹 설정' — 섹션을 "N교시 시작" 자동 그룹 대신 **원장이 정한 묶음**으로 바꾼다.
 * ijw-calander 통합뷰 CUSTOM_GROUP 이식(2026-07-23 원장 요청 "원하는 행으로 이동시킬 수 있어야").
 *
 * 배정 UI = **드래그 보드**(2026-07-30 원장 "지금 그룹 설정은 너무 어려움" → 반마다 그룹 드롭다운 폐기).
 * 이유·폴백은 [group-settings-board.tsx](<src/app/(shell)/timetable/_components/group-settings-board.tsx>) 주석 참조.
 *
 * 저장은 학원설정(과목별) → 화면·엑셀·시트가 같은 해석기를 읽으므로 셋이 함께 움직인다.
 */
export function GroupSettingsDialog({
  subject,
  subjectLabel,
  classes,
  initialGroups,
  initialEnabled,
  initialShowOthers,
  initialOthersTitle,
}: {
  subject: string;
  subjectLabel: string;
  /** 이 과목·이 주에 실제 있는 반(그 주 시간표 기준) — 배정 대상 목록. */
  classes: ClassOption[];
  initialGroups: GroupDraft[];
  initialEnabled: boolean;
  initialShowOthers: boolean;
  initialOthersTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  // 중복 배정(한 반이 두 줄)은 편집 시작 시 정리한다 — 칩은 한 곳에만 보이는데 저장은 둘 다 남으면 어긋난다.
  const [groups, setGroups] = useState<GroupDraft[]>(() => dedupeGroups(initialGroups));
  const [showOthers, setShowOthers] = useState(initialShowOthers);
  const [othersTitle, setOthersTitle] = useState(initialOthersTitle);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, startSave] = useTransition();

  const unassigned = useMemo(() => unassignedOf(classes, groups), [classes, groups]);
  // 드래그로 쌓은 배치를 backdrop 오클릭 한 번에 잃지 않도록 — 바뀐 게 있으면 확인을 받는다.
  const dirty =
    enabled !== initialEnabled ||
    showOthers !== initialShowOthers ||
    othersTitle !== initialOthersTitle ||
    JSON.stringify(groups) !== JSON.stringify(dedupeGroups(initialGroups));

  function requestClose() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    setOpen(false);
  }
  function discardAndClose() {
    setGroups(dedupeGroups(initialGroups));
    setEnabled(initialEnabled);
    setShowOthers(initialShowOthers);
    setOthersTitle(initialOthersTitle);
    setError(null);
    setConfirmClose(false);
    setOpen(false);
  }

  function addGroup() {
    // id는 편집 중 안정 키(이름을 바꿔도·순서를 옮겨도 배정이 따라온다). crypto.randomUUID는 브라우저 전용.
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `g${Date.now()}`;
    setGroups((gs) => [...gs, { id, title: `${gs.length + 1}번째 줄`, classIds: [] }]);
    setEnabled(true); // 줄을 만들자마자 화면이 안 바뀌면 "저장이 안 됐나" 오해한다.
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await saveIntegrationGroups({ subject, enabled, groups, showOthers, othersTitle });
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirmClose(false);
      setOpen(false);
      router.refresh(); // 서버 컴포넌트가 새 설정으로 섹션을 다시 그린다.
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition"
      >
        <Layers className="size-3" />
        그룹 설정
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={requestClose} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border"
            role="dialog"
            aria-label="통합뷰 그룹 설정"
          >
            <header className="border-line/70 flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="text-foreground text-[15px] font-bold">통합뷰 그룹 설정 · {subjectLabel}</h2>
                <p className="text-text-dim mt-0.5 text-[11px]">
                  반을 <b>끌어다 원하는 줄에 놓으세요</b>. 줄 순서(손잡이)와 줄 안 순서도 드래그로 바꿉니다.
                </p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label="닫기"
                className="text-text-dim hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span className="text-foreground font-medium">커스텀 그룹 사용</span>
                <span className="text-text-faint text-[11px]">끄면 자동 묶음으로 돌아갑니다(줄 정의는 그대로 보관).</span>
              </label>

              <GroupSettingsBoard
                classes={classes}
                groups={groups}
                onChange={setGroups}
                onAddGroup={addGroup}
                poolNote={
                  showOthers ? (
                    <>
                      줄에 넣지 않은 반은 통합뷰 맨 아래 <b>{othersTitle.trim() || DEFAULT_OTHERS_TITLE}</b> 줄로
                      보입니다.
                    </>
                  ) : (
                    // 끄면 정말로 화면에서 사라지므로 숫자로 알린다(시간표가 조용히 거짓말하는 걸 막는다).
                    <span className="text-warning flex items-start gap-1">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        지금 미배정 {unassigned.length}개 반은 통합뷰·엑셀·시트에서 <b>보이지 않습니다</b>.
                      </span>
                    </span>
                  )
                }
              />

              <section className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
                  <span className="text-foreground font-medium">미배정 반을 맨 아래 묶어서 보여주기</span>
                </label>
                {showOthers ? (
                  <input
                    value={othersTitle}
                    onChange={(e) => setOthersTitle(e.target.value)}
                    placeholder={DEFAULT_OTHERS_TITLE}
                    className="border-line focus:border-primary w-52 rounded-lg border px-2 py-1 text-[13px] outline-none"
                    aria-label="미배정 묶음 제목"
                  />
                ) : null}
              </section>

              {error ? <p className="text-danger text-[12px]">{error}</p> : null}
            </div>

            <footer className="border-line/70 flex items-center justify-end gap-2 border-t px-5 py-3">
              {confirmClose ? (
                <>
                  <span className="text-warning mr-auto text-[12px]">저장하지 않은 변경이 있습니다.</span>
                  <button
                    type="button"
                    onClick={discardAndClose}
                    className="text-danger px-3 py-1 text-xs hover:underline"
                  >
                    그냥 닫기
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClose(false)}
                    className="text-text-dim hover:text-foreground px-3 py-1 text-xs"
                  >
                    계속 편집
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={requestClose}
                  className="text-text-dim hover:text-foreground px-3 py-1 text-xs"
                >
                  취소
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : null}
                저장
              </button>
            </footer>
          </div>
        </>
      ) : null}
    </>
  );
}
