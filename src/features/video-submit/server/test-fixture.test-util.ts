/**
 * 테스트 전용 — 제출 링크 서버 테스트가 같이 쓰는 지점·학생·반·Drive 가짜. 🔴 운영 코드에서 import하지 말 것.
 */
import { DEFAULT_VIDEO_HOMEWORK_POLICY } from "@/features/video-homework/policy";
import { createFakeDb } from "./fake-db.test-util";
import { hashSubmitToken } from "./token";

export const T = "11111111-1111-4111-8111-111111111111";
export const OTHER_T = "99999999-9999-4999-8999-999999999999";
export const S = "33333333-3333-4333-8333-333333333333";
export const C = "44444444-4444-4444-8444-444444444444";
export const TEACHER = "22222222-2222-4222-8222-222222222222";
export const ROOT = "ROOT_FOLDER_123";
export const FOLDER = "TEACHER_FOLDER_1";
export const FILE = "NEW_FILE_ID_00001";
export const TOKEN = "t".repeat(43);
export const SESSION = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";

export const ENV = {
  CLASSNOTE_VIDEO_TENANT_ID: T, CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ROOT,
  GOOGLE_DRIVE_CLIENT_ID: "client", GOOGLE_DRIVE_CLIENT_SECRET: "secret", GOOGLE_DRIVE_REFRESH_TOKEN: "refresh",
};

export const settings = () => ({
  modules: { disabled: [] as string[] }, profile: { name: "인재원" },
  report: { videoHomeworkPolicy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY } },
});

export function seedDb(over: { link?: Record<string, unknown> } = {}) {
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  return createFakeDb({
    homework_video_links: [{
      id: "L1", tenant_id: T, student_id: S, class_id: C, origin: "manual", report_id: null, expires_at: future,
      revoked_at: null, token_hash: hashSubmitToken(TOKEN), ...over.link,
    }],
    homework_video_link_uploads: [],
    student_homework_videos: [],
    lesson_reports: [],
    classnote_video_history: [{ tenant_id: T, center_id: 96575 }],
    homework_video_drive_roots: [{ tenant_id:T, root_folder_id:ROOT }],
    classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT, route_key: `${T}:96575:${TEACHER}`, drive_folder_id: FOLDER }],
    students: [{ id: S, tenant_id: T, name: "류태경", school: "칠성초", grade: "초3" }],
    classes: [{ id: C, tenant_id: T, class_name: "LT4", subject: "math", teacher_id: TEACHER }],
    users: [{ id: TEACHER, tenant_id: T, display_name: "이수진", status: "active" }],
  }, {
    student_homework_videos: [["tenant_id", "source", "source_ref"]],
    homework_video_link_uploads: [["tenant_id", "drive_file_id"]],
    classnote_video_folders: [["tenant_id", "root_folder_id", "route_key"], ["tenant_id", "drive_folder_id"]],
  });
}

const folder = (id: string, appProperties: Record<string, string>) => ({
  id, mimeType: "application/vnd.google-apps.folder", parents: [ROOT], trashed: false, appProperties, capabilities: { canAddChildren: true },
});

/** URL로 갈라 답하는 가짜 fetch — `uploaded`가 있으면 완료된 파일 조회에 그 메타를 돌려준다. */
export function fakeDrive(opts: { uploaded?: Record<string, unknown> | null } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "PATCH") return json({ id: "patched" });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
    if (url.includes(`/files/${ROOT}?`)) return json({ ...folder(ROOT, {}), parents: ["drive-root"] });
    if (url.includes(`/files/${FOLDER}?`)) return json(folder(FOLDER, { aywaTeacher: `${T}:96575:${TEACHER}` }));
    if (url.includes("/files/generateIds")) return json({ ids: [FILE] });
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) return json({}, 200, { location: SESSION });
    if (url.includes(`/files/${FILE}?`)) return opts.uploaded ? json(opts.uploaded) : json({ error: "nf" }, 404);
    return json({ error: "unexpected" }, 500);
  };
  return { impl, calls };
}
