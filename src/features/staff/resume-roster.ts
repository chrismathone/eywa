// 직원 이력서 → "신규 직원명부" 구글시트 한 행 변환 — 순수 함수(Vitest 대상, IO는
// server/resume-roster-sheet.ts). 시트 = "2020~2026 직원명부" 스프레드시트의 연도 탭.

import type { ResumeEducation, StaffResumeData } from "./resume";

/**
 * 대상 탭 헤더(A~T 순서). 시트 쪽 열이 바뀌면 여기와 [buildRosterRow]를 **함께** 고칠 것 —
 * 순서가 어긋나면 주민번호가 전화번호 열에 들어가는 식으로 조용히 밀린다.
 * ⚠️ A열(No.)은 시트의 ARRAYFORMULA가 자동 채번 — 앱은 첫 칸을 버리고 **B열부터** 기입한다
 *    (resume-roster-sheet.ts). 여기 배열은 시트 열 대조표로 A열 포함 전체를 유지.
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
  // "계약조건 history" 열은 원장이 2026-07-17 시트에서 삭제(이력은 2026직원히스토리 탭으로 이관) —
  // 앱이 옛 20열로 기입해 학력이 은행 열로 밀렸던 실사고의 원인. 시트 열과 항상 동기화할 것.
  "학력",
  "은행",
  "계좌번호",
  "아동학대&성범죄조회일",
  "경력증명서제출",
  "담당자", // T열 — 원장이 2026-07-17 추가, 폼 '담당자'(contract.manager) 배선
] as const;

/**
 * 명부 기입 위치 = 헤더(1행) 바로 아래의 **첫 빈 행**(1-based 행 번호 반환).
 * values.append는 "탭의 마지막 채워진 행 다음"에 붙어서, 탭 중간에 있는 안내/샘플 블록(12행 등)
 * **아래**로 밀려 적혔다(2026-07-16 원장 제보 "밑에 적히는데 위에 적혀야") — 그래서 append 대신
 * 위에서부터 빈 자리를 찾아 그 행에 update한다. 공백만 있는 셀은 빈 것으로 본다.
 */
export function firstEmptyRowIndex(rows: string[][], headerRows = 1): number {
  for (let i = headerRows; ; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c.trim() === "")) return i + 1; // 배열 index → 1-based 행 번호
  }
}

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
    eduLabel, // 학력 — 최상위 1건만
    d.contract.bank, // 은행
    d.contract.account, // 계좌번호
    "", // ②아동학대&성범죄조회일
    "", // ③경력증명서제출
    d.contract.manager, // 담당자
  ];
}
