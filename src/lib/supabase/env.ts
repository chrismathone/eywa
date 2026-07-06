// Supabase 공개 env(프로젝트 URL·anon 키) — 클라/서버 공용 단일 소스.
// ⚠️ 배포 환경변수 값에 실수로 섞여 들어간 앞뒤 공백/줄바꿈을 제거한다. anon 키 끝의 '\n'이
// Realtime WebSocket의 apikey를 '…%0A'로 오염시켜 "transport failure" 무한 재연결(콘솔 폭주)을
// 유발했다(2026-07-06, Vercel env 붙여넣기 시 트레일링 개행). NEXT_PUBLIC_*는 빌드 시 인라인되므로
// 여기서 trim하면 전 소비처(browser/server client, 미들웨어)가 방어된다.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
