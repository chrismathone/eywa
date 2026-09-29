/**
 * 엑셀 가져오기 목록 — 화면(창·탭 버튼·학원 설정 '데이터 가져오기')과 서버 레지스트리가 함께 읽는 **이름표**(순수).
 * 🔑 새 가져오기를 더할 때: ① 여기에 한 줄 ② `server/registry.ts`에 한 줄 ③ 그 탭 툴바에 `<ExcelImportButton kind>`.
 *    가드 `kinds.test.ts`가 ①②가 어긋나면 잡는다.
 */
import type { ExcelMode } from "./spec";

export const IMPORT_KINDS = [
  "students",
  "staff",
  "classrooms",
  "classes",
  "enrollment-consultations",
  "student-consultations",
  "attendance",
  "invoices",
  "expenses",
  "textbooks",
  "calendar",
  "shuttle",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export function isImportKind(v: string): v is ImportKind {
  return (IMPORT_KINDS as readonly string[]).includes(v);
}

export type ImportMeta = {
  title: string;
  /** 어느 탭(메뉴)에서 여는가 — 학원 설정 허브의 설명·순서에 쓴다. */
  where: string;
  /** 서식에 무엇이 들었나(창 1번 칸). */
  templateNote: string;
  keyHint: string;
  modeHelp: Record<ExcelMode, string>;
  /** 학원 도입 순서(허브 정렬) — 앞 단계가 있어야 뒤가 연결된다(반 → 반 배정 등). */
  step: number;
};

export const IMPORT_META: Record<ImportKind, ImportMeta> = {
  staff: {
    title: "직원",
    where: "직원관리",
    templateNote: "시트: 직원 · 안내. 지금 직원이 들어 있습니다. 새 직원은 로그인 이메일로 계정이 만들어집니다(비밀번호는 올린 뒤 직원관리에서 '비밀번호 재설정'으로 발급).",
    keyHint: "로그인 이메일",
    modeHelp: { append: "이미 있는 이메일은 건너뛰고 새 직원만 계정을 만듭니다", overwrite: "있는 직원은 담당과목·영어 닉네임·메모를 바꾸고 이력서 칸(연락처·직급 등)은 비어 있을 때만 채웁니다. 이름·역할은 바꾸지 않습니다. 새 직원은 계정을 만듭니다" },
    step: 1,
  },
  classrooms: {
    title: "강의실",
    where: "학원 설정 › 운영 체계",
    templateNote: "시트: 강의실 · 안내. 지금 강의실이 들어 있습니다.",
    keyHint: "강의실 이름",
    modeHelp: { append: "이미 있는 이름은 건너뛰고 새 강의실만", overwrite: "있는 강의실은 정원을 파일 값으로 바꾸고 새 강의실도 넣기" },
    step: 2,
  },
  classes: {
    title: "반",
    where: "수업목록",
    templateNote: "시트: 반 · 시간표 · 반배정 · 안내. 필요한 시트만 채워도 됩니다(반 → 시간표 → 반배정 순서로 연결).",
    keyHint: "반 이름 + 과목 / 시간표 = 반·요일·시작 시각 / 반배정 = 원생(이름·학교·학년) + 반",
    modeHelp: {
      append: "이미 있는 반·수업 시각·반 배정은 건너뛰고 새것만",
      overwrite: "있는 반은 담당·강의실 등을 바꾸고, 시간표가 적힌 반은 적용 시작일부터 파일의 시간표로 바꿉니다(이전 기록은 보존)",
    },
    step: 4,
  },
  students: {
    title: "원생",
    where: "원생목록",
    templateNote: "시트: 원생 · 안내. 지금 원생이 들어 있습니다(퇴원생 제외).",
    keyHint: "원생번호(적었으면) → 없으면 이름 + 학교 + 학년",
    modeHelp: { append: "이미 있는 원생은 건너뛰고 새 원생만", overwrite: "있는 원생은 파일에 적힌 칸을 바꾸고(빈 칸은 그대로) 새 원생도 넣기" },
    step: 3,
  },
  "enrollment-consultations": {
    title: "콜&상담",
    where: "콜&상담",
    templateNote: "시트: 상담 · 안내. 빈 서식입니다(과거 상담 기록을 옮길 때).",
    keyHint: "상담일 + 학생 이름 + 보호자 연락처",
    modeHelp: { append: "같은 날 같은 학생·연락처 상담은 건너뛰고 새것만", overwrite: "같은 상담은 파일 값으로 바꾸고 새것도 넣기" },
    step: 5,
  },
  "student-consultations": {
    title: "원생상담",
    where: "원생상담",
    templateNote: "시트: 상담 · 안내. 빈 서식입니다(과거 상담 기록을 옮길 때). 원생은 이미 등록돼 있어야 합니다.",
    keyHint: "원생(이름·학교·학년) + 상담일 + 상담 내용 앞부분",
    modeHelp: { append: "같은 원생·같은 날·같은 내용은 건너뛰고 새것만", overwrite: "같은 상담은 분류·대상·과목·상담자·조치·후속일을 파일 값으로 바꾸고 새것도 넣기(내용은 그대로)" },
    step: 6,
  },
  attendance: {
    title: "출결",
    where: "출석부",
    templateNote: "시트: 출결 · 안내. 빈 서식입니다(과거 출결을 옮길 때). 원생·반·반 배정이 먼저 있어야 합니다.",
    keyHint: "원생 + 반 + 수업일(+ 시작시각)",
    modeHelp: { append: "이미 출결이 찍힌 칸은 건너뛰고 빈 칸만 채웁니다", overwrite: "이미 찍힌 칸도 파일 값으로 고칩니다(보강은 화면에서만)" },
    step: 7,
  },
  invoices: {
    title: "수납",
    where: "수납관리",
    templateNote: "시트: 수납 · 안내. 빈 서식입니다(전환일 청구·납부 현황을 옮길 때). 원생이 먼저 있어야 합니다.",
    keyHint: "원생 + 청구월",
    modeHelp: { append: "그 달 청구서가 이미 있는 원생은 건너뛰고 새것만", overwrite: "그 달 청구서가 있으면 금액·납부를 파일 값으로 바꾸고 새것도 넣기" },
    step: 8,
  },
  expenses: {
    title: "지출",
    where: "수납관리 · 지출",
    templateNote: "시트: 지출 · 안내. 빈 서식입니다(과거 지출 내역을 옮길 때).",
    keyHint: "지출일 + 항목 + 금액",
    modeHelp: { append: "같은 날·같은 항목·같은 금액은 건너뛰고 새것만", overwrite: "같은 지출은 분류·거래처·메모를 파일 값으로 바꾸고 새것도 넣기" },
    step: 9,
  },
  textbooks: {
    title: "교재",
    where: "교재목록",
    templateNote: "시트: 교재 · 안내. 지금 교재가 들어 있습니다.",
    keyHint: "교재 이름 + 과목",
    modeHelp: { append: "이미 있는 교재는 건너뛰고 새것만", overwrite: "있는 교재는 가격·출판사 등을 파일 값으로 바꾸고 새것도 넣기" },
    step: 10,
  },
  calendar: {
    title: "일정",
    where: "캘린더",
    templateNote: "시트: 일정 · 안내. 빈 서식입니다(연간 일정·휴원·행사를 옮길 때).",
    keyHint: "시작일 + 제목",
    modeHelp: { append: "같은 날 같은 제목은 건너뛰고 새것만", overwrite: "같은 일정은 종료일·메모를 파일 값으로 바꾸고 새것도 넣기" },
    step: 11,
  },
  shuttle: {
    title: "셔틀",
    where: "셔틀",
    templateNote: "시트: 정류장 · 승하차 · 안내. 지금 정류장과 승하차 배정이 들어 있습니다(차량·회차·노선은 셔틀 편성 화면에서 먼저).",
    keyHint: "정류장 = 정류장 이름 / 승하차 = 원생 + 차량·회차의 정류장 + 승차·하차",
    modeHelp: { append: "이미 있는 정류장·배정은 건너뛰고 새것만", overwrite: "있는 정류장은 주소·좌표·메모를, 있는 배정은 요일·메모를 파일 값으로 바꾸고 새것도 넣기" },
    step: 12,
  },
};
