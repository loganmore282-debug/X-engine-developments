// usage: node sweep.js <lang>   -- lists visible text still containing Latin letters in <lang>
// After a member registers and is inside the app, the sign-in screen must be back to a clean LOG IN page (the Sign Up pane,
// with the typed phone / password / referral code, used to stay 'on' and come back after Log Out).
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'user'), LANGC='en';
const API=(fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/API_BASE\s*=\s*'([^']+)'/)||[])[1];
const REGION={key:'et',name:'Ethiopia',currency:'ETB',dialCode:'251',localLength:9,prefixes:['9','7'],utcOffsetMin:180,isDefault:true,languages:['en','am'],defaultLang:'en',usesBareLocal:true};
const ACCOUNT={phone:'0912345678',walletBalance:12850,totalDeposited:20000,totalEarned:3100,totalWithdrawn:2000,totalInvested:12000,checkinStreak:3,lastCheckinAt:null,referralCode:'ET7Q4X',publicId:'00042',registrationDone:true,spins:2,team:{l1:2,l2:1,l3:0,commission:420},region:REGION};
const SETTINGS={minDeposit:300,minWithdraw:200,withdrawFeePct:15,withdrawMultiple:50,commL1:27,commL2:2,commL3:1,annEnabled:false,annTitle:'Welcome',annBody:'Welcome to the app.',depositPayAEnabled:true,openingCountdownEnabled:false,maintenanceMode:false,dailyCheckin:50,turntableEnabled:true,brandName:'Petro',withdrawWindowEnabled:true,withdrawOpenFrom:'06:00',withdrawOpenTo:'17:00',usdtRate:120,cardEnabled:true,usdtEnabled:true,otpVerificationEnabled:false,referralRequired:false};
const PRODUCTS=[{key:'p1',name:'Asset-1',price:3000,cycle:150,expectedReturn:90000,dailyPayout:600,image:'',active:true,spinCount:2,open:true},{key:'p2',name:'Asset-2',price:9000,cycle:150,expectedReturn:270000,dailyPayout:1800,image:'',active:true,comingSoon:true,open:false,openMode:'soon'}];
const INV=[{id:'i1',tierKey:'p1',tierName:'Asset-1',assetKey:'p1',assetName:'Asset-1',amount:3000,expectedReturn:90000,payoutsMade:4,payoutsTotal:150,paidOut:2400,status:'running',createdAt:'2026-09-10T18:13:00Z'},{id:'i2',tierKey:'p2',tierName:'Asset-2',amount:9000,expectedReturn:270000,payoutsMade:150,payoutsTotal:150,paidOut:270000,status:'matured',createdAt:'2026-03-01T09:00:00Z'}];
const TX=[{id:'t1',type:'deposit',amount:5000,status:'completed',description:'Deposit: Paid',date:'12/09/2026',time:'14:02'},{id:'t2',type:'withdraw',amount:-2000,status:'pending',description:'Withdrawal: Processing',date:'13/09/2026',time:'09:41'},{id:'t3',type:'withdraw',amount:-2000,status:'failed',description:'Withdrawal: Rejected',date:'13/09/2026',time:'10:02'},{id:'t4',type:'turntable',amount:70,status:'completed',description:'Turntable win',date:'14/09/2026',time:'07:15'},{id:'t5',type:'welcome_bonus',amount:700,status:'completed',description:'Welcome Bonus',date:'01/09/2026',time:'08:00'},{id:'t6',type:'commission',amount:810,status:'completed',description:'Level 1 Commission',date:'02/09/2026',time:'11:20'},{id:'t7',type:'cashback',amount:600,status:'completed',description:'Daily cashback',date:'14/09/2026',time:'00:05'},{id:'t8',type:'invest',amount:-3000,status:'completed',description:'Bought Asset-1',date:'10/09/2026',time:'18:13'}];
const MSG=[{id:'m1',title:'Welcome',body:'Thanks for joining.',createdAt:'2026-09-01T08:00:00Z',read:false}];
const WALLET=[{id:'w1',provider:'CBE Birr',accountNumber:'0912345678',accountName:'Abebe K',isDefault:true}];
const ROUTES={'/public/settings':{status:'success',region:REGION,settings:SETTINGS},'/public/products':{status:'success',products:PRODUCTS},'/public/activity-feed':{status:'success',feed:[{kind:'deposit',phone:'251****4417',amount:3000},{kind:'withdraw',phone:'251****9022',amount:2500}]},
'/account':{status:'success',account:ACCOUNT,region:REGION},'/investments':{status:'success',investments:INV},'/transactions':{status:'success',transactions:TX,truncated:false},'/messages':{status:'success',messages:MSG},'/bank/list':{status:'success',accounts:WALLET},'/bank/supported-banks':{status:'success',banks:['CBE Birr','Telebirr']},
'/team/members':{status:'success',members:[{phone:'0911223344',invested:9000,createdAt:'2026-09-01T10:00:00Z'}]},'/team/stats':{status:'success',referralCode:'ET7Q4X',commRates:{l1:27,l2:2,l3:1},team:{l1:2,l2:1,l3:0},totalTeam:3,teamCommission:420,teamDeposits:12000,milestones:[{key:'m1',type:'count',target:3,reward:50,claimed:false},{key:'m2',type:'deposit',target:5000,reward:100,claimed:false}]}};
const FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];";
const fbAuthOLD=u=>"const user="+(u?"{uid:'u1',email:'912345678@petro-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}":"null")+";export const getAuth=()=>({currentUser:user});export const createUserWithEmailAndPassword=async()=>({user});export const signInWithEmailAndPassword=async()=>({user});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};";

const fbAuth=u=>`let cb=null;const mk=()=>({uid:'u9',email:'912345678@petro-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})});
let user=null;
export const getAuth=()=>({get currentUser(){return user}});
export const createUserWithEmailAndPassword=async()=>{user=mk();setTimeout(()=>cb&&cb(user),20);return {user}};
export const signInWithEmailAndPassword=async()=>{user=mk();setTimeout(()=>cb&&cb(user),20);return {user}};
export const signOut=async()=>{user=null;setTimeout(()=>cb&&cb(null),10)};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};
export const onAuthStateChanged=(a,c)=>{cb=c;setTimeout(()=>c(null),0);};`;

ROUTES['/register']={status:'success'};
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8870,async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:411,height:776},deviceScaleFactor:2,serviceWorkers:'block'});const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 await page.route(API+'/**',async r=>{await new Promise(x=>setTimeout(x,500));const u=new URL(r.request().url());const k=Object.keys(ROUTES).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
 await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(false)}));
 await page.goto('http://127.0.0.1:8870/index.html',{waitUntil:'commit'});await page.waitForTimeout(3500);
 await page.evaluate(()=>showAuthTab('register'));await page.waitForTimeout(300);
 await page.fill('#regPhone','0912345678');await page.fill('#regPassword','secret1');await page.fill('#regPassword2','secret1');
 const ref=await page.$('#regReferral');if(ref)await page.fill('#regReferral','ABC123');
 await page.screenshot({path:'/tmp/claude-0/shots/reg-before.png'});
 await page.evaluate(()=>doRegister());

 await page.evaluate(()=>doRegister());await page.waitForTimeout(3500);
 const st=await page.evaluate(()=>{const d=id=>getComputedStyle(document.getElementById(id)).display;return {auth:d('authScreen'),app:d('app'),loading:d('loadingScreen'),loginPane:d('loginPane'),regPane:d('registerPane'),regPhone:document.getElementById('regPhone').value,regPass:document.getElementById('regPassword').value,regRef:document.getElementById('regReferral').value}});
 const assert=require('node:assert/strict');let checks=0;const ok=(c,m)=>{checks++;assert.ok(c,m)};
 ok(st.app==='block'&&st.auth==='none'&&st.loading==='none','after registering only the app is on screen');
 ok(st.loginPane==='block'&&st.regPane==='none','the sign-in screen behind it is already reset to Log In');
 ok(st.regPhone===''&&st.regPass===''&&st.regRef==='','the typed phone, password and referral code are cleared');
 await page.evaluate(()=>doLogout());await page.waitForTimeout(1500);
 const st2=await page.evaluate(()=>{const d=id=>getComputedStyle(document.getElementById(id)).display;const vis=[...document.querySelectorAll('#authScreen [id$=Pane]')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id);return {auth:d('authScreen'),app:d('app'),vis}});
 ok(st2.auth==='block'&&st2.app==='none','after Log Out only the sign-in screen is on screen');
 ok(st2.vis.length===1&&st2.vis[0]==='loginPane','and exactly one pane is showing: the Log In pane ('+st2.vis+')');
 ok(errs.length===0,'no page errors: '+errs.join(' | '));
 console.log('PASS: after registration the sign-in screen is reset ('+checks+' checks)');
 await b.close();srv.close();});
