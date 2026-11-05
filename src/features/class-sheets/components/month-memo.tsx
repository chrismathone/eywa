"use client";

/**
 * 월간 **특이사항 메모** — 달력 보기에서 월간계획 바로 아래 한 칸(0246a).
 *
 * 원장 2026-09-03: *"인재원 영어의 강사시트 달력뷰에서 특이사항 메모할 수 있는 메모란을 추가해야겠어.
 * 월별 계획 아래쪽에 추가하면 될듯."*
 *
 * 🔴 **달력 보기에만 선다.** 진도표는 날짜 열이 축이고 계획(MP)은 인쇄 서식이라, 같은 칸을 세 보기에
 *    다 두면 어디에 적은 게 남는지 헷갈린다(원장이 지목한 자리도 달력이다).
 * 🔑 grain = **반 × 달 하나**. 담임/부담임으로 안 가른다 — 특이사항은 그 반의 사실이지 역할별 기록이
 *    아니다(위 목표 스트립의 역할 토글은 목표에만 걸린다).
 * ⚠️ 저장은 **디바운스 600ms + 언마운트 flush** — 목표 스트립(`use-month-goals`)과 같은 규약이라
 *    마지막 글자를 잃지 않는다. 값은 `defaultValue`(비컨트롤드)라 왕복마다 커서가 튀지 않는다.
 * ⚠️ 0246a 미적용이면 **편집을 잠그고 사실을 그대로 적는다** — 적을 수 있는 것처럼 두면 다 쓴 뒤에
 *    저장 실패를 만난다([[#95]]·[[#103]] 거짓 어포던스).
 * 🔑 감사로그(원장 결정 2026-09-14 "칸 입력을 마칠 때 한 줄") — 칸을 건드릴 때 편집 전 값을 `audit`에 알리고,
 *    보낸 저장을 `track`한다. 칸을 떠나면 화면 루트(`month-client`)가 그 저장이 끝난 뒤 한 줄 남긴다.
 */
import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveMonthMemo } from "../server/month-memo-actions";
import type { MonthMemoStatus } from "../server/month-queries";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetEditAudit } from "./use-sheet-edit-audit";
import { writeLockedPlaceholder } from "@/lib/write-lock";

const SAVE_DELAY_MS = 600;
const MAX_BODY = 2000;

export function MonthMemo({
  classId,
  month,
  monthLabel,
  initialBody,
  status,
  canEdit,
  audit,
}: {
  classId: string;
  /** "YYYY-MM" */
  month: string;
  monthLabel: string;
  initialBody: string;
  status: MonthMemoStatus;
  canEdit: boolean;
  /** 칸 편집 감사로그 — 없으면 기록하지 않는다(저장은 그대로). */
  audit?: SheetEditAudit;
}) {
  const feedback = useSheetFeedback();
  const t = useSheetT();
  const tf = useSheetTf();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 아직 안 보낸 값 — 언마운트 flush가 **마지막으로 친 글자**를 보낸다. */
  const pending = useRef<string | null>(null);
  /** 감사로그의 '이전 값' — 마지막으로 **저장에 성공한** 값(첫 값은 서버가 준 값). */
  const lastSaved = useRef(initialBody);
  const ready = status === "ok" && canEdit;

  const send = useCallback(
    (body: string) => {
      pending.current = null;
      const job = saveMonthMemo({ classId, month, body })
        .then((res) => {
          if (res.ok) {
            lastSaved.current = body;
            setSavedAt(Date.now());
            setError(null);
            return;
          }
          setError(feedback(res.error));
        })
        .catch(() => {
          // 액션은 {ok:false}로 실패를 알리지만 **네트워크가 끊기면 reject**된다 — 안 잡으면
          // 처리 안 된 rejection만 남고 사람은 저장된 줄 안다.
          setError(t("month.memo.saveFailed"));
        });
      // 칸을 떠난 기록은 이 저장이 끝난 뒤에 나간다(서버가 도착 전 DB를 읽지 않게).
      audit?.track(job);
      return job;
    },
    // 🔴 `t`도 의존성이다 — 언어가 바뀌면 이 함수도 새로 만들어야 실패 문구가 옛 언어로 굳지 않는다.
    [classId, month, audit, feedback, t],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // 언마운트(달 이동·보기 전환·창 닫기) 직전 마지막 값 flush — 실패는 알릴 자리가 없으니 조용히 보낸다.
      if (pending.current !== null) void send(pending.current);
    };
  }, [send]);

  const onChange = (body: string) => {
    audit?.touch(classId, { kind: "monthMemo", month }, lastSaved.current);
    pending.current = body;
    setSavedAt(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void send(body);
    }, SAVE_DELAY_MS);
  };

  return (
    <div className="border-line overflow-hidden rounded-xl border">
      <div className="bg-bg-soft flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs font-bold">
        <span>{t("roster.col.note")}</span>
        <span className="text-text-faint num">{monthLabel}</span>
        <span
          className={`ml-auto text-xs font-semibold ${
            error ? "text-danger" : savedAt ? "text-green" : "text-text-faint"
          }`}
        >
          {error ?? t(savedAt ? "toolbar.saved" : "month.memo.hint")}
        </span>
      </div>
      {/* 🔴 표가 아직 없으면 **적게 두지 않는다** — 다 쓰고 나서 저장 실패를 만나는 게 더 나쁘다. */}
      {status !== "ok" ? (
        <p className="text-text-dim px-2.5 py-2 text-xs">
          {status === "missing-table"
            ? t("month.memo.notReady")
            : t("month.memo.loadFailed")}
        </p>
      ) : (
        <textarea
          className="text-foreground focus:border-primary min-h-[72px] w-full resize-y border-0 bg-white px-2.5 py-2 text-sm font-semibold outline-none disabled:opacity-60"
          defaultValue={initialBody}
          disabled={!ready}
          maxLength={MAX_BODY}
          // 읽기 권한이면 빈 자리 표시 글 대신 **권한 안내**(원장 2026-11-05 — 비어 있는 잠긴 칸은 이유를 말하지 않았다).
          placeholder={canEdit ? t("month.memo.placeholder") : writeLockedPlaceholder("ecs")}
          aria-label={tf("month.memo.aria", { month: monthLabel })}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            // 칸을 떠나면 디바운스를 기다리지 않는다 — 사람이 "다 썼다"고 말한 순간이다.
            if (!ready || pending.current === null) return;
            if (timer.current) {
              clearTimeout(timer.current);
              timer.current = null;
            }
            void send(e.target.value);
          }}
        />
      )}
    </div>
  );
}

