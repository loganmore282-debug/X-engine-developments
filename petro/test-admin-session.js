'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const acorn=require('acorn'),sessionPolicy=require('./session-policy');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest'});
const extract=name=>{const n=ast.body.find(x=>x.type==='FunctionDeclaration'&&x.id.name===name);assert(n,name);return source.slice(n.start,n.end);};
let now=1800000000000;class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const rows=new Map(),staff=new Map([['active',{active:true}],['blocked',{active:false}]]);
const db={collection:col=>({doc:key=>({
  get:async()=>({exists:(col==='adminUsers'?staff:rows).has(key),data:()=>(col==='adminUsers'?staff:rows).get(key)}),
  set:async value=>rows.set(key,value),
  updateIf:async(filter,updates)=>{const r=rows.get(key);if(!r||+r.expiresAt<=+filter.expiresAt.$gt||+r.lastActiveAt<=+filter.lastActiveAt.$gt)return false;Object.assign(r,updates);return true;}
})})};
const context=vm.createContext({Date:Clock,db,crypto,sessionPolicy,FieldValue:{serverTimestamp:()=>new Date(now)},ADMIN_SESSION_TTL_MS:sessionPolicy.MAX_MS});
vm.runInContext(extract('createSession')+'\n'+extract('resolveSession'),context);
(async()=>{
 const owner=await context.createSession('owner','owner');assert.match(owner,/^[a-f0-9]{64}$/);assert(await context.resolveSession(owner));
 now+=15*60*1000-1;assert(await context.resolveSession(owner));assert.equal(+rows.get(owner).lastActiveAt,1800000000000,'background admin reads do not renew');
 now++;assert.equal(await context.resolveSession(owner,true),null,'expired owner token cannot renew');
 const token=await context.createSession('active','staff');now+=60000;assert(await context.resolveSession(token,true));assert.equal(+rows.get(token).lastActiveAt,now);
 staff.get('active').active=false;assert.equal(await context.resolveSession(token),null,'staff deactivation remains effective');
 const max=await context.createSession('owner','owner');rows.get(max).lastActiveAt=new Date(now+sessionPolicy.MAX_MS-1);now+=sessionPolicy.MAX_MS;assert.equal(await context.resolveSession(max),null);
 const old='legacy';rows.set(old,{role:'owner',expiresAt:new Date(now+1000)});assert.equal(await context.resolveSession(old),null);
 const route=ast.body.find(x=>x.type==='ExpressionStatement'&&x.expression.type==='CallExpression'&&x.expression.callee.property?.name==='post'&&x.expression.arguments[0]?.value==='/admin/check-key');
 const handler=route.expression.arguments.at(-1);context.ADMIN_KEY='owner-secret';context.loginLocked=()=>false;context.safeEqual=(a,b)=>a===b;context.clearLoginFails=()=>{};context.recordLoginFail=()=>{};
 vm.runInContext('var ownerLogin = '+source.slice(handler.start,handler.end),context);
 let result;const res={status(){return this;},json(v){result=v;}};await context.ownerLogin({body:{key:'owner-secret'}},res);
 assert.equal(result.status,'success');assert.notEqual(result.token,'owner-secret');assert(rows.has(result.token));
 console.log('PASS: owner/staff opaque login tokens, idle and absolute limits, no poll renewal, deactivation and legacy-session expiry');
})().catch(e=>{console.error(e);process.exitCode=1});
