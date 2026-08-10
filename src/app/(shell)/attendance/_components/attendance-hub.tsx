import Link from "next/link";
import { Pill } from "@/components/atoms/pill";
import type { PillColor } from "@/components/atoms/pill";
import { attHref } from "./att-href";

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
export function AttendanceHub({
  teachers,
  month,
  subjectId,
  colorOf,
  labelOf,
  todayLabel,
}: {
  teachers: HubTeacher[];
  month: string;
  subjectId: string | null;
  /** 과목 색·라벨 = 학원설정 단일 소스(buildSubjectMaps). 로컬 과목 맵 신설 금지. */
  colorOf: (key: string) => PillColor;
  labelOf: (key: string) => string;
  /** "8월 10일 (월)" — 서버에서 KST로 만든 표시 문자열. */
  todayLabel: string;
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
      <Link
        href={attHref({ classId: null, month, teacherId: t.id, subjectId, mode: "teacher" })}
        className={`hover:bg-bg-soft border-line flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${t.retired ? "opacity-60" : ""}`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-[13.5px] font-bold">{t.name}</span>
            {t.retired ? <span className="text-text-faint shrink-0 text-[11px]">(퇴직)</span> : null}
            {t.subjects.map((s) => (
              <Pill key={s} color={colorOf(s)}>
                {labelOf(s)}
              </Pill>
            ))}
          </span>
          <span className="text-text-dim block text-[11.5px]">
            <span className="num">{t.classCount}</span>개 반
            {t.today ? (
              <>
                {" · 오늘 "}
                {/* 기록/예정 — 오늘 수업이 있는 반의 학생 기준. 다 채워지면 초록. */}
                <span className={`num font-bold ${t.today.recorded >= t.today.expected ? "text-emerald-700" : "text-amber-700"}`}>
                  {t.today.recorded}/{t.today.expected}명
                </span>
                {" 입력"}
              </>
            ) : null}
          </span>
        </span>
        <span className="bg-primary-soft text-primary rounded-pill ml-auto shrink-0 px-2.5 py-1 text-[11px] font-bold">
          출석부 열기
        </span>
      </Link>
    </li>
  );

  return (
    <section className="min-h-0 flex-1 overflow-auto">
      <div className="bg-card shadow-card rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-foreground text-[14px] font-bold">출석부 요약</p>
          {/* 오늘 입력 현황 한 줄 — "요약 화면"의 핵심 숫자. 오늘 수업이 없으면(일요일 등) 조용히 생략. */}
          {todayTotal.classes > 0 ? (
            <p className="text-text-dim text-[12.5px]">
              {todayLabel} — 수업 <span className="num font-bold">{todayTotal.classes}</span>개 반 · 출결 입력{" "}
              <span className="num font-bold">{todayTotal.recorded}</span>/<span className="num">{todayTotal.expected}</span>명 · 완료{" "}
              <span className="num font-bold">{todayTotal.done}</span>개 반
            </p>
          ) : (
            <p className="text-text-faint text-[12.5px]">{todayLabel} — 오늘 예정된 수업이 없습니다</p>
          )}
        </div>
        <p className="text-text-faint mt-0.5 text-[12px]">
          강사를 고르면 그 강사의 모든 반이 한 표로 열립니다 · 개별 반은 위 &lsquo;반&rsquo; 목록에서 검색
        </p>

        {teachers.length === 0 ? (
          <p className="text-text-dim mt-4 text-[12.5px]">담임이 배정된 운영 중인 반이 없습니다.</p>
        ) : (
          <>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{active.map(row)}</ul>
            {retired.length > 0 ? (
              <>
                {/* 퇴직 강사도 지난달 급여·기록 조회가 실제 용무라 숨기지 않는다 — 뒤로 밀고 흐리게만. */}
                <p className="micro mt-4">퇴직</p>
                <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{retired.map(row)}</ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
