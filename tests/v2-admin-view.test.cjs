const fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn'),test=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const names=['hasClubAdminRole','isClubAdmin','toggleAdminView','ownsV2Schedule'];let source='';
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))for(const n of acorn.parse(m[1],{ecmaVersion:'latest'}).body)if(n.type==='FunctionDeclaration'&&names.includes(n.id.name))source+=m[1].slice(n.start,n.end)+'\n';
test('admin preview preserves identity and role, removes privileged actions and restores them',()=>{
 let cleared=0;const c={memberViewUserId:'',authState:{user:{id:'admin'},memberAccount:{role:'admin'}},isApprovedMember:()=>true,myMemberId:()=> 'me',memberAdmin:{invalidate(){cleared++;}},feedback:{invalidate(){cleared++;}},refreshViews(){}};
 vm.createContext(c);vm.runInContext(source,c);const other={source:'v2',creatorMemberId:'other'},own={source:'v2',creatorMemberId:'me'};
 assert(c.isClubAdmin());assert(c.ownsV2Schedule(other));c.toggleAdminView();assert(!c.isClubAdmin());assert(!c.ownsV2Schedule(other));assert(c.ownsV2Schedule(own));assert.equal(c.authState.memberAccount.role,'admin');assert.equal(c.authState.user.id,'admin');assert.equal(cleared,2);
 c.toggleAdminView();assert(c.isClubAdmin());assert(c.ownsV2Schedule(other));assert.equal(cleared,4);
 c.authState.memberAccount.role='member';c.toggleAdminView();assert(!c.isClubAdmin());assert.equal(cleared,4);
});
