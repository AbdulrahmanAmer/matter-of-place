-- down: drop table public.zz_once; drop schema zz_once_schema;
set lock_timeout = '5s';

-- Drill (B4 watched-fail (dd)), throwaway branch only: neither statement can run twice.
create table zz_once (id int);
create schema zz_once_schema;
