import "server-only";
import { readSheetTabRows, updateSheetRow } from "@/features/integrations/google-sheets";
import type { StaffResumeData } from "../resume";
import { buildRosterRow, firstEmptyRowIndex } from "../resume-roster";

// 직원 이력서 저장(신규 작성) 시 "신규 직원명부" 구글시트에 한 행 기입 — 부가 효과.
// 실패해도 이력서 저장 자체는 유효해야 하므로 throw하지 않고 {ok:false, error}로 돌려
// 호출부(saveStaffResume)가 경고 토스트만 띄운다. 인증은 기존 서비스계정 키
// (GOOGLE_SERVICE_ACCOUNT_KEY/FIREBASE_SERVICE_ACCOUNT_KEY) 재사용 — 대상 시트는 그
// 서비스계정에 '편집자'로 공유돼 있어야 한다.

const DEFAULT_TAB = "2026신규 직원명부";

export async function appendResumeToRoster(
  data: StaffResumeData,
): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  const spreadsheetId = process.env.HR_ROSTER_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    // 미설정 = 의도적 비활성(선택 기능) — 실패 경고로 승격하지 않는다(적대검수 2026-07-16: 연동을
    // 안 쓰는 배포에서 매 저장마다 거짓 '실패' 토스트 → 경고 피로로 진짜 실패까지 무시됨). 로그만.
    console.warn("[resume-roster-sheet] HR_ROSTER_SPREADSHEET_ID 미설정 — 직원명부 시트 기입 건너뜀");
    return { ok: true, skipped: true };
  }
  const tab = process.env.HR_ROSTER_SHEET_TAB?.trim() || DEFAULT_TAB;
  // 저장 액션이 동기 대기하므로 전체 상한 10s — 초과 시 "실패"가 아니라 "확인 필요"로 안내
  // (기입 자체는 그 뒤 성공했을 수 있다). 개별 요청 timeout(8s)은 updateSheetRow 쪽.
  // 기입 위치 = 헤더 아래 첫 빈 행(위에서부터) — append는 탭 중간 안내 블록 아래로 밀림(원장 제보).
  // 읽기→쓰기 사이 동시 저장 레이스는 이력서 작성 빈도(월 수 건)상 감수.
  const job = (async () => {
    const rows = await readSheetTabRows(spreadsheetId, tab).catch((e) => {
      // readSheetTabRows의 "먼저 시간표에서 '시트 반영'…" 힌트는 시간표 전용 — 명부 맥락 메시지로 교체.
      const m = (e as Error)?.message || "";
      throw m.includes("탭이 없습니다")
        ? new Error(`시트에 '${tab}' 탭이 없습니다 — HR_ROSTER_SHEET_TAB 값을 확인하세요`)
        : e;
    });
    await updateSheetRow(spreadsheetId, tab, firstEmptyRowIndex(rows), buildRosterRow(data));
  })();
  // race 패배 후 늦게 떨어지는 거부가 unhandledRejection으로 새지 않게 미리 handled 처리(원 promise는 race가 그대로 씀).
  job.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      job,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("구글시트 응답 지연 — 시트에 기입됐는지 직접 확인하세요")), 10_000);
      }),
    ]);
    return { ok: true };
  } catch (e) {
    // 저장 흐름을 막지 않되 서버 로그에 원문을 남긴다(운영 디버깅용).
    console.error("[resume-roster-sheet] 직원명부 시트 기입 실패:", e);
    // UI raw 기술 원문 금지 — 한글 메시지(translateSheetsError 산출 포함)만 토스트로, 영문 원문은 위 로그로.
    const msg = (e as Error)?.message || String(e);
    return { ok: false, error: /[가-힣]/.test(msg) ? msg : "구글시트 호출 오류 — 서버 로그를 확인하세요" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
