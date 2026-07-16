// 직원 이력서 → "신규 직원명부" 구글시트 한 행 변환 — 순수 함수(Vitest 대상, IO는
// server/resume-roster-sheet.ts). 시트 = "2020~2026 직원명부" 스프레드시트의 연도 탭.

import type { ResumeEducation, StaffResumeData } from "./resume";

/**
 * 대상 탭 헤더(A~T 순서). 시트 쪽 열이 바뀌면 여기와 [buildRosterRow]를 **함께** 고칠 것 —
 * 순서가 어긋나면 주민번호가 전화번호 열에 들어가는 식으로 조용히 밀린다.
 */
export const ROSTER_COLUMNS = [
  "No.",
  "회사명",
  "소속부서",
  "이름",
  "계약구분",
  "직급",
  "입사일",
  "구글 메일 주소",
  "주민번호",
  "전화번호",
  "현재 계약",
  "계약조건",
  "재직",
  "계약갱신일/퇴사일",
  "계약조건 history",
  "학력",
  "은행",
  "계좌번호",
  "아동학대&성범죄조회일",
  "경력증명서제출",
] as const;

/** 학력사항 중 가장 상위(맨 위) 실입력 1건 — 시트엔 최상위 학력만 기입한다(원장 요청). */
export function topEducation(d: StaffResumeData): ResumeEducation | null {
  return d.education.find((e) => e.school.trim() !== "") ?? null;
}

/**
 * 이력서 → 명부 한 행(A~T, 20칸). 이력서 서식에 없는 열(No.·직급·현재 계약·재직·history·
 * 제출서류 체크)은 빈 칸으로 두고 시트에서 수기 관리한다.
 */
export function buildRosterRow(d: StaffResumeData): string[] {
  const edu = topEducation(d);
  // 기존 명부 표기(예: "영남대 \n경제학/경영학")를 따라 학교명 줄바꿈 전공.
  const eduLabel = edu ? [edu.school.trim(), edu.major.trim()].filter(Boolean).join("\n") : "";
  const salary = [
    d.contract.salaryMonthly && `월급 ${d.contract.salaryMonthly}`,
    d.contract.salaryAnnual && `연봉 ${d.contract.salaryAnnual}`,
  ]
    .filter(Boolean)
    .join(" / ");
  return [
    "", // No.
    d.contract.company, // 회사명 = 폼 '회사 구분'
    d.contract.division, // 소속부서
    d.personal.name,
    d.contract.employmentType, // 계약구분
    "", // 직급
    d.contract.startDate, // 입사일
    d.personal.email, // 구글 메일 주소
    d.personal.residentId, // 주민번호
    d.personal.phone, // 전화번호
    "", // 현재 계약
    salary, // 계약조건 — 급여 계약(월급/연봉)
    "", // 재직
    "", // 계약갱신일/퇴사일
    "", // 계약조건 history
    eduLabel, // 학력 — 최상위 1건만
    d.contract.bank, // 은행
    d.contract.account, // 계좌번호
    "", // ②아동학대&성범죄조회일
    "", // ③경력증명서제출
  ];
}
