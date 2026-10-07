"use client";
/**
 * 스트립의 교시 한 칸 — 「전원 출석」 한 번으로 끝내는 자리.
 *
 * ⚠️ 여기서 결석을 찍을 수는 없다(의도) — 예외가 있는 반은 '자세히'로 넘어가 이름별로 찍는다.
 *    한 화면에 모든 걸 넣으면 스트립이 또 하나의 무거운 화면이 되고, 그러면 아무도 안 본다.
 * ⚠️ 서버가 거절하면 낙관 상태를 되돌린다(.catch 없으면 "찍은 줄 알았는데 안 찍힌" 상태가 남는다).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setAttendanceBulk } from "@/features/attendance/server/actions";
import { requestDeskConfirm } from "@/features/attendance/live/server/actions";
import { busCellsFromBulk, publishAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { useSheetFeedback, useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { sheetUiText } from "@/features/teacher-view/interface-text";

export function StripSlot({
  date,
  classId,
  className,
  slotStart,
  saveSlot,
  periodLabel,
  pendingIds,
  pendingStudents,
  deskRequested,
}: {
  date: string;
  classId: string;
  className: string;
  slotStart: string;
  /** 저장에 실을 교시 값(slot-axis) — 수학은 null이라 "그날 전체"로 저장된다. */
  saveSlot: string | null;
  periodLabel: string | null;
  pendingIds: string[];
  pendingStudents: { name: string; englishName: string | null }[];
  /** 이 (반·저장축)에 이미 '데스크 확인 요청'을 보냈는가 — 표식은 서버(dedup 원장)가 진실. */
  deskRequested: boolean;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const feedback = useSheetFeedback();
  const shownClass = classNameFor(className, lang);
  const pendingNames = pendingStudents.map((student) => studentDisplayName(student.name, student.englishName, lang));
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(deskRequested);

  function fillAll() {
    setError(null);
    setDone(true);
    startTransition(() => {
      setAttendanceBulk({
        sessionDate: date,
        status: "present",
        cells: pendingIds.map((id) => ({ studentId: id, classId })),
        fillEmptyOnly: true, // 서버 강제 — 낡은 화면이 남이 찍은 결석을 뒤집지 못한다
        slotStart: saveSlot,
        periodStart: slotStart,
      })
        .then((res) => {
          if ("error" in res) {
            setDone(false);
            setError(feedback(res.error));
            return;
          }
          // 같은 문서 아래에 열려 있는 화면(원스크린 로스터·ECS 오늘 보드/주간 시트)에 방금 기록한 칸을
          // 알린다 — 그 화면들은 출결을 **마운트 1회만** 클라 state로 복사하고 router.refresh()는 state를
          // 보존하므로, 이 방송이 없으면 새로고침 전까지 알약·'일괄 출석 N'·발송 칸이 낡은 채로 남는다
          // (원장 제보 2026-08-20). 서버가 **실제로 기록한 칸**만 실어 되돌림 위험이 없다.
          if (res.applied.length > 0) {
            publishAttendanceApplied({
              date,
              status: "present",
              // 저장 축 그대로(영어=교시, 수학=null) — 시트가 이 값으로 칸을 정한다.
              slot: saveSlot,
              // 새로 만든 칸엔 서버가 넣은 시수(수학 자동 시수)까지 — 원스크린 '타임'이 기록과 같게(2026-09-11).
              cells: busCellsFromBulk(res.applied),
            });
          }
          router.refresh();
        })
        .catch(() => {
          setDone(false);
          setError(t("strip.saveFailed"));
        });
    });
  }

  /**
   * 역방향 요청(원장 2026-08-18) — 데스크→강사(입력 요청)만 있던 것의 거울상. 명단·수신자는 서버가
   * 다시 계산하므로 여기선 (반·날짜·저장축)만 보낸다. 거절되면 낙관 표식을 되돌린다(전원 출석과 같은 규약).
   */
  function askDesk() {
    setError(null);
    setAsked(true);
    startTransition(() => {
      requestDeskConfirm({ classId, sessionDate: date, slotStart: saveSlot })
        .then((res) => {
          if ("error" in res) {
            setAsked(deskRequested);
            setError(feedback(res.error));
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setAsked(deskRequested);
          setError(t("strip.requestFailed"));
        });
    });
  }

  if (done && !error) return null;

  return (
    // 한 줄 카드(원장 2026-08-18 "3개행으로 하지말고 1개열로") — 버튼을 세로로 쌓으면 카드 높이가
    // 버튼 3개만큼 커져 스트립이 화면을 먹는다. 이름·시각·명단·버튼을 한 줄에 눕힌다. 한 줄이 실제로
    // 성립하는 폭은 부모 그리드가 보장한다(today-strip auto-fill minmax 34rem). 그래도 넘치면(아주 긴
    // 반 이름 등) flex-wrap이 뒤쪽 조각부터 다음 줄로 내린다(이름·명단은 truncate + 전체는 title).
    <div className="border-line bg-card flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-2.5 py-1.5">
      <p className="min-w-0 truncate text-sm font-bold" title={shownClass}>
        {shownClass}
      </p>
      {/* 🔴 수가 든 문구는 **문장 전체**를 사전에서 받는다(`미입력 4명` ↔ `4 not marked` — 어순이 반대). */}
      <p className="text-text-dim num shrink-0 text-xs">
        {periodLabel ? `${sheetUiText(lang, periodLabel)} · ` : ""}
        {tf("strip.slotMeta", { time: slotStart, n: pendingIds.length })}
      </p>
      {/* 명단은 남는 공간만 쓴다(basis 0) — 좁으면 먼저 줄어들되 최소 폭은 지켜 버튼을 다음 줄로 민다. */}
      <p
        className="text-text-faint min-w-[3rem] flex-1 truncate text-xs"
        title={pendingNames.join(", ")}
      >
        {pendingNames.slice(0, 4).join(", ")}
        {pendingNames.length > 4 ? tf("strip.moreNames", { n: pendingNames.length - 4 }) : ""}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={fillAll}
          disabled={busy}
          className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap disabled:opacity-60"
        >
          {t("strip.fillAll")}
        </button>
        <Link
          href="/attendance/live"
          className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-center text-xs whitespace-nowrap"
        >
          {t("strip.detail")}
        </Link>
        {asked ? (
          <span className="text-text-faint text-center text-xs font-bold whitespace-nowrap">
            {t("strip.asked")}
          </span>
        ) : (
          <button
            type="button"
            onClick={askDesk}
            disabled={busy}
            title={t("strip.askDesk.title")}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap disabled:opacity-60"
          >
            {t("strip.askDesk")}
          </button>
        )}
      </div>
      {error && <p className="text-danger w-full text-xs">{error}</p>}
    </div>
  );
}
