import postgres from "postgres";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { DRIVE_API as API, driveClient, driveJson } from "./video-drive-http.mjs";
import { decideManualVideo, DUPLICATE_REASON, isVideoFile, manualPostedAt, MANUAL_NAME_SINCE, markDuplicate, namedStudents,
  parseManualVideoName } from "./video-manual-name.mjs";
import { loadWorkerVideoDriveSetting } from "./video-drive-settings.mjs";

/**
 * 담임 폴더에 **사람이 직접 올린** 숙제 영상을 훑어 학생·반에 붙인다(원장 2026-10-01 — 학부모가 ClassNote에 못 올린 영상을
 * 선생님·관리자가 받아 워커와 같은 담임 폴더(`이수진 선생님` 등)에 자동 업로드와 같은 이름 양식으로 올린다).
 *
 * - 🔴 Drive는 **읽기만**(files.list). 옮기지도, 이름을 바꾸지도, 지우지도 않는다 — 폴더가 곧 사람의 의도다.
 * - 대상 = 영상 루트 바로 아래 폴더들의 **바로 아래** 영상 파일. 등록부(`classnote_video_folders`)의 이 지점 폴더면 그 담임을 기록하고,
 *   사람이 만든 폴더(아직 워커가 만들지 않은 선생님 폴더 등)는 담임 칸을 비운 채 읽는다(조용히 버려지지 않게) — 단 영상 루트를
 *   다른 지점과 함께 쓰면 등록부 밖 폴더는 읽지 않고, 다른 지점 워커의 폴더는 언제나 읽지 않는다.
 * - 워커가 올린 파일(`appProperties.aywaSource` · 파일 등록부 · ClassNote/링크 행의 Drive 파일)은 건너뛴다.
 * - 결과는 `student_homework_videos`의 `source='drive'` 행(파일 하나 = 행 하나, `source_ref` = Drive 파일 ID).
 *   붙으면 `uploaded`, 못 붙거나 같은 내용이 이미 있으면 `review`(학생·반을 비워 학생 탭·장부에 안 잡힌다).
 * - 이름을 고치거나 폴더를 옮기면 다음 훑기에 다시 판정하고, 파일이 폴더에서 사라지면 그 행도 지운다(Drive가 진실).
 * - 0324a 전 DB에서는 아무것도 하지 않는다(#95).
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,size,md5Checksum,createdTime,appProperties";
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 훑는 간격 — 사람이 올리고 화면에서 확인하기까지 기다릴 만한 시간. 한 바퀴 = Drive 목록 요청 (폴더 수 + 1)번. */
export const MANUAL_SCAN_INTERVAL_MS = 10 * 60_000;
const kstToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

async function listAll(request, q) {
  const files = [];
  let pageToken = null;
  for (let page = 0; ; page++) {
    if (page >= 50) throw new Error("Drive 목록이 너무 길어 이번 주기는 건너뜁니다.");
    const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: "1000", spaces: "drive",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const body = await driveJson(await request(`${API}/files?${params}`), "직접 올린 영상 목록");
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken ?? null;
    if (!pageToken) return files;
  }
}

/** 0324a가 적용됐나 — 출처 칸 둘이 다 있어야 직접 올린 영상을 담을 수 있다. */
export async function manualSchemaReady(sql) {
  const [row] = await sql`select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'student_homework_videos' and column_name in ('source', 'source_ref')`;
  return row?.n === 2;
}

/**
 * 이번에 읽을 폴더 = 루트 바로 아래 폴더(등록부 폴더는 담임 ID와 함께, 나머지는 담임 없이) + 이번에 못 본 폴더 중
 * **휴지통에 있거나 없어진 것**(`vanished` — 파일 없이, 그 폴더에 있던 직접 업로드 행을 정리하려고). 루트 밖으로 옮겨졌을 뿐인 폴더는 보지 않는다.
 * 🔴 지점 분리: 다른 지점 워커가 만든 폴더(`appProperties.aywaTeacher`가 다른 지점 키)는 읽지 않고, 영상 루트를 다른 지점과 함께 쓰면
 *    등록부 밖 폴더는 누구 것인지 모르므로 아예 읽지 않는다(남의 지점 학생 이름이 든 파일이 이 지점 안내·학생에 새지 않게).
 * 등록부 키 = `지점:기관:담임|unassigned`.
 * @param rowFolderIds 이미 기록한 직접 업로드 행들의 폴더 — 이번에 못 봤으면 휴지통·삭제 여부를 확인한다.
 */
async function scanFolders(sql, request, tenant, rootId, rowFolderIds) {
  const [registry, [{ shared }]] = await Promise.all([
    sql`select route_key, drive_folder_id from classnote_video_folders where tenant_id = ${tenant} and root_folder_id = ${rootId}`,
    sql`select exists(select 1 from classnote_video_folders where root_folder_id = ${rootId} and tenant_id <> ${tenant}) as shared`,
  ]);
  const children = await listAll(request, `'${rootId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`);
  const teacherOf = new Map(registry.flatMap((row) => {
    const [keyTenant, , teacher] = String(row.route_key).split(":");
    return keyTenant === tenant && DRIVE_ID.test(row.drive_folder_id) ? [[row.drive_folder_id, UUID.test(teacher ?? "") ? teacher : null]] : [];
  }));
  const othersFolder = (folder) => !!folder.appProperties?.aywaTeacher && !String(folder.appProperties.aywaTeacher).startsWith(`${tenant}:`);
  const folders = children.filter((folder) => DRIVE_ID.test(folder.id) && !othersFolder(folder)
      && (teacherOf.has(folder.id) || !shared))
    .map((folder) => ({ id: folder.id, name: folder.name, teacherId: teacherOf.get(folder.id) ?? null, unregistered: !teacherOf.has(folder.id) }));
  const seen = new Set(folders.map((folder) => folder.id));
  const vanished = [];
  for (const id of new Set([...teacherOf.keys(), ...rowFolderIds])) {
    if (seen.has(id) || !DRIVE_ID.test(id ?? "")) continue;
    const response = await request(`${API}/files/${id}?supportsAllDrives=true&fields=id,trashed`);
    if (response.status === 404 || (response.ok && (await response.json()).trashed)) vanished.push(id);
    else if (!response.ok) throw new Error(`담임 폴더 확인 HTTP ${response.status}`);
  }
  // 폴더 주인이 지워진 직원이면 담임 칸을 비운다(그대로 쓰면 외래키 오류로 바퀴 전체가 멈춘다).
  const teacherIds = [...new Set(folders.map((folder) => folder.teacherId).filter(Boolean))];
  const known = new Set(teacherIds.length ? (await sql`select id from users where tenant_id = ${tenant}
    and id = any(${teacherIds}::uuid[])`).map((row) => row.id) : []);
  return { folders: folders.map((folder) => ({ ...folder, teacherId: known.has(folder.teacherId) ? folder.teacherId : null })), vanished };
}

const sameOutcome = (row, decision, file, folder) => row.status === decision.status && (row.student_id ?? null) === decision.studentId
  && (row.route?.classId ?? null) === decision.classId && (row.route?.reason ?? null) === decision.reason
  && (row.route?.fileName ?? null) === file.name && row.drive_folder_id === folder.id && (row.route?.duplicateOf ?? null) === (decision.duplicateOf ?? null);

/**
 * 한 바퀴. 반환 = { linked, review, removed, ignored } (이번에 바뀐 것만 센다).
 * @param auth videoDriveAuth() 결과(accessToken만 쓴다 — 읽기 요청뿐)
 */
export async function scanManualDriveVideos(sql, tenant, { rootId, auth, log = console.log, now = new Date() }) {
  if (!UUID.test(tenant)) throw new Error("지점 식별자가 올바르지 않습니다.");
  if (!DRIVE_ID.test(rootId ?? "")) throw new Error("영상 저장 폴더 ID가 필요합니다.");
  const request = driveClient(auth);
  const today = kstToday(now);
  const rows = await sql`select id, source_ref, status, student_id, drive_folder_id, route from student_homework_videos
    where tenant_id = ${tenant} and source = 'drive'`;
  // 사라진 폴더 확인은 이번 루트의 등록부와, 이번 루트로 찍힌 직접 제출 행만. 예전 루트 기록은 공유가 빠져도 지우지 않는다.
  const currentRootFolderIds = rows.filter((row) => row.route?.rootId === rootId).map((row) => row.drive_folder_id);
  const { folders, vanished } = await scanFolders(sql, request, tenant, rootId, currentRootFolderIds);
  const listed = new Map();
  // 폴더 하나라도 못 읽으면 여기서 멈춘다(아래 '사라진 파일 정리'가 못 읽은 폴더의 행을 지우지 않게).
  for (const folder of folders)
    for (const file of await listAll(request, `'${folder.id}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`))
      if (!listed.has(file.id)) listed.set(file.id, { file, folder });
  const ids = [...listed.keys()];
  const workerFiles = await sql`select drive_file_id from classnote_video_files where tenant_id = ${tenant} and drive_file_id = any(${ids}::text[])
    union select drive_file_id from student_homework_videos where tenant_id = ${tenant} and source <> 'drive'
      and drive_file_id = any(${ids}::text[])`;
  const byWorker = new Set(workerFiles.map((row) => row.drive_file_id));
  const byFile = new Map(rows.map((row) => [row.source_ref, row]));
  const manual = [...listed.values()]
    .filter(({ file }) => !file.appProperties?.aywaSource && !byWorker.has(file.id) && isVideoFile(file))
    .sort((a, b) => String(a.file.createdTime).localeCompare(String(b.file.createdTime)) || a.file.id.localeCompare(b.file.id));
  const result = { linked: 0, review: 0, removed: 0, ignored: 0 };
  let students = null;
  for (const { file, folder } of manual) {
    const row = byFile.get(file.id);
    // 붙은 행은 이름·폴더가 그대로면 다시 보지 않는다(학생이 지워져 비었으면 다시 본다). 확인 필요 행은 매번 다시 본다
    // (학생 등록·수강 정리 뒤 저절로 풀리게).
    if (row?.status === "uploaded" && row.student_id && row.route?.fileName === file.name && row.drive_folder_id === folder.id) continue;
    const parsed = parseManualVideoName(file.name, { today });
    if (!parsed.ok && !row && Date.parse(file.createdTime) < Date.parse(MANUAL_NAME_SINCE)) { result.ignored++; continue; }
    students ??= await sql`select id, name, school, grade, status, enrolled_at::text as enrolled_at,
      withdrawn_at::text as withdrawn_at from students where tenant_id = ${tenant}`;
    const named = namedStudents(parsed, students);
    const enrollments = named.length ? await sql`select e.student_id, e.class_id, e.start_date::text as start_date,
        e.end_date::text as end_date, e.is_transferred, e.on_hold, c.closed_at::text as closed_at, c.class_name, c.subject, c.teacher_id
      from enrollments e join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
      where e.tenant_id = ${tenant} and e.student_id = any(${named.map((s) => s.id)}::uuid[])` : [];
    const bytes = Number.isSafeInteger(Number(file.size)) ? Number(file.size) : null;
    const md5 = /^[0-9a-f]{32}$/i.test(file.md5Checksum ?? "") ? file.md5Checksum.toLowerCase() : null;
    let decision = decideManualVideo({ parsed, students: named, enrollments, folder });
    // 같은 학생의 같은 내용이 이미 보관돼 있으면(ClassNote 수집분·먼저 올린 사본) 따로 세지 않는다 — 규칙은 markDuplicate.
    // 확인 필요 행끼리는 서로 막지 않는다.
    if (decision.status === "uploaded" && md5 && bytes !== null)
      decision = markDuplicate(decision, await sql`select id, student_id, route->>'classId' as class_id from student_homework_videos
        where tenant_id = ${tenant} and md5 = ${md5} and bytes = ${bytes} and status <> 'review' and student_id = ${decision.studentId}
          and not (source = 'drive' and source_ref = ${file.id}) order by created_at, id`);
    if (row && sameOutcome(row, decision, file, folder)) continue;
    const route = { tenantId: tenant, rootId, source: "drive", fileName: file.name, folderId: folder.id, folderName: folder.name,
      date: parsed.ok ? parsed.date : null, studentId: decision.studentId, studentName: decision.studentName, school: decision.school,
      grade: decision.grade, subject: decision.subject, classId: decision.classId, className: decision.className,
      teacherId: decision.teacherId, reason: decision.reason, duplicateOf: decision.duplicateOf ?? null };
    await sql`insert into student_homework_videos (tenant_id, source, source_ref, student_id, subject, teacher_id, posted_at, status,
        drive_file_id, drive_folder_id, bytes, md5, route, uploaded_at)
      values (${tenant}, 'drive', ${file.id}, ${decision.studentId}, ${decision.subject}, ${decision.teacherId},
        ${parsed.ok ? manualPostedAt(parsed.date) : null}, ${decision.status}, ${file.id}, ${folder.id}, ${bytes}, ${md5},
        ${sql.json(route)}, ${file.createdTime ?? null})
      on conflict (tenant_id, source, source_ref) do update set student_id = excluded.student_id, subject = excluded.subject,
        teacher_id = excluded.teacher_id, posted_at = excluded.posted_at, status = excluded.status,
        drive_folder_id = excluded.drive_folder_id, bytes = excluded.bytes, md5 = excluded.md5,
        route = case when coalesce(student_homework_videos.route->>'rootId', '') <> ''
          then jsonb_set(excluded.route, '{rootId}', to_jsonb(student_homework_videos.route->>'rootId'))
          else excluded.route end,
        error = null, updated_at = now()`;
    result[decision.status === "uploaded" ? "linked" : "review"]++;
  }
  // 같은 내용이 나중에 ClassNote 등에서 들어오면(워커 수집) 직접 올린 쪽을 빼 둔다 — 한 영상을 두 번 세지 않게.
  // 조건은 markDuplicate와 같다: 같은 학생이고, 그 행이 반까지 정해졌거나 직접 올린 쪽도 반을 모를 때만.
  const lateDuplicates = await sql`update student_homework_videos d set status = 'review', student_id = null, subject = null,
      teacher_id = null, updated_at = now(), route = coalesce(d.route, '{}'::jsonb) || jsonb_build_object('studentId', null,
        'studentName', null, 'school', null, 'grade', null, 'classId', null, 'className', null, 'subject', null, 'teacherId', null,
        'duplicateOf', c.id, 'reason', ${DUPLICATE_REASON}::text)
    from student_homework_videos c
    where d.tenant_id = ${tenant} and c.tenant_id = ${tenant} and d.source = 'drive' and d.status = 'uploaded'
      and c.source <> 'drive' and c.status = 'uploaded' and c.md5 = d.md5 and c.bytes = d.bytes
      and c.student_id = d.student_id and (c.route->>'classId' is not null or d.route->>'classId' is null)
    returning d.id`;
  result.review += lateDuplicates.length;
  // 폴더에서 사라진 파일(지움·휴지통·다른 곳으로 옮김)의 행은 지운다 — 모든 폴더를 끝까지 읽은 바퀴에서만, 그리고 **이번에 읽은 폴더
  // (+ 이번에 못 본 폴더 중 휴지통·없어진 것)에 있던 행만**(루트 밖으로 옮겨졌을 뿐인 폴더의 파일은 사라진 게 아니다).
  const scanned = new Set([...folders.map((folder) => folder.id), ...vanished]);
  const present = new Set(manual.map(({ file }) => file.id));
  const gone = rows.filter((row) => scanned.has(row.drive_folder_id) && !present.has(row.source_ref)).map((row) => row.id);
  if (gone.length) {
    const removed = await sql`delete from student_homework_videos where tenant_id = ${tenant} and source = 'drive'
      and id = any(${gone}::uuid[]) returning id`;
    result.removed = removed.length;
  }
  if (result.linked || result.review || result.removed)
    log(`[영상 직접 제출] 새로 연결 ${result.linked}건 · 확인 필요 ${result.review}건 · 정리 ${result.removed}건`
      + (result.review ? " — 수업보고서 → 영상숙제 확인에서 볼 수 있습니다." : ""));
  return result;
}

let nextScanAt = 0;
let lastNotice = null;

/**
 * 워커 주기에서 부르는 진입점 — 10분마다 한 번, 실패해도 던지지 않는다(ClassNote 영상 작업을 막지 않게).
 * rootId 가 없으면 저장된 활성 루트만 훑는다. env 폴더는 기본값이 아니다.
 * 같은 안내(DB 준비 전·실패 사유)는 바뀔 때 한 번만 로그에 남긴다.
 */
export async function runManualDriveScan(tenant, { log = console.log, authFactory = videoDriveAuth, sqlFactory, now = Date.now(), rootId, env } = {}) {
  if (now < nextScanAt) return null;
  nextScanAt = now + MANUAL_SCAN_INTERVAL_MS;
  const notice = (text) => { if (text !== lastNotice) log(text); lastNotice = text; };
  const sql = sqlFactory ? sqlFactory() : postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    if (!(await manualSchemaReady(sql))) {
      notice("[영상 직접 제출] DB 준비 전(0324a 적용 전)이라 건너뜁니다 — 적용되면 자동으로 시작합니다.");
      return null;
    }
    let folderId = rootId;
    if (!folderId) {
      const setting = await loadWorkerVideoDriveSetting(sql, tenant, env ? { env } : {});
      if (setting.error) {
        notice("[영상 직접 제출] 저장 폴더 설정을 확인하지 못해 이번 훑기를 건너뜁니다.");
        return null;
      }
      if (!setting.enabled || !setting.rootId) return null;
      folderId = setting.rootId;
    }
    const auth = await authFactory();
    const result = await scanManualDriveVideos(sql, tenant, { rootId: folderId, auth, log, now: new Date(now) });
    lastNotice = null;
    return result;
  } catch (error) {
    const reason = String(error?.message ?? "").slice(0, 120) || "연결을 확인하세요.";
    notice(`[영상 직접 제출] 폴더 확인 실패 — ${reason} (다음 주기에 다시 봅니다)`);
    return null;
  } finally { await sql.end(); }
}

/** 테스트 전용 — 주기 타이머·안내 기록을 되돌린다. */
export function resetManualDriveScanTimer() { nextScanAt = 0; lastNotice = null; }
