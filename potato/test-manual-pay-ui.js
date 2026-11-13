// usage: node sweep.js <lang>   -- lists visible text still containing Latin letters in <lang>
// Member manual-payment pages on the BUILT app (stubbed API/Firebase), 411x776 at 2.625 like the owner's phone.
// Geometry is asserted against numbers measured from his screenshots (css px = screenshot px / 2.625).
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const assert=require('node:assert/strict');let checks=0;const ok=(c,m)=>{checks++;assert.ok(c,m);};const near=(v,t,tol,m)=>ok(Math.abs(v-t)<=tol,m+' (got '+v+', want '+t+' +-'+tol+')');
const ROOT=path.join(__dirname,'user'), LANGC='en';
const API=(fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/API_BASE\s*=\s*'([^']+)'/)||[])[1];
const REGION={key:'et',name:'Ethiopia',currency:'ETB',dialCode:'251',localLength:9,prefixes:['9','7'],utcOffsetMin:180,isDefault:true,languages:['en','am'],defaultLang:'en',usesBareLocal:true};
const ACCOUNT={phone:'0912345678',walletBalance:12850,totalDeposited:20000,totalEarned:3100,totalWithdrawn:2000,totalInvested:12000,checkinStreak:3,lastCheckinAt:null,referralCode:'ET7Q4X',publicId:'00042',registrationDone:true,spins:2,team:{l1:2,l2:1,l3:0,commission:420},region:REGION};
const SETTINGS={manualPay:true,depositAvailable:true,minDeposit:300,minWithdraw:200,withdrawFeePct:15,withdrawMultiple:50,commL1:27,commL2:2,commL3:1,annEnabled:false,annTitle:'Welcome',annBody:'Welcome to the app.',depositPayAEnabled:true,openingCountdownEnabled:false,maintenanceMode:false,dailyCheckin:50,turntableEnabled:true,brandName:'Petro',withdrawWindowEnabled:true,withdrawOpenFrom:'06:00',withdrawOpenTo:'17:00',usdtRate:120,cardEnabled:true,usdtEnabled:true,manualPay:true,depositAvailable:true};
const PRODUCTS=[{key:'p1',name:'Asset-1',price:3000,cycle:150,expectedReturn:90000,dailyPayout:600,image:'',active:true,spinCount:2,open:true},{key:'p2',name:'Asset-2',price:9000,cycle:150,expectedReturn:270000,dailyPayout:1800,image:'',active:true,comingSoon:true,open:false,openMode:'soon'}];
const INV=[{id:'i1',tierKey:'p1',tierName:'Asset-1',assetKey:'p1',assetName:'Asset-1',amount:3000,expectedReturn:90000,payoutsMade:4,payoutsTotal:150,paidOut:2400,status:'running',createdAt:'2026-09-10T18:13:00Z'},{id:'i2',tierKey:'p2',tierName:'Asset-2',amount:9000,expectedReturn:270000,payoutsMade:150,payoutsTotal:150,paidOut:270000,status:'matured',createdAt:'2026-03-01T09:00:00Z'}];
const TX=[{id:'t1',type:'deposit',amount:5000,status:'completed',description:'Deposit: Paid',date:'12/09/2026',time:'14:02'},{id:'t2',type:'withdraw',amount:-2000,status:'pending',description:'Withdrawal: Processing',date:'13/09/2026',time:'09:41'},{id:'t3',type:'withdraw',amount:-2000,status:'failed',description:'Withdrawal: Rejected',date:'13/09/2026',time:'10:02'},{id:'t4',type:'turntable',amount:70,status:'completed',description:'Turntable win',date:'14/09/2026',time:'07:15'},{id:'t5',type:'welcome_bonus',amount:700,status:'completed',description:'Welcome Bonus',date:'01/09/2026',time:'08:00'},{id:'t6',type:'commission',amount:810,status:'completed',description:'Level 1 Commission',date:'02/09/2026',time:'11:20'},{id:'t7',type:'cashback',amount:600,status:'completed',description:'Daily cashback',date:'14/09/2026',time:'00:05'},{id:'t8',type:'invest',amount:-3000,status:'completed',description:'Bought Asset-1',date:'10/09/2026',time:'18:13'}];
const MSG=[{id:'m1',title:'Welcome',body:'Thanks for joining.',createdAt:'2026-09-01T08:00:00Z',read:false}];
const WALLET=[{id:'w1',provider:'CBE Birr',accountNumber:'0912345678',accountName:'Abebe K',isDefault:true}];
const ROUTES={'/public/settings':{status:'success',region:REGION,settings:SETTINGS},'/public/products':{status:'success',products:PRODUCTS},'/public/activity-feed':{status:'success',feed:[{kind:'deposit',phone:'251****4417',amount:3000},{kind:'withdraw',phone:'251****9022',amount:2500}]},
'/account':{status:'success',account:ACCOUNT,region:REGION},'/investments':{status:'success',investments:INV},'/transactions':{status:'success',transactions:TX,truncated:false},'/messages':{status:'success',messages:MSG},'/bank/list':{status:'success',accounts:WALLET},'/bank/supported-banks':{status:'success',banks:['CBE Birr','Telebirr']},
'/team/members':{status:'success',members:[{phone:'0911223344',invested:9000,createdAt:'2026-09-01T10:00:00Z'}]},'/team/stats':{status:'success',referralCode:'ET7Q4X',commRates:{l1:27,l2:2,l3:1},team:{l1:2,l2:1,l3:0},totalTeam:3,teamCommission:420,teamDeposits:12000,milestones:[{key:'m1',type:'count',target:3,reward:50,claimed:false},{key:'m2',type:'deposit',target:5000,reward:100,claimed:false}]}};
const FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];";
const fbAuth=u=>"const user="+(u?"{uid:'u1',email:'912345678@potato-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}":"null")+";export const getAuth=()=>({currentUser:user});export const createUserWithEmailAndPassword=async()=>({user});export const signInWithEmailAndPassword=async()=>({user});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};";


const LOGO='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CH=[{id:'c1',name:'Commercial Bank of Ethiopia',kind:'bank',logo:LOGO},{id:'c2',name:'Telebirr Wallet',kind:'wallet',logo:LOGO}];
ROUTES['/public/pay-channels']={status:'success',channels:CH};
const posts=[];
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8867,async()=>{
 const b=await chromium.launch();let failed=null;
 try{
 const ctx=await b.newContext({viewport:{width:411,height:776},deviceScaleFactor:2.625,serviceWorkers:'block'});
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 await page.route('**'+API+'/**',async r=>{const u=new URL(r.request().url());
  if(u.pathname.endsWith('/deposit/manual/order')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['order',body]);const ch=CH.find(c=>c.id===body.channelId);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',depositId:'d1',reference:'M1',amount:body.amount,expiresAt:Date.now()+(29*60+47)*1000,channel:ch,accountName:ch.id==='c1'?'Ashenafi':'Chala',accountNumber:ch.id==='c1'?'1000809418239':'0962499914'})});}
  if(u.pathname.endsWith('/deposit/manual/submit')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['submit',body]);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',state:'review',message:'Submitted. Our team is checking your payment.'})});}
  const k=Object.keys(ROUTES).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
 await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(true)}));
 await page.goto('http://127.0.0.1:8867/index.html',{waitUntil:'commit'});await page.waitForTimeout(4500);
 try{await page.evaluate(()=>closeAnnouncement())}catch(e){}
 const box=sel=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};},sel);
 // 1. the deposit form hides the phone box and goes to the pages
 await page.evaluate(()=>{STATE.settings=Object.assign({},STATE.settings||{},{manualPay:true,depositAvailable:true,minDeposit:300});openDepositSheet()});await page.waitForTimeout(500);
 ok(!(await page.$('#depPhone')),'the recharge form has no phone box');
 await page.fill('#depAmount','100');await page.evaluate(()=>{submitDeposit();});await page.waitForTimeout(100);
 ok(!(await page.$('#mpFlow.show')),'below the minimum does not open the payment pages');
 await page.fill('#depAmount','550');await page.evaluate(()=>{submitDeposit();});await page.waitForTimeout(120);
 // 2. loading page: the blue ring and the word "loading..."
 ok(await page.$('#mpFlow.dark .mpf-ring circle[stroke="#1870f8"]'),'loading page shows the blue ring');
 ok((await page.textContent('.mpf-loadtxt'))==='loading...','and the word loading...');
 const ring=await box('.mpf-ring'),txt=await box('.mpf-loadtxt');
 near(ring.y+ring.h/2,164,3,'ring centre height');near(txt.y+txt.h/2,210,3,'loading text centre height');
 // 3. choose page
 await page.waitForSelector('.mpf-row',{timeout:5000});
 near((await box('.mpf-ohead')).h,61,1.5,'Order Amount row height');
 const r1=await box('.mpf-row'),r2=await box('.mpf-row:nth-child(2)');
 near(r1.y,121,2.5,'first payment row top');near(r1.h,63.5,1,'payment row height');near(r2.y-r1.y,63.5,1,'row pitch');
 near((await box('.mpf-logo')).w,37.7,0.6,'logo circle size');
 near((await box('.mpf-remind')).y,259,3,'reminder box top');
 ok((await page.textContent('.mpf-oval')).trim()==='Br 550.00','amount shown as Br with two decimals');
 // 4. payment page
 await page.click('.mpf-row >> nth=0');await page.waitForSelector('.mpf-pay',{timeout:5000});
 ok(posts.find(p=>p[0]==='order'&&p[1].amount===550&&p[1].channelId==='c1'),'order requested for the chosen channel');
 near((await box('.mpf-head')).h,60,0.5,'header height');
 near((await box('.mpf-card')).y,60,1,'card top');near((await box('.mpf-card')).x,10.7,0.7,'card side margin');
 near((await box('.mpf-box')).y,113,1.5,'copy box top');near((await box('.mpf-box')).h,242.2,2,'copy box height');
 near((await box('.mpf-ta')).h,151.6,1,'paste box height');near((await box('.mpf-ta')).y,505,3,'paste box top');
 const sb=await box('.mpf-submit');near(sb.h,41,0.5,'submit height');near(sb.y,668.6,3,'submit top');near(sb.w,333.6,1,'submit width');
 near((await box('.mpf-note')).y,721,3,'warning box top');
 const clk=await page.evaluate(()=>[...document.querySelectorAll('.mpf-clock b')].map(e=>e.textContent).join(''));
 ok(/^2[89]\d{2}$/.test(clk)||/^29\d{2}$/.test(clk)||/^2[89][0-5]\d$/.test(clk),'the thirty minute clock is running ('+clk+')');
 const t0=await page.evaluate(()=>document.getElementById('mpS2').textContent);await page.waitForTimeout(2100);
 ok(t0!==await page.evaluate(()=>document.getElementById('mpS2').textContent),'the seconds tick');
 ok((await page.textContent('.mpf-v b >> nth=1')).trim()==='Ashenafi','account name shown');
 ok((await page.textContent('.mpf-v b >> nth=2')).trim()==='1000809418239','account number shown');
 ok(await page.evaluate(()=>getComputedStyle(document.querySelector('.bottom-nav')).visibility==='hidden'),'the bottom bar cannot show through the payment pages (it used to appear on a hard scroll)');
 ok(await page.evaluate(()=>document.getElementById('mpFlow').getBoundingClientRect().height>=window.innerHeight-1),'the payment pages are as tall as the screen');
 // 5. empty submit -> the owner's toast
 await page.evaluate(()=>mpSubmit());await page.waitForTimeout(150);
 ok((await page.textContent('#mpToast'))==='please enter the correct transfer sms','empty paste shows the toast');
 ok(!posts.find(p=>p[0]==='submit'),'and nothing is sent');
 // 6. switch goes back to the choose page, and the SAME order moves
 await page.click('.mpf-pill >> nth=0');await page.waitForSelector('.mpf-row',{timeout:3000});
 ok(!(await page.$('.mpf-pay')),'switch returns to the choose page');
 await page.click('.mpf-row >> nth=1');await page.waitForSelector('.mpf-pay',{timeout:5000});
 const o2=posts.filter(p=>p[0]==='order')[1][1];ok(o2.channelId==='c2'&&o2.depositId==='d1','the second order call carries the same depositId');
 ok((await page.textContent('.mpf-v b >> nth=2')).trim()==='0962499914','the other account is shown');
 ok((await page.getAttribute('.mpf-ta','placeholder')).includes('Dear AMIR'),'wallet page shows the SMS example');
 // 6b. gone to fetch the SMS and the browser reloads the app: the pay page, the same order and the typed text come back
 await page.fill('.mpf-ta','Your transaction number is DA39');await page.waitForTimeout(100);
 ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('mp_resume')||'null').sms)==='Your transaction number is DA39','the typed SMS is remembered as it is typed');
 const nOrders=posts.filter(p=>p[0]==='order').length;
 await page.reload({waitUntil:'commit'});await page.waitForTimeout(4500);try{await page.evaluate(()=>closeAnnouncement())}catch(e){}
 // (this stub does not complete a sign-in, so the entry hook is called by hand; its two call sites in enterApp / the sign-up entry are checked in the source)
 await page.evaluate(()=>{STATE.settings=Object.assign({},STATE.settings||{},{manualPay:true,depositAvailable:true});resumeManualPay();});
 await page.waitForSelector('.mpf-pay',{timeout:9000});
 ok((fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/resumeManualPay\(\)/g)||[]).length>=2,'both app entries put the member back on the payment pages');
 ok(await page.inputValue('.mpf-ta')==='Your transaction number is DA39','after a reload the SMS box has what was typed');
 const ro=posts.filter(p=>p[0]==='order').slice(nOrders)[0];ok(ro&&ro[1].depositId==='d1'&&ro[1].channelId==='c2'&&ro[1].amount===550,'the same order and channel are asked for again');
 ok((await page.textContent('.mpf-v b >> nth=2')).trim()==='0962499914','and the same account is shown');
 // 7. real submit
 await page.fill('.mpf-ta','Your transaction number is DA39J9GAMN');await page.evaluate(()=>mpSubmit());await page.waitForTimeout(500);
 const sub=posts.find(p=>p[0]==='submit');ok(sub&&sub[1].depositId==='d1'&&/DA39J9GAMN/.test(sub[1].sms),'the pasted message is sent with the order id');
 ok(!(await page.$('#mpFlow.show')),'the pages close after submitting');
 ok(await page.evaluate(()=>localStorage.getItem('mp_resume'))===null,'nothing is left to resume after submitting');
 ok(errs.length===0,'no page errors: '+errs.join(' | '));
 console.log('PASS: manual payment pages built to the owner\'s screenshots ('+checks+' checks)');
 }catch(e){failed=e;}
 await b.close();srv.close();if(failed){console.error(failed);process.exitCode=1;}
});
