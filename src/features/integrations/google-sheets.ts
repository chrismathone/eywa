import "server-only";
import { google, type sheets_v4 } from "googleapis";
import { eywaTabTitle, isEywaTab } from "@/features/exports/math-timetable/sheet-tabs";

/**
 * Sheets 쓰기 호출(copyTo·batchUpdate)을 429/503에 한해 지수 백오프 재시도.
 * Sheets API 쓰기 한도(분당 60/사용자=서비스계정)에 근접하면 RESOURCE_EXHAUSTED(429)가 날 수 있다.
 * 그 외 오류(401/403/400 등)는 재시도 의미가 없어 즉시 throw.
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
        // 0.5s → 1s → 2s. (Date.now/Math.random 불필요한 고정 백오프 — 단일 수동 트리거라 충분)
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * Service Account JWT 인증.
 * GOOGLE_SERVICE_ACCOUNT_KEY env에 JSON 키 전체를 base64 또는 raw로 저장.
 *   - raw JSON: `{"type":"service_account",...}`
 *   - base64: `ewogICJ0eXBl...`
 */
function getServiceAccountAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY 환경변수가 누락되었습니다");

  let jsonStr = raw.trim();
  if (!jsonStr.startsWith("{")) {
    // base64 decoded
    try {
      jsonStr = Buffer.from(jsonStr, "base64").toString("utf-8");
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY를 base64로 디코딩할 수 없습니다");
    }
  }
  const creds = JSON.parse(jsonStr);

  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * 테넌트용 새 스프레드시트 생성 + 사용자 이메일에 writer 권한 부여.
 * 결과: spreadsheetId, url.
 */
export async function createTenantSpreadsheet(
  tenantName: string,
  shareWithEmail: string,
  parentFolderId?: string,
): Promise<{ spreadsheetId: string; url: string }> {
  const auth = getServiceAccountAuth();
  await auth.authorize();

  const drive = google.drive({ version: "v3", auth });

  // 1) 새 시트 생성 (Drive API)
  const file = await drive.files.create({
    requestBody: {
      name: `eywa — ${tenantName} 시간표`,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    },
    fields: "id, webViewLink",
  });
  const spreadsheetId = file.data.id!;
  const url = file.data.webViewLink ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // 2) 사용자에게 writer 권한
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: "writer",
      type: "user",
      emailAddress: shareWithEmail,
    },
    sendNotificationEmail: false,
  });

  return { spreadsheetId, url };
}

/**
 * 수학 시간표 xlsx 버퍼를 **공유 스프레드시트에 (이 테넌트의) eywa 전용 탭으로 비파괴 추가**.
 *
 * ijw(또는 다른 앱)·다른 테넌트의 탭은 그대로 보존하고, 직전 `eywa·{tenant}·` 탭만 교체한다.
 * 전환기에 한 시트를 두 앱이 공유하기 위함(ijw의 `drive.files.update` 전체 덮어쓰기와 달리 비파괴).
 *   1) 버퍼를 **임시** Google Sheets로 import(xlsx→Sheets 변환: 색·병합·서식·열폭 보존).
 *   2) 임시 시트의 각 탭을 대상 시트로 `copyTo`(Google 자동명 "사본"으로 추가, 429 백오프 재시도).
 *   3) 직전 `eywa·{tenant}·` 탭 삭제 + 신규 탭을 `eywa·{tenant}·` 접두 최종명으로 rename(한
 *      batchUpdate에서 삭제→rename 순서 → ≥1 시트 보장 + 제목 충돌 회피).
 *   4) 임시 파일 삭제(누적 방지).
 *
 * 부분 실패(copyTo/batchUpdate 도중 throw) 시 **방금 복사한 미rename "사본" 탭을 best-effort
 * 정리**한다(접두 미매칭으로 다음 동기화에 잡히지 않는 orphan 누적 방지 → 사실상 원자적 교체).
 *
 * @param tenantToken 테넌트별 안정 토큰(예: `tenantId.slice(0,8)`). 탭 접두에 포함돼 **다른
 *   테넌트의 eywa 탭을 교차 삭제하지 않게** 한다(같은 시트를 두 테넌트가 가리켜도 안전).
 *
 * ⚠️ 서비스 계정이 대상 시트에 **편집(writer) 권한**을 가져야 한다(없으면 copyTo가 403 →
 *    호출부가 last_error로 노출). 공유 시트 ID는 학원 설정/연동에서 주입.
 * ⚠️ 전환기 동안 ijw가 전체 덮어쓰기로 자동 push하면 eywa 탭이 지워진다 → ijw 자동 push 일시중지 필요.
 */
export async function pushMathTimetableTabs(
  spreadsheetId: string,
  buffer: ArrayBuffer,
  tenantToken: string,
): Promise<void> {
  const auth = getServiceAccountAuth();
  await auth.authorize();

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  // 1) xlsx 버퍼 → 임시 Google Sheets(변환 import)
  const { Readable } = await import("stream");
  const temp = await drive.files.create({
    requestBody: {
      name: "eywa-temp-timetable",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Readable.from(Buffer.from(buffer)),
    },
    fields: "id",
  });
  const tempId = temp.data.id;
  if (!tempId) throw new Error("임시 시트 생성 실패(Drive import)");

  // copyTo로 대상에 추가됐지만 아직 eywa·{tenant}· 최종명으로 rename 안 된 탭 id(부분 실패 정리용).
  const copiedSheetIds: number[] = [];
  try {
    // 2) 대상의 기존 탭(직전 eywa· 탭 식별) + 임시 탭(복사원) 조회
    const [targetMeta, tempMeta] = await Promise.all([
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      }),
      sheets.spreadsheets.get({
        spreadsheetId: tempId,
        fields: "sheets(properties(sheetId,title,index))",
      }),
    ]);

    const oldEywaSheetIds = (targetMeta.data.sheets ?? [])
      .map((s) => s.properties)
      .filter(
        (p): p is sheets_v4.Schema$SheetProperties =>
          !!p &&
          typeof p.title === "string" &&
          typeof p.sheetId === "number" &&
          isEywaTab(p.title, tenantToken),
      )
      .map((p) => p.sheetId!);

    const tempSheets = (tempMeta.data.sheets ?? [])
      .map((s) => s.properties)
      .filter(
        (p): p is sheets_v4.Schema$SheetProperties =>
          !!p && typeof p.sheetId === "number" && typeof p.title === "string",
      )
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (tempSheets.length === 0) throw new Error("임시 시트에 탭이 없습니다");

    // 3) 임시 탭 → 대상 시트로 copyTo(신규 sheetId + eywa·{tenant}· 최종 제목 수집)
    const renames: { sheetId: number; title: string }[] = [];
    for (const p of tempSheets) {
      const copied = await withSheetsRetry(() =>
        sheets.spreadsheets.sheets.copyTo({
          spreadsheetId: tempId,
          sheetId: p.sheetId!,
          requestBody: { destinationSpreadsheetId: spreadsheetId },
        }),
      );
      const newId = copied.data.sheetId;
      if (typeof newId === "number") {
        copiedSheetIds.push(newId);
        renames.push({ sheetId: newId, title: eywaTabTitle(p.title!, tenantToken) });
      }
    }

    // 4) 직전 eywa· 탭 삭제 → 신규 탭 최종명 rename(한 batchUpdate, 순서 보장).
    //    신규 탭이 이미 추가돼 ≥1 시트 보장 + 삭제 후 rename이라 제목 충돌 없음.
    const requests: sheets_v4.Schema$Request[] = [
      ...oldEywaSheetIds.map((sheetId) => ({ deleteSheet: { sheetId } })),
      ...renames.map((r) => ({
        updateSheetProperties: {
          properties: { sheetId: r.sheetId, title: r.title },
          fields: "title",
        },
      })),
    ];
    if (requests.length > 0) {
      await withSheetsRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        }),
      );
    }
  } catch (e) {
    // 부분 실패 정리: copyTo는 됐으나 rename(batchUpdate)이 안 끝난 "사본" 탭은 접두 미매칭이라
    // 다음 동기화에 안 잡혀 누적된다 → 방금 추가한 것만 best-effort 삭제(실패해도 원 오류를 우선).
    if (copiedSheetIds.length > 0) {
      await sheets.spreadsheets
        .batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: copiedSheetIds.map((sheetId) => ({ deleteSheet: { sheetId } })),
          },
        })
        .catch(() => {});
    }
    throw e;
  } finally {
    // 5) 임시 파일 삭제
    await drive.files.delete({ fileId: tempId }).catch(() => {});
  }
}
