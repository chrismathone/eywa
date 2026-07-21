import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";

/**
 * 원스크린 로스터에 이 수강(행)을 띄울지 — 순수 판정.
 *
 * ⚠️ 옛 로스터는 날짜창(start≤date≤end)만 보고 **분리등원(attendance_days)·휴원(on_hold)을 무시**했다.
 * 그래서 월/목 반에 "월요일만" 등원하는 학생이 목요일 강사 화면에도 떴다(2026-07-21 원장 제보,
 * 실측 injaewon: 화 7명·목 9명·월 7명·금 5명이 안 오는 날 노출). 출석부(`attendance/server/queries.ts`)·
 * 대시보드 액션신호·작성률 분모는 이미 [`eligibility`](src/features/enrollments/eligibility.ts) 단일
 * 소스를 쓰고 있어, 강사 화면만 더 넓게 보여주며 서로 어긋나 있었다 → 같은 규약으로 통일한다.
 *
 * `dayFiltered`는 "반 목록이 그 요일 수업으로 좁혀졌는가". 주말·휴일엔 그 요일 수업이 하나도 없어
 * 로스터가 **담당 반 전체 폴백**으로 뜨는데(화면이 비지 않게), 그땐 요일 조건을 걸면 분리등원 학생이
 * 통째로 사라진다 → 폴백일 땐 요일 판정을 건너뛴다.
 *
 * 보강으로 다른 요일에 온 학생은 상단 '+ 보강 학생 추가'로 넣는다(학원 전체 검색) — 숨겨도 막다른 길 아님.
 */
export function rosterIncludesEnrollment(
  enrollment: {
    start_date: string | null;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  },
  date: string,
  dayKey: string,
  dayFiltered: boolean,
): boolean {
  if (
    !isEnrollmentActiveOn(
      {
        startDate: enrollment.start_date ?? "",
        endDate: enrollment.end_date,
        onHold: enrollment.on_hold === true,
        isTransferred: enrollment.is_transferred === true,
      },
      date,
    )
  ) {
    return false;
  }
  return dayFiltered ? enrollmentAttendsOnDay(enrollment.attendance_days, dayKey) : true;
}
