// Spin wheel on the BUILT app (stubbed API/Firebase), 411x776 at 2.625 like the owner's phone: the ring loader, three dots,
// the pay page, the processing card, the Open App / Scan QR page and the how-to sheet. Geometry is asserted against numbers
// measured from his 1080 px screenshots (css px = screenshot px / 2.625). The order of events and what is sent to the server too.
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const assert=require('node:assert/strict');let checks=0;const ok=(c,m)=>{checks++;assert.ok(c,m);};const near=(v,t,tol,m)=>ok(Math.abs(v-t)<=tol,m+' (got '+v+', want '+t+' +-'+tol+')');
const ROOT=path.join(__dirname,'user'), LANGC='en';
const API=(fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/API_BASE\s*=\s*'([^']+)'/)||[])[1];
const REGION={key:'ci',name:"Côte d'Ivoire",currency:'XOF',dialCode:'225',localLength:10,prefixes:['01','05','07'],utcOffsetMin:0,isDefault:true,languages:['fr'],defaultLang:'fr',usesBareLocal:false};
const ACCOUNT={phone:'0912345678',walletBalance:12850,totalDeposited:20000,totalEarned:3100,totalWithdrawn:2000,totalInvested:12000,checkinStreak:3,lastCheckinAt:null,referralCode:'ET7Q4X',publicId:'00042',registrationDone:true,spins:2,team:{l1:2,l2:1,l3:0,commission:420},region:REGION};
const SETTINGS={minDeposit:300,minWithdraw:200,withdrawFeePct:15,withdrawMultiple:50,commL1:27,commL2:2,commL3:1,annEnabled:false,annTitle:'Welcome',annBody:'Welcome to the app.',depositPayAEnabled:true,openingCountdownEnabled:false,maintenanceMode:false,dailyCheckin:50,turntableEnabled:true,brandName:'Petro',withdrawWindowEnabled:true,withdrawOpenFrom:'06:00',withdrawOpenTo:'17:00',usdtRate:120,cardEnabled:true,usdtEnabled:true,manualPay:true,depositAvailable:true};
const PRODUCTS=[{key:'p1',name:'Asset-1',price:3000,cycle:150,expectedReturn:90000,dailyPayout:600,image:'',active:true,spinCount:2,open:true},{key:'p2',name:'Asset-2',price:9000,cycle:150,expectedReturn:270000,dailyPayout:1800,image:'',active:true,comingSoon:true,open:false,openMode:'soon'}];
const INV=[{id:'i1',tierKey:'p1',tierName:'Asset-1',assetKey:'p1',assetName:'Asset-1',amount:3000,expectedReturn:90000,payoutsMade:4,payoutsTotal:150,paidOut:2400,status:'running',createdAt:'2026-09-10T18:13:00Z'},{id:'i2',tierKey:'p2',tierName:'Asset-2',amount:9000,expectedReturn:270000,payoutsMade:150,payoutsTotal:150,paidOut:270000,status:'matured',createdAt:'2026-03-01T09:00:00Z'}];
const TX=[{id:'t1',type:'deposit',amount:5000,status:'completed',description:'Deposit: Paid',date:'12/09/2026',time:'14:02'},{id:'t2',type:'withdraw',amount:-2000,status:'pending',description:'Withdrawal: Processing',date:'13/09/2026',time:'09:41'},{id:'t3',type:'withdraw',amount:-2000,status:'failed',description:'Withdrawal: Rejected',date:'13/09/2026',time:'10:02'},{id:'t4',type:'turntable',amount:70,status:'completed',description:'Turntable win',date:'14/09/2026',time:'07:15'},{id:'t5',type:'welcome_bonus',amount:700,status:'completed',description:'Welcome Bonus',date:'01/09/2026',time:'08:00'},{id:'t6',type:'commission',amount:810,status:'completed',description:'Level 1 Commission',date:'02/09/2026',time:'11:20'},{id:'t7',type:'cashback',amount:600,status:'completed',description:'Daily cashback',date:'14/09/2026',time:'00:05'},{id:'t8',type:'invest',amount:-3000,status:'completed',description:'Bought Asset-1',date:'10/09/2026',time:'18:13'}];
const MSG=[{id:'m1',title:'Welcome',body:'Thanks for joining.',createdAt:'2026-09-01T08:00:00Z',read:false}];
const WALLET=[{id:'w1',provider:'Wave',accountNumber:'0912345678',accountName:'Abebe K',isDefault:true}];
const ROUTES={'/public/settings':{status:'success',region:REGION,settings:SETTINGS},'/public/products':{status:'success',products:PRODUCTS},'/public/activity-feed':{status:'success',feed:[{kind:'deposit',phone:'251****4417',amount:3000},{kind:'withdraw',phone:'251****9022',amount:2500}]},
'/account':{status:'success',account:ACCOUNT,region:REGION},'/investments':{status:'success',investments:INV},'/transactions':{status:'success',transactions:TX,truncated:false},'/messages':{status:'success',messages:MSG},'/bank/list':{status:'success',accounts:WALLET},'/bank/supported-banks':{status:'success',banks:['CBE Birr','Telebirr']},
'/team/members':{status:'success',members:[{phone:'0911223344',invested:9000,createdAt:'2026-09-01T10:00:00Z'}]},'/team/stats':{status:'success',referralCode:'ET7Q4X',commRates:{l1:27,l2:2,l3:1},team:{l1:2,l2:1,l3:0},totalTeam:3,teamCommission:420,teamDeposits:12000,milestones:[{key:'m1',type:'count',target:3,reward:50,claimed:false},{key:'m2',type:'deposit',target:5000,reward:100,claimed:false}]}};
const FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];";
const fbAuth=u=>"const user="+(u?"{uid:'u1',email:'912345678@petro-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}":"null")+";export const getAuth=()=>({currentUser:user});export const createUserWithEmailAndPassword=async()=>({user});export const signInWithEmailAndPassword=async()=>({user});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};";


const LOGO='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CH=[{id:'w1',name:'Wave',kind:'wave',logo:''}];
ROUTES['/public/pay-channels']={status:'success',channels:CH};
const posts=[];const QRDATA=LOGO;
const SLICES=[200,250,300,400,500,600,700,800,900,1000];
let SPINS=2,NEXT_IDX=3,NEXT_REWARD=400;
ROUTES['/turntable/status']=null;
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8867,async()=>{
 const b=await chromium.launch();let failed=null;
 try{
 const ctx=await b.newContext({viewport:{width:411,height:776},deviceScaleFactor:2.625,serviceWorkers:'block'});
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 await page.route(API+'/**',async r=>{const u=new URL(r.request().url());
  if(u.pathname.endsWith('/turntable/status')){return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',enabled:true,dailyAvailable:SPINS>0,earnedSpins:0,totalSpins:SPINS,nextDailyAt:Date.now()+36e5,slices:SLICES})});}
  if(u.pathname.endsWith('/turntable/spin')){posts.push(['spin',JSON.parse(r.request().postData()||'{}')]);if(SPINS<=0)return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({status:'error',message:'Plus aucun tour. Revenez après minuit pour votre tour gratuit du jour.'})});SPINS--;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',reward:NEXT_REWARD,source:'daily',walletBalance:12850+NEXT_REWARD,earnedSpins:0,dailyAvailable:false,totalSpins:SPINS,slices:SLICES,sliceIndex:NEXT_IDX})});}
  if(u.pathname.endsWith('/deposit/manual/order')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['order',body]);const ch=CH.find(c=>c.id===body.channelId);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',depositId:'d1',reference:'M1',amount:body.amount,expiresAt:Date.now()+(29*60+47)*1000,channel:ch,payLink:'https://pay.wave.com/m/test/',qrImage:QRDATA,wallet:body.wallet||''})});}
  if(u.pathname.endsWith('/deposit/manual/submit')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['submit',body]);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',state:'review',message:'Submitted. Our team is checking your payment.'})});}
  const k=Object.keys(ROUTES).filter(k=>ROUTES[k]).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
 await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(true)}));
 await page.goto('http://127.0.0.1:8867/index.html',{waitUntil:'commit'});await page.waitForTimeout(4500);
 const box=sel=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};},sel);

 await page.evaluate(()=>{try{closeAnnouncement()}catch(e){}});
 // Home shows the wheel card, Account the row
 await page.evaluate(()=>showPage('home'));await page.waitForTimeout(700);
 ok(await page.$('.tt-home'),'Home has the Roue de la chance card');
 ok((await page.textContent('.tt-home .cic-title'))==='Roue de la chance','in French');
 await page.evaluate(()=>showPage('account'));await page.waitForTimeout(700);
 ok(await page.evaluate(()=>[...document.querySelectorAll('.acct-list-label')].some(e=>e.textContent==='Roue de la chance')),'Account has the Roue de la chance row');
 // switched off in the admin panel: both entries go
 await page.evaluate(()=>{STATE.settings.turntableEnabled=false;showPage('home')});await page.waitForTimeout(500);
 ok(!(await page.$('.tt-home')),'switched off: no card on Home');
 await page.evaluate(()=>{STATE.settings.turntableEnabled=true;});
 // open the wheel
 await page.evaluate(()=>openTurntable());await page.waitForTimeout(900);
 ok((await page.textContent('#sheetTitle'))==='Roue de la chance','sheet title in French');
 ok((await page.$$('#ttWheel path')).length===10,'ten sections');
 const labels=await page.$$eval('#ttWheel text',els=>els.map(e=>e.textContent));
 ok(JSON.stringify(labels)===JSON.stringify(SLICES.map(n=>n.toLocaleString('en-US'))),'the ten amounts the server sent are on the wheel: '+labels.join(','));
 ok((await page.textContent('#ttSpins'))==='2 tours disponibles','tours available shown');
 ok(!(await page.$eval('#ttBtn',b=>b.disabled)),'the button is on');
 // no overflow at the phone width
 const bx=await page.evaluate(()=>{const e=document.querySelector('.tt-board').getBoundingClientRect();return {w:e.width,h:e.height,l:e.left,r:e.right};});
 ok(bx.r<=411&&bx.l>=0&&Math.abs(bx.w-bx.h)<1,'the wheel fits the screen and is round ('+Math.round(bx.w)+'px)');
 // spin 1: the server draws section 3 (400); the wheel must stop with section 3 under the pointer
 NEXT_IDX=3;NEXT_REWARD=400;
 await page.click('#ttBtn');await page.waitForTimeout(300);
 ok(await page.$eval('#ttBtn',b=>b.disabled&&b.textContent==='La roue tourne…'),'while turning the button is off and says so');
 ok(posts.length===1&&posts[0][0]==='spin','one spin request sent');
 await page.click('#ttBtn',{force:true}).catch(()=>{});await page.waitForTimeout(200);
 ok(posts.length===1,'a second tap while turning sends nothing');
 await page.waitForTimeout(5400);
 const underPointer=async()=>page.evaluate(()=>{const w=document.getElementById('ttWheel');const m=/rotate\(([-\d.]+)deg\)/.exec(w.style.transform||'');const rot=m?parseFloat(m[1]):0;const a=((360-(rot%360))%360+360)%360;return Math.floor(a/36);});
 ok((await underPointer())===3,'the wheel stopped on section 3 (the one the server drew)');
 ok((await page.textContent('#ttResult')).includes('Bravo')&&(await page.textContent('#ttResult')).includes('400'),'the win is announced with the amount: '+(await page.textContent('#ttResult')));
 ok((await page.textContent('#ttSpins'))==='1 tour disponible','one spin left');
 // spin 2: a zero section
 SLICES[7]=0;NEXT_IDX=7;NEXT_REWARD=0;
 await page.click('#ttBtn');await page.waitForTimeout(5800);
 ok((await underPointer())===7,'the wheel stopped on section 7 (relabelled by the spin answer)');
 ok((await page.textContent('#ttResult')).startsWith('Dommage'),'no prize says so: '+(await page.textContent('#ttResult')));
 ok((await page.textContent('#ttSpins'))==='Plus aucun tour pour le moment'&&(await page.$eval('#ttBtn',b=>b.disabled)),'no spins left: the button is off');
 ok((await page.textContent('#ttSub')).includes('Chaque recharge réussie vous donne 1 tour'),'tells them every successful recharge gives one spin');
 ok((await page.$$eval('#ttWheel text',els=>els.map(e=>e.textContent)))[7]==='0','the relabelled section shows 0');
 // an answer of "refused" does not turn the wheel and keeps the balance
 SPINS=1;await page.evaluate(()=>{_tt.status.totalSpins=1;ttPaintStatus();});SPINS=0;
 const before=await page.$eval('#ttWheel',w=>w.style.transform);
 await page.click('#ttBtn');await page.waitForTimeout(900);
 ok((await page.$eval('#ttWheel',w=>w.style.transform))===before,'a refused spin does not turn the wheel');
 ok(!(await page.evaluate(()=>_tt.busy)),'and the button is free again');
 ok(errs.length===0,'no page errors: '+errs.join(' | '));
 console.log('PASS: spin wheel in the member app ('+checks+' checks)');
 await b.close();srv.close();process.exit(0);

 }catch(e){console.log('FAIL',e.message);process.exit(1)}
});
