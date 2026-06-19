-- 0035b: 지출결의서 증빙(증빙유형 + 첨부파일) (손수 alpha)
-- ijw 지출결의서의 증빙자료(영수증/세금계산서 등 유형) + 첨부(영수증 이미지/PDF) 패리티.
-- receipt_type: 증빙 유형 텍스트. receipt_urls: 첨부 파일 메타 배열 [{path,name}] (expense-receipts 버킷 경로).
alter table public.expenses add column if not exists receipt_type text;
alter table public.expenses add column if not exists receipt_urls jsonb not null default '[]'::jsonb;

-- Storage RLS — expense-receipts 버킷. 경로 규약: {tenant_id}/{expense_id}/{filename}
-- 선행 세그먼트가 테넌트 UUID라 auth_tenant_id()로 모든 작업을 게이트(0007a 회의녹음 패턴 동일).
-- 비공개 버킷이라 열람은 서버(admin)가 발급한 signed URL로만. service_role(서버 액션)은 RLS bypass.
drop policy if exists er_tenant_insert on storage.objects;
create policy er_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists er_tenant_select on storage.objects;
create policy er_tenant_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists er_tenant_update on storage.objects;
create policy er_tenant_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  )
  with check (
    bucket_id = 'expense-receipts'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists er_tenant_delete on storage.objects;
create policy er_tenant_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );
