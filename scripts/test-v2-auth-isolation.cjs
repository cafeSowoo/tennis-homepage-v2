// Real SDK, synthetic sessions and fake network; never reads real browser tokens.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createClient}=new Function(fs.readFileSync('tmp/supabase-sdk.cjs','utf8')+';return supabase;')();
const v2=fs.readFileSync('index.html','utf8');
const v1=fs.readFileSync('/Users/dorm/coding/tennis-homepage/index.html','utf8');
assert.match(v1,/createClient\(SUPABASE_CONFIG.supabaseUrl, SUPABASE_CONFIG.supabaseAnonKey\)/);
const key=/const AUTH_STORAGE_KEY = "([^"]+)"/.exec(v2)[1];
assert.match(v2,/signOut\(\{ scope: "local" \}\)/);
const legacyKey='sb-myincubzgvhyreyqbban-auth-token';
const data=new Map(),requests=[];
const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
function session(provider){return {access_token:'synthetic-test-token',refresh_token:'synthetic-refresh',expires_at:4102444800,token_type:'bearer',user:{id:provider==='google'?'00000000-0000-0000-0000-000000000001':'00000000-0000-0000-0000-000000000002',app_metadata:{provider}}};}
function seed(){data.set(legacyKey,JSON.stringify(session('google')));data.set(key,JSON.stringify(session('kakao')));}
const options={global:{fetch:async(url)=>{requests.push(String(url));return new Response(null,{status:204});}},auth:{storage,autoRefreshToken:false,detectSessionInUrl:false}};
(async()=>{
 seed();
 const a=createClient('https://myincubzgvhyreyqbban.supabase.co','synthetic-publishable-key',options);
 const b=createClient('https://myincubzgvhyreyqbban.supabase.co','synthetic-publishable-key',{...options,auth:{...options.auth,storageKey:key}});
 assert.equal((await a.auth.getSession()).data.session.user.app_metadata.provider,'google');
 assert.equal((await b.auth.getSession()).data.session.user.app_metadata.provider,'kakao');
 assert.equal((await b.auth.signOut({scope:'local'})).error,null);
 assert(data.has(legacyKey));assert(!data.has(key));
 seed();
 assert.equal((await a.auth.signOut({scope:'local'})).error,null);
 assert(!data.has(legacyKey));assert(data.has(key));
 assert.equal(requests.length,2);assert(requests.every(x=>x.endsWith('/logout?scope=local')));
 console.log('PASS: actual Supabase SDK reads separate Google/Kakao storage; local logout preserves the other session in both directions. Synthetic sessions only.');
 a.auth.stopAutoRefresh();b.auth.stopAutoRefresh();
})().catch(e=>{console.error(e);process.exitCode=1;});
