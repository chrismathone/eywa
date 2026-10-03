import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { videoHomeworkKept } from "./report-owner";

const A = "teacher-a";
const B = "teacher-b";
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("② videoHomeworkKept — 영상 과제는 작성 계정만 바꾼다(값만 두고 나머지는 저장)", () => {
  it("새 줄은 누구든 적는다(이번 저장이 작성 계정이 된다)", () => {
    expect(videoHomeworkKept({ prior: null, wanted: true, userId: B })).toBeNull();
  });

  it("작성자는 켜고 끈다", () => {
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: false }, wanted: true, userId: A })).toBeNull();
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: true }, wanted: false, userId: A })).toBeNull();
  });

  it("다른 선생님이 값을 바꾸면 지금 값을 둔다(켜기·끄기·모름에서 정하기 모두)", () => {
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: false }, wanted: true, userId: B })).toEqual({ kept: false });
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: true }, wanted: false, userId: B })).toEqual({ kept: true });
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: null }, wanted: true, userId: B })).toEqual({ kept: null });
  });

  it("다른 선생님이라도 값이 그대로면 해당 없음", () => {
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: true }, wanted: true, userId: B })).toBeNull();
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: false }, wanted: false, userId: B })).toBeNull();
  });

  it("값을 안 보낸 저장은 판정하지 않는다", () => {
    expect(videoHomeworkKept({ prior: { createdBy: A, videoHomework: true }, wanted: undefined, userId: B })).toBeNull();
  });

  it("작성 계정이 빈 줄(사무실이 먼저 쓴 줄·옛 줄)은 해당 없음", () => {
    expect(videoHomeworkKept({ prior: { createdBy: null, videoHomework: null }, wanted: true, userId: B })).toBeNull();
  });
});

describe("② 원스크린 저장 관문이 이 판정을 쓴다", () => {
  const src = read("src", "features", "onescreen", "server", "actions.ts");
  const start = src.indexOf("export async function saveLessonReport(");
  const end = src.indexOf("\nexport async function ", start + 1);
  const body = src.slice(start, end === -1 ? undefined : end);

  it("판정은 첫 쓰기(보강 반 변경·upsert)보다 앞이고, 거절하지 않는다", () => {
    expect(start).toBeGreaterThan(-1);
    const guard = body.indexOf("videoHomeworkKept(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("claimMakeupAnchorChange("));
    expect(guard).toBeLessThan(body.indexOf(".upsert("));
    expect(body).not.toMatch(/if \(keptVideoHw\) return/);
  });

  it("두는 경우 영상 과제·첨부 링크 값을 upsert에 싣지 않고, 둔 값을 돌려준다", () => {
    expect(body).toMatch(/typeof input\.videoHomework === "boolean" && !keptVideoHw \? \{ video_homework:/);
    expect(body).toMatch(/typeof input\.videoSubmitLink === "boolean" && !keptVideoHw \? \{ video_submit_link:/);
    expect(body).toMatch(/keptVideoHomework: keptVideoHwFinal\.kept/);
  });

  it("동시 첫 저장 — 저장된 값을 되받아, DB가 남의 값을 지켰으면 그 값을 화면에 알린다", () => {
    expect(body).toMatch(/\.select\(videoHwReady \? "id, share_token, teacher_name, created_by, video_homework" : "id, share_token, teacher_name, created_by"\)\s*\.single\(\)/);
    expect(body).toMatch(/data\.created_by !== user\.id && \(data\.video_homework \?\? null\) !== input\.videoHomework/);
    expect(body).toMatch(/const keptVideoHwFinal = keptVideoHw \?\? raceKept;/);
  });

  it("판정 재료(지금 값)를 미리 읽는다 — 칸이 확인됐을 때만(#95)", () => {
    expect(body).toMatch(/videoHwReady \? ", video_homework" : ""/);
  });

  it("발송(saveAndQueueClassnote)도 둔 값을 화면에 넘긴다", () => {
    const send = src.slice(src.indexOf("export async function saveAndQueueClassnote("));
    expect(send).toMatch(/keptVideoHomework: saved\.keptVideoHomework/);
  });

  // 쓰기 = `video_homework: <값>`(타입 표기 `boolean`·한글 라벨 문자열은 뺀다).
  it("영상 과제 값을 쓰는 곳은 원스크린 저장 하나다(새 쓰기 경로가 생기면 판정도 함께)", () => {
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name.name) && !/\.test\./.test(name.name) && /\bvideo_homework:(?!\s*(?:boolean\b|"))/.test(readFileSync(p, "utf8"))) writers.push(p.replaceAll("\\", "/"));
      }
    };
    walk(join(process.cwd(), "src"));
    expect(writers.map((p) => p.slice(p.indexOf("src/")))).toEqual(["src/features/onescreen/server/actions.ts"]);
  });
});

describe("① 화면 겹 — 남이 처음 쓴 줄은 잠그고 싣지 않는다", () => {
  const client = read("src", "features", "onescreen", "components", "onescreen-client.tsx");

  it("토글이 남이 쓴 줄을 잠근다(두 화면 모두 학생 id를 넘긴다)", () => {
    const toggle = read("src", "features", "video-homework", "components", "video-homework-toggle.tsx");
    expect(toggle).toMatch(/const locked = disabled \|\| !saveOk \|\| byOther;/);
    // 잠긴 줄의 체크 표시는 저장된 값 — 화면을 연 뒤 잠긴 줄은 내 화면 값이 내가 누른 값으로 남아 있다(재리뷰).
    expect(toggle).toMatch(/const shown = byOther && studentId \? savedToday\(studentId, classId\) === true : checked;/);
    expect(toggle.match(/checked=\{shown\}/g)?.length).toBe(2);
    for (const f of ["grid-row.tsx", "report-card.tsx"]) {
      const src = read("src", "features", "onescreen", "components", f);
      const at = src.indexOf("<VideoHomeworkToggle");
      expect(src.slice(at, src.indexOf("/>", at))).toMatch(/studentId=\{student\.id\}/);
    }
  });

  it("저장 입력·일괄 적용이 남이 쓴 줄엔 값을 싣지 않는다", () => {
    expect(client).toMatch(/!videoHwByOther\(student\.id, su\.classId\) &&\s*isVideoHomeworkEnabled/);
    expect(client).toMatch(/videoOk:\s*videoHwSaveOk && !!videoHwPolicy && !!r\.subject\.classId && !videoHwByOther\(r\.student\.id, r\.subject\.classId\)/);
  });

  it("서버가 둔 값으로 화면을 되돌린다 — 저장·발송·첨부 자동저장 세 곳", () => {
    expect(client.match(/applyKeptVideoHomework\((student\.id|studentId), subjectName, (res|saved)\);/g)?.length).toBe(3);
  });

  it("둔 값을 받은 줄은 잠금에 더한다 — 다시 눌러 또 되돌려지지 않게", () => {
    expect(client).toMatch(/videoHwStore\?\.markKept\(studentId, keptClassId, kept\)/);
    const provider = read("src", "features", "video-homework", "components", "video-homework-provider.tsx");
    expect(provider).toMatch(/store\.othersReports\.has\(key\) \|\| key in store\.keptToday/);
    expect(provider).toMatch(/key in store\.keptToday \? store\.keptToday\[key\] : assignmentOf\(/);
  });

  it("남이 쓴 줄은 세션 값 대신 저장된 값을 보여 준다", () => {
    const page = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(page).toMatch(/othersReports\.has\(assignmentKey\(st\.id, roster\.date, su\.classId\)\)/);
    expect(page).toMatch(/othersReports=\{othersReportKeys\}/);
  });
});

describe("③ DB 겹(0336a) — 직접 쓰기·동시 첫 저장까지", () => {
  const sql = read("supabase", "migrations", "0336a_lesson_reports_video_homework_owner.sql");
  const body = sql.slice(sql.indexOf("create or replace function"));

  it("로그인 사용자의 갱신에서 작성 계정이 내가 아니면 원래 값을 둔다(거절하지 않는다)", () => {
    expect(body).toMatch(/old\.created_by is not null/);
    expect(body).toMatch(/auth\.uid\(\) is not null/);
    expect(body).toMatch(/auth\.uid\(\) <> old\.created_by/);
    expect(body).toMatch(/new\.video_homework := old\.video_homework/);
    expect(body).not.toMatch(/raise exception/i);
    expect(body).toMatch(/before update of video_homework on public\.lesson_reports/);
  });

  it("없을 수 있는 칸(video_submit_link)을 함수 본문에서 읽지 않는다 — 갱신을 통째로 죽이지 않게", () => {
    expect(body).not.toMatch(/video_submit_link/);
  });
});
