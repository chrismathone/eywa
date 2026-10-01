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
- 진행 상태는 DB에 저장한다. 중단 시 그 위치부터 재개하고 전체 순회 완료 후 7일 뒤 다시 순회해 오래된 글의 새 댓글도 회수한다(최근 글의 새 댓글은 댓글 감지가 따로 거둔다).
- 과거 이관은 **클래스노트에서 접근 가능한 과거 글·댓글 영상**이다. 기존 다른 Drive 폴더의 보관 영상은 이동하지 않는다.
- 학생은 기존 확정 ClassNote↔에이와 번호 연결을 사용한다. 학생명으로 추측하지 않는다.
- 에이와 반 연결 우선, 학생별 과목 보드는 해당 과목의 수강 이력으로 반을 정한다. 영상 작성일의 수강 기간을 사용한다.
- 반을 못 정해도 올린다(원장 2026-10-01 — 수집이 목적). 1인 보드 글은 JJ 반을 빼고 반을 정하고, 그래도 반이 여러 개이거나 없으면
  파일명의 반 자리를 `반미정`으로 둔다. 담임이 한 사람으로 정해지면 그 담임 폴더, 아니면 `담임 확인 필요` 폴더.
  에이와 학생 연결이 없으면 학생 자리를 `미연결 <ClassNote 보드 이름>`으로 두고 `담임 확인 필요` 폴더에 올린다.
- 담임 폴더는 담임 ID를 DB에서 한 번만 선점한다. 최초 저장한 폴더를 유지한다.
- 영상 큐는 기관+원본 영상 ID로 중복 제거한다. 같은 폴더의 같은 크기·MD5 파일은 같은 Drive 파일 ID를 사용한다.
- 생성 ID를 먼저 보존하고 전송을 재개한다. 업로드 후 Drive 파일의 부모·크기·MD5를 검증한다.
- 파일명이 같아도 서로 다른 영상은 별도 파일로 보관한다. 이름을 중복 판정 키로 쓰지 않는다.
- 실패는 15분 뒤 재시도한다. 기존 보고서 발송 루프는 다운로드·업로드를 기다리지 않는다.
- 로컬 원본은 500MB 상한이다. Drive 검증과 DB 저장 완료 뒤 워커의 임시 MP4(압축본 `*.aywa.*` 포함)를 정리한다. 실패한 작업은 재개를 위해 보존한다.
- 폴더를 공개하거나 담임에게 자동 공유하지 않는다. 기존 상위 폴더 권한을 따른다.

## 압축·Drive 용량 (2026-10-01)

원장 *"구글 드라이브 업로드 시에 압축해서 … 화질 같은 건 최대한 보존해서 압축"*. **앞으로 올라가는 영상만** 압축한다 —
이미 올라간 영상은 그대로 둔다(원장 *"311건은 냅둬 압축하지마"*, 재압축 도구 없음).

- 흐름: 내려받기 → (같은 폴더 중복이 아니면) 압축 → Drive. 압축본이 원본보다 **15% 이상** 작을 때만 압축본을 올리고, 아니면 원본.
  원본 영상 비트레이트가 이미 낮으면(픽셀·프레임당 0.08비트 미만 — ClassNote 1080p 약 4Mbps가 0.067) 인코딩하지 않고 원본(`kept-bitrate`).
  ffmpeg 없음·실패·시간 초과·검증 불일치(파일·영상 길이·크기·소리)는 전부 **원본을 올린다**(압축이 보관을 막지 않는다).
  판단(압축함·원본 유지·실패)은 영상 옆 `*.aywa.json`에 남겨 재시도 때 다시 인코딩하지 않는다.
- 설정(`video-compress.mjs` `COMPRESS_PROFILE`): H.264 High·8비트 4:2:0 · **CRF 22** · preset **medium** · 해상도 원본(긴 변 1920 초과만 1920으로)
  · 프레임 타이밍 그대로(가변 프레임 포함) · 세로 영상은 픽셀을 돌려 화면 방향 그대로 · 원본 AAC는 복사(그 외 AAC 128k) · faststart.
  HDR(HLG·PQ·돌비 비전)은 8비트로 옮기면 색이 바래 원본을 올린다.
- 근거(실측, ClassNote가 내려준 1080p 세로 15초 영상 1건 · 원본 4.1Mbps · VMAF는 원본 대비):

  | 설정 | 크기(원본 대비) | VMAF |
  |---|---|---|
  | CRF 21 medium | 1.75배 | 97.5 |
  | **CRF 22 medium** | **1.56배** | **96.9** |
  | CRF 23 medium | 1.38배 | 96.0 |
  | CRF 22 slow | 1.52배(medium보다 −2.5%) — 시간 1.8배 | 96.8 |
  | CRF 26 / 28 slow | 0.93배 / 0.72배 | 92.3 / 89.0 |

  CRF 21↔22의 화질 차이(0.6)는 눈으로 구분되는 폭(약 6)보다 훨씬 작고 크기는 12% 크다. 23은 95에 가까워 움직임·잡음이 많은 영상에서 여유가 없다 → 22.
  slow는 2.5% 줄이려고 시간이 1.8배라 발송 PC 부담만 커진다 → medium.
  🔑 **ClassNote가 이미 압축해서 내려주는 영상(약 4Mbps)은 화질을 지키는 설정으로는 더 줄지 않는다** — 위 표본은 오히려 커진다.
  그래서 이런 영상은 비트레이트만 보고 인코딩 없이 원본을 올린다(발송 PC 시간 절약).
  15% 넘게 줄이려면 CRF 26 이상(VMAF 92 이하)으로 화질을 깎아야 한다. 휴대폰 원본(1080p H.264 약 16Mbps · 4K 약 45Mbps)은 크게 준다.
- H.265는 쓰지 않는다: Drive 미리보기·브라우저 재생이 기기마다 갈린다(파이어폭스 미지원, 크롬은 하드웨어 지원 기기만, 옛 윈도는 유료 확장).
- 발송이 본업이라 ffmpeg는 **낮은 우선순위·CPU 절반**으로 돈다. 시간 상한 = 영상 길이×8+2분(10~60분), 넘으면 원본.
  워커(node)를 강제 종료하면 ffmpeg도 함께 끝난다(Windows에서 node가 자식을 '부모와 함께 종료'로 묶는다, 실측).
  작업 임대는 30초마다 갱신돼 10분 회수와 부딪히지 않는다. 그동안 다음 영상은 기다린다.
- 중복 판정은 **원본 지문**(원본 md5·크기) 그대로다 — DB `bytes`·`md5`도 원본. Drive 파일의 공개 `properties`에 `aywaSourceMd5/Bytes`(원본)와
  `aywaUploadMd5/Bytes`(올린 내용), `aywaCompressed`(`h264-crf22-medium-v1` 압축함 · `kept-bitrate` 이미 낮은 비트레이트 · `kept-savings` 절감 부족
  · `kept-hdr` HDR · 없음=판단 안 함)를 남긴다. 🔴 `appProperties`가 아니라 `properties`인 이유: 앱 속성은 OAuth 클라이언트마다 비공개라
  인증 방식을 바꾸면(gcloud↔OAuth) 안 보여 압축본이 "원본과 다름"으로 영구 실패한다. 값은 해시·크기·표식뿐이다.
  같은 원본의 압축본이 이미 있으면 다시 압축하지 않는다. 행의 `route.archive`에 Drive 크기·압축 여부가 남는다.
- **ffmpeg 설치(발송 PC 한 번)**: 워커를 돌리는 **같은 Windows 사용자**로 `scripts/_classnote/발송PC-영상압축-설치.bat` 더블클릭
  (winget `Gyan.FFmpeg`). 재시작 없이 10분 안에 잡힌다(winget 링크 폴더·설치 폴더를 직접 본다). 다른 위치면 `.env.local`에
  `CLASSNOTE_FFMPEG_PATH`(·`CLASSNOTE_FFPROBE_PATH`), 끄려면 `CLASSNOTE_VIDEO_COMPRESS=off`. zip에는 ffmpeg를 넣지 않는다.
- 🔴 **되돌릴 땐 옛 zip이 아니라 `CLASSNOTE_VIDEO_COMPRESS=off`**: 옛 워커는 압축본을 같은 영상으로 알아보지 못해(원본 md5와만 비교)
  이미 압축본이 올라간 영상의 재시도·중복이 영구 실패하고, 압축본으로 시작한 업로드 재개 기록과도 어긋난다.
- 라이선스: 이 ffmpeg 빌드는 GPLv3(libx264가 GPL)다. 별도 프로그램으로 실행만 하므로 aywa 코드에 GPL이 옮지 않고, 각 PC가 winget으로 직접
  받으니 우리가 바이너리를 배포하지 않는다. 다른 학원에 워커를 줄 때도 zip에 넣지 말고 같은 방식으로 각자 설치하게 할 것.
- **Drive 남은 공간 감시**(`video-drive-quota.mjs`): 남은 공간이 **20GB** 아래면 새 영상 작업을 집지 않는다(큐는 대기, 공간이 생기면 자동 재개,
  로그 `[영상] ⚠ Drive 남은 공간 …`). 확인은 대기 영상이 있을 때 1시간마다, 문턱의 2배(40GB) 아래면 5분마다.
  근거: 지금 약 1TB가 남았고 들어오는 양은 한 달 1~3GB(2026-09 58건 3.2GB)라, 20GB는 여러 달치 여유이면서 같은 계정을 쓰는 Gmail·사진이
  멈추기 전에 선다. 5분 사이 최악(영상 5건×500MB)도 2.5GB라 넘치지 않는다. 바꾸려면 `.env.local`의 `CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB`.
  서비스계정(공유 드라이브)은 계정 용량이 아니라 보지 않는다. 앱 '발송 큐 현황'의 워커 줄에 `영상 보관 · Drive 남은 …`이 뜨고, 멈추면 붉게.

### 다음 일(설계만) — 링크·직접 올린 영상의 사후 압축

`feat/video-manual-drive`(담임이 폴더에 올린 파일)·`feat/video-submit-link`(학부모 링크 업로드)가 main에 들어간 뒤.
- 대상: 담임 폴더의 영상 중 공개 `properties.aywaCompressed`가 **없는** 파일만(Drive 검색은 "속성 없음"을 못 걸어 목록을 받아 거른다).
  **보관 계정 소유(`'me' in owners`)만** — 담임 계정이 올린 파일은 그 담임의 용량을 쓰므로 원장 Drive가 늘지 않는다.
- 처리: 내려받기 → 같은 `prepareCompressedUpload` → 압축했으면 **같은 파일 ID에 새 버전 업로드**(files.update media)로 링크·공유·DB 연결을
  그대로 둔다. 🔴 이때 공개 `properties`의 원본 지문(`aywaSourceMd5/Bytes` = 바꾸기 전 Drive md5·크기)과 `aywaUploadMd5/Bytes`(새 내용)를
  **함께** 적어야 한다 — 안 적으면 같은 내용 영상·재시도가 `verifyExisting`에서 영구 거부된다. 옛 버전은 Drive가 30일 뒤 지우며,
  검증 뒤 `revisions.delete`로 바로 지울 수도 있다. 판단만 했으면(`kept-*`) 메타데이터만 표시.
- 발송이 없는 밤 시간에 한 번에 한 파일, 영상 큐가 비었을 때만.

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
