import "server-only";
import { google } from "googleapis";
import type { SheetGrid } from "@/features/timetable/import/structure/types";

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
 * 서비스계정 키 파싱 — `GOOGLE_SERVICE_ACCOUNT_KEY`(eywa-injaewon 프로젝트). raw JSON 또는 base64 허용.
 * 2026-07-29: 옛 `FIREBASE_SERVICE_ACCOUNT_KEY` 폴백 제거 — 그 프로젝트(ijw-calander)를 삭제해 죽은 경로다.
 */
function loadServiceAccountCreds(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "구글 연동 키가 없습니다 (GOOGLE_SERVICE_ACCOUNT_KEY를 설정하세요).",
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

/**
 * 인증된 Sheets v4 클라이언트 — 이 모듈 밖(ECS 시트 가져오기 등)에서 **여러 탭·여러 문서**를 직접
 * 훑어야 할 때만 쓴다. 단일 탭 읽기는 readSheetTabRows / readSheetGridWithMerges를 쓸 것.
 * ⚠️ 서비스계정 인증·키 파싱을 복제하지 않기 위한 유일한 통로다(키 로딩은 여전히 이 모듈에만 있다).
 */
export async function getSheetsApi() {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

/** 시트 오류 → 사람이 읽는 한글 메시지(권한·할당량 안내 포함). 모듈 밖 호출부도 같은 문구를 쓰게 공개. */
export function describeSheetsError(e: unknown): string {
  return translateSheetsError(e);
}

/**
 * 시트 최종 수정 정보 — cron 자동 반영의 **사람-편집 가드**용.
 * 마지막 수정자가 서비스계정이 아니면(=사람이 시트를 편집한 뒤 아직 '가져오기'를 안 함) 자동 덮어쓰기를
 * 건너뛰어 시트 편집분 유실을 구조적으로 차단한다. emailAddress가 안 오는 케이스(외부 계정 프라이버시)는
 * null — 호출부가 modifiedTime 폴백으로 판정.
 */
export async function getSheetLastModifier(
  spreadsheetId: string,
): Promise<{ modifiedTime: string | null; email: string | null }> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  try {
    const res = await withSheetsRetry(() =>
      drive.files.get({
        fileId: spreadsheetId,
        fields: "modifiedTime, lastModifyingUser(emailAddress)",
        supportsAllDrives: true,
      }),
    );
    return {
      modifiedTime: res.data.modifiedTime ?? null,
      email: res.data.lastModifyingUser?.emailAddress ?? null,
    };
  } catch (e) {
    throw new Error(translateSheetsError(e));
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
 * 시간표 xlsx를 **운영자가 미리 만들어 서비스계정과 공유한 기존 구글 시트에 통째 덮어쓰기**(과목 무관).
 * (ijw `timetableSheetsSync.updateSheetContent`와 동일 방식 — `drive.files.update` media 교체.)
 *
 * ⚠️ **서비스계정은 자체 Drive 용량이 0이라 새 시트를 만들 수 없다**(storageQuotaExceeded). 그래서
 *    ① 사람이 빈 구글 시트를 만들고(소유자=원장 계정 용량 사용) ② 그 시트를 서비스계정 이메일
 *    ([getServiceAccountEmail])에 **'편집자'로 공유**한 뒤 ③ 그 시트 ID를 연동에 등록해야 한다.
 *    aywa는 그 기존 시트를 **갱신(update)만** 한다.
 * ⚠️ 이는 **시트 전체 덮어쓰기**다 — 대상 시트의 기존 탭은 보존되지 않는다(과목당 전용 시트 1개 가정 —
 *    수학·영어는 서로 다른 시트여야 한다). 넘긴 xlsx의 탭 구성이 그대로 시트에 반영된다.
 * ⚠️⚠️ **`requestBody.mimeType`를 구글시트 타입으로 반드시 지정**해야 Drive가 xlsx를 **변환**해 탭·셀을
 *    채운다. 이 힌트가 없으면 files.update가 네이티브 구글시트를 **빈 시트(기본 1탭)로 날려버린다**(2026-07-08
 *    실측: 200 OK로 조용히 성공하지만 내용 0). media만으론 변환이 안 걸림 — 반드시 requestBody와 함께.
 */
export async function overwriteTimetableSheet(
  spreadsheetId: string,
  buffer: ArrayBuffer,
  opts?: {
    /**
     * 업로드 후 **숨길** 탭 이름들(원장 요청 2026-08-04: "시트 반영에서 수강편집 시트는 숨겨줘").
     * ⚠️ **빼는 게 아니라 숨기는 것** — '수강편집'은 학생 반이동 가져오기의 라운드트립 앵커라 시트에서
     *   빠지면 가져오기 경로가 통째로 닫힌다(build-buffer의 includeEditSheet 주석 참조). 사람 눈에만
     *   안 보이게 하고 데이터는 그대로 둔다. 시트 UI에서 언제든 '숨기기 해제'로 되돌릴 수 있다.
     */
    hiddenTabs?: string[];
  },
): Promise<void> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  const { Readable } = await import("stream");

  try {
    await withSheetsRetry(() =>
      drive.files.update({
        fileId: spreadsheetId,
        // 변환 강제 — 없으면 시트가 빈 채로 덮어써진다(위 ⚠️⚠️).
        requestBody: { mimeType: "application/vnd.google-apps.spreadsheet" },
        media: {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: Readable.from(Buffer.from(buffer)),
        },
        supportsAllDrives: true,
      }),
    );
    // media 교체 후: 모든 탭 전 셀을 CLIP(넘침 방지)으로 강제. 구글 시트는 xlsx import 시 기본이
    // OVERFLOW_CELL이라 학생 이름이 옆 칸으로 넘쳐 흉하다(사용자 요청 "다 잘림"). xlsx의 shrinkToFit은
    // 시트가 무시하므로 여기서 wrapStrategy=CLIP을 시트 API로 못박는다.
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await withSheetsRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }),
    );
    const props = (meta.data.sheets ?? [])
      .map((s) => s.properties)
      .filter((p): p is { sheetId: number; title: string } => typeof p?.sheetId === "number");
    const requests: object[] = props.map(({ sheetId }) => ({
      repeatCell: {
        range: { sheetId },
        cell: { userEnteredFormat: { wrapStrategy: "CLIP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    }));
    // 숨김 탭 — 같은 batchUpdate에 실어 왕복을 늘리지 않는다.
    // ⚠️ 구글은 **모든 탭이 숨겨지는 것**을 거부한다(400) → 남는 탭이 있을 때만 건다.
    const hide = new Set(opts?.hiddenTabs ?? []);
    if (hide.size > 0 && props.some((p) => !hide.has(p.title))) {
      for (const p of props.filter((x) => hide.has(x.title))) {
        requests.push({
          updateSheetProperties: { properties: { sheetId: p.sheetId, hidden: true }, fields: "hidden" },
        });
      }
    }
    if (requests.length > 0) {
      await withSheetsRetry(() =>
        sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }),
      );
    }
  } catch (e) {
    throw new Error(translateSheetsError(e));
  }
}

/**
 * 업로드(변환) 후 특정 탭 셀에 **구글시트 수식**을 주입한다(정적 값 위에 덮어쓰기).
 * ⚠️ xlsx에 구글 전용 함수(LET/LAMBDA/REGEXEXTRACT 등)를 넣으면 xlsx→시트 변환이 통째로 실패
 *    ("Conversion not supported")하므로, 정적 값으로 먼저 올린 뒤 Sheets API로 수식만 덮는다.
 */
export async function applySheetFormulas(
  spreadsheetId: string,
  sheetName: string,
  cells: { row: number; col: number; formula: string }[],
): Promise<void> {
  if (cells.length === 0) return;
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const meta = await withSheetsRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }),
    );
    const sheetId = (meta.data.sheets ?? []).find((s) => s.properties?.title === sheetName)?.properties?.sheetId;
    if (typeof sheetId !== "number") throw new Error(`시트 탭 '${sheetName}'을 찾을 수 없습니다`);
    const requests = cells.map((c) => ({
      updateCells: {
        range: { sheetId, startRowIndex: c.row - 1, endRowIndex: c.row, startColumnIndex: c.col - 1, endColumnIndex: c.col },
        rows: [{ values: [{ userEnteredValue: { formulaValue: c.formula.startsWith("=") ? c.formula : `=${c.formula}` } }] }],
        fields: "userEnteredValue",
      },
    }));
    for (let i = 0; i < requests.length; i += 500) {
      const chunk = requests.slice(i, i + 500);
      await withSheetsRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: chunk } }));
    }
  } catch (e) {
    throw new Error(translateSheetsError(e));
  }
}

/**
 * 시트 탭의 특정 행(1-based, A열부터)에 값 한 행을 update(RAW) — "지정 위치 기입"용(직원 이력서 →
 * 신규 직원명부의 헤더 아래 첫 빈 행). values.append는 탭 중간의 안내/샘플 블록 **아래**에 붙어버려
 * (2026-07-16 직원명부 실측) 위치를 호출부가 계산해 update로 못박는다.
 * ⚠️ 기입류 호출이라 withSheetsRetry(429/503 재전송)를 걸지 않는다 — 실패는 호출부가 경고로 사용자
 *    확인을 유도한다. 저장 액션이 동기 대기하므로 요청 timeout(8s)으로 지연 상한을 못박는다.
 */
export async function updateSheetRow(
  spreadsheetId: string,
  tabName: string,
  rowIndex: number,
  values: string[],
  // 기입 시작 열 — 시트 수식 열(예: 직원명부 A열 ARRAYFORMULA 채번)을 덮지 않으려면 "B" 등으로.
  startColumn = "A",
): Promise<void> {
  try {
    // 인증도 try 안 — invalid_grant 등 인증 오류가 한글 메시지(translateSheetsError)로 떨어지게.
    const auth = getServiceAccountAuth();
    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.update(
      {
        spreadsheetId,
        range: `'${tabName}'!${startColumn}${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [values] },
      },
      { timeout: 8000 },
    );
  } catch (e) {
    const msg = ((e as { message?: string })?.message || "").toLowerCase();
    if (msg.includes("unable to parse range")) {
      throw new Error(`시트에 '${tabName}' 탭이 없습니다 — 탭 이름을 확인하세요.`);
    }
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

/**
 * 문서의 **탭 목록**(gid + 이름). 시간표(개발중) '시트에서 그 달 계획 가져오기'가 쓴다.
 *
 * 왜 필요한가: 읽기는 [`readSheetGridWithMerges`]가 탭 **이름**으로 하는데, 원장이 주소창에서 복사해 주는
 * 주소에는 **gid(숫자)**만 들어 있다(`…/edit?gid=661682520#gid=661682520`). 그 사이를 잇는 유일한 통로다.
 * 목록 자체도 쓸모가 있다 — 주소에 gid가 없으면 사람이 탭을 고를 수 있어야 한다.
 *
 * ⚠️ **격자 데이터를 받지 않는다**(`sheets.properties`만) — 탭이 수십 개인 큰 문서에서도 가볍다.
 * 실패는 다른 읽기와 같은 한글 문구(권한·공유 안내 포함)로 던진다.
 */
export async function listSheetTabs(spreadsheetId: string): Promise<{ gid: number; title: string }[]> {
  const sheets = await getSheetsApi();
  try {
    const res = await withSheetsRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }),
    );
    return (res.data.sheets ?? [])
      .map((s) => s.properties)
      .filter(
        (p): p is { sheetId: number; title: string } =>
          typeof p?.sheetId === "number" && typeof p?.title === "string",
      )
      .map((p) => ({ gid: p.sheetId, title: p.title }));
  } catch (e) {
    throw new Error(translateSheetsError(e));
  }
}

/**
 * 시트 탭을 **셀 + 병합** 포함으로 읽는다(구조 import용). `values.get`은 병합을 잃어(강사별 그리드는
 * 병합=수업길이라 필수) `spreadsheets.get(includeGridData:true)`로 읽는다. cells=formattedValue(빈="") 0-based,
 * merges=Sheets 원형(0-based, end-exclusive). 후행 완전 빈 행은 트림.
 */
export async function readSheetGridWithMerges(spreadsheetId: string, tabName: string): Promise<SheetGrid> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const res = await withSheetsRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [`'${tabName}'`],
        includeGridData: true,
        fields: "sheets(data(rowData(values(formattedValue))),merges)",
      }),
    );
    const sheet = res.data.sheets?.[0];
    const rowData = sheet?.data?.[0]?.rowData ?? [];
    const maxCol = Math.max(0, ...rowData.map((r) => (r.values ?? []).length));
    const cells: string[][] = rowData.map((r) => {
      const vs = r.values ?? [];
      const row: string[] = [];
      for (let c = 0; c < maxCol; c++) row.push(vs[c]?.formattedValue ?? "");
      return row;
    });
    while (cells.length && cells[cells.length - 1]!.every((x) => x === "")) cells.pop();
    const merges = (sheet?.merges ?? []).map((m) => ({
      startRowIndex: m.startRowIndex ?? 0,
      endRowIndex: m.endRowIndex ?? 0,
      startColumnIndex: m.startColumnIndex ?? 0,
      endColumnIndex: m.endColumnIndex ?? 0,
    }));
    return { tabName, cells, merges };
  } catch (e) {
    const msg = ((e as { message?: string })?.message || "").toLowerCase();
    if (msg.includes("unable to parse range") || msg.includes("not found")) {
      throw new Error(`시트에 '${tabName}' 탭이 없습니다. 먼저 시간표에서 '시트 반영'을 한 번 누르세요.`);
    }
    throw new Error(translateSheetsError(e));
  }
}
