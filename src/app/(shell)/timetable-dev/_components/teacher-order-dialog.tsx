"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Users, X } from "@/components/icons/eywa-icon-compat";
import { saveTeacherViewOrder } from "@/features/owner/server/subject-actions";
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/**
 * 강사뷰 **강사 순서** 설정 — 원장 2026-08-04: *"강사뷰에서 JJ와 LAB은 최우측으로 디폴트값으로 넣고,
 * 강사 순서(LAB/JJ 포함) 설정하는 곳 있으면 좋곘네."* → 시간표 헤더에 둔다(그룹 설정 옆).
 *
 * 🔴 왜 필요한가: 지금까지 컬럼 순서는 코드에 박힌 시트 미러(`ENGLISH_SHEET_TEACHERS`)였는데 key가
 * **닉네임**이라, 라벨이 한글 이름으로 해석된 뒤로 대부분이 "시트 밖"으로 떨어져 **가나다순**이 됐다.
 * 미러를 계속 고치는 대신 사람이 정한다(운영 배치는 달마다 바뀐다).
 *
 * 순서는 **정렬 힌트**다 — 여기 없는 강사도 화면에서 사라지지 않고 뒤에 붙는다(새 강사 안전).
 * 자리(JJ·LAB)는 명시하지 않으면 항상 최우측(`buildTeacherComparator`).
 */
export function TeacherOrderDialog({
  subject,
  subjectLabel,
  teachers,
}: {
  subject: string;
  subjectLabel: string;
  /** 이 과목·이 주 강사뷰에 실제 있는 강사 라벨(현재 표시 순서). */
  teachers: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // 편집 목록 = 지금 화면 순서 그대로 시작(설정에 없던 강사도 포함). 저장하면 이 순서가 그대로 굳는다.
  const [list, setList] = useState<string[]>(teachers);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const move = (i: number, d: -1 | 1) =>
    setList((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function reset() {
    // 초기화 = 설정을 비운다 → 자리(JJ·LAB)는 최우측, 나머지는 시트 미러 → 이름순.
    setError(null);
    startSave(async () => {
      const res = await saveTeacherViewOrder({ subject, order: [] });
      if (res.error) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await saveTeacherViewOrder({ subject, order: list });
      if (res.error) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setList(teachers);
          setOpen(true);
        }}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition"
      >
        <Users className="size-3" />
        강사 순서
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border"
            role="dialog"
            aria-label="강사뷰 강사 순서"
          >
            <header className="border-line/70 flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="text-foreground text-sm font-bold">강사 순서 · {subjectLabel}</h2>
                <p className="text-text-faint mt-0.5 text-xs">
                  강사뷰에서 왼쪽부터 이 순서로 놓입니다. 여기 없는 강사도 사라지지 않고 뒤에 붙습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-faint hover:text-foreground rounded p-1 transition"
                aria-label="닫기"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {list.length === 0 ? (
                <p className="text-text-faint py-6 text-center text-xs">이 주 강사뷰에 강사가 없습니다.</p>
              ) : (
                <ol className="space-y-1">
                  {list.map((name, i) => (
                    <li
                      key={name}
                      className="border-line bg-bg-soft/40 flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                    >
                      <span className="text-text-faint num w-5 text-right text-xs">{i + 1}</span>
                      <span className="text-foreground flex-1 truncate text-xs font-medium">{name}</span>
                      {/* 자리(JJ·LAB)는 사람이 아니라 방 — 목록에서 한눈에 구분되게 표시한다. */}
                      {isSpecialSlotLabel(name) ? (
                        <span className="border-line text-text-faint rounded-full border px-1.5 py-px text-xs">
                          자리
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="text-text-dim hover:text-foreground hover:bg-bg-soft rounded p-1 transition disabled:opacity-30"
                        aria-label={`${name} 왼쪽으로`}
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === list.length - 1}
                        className="text-text-dim hover:text-foreground hover:bg-bg-soft rounded p-1 transition disabled:opacity-30"
                        aria-label={`${name} 오른쪽으로`}
                      >
                        <ChevronRight className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {error ? <p className="text-danger mt-2 text-xs">{error}</p> : null}
            </div>

            <footer className="border-line/70 flex items-center justify-between gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="text-text-dim hover:text-foreground text-xs underline-offset-2 transition hover:underline disabled:opacity-50"
              >
                기본 순서로 되돌리기
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs transition"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || list.length === 0}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" /> : null}
                  저장
                </button>
              </div>
            </footer>
          </div>
        </>
      ) : null}
    </>
  );
}
