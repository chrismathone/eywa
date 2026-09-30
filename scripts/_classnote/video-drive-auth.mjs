import { gcloudVideoAuth } from "./video-gcloud-auth.mjs";
import { oauthRefreshAuth } from "./video-oauth-refresh.mjs";

export async function videoDriveAuth(env = process.env) {
  if (env.GOOGLE_DRIVE_GCLOUD_ACCOUNT) return gcloudVideoAuth(env);
  // 갱신 토큰 방식은 googleapis 없이 fetch만 쓴다 — 연동 PC에 그 패키지가 없어도 돈다(video-oauth-refresh).
  if (env.GOOGLE_DRIVE_REFRESH_TOKEN) return oauthRefreshAuth({ clientId: env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN });
  const { google } = await import("googleapis");
  let auth;
  let kind;
  {
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
