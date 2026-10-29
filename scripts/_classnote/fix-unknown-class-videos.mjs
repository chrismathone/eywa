// scripts/_classnote/fix-unknown-class-videos.mjs — 이미 올라간 **반미정 영상**(route.classId 없음)의 반을 다시 정한다.
//
// 원장 2026-10-29: *"박세욱 반미정이 버그라면, 전체 반미정 학생에 대해 검토해봐야함"* → *"바로잡는 방법으로 규칙 보강해. 숙제를 기준으로
// 반미정 해결할것."* 영상 제출 현황(장부)은 **반이 정해진 영상만** 숙제에 붙이므로(rounds.ts ⓪) 반미정 영상은 어느 숙제에도 안 들었다.
//
// 정하는 순서(위가 이긴다):
//   (담임이 손으로 배정한 영상은 대상이 아니다 — 장부 뷰가 이미 배정 반으로 센다.)
//   워커와 같은 판정(`chooseVideoTeacher`) — 게시일에 다니던 반 중 영상 숙제를 낸 반 하나(숙제일 ≤ 게시일 ≤ 숙제일 + 14),
//      과목을 모르면(보드 이름 없음) 그날 반이 하나뿐일 때 그 반. 게시 과목은 영상 줄의 `subject`로 본다(보드 이름은 업로드 뒤 지워졌다).
//   못 정하면 그대로 둔다(추측하지 않는다).
// 바꾸는 것: 영상 줄의 route(classId · className · teacherId · folderName · subject · reason) · teacher_id · subject 칸.
//   🔴 Drive 파일 이름·폴더는 **바꾸지 않는다**(여기엔 Drive 연결이 없다) — `route.driveFix = "pending"`으로 표시만 해 둔다.
//
//   node --env-file=.env.local scripts/_classnote/fix-unknown-class-videos.mjs                 # 드라이런(쓰기 0 · 숫자만)
//   node --env-file=.env.local scripts/_classnote/fix-unknown-class-videos.mjs --apply         # 백업 뒤 쓰기
//   node --env-file=.env.local scripts/_classnote/fix-unknown-class-videos.mjs --revert=<백업.json>
//   (--backup-dir=<폴더> — 기본 D:/tmp/video-unknown-class-backup · 학생 이름은 화면에 찍지 않는다)
import postgres from "postgres";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOARD_GROUPS } from "./classnote-admin-core.mjs";
import { chooseVideoTeacher, kstDay, loadHomeworkClassIds, loadStudentClassesOn } from "./video-teacher-route.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = process.argv.includes("--apply");
const REVERT = arg("revert");
const BACKUP_DIR = arg("backup-dir") ?? "D:/tmp/video-unknown-class-backup";
const FIXED_REASON = "반미정 정리(2026-10-29) — 담임 배정 또는 숙제로 반을 정함";
/** 감사로그 행위자 — 시스템 스크립트(`describe.ts` SYSTEM_ACTOR_LABEL). */
const ACTOR = "system:video-unknown-class-fix";

/** 영상 줄 과목 → 보드 이름 꼴(판정기가 과목을 읽는 자리). 모르면 빈 이름 = 과목 모름. */
const boardNameOf = (subject) => Object.values(BOARD_GROUPS).find((g) => g.subjectKeys.includes(subject))?.prefix ?? "";

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const READ_ONLY = !APPLY && !REVERT;
try {
  if (READ_ONLY) await sql`set session characteristics as transaction read only`;
  if (REVERT) {
    const backup = JSON.parse(readFileSync(REVERT, "utf8"));
    if (backup.status !== "committed") throw new Error("확정되지 않은 백업입니다(적용이 끝나지 않았다) — 감사로그와 함께 확인하세요.");
    let restored = 0;
    await sql.begin(async (tx) => {
      for (const r of backup.rows) {
        // 이 정리가 남긴 상태 그대로일 때만 되돌린다(그 뒤 워커·담임 배정·Drive 정리가 바꿨으면 건드리지 않는다 · 리뷰 2026-10-29).
        const back = await tx`update student_homework_videos set route = ${tx.json(r.route)}, teacher_id = ${r.teacher_id}, subject = ${r.subject}, updated_at = now()
          where id = ${r.id} and tenant_id = ${r.tenant_id} and route->>'classId' = ${r.appliedClassId} and route->>'driveFix' = 'pending' returning id`;
        if (!back.length) continue;
        restored++;
        await tx`insert into audit_logs (tenant_id, actor_name, action, target_type, target_label, metadata)
          values (${r.tenant_id}, ${ACTOR}, 'video_unknown_class_fix', 'student_homework_video', '반미정 영상 되돌리기',
            ${tx.json({ how: "revert", videoId: r.id, backup: REVERT })})`;
      }
    });
    console.log(`되돌림: ${restored}/${backup.rows.length}줄(그 뒤 바뀐 줄은 그대로 둠)`);
  } else {
    // 담임이 손으로 배정한 영상은 빼다 — 장부 뷰(homework_video_ledger_videos)가 이미 배정 반을 덮어 숙제에 들어 있고, 영상 줄에 반을 박으면
    // 담임이 배정을 지운 뒤에도 그 반에 남는다(리뷰 2026-10-29).
    const rows = await sql`select v.id, v.tenant_id, v.student_id, v.subject, v.teacher_id, v.posted_at, v.route
      from student_homework_videos v
      where v.status = 'uploaded' and (v.route->>'classId') is null and v.student_id is not null
        and not exists (select 1 from homework_video_assignments a where a.video_id = v.id and a.tenant_id = v.tenant_id)
      order by v.posted_at`;
    const plans = [];
    const tally = { 대상: rows.length, 숙제: 0, 반하나: 0, 못정함: 0 };
    for (const v of rows) {
      const day = kstDay(v.posted_at);
      const classes = await loadStudentClassesOn(sql, v.tenant_id, v.student_id, day);
      const homeworkClassIds = await loadHomeworkClassIds(sql, v.tenant_id, v.student_id, classes, day);
      const route = chooseVideoTeacher({ video: { boardName: boardNameOf(v.subject) }, tenantId: v.tenant_id, studentIds: [v.student_id], boardClassIds: [], classes, homeworkClassIds,
        student: { name: v.route?.studentName ?? null, school: v.route?.school ?? null, grade: v.route?.grade ?? null } });
      if (!route.classId) { tally.못정함++; continue; }
      const how = homeworkClassIds.includes(route.classId) && new Set(classes.map((c) => c.class_id)).size > 1 ? "숙제" : "반하나";
      tally[how]++;
      // 숙제일·보관 정보 등 원래 route의 다른 칸은 그대로 두고 반만 바꾼다. 담임을 못 정했으면(미지정·비활성) 담임·폴더는 원래 값 그대로(리뷰).
      const teacherKnown = !!route.teacherId;
      const next = { ...v.route, classId: route.classId, className: route.className,
        teacherId: teacherKnown ? route.teacherId : (v.route?.teacherId ?? v.teacher_id ?? null),
        folderName: teacherKnown ? route.folderName : (v.route?.folderName ?? route.folderName),
        subject: route.subject ?? v.route?.subject ?? v.subject ?? null, reason: `${FIXED_REASON} · ${route.reason}`, driveFix: "pending" };
      plans.push({ v, next, how, day });
    }
    console.log(tally);
    const teachers = plans.reduce((m, p) => ((m[p.next.folderName] = (m[p.next.folderName] ?? 0) + 1), m), {});
    console.log("담임 폴더별:", teachers);
    if (!APPLY) {
      console.log("드라이런 — 쓰지 않았다(--apply로 쓴다).");
    } else {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const file = join(BACKUP_DIR, `unknown-class-videos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      // 먼저 '준비됨'으로 남기고, 거래가 끝나면 **실제로 바꾼 줄만** '확정'으로 다시 쓴다(되돌리기는 확정 백업만 받는다 · 리뷰).
      const backupRow = ({ v, next }) => ({ id: v.id, tenant_id: v.tenant_id, route: v.route, teacher_id: v.teacher_id, subject: v.subject, appliedClassId: next.classId });
      writeFileSync(file, JSON.stringify({ status: "prepared", rows: plans.map(backupRow) }, null, 1));
      const applied = [];
      await sql.begin(async (tx) => {
        for (const p of plans) {
          const { v, next, how, day } = p;
          // 그사이 워커가 반을 정했으면 덮지 않는다(classId가 여전히 비었을 때만) — 바뀐 줄에만 감사로그.
          const changed = await tx`update student_homework_videos set route = ${tx.json(next)}, teacher_id = ${next.teacherId}, subject = ${next.subject}, updated_at = now()
            where id = ${v.id} and tenant_id = ${v.tenant_id} and (route->>'classId') is null returning id`;
          if (!changed.length) continue;
          applied.push(p);
          // 원장 2026-10-29 "구현건에 대해서 감사로그 배정까지" — 영상마다 한 줄(학생 이름은 싣지 않는다 · 반·담임·근거만).
          await tx`insert into audit_logs (tenant_id, actor_name, action, target_type, target_label, metadata)
            values (${v.tenant_id}, ${ACTOR}, 'video_unknown_class_fix', 'student_homework_video', ${`반미정 → ${next.className ?? "반"}`},
              ${tx.json({ how, videoId: v.id, studentId: v.student_id, postedOn: day, classId: next.classId, className: next.className,
                teacherId: next.teacherId, folderName: next.folderName, driveFix: "pending", backup: file })})`;
        }
      });
      writeFileSync(file, JSON.stringify({ status: "committed", committedAt: new Date().toISOString(), rows: applied.map(backupRow) }, null, 1));
      console.log(`썼다: ${applied.length}/${plans.length}줄 · 되돌리기: --revert=${file}`);
    }
  }
} finally {
  if (READ_ONLY) await sql`reset all`.catch(() => {});
  await sql.end();
}
