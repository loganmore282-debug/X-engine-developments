// Wave payment pages on the BUILT app (stubbed API/Firebase), 411x776 at 2.625 like the owner's phone: the ring loader, three dots,
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
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8867,async()=>{
 const b=await chromium.launch();let failed=null;
 try{
 const ctx=await b.newContext({viewport:{width:411,height:776},deviceScaleFactor:2.625,serviceWorkers:'block'});
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 await page.route(API+'/**',async r=>{const u=new URL(r.request().url());
  if(u.pathname.endsWith('/deposit/manual/order')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['order',body]);const ch=CH.find(c=>c.id===body.channelId);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',depositId:'d1',reference:'M1',amount:body.amount,expiresAt:Date.now()+(29*60+47)*1000,channel:ch,payLink:'https://pay.wave.com/m/test/',qrImage:QRDATA,wallet:body.wallet||''})});}
  if(u.pathname.endsWith('/deposit/manual/submit')){const body=JSON.parse(r.request().postData()||'{}');posts.push(['submit',body]);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',state:'review',message:'Submitted. Our team is checking your payment.'})});}
  const k=Object.keys(ROUTES).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
 await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(true)}));
 await page.goto('http://127.0.0.1:8867/index.html',{waitUntil:'commit'});await page.waitForTimeout(4500);
 const box=sel=>page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};},sel);
 await page.evaluate(()=>{try{closeAnnouncement()}catch(e){};STATE.settings.manualPay=true;});
 await page.evaluate(()=>{openWavePayFlow(5000)});await page.waitForTimeout(200);
 // 1. ring loader, then three dots, then the pay page
 ok(await page.$('#mpFlow.show.wv .wv-veil .wv-ring'),'first the ring loader');
 ok((await page.textContent('.wv-ringtxt'))==='Chargement','with the word Chargement');
 const veil=await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-veil')).backgroundColor);ok(veil==='rgb(237, 248, 242)','mint page behind the loader ('+veil+')');
 await page.waitForTimeout(700);ok(await page.$('.wv-dots i:nth-child(3)'),'then the three dots');
 const dots=await box('.wv-dots');near(dots.y+dots.h/2,349.5,3,'dots height');
 await page.waitForTimeout(900);
 ok(!(await page.$('.wv-veil')),'the loaders are gone once the page is ready');
 const o1=posts.find(p=>p[0]==='order');ok(o1&&o1[1].channelId==='w1'&&o1[1].amount===5000&&o1[1].wallet===undefined,'the order is opened (no wallet yet) when the page appears');
 // 2. pay page geometry
 const card=await box('.wv-card');near(card.y,80.8,1.5,'card top');near(card.x,10.5,1,'card left');near(card.w,390,2,'card width');near(card.h,610.2,6,'card height');
 const bg=await page.evaluate(()=>getComputedStyle(document.getElementById('mpFlow')).backgroundColor);ok(bg==='rgb(238, 155, 89)','orange page '+bg);
 const timer=await box('#wvTimer');near(timer.h,38.5,1.5,'timer box height');ok(/^\d\d:\d\d$/.test(await page.textContent('#wvTimer')),'a mm:ss clock');
 const amt=await box('.wv-amt');near(amt.y,150.1,1.5,'amount bar top');near(amt.h,62.5,1.5,'amount bar height');
 ok((await page.textContent('.wv-amt'))==='Montant du paiementFCFA 5,000','amount text');
 const logo=await box('.wv-logo');near(logo.w,54.9,1,'logo size');near(logo.y,223.6,2,'logo top');
 const row=await box('.wv-row');near(row.y,291.4,2,'Wave row top');near(row.h,52.6,1.5,'Wave row height');
 const fld=await box('#wvField');near(fld.y,362,2.5,'wallet box top');near(fld.h,58,1.5,'wallet box height');
 ok((await page.textContent('.wv-cc'))==='+225','+225 chip');
 const go=await box('.wv-go');near(go.y,528,3,'Soumettre top');near(go.h,44.2,1.5,'Soumettre height');
 const sec=await box('.wv-sec');near(sec.y,587.8,3,'secure card top');near(sec.h,77.3,2,'secure card height');
 ok(/Paiement Sécurisé Protégé/.test(await page.textContent('.wv-sec')),'secure card words');
 ok((await page.textContent('.wv-lang'))==='ENGLISH','the pill offers English while the page is French');
 const pill=await box('.wv-lang');near(pill.h,39.6,1.5,'pill height');near(pill.y,88.8,2,'pill top');near(pill.x+pill.w,383,2,'pill right edge');
 ok((await box('#wvTimer')).x>100&&(await box('#wvTimer')).x<130,'the clock sits left of centre, as in the screenshot');
 await page.evaluate(()=>{wvLang()});await page.waitForTimeout(500);
 ok((await page.textContent('.wv-amt span'))==='Payment amount'&&(await page.textContent('.wv-go'))==='Submit'&&(await page.textContent('.wv-lang'))==='FRANÇAIS','English: the whole page changes and the pill offers Français');
 ok(/Please enter wallet number/.test(await page.textContent('.wv-fin label'))&&/10-digit/.test(await page.textContent('.wv-hint'))&&/Secure Payment Protected/.test(await page.textContent('.wv-sec')),'English wallet label, hint and secure card');
 ok((await page.evaluate(()=>localStorage.getItem('wv_lang')))==='en','the choice is remembered');
 await page.evaluate(()=>{wvLang()});await page.waitForTimeout(500);
 ok((await page.textContent('.wv-amt span'))==='Montant du paiement','and back to French');
 // 3. wallet number: digits only, ten of them
 await page.fill('#wvWallet','07a69 96-81 58999');ok((await page.inputValue('#wvWallet'))==='0769968158','digits only, ten of them');
 await page.fill('#wvWallet','0769');await page.evaluate(()=>{wvSubmit();});await page.waitForTimeout(350);
 ok(await page.$('.wv-toast'),'a short number shows the orange warning bar');ok(/Veuillez saisir le numéro de portefeuille correct/.test(await page.textContent('.wv-tt')),'with the owner\'s words');
 const tb=await box('.wv-toast');near(tb.h,58.3,1.5,'warning bar height');near(tb.y,354,6,'warning bar sits over the wallet box');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-toast')).backgroundImage)).includes('255, 152, 0'),'orange');
 ok(await page.$('.wv-tc'),'with a CLOSE button');await page.click('.wv-tc');await page.waitForTimeout(600);ok(!(await page.$('.wv-toast')),'CLOSE sends it away');
 ok(!(await page.$('.wv-proc')),'and nothing was sent');
 const posts0=posts.filter(p=>p[0]==='order').length;
 await page.fill('#wvWallet','0769968158');
 // 4. submit -> processing card -> Open App page
 await page.evaluate(()=>{wvSubmit();});await page.waitForTimeout(450);
 const pc=await box('.wv-proc');ok(pc,'the processing card shows');near(pc.w,256.4,1,'card width');near(pc.h,226,1,'card height');
 ok((await page.textContent('.wv-proc b'))==='Traitement en cours...','Traitement en cours...');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-proc')).backgroundColor))==='rgb(242, 242, 242)','light grey card');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-pveil')).backgroundColor))==='rgb(24, 16, 10)','dark page behind it');
 await page.waitForTimeout(1700);
 const o2=posts.filter(p=>p[0]==='order').pop();ok(o2[1].wallet==='0769968158'&&o2[1].depositId==='d1','the wallet goes to the SAME order');ok(posts.filter(p=>p[0]==='order').length===posts0+1,'one order call for the submit');
 ok(!(await page.$('.wv-proc')),'the card goes away');
 // 5. Open App page
 const pg=await box('.wv-pg');near(pg.x,16.8,1,'page card left');near(pg.w,377.4,2,'page card width');
 const tabs=await box('.wv-tabs');near(tabs.x,38.5,1,'tabs left');near(tabs.w,334,2,'tabs width');near(tabs.h,62,1.5,'tabs height');
 ok(await page.$('.wv-tab.on:first-child'),'Ouvrir l\'application is the active tab');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-tab.on')).backgroundColor))==='rgb(238, 155, 89)','orange active tab');
 const ar=await box('.wv-ar');near(ar.y-tabs.y-tabs.h,23,1.5,'space under the tabs');near(ar.h,60.8,1.5,'amount row height');
 ok((await page.textContent('.wv-ar'))==='Montant5000FCFA','amount "5000 FCFA"');
 const oc=await box('.wv-oc');near(oc.h,240,1.5,'orange card height');near(oc.w,334,2,'orange card width');
 const pay=await box('.wv-pay');near(pay.h,53.3,1.5,'blue button height');near(pay.y-oc.y-oc.h,27.1,1.5,'space above the blue button');
 const payBg=await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-pay')).backgroundColor);ok(payBg==='rgb(15, 138, 180)','blue button colour '+payBg);
 const res0=await page.evaluate(()=>getComputedStyle(document.getElementById('wvRes')).backgroundColor);ok(res0==='rgb(232, 232, 232)','Obtenir le résultat du paiement is grey until the app was opened');
 await page.evaluate(()=>{window.open=(u)=>{window.__opened=u;};});
 await page.evaluate(()=>wvGetResult());await page.waitForTimeout(200);ok(!posts.some(p=>p[0]==='submit'),'a grey button sends nothing');
 await page.click('.wv-pay');ok((await page.evaluate(()=>window.__opened))==='https://pay.wave.com/m/test/?amount=5000','the blue button opens the Wave link with the amount filled in');
 await page.evaluate(()=>{window.__opened=null;_wv.order.payLink='https://evil.com/pay.wave.com';});await page.click('.wv-pay');
 ok(!(await page.evaluate(()=>window.__opened)),'a link that is not on wave.com is never opened, whatever the server sent');
 ok(await page.evaluate(()=>[wvSafeLink('https://pay.wave.com@evil.com/x'),wvSafeLink('http://pay.wave.com/x'),wvSafeLink('javascript:alert(1)'),wvSafeQr('data:image/svg+xml;base64,PHN2Zz4='),wvSafeQr('https://evil.com/q.png')].every(v=>v==='')),'foreign links and pictures are refused in the browser too');
 await page.evaluate(()=>{_wv.order.payLink='https://pay.wave.com/m/test/';});
 ok((await page.evaluate(()=>getComputedStyle(document.getElementById('wvRes')).backgroundColor))==='rgb(238, 155, 89)','the result button turns orange');
 await page.evaluate(()=>{wvSheet('app')});await page.waitForTimeout(500);ok(await page.$('#wvSheet'),'the guide sheet opens from the blue banner');
 const sh=await box('#wvSheet');near(sh.y+sh.h,776,1,'the sheet sits on the bottom edge');near(sh.y,141.6,2,'and reaches up to the same height as in the recording');
 ok(/Guide de configuration du téléphone Android/.test(await page.textContent('#wvSheet h3'))&&/pay\.wave\.com/.test(await page.textContent('#wvSheet')),'its title and the Wave domains');
 await page.click('.wv-sc');await page.waitForTimeout(450);ok(!(await page.$('#wvSheet')),'Fermer closes it');
 await page.evaluate(()=>{wvLang()});await page.waitForTimeout(450);ok(/Open App/.test(await page.textContent('.wv-tab.on'))&&/Get Payment Result/.test(await page.textContent('#wvRes')),'English on the result page too');
 await page.evaluate(()=>{wvSheet('app')});await page.waitForTimeout(500);ok(/Android Phone Setup Guide \(One-time only\)/.test(await page.textContent('#wvSheet h3')),'the English guide');
 await page.evaluate(()=>{wvSheetClose(true);wvLang()});await page.waitForTimeout(450);
 // 6. QR tab
 await page.evaluate(()=>wvTab('qr'));await page.waitForTimeout(500);
 ok(await page.$('.wv-qr'),'the QR picture shows');ok(/Enregistrer le code QR/.test(await page.textContent('.wv-save')),'with Enregistrer le code QR');
 const sv=await box('.wv-save');near(sv.h,55.8,1.5,'save button height');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('.wv-save')).backgroundColor))==='rgb(76, 175, 80)','green save button');
 const tx=await box('#wvTx');near(tx.h,42.3,1.5,'transaction box height');
 await page.evaluate(()=>wvCheckTx());ok(await page.$('#wvTx.err'),'an empty ID turns the box red');ok(/Le numéro de transaction est requis/.test(await page.textContent('#wvTxMsg')),'transaction number required message');
 const subs0=posts.filter(p=>p[0]==='submit').length;ok(subs0===0,'nothing sent yet');
 await page.fill('#wvTxIn','wave abc-12');ok((await page.inputValue('#wvTxIn'))==='waveabc-12','spaces are dropped from the ID');
 {const v=await page.evaluate(()=>{const i=document.getElementById('wvTxIn'),b=document.getElementById('wvTx').getBoundingClientRect(),r=i.getBoundingClientRect();return {op:getComputedStyle(i).opacity,col:getComputedStyle(i).color,inside:r.top>=b.top&&r.bottom<=b.bottom&&r.left>=b.left&&r.right<=b.right,h:r.height};});ok(v.op==='1'&&v.inside&&v.h>10,'the typed ID is visible inside its box (opacity '+v.op+')');}
 ok(!(await page.$('#wvTx.err')),'typing clears the red box');
 // rubbing the whole ID out: red box, the "required" line and the word shakes sideways; typing again brings the hint back
 await page.fill('#wvTxIn','');
 ok(await page.$('#wvTx.err'),'deleting the whole ID turns the box red at once');
 ok(await page.$('#wvTx.shk'),'and the word Numéro de transaction shakes');
 ok((await page.evaluate(()=>getComputedStyle(document.querySelector('#wvTx .wv-fin label')).animationName))==='wvshk','with the sideways shake animation');
 ok(/Le numéro de transaction est requis/.test(await page.textContent('#wvTxMsg')),'and the required line appears');
 await page.fill('#wvTxIn','waveabc-12');
 ok(!(await page.$('#wvTx.err'))&&/relevé de transfert/.test(await page.textContent('#wvTxMsg')),'typing again clears it and brings the hint back');
 ok((await page.evaluate(()=>{const e=document.getElementById('mpFlow');return Math.abs(parseFloat(e.style.zoom||'1')-Math.max(.75,Math.min(1.5,innerWidth/411)))<.01;})),'the pages are scaled to the phone width');
 await page.evaluate(()=>{wvCheckTx();});await page.waitForTimeout(2200);
 const sub=posts.find(p=>p[0]==='submit');ok(sub&&sub[1].depositId==='d1'&&sub[1].txId==='waveabc-12'&&sub[1].wallet==='0769968158','the claim carries the order, the ID and the wallet');
 ok(!(await page.$('#mpFlow.show')),'the pages close after sending');
 ok(errs.length===0,'no page errors: '+errs.join(' | '));
 console.log('PASS: Wave payment pages built to the owner\'s screenshots ('+checks+' checks)');
 }catch(e){failed=e;}
 await b.close();srv.close();if(failed){console.error(failed);process.exitCode=1;}
});
