"use client";

import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
// 🔴 `server/queries.ts`를 직접 import하면 `server-only`가 클라 번들로 끌려와 빌드가 깨진다([[#61]]) —
//    읽기도 서버 액션을 탄다(그쪽에서 게이트를 다시 건다).
import {
  applyTextbookFill,
  loadAssignableTextbooks,
  loadClassSlotChoices,
  previewTextbookFill,
} from "@/features/textbooks/server/plan-actions";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetDowLabel, sheetDowLabelByIndex, type SheetLang } from "@/features/teacher-view/i18n";
import type { ApplyPreview, ApplyPreviewRow, ClassSlotChoice, LessonPace } from "@/features/textbooks/types";
import { TextbookFillExisting } from "./textbook-fill-existing";

/**
 * **교재 배정** — 월간 시트에서 교시를 고르고 교재를 고르면 차수가 수업일마다 순서대로 들어간다.
 * ⚠️ 종전 이름은 '교재 깔기'였다(원장 2026-09-16 *"교재깔기라는 멘트가 부적절함 새로운 단어로 변경"*).
 *
 * 🔴 원장 2026-09-16(월간 시트 캡처와 함께): *"반배정은 반배정 저기서 하지말고 여기서 교재 선택하고
 *    몇차시에 할지 선택하면 해당 서식에 맞춰서 추가되게 — 예를들어서 16시 수업 클릭 17시 수업 클릭 하고
 *    뭐 교재 선택하거나 그런식으로 해서 해당 차이별로 쭈루룩 짜진다는지"*.
 *    → 사람이 고르는 단위는 **축(정규/JJ)이 아니라 시각**이고, 진입점은 교재목록이 아니라 **시트**다.
 * 🔴 고른 시각은 **앞으로 쭉**이다(원장 확정) — 그 반의 모든 수업일의 그 시각에, **차수 끝까지**.
 *    연휴는 차수를 소비하지 않고 건너뛴다.
 * 🔴 **빈 칸만 채운다** — 이미 적힌 칸은 손대지 않는다(`ecs_apply_textbook_lessons` 규약). 그래서
 *    잘못 눌러도 잃을 게 없고, 미리보기를 먼저 보여 준다.
 * 🔴 **지난 날짜엔 안 넣는다** — 소급하면 지난 달 작성률이 뒤늦게 움직인다(미리보기에 `지난 날짜`로 뜬다).
 * ⚠️ 쓰기 게이트는 그 반의 ECS 권한(`requireEcsClassAccess`)이다 — 교재 마스터를 못 고치는 담임 강사도
 *    자기 반엔 교재를 태울 수 있다(서버가 판정한다 — 이 화면 조건은 게이트가 아니다 [[#77]]).
 */
// ⚠️ 요일 글자는 **사전의 한 벌**을 쓴다(`sheetDowLabel`) — 화면 파일에 따로 적으면 같은 요일이
//    화면마다 다른 글자로 뜨고, 영어에선 한 글자로 줄일 수 없다(화·수 T/W 충돌).
const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * 처리 라벨·색·설명 — 문구는 **사전**이 준다(이 화면은 원어민 강사도 연다).
 * ⚠️ 키를 템플릿 문자열로 조립하지 않는다 — `t()`가 키 합집합으로 타입이 잡혀 있어 조립하면 타입이 풀리고,
 *    오타가 빌드에서 안 걸린다. 리터럴로 적어 두면 사전에 없는 키는 그 자리에서 잡힌다.
 */
const OUTCOME = {
  add: { label: "fill.out.add", title: "fill.out.add.title", tone: "text-primary" },
  fill: { label: "fill.out.fill", title: "fill.out.fill.title", tone: "text-green" },
  "skip-filled": { label: "fill.out.filled", title: "fill.out.filled.title", tone: "text-text-faint" },
  "skip-full": { label: "fill.out.full", title: "fill.out.full.title", tone: "text-danger" },
  "skip-past": { label: "fill.out.past", title: "fill.out.past.title", tone: "text-text-faint" },
} as const satisfies Record<ApplyPreviewRow["outcome"], { label: string; title: string; tone: string }>;

function dayLabel(date: string, lang: SheetLang): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}/${d} (${sheetDowLabelByIndex(new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(), lang)})`;
}

type Book = { id: string; title: string; skillArea: string | null; sessionCount: number };

/** 칩을 담당으로 묶는 키 — 담당이 없는 칸은 빈 문자열로 한 묶음이 된다(자기들끼리는 섞여도 된다). */
const teacherKeyOf = (s: ClassSlotChoice): string => s.teacherLabel ?? "";

export function TextbookFillDialog({
  classId,
  className,
  today,
  onClose,
  onApplied,
}: {
  classId: string;
  className: string;
  /** 서버(KST)가 준 오늘 — 시작일 하한. 클라 `new Date()`면 타임존이 어긋난다. */
  today: string;
  onClose: () => void;
  /** 기입이 끝나면 호출 — 호출부가 화면을 다시 읽는다. */
  onApplied: () => void;
}) {
  const feedback = useSheetFeedback();
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 첫 조회가 실패했나 — `true`면 사전 문구, 문자열이면 그 원문. */
  const [loadFailed, setLoadFailed] = useState<string | true | null>(null);

  const [slots, setSlots] = useState<ClassSlotChoice[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bookId, setBookId] = useState("");
  const [pace, setPace] = useState<LessonPace>("period");
  const [termMode, setTermMode] = useState<"regular" | "exam">("regular");
  const [startDate, setStartDate] = useState(today);
  const [startLessonNo, setStartLessonNo] = useState(1);
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  /**
   * 🔴 요청 토큰 — 미리보기가 **돌아오는 동안 입력이 바뀌면 그 응답을 버린다**(적대적 리뷰 P1).
   *    토큰이 없으면 옛 응답이 늦게 도착해 이미 지운 미리보기를 되살리고, 화면은 새 교재를 가리키는데
   *    표는 옛 교재를 보여 준 채 [기입]이 열린다.
   */
  const gen = useRef(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadClassSlotChoices(classId), loadAssignableTextbooks()]).then(([s, b]) => {
      if (!alive) return;
      setLoading(false);
      if (!s.ok) {
        setError(feedback(s.error));
        return;
      }
      if (!b.ok) {
        setError(feedback(b.error));
        return;
      }
      setSlots(s.rows);
      setBooks(b.rows);
      setBookId(b.rows[0]?.id ?? "");
    }).catch((e) => {
      if (!alive) return;
      setLoading(false);
      // 문구는 JSX에서 사전으로 붙인다 — effect가 `t`에 의존하면 사전이 바뀔 때마다 다시 조회한다.
      setLoadFailed(e instanceof Error ? e.message : true);
    });
    return () => {
      alive = false;
    };
  }, [classId, feedback]);

  const book = books.find((b) => b.id === bookId);
  /**
   * 고른 게 하나라도 바뀌면 미리보기는 옛것이 된다 — 버려야 화면이 거짓말을 안 한다.
   * 🔴 토큰도 함께 올린다 — 그래야 **이미 날아간 요청의 응답**이 돌아와도 안 되살아난다.
   */
  function invalidate() {
    gen.current += 1;
    setPreview(null);
  }

  const canPreview = picked.size > 0 && !!bookId && !!startDate;
  /**
   * 지금 고른 담당. 아무것도 안 골랐으면 **null**(그때는 전부 고를 수 있다).
   * ⚠️ 담당 없는 칸은 `""`로 묶는다 — `?? null`로 접으면 "안 고름"과 구분이 안 돼 규칙이 새어 나간다.
   */
  const firstPicked = slots.find((s) => picked.has(s.key));
  const pickedTeacher = firstPicked ? teacherKeyOf(firstPicked) : null;
  /**
   * 고른 칩들이 실제로 가리키는 칸 목록(`"mon|17:20"`) — 서버가 받는 값이다.
   * 🔴 **`useMemo`여야 한다** — 매 렌더 새 배열이면 아래 `runPreview`의 정체성이 계속 바뀌어
   *    자동 미리보기 effect가 무한히 돈다(요청이 끝없이 나간다).
   */
  const pickedSlots = useMemo(
    () => slots.filter((s) => picked.has(s.key)).flatMap((s) => s.picks),
    [slots, picked],
  );

  const runPreview = useCallback(async () => {
    const token = ++gen.current;
    setBusy(true);
    setError(null);
    try {
      // 🔴 **저장하지 않는다** — 미리보기가 배정을 덮어쓰던 것을 걷어냈다(적대적 리뷰 P1).
      const pv = await previewTextbookFill({
        classId,
        textbookId: bookId,
        slotPicks: pickedSlots,
        pace,
        termMode,
        startDate,
        startLessonNo,
      });
      // 그 사이 입력이 바뀌었다 — 이 응답은 버린다.
      if (token !== gen.current) return;
      if (!pv.ok) {
        setError(feedback(pv.error));
        return;
      }
      setPreview(pv.preview);
    } catch (e) {
      if (token === gen.current) setError(feedback(e instanceof Error ? e.message : t("fill.err.generic")));
    } finally {
      // ⚠️ **조건 없이 푼다** — `token === gen.current`일 때만 풀면, 입력을 바꿔 계산이 취소된 뒤
      //    (교시를 모두 해제해) 새 계산이 안 도는 경우 busy가 영영 true로 남아 **닫기 버튼까지 잠긴다**.
      //    겹친 요청 사이의 '계산 중…' 표시는 아래 `calculating`이 파생값으로 메운다.
      setBusy(false);
    }
  }, [classId, bookId, pickedSlots, pace, termMode, startDate, startLessonNo, feedback, t]);

  /**
   * 🔴 **미리보기는 스스로 돈다** — 원장 제보 2026-09-17(*"기입자체가안됌"*, 교시·교재를 바꿔 가며 세 번).
   *    그전엔 [미리보기]를 눌러야 [기입]이 열려서, 다 골라 놓고도 버튼이 회색이라 **고장난 것으로 읽혔다**
   *    (실제로 기입 감사로그가 0건이었다). 버튼 하나를 더 누르게 하는 설계가 곧 "안 된다"였다.
   * 🔑 입력이 갖춰지면(교시 ≥1 · 교재 · 시작일) 220ms 뒤에 계산한다 — 타자·드롭다운 연타 중에는 마지막 것만
   *    나간다. 늦게 도착한 응답은 위 요청 토큰이 버린다.
   */
  useEffect(() => {
    if (!canPreview) return;
    const timer = setTimeout(() => void runPreview(), 220);
    return () => clearTimeout(timer);
  }, [canPreview, runPreview]);

  async function onApply() {
    if (busy || !preview) return;
    setBusy(true);
    setError(null);
    try {
      // 🔴 **미리보기와 같은 입력**으로 부른다 — planId를 들고 다니지 않으니 "화면은 B인데 A가 기입되는"
      //    어긋남이 구조적으로 불가능하다. 서버가 같은 순수 함수로 다시 계산한다([[#77]]).
      const res = await applyTextbookFill({
        classId,
        textbookId: bookId,
        slotPicks: pickedSlots,
        pace,
        termMode,
        startDate,
        startLessonNo,
      });
      if (!res.ok) {
        setError(feedback(res.error));
        return;
      }
      // 🔴 배정은 **월간계획까지만** 만든다(원장 2026-09-22) — 실제 칸은 강사가 [월간계획 가져오기]를
      //    누를 때만 채워지므로, 여기서 '기입 완료'라고 말하면 거짓이 된다.
      const planned = res.result.planned ?? 0;
      if (planned === 0) toast.info(t("fill.done.none"));
      else toast.success(tf("fill.done", { n: planned }));
      router.refresh();
      onApplied();
      onClose();
    } catch (e) {
      setError(feedback(e instanceof Error ? e.message : t("fill.err.generic")));
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows ?? [];
  const willWrite = rows.filter((r) => r.outcome === "add" || r.outcome === "fill").length;
  // ⚠️ 진도가 아직 빈 차수 — 기입은 **된다**(교재·페이지/시간이 들어간다). 막지 않고 알리기만 한다.
  // 🔑 **지금 쓰는 칸만** 센다 — 전체를 세면 지난 날짜·이미 적힌 칸까지 섞여 옆의 '기입 N'보다 큰 수가 된다.
  const noProgress = rows.filter(
    (r) => (r.outcome === "add" || r.outcome === "fill") && !r.progress && !r.homework,
  ).length;
  /**
   * 지금 계산 중인가 — **파생값**이다. `busy`만 보면 디바운스(220ms)와 요청 사이의 빈틈에 '계산 중…'이
   * 깜빡인다. "고를 건 다 골랐는데 아직 결과도 오류도 없다" = 계산이 돌고 있거나 곧 돈다.
   */
  const calculating = busy || (canPreview && !preview && !error);
  /** 계산은 끝났는데 쓸 칸이 하나도 없다 — 회색 버튼만 두면 또 "안 된다"가 된다. 이유를 적는다. */
  const nothingToWrite = Boolean(preview) && willWrite === 0;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{tf("fill.title", { class: className })}</DialogTitle>
          <DialogDescription className="text-xs">{t("fill.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error || loadFailed ? (
            <p role="alert" className="bg-danger-soft/40 text-danger rounded-lg px-3 py-1.5 text-xs">
              {error ?? (typeof loadFailed === "string" ? loadFailed : t("fill.err.generic"))}
            </p>
          ) : null}

          {loading ? (
            <p className="text-text-dim py-6 text-center text-xs">{t("fill.loading")}</p>
          ) : (
            <>
              {/* 이 반에 이미 걸린 배정 + [배정 삭제] — 잘못 건 배정을 지우는 자리(감사 F4). */}
              <TextbookFillExisting classId={classId} />
              <div className="flex flex-col gap-1.5">
                <span className="text-text-dim text-xs font-bold">{t("fill.slots")}</span>
                <span className="text-text-faint text-xs">{t("fill.slots.oneTeacher")}</span>
                {slots.length === 0 ? (
                  <p className="text-text-dim text-xs">{t("fill.slots.none")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((s) => {
                      // 🔴 칩 하나 = **(시각, 담당)** 한 묶음이다(원장 2026-09-18) — 같은 17:20이라도
                      //    월은 추민아, 목은 JJ일 수 있어 시각으로 묶으면 남의 칸까지 데려간다.
                      const on = picked.has(s.key);
                      const dows = [...s.dows].sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b));
                      // 다른 담당의 칩은 **같이 담기지 않는다**(아래 onClick) — 지금 고른 담당이 아니면 흐리게.
                      const otherTeacher = pickedTeacher !== null && teacherKeyOf(s) !== pickedTeacher;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            // 🔴 **한 배정엔 한 담당만**(원장 2026-09-18 *"교사가 다르면 교재배정을 새로해야지"*).
                            //    섞으면 차수가 두 선생님 칸에 번갈아 들어가 둘 다 제 진도를 못 읽는다.
                            //    막아 두는 대신 **고른 것으로 갈아탄다** — 못 누르는 칩은 고장으로 읽힌다.
                            setPicked((prev) => {
                              if (otherTeacher) return new Set([s.key]);
                              const next = new Set(prev);
                              if (next.has(s.key)) next.delete(s.key);
                              else next.add(s.key);
                              return next;
                            });
                            invalidate();
                          }}
                          className={`rounded-lg border px-2.5 py-1 text-left text-xs transition ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : otherTeacher
                                ? "border-line-faint text-text-faint hover:border-primary hover:text-foreground"
                                : "border-line text-text-dim hover:border-primary hover:text-foreground"
                          }`}
                          title={otherTeacher ? t("fill.slots.oneTeacher") : undefined}
                        >
                          <span className="num font-bold">{s.start}</span>
                          {s.periodLabel ? <span className="ml-1 opacity-80">{s.periodLabel}</span> : null}
                          <span className="ml-1 opacity-70">
                            {dows.map((d) => sheetDowLabel(d, lang)).join("·")}
                            {s.seat ? ` · ${s.seat}` : s.teacherLabel ? ` · ${s.teacherLabel}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-text-dim text-xs font-bold">{t("fill.book")}</span>
                  <select
                    value={bookId}
                    onChange={(e) => {
                      setBookId(e.target.value);
                      invalidate();
                    }}
                    className="border-line focus:border-primary h-8 w-full rounded-lg border bg-transparent px-2.5 pr-7 text-base outline-none sm:text-xs"
                  >
                    {books.length === 0 ? <option value="">{t("fill.book.none")}</option> : null}
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({tf("fill.book.sessions", { n: b.sessionCount })})
                      </option>
                    ))}
                  </select>
<span className="text-text-faint text-xs">{t("fill.book.hint")}</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-text-dim text-xs font-bold">{t("fill.pace")}</span>
                  <select
                    value={pace}
                    onChange={(e) => {
                      setPace(e.target.value as LessonPace);
                      invalidate();
                    }}
                    className="border-line focus:border-primary h-8 w-full rounded-lg border bg-transparent px-2.5 pr-7 text-base outline-none sm:text-xs"
                  >
                    <option value="period">{t("fill.pace.period")}</option>
                    <option value="day">{t("fill.pace.day")}</option>
                  </select>
<span className="text-text-faint text-xs">{t("fill.pace.hint")}</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-text-dim text-xs font-bold">{t("fill.start")}</span>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      invalidate();
                    }}
                    className="border-line focus:border-primary h-8 w-full rounded-lg border bg-transparent px-2.5 text-base outline-none sm:text-xs"
                  />
                  <span className="text-text-faint text-xs">{t("fill.start.hint")}</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-text-dim text-xs font-bold">{t("fill.startNo")}</span>
                    <input
                      type="number"
                      min={1}
                      max={book?.sessionCount ?? 200}
                      value={startLessonNo}
                      onChange={(e) => {
                        setStartLessonNo(Math.max(1, Math.trunc(Number(e.target.value)) || 1));
                        invalidate();
                      }}
                      className="border-line focus:border-primary num h-8 w-full rounded-lg border bg-transparent px-2.5 text-base outline-none sm:text-xs"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-text-dim text-xs font-bold">{t("fill.term")}</span>
                    <select
                      value={termMode}
                      onChange={(e) => {
                        setTermMode(e.target.value as "regular" | "exam");
                        invalidate();
                      }}
                      className="border-line focus:border-primary h-8 w-full rounded-lg border bg-transparent px-2.5 pr-7 text-base outline-none sm:text-xs"
                    >
                      <option value="regular">{t("fill.term.regular")}</option>
                      <option value="exam">{t("fill.term.exam")}</option>
                    </select>
                  </label>
                </div>
              </div>

              {preview ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span>
                      {t("fill.count")} <b className="num">{willWrite}</b>
                    </span>
                    {noProgress > 0 ? (
                      <span className="text-text-dim" title={t("fill.noProgress.title")}>
                        {t("fill.noProgress")} <span className="num">{noProgress}</span>
                      </span>
                    ) : null}
                    {preview.skippedHolidays.length > 0 ? (
                      <span
                        className="text-text-dim"
                        title={preview.skippedHolidays.map((h) => `${h.date} ${h.name}`).join(" · ")}
                      >
                        {t("fill.holidaySkipped")} <span className="num">{preview.skippedHolidays.length}</span>
                      </span>
                    ) : null}
                    {preview.unplaced.length > 0 ? (
                      <span className="text-danger font-semibold" title={tf("fill.unit.lessons", { n: preview.unplaced.join(", ") })}>
                        {t("fill.unplaced")} <span className="num">{preview.unplaced.length}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="border-line-faint max-h-[38vh] overflow-y-auto rounded-lg border px-1">
                    <table className="w-full border-collapse text-xs">
                      <thead className="bg-background sticky top-0 z-10">
                        <tr className="text-text-dim text-xs">
                          <th className="py-1.5 text-center font-bold">{t("fill.col.lesson")}</th>
                          <th className="py-1.5 text-center font-bold">{t("fill.col.date")}</th>
                          <th className="py-1.5 text-center font-bold">{t("fill.col.period")}</th>
                          <th className="py-1.5 text-left font-bold">{t("fill.col.progress")}</th>
                          <th className="py-1.5 text-center font-bold">{t("fill.col.outcome")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const o = OUTCOME[r.outcome];
                          return (
                            <tr key={`${r.date}|${r.slotStart}|${i}`} className="border-line-faint border-b last:border-0">
                              <td className="num py-1 text-center font-bold">{r.lessonNo}</td>
                              <td className="num py-1 text-center">{dayLabel(r.date, lang)}</td>
                              <td className="num py-1 text-center">{r.periodLabel ?? r.slotStart}</td>
                              <td className="truncate py-1">{r.progress ?? <span className="text-text-faint">—</span>}</td>
                              <td className={`py-1 text-center font-semibold ${o.tone}`} title={t(o.title)}>
                                {t(o.label)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {/* 🔴 [미리보기] 버튼은 없앴다 — 미리보기는 스스로 돈다(위 effect). 남은 버튼은 [기입] 하나다. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={busy || !preview || willWrite === 0} onClick={() => void onApply()}>
                  {preview ? tf("fill.applyN", { n: willWrite }) : t("fill.apply")}
                </Button>
                {/* 버튼이 회색인 **이유**를 옆에 적는다 — 이유 없는 회색 버튼이 곧 "기입이 안 된다"였다. */}
                {calculating ? (
                  <span className="text-text-dim text-xs">{t("fill.preview.busy")}</span>
                ) : !canPreview ? (
                  <span className="text-text-dim text-xs">{t("fill.need")}</span>
                ) : nothingToWrite ? (
                  <span className="text-text-dim text-xs">{t("fill.none")}</span>
                ) : null}
                <Button type="button" variant="ghost" className="ml-auto" disabled={busy} onClick={onClose}>
                  {t("popup.close")}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
