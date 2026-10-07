import { getGradeLevel, getGradeNumber, isPreschoolGrade, schoolGradeLabel } from "@/lib/format/school-grade";
import type { SheetLang } from "./i18n";

// 화면에서 알아볼 수 있는 로마자 표기. 원본 학교명과 저장값은 바꾸지 않는다.
const INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWEL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const FINAL = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
const LEVEL: Record<string, string> = { 초: "ES", 중: "MS", 고: "HS" };

function romanize(value: string): string {
  return value.replace(/[가-힣]+/g, (word) => {
    const roman = [...word].map((char) => {
      const code = char.charCodeAt(0) - 0xac00;
      return INITIAL[Math.floor(code / 588)] + VOWEL[Math.floor((code % 588) / 28)] + FINAL[code % 28];
    }).join("");
    return roman.charAt(0).toUpperCase() + roman.slice(1);
  });
}

/** 영어 시트용 짧은 학교·학년: 침산초/초5 → Chimsan ES5. 한국어 표기는 공용 규약을 유지한다. */
export function sheetSchoolGrade(school: string | null | undefined, grade: string | null | undefined, lang: SheetLang): string {
  if (lang !== "en") return schoolGradeLabel(school, grade);
  let name = school?.trim() ?? "";
  const gradeText = grade?.trim() ?? "";
  if (isPreschoolGrade(gradeText)) {
    const age = gradeText.match(/^([3-7])세$/)?.[1];
    const label = age ? `Age ${age}` : "Preschool";
    return [name === gradeText ? "" : romanize(name.replace(/유치원$/, " Kindergarten")), label].filter(Boolean).join(" ");
  }
  name = name.replace(/초등학교$|초등$/, "초").replace(/여자중학교$/, "여중")
    .replace(/여자고등학교$/, "여고").replace(/중학교$/, "중").replace(/고등학교$/, "고");
  // 긴 공시명에만 붙은 지역 접두는 줄인다. '대구초'처럼 학교 이름 자체인 경우는 남긴다.
  if (/^대구.+(?:초|중|고)$/.test(name)) name = name.replace(/^대구(?:광역시)?/, "");
  const suffix = name.match(/(여?)(초|중|고)$/);
  const level = suffix?.[2] ?? getGradeLevel(gradeText);
  if (suffix) name = name.slice(0, -suffix[0].length);
  const gradeNumber = gradeText.match(/\d+/) ? getGradeNumber(gradeText) : "";
  const label = `${suffix?.[1] ? "Girls’ " : ""}${LEVEL[level] ?? ""}${gradeNumber}`;
  return [romanize(name), label || (gradeText ? romanize(gradeText) : "")].filter(Boolean).join(" ");
}
