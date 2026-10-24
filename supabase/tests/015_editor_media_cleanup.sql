-- Run manually in a disposable/test Supabase project's SQL Editor AFTER migration 015.
-- Executes real triggers and FK cascades with isolated UUID fixtures; always rolls back.
-- No storage objects or signed tokens are created. Service/storage retries are Node tests.
begin;
do $$
declare
 deletion text;
 asset_status text;
 owner_id uuid;
 clip_uuid uuid;
 asset_uuid uuid;
 object_path text;
 deleted_at timestamptz;
 due timestamptz;
begin
 if has_table_privilege('authenticated','public.editor_asset_cleanup','SELECT')
 or has_table_privilege('anon','public.editor_asset_cleanup','SELECT') then
  raise exception 'Cleanup paths must not be client-readable';
 end if;
 if not has_table_privilege('service_role','public.editor_asset_cleanup','SELECT')
 or not has_table_privilege('service_role','public.editor_asset_cleanup','DELETE') then
  raise exception 'Service role must be able to drain cleanup';
 end if;
 foreach deletion in array array['asset','clip','account'] loop
  foreach asset_status in array array['verified','pending','failed'] loop
   owner_id:=gen_random_uuid();clip_uuid:=gen_random_uuid();asset_uuid:=gen_random_uuid();
   object_path:=owner_id::text||'/'||clip_uuid::text||'/'||asset_uuid::text||'.png';
   insert into auth.users(id,email) values(owner_id,owner_id::text||'@cleanup-test.invalid');
   insert into public.clips(id,user_id,url,title,clip_type,viral_score,start_seconds,end_seconds)
   values(clip_uuid,owner_id,'upload:cleanup-test','Cleanup SQL fixture','test',0,0,3);
   insert into public.editor_assets(id,user_id,clip_id,storage_path,file_name,kind,declared_size,declared_mime,status,
     created_at,expires_at,verified_at,mime_type,size_bytes,width,height)
   values(asset_uuid,owner_id,clip_uuid,object_path,'test.png','photo',100,'image/png',asset_status,
     now()-interval '1 day',now()-interval '21 hours',now(),'image/png',100,16,16);
   deleted_at:=clock_timestamp();
   if deletion='asset' then delete from public.editor_assets where id=asset_uuid;
   elsif deletion='clip' then delete from public.clips where id=clip_uuid;
   else delete from auth.users where id=owner_id;
   end if;
   if exists(select 1 from public.editor_assets where id=asset_uuid) then
    raise exception '% deletion left % asset',deletion,asset_status;
   end if;
   select not_before into due from public.editor_asset_cleanup where storage_path=object_path;
   if due is null or due<deleted_at+interval '3 hours' then
    raise exception '% deletion lost % manifest or its token replay buffer',deletion,asset_status;
   end if;
   -- Queue has no parent FKs, even when deletion began at the asset/clip level.
   delete from auth.users where id=owner_id;
   if not exists(select 1 from public.editor_asset_cleanup where storage_path=object_path) then
    raise exception 'Account cascade removed cleanup manifest';
   end if;
  end loop;
 end loop;
end;
$$;
rollback;
