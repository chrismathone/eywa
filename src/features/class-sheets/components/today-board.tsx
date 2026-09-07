"use client";

/**
 * **오늘 ECS 보드** — 영어 강사의 원스크린(원장 지시 2026-08-07, 고도화 2026-08-11).
 *
 * 주간 시트가 "반 하나 × 주 하나"라면 여기는 "날짜 하나 × 내 반 전부"다. 그 날 수업이 있는 반만
 * 교시 순서로 쌓아, 강사가 **오늘 할 일**(계획이 비었나 · 출석을 찍었나 · 보고서를 썼나 · 알림장을
 * 올렸나)을 한 화면에서 본다. 상단 요약 스트립이 그 합산이다.
 *
 * 🔴 **출결 저장은 주간 시트와 글자 그대로 같은 경로**만 쓴다 —
 *    `setAttendanceCell`(출석/지각/결석, 출석부·원스크린 공용 게이트), `clearPresentAttendance`
 *    (0169a, plain present만), 그리고 일괄은 `setAttendanceBulk`(원스크린 표뷰와 같은 배치 액션 —
 *    같은 게이트를 집합 단위로 통과, applied만 화면에 칠한다). 여기서 새 저장 경로를 만들면
 *    시수·급여가 읽는 값에 두 번째 진실이 생긴다(#77).
 * 🔴 일괄 출석은 **빈 칸만**(비파괴, lib/bulk.ts planBulkAttendance와 같은 계약) — 이미 기록된 값
 *    (특히 결석·지각)은 절대 덮지 않는다. 그래서 확인 다이얼로그가 필요 없다. 이 계약은 클라 필터가
 *    아니라 **서버가 강제**한다(`fillEmptyOnly` — 화면이 낡아도 남의 기록을 못 덮는다).
 * ⚠️ 지각·결석의 **사유·시수 편집은 여기에 없다** — 그건 출석부·주간 시트의 몫이다(ECS §E 규약 그대로).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import { subscribeAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { applyAppliedToBoardAtt } from "../lib/applied-attendance";
import { createInflightKeys, type InflightKeys } from "../lib/inflight-keys";
import { clearPresentAttendance, setMyEcsFontSize } from "../server/actions";
import { ECS_FONT_SIZE_ZOOM, type EcsFontSize } from "../font-size";
import type { BasicAttendance } from "../lib/mark-cycle";
import { StudentRow } from "./today-student-row";
import { EcsMakeupAdder } from "./ecs-makeup-adder";
import { TodaySummary, type TodayStats } from "./today-summary";
import type { StudentMark } from "./today-mark-popover";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { TodayPlanEditor } from "./today-plan-editor";
import type { TodayClassCard } from "../server/today";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";

/** 낙관 갱신용 로컬 출결 상태 — `${classId}|${studentId}` → 상태·메모. */
type AttState = Record<string, { status: string | null; note: string | null }>;

function initialAtt(cards: TodayClassCard[]): AttState {
  const out: AttState = {};
  for (const c of cards) {
    for (const s of c.students) {
      out[`${c.classId}|${s.studentId}`] = { status: s.attendance, note: s.attendanceNote };
    }
  }
  return out;
}

/** 학생 기록(태도·특이사항) 로컬 상태 — `${classId}|${studentId}|${slotStart}`. 교시별이라 키에 시각까지. */
type MarkState = Record<string, StudentMark>;

function initialMarks(cards: TodayClassCard[]): MarkState {
  const out: MarkState = {};
  for (const c of cards) {
    for (const s of c.students) {
      for (const [slot, m] of Object.entries(s.marks)) out[`${c.classId}|${s.studentId}|${slot}`] = m;
    }
  }
  return out;
}

/** 출결·마크 낙관 상태 묶음 — ClassCard에 개별 prop 4개로 흩뿌리지 않는다(props 10개 규칙). */
type BoardState = {
  att: AttState;
  setAtt: React.Dispatch<React.SetStateAction<AttState>>;
  marks: MarkState;
  setMarks: React.Dispatch<React.SetStateAction<MarkState>>;
  /**
   * 저장 중인 출결 칸(`${classId}|${studentId}`) — 상단 출석 스트립 방송이 **내가 방금 누른 값**을
   * 되돌리지 않게 하는 잠금(응답 역전 방지). state가 아닌 이유는 이 값이 화면을 그리지 않고
   * **콜백이 읽기만** 하기 때문(리렌더를 늘릴 이유가 없다). Set이 아닌 이유는 inflight-keys.ts 주석.
   */
  attInflight: InflightKeys;
};

/**
 * 상태 배지 — 시간표 주 네비의 '과거/미래 조회' 배지와 **같은 규약**(rounded-full · 10px · bold).
 * `done`이면 색을 빼 조용히 둔다(할 일이 남은 것만 앰버로 눈에 걸리게).
 */
function Badge({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${
        done ? "bg-bg-soft text-text-dim" : "bg-amber-soft text-amber"
      }`}
    >
      {children}
    </span>
  );
}

/** 반 카드 하나 — 머리(시각·반명·요약) + 교시 계획 + 학생 목록. */
function ClassCard({
  card,
  weekMonday,
  date,
  state,
  skillAreas,
  canWrite,
  userId,
  tenantId,
  nowHm,
  isHoliday,
}: {
  card: TodayClassCard;
  weekMonday: string;
  date: string;
  state: BoardState;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  userId: string;
  tenantId: string;
  /** 지금 시각(KST HH:mm) — 오늘이 아니거나 아직 마운트 전이면 null(진행 중 표시 없음). */
  nowHm: string | null;
  /**
   * 학원 휴일인가 — 배지의 **재촉 색만** 걷는다(숫자·입력·저장은 그대로).
   * 🔴 요약 스트립과 **함께** 걷어야 한다 — 위는 무채색인데 카드마다 앰버 "계획 0/2"가 서면 한 화면이
   *    스스로 모순된다(절반만 옮긴 규칙이 안 옮긴 것보다 나쁘다).
   */
  isHoliday: boolean;
}) {
  const { att, setAtt, marks, setMarks, attInflight } = state;
  const [open, setOpen] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const t = useSheetT();
  const tf = useSheetTf();
  // 🔴 반 이름 표기는 언어를 따른다(원장 2026-09-03) — 이 카드에 나오는 세 자리(제목·aria·title)가
  //    같은 값을 봐야 마우스 오버와 화면 글자가 갈리지 않는다.
  const shownClassName = classNameFor(card.className, useSheetLang());
  // 학생 기록의 교시 축 = **화면에 그려진 교시 그대로**(안 그린 자리·만료 슬롯엔 저장할 자리가 없다).
  const slotLabels = card.slots.map((s) => ({
    slotStart: s.slotStart,
    label: s.periodLabel ?? s.slotStart,
    // 폼(기본 / JJ 전용)은 서버가 자리 라벨로 확정해 내려준다 — 화면이 반 이름으로 추측하지 않는다.
    form: s.form,
  }));
  const attOf = (s: TodayClassCard["students"][number]) =>
    att[`${card.classId}|${s.studentId}`] ?? { status: s.attendance, note: s.attendanceNote };
  const marked = card.students.filter((s) => attOf(s).status).length;
  const written = card.students.filter((s) => s.reportWritten).length;
  const planMissing = card.fill.total - card.fill.filled;
  // 일괄 출석 대상 = 아직 출결이 없는 **정규** 학생. 보강은 추가 시 이미 makeup 칸이 있다 —
  // refresh 뒤 로컬 att가 비어 보여도 여기 넣으면 일괄이 makeup을 출석으로 덮는다.
  const pending = card.students.filter((s) => !s.isMakeup && !attOf(s).status);
  // 진행 중 = 지금 시각이 이 카드의 첫 교시 시작~마지막 교시 끝 사이(끝 시각이 없으면 표시하지 않는다).
  const live = nowHm !== null && card.endsAt !== null && nowHm >= card.startsAt && nowHm < card.endsAt;

  function save(studentId: string, status: BasicAttendance, note?: string | null) {
    const key = `${card.classId}|${studentId}`;
    const before = att[key];
    attInflight.acquire(key); // 이 칸은 내 쓰기가 진실 — 스트립 방송이 덮지 못하게(위 attInflight 주석)
    setAtt((p) => ({ ...p, [key]: { status, note: note === undefined ? (before?.note ?? null) : note } }));
    void setAttendanceCell({
      classId: card.classId,
      studentId,
      sessionDate: date,
      status,
      ...(note === undefined ? {} : { note }),
    })
      .then((r) => {
        if ("error" in r) {
          setAtt((p) => ({ ...p, [key]: before ?? { status: null, note: null } }));
          toast.error(r.error);
        }
      })
      .catch(() => {
        setAtt((p) => ({ ...p, [key]: before ?? { status: null, note: null } }));
        toast.error(t("today.saveFailed.attendance"));
      })
      .finally(() => attInflight.release(key));
  }

  /**
   * 일괄 출석 — **빈 칸만** present로, 왕복 1회(`setAttendanceBulk` + `fillEmptyOnly`). 비파괴는 클라
   * 필터가 아니라 **서버가 강제**한다(화면이 낡아 있어도 딴 곳에서 방금 찍힌 결석을 절대 덮지 않음 —
   * 적대 리뷰 2026-08-11). 서버가 돌려준 applied만 남기고 걸린 셀은 원상 복구한다(원스크린 표뷰와 같은
   * 계약 — 걸린 셀을 '됐다'고 칠하지 않는다). 진행 중엔 이 카드의 출결 드롭다운을 함께 잠근다 —
   * 비행 중 개별 조작이 롤백 스냅샷에 덮이는 레이스를 원천 차단(1초 남짓의 정직한 잠금).
   */
  function bulkPresent() {
    const targets = pending.map((s) => s.studentId);
    if (targets.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    for (const id of targets) attInflight.acquire(`${card.classId}|${id}`);
    const before = new Map(targets.map((id) => [id, att[`${card.classId}|${id}`] ?? { status: null, note: null }]));
    const restore = (ids: string[]) =>
      setAtt((p) => {
        const copy = { ...p };
        for (const id of ids) copy[`${card.classId}|${id}`] = before.get(id) ?? { status: null, note: null };
        return copy;
      });
    setAtt((p) => {
      const copy = { ...p };
      for (const id of targets) copy[`${card.classId}|${id}`] = { status: "present", note: null };
      return copy;
    });
    void setAttendanceBulk({
      sessionDate: date,
      status: "present",
      cells: targets.map((studentId) => ({ studentId, classId: card.classId })),
      fillEmptyOnly: true,
    })
      .then((r) => {
        if ("error" in r) {
          restore(targets);
          toast.error(r.error);
          return;
        }
        const appliedSet = new Set(r.applied.map((a) => a.studentId));
        const missed = targets.filter((id) => !appliedSet.has(id));
        if (missed.length > 0) {
          restore(missed);
          toast.info(
            `${missed.length}명은 건너뛰었습니다 — 이미 다른 곳에서 기록됐거나 담당 반·수강 대상이 아닙니다(새로고침하면 최신 기록이 보입니다)`,
          );
        }
      })
      // 🔴 서버 액션 reject(네트워크 단절·배포 스큐)면 낙관으로 칠한 '전원 출석'이 화면에 영구 잔류한다
      //    — 반드시 전량 롤백 + 에러 표시(적대 리뷰 2026-08-11).
      .catch(() => {
        restore(targets);
        toast.error(t("today.saveFailed.bulk"));
      })
      .finally(() => {
        for (const id of targets) attInflight.release(`${card.classId}|${id}`);
        setBulkBusy(false);
      });
  }

  /**
   * 학생 기록 낙관 갱신 — 저장 자체는 팝오버가 `upsertStudentMark`로 하고, 여기선 화면 상태만 옮긴다
   * (실패 시 팝오버가 이전 값으로 다시 부른다). null = 그 칸을 비움.
   */
  function saveMark(studentId: string, slotStart: string, next: StudentMark | null) {
    const key = `${card.classId}|${studentId}|${slotStart}`;
    setMarks((p) => {
      const copy = { ...p };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  function clear(studentId: string) {
    const key = `${card.classId}|${studentId}`;
    const before = att[key];
    if (!before?.status) return; // 이미 비어 있으면 왕복할 이유가 없다
    // 🔴 slot은 **화면이 보던 행(들)의 실제 값 그대로** — 주간 시트가 만든 교시별 행(0196a)은 slot을
    //    넘겨야 지워진다. 안 넘기면 RPC가 null-slot 행만 세어 cleared:0 = "지운 척"이 된다(적대 리뷰
    //    2026-08-11). 교시가 여럿이면(하루 두 번 만나는 반) 행마다 한 번씩 — 보통은 1회다.
    const slots = [...new Set(card.students.find((s) => s.studentId === studentId)?.attendanceSlots ?? [])];
    const targets = slots.length > 0 ? slots : [null];
    const rollback = () => setAtt((p) => ({ ...p, [key]: before }));
    attInflight.acquire(key); // 지우는 중에 도착한 방송이 방금 지운 칸을 되살리지 않게
    setAtt((p) => ({ ...p, [key]: { status: null, note: null } }));
    // 🔴 지우기는 0169a 한 경로만 — `setAttendanceCell({status:null})`은 그 칸의 **모든 정정 행**을
    //    지워 사유가 붙은 옛 행까지 앗아간다(시트에서 이미 되돌린 우회로다).
    void (async () => {
      for (const slot of targets) {
        const r = await clearPresentAttendance({ classId: card.classId, studentId, date, slot });
        if (!r.ok) {
          rollback();
          toast.error(r.error);
          return;
        }
      }
    })()
      .catch(() => {
        rollback();
        toast.error(t("today.saveFailed.clear"));
      })
      .finally(() => attInflight.release(key));
  }

  return (
    <section className="bg-card shadow-card rounded-2xl">
      <header className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="num text-foreground shrink-0 text-base font-bold tabular-nums">
          {card.startsAt}
          {card.endsAt ? <span className="text-text-dim font-medium">~{card.endsAt}</span> : null}
        </span>
        {/* 🔴 반 이름 표기는 언어를 따른다(원장 2026-09-03) — 판정은 `classNameFor` 한 곳. */}
        <span className="text-foreground min-w-0 truncate text-base font-bold" title={shownClassName}>
          {shownClassName}
        </span>
        {/* 임시 위임(0173a) — 주간 랜딩·원스크린 반 칩과 같은 앰버 규약(남의 반임을 목록에서부터 가른다). */}
        {card.delegated ? (
          <span className="border-amber bg-amber-soft text-amber shrink-0 rounded-full border px-1.5 py-0.5 text-xs font-bold">
            {t("today.chip.delegated")}
          </span>
        ) : null}
        {live ? (
          <span className="bg-primary-soft text-primary shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold">
            {t("today.chip.live")}
          </span>
        ) : null}
        <span className="text-text-dim shrink-0 text-xs">
          {tf("today.students", { n: card.students.length })}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* 상태 배지 = WeekNav '과거/미래 조회'와 **같은 규약**(rounded-full · 10px · bold).
              ⚠️ 색은 **못 한 일에만** 쓴다 — 다 한 줄까지 물들면 눈이 갈 곳을 잃는다. */}
          <Badge done={isHoliday || planMissing === 0} title={t("today.badge.plan.title")}>
            {tf("today.badge.plan", { done: card.fill.filled, total: card.fill.total })}
          </Badge>
          <Badge
            done={isHoliday || marked >= card.students.length}
            title={t("today.badge.attendance.title")}
          >
            {tf("today.badge.attendance", { done: marked, total: card.students.length })}
          </Badge>
          <Badge
            done={isHoliday || written >= card.students.length}
            title={t("today.badge.report.title")}
          >
            {tf("today.badge.report", { done: written, total: card.students.length })}
          </Badge>
          {/* 영어 알림장의 실제 채널은 ClassNote 반 보드다(eywa 발송 아님) — 워커 적재값(0140a)으로
              "이 날짜에 올라갔나"를 잇는다. 최대 30분 지연이라 '방금 올렸는데 미게시'일 수 있다(툴팁 고지).
              untracked(보드 없음·키 모호)는 배지를 아예 안 단다 — 지울 수 없는 거짓 할 일 금지(적대 리뷰). */}
          {card.classnoteToday !== "untracked" ? (
            <Badge
              done={isHoliday || card.classnoteToday === "posted"}
              title={t("today.badge.notice.title")}
            >
              {t(
                card.classnoteToday === "posted"
                  ? "today.badge.notice.posted"
                  : "today.badge.notice.missing",
              )}
            </Badge>
          ) : null}
          {/* 접기 = ECS 로스터 GroupToggle과 같은 어포던스(회전 셰브런, 테두리 없는 인라인 버튼). */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-text-dim hover:text-foreground inline-flex cursor-pointer items-center p-1 transition"
            aria-expanded={open}
            aria-label={`${shownClassName} ${t(open ? "common.collapse" : "common.expand")}`}
            title={`${shownClassName} ${t(open ? "common.collapse" : "common.expand")}`}
          >
            <EyIcon
              name="chevronRight"
              size={12}
              strokeWidth={2.5}
              className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        </span>
      </header>

      {open ? (
        // 계획은 읽는 칸, 학생은 손대는 칸이라 폭을 같게 줄 이유가 없다 — 학생 쪽을 조금 넓게.
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            {/* 계획은 **여기서 바로 고친다** — 주간 시트와 같은 저널·CAS·presence를 그대로 쓴다.
                `className`은 aria 라벨에만 쓰이는 **표시용 이름**이라 화면 제목과 같은 값을 넘긴다
                (원본을 넘기면 영어 화면에서 음성만 한국어 반 이름을 부른다). */}
            <TodayPlanEditor
              classId={card.classId}
              className={shownClassName}
              weekMonday={weekMonday}
              date={date}
              slots={card.slots}
              skillAreas={skillAreas}
              canEdit={canWrite}
              isEie={card.isEie}
              initialShouting={card.shoutingSlots}
              userId={userId}
              tenantId={tenantId}
              // JJ 이어받기 — 복사가 채운 듣기 레벨·누적 암기 단어수를 **화면 상태에 옮긴다**.
              // 🔴 refresh만으론 안 바뀐다(마크는 useState(initialMarks)) — 안 옮기면 강사는
              //    "복사했는데 칸이 그대로"로 본다. 두 칸만 바꾸고 태도·특이사항은 있던 값 그대로.
              onCarried={(slotStart, patches) => {
                for (const p of patches) {
                  const had = marks[`${card.classId}|${p.studentId}|${slotStart}`];
                  saveMark(p.studentId, slotStart, {
                    status: had?.status ?? null,
                    progressNote: had?.progressNote ?? null,
                    score: had?.score ?? null,
                    listeningLevel: p.listeningLevel,
                    memorizedWords: p.memorizedWords,
                  });
                }
              }}
            />
            {/* 🔴 안 그린 기록은 **침묵하지 않는다** — "분명히 썼는데 안 보인다"를 막는 각주(주간 시트의
                '시간 변경된 기록 N건'과 같은 규약). 계획뿐 아니라 학생 기록(태도·특이사항)도 같은 실종이
                가능해 함께 센다. 되돌릴 곳(주간 시트)까지 함께 가리킨다. */}
            {card.hiddenLines > 0 || card.hiddenMarks > 0 ? (
              <p className="text-text-dim mt-1 text-xs">
                이 화면에 안 나오는 {[
                  card.hiddenLines > 0 ? `계획 ${card.hiddenLines}건` : null,
                  card.hiddenMarks > 0 ? `학생 기록 ${card.hiddenMarks}건` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                — 시간이 바뀌었거나 자리(LAB·JJ) 교시입니다. 주간 시트에서 확인하세요.
              </p>
            ) : null}
            <Link
              href={`/ecs/${card.classId}?week=${weekMonday}`}
              className="text-primary mt-1 inline-block text-sm font-bold underline-offset-2 hover:underline"
            >
              {t("today.link.weekSheet")}
            </Link>
          </div>

          {/* 목록 폭을 여기서 묶는다(넓은 창에서 행이 끝없이 늘어나 밑줄만 길게 남는 것 방지). */}
          <div className="min-w-0 max-w-[26rem]">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="editorial-eyebrow">{t("today.legend")}</p>
              <EcsMakeupAdder
                classId={card.classId}
                date={date}
                existingIds={new Set(card.students.map((s) => s.studentId))}
                canAdd={card.canMarkAttendance}
                slots={card.slots}
              />
              {/* 일괄 출석 — 빈 칸만이라 비파괴(확인 불필요). 라벨이 실제 대상 수를 밝힌다(bulk-label 규약).
                  ⚠️ 렌더 조건에 bulkBusy를 포함 — 낙관 갱신으로 pending이 즉시 0이 되므로 이게 없으면
                  버튼이 클릭 순간 언마운트돼 '기록 중…' 상태가 보일 수 없다(적대 리뷰 2026-08-11). */}
              {card.canMarkAttendance && (pending.length > 0 || bulkBusy) ? (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={bulkPresent}
                  title={t("today.bulkPresent.title")}
                  className="border-line-strong text-foreground hover:text-primary hover:border-primary shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold disabled:cursor-default disabled:opacity-60"
                >
                  {bulkBusy
                    ? t("toolbar.saving")
                    : pending.length === card.students.length
                      ? tf("today.bulkPresent.all", { n: pending.length })
                      : tf("today.bulkPresent.rest", { n: pending.length })}
                </button>
              ) : null}
            </div>
            {card.students.length === 0 ? (
              <p className="text-text-faint text-sm">
                {t("today.noStudents")}
                {card.canMarkAttendance ? t("today.noStudents.makeup") : ""}
              </p>
            ) : (
              card.students.map((s) => (
                <StudentRow
                  key={s.studentId}
                  // 일괄 진행 중엔 이 카드의 출결 컨트롤을 잠깐 잠근다(레이스 차단 — bulkPresent 주석).
                  card={bulkBusy ? { ...card, canMarkAttendance: false } : card}
                  student={s}
                  date={date}
                  slotLabels={slotLabels}
                  marks={Object.fromEntries(
                    slotLabels
                      .map((sl) => [sl.slotStart, marks[`${card.classId}|${s.studentId}|${sl.slotStart}`]])
                      .filter(([, m]) => !!m),
                  )}
                  onMark={(slotStart, next) => saveMark(s.studentId, slotStart, next)}
                  canEdit={canWrite}
                  att={attOf(s)}
                  onSet={(status, note) => save(s.studentId, status, note)}
                  onClear={() => clear(s.studentId)}
                />
              ))
            )}
            {/* 🔴 날짜만 넘기면 원스크린이 '전체'로 열려 강사가 반 칩을 **다시 고른다** — 카드에서 넘어온
                맥락(그 반)을 URL에 싣는다. 없는 반이면 서버가 조용히 '전체'로 떨군다(2026-08-07). */}
            <Link
              href={`/onescreen?date=${date}&class=${card.classId}`}
              className="text-primary mt-2 inline-block text-sm font-bold underline-offset-2 hover:underline"
            >
              {t("today.link.report")}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TodayBoard({
  cards,
  date,
  weekMonday,
  skillAreas,
  canWrite,
  userId,
  tenantId,
  fontSize: initialFontSize,
  isToday,
  isHoliday = false,
}: {
  cards: TodayClassCard[];
  date: string;
  weekMonday: string;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  userId: string;
  tenantId: string;
  fontSize: EcsFontSize;
  isToday: boolean;
  /**
   * 이 날짜가 학원 휴일인가 — **요약 스트립의 재촉 색만** 걷는다(숫자·카드·입력은 그대로).
   * 🔴 카드를 지우거나 저장을 막는 값이 아니다(원장 2026-09-01 *"입력은 가능하도록"*). 사유는 페이지
   *    맨 위 한 줄이 말하고, 여기선 "계획 0/6"이 앰버로 서서 거짓 재촉이 되는 것만 막는다.
   */
  isHoliday?: boolean;
}) {
  // 이름을 `boardT`로 둔다 — 아래 카드 컴포넌트의 `t`와 **다른 스코프**라 같은 이름이면 어느 것을
  // 부르는지 읽는 사람이 헷갈린다(이 보드는 토스트 하나만 쓴다).
  const boardT = useSheetT();
  const [att, setAtt] = useState<AttState>(() => initialAtt(cards));
  const [marks, setMarks] = useState<MarkState>(() => initialMarks(cards));
  // 저장 중인 출결 칸 — 카드마다 흩어 두면 방송 구독(보드 1개)이 못 읽는다. 여기서 만들어 내려보낸다.
  // ⚠️ render 중 ref 쓰기(lazy init)도, 버려질 수 있는 useMemo도 아니다 — 잠금은 **절대 리셋되면
  //    안 되므로**(리셋 = 날아가는 저장이 열린 채로 남는다) 안정성이 보장된 useState 지연 초기값으로 만든다.
  const [attInflight] = useState(createInflightKeys);

  /**
   * 상단 '오늘 출석 미입력' 스트립이 기록한 칸을 이 보드에 반영한다(원장 제보 2026-08-20 — 원스크린과
   * **같은 원인**: 출결이 `useState(initialAtt)`라 마운트 1회만 복사되고, 스트립의 `router.refresh()`는
   * 클라 state를 보존한다 → 새 카드 값이 무시된다. 이 파일이 이미 알고 있던 성질이다 — 위 JJ 이어받기
   * 주석 *"refresh만으론 안 바뀐다"*).
   * ⚠️ 날짜가 다르면 무시(지난 날짜를 보고 있으면 애초에 스트립이 안 뜨지만, 방송은 문서 전체에 간다).
   * ⚠️ 교시(`detail.slot`)는 안 본다 — 이 카드는 **반×하루** 축이라 교시 칸이 없다.
   * ⚠️ setState는 이벤트 콜백 안에서만(#25).
   */
  const cardClassIds = useMemo(() => new Set(cards.map((c) => c.classId)), [cards]);
  useEffect(
    () =>
      subscribeAttendanceApplied((detail) => {
        if (detail.date !== date) return;
        setAtt((prev) =>
          applyAppliedToBoardAtt(
            prev,
            detail.cells,
            detail.status,
            cardClassIds,
            attInflight.snapshot(),
          ),
        );
      }),
    [date, cardClassIds, attInflight],
  );

  // 글씨 크기 — 주간 시트와 같은 계약: 화면은 즉시, 계정 저장은 뒤따른다(sheet-client L210 참조).
  const [fontSize, setFontSize] = useState<EcsFontSize>(initialFontSize);
  const changeFontSize = useCallback((size: EcsFontSize) => {
    setFontSize(size);
    void setMyEcsFontSize(size).then((r) => {
      if (!r.ok) toast.error(boardT("today.saveFailed.fontSize"));
    });
    // 🔴 `boardT`를 의존성에 넣는다 — 언어가 바뀌면 함수도 새로 만들어야 옛 언어로 굳지 않는다
    //    (지금은 언어가 요청 단위라 사실상 안 바뀌지만, 빈 배열은 그 사실에 기대는 것이다).
  }, [boardT]);
  const fontZoom = ECS_FONT_SIZE_ZOOM[fontSize];

  // 지금 시각(KST) — '진행 중' 표시용. SSR/첫 하이드레이션에선 null(시간 의존 렌더의 불일치 방지),
  // 마운트 후 setTimeout으로 채우고 1분마다 갱신한다(setState-in-effect 룰 #25 회피 — 콜백 안에서만 set).
  const [nowHm, setNowHm] = useState<string | null>(null);
  useEffect(() => {
    if (!isToday) return;
    const tick = () =>
      setNowHm(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Seoul",
        }).format(new Date()),
      );
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [isToday]);

  // 하루 요약 — 카드 배지의 합산(출결은 낙관 상태를 그대로 읽어 입력 즉시 숫자가 움직인다).
  const stats: TodayStats = {
    classes: cards.length,
    plan: {
      filled: cards.reduce((n, c) => n + c.fill.filled, 0),
      total: cards.reduce((n, c) => n + c.fill.total, 0),
    },
    att: {
      marked: cards.reduce(
        (n, c) => n + c.students.filter((s) => att[`${c.classId}|${s.studentId}`]?.status).length,
        0,
      ),
      total: cards.reduce((n, c) => n + c.students.length, 0),
    },
    report: {
      written: cards.reduce((n, c) => n + c.students.filter((s) => s.reportWritten).length, 0),
      total: cards.reduce((n, c) => n + c.students.length, 0),
    },
    classnote: {
      posted: cards.filter((c) => c.classnoteToday === "posted").length,
      // 분모는 **판정 가능한 반만** — 보드 없는 반·키 모호 반을 세면 영원히 못 채우는 숫자가 된다.
      total: cards.filter((c) => c.classnoteToday !== "untracked").length,
    },
  };

  const state: BoardState = { att, setAtt, marks, setMarks, attInflight };
  return (
    <div className="space-y-3">
      <TodaySummary stats={stats} fontSize={fontSize} onFontSize={changeFontSize} holiday={isHoliday} />
      {/* 배율은 주간 시트와 같은 zoom 방식(font-size.ts 주석) — 기본(1)은 스타일 자체를 안 붙인다. */}
      <div className="space-y-3" style={fontZoom === 1 ? undefined : { zoom: fontZoom }}>
        {cards.map((card) => (
          <ClassCard
            key={card.classId}
            card={card}
            weekMonday={weekMonday}
            date={date}
            state={state}
            skillAreas={skillAreas}
            canWrite={canWrite}
            userId={userId}
            tenantId={tenantId}
            nowHm={nowHm}
            isHoliday={isHoliday}
          />
        ))}
      </div>
    </div>
  );
}
