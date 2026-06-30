import "server-only";
import { google } from "googleapis";

/**
 * Sheets/Drive 쓰기 호출을 429/503에 한해 지수 백오프 재시도.
 * 그 외 오류(401/403/404 등)는 재시도 의미가 없어 즉시 throw.
 */
async function withSheetsRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const status =
        (e as { code?: number; status?: number; response?: { status?: number } })?.code ??
        (e as { status?: number })?.status ??
        (e as { response?: { status?: number } })?.response?.status;
      if (status !== 429 && status !== 503) throw e;
      lastErr = e;
      if (i < attempts - 1) {
        // 0.5s → 1s → 2s 고정 백오프(단일 수동 트리거라 충분).
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * 서비스계정 키 파싱 — `GOOGLE_SERVICE_ACCOUNT_KEY` 우선, 없으면 `FIREBASE_SERVICE_ACCOUNT_KEY` 폴백.
 * 둘은 **동일 GCP 서비스계정**이다(ijw도 같은 secret을 캘린더/시트에 재사용). raw JSON 또는 base64 허용.
 */
function loadServiceAccountCreds(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "구글 연동 키가 없습니다 (GOOGLE_SERVICE_ACCOUNT_KEY 또는 FIREBASE_SERVICE_ACCOUNT_KEY를 설정하세요).",
    );
  }
  let jsonStr = raw.trim();
  if (!jsonStr.startsWith("{")) {
    try {
      jsonStr = Buffer.from(jsonStr, "base64").toString("utf-8");
    } catch {
      throw new Error("구글 서비스계정 키를 base64로 디코딩할 수 없습니다.");
    }
  }
  return JSON.parse(jsonStr);
}

/** Service Account JWT 인증 (Drive + Sheets 스코프). */
function getServiceAccountAuth() {
  const creds = loadServiceAccountCreds();
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * 연동 화면에 "이 계정을 시트에 편집자로 공유하세요"라고 안내할 서비스계정 이메일.
 * 키가 없거나 파싱 실패면 null(연동 미설정 상태).
 */
export function getServiceAccountEmail(): string | null {
  try {
    return loadServiceAccountCreds().client_email || null;
  } catch {
    return null;
  }
}

/** Drive/Sheets 오류 → 운영자가 바로 조치 가능한 한글 메시지. */
function translateSheetsError(e: unknown): string {
  const code = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
  const msg = ((e as { message?: string })?.message || String(e)).toLowerCase();
  const email = getServiceAccountEmail();
  const shareHint = email ? ` (시트를 '${email}'에 '편집자'로 공유했는지 확인하세요)` : "";
  if (msg.includes("storage quota")) {
    return "구글 Drive 저장공간 부족 — 빈 시트는 새로 만들지 말고, 원장 계정으로 미리 만든 시트의 ID를 등록하세요(서비스계정은 그 시트를 갱신만 합니다).";
  }
  if (code === 404 || msg.startsWith("file not found") || msg.includes("not found")) {
    return `대상 시트를 찾을 수 없거나 접근 권한이 없습니다${shareHint}. 시트 ID가 맞는지도 확인하세요.`;
  }
  if (code === 403 || msg.includes("permission") || msg.includes("forbidden")) {
    return `대상 시트 편집 권한이 없습니다${shareHint}.`;
  }
  if (msg.includes("invalid_grant") || msg.includes("jwt")) {
    return "서비스계정 인증 토큰이 만료/오류입니다. 키를 확인하세요.";
  }
  return (e as { message?: string })?.message || String(e);
}

/**
 * 수학 시간표 xlsx를 **운영자가 미리 만들어 서비스계정과 공유한 기존 구글 시트에 통째 덮어쓰기**.
 * (ijw `timetableSheetsSync.updateSheetContent`와 동일 방식 — `drive.files.update` media 교체.)
 *
 * ⚠️ **서비스계정은 자체 Drive 용량이 0이라 새 시트를 만들 수 없다**(storageQuotaExceeded). 그래서
 *    ① 사람이 빈 구글 시트를 만들고(소유자=원장 계정 용량 사용) ② 그 시트를 서비스계정 이메일
 *    ([getServiceAccountEmail])에 **'편집자'로 공유**한 뒤 ③ 그 시트 ID를 연동에 등록해야 한다.
 *    eywa는 그 기존 시트를 **갱신(update)만** 한다.
 * ⚠️ 이는 **시트 전체 덮어쓰기**다 — 대상 시트의 기존 탭은 보존되지 않는다(테넌트 1개 = 전용 시트 1개 가정).
 *    xlsx의 탭 구성(전체·강사별·_meta)이 그대로 시트에 반영된다.
 */
export async function overwriteMathTimetableSheet(
  spreadsheetId: string,
  buffer: ArrayBuffer,
): Promise<void> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  const { Readable } = await import("stream");

  try {
    await withSheetsRetry(() =>
      drive.files.update({
        fileId: spreadsheetId,
        media: {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: Readable.from(Buffer.from(buffer)),
        },
        supportsAllDrives: true,
      }),
    );
  } catch (e) {
    throw new Error(translateSheetsError(e));
  }
}

/**
 * 구글 시트의 한 탭(`tabName`) 전체 셀 값을 2D 문자열 배열로 읽는다(1행=헤더).
 * '시트에서 가져오기'(라운드트립 import) — 시트 편집분을 앱으로 되읽는 단방향 반대 경로.
 * 탭이 없으면(예: '시트 반영' 전) Sheets가 400(Unable to parse range)을 주므로 친절 메시지로 변환.
 */
export async function readSheetTabRows(spreadsheetId: string, tabName: string): Promise<string[][]> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });
  try {
    // 범위 = 탭명만(한글·공백 안전하게 작은따옴표) → 그 탭의 채워진 전 영역.
    const res = await withSheetsRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabName}'` }),
    );
    const values = (res.data.values ?? []) as unknown[][];
    return values.map((row) => row.map((c) => (c == null ? "" : String(c))));
  } catch (e) {
    const msg = ((e as { message?: string })?.message || "").toLowerCase();
    if (msg.includes("unable to parse range") || msg.includes("not found")) {
      throw new Error(`시트에 '${tabName}' 탭이 없습니다. 먼저 시간표에서 '시트 반영'을 한 번 누르세요.`);
    }
    throw new Error(translateSheetsError(e));
  }
}
