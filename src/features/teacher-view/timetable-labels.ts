import type { SheetLang } from "./i18n";
import { classNameFor } from "./class-name";

/** Timetable interface labels only; saved names, notes and textbook titles remain untouched. */
export const TIMETABLE_EN: Readonly<Record<string, string>> = {
  "수업명": "Class", "담임": "Homeroom", "시간": "Time", "재원": "Enrolled", "대기": "Waiting", "퇴원": "Withdrawn",
  "LAB · 따로 수업(반 수정에서 켠 표식)": "LAB · Separate class (enabled in class settings)",
  "반이동": "Transferred", "실제 수업 시각": "Actual class time", "강사 인수인계 예정": "Teacher change scheduled",
  "강의실": "Room", "교재": "Textbook", "만 등원": " only", "신입": "New", "등원": "Attendance days", "자리": "Seat",
  "따로 수업(*LAB) 배정": "Assigned to a separate LAB class (*LAB)", "이동 예정": "Transfer scheduled", "퇴원일": "End date",
  "진도": "Progress", "시험": "Test", "숙제": "Homework", "이전 주": "Previous week", "다음 주": "Next week", "눌러서 이번 주로": "Go to this week",
  "시트 미등록": "No sheet linked", "아직 반영 안 함": "Not synced yet", "엑셀 내보내기": "Export Excel",
  "엑셀 내보내기·가져오기, 시트로 보내기·가져오기": "Export or import Excel and Google Sheets",
  "엑셀 내보내기·가져오기": "Export or import Excel", "엑셀 가져오기": "Import Excel", "영어 시트 반영": "Import English sheet",
  "시트로 보내기": "Send to Sheets", "상태 확인 실패": "Could not load status", "불러오는 중…": "Loading…",
  "시트 연동 상태를 불러오지 못했습니다 — 잠시 후 다시 열어 보세요.": "Could not load the sheet status. Please reopen this menu shortly.",
  "시트로": "To Sheets", "시트에서 가져오기": "Import from Sheets", "시트 열기": "Open sheet",
  "뷰 설정을 저장하지 못했습니다": "Could not save view settings", "전체 학년 보기로 저장했습니다": "View settings saved for all grades",
  "학제·학년으로 보이는 학생을 고른다 (내 계정에 저장)": "Filter students by school level and grade (saved to your account)",
  "뷰 설정": "View settings", "보이는 학년": "Visible grades", "전체": "All",
  "아무것도 고르지 않으면 전체 학년을 봅니다.": "Leave all grades unchecked to show every grade.",
  "학생 기준으로 걸러집니다. 학년이 섞인 반은 사라지지 않고 명단만 좁아집니다.": "Filters apply to students. Mixed-grade classes stay visible with matching students.",
  "표시": "Display", "바로 적용됩니다": "Changes apply immediately",
  "셀 안 학생 명단 표시/숨김 (숨기면 반 이름·강의실·인원만 남고 칸이 낮아진다)": "Show or hide student lists. Hiding them keeps class, room and count in shorter cells.",
  "학생 명단": "Student lists", "수업 없는 교시 행을 얇게 접기/펼치기 (편집 중엔 자동으로 펼쳐짐)": "Collapse empty periods (expanded automatically while editing)",
  "빈 교시 접기": "Collapse empty periods", "수업 없는 요일 컬럼 표시/숨김": "Show or hide days without classes", "미사용 요일": "Empty days",
  "취소": "Cancel", "저장 중…": "Saving…", "적용": "Apply", "개 수업": "classes", "상단 인원 집계는 전체 기준": "Header totals include all students",
  "검색 지우기": "Clear search", "영어 강사 시트": "English Class Sheet", "ECS 바로가기": "Open ECS", "여기로": "Move here", "반이동 예정": "Transfer scheduled",
  "과목": "Subject", "과목 선택": "Select subject", "구분": "Type", "정규·특강 구분": "Select class type", "프로그램": "Program", "영어 프로그램 필터": "Filter English program",
  "뷰": "View", "시간표 보기 방식": "Select timetable view", "기본뷰": "Standard", "통합뷰": "Integrated", "강사뷰": "Teachers", "교실뷰": "Rooms",
  "수학": "Math", "영어": "English", "국어": "Korean", "과학": "Science", "사회": "Social studies", "정규": "Regular", "특강": "Special", "보강": "Makeup",
  "인재원 영어": "Injaewon English", "수업 운영": "Classes", "시간표": "Timetable", "교실 사용 현황 지도": "Room availability", "검색": "Search",
  "유치": "Preschool", "초등": "Elementary", "중등": "Middle", "고등": "High",
  "내보내기는 정규 시간표 기준으로만 지원합니다 — 구분을 '정규'로 바꾼 뒤 사용하세요.": "Export is available for regular timetables. Select Regular first.",
  "시트 동기화가 진행 중입니다(자동 반영 또는 다른 관리자의 반영/가져오기) — 잠시 후 자동으로 풀립니다.": "Sheet synchronization is in progress. Please try again shortly.",
  "시트 연동을 켠 과목이 없습니다 — 학원 설정 › 연동에서 과목별 시트를 등록하고 켜세요.": "No subject has a linked sheet. Add a sheet in Academy settings > Integrations.",
  "‘시트 미등록’인 과목은 반영할 수 없습니다 — 학원 설정 › 연동에서 그 과목의 Google Sheets ID를 등록하세요.": "Link a Google Sheet for this subject in Academy settings > Integrations first.",
};

export function timetableText(lang: SheetLang, text: string): string {
  if (lang !== "en") return text;
  if (TIMETABLE_EN[text]) return TIMETABLE_EN[text];
  return text.replace(/([초중고])(\d)/g, (_, level: string, grade: string) => `${({ 초: "ES", 중: "MS", 고: "HS" } as Record<string, string>)[level]}${grade}`);
}

/** Only use for system-generated timetable notes, never teacher-entered content. */
export function timetableGeneratedNote(lang: SheetLang, text: string): string {
  if (lang !== "en") return text;
  const translated = text
    .replace(/이동 대기\(저장 전\)/g, "Transfer pending (unsaved)")
    .replace(/이동 대기/g, "Transfer scheduled")
    .replace(/(\d+)월 (\d+)일부터 /g, "From $1/$2: ")
    .replace(/ 반으로 이동합니다/g, " (transfer out)")
    .replace(/ 반으로 옵니다/g, " (transfer in)")
    .replace(/기존 반:/g, "Current class:")
    .replace(/'저장'을 눌러야 반영됩니다/g, "Select Save to apply")
    .replace(/지금 반/g, "current class").replace(/다른 반/g, "another class")
    .replace(/랩실/g, "LAB").replace(/자리 교시 고정/g, "Fixed seat period")
    .replace(/교시 고정/g, "fixed period")
    .replace(/[월화수목금토일]+(?=\s*\d{1,2}:)/g, (days) => [...days].map((day) =>
      ({ 월: "Mon", 화: "Tue", 수: "Wed", 목: "Thu", 금: "Fri", 토: "Sat", 일: "Sun" })[day as "월"]).join("/"));
  return classNameFor(translated, lang);
}
