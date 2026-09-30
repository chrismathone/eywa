# 클래스노트 숙제 영상 → Google Drive

기존 연동 PC의 `watch-classnote-queue.mjs --post`에 포함된 기능이다.
작업 스케줄러 `eywa-classnote-worker`, 로그인 세션, PC 임대, 재시작 절차를 그대로 사용한다.
웹 배포만으로 연동 PC의 코드가 바뀌지는 않는다. `scripts/_classnote` 전체 ZIP을 교체해야 한다.

## 이번 학원 설정

- 저장 위치: [학생동영상](https://drive.google.com/drive/folders/1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK).
- 기존 `허주연T`, 시험용 `육소희 선생님` 폴더는 확정 ID로 DB에 연결했다. 같은 담임 폴더를 다시 만들지 않는다.
- 파일명: **에이와학생명_에이와반이름_에이와학교학년_클래스노트업로드날짜.mp4**.
  예: `류태경_LT4_칠성초3_2026-09-30.mp4`.
- 날짜는 원본 글·댓글 작성 시각의 한국 날짜다. 이전 영상도 복사한 오늘 날짜로 바꾸지 않는다.
- 로컬 임시 파일은 중단 후 재개를 위해 기관·영상 번호를 사용한다. Drive 표시 이름만 위 형식을 쓴다.

## 기존 연동 PC에 적용

1. 새 ZIP의 `scripts/_classnote` 폴더 전체를 기존 저장소에 덮어쓴다. 기존 `.env.local`은 유지한다.
2. 연동 PC에서 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)를 설치한다(이미 있으면 생략).
3. 기존 워커를 실행하는 Windows 사용자로 `scripts/_classnote/발송PC-영상연결.bat`을 더블클릭한다.
   Drive 최초 로그인 → 폴더 권한 확인 → 설정 저장 → 기존 워커 재시작 → 새 버전 적용 확인까지 진행한다.
   이미 Drive가 연결돼 있으면 로그인을 다시 요구하지 않는다. Google 로그인 화면이 나오면 해당 계정으로 동의한다.
4. 마지막에 **새 워커와 영상 저장 폴더 적용을 확인했습니다**가 나오면 완료다.
   기존 워커가 등록되지 않은 PC나 다른 Windows 사용자로는 시작하지 않는다.

직접 명령을 실행하려면 저장소 루트에서:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\_classnote\setup-video-drive.ps1 -Account chrismathone@gmail.com -FolderId 1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK -RestartWorker
```

별도 예약 작업을 만들지 않고 기존 지정 스크립트를 재사용한다.
검사기는 DB의 새 `started_at`, 최근 심장박동, 영상 기능, 요청한 저장 폴더를 모두 확인한다.
로그에는 `[영상 이력]`, `[영상] Drive 저장 완료`가 기록된다.

설정 변경 없이 현재 적용 상태만 확인하려면:

```powershell
node --env-file=.env.local scripts/_classnote/check-video-worker.mjs
```

인증은 Google 공식 `gcloud auth login --enable-gdrive-access` 방식이다.
토큰 저장소를 직접 복사하거나 읽지 않고, 공식 CLI가 갱신한 토큰으로 업로드한다.
폴더 접근 확인에 성공한 경우에만 `.env.local`에 영상 설정을 추가하며 기존 파일을 백업한다.
설정: `CLASSNOTE_VIDEO_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_GCLOUD_ACCOUNT`, `GOOGLE_DRIVE_GCLOUD_PATH`.
다른 Windows 사용자/PC에서는 한 번 다시 로그인해야 한다.

서비스계정은 Workspace **공유 드라이브**만 지원한다(개인 Drive에서는 저장 한도가 0이라 올리지 못한다).
개인 Drive의 공유 폴더는 Workspace 공유 드라이브와 다르다.

### 연동 PC에 Google 로그인·CLI를 두지 않는 길 — OAuth 값 파일 (2026-09-30)

올린 파일의 주인은 허락한 계정 그대로다(gcloud 방식과 결과가 같다). 로그인은 **다른 PC**에서 한 번만 한다.

1. 구글 클라우드 콘솔에서 한 번: Drive API 사용 → OAuth 동의 화면(대상 '외부', **게시 상태 '프로덕션'** — '테스트'면 7일 뒤 끊긴다)
   → 클라이언트 만들기(유형 **데스크톱 앱**) → JSON 다운로드.
2. 아무 PC의 저장소 루트에서(연동 PC가 아니어도 된다):

   ```powershell
   node scripts/_classnote/video-oauth-login.mjs --client=<client_secret_….json> --account=chrismathone@gmail.com --folder=1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK
   ```

   브라우저에서 그 계정으로 허용 → 계정·폴더 쓰기 권한을 확인한 뒤 다운로드 폴더에 `aywa-video-oauth.txt`가 생긴다.
3. 그 파일을 연동 PC의 **다운로드 폴더**로 옮기고 `scripts/_classnote/발송PC-영상연결-OAuth.bat`을 더블클릭한다.
   값으로 폴더를 다시 확인 → `.env.local` 백업·저장(gcloud 키는 지운다) → 값 파일 삭제 → 워커 재시작 → 적용 확인.
   저장 뒤 재시작·확인에서 멈췄으면 같은 bat을 다시 누른다(값 파일 없이 이어 간다).

설정: `CLASSNOTE_VIDEO_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`.
우선순위는 gcloud 계정 > 갱신 토큰 > 서비스계정이다. 갱신은 `fetch`만 쓴다(연동 PC에 googleapis가 없어도 된다).

- 🔴 값 파일·클라이언트 JSON을 저장소나 `scripts/_classnote`에 두지 말 것 — 워커 zip은 그 폴더를 통째로 담는다
  (zip 빌드가 발견하면 멈추고, `.gitignore`도 두 이름을 막는다).
- 🔴 저장 폴더를 바꾸지 말 것 — 영상마다 처음 정한 폴더를 기억해서, 바뀌면 대기 중인 영상이 전부 실패한다
  (값 파일의 폴더가 지금 것과 다르면 적용을 거절한다. 정말 바꿀 때만 `-AllowFolderChange`).
- 로그인 스크립트를 다시 돌려도 기존 연결은 그대로다. 스크립트는 허락을 자동으로 취소하지 않는다
  (취소는 그 계정의 허락 전체를 없애 연동 PC가 쓰던 토큰까지 죽인다 — 필요 없는 허락은 myaccount.google.com/permissions 에서 직접).
- 연결이 끊기면(허락 취소·만료) 워커 로그에 `[영상] Drive 인증 실패 — …`가 찍히고 영상 작업을 집지 않는다. 1~3을 다시 하면 된다.

## 수집·분류·중복 방지

- 학부모 글·댓글의 실제 `attached_video`를 수집한다. 본문이 비어도 포함하고, `[영상]` 글자만 있으면 제외한다.
- 기존 새 글·댓글 감지와 함께, 전체 이력을 날짜 제한 없이 조금씩 순회한다. 댓글도 100개 이후까지 페이지를 읽는다.
- 진행 상태는 DB에 저장한다. 중단 시 그 위치부터 재개하고 전체 순회 완료 후 하루 뒤 다시 순회해 오래된 글의 새 댓글도 회수한다.
- 과거 이관은 **클래스노트에서 접근 가능한 과거 글·댓글 영상**이다. 기존 다른 Drive 폴더의 보관 영상은 이동하지 않는다.
- 학생은 기존 확정 ClassNote↔에이와 번호 연결을 사용한다. 학생명으로 추측하지 않는다.
- 에이와 반 연결 우선, 학생별 과목 보드는 해당 과목의 수강 이력으로 반을 정한다. 영상 작성일의 수강 기간을 사용한다.
- 에이와 학생·반이 미연결이거나 여러 반으로 모호하면 업로드를 보류한다. 현재 담임이 없으면 확인 폴더로 분류한다.
- 담임 폴더는 담임 ID를 DB에서 한 번만 선점한다. 최초 저장한 폴더를 유지한다.
- 영상 큐는 기관+원본 영상 ID로 중복 제거한다. 같은 폴더의 같은 크기·MD5 파일은 같은 Drive 파일 ID를 사용한다.
- 생성 ID를 먼저 보존하고 전송을 재개한다. 업로드 후 Drive 파일의 부모·크기·MD5를 검증한다.
- 파일명이 같아도 서로 다른 영상은 별도 파일로 보관한다. 이름을 중복 판정 키로 쓰지 않는다.
- 실패는 15분 뒤 재시도한다. 기존 보고서 발송 루프는 다운로드·업로드를 기다리지 않는다.
- 로컬 원본은 500MB 상한이다. Drive 검증과 DB 저장 완료 뒤 워커의 임시 MP4를 정리한다. 실패한 작업은 재개를 위해 보존한다.
- 폴더를 공개하거나 담임에게 자동 공유하지 않는다. 기존 상위 폴더 권한을 따른다.

학생 상세의 **숙제 영상** 탭에서 과목별 목록과 Drive 뷰어를 제공한다.
영상 권한이 있는 Google 계정으로 로그인해야 재생할 수 있다.
학생 상세 권한 확인 후 지점·학생 범위의 메타데이터만 반환하며, 원본 주소·인증 정보는 브라우저에 전달하지 않는다.

## 최근 영상 1건 시험

```powershell
node --env-file=.env.local scripts/_classnote/download-classnote-video.mjs --plan
node --env-file=.env.local scripts/_classnote/download-classnote-video.mjs --upload
```

기본 로컬 폴더는 `Downloads/aywa-classnote-videos`. `--out=경로`로 변경할 수 있다.
이미 받은 파일은 `--file=절대경로.mp4`로 지정한다(옆의 `.mp4.json` 기록 필요).
이 명령은 최근 글 최대 500개에서 1건을 찾는 진단용이며, 전체 이관은 상주 워커가 수행한다.
진단 명령을 연동 PC의 상주 워커와 동시에 별도 PC에서 실행하지 않는다(ClassNote 세션 충돌 방지).

## DB 준비

`supabase/migrations/0315a_student_homework_videos.sql` 적용 필요.
영상 큐·폴더/파일 ID 등록부·과거 수집 상태는 모두 tenant 범위, RLS 및 브라우저 직접 접근 차단을 사용한다.
초기 자동 업로드는 연동 PC에 새 코드와 Drive 로그인이 적용된 뒤 시작한다.
