"use client";

/**
 * **ECS 시트 · 오늘 계획** — 보고서 입력 열 맨 위에 서는 출처 패널(2026-08-07).
 *
 * 영어 강사는 수업 전후로 ECS 주간 시트(또는 '오늘 ECS')에 교재·진도·과제를 이미 적는다.
 * 그 값이 이 화면의 진도/교재/오늘 과제 **초안**으로 들어와 있고, 이 패널이 그 사실을 밝힌다
 * (출처를 안 밝히면 "내가 안 썼는데 왜 채워져 있지"가 된다). 강사가 고친 뒤에도 '가져오기'로 원본 복구.
 *
 * 🔴 **학생별 기록은 자동으로 넣지 않는다** — 시트의 `progress_note`("PL 7, 20개 / PV 4")는 개인 메모라
 *    문맥이 제각각이고, 그대로 학부모 발송물에 실리면 안 되는 것이 섞일 수 있다. 여기선 **보여주기만** 한다.
 */
import type { Subject } from "../types";
import { useSheetT } from "@/features/teacher-view/lang-context";

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <span className="text-text-faint shrink-0 text-[11px] font-bold">{label}</span>
      {/* 여러 교시면 줄이 여럿이다 — 시트에 보이는 줄 구조를 그대로 유지한다(`pre-line`). */}
      <span className="text-text-dim min-w-0 flex-1 text-[12px] leading-relaxed whitespace-pre-line">
        {value}
      </span>
    </div>
  );
}

export function SheetSourceCard({
  subject,
  onApply,
}: {
  subject: Subject;
  /** '가져오기' — 진도·교재·오늘 과제를 시트 값으로 되돌린다(학생별 기록은 대상 아님). */
  onApply: () => void;
}) {
  const t = useSheetT();
  const sheet = subject.sheetDraft;
  const note = subject.sheetStudentNote;
  if (!sheet && !note) return null;

  // 이미 화면 값이 시트와 같으면 '가져오기'는 할 일이 없다 → 버튼을 감춘다(누르면 아무 일도 안 일어나는
  // 버튼은 고장으로 읽힌다). 세 칸 중 하나라도 다르면 노출.
  const differs =
    !!sheet &&
    ((sheet.progress !== "" && (subject.today ?? "") !== sheet.progress) ||
      (sheet.textbook !== "" && (subject.textbook ?? "") !== sheet.textbook) ||
      (sheet.homework !== "" && (subject.homeworkToday ?? "") !== sheet.homework));

  return (
    <div className="border-line rounded-lg border px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="micro text-text-faint">{t("os.ss.title")}</p>
        {differs ? (
          <button
            type="button"
            onClick={onApply}
            className="text-primary shrink-0 cursor-pointer text-[12px] font-bold underline-offset-2 hover:underline"
            title={t("os.ss.applyTitle")}
          >
            {t("os.prev.rowGet")}
          </button>
        ) : null}
      </div>
      {sheet ? (
        <div className="flex flex-col gap-0.5">
          <Row label={t("os.ss.progress")} value={sheet.progress} />
          <Row label={t("os.ss.book")} value={sheet.textbook} />
          <Row label={t("os.ss.hw")} value={sheet.homework} />
        </div>
      ) : null}
      {note ? (
        <div className="border-line mt-1.5 border-t pt-1.5">
          <Row label={t("os.ss.student")} value={note} />
        </div>
      ) : null}
    </div>
  );
}
