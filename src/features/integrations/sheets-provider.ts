// 과목별 구글시트 내보내기 — provider 키 매핑 + 지원 과목 단일 소스. 순수(클라/서버 공용, server-only 금지).
// user_integrations는 (tenant_id, provider) 유니크라 과목마다 별도 행으로 대상 시트·토글·동기화상태를 갖는다.
// ⚠️ 수학·영어 시트는 **전체 덮어쓰기**라 서로 다른 파일이어야 함(한 시트 공유 금지) → 과목별 provider로 분리.

/** 시트 내보내기가 지원되는 과목(전용 익스포터 존재). 이 목록만 owner 설정·시트 반영에 노출. */
export const SHEET_EXPORT_SUBJECTS = ["math", "english"] as const;
export type SheetExportSubject = (typeof SHEET_EXPORT_SUBJECTS)[number];

export function isSheetExportSubject(key: string): key is SheetExportSubject {
  return (SHEET_EXPORT_SUBJECTS as readonly string[]).includes(key);
}

/**
 * 과목 → `user_integrations.provider` 키.
 * math는 레거시 `"google_sheets"` 보존(기존 수학 연동 행·notifications.googleSheetId 폴백을 안 깨뜨림).
 * 그 외(영어 등)는 `"google_sheets:<subject>"` 별도 행.
 */
export function sheetsProvider(subject: string): string {
  return subject === "math" ? "google_sheets" : `google_sheets:${subject}`;
}

/** provider 키 → 과목(sheetsProvider 역방향, cron이 user_integrations 행에서 과목 복원). 미지원 키 = null. */
export function subjectFromProvider(provider: string): SheetExportSubject | null {
  if (provider === "google_sheets") return "math";
  const m = provider.match(/^google_sheets:(.+)$/);
  return m && isSheetExportSubject(m[1]!) ? (m[1] as SheetExportSubject) : null;
}

/**
 * 시간표 '가져오기'(수강편집 라운드트립 = 시트/파일 → 앱 반 배정 되읽기 = **학생 반이동**) 지원 과목.
 * math·english 둘 다 '수강편집' 탭을 export(과목별 스코프)하므로 라운드트립이 닫힌다.
 * (영어의 '구조 가져오기'=강사별 그리드→class_schedules는 supportsStructureImport 별개.)
 */
export function supportsTimetableImport(subject: string): boolean {
  return subject === "math" || subject === "english";
}

/**
 * 시간표 '구조 가져오기'(강사별 그리드 시트 → class_schedules 재구축 = 수업·요일·시각·방·강사 배치) 지원 과목.
 * enrollment 라운드트립(supportsTimetableImport)과 별개 — 이쪽은 배치 구조를 되읽는다. 현재 **english 전용**.
 */
export function supportsStructureImport(subject: string): boolean {
  return subject === "english";
}

/**
 * '시트에서 가져오기'가 **시간표 격자 탭**(강사·요일 × 교시 블록, 사람이 눈으로 보고 고치는 그 탭)까지 읽는 과목.
 * 수학은 '수강편집' 탭이 숨겨져 있어 사람이 격자에서 고친 것(열을 끼워 새 반을 만들고 학생을 옮긴 것)이
 * 통째로 무시됐다(원장 2026-10-06). 영어는 강사별 탭 구조 가져오기(supportsStructureImport)가 따로 있다.
 * ⚠️ 지금은 **읽어서 보여 주기까지**다 — 반을 만들거나 수강을 바꾸는 적용 경로는 아직 없다.
 */
export function supportsGridImport(subject: string): boolean {
  return subject === "math";
}
