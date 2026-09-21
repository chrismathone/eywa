/**
 * scripts/_classnote/scan-english-posts.mjs — 영어 강사 ClassNote 발송분 **전수 검사(읽기 전용)**.
 *
 * 왜: 영어는 수학과 달리 aywa 발송 레일을 안 탄다 — 강사가 ClassNote 반 보드에 직접 쓴다
 * (english-report-plan.md 실측: 8일간 847건인데 aywa `lesson_reports` 영어는 0건). 그래서 영어 발송
 * 실태는 aywa DB 어디에도 없고, **피드를 직접 훑어야만** 강사별·반별로 무엇이 나갔는지 보인다.
 *
 * ⚠️ **GET 전용** — ClassNote에 아무것도 쓰지 않는다(발송·수정·읽음 호출 금지, 특히
 *    `/api/v1/reports/{id}/read/`는 POST 추정이라 절대 호출 금지 — classnote-read-core.mjs 주석).
 *    aywa DB도 SELECT만. 몇 번을 돌려도 어떤 상태도 바뀌지 않는다.
 *
 * 실행(연동 PC가 아니어도 됨 — 조회는 어디서든 가능):
 *   node --env-file=.env.local scripts/_classnote/scan-english-posts.mjs [--days=35] [--out=경로.json]
 *
 * 출력: 콘솔 요약 + (--out 지정 시) 전체 집계 JSON.
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { kstDay } from "./english-posts-filter.mjs";

const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) ?? "").split("=")[1] || 35);
const OUT = (process.argv.find((a) => a.startsWith("--out=")) ?? "").split("=")[1] || null;
const PAGE_SIZE = 100;
const MAX_PAGES = 120; // 백스톱 — 실제 종료는 age 컷오프(피크 밀도 ~270건/일 × 35일 ≈ 95페이지)

/** 피드 1페이지 — classnote-feed-core.fetchFeedPage와 같은 계약(GET만). */
async function fetchFeedPage(page, centerId, cursor) {
  return page.evaluate(
    async ([c, cur, size]) => {
      const qs = new URLSearchParams({ page_size: String(size), tz: "Asia/Seoul", center_id: String(c) });
      if (cur) qs.set("page", cur);
      const r = await fetch(`/api/v1_2/centers/${c}/reports/?${qs}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`피드 조회 실패 HTTP ${r.status}`);
      const j = await r.json();
      return { list: j?.results ?? [], next: j?.next ?? null };
    },
    [centerId, cursor, PAGE_SIZE],
  );
}

/** 보드 버킷 — 수학/영어 1인 보드·전체방·그룹(영어 반) 구분. */
function bucketOf(board) {
  if (/^\(\s*수학\s*\)/.test(board)) return "math1p";
  if (/^\(\s*영어\s*\)/.test(board)) return "eng1p";
  if (/^\[ALL\]/i.test(board)) return "all";
  return "group";
}

/** 본문 필드 휴리스틱(english-report-plan.md의 포함률 검사와 같은 취지 — 근사치임을 전제로 읽을 것). */
const FIELD_PATTERNS = {
  진도: /진도|오늘\s*(배운|한)|수업\s*내용|Unit|Lesson|Chapter|Ch\.?\s*\d/i,
  과제: /과제|숙제|HW|homework|해오|해\s*오세요|풀어오/i,
  단어시험: /단어\s*(시험|테스트)|voca|보카|어휘/i,
  점수: /\d+\s*점|\d+\s*\/\s*\d+\s*(개|문제)?|score/i,
  기한: /까지|기한|마감|by\s+(mon|tue|wed|thu|fri|next)/i,
};

async function main() {
  if (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW) {
    throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env 필요(피드 조회에도 로그인 필요)");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const browser = await launchBrowser();
  const cutoff = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    const tenant = await resolveTenant(sql);
    console.log(`tenant=${tenant} · 창 ${DAYS}일(≥ ${cutoff}) · 읽기 전용`);

    const page = await browser.newPage();
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);

    // ── 피드 수집(age 컷오프 종료) ─────────────────────────────────────────────
    const rows = [];
    let cursor = null;
    let pages = 0;
    let reachedEnd = false;
    for (; pages < MAX_PAGES; pages++) {
      const { list, next } = await fetchFeedPage(page, centerId, cursor);
      rows.push(...list);
      if (!list.length || !next) {
        reachedEnd = true; // 피드 자체의 끝 — 창보다 얕으면 "피드 보존 한계"가 실측된 것
        break;
      }
      const oldest = list.map((r) => kstDay(r?.created)).filter(Boolean).sort()[0];
      if (oldest && oldest < cutoff) break; // 창 밖 진입 — 더 팔 이유 없음
      cursor = next;
    }
    const inWindow = rows.filter((r) => {
      const d = kstDay(r?.created);
      return d && d >= cutoff;
    });
    const oldestSeen = rows.map((r) => kstDay(r?.created)).filter(Boolean).sort()[0] ?? null;
    console.log(
      `피드 ${pages + 1}페이지 · 수집 ${rows.length}건 · 창 내 ${inWindow.length}건 · 최고(最古) ${oldestSeen}${reachedEnd ? " (피드 끝 도달 — 이보다 과거는 ClassNote가 안 보여줌)" : ""}`,
    );

    // ── 집계 — 학원 발송분(강사·기관)만, 학부모 글 제외 ───────────────────────
    const sent = inWindow.filter((r) => r?.author?.type === "teacher" || r?.author?.type === "admin");
    const byAuthor = new Map();
    const byBoard = new Map();
    const authorShapes = new Map(); // author 원시 구조 표본(필드명 확인용)
    for (const r of sent) {
      const board = String(r?.class_name ?? "").trim();
      const bucket = bucketOf(board);
      const day = kstDay(r?.created);
      const authorName = String(r?.author?.name ?? r?.author?.nickname ?? "(이름 없음)").trim();
      const content = typeof r?.content === "string" ? r.content : "";
      const read = Boolean(r?.read_by_parent?.date_read);
      if (!authorShapes.has(r?.author?.type) && r?.author) {
        authorShapes.set(r?.author?.type, Object.keys(r.author));
      }

      // 영어 쪽(그룹 반 보드 + 영어 1인 보드)만 강사별로 깊게 센다 — 수학은 lesson_reports가 진실.
      if (bucket === "group" || bucket === "eng1p") {
        const a = byAuthor.get(authorName) ?? {
          author: authorName,
          type: r?.author?.type,
          posts: 0,
          days: new Set(),
          boards: new Set(),
          children: new Set(),
          read: 0,
          lenSum: 0,
          fields: Object.fromEntries(Object.keys(FIELD_PATTERNS).map((k) => [k, 0])),
          samples: [],
        };
        a.posts += 1;
        if (day) a.days.add(day);
        a.boards.add(board);
        if (r?.child != null) a.children.add(r.child);
        if (read) a.read += 1;
        a.lenSum += content.length;
        for (const [k, re] of Object.entries(FIELD_PATTERNS)) if (re.test(content)) a.fields[k] += 1;
        if (a.samples.length < 2 && content.length > 40) {
          a.samples.push(`[${day} ${board}] ${content.slice(0, 180).replace(/\s+/g, " ")}`);
        }
        byAuthor.set(authorName, a);
      }

      const b = byBoard.get(board) ?? {
        board,
        bucket,
        posts: 0,
        days: new Set(),
        children: new Set(),
        authors: new Set(),
        read: 0,
        last: null,
      };
      b.posts += 1;
      if (day) b.days.add(day);
      if (r?.child != null) b.children.add(r.child);
      b.authors.add(authorName);
      if (read) b.read += 1;
      if (day && (!b.last || day > b.last)) b.last = day;
      byBoard.set(board, b);
    }

    // ── aywa 쪽 대조 재료(SELECT만) ────────────────────────────────────────────
    const [engClasses, engReports, longPosts] = await Promise.all([
      sql`
        select c.id, c.class_name, u.display_name as teacher, c.english_track,
               coalesce(array_agg(distinct cs.day_of_week) filter (where cs.day_of_week is not null), '{}') as dows
        from classes c
        left join users u on u.id = c.teacher_id
        left join class_schedules cs on cs.class_id = c.id
          and cs.valid_from <= current_date and (cs.valid_to is null or cs.valid_to >= current_date)
        where c.tenant_id = ${tenant} and c.subject = 'english' and c.is_active
          and (c.closed_at is null or c.closed_at >= current_date)
        group by c.id, c.class_name, u.display_name, c.english_track
        order by c.class_name`,
      sql`select count(*)::int as n from lesson_reports where tenant_id = ${tenant} and subject = 'english'`,
      sql`
        select board_name, count(*)::int as days, min(posted_on)::text as first, max(posted_on)::text as last
        from classnote_class_posts where tenant_id = ${tenant}
        group by board_name order by board_name`,
    ]);

    const authors = [...byAuthor.values()]
      .map((a) => ({
        ...a,
        days: a.days.size,
        boards: [...a.boards].sort(),
        children: a.children.size,
        avgLen: a.posts ? Math.round(a.lenSum / a.posts) : 0,
        readRate: a.posts ? Math.round((a.read / a.posts) * 100) : 0,
        fieldsPct: Object.fromEntries(
          Object.entries(a.fields).map(([k, n]) => [k, a.posts ? Math.round((n / a.posts) * 100) : 0]),
        ),
      }))
      .sort((x, y) => y.posts - x.posts);
    const boards = [...byBoard.values()]
      .map((b) => ({
        ...b,
        days: b.days.size,
        children: b.children.size,
        authors: [...b.authors].sort(),
        readRate: b.posts ? Math.round((b.read / b.posts) * 100) : 0,
      }))
      .sort((x, y) => y.posts - x.posts);

    // ── 콘솔 요약 ─────────────────────────────────────────────────────────────
    console.log(`\n=== 영어 쪽 발송(그룹 반 보드 + (영어) 1인 보드), 최근 ${DAYS}일 ===`);
    console.log(`author 필드 표본: ${JSON.stringify([...authorShapes.entries()])}`);
    for (const a of authors) {
      console.log(
        `\n■ ${a.author} (${a.type}) — ${a.posts}건 · ${a.days}일 · 보드 ${a.boards.length}개 · 원아 ${a.children}명 · 평균 ${a.avgLen}자 · 학부모 읽음 ${a.readRate}%`,
      );
      console.log(`  필드: ${Object.entries(a.fieldsPct).map(([k, v]) => `${k} ${v}%`).join(" · ")}`);
      for (const s of a.samples) console.log(`  예: ${s}`);
    }
    console.log(`\n=== 보드별(발송 있는 곳 전부) ===`);
    for (const b of boards) {
      console.log(
        `${b.bucket.padEnd(6)} ${b.board} — ${b.posts}건/${b.days}일 · 원아 ${b.children} · 마지막 ${b.last} · 읽음 ${b.readRate}% · 작성자 ${b.authors.join(",")}`,
      );
    }
    console.log(`\n=== aywa 대조 ===`);
    console.log(`영어 활성 반 ${engClasses.length}개 · aywa lesson_reports 영어 ${engReports[0].n}건(전 기간)`);
    console.log(`classnote_class_posts 누적 보드 ${longPosts.length}개`);

    if (OUT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        OUT,
        JSON.stringify(
          {
            scannedAt: new Date().toISOString(),
            windowDays: DAYS,
            cutoff,
            oldestSeen,
            reachedEnd,
            feedRows: rows.length,
            inWindow: inWindow.length,
            sentRows: sent.length,
            authors,
            boards,
            engClasses,
            engReportsInAywa: engReports[0].n,
            longPosts,
          },
          (_k, v) => (v instanceof Set ? [...v] : v),
          1,
        ),
      );
      console.log(`\nJSON 저장: ${OUT}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
