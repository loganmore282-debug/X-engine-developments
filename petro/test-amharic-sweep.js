// usage: node sweep.js <lang>   -- lists visible text still containing Latin letters in <lang>
// Amharic sweep: signs in with a stubbed Firebase and a stubbed API, opens every screen/sheet and a set of empty-submit errors with the language set to Amharic, and FAILS if any visible text still contains an English word.
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'user'), LANGC='am';
const API=(fs.readFileSync(path.join(__dirname,'user-src/original_module.js'),'utf8').match(/API_BASE\s*=\s*'([^']+)'/)||[])[1];
if(!API) throw new Error('API_BASE not found');
const REGION={key:'et',name:'Ethiopia',currency:'ETB',dialCode:'251',localLength:9,prefixes:['9','7'],utcOffsetMin:180,isDefault:true,languages:['en','am'],defaultLang:'en',usesBareLocal:true};
const ACCOUNT={phone:'0912345678',walletBalance:12850,totalDeposited:20000,totalEarned:3100,totalWithdrawn:2000,totalInvested:12000,checkinStreak:3,lastCheckinAt:null,referralCode:'ET7Q4X',publicId:'00042',registrationDone:true,spins:2,team:{l1:2,l2:1,l3:0,commission:420},region:REGION};
const SETTINGS={minDeposit:300,minWithdraw:200,withdrawFeePct:15,withdrawMultiple:50,commL1:27,commL2:2,commL3:1,annEnabled:false,annTitle:'Welcome',annBody:'Welcome to the app.',depositPayAEnabled:true,openingCountdownEnabled:false,maintenanceMode:false,dailyCheckin:50,turntableEnabled:true,brandName:'Petro',withdrawWindowEnabled:true,withdrawOpenFrom:'06:00',withdrawOpenTo:'17:00',usdtRate:120,cardEnabled:true,usdtEnabled:true};
const PRODUCTS=[{key:'p1',name:'Asset-1',price:3000,cycle:150,expectedReturn:90000,dailyPayout:600,image:'',active:true,spinCount:2,open:true},{key:'p2',name:'Asset-2',price:9000,cycle:150,expectedReturn:270000,dailyPayout:1800,image:'',active:true,comingSoon:true,open:false,openMode:'soon'}];
const INV=[{id:'i1',tierKey:'p1',tierName:'Asset-1',assetKey:'p1',assetName:'Asset-1',amount:3000,expectedReturn:90000,payoutsMade:4,payoutsTotal:150,paidOut:2400,status:'running',createdAt:'2026-09-10T18:13:00Z'},{id:'i2',tierKey:'p2',tierName:'Asset-2',amount:9000,expectedReturn:270000,payoutsMade:150,payoutsTotal:150,paidOut:270000,status:'matured',createdAt:'2026-03-01T09:00:00Z'}];
const TX=[{id:'t1',type:'deposit',amount:5000,status:'completed',description:'Deposit: Paid',date:'12/09/2026',time:'14:02'},{id:'t2',type:'withdraw',amount:-2000,status:'pending',description:'Withdrawal: Processing',date:'13/09/2026',time:'09:41'},{id:'t3',type:'withdraw',amount:-2000,status:'failed',description:'Withdrawal: Rejected',date:'13/09/2026',time:'10:02'},{id:'t4',type:'turntable',amount:70,status:'completed',description:'Turntable win',date:'14/09/2026',time:'07:15'},{id:'t5',type:'welcome_bonus',amount:700,status:'completed',description:'Welcome Bonus',date:'01/09/2026',time:'08:00'},{id:'t6',type:'commission',amount:810,status:'completed',description:'Level 1 Commission',date:'02/09/2026',time:'11:20'},{id:'t7',type:'cashback',amount:600,status:'completed',description:'Daily cashback',date:'14/09/2026',time:'00:05'},{id:'t8',type:'invest',amount:-3000,status:'completed',description:'Bought Asset-1',date:'10/09/2026',time:'18:13'}];
const MSG=[{id:'m1',title:'Welcome',body:'Thanks for joining.',createdAt:'2026-09-01T08:00:00Z',read:false}];
const WALLET=[{id:'w1',provider:'CBE Birr',accountNumber:'0912345678',accountName:'Abebe K',isDefault:true}];
const ROUTES={'/public/settings':{status:'success',region:REGION,settings:SETTINGS},'/public/products':{status:'success',products:PRODUCTS},'/public/activity-feed':{status:'success',feed:[{kind:'deposit',phone:'251****4417',amount:3000},{kind:'withdraw',phone:'251****9022',amount:2500}]},
'/account':{status:'success',account:ACCOUNT,region:REGION},'/investments':{status:'success',investments:INV},'/transactions':{status:'success',transactions:TX,truncated:false},'/messages':{status:'success',messages:MSG},'/bank/list':{status:'success',accounts:WALLET},'/bank/supported-banks':{status:'success',banks:['CBE Birr','Telebirr']},
'/team/members':{status:'success',members:[{phone:'0911223344',invested:9000,createdAt:'2026-09-01T10:00:00Z'}]},'/team/stats':{status:'success',referralCode:'ET7Q4X',commRates:{l1:27,l2:2,l3:1},team:{l1:2,l2:1,l3:0},totalTeam:3,teamCommission:420,teamDeposits:12000,milestones:[{key:'m1',type:'count',target:3,reward:50,claimed:false},{key:'m2',type:'deposit',target:5000,reward:100,claimed:false}]}};
ROUTES['/public/pay-channels']={status:'success',channels:[{id:'c1',name:'Commercial Bank of Ethiopia',kind:'bank',logo:''},{id:'c2',name:'Telebirr Wallet',kind:'wallet',logo:''}]};
ROUTES['/deposit/manual/order']={status:'success',depositId:'d1',reference:'M1',amount:550,expiresAt:Date.now()+(29*60+47)*1000,channel:{id:'c1',name:'Commercial Bank of Ethiopia',kind:'bank',logo:''},accountName:'Ashenafi',accountNumber:'1000809418239'};
const FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];";
const fbAuth=u=>"const user="+(u?"{uid:'u1',email:'912345678@petro-platform.com',getIdToken:async()=>'tok',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})}":"null")+";export const getAuth=()=>({currentUser:user});export const createUserWithEmailAndPassword=async()=>({user});export const signInWithEmailAndPassword=async()=>({user});export const signOut=async()=>{};export const updatePassword=async()=>{};export const reauthenticateWithCredential=async()=>{};export const EmailAuthProvider={credential:()=>({})};export const setPersistence=async()=>{};export const browserSessionPersistence={};export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};";
const SWEEP=`()=>{const out=[],seen=new Set();
const vis=el=>{for(let n=el;n&&n.nodeType===1;n=n.parentElement){const st=getComputedStyle(n);if(st.display==='none'||st.visibility==='hidden'||st.opacity==='0')return false;}const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
const push=(t,el,k)=>{t=String(t||'').replace(/\\s+/g,' ').trim();if(!t)return;const key=k+t;if(seen.has(key))return;seen.add(key);out.push({t,k});};
const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement;if(!p)continue;if(['SCRIPT','STYLE','TEXTAREA'].includes(p.tagName))continue;if(p.closest('[data-no-i18n]'))continue;if(!vis(p))continue;push(n.nodeValue,p,'text');}
for(const el of document.querySelectorAll('[placeholder],[aria-label],[title]')){if(el.closest('[data-no-i18n]'))continue;if(!vis(el))continue;for(const a of ['placeholder','aria-label','title'])if(el.hasAttribute(a))push(el.getAttribute(a),el,a);}
return out;}`;
const STEPS=[
['home',"showPage('home')"],['assets',"showPage('assets')"],['assets-tab2',"showPage('assets');await new Promise(r=>setTimeout(r,400));switchAssetsTab('invested')"],['network',"showPage('network')"],['account',"showPage('account')"],
['deposit',"openDepositSheet()"],['deposit-card',"openDepositSheet();await new Promise(r=>setTimeout(r,400));selectDepMethod('card')"],['deposit-usdt',"openDepositSheet();await new Promise(r=>setTimeout(r,400));selectDepMethod('usdt')"],
['withdraw',"openWithdrawSheet()"],['wallet',"openWalletSheet()"],['wallet-edit',"openWalletSheet();await new Promise(r=>setTimeout(r,400));toggleWalletEdit(true)"],['balance-record',"openBalanceRecordSheet()"],
['messages',"openMessagesSheet()"],['msg-detail',"openMessagesSheet();await new Promise(r=>setTimeout(r,500));const row=document.querySelector('.msg-row,.msg-item');if(row)row.click();"],
['login-pw',"openChangeLoginPasswordSheet()"],['trade-pw',"openChangeTradePasswordSheet()"],['about',"openAboutSheet()"],['help',"openHelpSheet()"],['rules',"openRulesSheet()"],['support',"openSupportSheet()"],['security',"openSecuritySettingsSheet()"],
['chest',"openChestSheet()"],['checkin',"openCheckinSheet()"],['task-center',"openTaskCenter()"],['all-referrals',"openAllReferralsSheet()"],['statement',"openTransactionStatement()"],
['act-deposit',"openDepositSheet();await new Promise(r=>setTimeout(r,500));await submitDeposit();"],
['act-deposit-card',"openDepositSheet();await new Promise(r=>setTimeout(r,500));selectDepMethod('card');await new Promise(r=>setTimeout(r,300));await doCardDeposit();"],
['act-usdt-intent',"openDepositSheet();await new Promise(r=>setTimeout(r,500));selectDepMethod('usdt');await new Promise(r=>setTimeout(r,300));await doUsdtIntent();"],
['act-usdt-submit',"openDepositSheet();await new Promise(r=>setTimeout(r,500));selectDepMethod('usdt');await new Promise(r=>setTimeout(r,300));await doUsdtDeposit();"],
['act-withdraw',"openWithdrawSheet();await new Promise(r=>setTimeout(r,500));await submitWithdraw();"],
['act-wallet',"openWalletSheet();await new Promise(r=>setTimeout(r,400));toggleWalletEdit(true);await new Promise(r=>setTimeout(r,300));await submitWallet();"],
['act-loginpw',"openChangeLoginPasswordSheet();await new Promise(r=>setTimeout(r,400));await submitLoginPasswordChange();"],
['act-tradepw',"openChangeTradePasswordSheet();await new Promise(r=>setTimeout(r,400));await submitTradePasswordChange();"],
['act-checkin',"openCheckinSheet();await new Promise(r=>setTimeout(r,500));await submitCheckin();"],
['act-chest',"openChestSheet();await new Promise(r=>setTimeout(r,500));await submitChestKey();"],
['act-statement-tab',"openTransactionStatement();await new Promise(r=>setTimeout(r,500));switchStatementCategory('withdraw')"],
['act-balance-tabs',"openBalanceRecordSheet('deposit')"],
['act-hide',"toggleEarningsVisibility()"],
['act-provider',"openWalletSheet();await new Promise(r=>setTimeout(r,400));toggleWalletEdit(true);await new Promise(r=>setTimeout(r,300));toggleProviderList()"],
['act-withdraw-picker',"openWithdrawSheet();await new Promise(r=>setTimeout(r,500));toggleWitWalletPicker()"],
['manual-deposit-form',"STATE.settings.manualPay=true;openDepositSheet()"],
['manual-choose',"STATE.settings.manualPay=true;openManualPayFlow(550);await new Promise(r=>setTimeout(r,900))"],
['manual-pay',"STATE.settings.manualPay=true;openManualPayFlow(550);await new Promise(r=>setTimeout(r,900));await mpPick(0);await new Promise(r=>setTimeout(r,500))"],
['manual-pay-wallet',"STATE.settings.manualPay=true;openManualPayFlow(550);await new Promise(r=>setTimeout(r,900));await mpPick(1);await new Promise(r=>setTimeout(r,500))"],
['manual-toast-empty',"STATE.settings.manualPay=true;openManualPayFlow(550);await new Promise(r=>setTimeout(r,900));await mpPick(0);await new Promise(r=>setTimeout(r,500));await mpSubmit();"],
['manual-toast-copy',"STATE.settings.manualPay=true;openManualPayFlow(550);await new Promise(r=>setTimeout(r,900));await mpPick(0);await new Promise(r=>setTimeout(r,500));await mpCopy('name');"],
['lang',"openLangPicker()"],['invest-confirm',"openInvestConfirm('p1')"],['notify',"notify('Network error. Try again.')"],['confirm',"openSimpleConfirm('Confirm','Enter a valid amount.',()=>{})"],
['deposit-status',"openDepositStatusModal(500,'0912345678','')"],['info',"openInfoSheet('about')"],
];
const found=new Map(), errs=[];
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end();}r.setHeader('content-type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream');r.end(d);});}).listen(8863,async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 async function mk(signed){const page=await ctx.newPage();page.on('pageerror',e=>errs.push((signed?'in ':'out ')+String(e).slice(0,160)+' @'+(page.__step||'')));
  await page.route(API+'/**',r=>{const u=new URL(r.request().url());const k=Object.keys(ROUTES).find(k=>u.pathname.endsWith(k));r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(k?ROUTES[k]:{status:'success'})});});
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await page.route(/firebase-app\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:FB_APP}));
  await page.route(/firebase-auth\.js/,r=>r.fulfill({status:200,contentType:'text/javascript',body:fbAuth(signed)}));
  await page.addInitScript(`try{localStorage.setItem('petro_lang','${LANGC}')}catch(e){}`);
  await page.goto('http://127.0.0.1:8863/index.html',{waitUntil:'commit'});await page.waitForTimeout(signed?4500:3500);return page;}
 async function collect(page,label){let rows=[];try{rows=await page.evaluate("("+SWEEP+")()");}catch(e){errs.push(label+': '+e.message.slice(0,120));return;}for(const r of rows){const k=r.k+'|'+r.t;if(!found.has(k))found.set(k,new Set());found.get(k).add(label);}}
 let p=await mk(false);await collect(p,'login');await p.evaluate(()=>showAuthTab('register'));await p.waitForTimeout(600);await collect(p,'register');await p.evaluate(()=>showAuthTab('forgot'));await p.waitForTimeout(600);await collect(p,'forgot');await p.evaluate(()=>showAuthTab('login'));await p.waitForTimeout(300);await p.evaluate(()=>doLogin());await p.waitForTimeout(800);await collect(p,'login-empty');await p.evaluate(()=>showAuthTab('register'));await p.waitForTimeout(300);await p.evaluate(()=>doRegSendOtp());await p.waitForTimeout(800);await collect(p,'reg-send-empty');await p.evaluate(()=>doRegister());await p.waitForTimeout(800);await collect(p,'reg-empty');await p.evaluate(()=>showAuthTab('forgot'));await p.waitForTimeout(300);await p.evaluate(()=>doForgotSendOtp());await p.waitForTimeout(800);await collect(p,'forgot-send-empty');await p.evaluate(()=>doForgotSubmit());await p.waitForTimeout(800);await collect(p,'forgot-empty');await p.close();
 p=await mk(true);try{await p.evaluate(()=>closeAnnouncement())}catch(e){}
 await collect(p,'home0');
 for(const [l,js] of STEPS){p.__step=l;try{await p.evaluate(`(async()=>{${js}})()`);await p.waitForTimeout(650);await collect(p,l);if(process.env.DBG)console.log(l,await p.evaluate(()=>STATE.page+' | '+document.body.innerText.replace(/\s+/g,' ').slice(0,100)));await p.evaluate(()=>{try{mpClose()}catch(e){}try{closeSheet()}catch(e){}try{closeAnnouncement()}catch(e){}try{closeLangPicker()}catch(e){}try{closeNotify()}catch(e){}try{closeDepositStatusModal()}catch(e){}});await p.waitForTimeout(150);}catch(e){errs.push(l+': '+String(e).slice(0,120));}}
 await b.close();srv.close();

 const ALLOWED=/PETRO|Petro|Money|Birr|X{3,}|MarzPay|USDT|TRC20|TXID|MTN|Airtel|Telebirr|CBE|Mobile Money|Asset-\d|https?:\/\/\S+|Welcome to the app\.|Thanks for joining\.|Welcome\b|ETB|\bBr\b|PIN|SMS|APP|OTP|Tron|ID/g;
 const bad=[];for(const [k,sc] of found){const t=k.split('|').slice(1).join('|');const left=t.replace(ALLOWED,' ').replace(/[^A-Za-z\s]/g,' ');if(/[A-Za-z]{3,}/.test(left))bad.push(t+'   <'+[...sc].slice(0,2).join(',')+'>');}
 if(errs.length){console.log('PAGE ERRORS',errs);process.exitCode=1;}
 if(bad.length){console.log('ENGLISH STILL VISIBLE IN AMHARIC ('+bad.length+'):');bad.forEach(x=>console.log('  '+x));process.exitCode=1;}
 else console.log('PASS: Amharic leaves no English word on '+found.size+' visible texts across the sign-in screens, every page and sheet');
});
