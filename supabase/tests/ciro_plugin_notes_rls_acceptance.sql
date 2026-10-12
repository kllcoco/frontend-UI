-- CIRO V0.8: live-Postgres RLS role/claim simulation acceptance.
-- Run ONLY against an approved disposable Supabase acceptance project.
-- This tests Postgres RLS under simulated authenticated/anon roles and claims;
-- it DOES NOT test genuine OAuth tokens, HTTP, Edge Function or independent users.
-- The deliberate P9999 sentinel rolls back both auth.users fixtures and notes.
-- Any unexpected assertion fails with P1200 and aborts the entire statement.
DO $rls$
DECLARE
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  user_c uuid := gen_random_uuid();
  operation_id uuid := gen_random_uuid();
  seen integer;
  blocked boolean;
BEGIN
  BEGIN
    INSERT INTO auth.users(id) VALUES (user_a),(user_b);
    INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
      VALUES (user_a,operation_id,'CIRO_RLS_A_EPHEMERAL'),
             (user_b,gen_random_uuid(),'CIRO_RLS_B_EPHEMERAL');

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub',user_a::text,true);
    IF auth.uid() IS DISTINCT FROM user_a THEN
      RAISE EXCEPTION 'User A simulation invalid' USING ERRCODE='P1200';
    END IF;
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>1 THEN
      RAISE EXCEPTION 'User A sees % rows (expected 1)',seen USING ERRCODE='P1200';
    END IF;
    INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
      VALUES (user_a,gen_random_uuid(),'CIRO_RLS_A_OWN_WRITE');
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>2 THEN
      RAISE EXCEPTION 'User A own insert invisible' USING ERRCODE='P1200';
    END IF;

    blocked:=false;
    BEGIN
      INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
        VALUES (user_b,gen_random_uuid(),'CIRO_RLS_FORBIDDEN_CROSS_OWNER');
    EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'User A cross-owner INSERT not denied' USING ERRCODE='P1200';
    END IF;
    blocked:=false;
    BEGIN
      INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
        VALUES (user_a,operation_id,'CIRO_RLS_DUPLICATE');
    EXCEPTION WHEN unique_violation THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'Same-owner idempotency duplicate not denied' USING ERRCODE='P1200';
    END IF;
    IF has_table_privilege(current_user,'public.ciro_plugin_notes','UPDATE') OR
       has_table_privilege(current_user,'public.ciro_plugin_notes','DELETE') THEN
      RAISE EXCEPTION 'Authenticated UPDATE or DELETE granted' USING ERRCODE='P1200';
    END IF;

    PERFORM set_config('request.jwt.claim.sub',user_b::text,true);
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>1 THEN
      RAISE EXCEPTION 'User B sees % rows (expected 1)',seen USING ERRCODE='P1200';
    END IF;
    INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
      VALUES (user_b,operation_id,'CIRO_RLS_B_SAME_OP_ID_ALLOWED');
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>2 THEN
      RAISE EXCEPTION 'Per-owner operation key isolation failed' USING ERRCODE='P1200';
    END IF;

    PERFORM set_config('request.jwt.claim.sub',user_c::text,true);
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>0 THEN
      RAISE EXCEPTION 'Unknown user sees rows' USING ERRCODE='P1200';
    END IF;
    PERFORM set_config('request.jwt.claim.sub','',true);
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Missing JWT sub produces identity' USING ERRCODE='P1200';
    END IF;
    SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    IF seen<>0 THEN
      RAISE EXCEPTION 'Missing JWT sub allows SELECT' USING ERRCODE='P1200';
    END IF;
    blocked:=false;
    BEGIN
      INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
        VALUES (user_a,gen_random_uuid(),'CIRO_RLS_MISSING_IDENTITY');
    EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'Missing JWT sub allows INSERT' USING ERRCODE='P1200';
    END IF;

    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claim.sub',user_a::text,true);
    IF has_table_privilege(current_user,'public.ciro_plugin_notes','SELECT') OR
       has_table_privilege(current_user,'public.ciro_plugin_notes','INSERT') THEN
      RAISE EXCEPTION 'Anon has privileges under spoofed JWT sub' USING ERRCODE='P1200';
    END IF;
    blocked:=false;
    BEGIN
      SELECT count(*) INTO seen FROM public.ciro_plugin_notes;
    EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'Anon SELECT not denied' USING ERRCODE='P1200';
    END IF;
    blocked:=false;
    BEGIN
      INSERT INTO public.ciro_plugin_notes(owner_id,client_op_id,body)
        VALUES(user_a,gen_random_uuid(),'CIRO_RLS_ANON_FORBIDDEN');
    EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'Anon INSERT not denied' USING ERRCODE='P1200';
    END IF;

    RAISE EXCEPTION 'CIRO_RLS_ROLLBACK_SENTINEL' USING ERRCODE='P9999';
  EXCEPTION WHEN SQLSTATE 'P9999' THEN
    NULL;
  END;
END $rls$;
SELECT 'PASS_SQL_ROLE_SIMULATION_ONLY; NOT_REAL_OAUTH_OR_HTTP' AS assertion;
