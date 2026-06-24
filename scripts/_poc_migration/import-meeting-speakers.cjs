/**
 * ijw meeting_reports.speakerLabels/speakerRoles → eywa meeting_minutes.speaker_labels/ai_speaker_roles 임포트.
 *
 * 배경: ijw는 같은 AssemblyAI로 회의 화자 구분(speakerLabels)·역할(speakerRoles)을 잘 해뒀는데(44/47건),
 * eywa POC 임포트가 transcription 텍스트만 가져와 화자 라벨이 거의 0개(통짜 전사)였다. 이 스크립트가 복원한다.
 *
 * 매칭: ijw storagePath = eywa audio_path (검증 39/41). 멱등: speaker_labels가 비었거나(null/[]) ai_speaker_roles가
 * 빈 행만 채운다(기존 수동/AI 결과 보존, 재실행 no-op). dry-run 기본 / --apply.
 *
 * 실행(eywa 루트에서):
 *   NODE_PATH="D:/ijw-calander/node_modules" node --env-file=.env.local scripts/_poc_migration/import-meeting-speakers.cjs           # dry-run
 *   NODE_PATH="D:/ijw-calander/node_modules" node --env-file=.env.local scripts/_poc_migration/import-meeting-speakers.cjs --apply
 *
 * postgres는 eywa 로컬, firebase-admin은 ijw node_modules(NODE_PATH fallback).
 */
const postgres = require("postgres");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const SERVICE_ACCOUNT = "D:/ijw-calander/serviceAccount.json";
const IJW_DB = "restore20260319";

const isEmptyArr = (v) => !v || (Array.isArray(v) && v.length === 0);
const isEmptyObj = (v) => !v || typeof v !== "object" || Object.keys(v).length === 0;

(async () => {
  const app = initializeApp({ credential: cert(require(SERVICE_ACCOUNT)) });
  const fdb = getFirestore(app, IJW_DB);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const stats = { ijwTotal: 0, ijwHasLabels: 0, matched: 0, missing: 0, skipped: 0, fillLabels: 0, fillRoles: 0 };

  try {
    // 1) ijw meeting_reports → storagePath 인덱스(speakerLabels 있는 것만).
    const snap = await fdb.collection("meeting_reports").get();
    const ijwBySp = new Map();
    for (const d of snap.docs) {
      const x = d.data();
      stats.ijwTotal++;
      if (isEmptyArr(x.speakerLabels)) continue;
      stats.ijwHasLabels++;
      if (x.storagePath) {
        // utterance를 {speaker,text,start,end}로 정규화(eywa SpeakerUtterance 형식).
        const labels = x.speakerLabels.map((u) => ({
          speaker: u.speaker,
          text: u.text,
          start: u.start ?? 0,
          end: u.end ?? 0,
        }));
        const roles = isEmptyObj(x.speakerRoles) ? null : x.speakerRoles;
        ijwBySp.set(x.storagePath, { labels, roles });
      }
    }

    // 2) eywa meeting_minutes(단일 테넌트) — 빈 행만 채울 대상 도출.
    const tenantRow = await sql`select tenant_id from meeting_minutes group by tenant_id order by count(*) desc limit 1`;
    const tenantId = tenantRow[0].tenant_id;
    const eRows = await sql`
      select id, audio_path, speaker_labels, ai_speaker_roles
      from meeting_minutes where tenant_id=${tenantId}`;

    const updates = [];
    for (const r of eRows) {
      if (!r.audio_path) continue;
      const ijw = ijwBySp.get(r.audio_path);
      if (!ijw) { stats.missing++; continue; }
      stats.matched++;
      // speaker_labels가 이미 있으면 건드리지 않음(기존 보존, 멱등).
      if (!isEmptyArr(r.speaker_labels)) { stats.skipped++; continue; }
      // speaker_labels를 새로 채우는 행은 화자 집합이 바뀌므로 ai_speaker_roles도 ijw 것으로 **동기화**.
      // (eywa가 통짜 전사 기준으로 추론해둔 옛 {A:전체} roles는 새 A/B/C 집합과 안 맞아 제거/교체.)
      stats.fillLabels++;
      if (ijw.roles) stats.fillRoles++;
      updates.push({ id: r.id, labels: ijw.labels, roles: ijw.roles });
    }

    console.log("STATS:", JSON.stringify(stats, null, 0));
    if (!APPLY) {
      console.log(`DRY-RUN — 갱신 대상 ${updates.length}행. 적용하려면 --apply.`);
      return;
    }

    let done = 0;
    for (const u of updates) {
      // speaker_labels는 항상, ai_speaker_roles는 ijw 것(없으면 null로 비워 옛 통짜 추론 잔재 제거).
      await sql`update meeting_minutes
        set speaker_labels=${sql.json(u.labels)},
            ai_speaker_roles=${u.roles ? sql.json(u.roles) : null}
        where id=${u.id}`;
      if (++done % 10 === 0) process.stdout.write(`.${done}`);
    }
    console.log(`\nAPPLIED ${done} rows`);
  } finally {
    await sql.end();
  }
})().then(() => process.exit(0)).catch((e) => { console.error("FATAL", e.message); process.exit(1); });
