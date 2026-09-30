import { gcloudVideoAuth } from "./video-gcloud-auth.mjs";

export async function videoDriveAuth(env = process.env) {
  if (env.GOOGLE_DRIVE_GCLOUD_ACCOUNT) return gcloudVideoAuth(env);
  const { google } = await import("googleapis");
  let auth;
  let kind;
  if (env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) throw new Error("Drive OAuth client ID/secret이 필요합니다.");
    auth = new google.auth.OAuth2(env.GOOGLE_DRIVE_CLIENT_ID, env.GOOGLE_DRIVE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN });
    kind = "oauth";
  } else {
    const raw = env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
    if (!raw) throw new Error("Drive 인증 설정이 없습니다.");
    const credentials = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    auth = new google.auth.JWT({ email: credentials.client_email, key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"] });
    kind = "service-account";
  }
  return { kind, async accessToken() {
    const value = await auth.getAccessToken();
    const token = typeof value === "string" ? value : value?.token;
    if (!token) throw new Error("Drive 인증 토큰을 받지 못했습니다.");
    return token;
  } };
}
