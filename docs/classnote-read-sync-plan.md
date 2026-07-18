# ClassNote 읽음 동기화 (A안) — "학부모 미확인 보고서" 이벤트의 선결 과제

> 상태: **스코핑만 완료, 미착수**(2026-07-17 원장 결정 "A로 진행하되 지금은 B로 미발송부터").
> B안(미발송 보고서 이벤트)은 Phase 3 v7로 구현 완료 — 이 문서는 A안의 조사·설계 재료다.

## 왜 지금은 "학부모 미확인"을 만들 수 없나 (실측 근거)

원장 요청("학부모 미확인 보고서 이벤트 추가")을 데이터로 검토한 결과 **현재 데이터로는 신뢰성 있게 만들 수 없다**고 판정했다.

학부모가 보고서를 보는 경로가 둘인데 eywa DB가 잡는 건 한쪽뿐이다:

| 경로 | eywa 읽음 추적 | 비중(injaewon 실측) |
|---|---|---|
| **ClassNote 앱** | ❌ 전무 | 대부분 |
| **공유 링크 `/r/[token]`** | ✅ `share_link_views` | 극소수 |

- 최근 30일 **발송 성공 1,844건 중 링크 열람 기록이 있는 건 28건(1.5%)**.
- `lesson_reports`에 read/viewed/opened/confirm 류 컬럼 **0개**(information_schema 조회).
- → `share_link_views` 부재를 "미확인"으로 판정하면 **발송분의 ~98%가 거짓 '미확인'**이 된다.
  학부모는 ClassNote 앱에서 읽었고, 그 사실이 eywa로 안 올 뿐이다.

거짓 알림 0을 지켜온 Phase 3 원칙(콜드스타트 무발송 시드·성적 이벤트 dormant 유지)과 정면 충돌하므로 **구현하지 않았다**.
⚠️ **이 판정을 모르고 재제안하지 말 것** — 재제안하려면 아래 A안(읽음 동기화)이 선행돼야 한다.
(코드에도 같은 취지를 주석으로 박아둠: `src/features/notifications/events-core.ts` 미발송 이벤트 절.)

## A안 — ClassNote 읽음 상태를 eywa로 동기화

### 1단계: 조사 (선행, 미착수)
ClassNote가 **학부모 읽음/조회 정보를 노출하는지** 확인해야 한다. 확인 대상:
- 리포트 상세/피드 API 응답에 조회수·읽음 플래그·읽은 시각·읽은 사람 목록이 있는지
  (기존 리버스 엔지니어링 자산: `scripts/_classnote/classnote-core.mjs`, `classnote-feed-core.mjs` — 피드는 `id desc` 커서 계약,
  `num_comments` 스냅샷은 이미 사용 중이라 **응답 스키마에 다른 카운터가 있는지**부터 본다).
- 없으면 A안은 불가 → "읽음"이 아니라 **반응(댓글) 기반 대리지표**만 가능하며, 그건 오탐이 많아 비권장.

### 2단계: 스키마 (조사 결과에 따라)
- `lesson_reports.classnote_read_at timestamptz` + `classnote_view_count int` (또는 별도 `classnote_read_state` 테이블).
- 워커 전용 write → RLS는 `0108a classnote_feed_state` 패턴(select 정책만, write=service_role/postgres 직결).
- 마이그레이션 번호는 착수 시점에 `origin/main` 재확인(0111a·0116a 동번호 충돌 선례).

### 3단계: 워커 (연동 PC)
- `scripts/_classnote/` 폴러가 발송된 리포트의 읽음 상태를 주기 조회 → eywa DB 갱신.
- ⚠️ 폴링 비용: 발송 리포트가 월 ~2,000건이라 전건 재조회는 과하다 → **최근 N일 발송분만**·워터마크 방식
  (`classnote_feed_state` 선례처럼 "어디까지 확인했나"를 DB에 보존 — 워커 재설치에도 살아남아야 함).
- 배포는 zip 물리 이관(연동 PC는 별도 컴퓨터, git pull 아님).

### 4단계: 이벤트 (그때 비로소 가능)
- `parent_unread_report`: 발송 후 N일(예: 3일) 경과 + 읽음 기록 없음 → 담당 강사(+master 집계).
- Phase 3 불변식 그대로: 콜드스타트 무발송 시드 · `notification_events` upsert dedup(bucket=report_id) ·
  admin RLS 우회라 tenant 필터 필수 · 벨 배지만(IMPORTANT 미등재).
- **선결 조건**: 읽음 데이터가 실제로 채워지는지 최소 1주 관측 후 임계(N일) 확정. 데이터 없이 임계부터 정하지 말 것.

## 대안 (A안 조사가 "읽음 미노출"로 끝날 경우)
- **공유 링크 경로 한정**: 링크로 보낸 건만 `share_link_views`로 미열람 판정. 단 "링크로 보냄" 플래그가 없고 전체의 1.5%라 실효성 낮음.
- **반응 없음 지표**: 댓글·열람 0을 "저관여"로 부드럽게 표시(알림 아닌 브리핑 참고 lane). 오탐 부담이 적은 표현이 전제.
