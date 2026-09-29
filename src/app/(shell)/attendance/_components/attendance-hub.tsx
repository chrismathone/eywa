// 창 안 이동은 처음부터 embed를 싣는다(EmbedLink) — 맨 Link면 창 주소 되붙이기(EmbedUrlKeeper)에 기대게 되고,
// 그 뒤 첫 새로고침이 라우터 트리와 어긋나 한 번 더 받는다(전수검사 리뷰 2026-09-11).
import type { ReactNode } from "react";
import { EmbedLink } from "@/components/embed-link";
import { Pill } from "@/components/atoms/pill";
import type { PillColor } from "@/components/atoms/pill";
import { attHref } from "./att-href";
// 화면 언어는 **페이지가 정해 넘긴다**(같은 요청에서 두 번 판정하지 않는다).
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/** 요약 허브의 강사 한 줄 — 서버(page.tsx)가 조립한다. */
export type HubTeacher = {
  id: string;
  name: string;
  retired: boolean;
  classCount: number;
  /** 담당 반에서 도출한 과목 키(학원설정 순서) — Pill 라벨·색은 colorOf/labelOf 단일 소스. */
  subjects: string[];
  /** 오늘 수업이 있는 반의 입력 현황. null = 오늘 수업 없음. */
  today: { classes: number; doneClasses: number; expected: number; recorded: number } | null;
};

/**
 * 출석부 진입 허브 = **요약 화면**(원장 2026-08-10: "그냥 출석부 요약 화면이면 좋을듯").
 *
 * 옛 허브는 사진 카드 + 반 무작위 나열("바로 열기 110개 반")이라 정보가 없었다 — 반 목록은 툴바의
 * 반 드롭다운(검색형)이 이미 맡고 있어 중복이기도 했다. 여기선 실제 동선을 그대로 싣는다:
 * **강사를 고르면 그 강사의 전체 출석부**(기본 보기 = 강사 전체, resolveViewMode) + 오늘 입력 현황.
 *
 * ⚠️ 무거운 출석 데이터(매트릭스)는 여전히 안 불러온다 — 오늘 처리 현황(getDailyProcessingStatus)은
 *    하루치 경량 집계라 허브 진입 비용으로 감수한다.
 */
/** 자리(랩실·JJ실) 한 칸 — 사람이 아니라 방이라 강사 카드와 같은 줄에 섞지 않고 아래 묶음으로 둔다. */
export type HubSeat = { key: string; name: string; room: string; href: string; monthHref: string; open: boolean };

export function AttendanceHub({
  teachers,
  seats,
  month,
  subjectId,
  colorOf,
  labelOf,
  todayLabel,
  lang,
  tools,
}: {
  teachers: HubTeacher[];
  /** 강사 목록과 퇴직 사이에 놓이는 자리 묶음(원장 2026-08-14: 선생님 / LAB·JJ / 퇴직 순). */
  seats: HubSeat[];
  month: string;
  subjectId: string | null;
  /** 과목 색·라벨 = 학원설정 단일 소스(buildSubjectMaps). 로컬 과목 맵 신설 금지. */
  colorOf: (key: string) => PillColor;
  labelOf: (key: string) => string;
  /** "8월 10일 (월)" — 서버에서 KST로 만든 표시 문자열(언어도 서버가 맞춰 준다). */
  todayLabel: string;
  /** 강사 미니셸이면 영어. 관리자 풀셸은 언제나 한국어(페이지가 판정). */
  lang: SheetLang;
  /** 시수 마스터·결석 통보 접수. 요약 줄 오른쪽 — 툴바에 두면 빈 둘째 줄이 된다. */
  tools?: ReactNode;
}) {
  const active = teachers.filter((t) => !t.retired);
  const retired = teachers.filter((t) => t.retired);
  const todayTotal = teachers.reduce(
    (a, t) => ({
      classes: a.classes + (t.today?.classes ?? 0),
      done: a.done + (t.today?.doneClasses ?? 0),
      expected: a.expected + (t.today?.expected ?? 0),
      recorded: a.recorded + (t.today?.recorded ?? 0),
    }),
    { classes: 0, done: 0, expected: 0, recorded: 0 },
  );

  const row = (t: HubTeacher) => (
    <li key={t.id}>
      <EmbedLink
        href={attHref({ classId: null, month, teacherId: t.id, subjectId, mode: "teacher" })}
        className={`hover:bg-bg-soft border-line flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${t.retired ? "opacity-60" : ""}`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-bold">{t.name}</span>
            {t.retired ? (
              <span className="text-text-faint shrink-0 text-xs">{sheetT(lang, "att.hub.retired")}</span>
            ) : null}
            {t.subjects.map((s) => (
              <Pill key={s} color={colorOf(s)}>
                {labelOf(s)}
              </Pill>
            ))}
          </span>
          <span className="text-text-dim block text-xs">
            <span className="num">{t.classCount}</span>
            {sheetT(lang, "att.hub.classesSuffix")}
            {t.today ? (
              <>
                {sheetT(lang, "att.hub.todayPre")}
                {/* 기록/예정 — 오늘 수업이 있는 반의 학생 기준. 다 채워지면 초록. */}
                <span className={`num font-bold ${t.today.recorded >= t.today.expected ? "text-green" : "text-amber"}`}>
                  {t.today.recorded}/{t.today.expected}
                </span>
                {sheetT(lang, "att.hub.todayPost")}
              </>
            ) : null}
          </span>
        </span>
        <span className="bg-primary-soft text-primary rounded-pill ml-auto shrink-0 px-2.5 py-1 text-xs font-bold">
          {sheetT(lang, "att.hub.open")}
        </span>
      </EmbedLink>
    </li>
  );

  return (
    <section className="min-h-0 flex-1 overflow-auto">
      <div className="bg-card shadow-card rounded-2xl px-5 pt-2 pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* flex-1로 제목을 줄이면 좁은 화면에서 '출석부 요약'이 글자 단위로 꺾인다. 폭이 부족하면 버튼만 다음 줄로. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-foreground shrink-0 text-sm font-bold">{sheetT(lang, "att.hub.title")}</p>
            {/* 오늘 입력 현황 한 줄 — "요약 화면"의 핵심 숫자. 오늘 수업이 없으면(일요일 등) 조용히 생략. */}
            {todayTotal.classes > 0 ? (
              <p className="text-text-dim text-xs">
                {sheetTf(lang, "att.hub.today.a", { date: todayLabel })}
                <span className="num font-bold">{todayTotal.classes}</span>
                {sheetT(lang, "att.hub.today.b")}
                <span className="num font-bold">{todayTotal.recorded}</span>/
                <span className="num">{todayTotal.expected}</span>
                {sheetT(lang, "att.hub.today.c")}
                <span className="num font-bold">{todayTotal.done}</span>
                {sheetT(lang, "att.hub.today.d")}
              </p>
            ) : (
              <p className="text-text-faint text-xs">
                {sheetTf(lang, "att.hub.noClasses", { date: todayLabel })}
              </p>
            )}
          </div>
          {tools ? <div className="ml-auto flex shrink-0 items-center gap-2">{tools}</div> : null}
        </div>
        <p className="text-text-faint mt-0.5 text-xs">{sheetT(lang, "att.hub.hint")}</p>

        {seats.length > 0 ? (
          <>
            {/* 맨 위(원장 2026-09-29 *"랩실과 JJ실 출석부를 최상단으로"*) — 매일 여는 자리라 강사 목록 아래에 묻히지 않게.
                자리 = 여러 반이 동시에 들어오는 방. 담임이 없어 강사 줄에 섞으면 사람으로 오해한다. */}
            <p className="micro mt-4">{sheetT(lang, "att.hub.seats")}</p>
            <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {seats.map((s) => (
                <li key={s.key}>
                  <div
                    className={`border-line flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${s.open ? "" : "opacity-60"}`}
                  >
                    <EmbedLink href={s.href} className="hover:bg-bg-soft min-w-0 flex-1 rounded-lg">
                      <span className="text-foreground block truncate text-sm font-bold">
                        {s.name} <span className="text-text-faint font-medium">{s.room}</span>
                      </span>
                      <span className="text-text-dim block text-xs">
                        {sheetT(lang, s.open ? "att.hub.seatOpen" : "att.hub.seatClosed")}
                      </span>
                    </EmbedLink>
                    <EmbedLink
                      href={s.monthHref}
                      className="bg-bg-soft text-text-dim hover:text-foreground rounded-pill shrink-0 px-2.5 py-1 text-xs font-bold"
                    >
                      {sheetT(lang, "att.hub.monthly")}
                    </EmbedLink>
                    <EmbedLink
                      href={s.href}
                      className={`rounded-pill shrink-0 px-2.5 py-1 text-xs font-bold ${
                        s.open ? "bg-primary-soft text-primary" : "bg-bg-soft text-text-faint"
                      }`}
                    >
                      {sheetT(lang, s.open ? "att.hub.day" : "att.hub.prep")}
                    </EmbedLink>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {teachers.length === 0 ? (
          <p className="text-text-dim mt-4 text-xs">{sheetT(lang, "att.hub.noHomeroom")}</p>
        ) : (
          <>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{active.map(row)}</ul>
            {retired.length > 0 ? (
              <>
                {/* 퇴직 강사도 지난달 급여·기록 조회가 실제 용무라 숨기지 않는다 — 뒤로 밀고 흐리게만. */}
                <p className="micro mt-4">{sheetT(lang, "att.retired")}</p>
                <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{retired.map(row)}</ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
