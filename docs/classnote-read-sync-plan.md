# ClassNote 읽음 동기화 (A안) — "학부모 미확인 보고서" 이벤트의 선결 과제

> 상태: **1·2·3단계 ✅ 완료(2026-07-18, 0122a).** 읽음이 aywa에 실제로 쌓이기 시작했다(첫 동기화 165건).
> 남은 것 = **4단계(`parent_unread_report` 이벤트)** + 연동 PC에 워커 zip 적용.
> 배포 zip: `D:/tmp/eywa-읽음동기화-20260718.zip`(안내 = `scripts/_classnote/읽음동기화-적용-안내.md`).

## ✅ 2·3단계 구현 결과 (2026-07-18)

| 단계 | 내용 | 상태 |
|---|---|---|
| 2 (aywa) | `0122a`: `lesson_reports.classnote_read_at` + `edutrix_share_token`. edutrix-sync가 `share_token` 임포트(기존 행도 diff-패치로 자동 백필) | ✅ 프로덕션 적용 |
| 3 (워커) | `classnote-read-core.mjs`(순수함수 3 + `pollReportReadsOnce` 30분 가드) · `feed-core.fetchReadWindow` · 데몬 루프 6) 배선 · `sync-classnote-reads.mjs`(수동) | ✅ 코드 완료, **연동 PC 적용 대기** |
| 4 (이벤트) | `parent_unread_report` — 발송 후 N일 미읽음 → 담당 강사(+master) | ⏳ 미착수 |

**실E2E(프로덕션)**: edutrix-sync로 토큰 319건 채움 → 읽음 동기화 `--apply` →
피드 2,400건·학원발송 2,308(읽음 1,733/미읽음 575) → **165건 기록**(edutrix 161 + aywa 자체발송 4 = 두 경로 모두 검증).
미확인 이벤트 후보(매칭키 有·미읽음) **117건** 확보.

⚠️ **`링크없음` 다수는 정상**(14일 창 2,308건 중 1,444건) — 강사가 ClassNote에 직접 쓴 알림장(영어반)·학원 공지라
수업 보고서가 아니다(aywa에 대응 행 없음 = 매칭 대상 아님).

### 4단계 착수 시 유의
- 후보 = `classnote_status='success' AND classnote_read_at IS NULL AND edutrix_share_token IS NOT NULL`
  (매칭 키 없는 과거분을 넣으면 "동기화가 안 된 것"과 "안 읽은 것"을 혼동한다 — 반드시 키 보유 행만).
- 임계(N일)는 **읽음 데이터가 1주 이상 쌓인 뒤** 실분포를 보고 정한다(지금 정하지 말 것).
- Phase 3 불변식 그대로: 콜드스타트 무발송 시드 · bucket=report_id(1회) · admin tenant 필터 · 벨 배지만.

## ✅ 1단계 조사 결과 (2026-07-18, 읽기 전용 GET 실측) — **읽음 노출됨**

`GET /api/v1_2/centers/{centerId}/reports/` **피드 행에 읽음이 이미 들어 있다**(추가 요청 0 — `num_comments`와 동일 구조):

| 필드 | 값 예시 | 의미 |
|---|---|---|
| **`read_by_parent.date_read`** | `"2026-07-18T15:01:15.569992Z"` / `null` | **학부모가 읽은 시각**(null=미읽음) ← 핵심 |
| `read_by_me` | `false` | 로그인 계정(학원)이 읽었는지 — 학부모와 무관 |
| `num_comments` / `reaction_count` | `1` / `0` | 이미 사용 중 / 학부모 반응 수(미사용) |
| `is_sent_from_center` | `true` | **학원 발송분 구분**(학부모가 올린 글과 분리) |

**실효성 검증(필드 존재 ≠ 동작)**: 최신 100건 표본에서 **58건(58%)에 실제 타임스탬프**가 들어 있었다.
학원 발송분(`is_sent_from_center=true`) 96건 중 **54건(56.3%) 읽음**. 미읽음 42건은 대부분 당일 발송분으로 자연스럽다.
→ **aywa의 `share_link_views`(1.5% 포착)와 달리 실제 읽음률을 반영한다.**

피드 행 전체 키: `activity_rate, attached_files, attached_images, attached_video, author, author_name, center, child,
child_name, class_name, cls, content, created, date_written, id, is_sent_from_center, modified, num_comments,
reaction_count, read_by_me, read_by_parent, thumbnail, weather`
(상세 `GET /api/v1_2/reports/{id}/`는 어린이집용 필드(식사·수면·배변 등)가 더 붙지만 읽음 정보는 피드와 동일 — **상세 조회 불필요**.)

읽음 전용 엔드포인트는 없다(GET 탐침 8종 전부 404). 단 `/api/v1/reports/{id}/read/`만 **405**(존재하나 GET 불가
= 읽음 표시용 POST로 추정) — 우리는 읽기만 하므로 **호출하지 않는다**(호출하면 학원이 읽은 것으로 표시될 위험).

### ⚠️ 남은 설계 과제 = aywa 보고서 ↔ ClassNote 글 **매칭 키**
현재 발송 성공 시 `classnote_status='success'` + `classnote_sent_at`만 기록하고 **ClassNote report id를 저장하지 않는다**
(`classnote-core.mjs:409,436`). 따라서:
- **권장**: 발송 시점에 ClassNote가 돌려주는 report id를 새 컬럼(`classnote_report_id`)에 저장 → 이후 읽음 동기화는 **정확 조인**.
  (POST 응답에서 id를 회수할 수 있는지는 발송 경로별 확인 필요 — 내부 API/Cloud Run 두 경로.)
- **차선(과거분)**: `(child_name, date_written)` 매칭 — 동명이인 위험이 있어(name_conflict와 같은 문제) 신규분만 정확 조인하고
  과거분은 백필하지 않는 쪽이 안전하다.

## (참고) 조사 전 판정 — aywa DB만으로는 불가했던 이유

학부모가 보고서를 보는 경로가 둘인데 aywa DB가 잡는 건 한쪽뿐이다:

| 경로 | aywa 읽음 추적 | 비중(injaewon 실측) |
|---|---|---|
| **ClassNote 앱** | ❌ 전무(→ **1단계 조사로 동기화 경로 확보**) | 대부분 |
| **공유 링크 `/r/[token]`** | ✅ `share_link_views` | 극소수 |

- 최근 30일 **발송 성공 1,844건 중 링크 열람 기록이 있는 건 28건(1.5%)**.
- `lesson_reports`에 read/viewed/opened/confirm 류 컬럼 **0개**.
- → `share_link_views` 부재를 "미확인"으로 판정하면 **발송분의 ~98%가 거짓 '미확인'**. 그래서 v7에서 구현하지 않았다.
- ⚠️ **이 제약은 "aywa DB 기준"이다.** ClassNote API는 읽음을 주므로(위 1단계), **동기화만 하면 정확한 미확인 이벤트가 가능하다.**

## 왜 지금은 "학부모 미확인"을 만들 수 없나 (실측 근거)

원장 요청("학부모 미확인 보고서 이벤트 추가")을 데이터로 검토한 결과 **현재 데이터로는 신뢰성 있게 만들 수 없다**고 판정했다.

학부모가 보고서를 보는 경로가 둘인데 aywa DB가 잡는 건 한쪽뿐이다:

| 경로 | aywa 읽음 추적 | 비중(injaewon 실측) |
|---|---|---|
| **ClassNote 앱** | ❌ 전무 | 대부분 |
| **공유 링크 `/r/[token]`** | ✅ `share_link_views` | 극소수 |

- 최근 30일 **발송 성공 1,844건 중 링크 열람 기록이 있는 건 28건(1.5%)**.
- `lesson_reports`에 read/viewed/opened/confirm 류 컬럼 **0개**(information_schema 조회).
- → `share_link_views` 부재를 "미확인"으로 판정하면 **발송분의 ~98%가 거짓 '미확인'**이 된다.
  학부모는 ClassNote 앱에서 읽었고, 그 사실이 aywa로 안 올 뿐이다.

거짓 알림 0을 지켜온 Phase 3 원칙(콜드스타트 무발송 시드·성적 이벤트 dormant 유지)과 정면 충돌하므로 **구현하지 않았다**.
⚠️ **이 판정을 모르고 재제안하지 말 것** — 재제안하려면 아래 A안(읽음 동기화)이 선행돼야 한다.
(코드에도 같은 취지를 주석으로 박아둠: `src/features/notifications/events-core.ts` 미발송 이벤트 절.)

## A안 — ClassNote 읽음 상태를 aywa로 동기화

### 1단계: 조사 — ✅ **완료(2026-07-18). 결과는 문서 상단 참조: `read_by_parent.date_read` 노출·실측 58% 채워짐.**

### 2단계: 스키마 (조사 완료 → 확정안)
- `lesson_reports.classnote_read_at timestamptz`(= `read_by_parent.date_read` 그대로 저장, null=미읽음)
  + **`classnote_report_id bigint`(매칭 키 — 위 '남은 설계 과제')**. 뷰 카운트는 API에 없으므로 만들지 않는다.
- 워커 전용 write → RLS는 `0108a classnote_feed_state` 패턴(select 정책만, write=service_role/postgres 직결).
- 마이그레이션 번호는 착수 시점에 `origin/main` 재확인(0111a·0116a 동번호 충돌 선례).

### 3단계: 워커 (연동 PC)
- **읽음은 피드 행에 이미 있다** → 기존 학부모 글/댓글 폴러(`process-parent-posts.mjs`·`classnote-feed-core.mjs`)가
  도는 그 피드 응답에서 `read_by_parent.date_read`를 **같이 긁으면 추가 요청 0**(댓글 델타와 동일 구조).
  즉 새 폴러를 만들 필요 없이 기존 폴에 필드 추출 + upsert만 붙이는 게 최소 변경이다.
- ⚠️ 읽음은 **나중에 채워지는 값**이라 한 번 보고 끝이 아니다(발송 당일 미읽음 → 며칠 뒤 읽음).
  최근 N일(예: 14일) 발송분을 반복 갱신하되, 이미 `classnote_read_at`이 찍힌 건 재조회 대상에서 제외.
- ⚠️ **`/api/v1/reports/{id}/read/`(405, POST 추정)는 절대 호출 금지** — 학원 계정이 읽음 표시를 남길 위험.
- 배포는 zip 물리 이관(연동 PC는 별도 컴퓨터, git pull 아님).

### 4단계: 이벤트 (그때 비로소 가능)
- `parent_unread_report`: 발송 후 N일(예: 3일) 경과 + 읽음 기록 없음 → 담당 강사(+master 집계).
- Phase 3 불변식 그대로: 콜드스타트 무발송 시드 · `notification_events` upsert dedup(bucket=report_id) ·
  admin RLS 우회라 tenant 필터 필수 · 벨 배지만(IMPORTANT 미등재).
- **선결 조건**: 읽음 데이터가 실제로 채워지는지 최소 1주 관측 후 임계(N일) 확정. 데이터 없이 임계부터 정하지 말 것.

## 대안 (A안 조사가 "읽음 미노출"로 끝날 경우)
- **공유 링크 경로 한정**: 링크로 보낸 건만 `share_link_views`로 미열람 판정. 단 "링크로 보냄" 플래그가 없고 전체의 1.5%라 실효성 낮음.
- **반응 없음 지표**: 댓글·열람 0을 "저관여"로 부드럽게 표시(알림 아닌 브리핑 참고 lane). 오탐 부담이 적은 표현이 전제.
