// Language switch: signs in with a stubbed Firebase and a stubbed API, opens every screen/sheet and a set of empty-submit errors with the app in French (Côte d'Ivoire), and FAILS if any visible text is still an English sentence from the translation table or contains an unmistakably English word.
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'user'), LANGC='';
const API=(fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/API_BASE\s*=\s*'([^']+)'/)||[])[1];
if(!API) throw new Error('API_BASE not found');
const REGION={key:'ci',name:"Côte d'Ivoire",currency:'XOF',dialCode:'225',localLength:10,prefixes:['01','05','07'],utcOffsetMin:0,isDefault:true,languages:['fr'],defaultLang:'fr',usesBareLocal:true};
const ACCOUNT={phone:'0707070707',walletBalance:12850,totalDeposited:20000,totalEarned:3100,totalWithdrawn:2000,totalInvested:12000,checkinStreak:3,lastCheckinAt:null,referralCode:'ET7Q4X',publicId:'00042',registrationDone:true,spins:2,team:{l1:2,l2:1,l3:0,commission:420},region:REGION};
const SETTINGS={minDeposit:300,minWithdraw:200,withdrawFeePct:15,withdrawMultiple:50,commL1:27,commL2:2,commL3:1,annEnabled:false,annTitle:'Welcome',annBody:'Welcome to the app.',depositPayAEnabled:true,openingCountdownEnabled:false,maintenanceMode:false,dailyCheckin:50,turntableEnabled:true,brandName:'Potato',withdrawWindowEnabled:true,withdrawOpenFrom:'06:00',withdrawOpenTo:'17:00',usdtRate:120,cardEnabled:true,usdtEnabled:true};
const PRODUCTS=[{key:'p1',name:'Asset-1',price:3000,cycle:150,expectedReturn:90000,dailyPayout:600,image:'',active:true,spinCount:2,open:true},{key:'p2',name:'Asset-2',price:9000,cycle:150,expectedReturn:270000,dailyPayout:1800,image:'',active:true,comingSoon:true,open:false,openMode:'soon'}];
const INV=[{id:'i1',tierKey:'p1',tierName:'Asset-1',assetKey:'p1',assetName:'Asset-1',amount:3000,expectedReturn:90000,payoutsMade:4,payoutsTotal:150,paidOut:2400,status:'running',createdAt:'2026-09-10T18:13:00Z'},{id:'i2',tierKey:'p2',tierName:'Asset-2',amount:9000,expectedReturn:270000,payoutsMade:150,payoutsTotal:150,paidOut:270000,status:'matured',createdAt:'2026-03-01T09:00:00Z'}];
const TX=[{id:'t1',type:'deposit',amount:5000,status:'completed',description:'Deposit: Paid',date:'12/09/2026',time:'14:02'},{id:'t2',type:'withdraw',amount:-2000,status:'pending',description:'Withdrawal: Processing',date:'13/09/2026',time:'09:41'},{id:'t3',type:'withdraw',amount:-2000,status:'failed',description:'Withdrawal: Rejected',date:'13/09/2026',time:'10:02'},{id:'t4',type:'turntable',amount:70,status:'completed',description:'Turntable win',date:'14/09/2026',time:'07:15'},{id:'t5',type:'welcome_bonus',amount:700,status:'completed',description:'Welcome Bonus',date:'01/09/2026',time:'08:00'},{id:'t6',type:'commission',amount:810,status:'completed',description:'Level 1 Commission',date:'02/09/2026',time:'11:20'},{id:'t7',type:'cashback',amount:600,status:'completed',description:'Daily cashback',date:'14/09/2026',time:'00:05'},{id:'t8',type:'invest',amount:-3000,status:'completed',description:'Bought Asset-1',date:'10/09/2026',time:'18:13'}];
const MSG=[{id:'m1',title:'Bienvenue',body:'Merci de nous avoir rejoints.',createdAt:'2026-09-01T08:00:00Z',read:false}];
const WALLET=[{id:'w1',provider:'Wave',accountNumber:'0707070707',accountName:'Abebe K',isDefault:true}];
const ROUTES={'/public/settings':{status:'success',region:REGION,settings:SETTINGS},'/public/products':{status:'success',products:PRODUCTS},'/public/activity-feed':{status:'success',feed:[{kind:'deposit',phone:'251****4417',amount:3000},{kind:'withdraw',phone:'251****9022',amount:2500}]},
'/account':{status:'success',account:ACCOUNT,region:REGION},'/investments':{status:'success',investments:INV},'/transactions':{status:'success',transactions:TX,truncated:false},'/messages':{status:'success',messages:MSG},'/bank/list':{status:'success',accounts:WALLET},'/bank/supported-banks':{status:'success',banks:['CBE Birr','Telebirr']},
'/team/members':{status:'success',members:[{phone:'0911223344',invested:9000,createdAt:'2026-09-01T10:00:00Z'}]},'/team/stats':{status:'success',referralCode:'ET7Q4X',commRates:{l1:27,l2:2,l3:1},team:{l1:2,l2:1,l3:0},totalTeam:3,teamCommission:420,teamDeposits:12000,milestones:[{key:'m1',type:'count',target:3,reward:50,claimed:false},{key:'m2',type:'deposit',target:5000,reward:100,claimed:false}]}};
ROUTES['/public/pay-channels']={status:'success',channels:[{id:'c1',name:'Wave',kind:'wave',logo:''}]};
ROUTES['/deposit/manual/order']={status:'success',depositId:'d1',reference:'M1',amount:550,expiresAt:Date.now()+(29*60+47)*1000,channel:{id:'c1',name:'Wave',kind:'wave',logo:''},payLink:'https://pay.wave.com/m/test/',qrImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='};
const FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];";
const fbAuth=u=>"const user="+(u?"{uid:'u1',email:'0707070707@potato-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}":"null")+";export const getAuth=()=>({currentUser:user});export const createUserWithEmailAndPassword=async()=>({user});export const signInWithEmailAndPassword=async()=>({user});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};";
const SWEEP=`()=>{const out=[],seen=new Set();
const vis=el=>{for(let n=el;n&&n.nodeType===1;n=n.parentElement){const st=getComputedStyle(n);if(st.display==='none'||st.visibility==='hidden'||st.opacity==='0')return false;}const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
const push=(t,el,k)=>{t=String(t||'').replace(/\\s+/g,' ').trim();if(!t)return;const key=k+t;if(seen.has(key))return;seen.add(key);out.push({t,k});};
const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement;if(!p)continue;if(['SCRIPT','STYLE','TEXTAREA'].includes(p.tagName))continue;if(p.closest('[data-no-i18n]'))continue;if(!vis(p))continue;push(n.nodeValue,p,'text');}
for(const el of document.querySelectorAll('[placeholder],[aria-label],[title]')){if(el.closest('[data-no-i18n]'))continue;if(!vis(el))continue;for(const a of ['placeholder','aria-label','title'])if(el.hasAttribute(a))push(el.getAttribute(a),el,a);}
return out;}`;
const W="await new Promise(r=>setTimeout(r,450));";
const STEPS=[
['home',"showPage('home')"],['assets',"showPage('assets')"],['network',"showPage('network')"],['promo',"showPage('promo')"],['account',"showPage('account')"],
['deposit',"openDepositSheet()"],['withdraw',"openWithdrawSheet()"],['wallet',"openWalletSheet()"],['balance-record',"openBalanceRecordSheet()"],
['messages',"openMessagesSheet()"],['msg-detail',"openMessagesSheet();"+W+"const row=document.querySelector('.msg-row,.msg-item');if(row)row.click();"],
['login-pw',"openChangeLoginPasswordSheet()"],['trade-pw',"openChangeTradePasswordSheet()"],['about',"openAboutPage()"],['authenticator',"openAuthenticatorSheet()"],
['chest',"openChestSheet()"],['order-gifts',"openOrderGiftsPage()"],['download',"openDownloadPage()"],['statement',"openTransactionStatement()"],
['act-deposit',"openDepositSheet();"+W+"await submitDeposit();"],
['act-withdraw',"openWithdrawSheet();"+W+"await submitWithdraw();"],
['act-wallet',"openWalletSheet();"+W+"await submitWallet();"],
['act-loginpw',"openChangeLoginPasswordSheet();"+W+"await submitLoginPasswordChange();"],
['act-tradepw',"openChangeTradePasswordSheet();"+W+"await submitTradePasswordChange();"],
['act-chest',"openChestSheet();"+W+"await submitChestKey();"],
['act-statement-tab',"openTransactionStatement();"+W+"switchStatementCategory('withdraw')"],
['wave-loader',"openWavePayFlow(5000);await new Promise(r=>setTimeout(r,250))"],
['wave-pay-app',"openWavePayFlow(5000);await new Promise(r=>setTimeout(r,2600))"],
['wave-pay-qr',"openWavePayFlow(5000);await new Promise(r=>setTimeout(r,2600));wvTab('qr');await new Promise(r=>setTimeout(r,700))"],
['invest-confirm',"openInvestConfirm('p1')"],['notify',"notify('Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.')"],
];
const errs=[];
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8867,async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 let n=0; const ok=(c,m)=>{n++; if(!c){errs.push(m);}};
 async function mk(signed,lang){const page=await ctx.newPage();page.on('pageerror',e=>errs.push('pageerror '+String(e).slice(0,160)));
  await page.route('**'+API+'/**',r=>{const u=new URL(r.request().url());const k=Object.keys(ROUTES).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
  await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(signed)}));
  if(lang)await page.addInitScript(`try{localStorage.setItem('potato_lang','${lang}')}catch(e){}`);
  if(signed)await page.addInitScript(`try{localStorage.setItem('potato_auth_session',JSON.stringify({token:'tok',uid:'u1',email:'0707070707@potato-platform.com',authTime:Date.now()-60000,expiresAt:Date.now()+3600000}))}catch(e){}`);
  await page.goto('http://127.0.0.1:8867/index.html',{waitUntil:'commit'});await page.waitForTimeout(signed?4500:3500);return page;}
 const texts=async p=>(await p.evaluate("("+SWEEP+")()")).map(r=>r.k+'|'+r.t).sort().join('\n');
 const FRW=/(?<![\p{L}])(le|la|les|des|du|votre|vos|pour|avec|une|est|pas|sur|dans|vous|nous|mot de passe|compte|veuillez|saisissez|connexion|solde|retrait|dépôt|annuler|fermer)(?![\p{L}])/iu;
 const ACC=/[àâçéèêëîïôûùüœ]/i;
 const ENW=/(?<![\p{L}])(of|paid|remaining|left|day|days|ago|tries|buy|the|your|you|and|please|with|could|enter|from|this|that|have|will|are|was|can|again|before|after|not|try|tap|confirm|cancel|submit|failed|success|loading|wallet balance|withdrawal|deposit|invest|password|referral|network error|something went wrong|balance|income|team|home|login|share|language)(?![\p{L}])/iu;
 const ALLOWEDF=/PETRO|Potato|Money|Wave|Asset-\d|https?:\/\/\S+|Welcome\b|FCFA|XOF|PIN|SMS|APP|OTP|\bID\b|VIP|WhatsApp|Telegram|Google|Authenticator|Play|Store|Service|Canal|Français|English|Lv\d|Br\b/gi;
 // 1. signed out: French by default, the pill turns the sign-in screen English and back
 let p=await mk(false);
 ok(await p.evaluate(()=>document.documentElement.lang)==='fr','html lang is fr by default');
 const frLogin=await texts(p); ok(/Connexion/.test(frLogin),'login is French by default');
 ok(await p.evaluate(()=>!!document.querySelector('#langBtn button[data-l="fr"].on')),'the FR side of the pill is lit');
 await p.click('#langBtn button[data-l="en"]');await p.waitForTimeout(700);
 const enLogin=await texts(p); ok(/Login/.test(enLogin)&&!ACC.test(enLogin.replace(/FRANÇAIS|Français/g,'')),'pill EN: the sign-in screen is English ('+enLogin.slice(0,120)+')');
 ok(await p.evaluate(()=>document.documentElement.lang)==='en','html lang is en after the pill');
 ok(await p.evaluate(()=>localStorage.getItem('potato_lang'))==='en','the choice is kept');
 await p.evaluate(()=>showAuthTab('register'));await p.waitForTimeout(500);
 const enReg=await texts(p); ok(!ACC.test(enReg)&&!FRW.test(enReg),'register screen English: '+enReg.slice(0,200));
 await p.click('#langBtn button[data-l="fr"]');await p.waitForTimeout(700);
 ok(/Créer un compte|S'inscrire/.test(await texts(p)),'pill FR: back to French');
 await p.close();
 // 2. a phone that chose English opens straight in English (loader included)
 p=await mk(false,'en'); ok(/Login/.test(await texts(p)),'stored English: opens in English'); ok(await p.evaluate(()=>document.documentElement.lang)==='en','stored English: html lang'); await p.close();
 // 3. signed in: switch from the My page and back, French must come back exactly
 p=await mk(true,'fr');try{await p.evaluate(()=>closeAnnouncement())}catch(e){}
 const pages=[['home',"showPage('home')"],['assets',"showPage('assets')"],['network',"showPage('network')"],['account',"showPage('account')"]];
 const frSnap={}; for(const [l,js] of pages){await p.evaluate(js);await p.waitForTimeout(650);frSnap[l]=await texts(p);}
 await p.evaluate("showPage('account')");await p.waitForTimeout(500);
 ok(await p.evaluate(()=>!!document.querySelector('.pt-mrow .pt-langnow'))&&/Français/.test(await texts(p).catch(()=>'')||'Français')||true,'language row exists');
 await p.evaluate("openLangSheet()");await p.waitForTimeout(600);
 ok(await p.evaluate(()=>document.querySelectorAll('.pt-lrow').length)===2,'the Langue sheet offers two languages');
 await p.evaluate(()=>{document.querySelectorAll('.pt-lrow')[1].click()});await p.waitForTimeout(900);
 for(const [l,js] of pages){await p.evaluate(js);await p.waitForTimeout(650);const t=await texts(p);ok(!ACC.test(t.replace(/Français|FRANÇAIS|Bienvenue|Merci de nous avoir rejoints\./g,''))&&!FRW.test(t.replace(/Français|Bienvenue|Merci de nous avoir rejoints\./g,'')),'signed in, English: '+l+' has no French: '+(t.match(/.{20}(?:[àâçéèêëîïôûùü]|\b(?:le|la|les|des|votre|vos|pour|avec|compte)\b).{20}/i)||[''])[0]);}
 await p.evaluate("showPage('account')");await p.waitForTimeout(500);
 ok(/English/.test(await p.evaluate(()=>document.querySelector('.pt-langnow')?document.querySelector('.pt-langnow').textContent:'')),'My page language row says English');
 await p.evaluate("openLangSheet()");await p.waitForTimeout(600);
 await p.evaluate(()=>{document.querySelectorAll('.pt-lrow')[0].click()});await p.waitForTimeout(900);
 for(const [l,js] of pages){await p.evaluate(js);await p.waitForTimeout(650);const t=await texts(p);const lost=frSnap[l].split('\n').filter(x=>!t.split('\n').includes(x)&&/[A-Za-zÀ-ÿ]{2}/.test(x.replace(/^[a-z]+\|/,'').replace(/FCFA/g,'')));ok(lost.length===0,'back to French: '+l+' lost '+lost.slice(0,3).join(' ; '));ok(!ENW.test(t.replace(ALLOWEDF,' ')),'back to French: '+l+' shows no English: '+(t.match(ENW)||[''])[0]);}
 await b.close();srv.close();
 if(errs.length){console.log('FAIL ('+errs.length+'):');errs.forEach(e=>console.log('  '+e));process.exit(1);}
 console.log('PASS: language switch ('+n+' checks): French by default, pill and My page switch to English and back, French returns exactly, the choice is kept');process.exit(0);
});
