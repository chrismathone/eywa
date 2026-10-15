-- 학부모 계정 · 등하원 변경 시스템 — Supabase 스키마 추출본 (로컬 DB에서 2026-10-01 추출)
-- ⚠️ 참고용 스냅샷이다. 실제 적용은 supabase/migrations의 0320a~0323a(본서버 번호)로 할 것.
-- 순서: ① 테이블(제약·인덱스·RLS·트리거)  ② 기존 표에 더한 칸  ③ 함수 본문

-- ① 새 테이블 5개

\restrict KPYhYeNbxmuWFW2pQz9L0wqmYisHmAfRVpQ6IyukysKsdubefLh9udtzimdAMNj

-- Name: parent_account_students; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.parent_account_students (
    tenant_id uuid NOT NULL,
    parent_account_id uuid NOT NULL,
    student_id uuid NOT NULL,
    relationship text DEFAULT 'parent'::text NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Name: parent_accounts; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.parent_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    login_email text NOT NULL,
    display_name text NOT NULL,
    phone text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parent_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

-- Name: shuttle_history_acks; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.shuttle_history_acks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    history_kind text NOT NULL,
    history_id uuid NOT NULL,
    acked_by uuid,
    acked_by_name text,
    acked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shuttle_history_acks_kind CHECK ((history_kind = ANY (ARRAY['ride'::text, 'regular'::text])))
);

-- Name: TABLE shuttle_history_acks; Type: COMMENT; Schema: public; Owner: -

COMMENT ON TABLE public.shuttle_history_acks IS '셔틀 변경 내역 확인 표식(0323a) — 확인한 장부 줄은 직원 화면에서 내린다. 장부(0321a·0322a)는 그대로.';

-- Name: shuttle_ride_exception_history; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.shuttle_ride_exception_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    exception_id uuid NOT NULL,
    on_date date NOT NULL,
    student_id uuid NOT NULL,
    student_name text,
    kind text NOT NULL,
    io_kind text NOT NULL,
    op text NOT NULL,
    before_run_stop_id uuid,
    after_run_stop_id uuid,
    before_label text,
    after_label text,
    memo text,
    actor_kind text NOT NULL,
    actor_id uuid,
    actor_name text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT shuttle_ride_exception_history_op CHECK ((op = ANY (ARRAY['create'::text, 'update'::text, 'cancel'::text])))
);

-- Name: TABLE shuttle_ride_exception_history; Type: COMMENT; Schema: public; Owner: -

COMMENT ON TABLE public.shuttle_ride_exception_history IS '셔틀 그날만 변경(0229a)의 이력 장부(0321a) — 트리거가 생성·변경·취소마다 한 줄. 추가만 된다(수정·삭제 금지).';

-- Name: shuttle_rider_history; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.shuttle_rider_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    student_id uuid NOT NULL,
    student_name text,
    io_kind text NOT NULL,
    weekday text NOT NULL,
    before_run_stop_id uuid,
    after_run_stop_id uuid,
    before_label text,
    after_label text,
    reason text,
    actor_kind text NOT NULL,
    actor_id uuid,
    actor_name text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

-- Name: TABLE shuttle_rider_history; Type: COMMENT; Schema: public; Owner: -

COMMENT ON TABLE public.shuttle_rider_history IS '셔틀 고정(정기) 배정 변경 이력(0322a) — 요일 하나의 타는 곳을 바꿀 때마다 한 줄. 추가만 된다.';

-- Name: parent_account_students parent_account_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_account_students
    ADD CONSTRAINT parent_account_students_pkey PRIMARY KEY (parent_account_id, student_id);

-- Name: parent_accounts parent_accounts_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_accounts
    ADD CONSTRAINT parent_accounts_auth_user_id_key UNIQUE (auth_user_id);

-- Name: parent_accounts parent_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_accounts
    ADD CONSTRAINT parent_accounts_pkey PRIMARY KEY (id);

-- Name: parent_accounts parent_accounts_tenant_id_login_email_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_accounts
    ADD CONSTRAINT parent_accounts_tenant_id_login_email_key UNIQUE (tenant_id, login_email);

-- Name: shuttle_history_acks shuttle_history_acks_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.shuttle_history_acks
    ADD CONSTRAINT shuttle_history_acks_pkey PRIMARY KEY (id);

-- Name: shuttle_ride_exception_history shuttle_ride_exception_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.shuttle_ride_exception_history
    ADD CONSTRAINT shuttle_ride_exception_history_pkey PRIMARY KEY (id);

-- Name: shuttle_rider_history shuttle_rider_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.shuttle_rider_history
    ADD CONSTRAINT shuttle_rider_history_pkey PRIMARY KEY (id);

-- Name: parent_account_students_tenant_student_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX parent_account_students_tenant_student_idx ON public.parent_account_students USING btree (tenant_id, student_id);

-- Name: parent_accounts_tenant_status_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX parent_accounts_tenant_status_idx ON public.parent_accounts USING btree (tenant_id, status, created_at);

-- Name: shuttle_history_acks_uniq; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX shuttle_history_acks_uniq ON public.shuttle_history_acks USING btree (tenant_id, history_kind, history_id);

-- Name: shuttle_ride_exception_history_recent_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX shuttle_ride_exception_history_recent_idx ON public.shuttle_ride_exception_history USING btree (tenant_id, created_at DESC);

-- Name: shuttle_ride_exception_history_student_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX shuttle_ride_exception_history_student_idx ON public.shuttle_ride_exception_history USING btree (tenant_id, student_id, on_date);

-- Name: shuttle_rider_history_student_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX shuttle_rider_history_student_idx ON public.shuttle_rider_history USING btree (tenant_id, student_id, created_at DESC);

-- Name: parent_accounts tg_parent_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER tg_parent_accounts_updated_at BEFORE UPDATE ON public.parent_accounts FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Name: shuttle_ride_exception_history tg_shuttle_ride_exception_history_append_only; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER tg_shuttle_ride_exception_history_append_only BEFORE DELETE OR UPDATE ON public.shuttle_ride_exception_history FOR EACH ROW EXECUTE FUNCTION public.tg_shuttle_ride_exception_history_append_only();

-- Name: shuttle_rider_history tg_shuttle_rider_history_append_only; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER tg_shuttle_rider_history_append_only BEFORE DELETE OR UPDATE ON public.shuttle_rider_history FOR EACH ROW EXECUTE FUNCTION public.tg_shuttle_ride_exception_history_append_only();

-- Name: parent_account_students parent_account_students_parent_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_account_students
    ADD CONSTRAINT parent_account_students_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.parent_accounts(id) ON DELETE CASCADE;

-- Name: parent_account_students parent_account_students_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_account_students
    ADD CONSTRAINT parent_account_students_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

-- Name: parent_account_students parent_account_students_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_account_students
    ADD CONSTRAINT parent_account_students_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Name: parent_accounts parent_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_accounts
    ADD CONSTRAINT parent_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Name: parent_accounts parent_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.parent_accounts
    ADD CONSTRAINT parent_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Name: parent_account_students; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.parent_account_students ENABLE ROW LEVEL SECURITY;

-- Name: parent_account_students parent_account_students_tenant_read; Type: POLICY; Schema: public; Owner: -

CREATE POLICY parent_account_students_tenant_read ON public.parent_account_students FOR SELECT TO authenticated USING (((tenant_id = ( SELECT public.auth_tenant_id() AS auth_tenant_id)) AND ((( SELECT public.auth_system_role() AS auth_system_role) = ANY (ARRAY['master'::text, 'admin'::text])) OR ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin))));

-- Name: parent_accounts; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.parent_accounts ENABLE ROW LEVEL SECURITY;

-- Name: parent_accounts parent_accounts_tenant_read; Type: POLICY; Schema: public; Owner: -

CREATE POLICY parent_accounts_tenant_read ON public.parent_accounts FOR SELECT TO authenticated USING (((tenant_id = ( SELECT public.auth_tenant_id() AS auth_tenant_id)) AND ((( SELECT public.auth_system_role() AS auth_system_role) = ANY (ARRAY['master'::text, 'admin'::text])) OR ( SELECT public.is_super_admin(auth.uid()) AS is_super_admin))));

-- Name: shuttle_history_acks; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.shuttle_history_acks ENABLE ROW LEVEL SECURITY;

-- Name: shuttle_history_acks shuttle_history_acks_tenant_read; Type: POLICY; Schema: public; Owner: -

CREATE POLICY shuttle_history_acks_tenant_read ON public.shuttle_history_acks FOR SELECT USING ((tenant_id = public.auth_tenant_id()));

-- Name: shuttle_ride_exception_history; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.shuttle_ride_exception_history ENABLE ROW LEVEL SECURITY;

-- Name: shuttle_ride_exception_history shuttle_ride_exception_history_tenant_read; Type: POLICY; Schema: public; Owner: -

CREATE POLICY shuttle_ride_exception_history_tenant_read ON public.shuttle_ride_exception_history FOR SELECT USING ((tenant_id = public.auth_tenant_id()));

-- Name: shuttle_rider_history; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.shuttle_rider_history ENABLE ROW LEVEL SECURITY;

-- Name: shuttle_rider_history shuttle_rider_history_tenant_read; Type: POLICY; Schema: public; Owner: -

CREATE POLICY shuttle_rider_history_tenant_read ON public.shuttle_rider_history FOR SELECT USING ((tenant_id = public.auth_tenant_id()));

\unrestrict KPYhYeNbxmuWFW2pQz9L0wqmYisHmAfRVpQ6IyukysKsdubefLh9udtzimdAMNj


-- ② 기존 표 shuttle_ride_exceptions(0229a)에 더한 것
ALTER TABLE public.shuttle_ride_exceptions ADD COLUMN actor_kind text NOT NULL DEFAULT 'staff'::text;
ALTER TABLE public.shuttle_ride_exceptions ADD COLUMN actor_name text;
ALTER TABLE public.shuttle_ride_exceptions ADD COLUMN parent_account_id uuid;
ALTER TABLE public.shuttle_ride_exceptions ADD CONSTRAINT shuttle_ride_exceptions_actor_kind CHECK ((actor_kind = ANY (ARRAY['staff'::text, 'parent'::text, 'system'::text])));
ALTER TABLE public.shuttle_ride_exceptions ADD CONSTRAINT shuttle_ride_exceptions_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES parent_accounts(id) ON DELETE SET NULL;
CREATE TRIGGER tg_shuttle_ride_exception_history AFTER INSERT OR DELETE OR UPDATE ON public.shuttle_ride_exceptions FOR EACH ROW EXECUTE FUNCTION tg_shuttle_ride_exception_history();

-- ③ 함수 6개 (새로 5개 + 다시 정의 1개: tg_sync_user_from_auth — 0075a 것에 학부모 갈래 추가)

CREATE OR REPLACE FUNCTION public.shuttle_ride_exception_label(p_kind text, p_run_stop_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_kind = 'skip' then '이날 안 탐'
    else (
      select concat_ws(' · ',
               nullif(concat_ws(' ', v.name, coalesce(nullif(btrim(r.label), ''), r.run_no || '회차')), ''),
               case rs.kind when 'depart' then '학원 출발' when 'arrive' then '학원 도착' else coalesce(s.name, '정류장') end)
        from public.shuttle_run_stops rs
        join public.shuttle_runs r on r.id = rs.run_id
        left join public.shuttle_vehicles v on v.id = r.vehicle_id
        left join public.shuttle_stops s on s.id = rs.stop_id
       where rs.id = p_run_stop_id
    )
  end
$function$
;

CREATE OR REPLACE FUNCTION public.tg_shuttle_ride_exception_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student text;
begin
  if tg_op = 'DELETE' then
    select name into v_student from public.students where id = old.student_id;
    insert into public.shuttle_ride_exception_history (
      tenant_id, exception_id, on_date, student_id, student_name, kind, io_kind, op,
      before_run_stop_id, after_run_stop_id, before_label, after_label, memo,
      actor_kind, actor_id, actor_name
    ) values (
      old.tenant_id, old.id, old.on_date, old.student_id, v_student, old.kind, old.io_kind, 'cancel',
      old.run_stop_id, null, public.shuttle_ride_exception_label(old.kind, old.run_stop_id), null, old.memo,
      coalesce(nullif(current_setting('eywa.actor_kind', true), ''), 'system'),
      nullif(current_setting('eywa.actor_id', true), '')::uuid,
      coalesce(nullif(current_setting('eywa.actor_name', true), ''), '자동 정리(노선·학생 삭제 등)')
    );
    return old;
  end if;

  -- 같은 값으로 다시 저장(upsert)한 것은 변경이 아니다 — 장부를 부풀리지 않는다.
  if tg_op = 'UPDATE'
     and old.run_stop_id is not distinct from new.run_stop_id
     and old.memo is not distinct from new.memo then
    return new;
  end if;

  select name into v_student from public.students where id = new.student_id;
  insert into public.shuttle_ride_exception_history (
    tenant_id, exception_id, on_date, student_id, student_name, kind, io_kind, op,
    before_run_stop_id, after_run_stop_id, before_label, after_label, memo,
    actor_kind, actor_id, actor_name
  ) values (
    new.tenant_id, new.id, new.on_date, new.student_id, v_student, new.kind, new.io_kind,
    case tg_op when 'INSERT' then 'create' else 'update' end,
    case tg_op when 'UPDATE' then old.run_stop_id end,
    new.run_stop_id,
    case tg_op when 'UPDATE' then public.shuttle_ride_exception_label(old.kind, old.run_stop_id) end,
    public.shuttle_ride_exception_label(new.kind, new.run_stop_id),
    new.memo,
    new.actor_kind,
    case new.actor_kind when 'parent' then new.parent_account_id else new.created_by end,
    new.actor_name
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_shuttle_ride_exception_history_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception '셔틀 변경 이력은 수정하거나 지울 수 없습니다';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_shuttle_ride_exception(p_tenant_id uuid, p_id uuid, p_actor_kind text, p_actor_id uuid, p_actor_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_actor_kind not in ('staff', 'parent', 'system') then
    raise exception 'bad actor kind %', p_actor_kind;
  end if;
  perform set_config('eywa.actor_kind', p_actor_kind, true);
  perform set_config('eywa.actor_id', coalesce(p_actor_id::text, ''), true);
  perform set_config('eywa.actor_name', coalesce(p_actor_name, ''), true);
  delete from public.shuttle_ride_exceptions where id = p_id and tenant_id = p_tenant_id;
  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.change_shuttle_regular_ride(p_tenant_id uuid, p_student_id uuid, p_io_kind text, p_weekday day_of_week, p_run_stop_id uuid, p_reason text, p_actor_kind text, p_actor_id uuid, p_actor_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before uuid;
  v_student text;
begin
  if p_io_kind not in ('in', 'out') then
    raise exception 'bad io kind %', p_io_kind;
  end if;

  select run_stop_id into v_before
    from public.shuttle_riders
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind and p_weekday = any(weekdays)
   order by created_at
   limit 1;
  if v_before = p_run_stop_id then
    return 'same';
  end if;

  -- ① 그 요일 빼기 — 그 요일만 있던 줄은 지운다(빈 배열은 제약 위반이라 먼저).
  delete from public.shuttle_riders
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and weekdays = array[p_weekday];
  update public.shuttle_riders
     set weekdays = array_remove(weekdays, p_weekday), updated_at = now()
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and p_weekday = any(weekdays);

  -- ② 새 칸에 그 요일 더하기 — 그 칸 줄이 이미 있으면(다른 요일로) 요일만 더하고, 없으면 새 줄.
  update public.shuttle_riders
     set weekdays = array_append(weekdays, p_weekday), updated_at = now()
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and run_stop_id = p_run_stop_id;
  if not found then
    insert into public.shuttle_riders (tenant_id, run_stop_id, student_id, io_kind, weekdays)
    values (p_tenant_id, p_run_stop_id, p_student_id, p_io_kind, array[p_weekday]);
  end if;

  -- ③ 이력.
  select name into v_student from public.students where id = p_student_id;
  insert into public.shuttle_rider_history (
    tenant_id, student_id, student_name, io_kind, weekday,
    before_run_stop_id, after_run_stop_id, before_label, after_label, reason,
    actor_kind, actor_id, actor_name
  ) values (
    p_tenant_id, p_student_id, v_student, p_io_kind, p_weekday::text,
    v_before, p_run_stop_id,
    case when v_before is null then null else public.shuttle_ride_exception_label('add', v_before) end,
    public.shuttle_ride_exception_label('add', p_run_stop_id),
    p_reason, p_actor_kind, p_actor_id, p_actor_name
  );
  return 'changed';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_sync_user_from_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_tenant        uuid;
  v_role_explicit public.system_role;
  v_name          text;
begin
  if new.raw_app_meta_data ->> 'account_type' = 'parent' then
    return new;
  end if;

  v_tenant := nullif(new.raw_app_meta_data ->> 'tenant_id', '')::uuid;
  v_role_explicit := nullif(new.raw_app_meta_data ->> 'system_role', '')::public.system_role;
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1)
  );

  if v_tenant is null then
    return new;
  end if;

  insert into public.users (id, tenant_id, email, display_name, system_role, status)
  values (
    new.id,
    v_tenant,
    new.email,
    v_name,
    coalesce(v_role_explicit, 'viewer'::public.system_role),
    'active'
  )
  on conflict (id) do update set
    tenant_id    = excluded.tenant_id,
    email        = excluded.email,
    display_name = coalesce(public.users.display_name, excluded.display_name),
    system_role  = coalesce(v_role_explicit, public.users.system_role);

  return new;
end;
$function$
;

-- 함수 실행 권한: cancel_shuttle_ride_exception · change_shuttle_regular_ride = service_role만(public·anon·authenticated 회수)
REVOKE ALL ON FUNCTION public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text) TO service_role;
