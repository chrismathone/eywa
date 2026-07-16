-- 0111a: ClassNote 인바운드 **댓글** 감지 상태 — 0108a(classnote_feed_state)에 댓글 수 스냅샷 컬럼 추가.
-- (원장 결정 2026-07-16: 학부모 **댓글**도 담당 강사에게 알림. 0108a 당시 "댓글은 범위 밖"이라 적었던 판단을
--  실측으로 뒤집었다 — 아래 근거.)
--
-- 왜 뒤집었나: 학부모 연락의 **다수가 댓글로 온다**(실측 최근 5~6일: 새 글 4.2건/일 vs 학부모 댓글 12건/일).
-- ClassNote의 자연스러운 흐름이 "강사가 알림장 → 학부모가 댓글로 답"이라 새 글은 오히려 예외였다.
-- 실제 내용도 결석·보강일정·입금확인·강의실 문의 등 조치가 필요한 것들이다.
--
-- 왜 워터마크가 아니라 **스냅샷(jsonb)** 인가: 댓글은 전용 피드가 없다(2026-07-15 실측: centers/{c}/comments/ ·
-- reports/comments/ · feeds/ 전부 404, activities/는 200이나 항상 빈 배열). 유일한 신호가 **피드 행의
-- `num_comments`가 늘어나는 것**이라, "글마다 댓글 수 몇 개였나"를 통째로 들고 있어야 변화를 짚어낼 수 있다.
-- 단일 id 워터마크로는 표현 자체가 안 된다.
--
-- 왜 별 테이블이 아닌가: 스냅샷은 **감시 창(최근 ~2,000글) 한정**이라 상한이 있고(≈60KB) 폴마다 통째로
-- 갈아끼우는 단일 값이다. 행으로 풀면 폴마다 2,000행 upsert+prune이 되어 되레 비싸다.
--
-- ⚠️ `last_seen_post_id`는 scope='parent_posts' 전용으로 남는다(댓글 스코프는 안 씀 — 아래 컬럼 주석 참조).
-- 쓰기 = 연동 PC 워커(DATABASE_URL 직결, RLS 우회)만. 앱은 0108a의 read 정책으로 읽기만.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table classnote_feed_state
  add column if not exists counts jsonb;

comment on column classnote_feed_state.last_seen_post_id is
  'scope=''parent_posts'' 전용 — 마지막으로 처리한 ClassNote 글 id(피드가 id 내림차순이라 이 하나로 새 글 판별). scope=''parent_comments''에선 쓰지 않는다(null).';

comment on column classnote_feed_state.counts is
  'scope=''parent_comments'' 전용 — {글id: 댓글수} 스냅샷. 다음 폴에서 이 수와 달라진 글만 댓글 API를 열어 새 학부모 댓글을 찾는다. 처음 보는 글은 기준선만 잡고 알리지 않는다(콜드 스타트 방어).';
