# Edutrix 소등 기록 (2026-07-29 완료)

> **이 문서 하나면 "옛 시스템이 어떻게 사라졌고, 무엇이 어디에 남았는지"를 다시 조사하지 않고 알 수 있다.**
> 세부 배경은 [classnote-integration.md](./classnote-integration.md) §9·§10, 일자별 구현 로그는 [changelog.md](./changelog.md).

## 1. 무엇이 사라졌나 (2026-07-29 하루에 실행)

| 대상 | 조치 | 확인 |
|---|---|---|
| **edutrix Vercel** (`edutrix.vercel.app`) | 삭제 | `404 DEPLOYMENT_NOT_FOUND` |
| **ijw-calander** (GCP/Firebase) | 삭제 | 스토리지·Firestore 접근 불가 |
| **classreport-web** (GCP/Firebase) | 삭제 | Cloud Run `submitToClassNoteV2` 503 |
| **edutrix Supabase** (`xihggqwpyekbszizxyoh`) | **일시정지** | `HTTP 540` — 며칠 관망 후 Delete 예정 |
| Vercel env | `EDUTRIX_SUPABASE_URL/ANON_KEY/TENANT_ID`·`GEMINI_API_KEY`·`FIREBASE_SERVICE_ACCOUNT_KEY` 제거 | 3환경 잔여 0 · 재배포 후 헬스체크 5종 통과 |

세대 계보: **classreport-web(1세대) → edutrix(2세대) → aywa(현재)**. 1·2세대 데이터는 계승·이관됐다
(1세대 문서 `김효우 2026-01-20`이 edutrix에도 동일 존재함을 대조 확인).

## 2. 무엇이 남았나 (복구·조회 가능)

| 자산 | 위치 | 규모 |
|---|---|---|
| 보고서 운영 데이터 | aywa `lesson_reports` (`source='edutrix_import'`) | **17,814건** |
| 읽음 매칭 키 | `lesson_reports.edutrix_share_token` | **917건** — 옛 발송분 읽음 추적이 여기 달림 |
| 원본 raw 아카이브 | aywa `edutrix_archive` (0095a, service_role 전용) | **30테이블 · 28,000+행** |
| 원본 로컬 사본 | `data/edutrix-archive/*.jsonl` (gitignored) | 33파일 · 35MB |
| 미디어 | Supabase Storage 6버킷 | 참조 97개 전량(실측 200 확인) |
| Cloud Run 함수 원본 | `D:\edutrix\functions\index.js` (로컬) | 이제 미사용이나 보관 |

⚠️ **aywa 코드가 아직 읽는 것**(지우지 말 것): `source='edutrix_import'` · `edutrix_report_id` ·
`edutrix_share_token` · `students.edutrix_student_id`. 보고서 목록 '이관' 라벨, 이관분 재발송 차단 가드,
roster-signals, **ClassNote 읽음 매칭**이 여기 의존한다. 전부 **aywa DB만** 읽으므로 원본 소등과 무관하다.

## 3. 의도적으로 버린 것

- **`edutrix.vercel.app/share/{token}` 옛 링크** — ClassNote·MakeEdu 옛 게시물의 "상세 보고서 보기"가 죽는다.
  이미지 본문은 각 플랫폼에 박제돼 있어 글 자체는 남는다(원장 승인).
- **GCS 고아 123개** — 회의녹음 35(1,157MB)·등록상담 27(216MB)·영수증 원본 58·상담녹음 3.
  DB가 참조하지 않는 것들(삭제된 회의, 이름 규칙 변경 전 원본). ⚠️ 아래 교훈① 때문에 백업을 못 떴다.
- **MakeEdu 자동제출** — 누계 8,010건(2026-03-25~07-28). 강사가 aywa로 옮긴 07-28부터 이미 0건이라
  실질 손실 없음(원장 결정: 이식하지 않음).
- **classreport-web 랭킹 스냅샷** — 1세대 전용 기능(원장 결정: 불요).

## 4. 🔴 교훈 (다음에 어떤 시스템을 내리든 적용)

1. **빌링을 끄면 백업도 못 뜬다.** ijw는 Spark 전환 시점부터 GCS 다운로드·Firestore 조회가 전부
   `billing disabled`로 막혀 마지막 백업을 뜨지 못했다. → **백업 → 빌링 해제 → 삭제** 순서.
2. **폴백은 소등 전에 코드에서 없앤다.** Cloud Run 폴백을 07-29 오전에 제거했는데, 그날 오후 Spark 전환으로
   그 함수가 죽었다. 제거 전이었다면 워커 env 한 줄 유실만으로 발송이 전멸했을 상황이었다.
   env 스위치로 남긴 폴백은 "언젠가 조용히 되살아나는 지뢰"다.
3. **원본을 끄기 전에 소비 코드를 먼저 지운다.** aywa에서 원본을 읽는 경로(크론·미매핑 탭)를 먼저 제거하고
   배포한 뒤 Supabase를 정지했더니 아무것도 깨지지 않았다. 반대 순서였으면 500이 났다.
4. **"안 쓰는 것 같다"는 데이터로 확인한다.** MakeEdu는 "이미 이틀째 0건", Gemini는 "SDK 미설치·키 무효",
   랭킹은 "1세대 전용"임을 각각 실측으로 확인한 뒤에 버렸다.
5. **env 제거는 재배포까지 해야 검증된다.** 돌고 있는 배포는 자기 env 스냅샷을 쓰므로, 지운 뒤 재배포해
   헬스체크를 돌려야 "다음 배포에서 터지는" 사고를 막는다.
6. **의존성을 빼면 락파일을 같은 커밋에 넣는다.** `package.json`에서만 지우고 `pnpm-lock.yaml`을 두면
   로컬은 stale `node_modules` 덕에 tsc·lint·test·build가 전부 통과하는데 CI/Vercel은
   `--frozen-lockfile`이라 **설치 단계에서** 죽는다. 로컬 초록불이 무의미해지는 유일한 부류다.
7. **경로를 하나로 줄이면 그동안 꺼져 있던 검증이 드러난다.** GCS 분기를 걷어내다 `verifyUploadedObject`가
   Supabase에선 `{size:0}`만 돌려주는 **무검증**이었음을 발견했다(백엔드를 바꾼 날부터 계속). 분기를 지울 때는
   "지우는 쪽에만 있던 방어"가 무엇이었는지 반드시 확인할 것.
8. **형식(MIME) 검증은 삭제로 이어질 수 있다.** 업로드 후 MIME을 강제하면 MediaRecorder가 `video/webm`으로
   뱉는 오디오가 거부되고 호출부가 그 파일을 지운다(녹음 소실). Supabase가 기록하는 mimetype은 서버가 승인한
   값이 아니라 **클라 `File.type`**이다. 형식 관문은 버킷 `allowed_mime_types`에 두고, 앱은 크기만 강제한다.

## 5. 소등과 함께 정리된 것들 (같은 날)

- **발송 경로 단일화** — 워커 내장 게시(내부 API) 하나. 게시 타임아웃 10분·부분 게시 시 failed 고정(중복 방지).
- **구워커 감지** — 하트비트 `caps.nativePublish` + 발송 큐 카드 "⚠ 구버전 워커" 배지.
- **동명이인 가드 오탐 수정** — 예비원생까지 세어 정상 발송을 막던 것(김수아 등 3명)을 `enrolled`·`on_hold`로 한정.
- **발송 실패 알림** — 테스트 학생 제외(0153a) + 트리거 유실 보정 일일 스윕.
- **워커 로그 회전** — `watch.log`는 오늘 것, 날짜가 바뀌면 `watch-YYYY-MM-DD.log`로 보관(30일).
- **`CLASSNOTE_INTERNAL_SECRET` 회전** — 워커↔앱 불일치로 PDF 첨부 발송 9건이 실패하던 것 해소.
  덤으로 워커 스크린샷이 "학부모 열람"으로 오집계되던 것도 멈췄다(발송 직전 열람 6/6 → 0/10).
- **미디어 = Supabase 단일 경로**(`b27502a6`) — GCS 분기·`backend.ts`·`gcs-client.ts`·`@google-cloud/storage`
  의존·`setup-gcs-cors.cjs` 제거(384줄 삭제), Vercel `MEDIA_STORAGE_BACKEND` env도 삭제.
  **업로드 검증 복구**가 함께 나왔다(위 교훈 7·8). 적대 리뷰가 잡아 같이 고친 P1 4건:
  락파일 미갱신(배포 실패) · `removeObject` 4곳 bucket 누락(문서·증명사진이 조용히 잔존) ·
  객체 부재 fail-open("업로드 없이 register" 우회) · MIME 강제(정상 오디오 삭제).
- **업로드 크기 판정 순수 모듈화**(`2c0012ef`) — `upload-verify.ts` + Vitest 5케이스.
  `media-storage`가 `server-only`라 테스트가 불가능했던 부분을 분리하고, "MIME은 강제하지 않는다"는
  결정을 회귀 방지 케이스로 못박았다. 죽은 E2E 러너 설정도 제거.

## 6. 남은 작업

- [ ] **edutrix Supabase Delete** — 며칠 관망 후. 코드·env가 이미 깨끗해 확인할 것 없음.
      (정지 상태에선 `archive-edutrix.cjs` 재실행 불가 — 마지막 스냅샷은 07-29에 완료)
- [x] ~~죽은 GCS 백엔드 코드 정리~~ — **완료**(§5 참조, `b27502a6`·`8f4df22c`·`2c0012ef`).
- GCP 프로젝트 삭제는 **30일 유예** — 그 안에는 복구 가능(2026-08-28경까지).

### 마지막 확인 상태 (2026-07-29 18:51 KST)

| 표면 | 결과 |
|---|---|
| 구글 시트 sync · 첨부 PDF(+파일 다운로드) · `/r` · 앱 첫화면 | 전부 `200` |
| 옛 이관 크론 `/api/cron/edutrix-sync` | `404` (제거 확인) |
| 발송 워커 | 하트비트 정상 · 당일 발송 16건 · 최근 실패 0 |
| edutrix Supabase | 연결 불가(정지 유지) |

소등 이후 **aywa 단독 운영에서 회귀 0**. 이 표가 다음 점검의 기준선이다.
