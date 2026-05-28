import "server-only";
import { google } from "googleapis";
import { buildTimetableWorkbook } from "@/features/exports/timetable-excel";

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
 * 시간표 데이터를 빌드해서 기존 Google Sheets에 업로드 (덮어쓰기).
 * xlsx 파일로 변환 → drive.files.update의 media → Google이 자동으로 sheet로 변환.
 */
export async function pushTimetableToSheets(spreadsheetId: string): Promise<void> {
  const auth = getServiceAccountAuth();
  await auth.authorize();

  const drive = google.drive({ version: "v3", auth });

  // 1) exceljs로 xlsx buffer 생성
  const wb = await buildTimetableWorkbook();
  const buf = await wb.xlsx.writeBuffer();

  // 2) Drive에 업로드 — 기존 스프레드시트의 콘텐츠 덮어쓰기
  // (Readable stream 필요 — Buffer 사용 가능)
  // googleapis는 Node Buffer 또는 stream을 받음
  const { Readable } = await import("stream");
  const stream = Readable.from(Buffer.from(buf));

  await drive.files.update({
    fileId: spreadsheetId,
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: stream,
    },
  });
}
