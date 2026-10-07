import { SHEET_DICT, type SheetLang } from "./i18n";

const englishByKorean = new Map<string, string>(Object.values(SHEET_DICT).map((v) => [v.ko, v.en]));

/** The copy result is a generated count summary, not a user-entered note. */
export function sheetCarrySummary(lang: SheetLang, summary: string): string {
  if (lang === "ko") return summary;
  return summary.replace(/듣기 레벨/g, "Listening level").replace(/누적 암기 단어수/g, "Vocabulary total").replace(/(\d+)명/g, "$1 students");
}

/** Legacy server actions return Korean prose. Translate feedback at the teacher-view boundary. */
export function sheetFeedback(lang: SheetLang, message: string): string {
  if (lang === "ko") return message;
  const known = englishByKorean.get(message);
  if (known) return known;
  if (!/[가-힣]/.test(message)) return message;
  if (/로그인/.test(message)) return "Please sign in again and retry.";
  if (/담당 반이 아닙니다/.test(message)) return "You can only edit classes assigned to you.";
  if (/권한|읽기 전용|읽기전용/.test(message)) return "You do not have permission to make this change.";
  if (/사유·시수|사유.*시수/.test(message)) return "This attendance record has a reason or lesson units. Edit it in the attendance register.";
  if (/수정.*기간|입력.*기간|일.*지나|일.*이전|미래.*출결/.test(message)) return "This date is outside the attendance editing period. Check the date or use the attendance register.";
  if (/충돌|다른.*바뀌|다른.*변경/.test(message)) return "This record was changed elsewhere. Refresh and try again.";
  if (/찾을 수 없|찾지 못|삭제된|삭제되었/.test(message)) return "This record is no longer available. Refresh and try again.";
  if (/자 이내|너무 깁니다/.test(message)) {
    const limit = /(\d+)자/.exec(message)?.[1];
    return limit ? `Enter no more than ${limit} characters.` : "The input is too long. Shorten it and try again.";
  }
  if (/잘못된|올바르지|유효하지/.test(message)) return "Check the entered values and try again.";
  if (/준비 중|아직 준비/.test(message)) return "This field is not available yet. Please contact your administrator.";
  if (/듣기 레벨|누적 암기/.test(message)) return "Listening level and vocabulary totals could not be copied. Check the values and try again.";
  if (/불러오|조회|확인에 실패/.test(message)) return "The information could not be loaded. Please try again.";
  // Unmapped database messages must not leak Korean or implementation details in the English UI.
  return "The action could not be completed. Refresh to check the result, then try again.";
}
