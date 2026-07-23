/**
 * 학원이(테스트 학생) 보드로 **공지 + 이미지 첨부** 실발송 E2E — 원장 지시(2026-07-23) 검증용.
 *
 * ⚠️ 실 학부모에게 가지 않는다: 타깃은 앱의 `TEST_TARGET`과 **같은 고정값**(`(수학)학원이`) 하나뿐이고
 *    인자가 없다 — 이 파일은 구조적으로 실 학생을 타깃으로 삼을 수 없다.
 * ⚠️ 평소 테스트 스위트엔 **안 잡힌다**(vitest.config.ts include는 `*.test.ts`) — 전용 config로만 실행:
 *    `pnpm exec vitest run --config <scratch>/vitest.notice-e2e.config.ts`
 *
 * 무엇을 검증하나 — 이번에 새로 만든 경로를 실제로 태운다:
 *  ① `issueNoticeImageTicket`   티켓 발급 + tenant 경로 생성(신규 공용 코어)
 *  ② signed PUT                 클라 `uploadToTicket`이 하는 것과 동일
 *  ③ `verifyNoticeImage`        업로드 객체 서버 재검증(신규 공용 코어)
 *  ④ classnote_notices 적재      발송 액션이 만드는 것과 같은 행 모양(공통 attachments)
 *  ⑤ 연동 PC 워커 게시           폴링 대기
 *  ⑥ `flattenNoticeReportLinks` 게시 결과에 **학생 이름 라벨**이 붙는지(신규 순수 함수)
 *
 * ⚠️ 서버 액션 자체(sendOnescreenNotice)는 쿠키 세션이 필요해 여기서 못 부른다 → 인가·동명이인 가드는
 *    이 E2E의 검증 대상이 아니다(단위 테스트·타입으로 커버). 첨부 배관과 워커 왕복이 대상.
 */
import fs from "node:fs";
import { expect, test } from "vitest";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // 인재원
// 앱의 TEST_TARGET과 동일 — 탈원 처리된 테스트 학생이라 실 학부모 연결이 없다.
const TEST_TARGET = { studentId: null as string | null, studentName: "학원이", board: "(수학)학원이" };
const IMAGE = "D:/eywa_refactoring/public/empty-states/empty-search-alpha.png";
const ENV_FILE = "D:/eywa_refactoring/.env.local";

/** .env.local → process.env (스토리지 자격증명·DB는 모두 **호출 시점**에 읽히므로 여기서 넣어도 된다). */
function loadEnv(): string {
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.DATABASE_URL!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("학원이 보드에 이미지 첨부 공지가 실제로 게시된다", async () => {
  const dbUrl = loadEnv();
  const postgres = (await import("postgres")).default;
  const { issueNoticeImageTicket, verifyNoticeImage } = await import(
    "@/features/onescreen/server/notice-image-upload"
  );
  const { flattenNoticeReportLinks } = await import("@/features/onescreen/notice-links");

  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  try {
    // ── ① 티켓 발급 ──
    const bytes = fs.readFileSync(IMAGE);
    const issued = await issueNoticeImageTicket(TENANT, { contentType: "image/png", size: bytes.byteLength });
    expect(issued.error, `티켓 발급 실패: ${issued.error}`).toBeUndefined();
    const ticket = issued.ticket!;
    console.log(`① 티켓 발급 OK — backend=${ticket.backend} path=${ticket.path}`);
    expect(ticket.path.startsWith(`${TENANT}/report-attachments/`)).toBe(true);

    // ── ② signed PUT(클라 uploadToTicket과 동일: gcs = headers 그대로) ──
    expect(ticket.backend, "이 스크립트는 gcs 백엔드 전용").toBe("gcs");
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers ?? { "content-type": "image/png" },
      body: new Uint8Array(bytes),
    });
    expect(put.ok, `업로드 실패 HTTP ${put.status}`).toBe(true);
    console.log(`② 업로드 OK — ${bytes.byteLength}바이트`);

    // ── ③ 서버 재검증 ──
    const reg = await verifyNoticeImage(TENANT, {
      path: ticket.path,
      name: "eywa-테스트-이미지.png",
      size: bytes.byteLength,
    });
    expect(reg.error, `재검증 실패: ${reg.error}`).toBeUndefined();
    console.log(`③ 재검증 OK — ${JSON.stringify(reg.attachment)}`);

    // ── ④ 큐 적재(발송 액션과 같은 행 모양) ──
    const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const body = `[eywa 테스트] 공지 이미지 첨부 확인용입니다. 학부모님께 드리는 안내가 아니니 무시해 주세요.\n보낸 시각 ${stamp}`;
    const [row] = await sql`
      insert into classnote_notices (tenant_id, body, targets, attachments)
      values (${TENANT}, ${body}, ${sql.json([TEST_TARGET])}, ${sql.json([reg.attachment!])})
      returning id`;
    console.log(`④ 큐 적재 OK — notice ${row.id}`);

    // ── ⑤ 워커 처리 대기(최대 5분) ──
    let final: { status: string; results: unknown; error: string | null } | null = null;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const [r] = await sql`select status, results, error from classnote_notices where id = ${row.id}`;
      if (["success", "partial", "failed"].includes(r.status)) {
        final = r as unknown as typeof final;
        break;
      }
      if (i % 4 === 3) console.log(`   대기 ${(i + 1) * 5}초 — 상태 ${r.status}`);
    }
    expect(final, "5분 안에 워커가 처리하지 않았습니다(워커 중지?)").not.toBeNull();
    console.log(`⑤ 처리 완료 — 상태 ${final!.status}${final!.error ? ` / 오류 ${final!.error}` : ""}`);
    console.log(`   results = ${JSON.stringify(final!.results)}`);
    expect(final!.status).toBe("success");

    // ── ⑥ 이름 라벨(신규 순수 함수) ──
    const links = flattenNoticeReportLinks(final!.results, [TEST_TARGET]);
    console.log(`⑥ 링크 라벨 = ${JSON.stringify(links)}`);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.name === "학원이")).toBe(true);
    console.log(`   게시글 주소: ${links.map((l) => l.url).join(" ")}`);
  } finally {
    await sql.end();
  }
});
