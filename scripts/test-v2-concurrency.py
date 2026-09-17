"""Disposable, local-only PostgreSQL multi-session tests. No production connection."""
import os, pathlib, subprocess, tempfile, time, json, uuid, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
BIN = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))

def run(*args, **kw):
    return subprocess.run([str(x) for x in args], check=True, text=True, capture_output=True, **kw)

(ROOT / 'tmp').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='v2-pg-', dir=ROOT/'tmp') as folder:
    base = pathlib.Path(folder)
    run(BIN/'initdb', '-D', base/'db', '-A', 'trust', '--no-locale', '-E', 'UTF8')
    run(BIN/'pg_ctl', '-D', base/'db', '-l', base/'server.log', '-o', f"-h '' -k {base} -p 55439", '-w', 'start')
    cmd = [str(BIN/'psql'), '-h', str(base), '-p', '55439', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
    def sql(query):
        return run(*cmd, input=query).stdout.strip()
    def auth(user):
        return f"select set_config('request.jwt.claims','{{\"sub\":\"{user}\",\"role\":\"authenticated\"}}',true); set local role authenticated;"
    users=[str(uuid.uuid4()) for _ in range(2)]
    payload={'title':'Race fixture', 'starts_at':'2099-01-20T09:00:00+09:00','ends_at':'2099-01-20T11:00:00+09:00','court_id':'court','capacity':1}
    def create(capacity=1):
        sid=str(uuid.uuid4())
        p=json.dumps(dict(payload,capacity=capacity))
        sql(f"begin;{auth(users[0])}select v2_create_schedule('{sid}','{p}');commit;")
        return sid
    def rsvp(sid): return f"select v2_set_my_rsvp('{sid}','attending');"
    def update(sid): return f"select v2_update_schedule('{sid}',1,'{json.dumps(payload)}');"
    def cancel(sid): return f"select v2_cancel_schedule('{sid}',1);"
    def race(label, first_user, first_query, second_user, second_query, error=None):
        a=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        b=None
        try:
            a.stdin.write(f"begin;set local statement_timeout='8s';{auth(first_user)}{first_query}select 'HOLDER_READY';\n");a.stdin.flush()
            while True:
                line=a.stdout.readline()
                if not line: raise AssertionError(a.stderr.read())
                if line.strip()=='HOLDER_READY': break
            b=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            b.stdin.write(f"begin;set local application_name='v2_race_waiter';set local statement_timeout='8s';{auth(second_user)}{second_query}commit;\n");b.stdin.close()
            deadline=time.monotonic()+5
            while sql("select count(*) from pg_stat_activity where application_name='v2_race_waiter' and wait_event_type='Lock';")!='1':
                if b.poll() is not None: raise AssertionError('Second session did not wait: '+b.stderr.read())
                if time.monotonic()>deadline: raise AssertionError('Lock wait was not observed')
                time.sleep(.025)
            a.stdin.write('commit;\n');a.stdin.close()
            a.wait(timeout=10);b.wait(timeout=10)
            assert a.returncode==0,a.stderr.read()
            err=b.stderr.read()
            if error: assert b.returncode!=0 and error in err,(label,err)
            else: assert b.returncode==0,(label,err)
            print('PASS:',label,'(two backends; lock wait observed)',flush=True)
        finally:
            for p in (a,b):
                if p and p.poll() is None: p.kill();p.wait()
    try:
        source=(ROOT/'tests/v2-database.test.cjs').read_text()
        sql(re.search(r'await db.exec\(`(.*?)`\);',source,re.S).group(1))
        for name in ['20260916152242_club_member_accounts_and_member_rsvp.sql','20260917095736_v2_independent_schedules.sql','20260917100945_v2_rpc_input_guards.sql']:
            sql((ROOT/'supabase/migrations'/name).read_text())
        sql("insert into courts values('court','Race court');")
        for i,u in enumerate(users):
            sql(f"insert into auth.users(id) values('{u}');insert into members values('m{i}','Member {i}','active');insert into club_member_accounts(user_id,member_id,status,role) values('{u}','m{i}','approved','member');")
        sid=create()
        race('last seat: only one member succeeds',users[0],rsvp(sid),users[1],rsvp(sid),'22023')
        assert sql(f"select count(*) from v2_schedule_rsvps where schedule_id='{sid}';")=='1'
        sid=create(2);sql(f"begin;{auth(users[0])}{rsvp(sid)}commit;")
        race('capacity reduction wins before attendance',users[0],update(sid),users[1],rsvp(sid),'22023')
        sid=create(2);sql(f"begin;{auth(users[0])}{rsvp(sid)}commit;")
        race('attendance wins; reduction below occupancy rejected',users[1],rsvp(sid),users[0],update(sid),'22023')
        assert sql(f"select capacity from v2_schedules where id='{sid}';")=='2'
        sid=create()
        race('cancellation wins; attendance rejected',users[0],cancel(sid),users[1],rsvp(sid),'42501')
        assert sql(f"select count(*) from v2_schedule_rsvps where schedule_id='{sid}';")=='0'
        sid=create()
        race('attendance wins; cancellation preserves response',users[1],rsvp(sid),users[0],cancel(sid))
        assert sql(f"select status||':'||(select count(*) from v2_schedule_rsvps where schedule_id='{sid}') from v2_schedules where id='{sid}';")=='cancelled:1'
        sid=str(uuid.uuid4());q=f"select v2_create_schedule('{sid}','{json.dumps(payload)}');"
        race('duplicate creation returns one schedule',users[0],q,users[0],q)
        assert sql(f"select count(*) from v2_schedules where id='{sid}';")=='1'
        cid=str(uuid.uuid4());q=f"select v2_add_discussion('{cid}','{sid}','same comment');"
        race('duplicate comment returns one record',users[0],q,users[0],q)
        assert sql(f"select count(*) from v2_discussions where id='{cid}';")=='1'
        race('concurrent edits reject stale version',users[0],update(sid),users[0],update(sid),'40001')
        assert sql(f"select version from v2_schedules where id='{sid}';")=='2'
        print('8 concurrency scenarios passed. Disposable local database only.')
    finally:
        run(BIN/'pg_ctl','-D',base/'db','-m','immediate','-w','stop')
