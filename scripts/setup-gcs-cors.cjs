// ijw Firebase(GCS) 버킷 CORS 설정 — 브라우저가 signed PUT URL로 직접 업로드하려면 필요(1회·멱등).
// 실행: NODE_PATH=node_modules node --env-file=.env.local scripts/setup-gcs-cors.cjs
//   (origin 추가/wildcard:  ... scripts/setup-gcs-cors.cjs https://my-preview.vercel.app   또는   * )
//
// ⚠️ GCS CORS origin은 scheme/host/port 정확 일치만 — `https://*.vercel.app` 같은 부분 와일드카드는 무효.
//    preview 배포까지 허용하려면 exact origin을 인자로 추가하거나, 전체 허용 `*` 하나만 인자로(단기 signed URL이 객체·메서드 한정).
// ⚠️ 서비스계정에 storage.buckets.update 권한 필요. 실패 시 콘솔(GCS 버킷 → CORS)에서 수동 설정.

const { Storage } = require("@google-cloud/storage");

const DEFAULT_BUCKET = "ijw-calander.firebasestorage.app";
const BASE_ORIGINS = ["http://localhost:3001", "https://eywa-alpha.vercel.app"];

function getClient() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY 미설정");
  let s = raw.trim();
  if (!s.startsWith("{")) s = Buffer.from(s, "base64").toString("utf-8");
  const c = JSON.parse(s);
  return new Storage({
    projectId: c.project_id,
    credentials: { client_email: c.client_email, private_key: c.private_key },
  });
}

(async () => {
  const extra = process.argv.slice(2); // 추가 origin(또는 "*")
  const origin = extra.includes("*") ? ["*"] : [...BASE_ORIGINS, ...extra];
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  const mine = {
    origin,
    method: ["PUT", "GET", "HEAD"],
    responseHeader: ["Content-Type", "x-goog-resumable"],
    maxAgeSeconds: 3600,
  };
  const bucket = getClient().bucket(bucketName);
  // ⚠️ setCorsConfiguration은 전체 교체 → 공유 버킷의 ijw 기존 규칙을 보존하려면 **머지**.
  // 멱등: 내 origin 집합과 같은 규칙만 교체하고 나머지(ijw 등)는 그대로 둔다.
  const [before] = await bucket.getMetadata();
  const existing = Array.isArray(before.cors) ? before.cors : [];
  const myKey = JSON.stringify([...origin].sort());
  const kept = existing.filter(
    (r) => JSON.stringify([...(r.origin || [])].sort()) !== myKey,
  );
  await bucket.setCorsConfiguration([...kept, mine]);
  const [meta] = await bucket.getMetadata();
  console.log("CORS set on", bucketName, "→", JSON.stringify(meta.cors));
})().catch((e) => {
  console.error("CORS 설정 실패:", e.message);
  console.error("→ 권한(storage.buckets.update) 또는 콘솔에서 수동 설정 필요.");
  process.exit(1);
});
