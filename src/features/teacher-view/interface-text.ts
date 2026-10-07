import { SHEET_DICT, type SheetLang } from "./i18n";
import { timetableText } from "./timetable-labels";
import { INTERFACE_EN } from "./interface-extra";
import { classNameFor } from "./class-name";
import type { SubjectMaps } from "@/features/owner/subjects";

const knownText = new Map<string, string>(Object.values(SHEET_DICT).map(({ ko, en }) => [ko, en]));
const EXTRA_EN: Readonly<Record<string, string>> = {
  "검색": "Search", "검색어를 입력하세요": "Type to search", "검색...": "Search...", "선택...": "Choose...",
  "(선택지에 없는 값)": "(Unavailable option)", "빠른 보기": "Quick view",
  "상세 전체보기": "Open full details", "요약을 불러오지 못했습니다.": "Could not load the summary.",
  "출석률 (30일)": "Attendance rate (30 days)", "활성 수강 없음": "No active classes",
  "완납": "Paid", "학생": "Student", "원생목록으로": "Back to students", "학번": "Student ID",
  "담당 학생만 열람할 수 있어요": "You can only view your assigned students",
  "이 학생은 내 반(담임·교시 담당·임시 위임) 수강생이 아니거나, 수강이 끝난 지 오래됐어요.": "This student is outside your homeroom, teaching or cover assignments, or their enrollment ended too long ago.",
  "열람이 필요하면 데스크(관리자)에 요청해 주세요.": "Ask the front desk if you need access.",
  "수학(심화)": "Advanced Math", "예술": "Arts", "역사": "History", "한국사": "Korean History",
  "미술": "Art", "음악": "Music", "체육": "PE", "논술": "Essay Writing", "독서": "Reading",
  "물리": "Physics", "화학": "Chemistry", "생물": "Biology", "지구과학": "Earth Science",
  "코딩": "Coding", "컴퓨터": "Computing", "기타": "Other",
};

/** Fixed interface copy only. Names, textbooks and user-entered notes have their own display rules. */
export function sheetUiText(lang: SheetLang, text: string): string {
  if (lang !== "en") return text;
  const core = text.trim();
  const translated = EXTRA_EN[core] ?? INTERFACE_EN[core] ??
    (timetableText(lang, core) !== core ? timetableText(lang, core) : knownText.get(core));
  if (translated !== undefined) return text.slice(0, text.indexOf(core)) + translated + text.slice(text.indexOf(core) + core.length);
  const regular = /^(.+) 학생은 오늘 (.+) 정규 수업이 있습니다\.$/.exec(text);
  if (regular) return `${regular[1]} has regular lessons today: ${classNameFor(regular[2], lang)}.`;
  const makeup = /^(.+) 학생의 보강입니다 — 오늘 이 선생님의 정규 수업은 없습니다\.$/.exec(text);
  if (makeup) return `Makeup for ${makeup[1]} — this teacher has no regular class today.`;
  const counts = /^(총 |연체 |최근 30일 )?(\d+)(명|건|개|회)$/.exec(core);
  if (counts) return `${counts[1] === "총 " ? "Total " : counts[1] === "연체 " ? "Overdue " : counts[1] ? "Last 30 days: " : ""}${counts[2]}${({ 명: " students", 건: " entries", 개: " items", 회: " sessions" } as Record<string, string>)[counts[3]]}`;
  return text.replace(/ 필터$/, " filter").replace(/^(\d+)교시$/, "Period $1");
}

/** Localizes labels while retaining the configured subjects, values, order and colors. */
export function localizeSubjectMaps(subjects: SubjectMaps, lang: SheetLang): SubjectMaps {
  if (lang !== "en") return subjects;
  return {
    ...subjects,
    labelOf: (key) => sheetUiText(lang, subjects.labelOf(key)),
    options: subjects.options.map((option) => ({ ...option, label: sheetUiText(lang, option.label) })),
    filters: subjects.filters.map((option) => ({ ...option, label: sheetUiText(lang, option.label) })),
  };
}
