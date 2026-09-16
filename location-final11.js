import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const shareId = new URLSearchParams(location.search).get('id') || '';
let watchId = null;
let busy = false;
let hasFix = false;
let retryTimer = null;
let authReady = null;
let retryCount = 0;
let bestAccuracy = Infinity;
let bestPosition = null;
let refineTimer = null;
const QUICK_ACCEPT_METERS = 150; // send a nearby fix immediately, then keep refining

const i18n = {
  he:{dir:'rtl',quick:'שלח מיקום עכשיו',title:'שיתוף מיקום עם צוות האמבולנס',sub:'המערכת מנסה לאתר ולשתף את המיקום שלך באופן אוטומטי כדי לחסוך זמן במקרה חירום.',name:'שם',phone:'מספר טלפון',btn:'📍 נסה שוב לשתף מיקום',idle:'🔴 לא ניתן לאתר את המיקום. לחץ שוב וודא ש-GPS פעיל',finding:'🟡 מאתר את המיקום שלך...',ok:'🟢 המיקום שותף בהצלחה וממשיך להתעדכן',accuracy:'דיוק משוער: {m} מטר',refining:'🟡 נמצא מיקום. משפר דיוק GPS...',denied:'גישה למיקום נחסמה. יש לאפשר Location לאתר בהגדרות הדפדפן ולנסות שוב.',unavailable:'לא הצלחנו לקבל מיקום. הפעל GPS/Location ונסה שוב.',timeout:'איתור המיקום לקח יותר מדי זמן. נסה שוב במקום פתוח.',invalid:'הקישור אינו תקין או שפג תוקפו.',secure:'המיקום משמש רק לצורך איתור הפנייה ומתן השירות.',back:'חזרה לאתר'},
  ar:{dir:'rtl',quick:'إرسال موقعي الآن',title:'مشاركة الموقع مع طاقم الإسعاف',sub:'يحاول النظام تحديد موقعك ومشاركته تلقائيًا لتوفير الوقت في حالات الطوارئ.',name:'الاسم',phone:'رقم الهاتف',btn:'📍 إعادة محاولة مشاركة الموقع',idle:'🔴 تعذر تحديد الموقع. اضغط مرة أخرى وتأكد أن GPS يعمل',finding:'🟡 جارٍ تحديد موقعك...',ok:'🟢 تم إرسال الموقع ويستمر تحديثه',accuracy:'دقة الموقع التقريبية: {m} متر',refining:'🟡 تم العثور على الموقع. جارٍ تحسين دقة GPS...',denied:'تم رفض إذن الموقع. اسمح للموقع من إعدادات المتصفح ثم حاول مجددًا.',unavailable:'تعذر الحصول على الموقع. فعّل GPS/Location وحاول مجددًا.',timeout:'استغرق تحديد الموقع وقتًا طويلًا. حاول مرة أخرى في مكان مفتوح.',invalid:'الرابط غير صالح أو منتهي.',secure:'يستخدم الموقع فقط للوصول إليك وتقديم الخدمة.',back:'العودة للموقع'},
  en:{dir:'ltr',quick:'Send my location now',title:'Share location with the ambulance team',sub:'The system automatically tries to locate and share your position to save time in an emergency.',name:'Name',phone:'Phone number',btn:'📍 Try location sharing again',idle:'🔴 Location unavailable. Tap again and make sure GPS is on',finding:'🟡 Finding your location...',ok:'🟢 Location shared successfully and updating',accuracy:'Estimated accuracy: {m} m',refining:'🟡 Location found. Improving GPS accuracy...',denied:'Location permission was denied. Allow Location for this site in browser settings and try again.',unavailable:'Could not get your location. Turn on GPS/Location and try again.',timeout:'Location request timed out. Try again in an open area.',invalid:'This link is invalid or expired.',secure:'Your location is used only to reach you and provide the service.',back:'Back to website'}
};
let lang='he';
function t(k){return i18n[lang][k]||k}
function setLang(v){lang=v; document.documentElement.lang=v; document.documentElement.dir=i18n[v].dir; document.body.dir=i18n[v].dir; ['quick','title','sub','name','phone','btn','secure','back'].forEach(k=>{const el=$('t-'+k); if(el) el.textContent=t(k)}); document.querySelectorAll('[data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===v));}
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.dataset.lang)));
function status(){ /* FINAL10: no visible status banners */ }
function geoError(err){
  console.warn('Geolocation error', err);
  busy=false; $('shareBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false;
  if(err?.code===1){
    // Permission denied: keep the page clean; do not show the red warning box.
    status('','');
    return;
  }
  // Do not fail immediately on mobile: try a cached/network fix, then a fresh fix.
  if(!hasFix && retryCount < 2){
    retryCount++;
    status(t('finding'),'finding');
    clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>requestPosition(true),150);
    return;
  }
  status(err?.code===3?t('timeout'):t('unavailable'),'error');
}
async function savePosition(pos){
  if (authReady) await authReady;
  if (!auth.currentUser) await signInAnonymously(auth);
  const c = pos.coords;
  const acc = Math.max(0, Math.round(c.accuracy || 0));
  // After the first usable fix is sent, keep only meaningful improvements.
  if (hasFix && Number.isFinite(bestAccuracy) && acc >= bestAccuracy) return;
  bestAccuracy = Math.min(bestAccuracy, acc || Infinity);
  bestPosition = pos;
  await updateDoc(doc(db, 'locationShares', shareId), {
    status: 'active', sharing: true, latitude: c.latitude, longitude: c.longitude,
    accuracy: acc, lastUpdate: serverTimestamp(), userAgent: navigator.userAgent,
    updatedAtClient: Date.now()
  });
  hasFix = true;
  const a=t('accuracy').replace('{m}', String(acc));
  status(t('ok') + ' — ' + a, 'success');
  busy=false; $('shareBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false;
}
function requestPosition(highAccuracy=true){
  if(!navigator.geolocation) return geoError({code:2});
  // Get a quick nearby fix first. It is sent immediately, then GPS keeps refining it.
  navigator.geolocation.getCurrentPosition(async p=>{
    try { await savePosition(p); }
    catch(e){ console.error('LOCATION SAVE ERROR:',e); status(e?.code==='permission-denied'?'Firebase: permission denied. Publish the included firestore.rules.':t('unavailable'),'error'); busy=false; $('shareBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false; if($('quickLocationBtn')) $('quickLocationBtn').disabled=false; return; }
    if(watchId!==null) navigator.geolocation.clearWatch(watchId);
    status(t('refining') + ' — ' + t('accuracy').replace('{m}',String(Math.round(p.coords.accuracy||0))),'finding');
    watchId=navigator.geolocation.watchPosition(
      p=>savePosition(p).catch(console.error),
      e=>{ if(e?.code===1) geoError(e); },
      {enableHighAccuracy:true, maximumAge:0, timeout:120000}
    );
    // Keep refining; watchPosition remains active after this timer.
    clearTimeout(refineTimer);
    refineTimer=setTimeout(()=>{ if(hasFix && bestPosition) savePosition(bestPosition).catch(console.error); },20000);
  }, geoError, {enableHighAccuracy:highAccuracy, maximumAge:highAccuracy?0:120000, timeout:highAccuracy?12000:5000});
}
async function startLocation(){
  if(busy) return;
  if(!shareId){status(t('invalid'),'error'); return;}
  if(!window.isSecureContext){status('יש לפתוח את הקישור דרך HTTPS כדי לאפשר GPS.','error'); return;}
  if(!navigator.geolocation){status(t('unavailable'),'error'); return;}
  busy=true; retryCount=0; $('shareBtn').disabled=true; if($('quickLocationBtn')) $('quickLocationBtn').disabled=true; status(t('finding'),'finding');

  // IMPORTANT FOR iPHONE / SAMSUNG:
  // Start the browser permission/GPS request synchronously from the tap.
  // Never await Firebase/network work before navigator.geolocation.
  if(!auth.currentUser && !authReady){
    authReady=signInAnonymously(auth).catch(e=>{ console.error(e); return null; });
  }
  requestPosition(false);
}

$('shareBtn').addEventListener('click',startLocation);
$('quickLocationBtn')?.addEventListener('click', startLocation);
window.addEventListener('pagehide',()=>{clearTimeout(retryTimer); clearTimeout(refineTimer); if(watchId!==null) navigator.geolocation.clearWatch(watchId)});
(async()=>{
  setLang('he');
  if(!shareId){status(t('invalid'),'error'); $('shareBtn').disabled=true; return;}
  try{
    const snap=await getDoc(doc(db,'locationShares',shareId));
    if(!snap.exists()){status(t('invalid'),'error'); $('shareBtn').disabled=true; return;}
    const d=snap.data(); $('personName').value=d.name||''; $('personPhone').value=d.phone||'';
    status(t('idle'),'');
  }catch(e){console.error(e); status(t('invalid'),'error');}
})();

// FINAL11: in-page iPhone / Samsung permission guide
const guideText = {
  he:{help:'בעיה בהרשאת מיקום?',title:'הפעלת מיקום',intro:'בחר את סוג הטלפון שלך',retry:'📍 נסה שוב לשלוח מיקום',iphone1:'1. פתח הגדרות האתר',iphone1p:'ב-Safari לחץ על aA ליד כתובת האתר ובחר Website Settings.',iphone2:'2. אפשר Location',iphone2p:'בחר Allow כדי לאפשר לאתר להשתמש במיקום.',sam1:'1. פתח הרשאות האתר',sam1p:'ב-Chrome לחץ על הסמל ליד כתובת האתר ואז Permissions.',sam2:'2. אפשר מיקום',sam2p:'בחר Allow while using the site והפעל Location/GPS בטלפון.'},
  ar:{help:'مشكلة في إذن الموقع؟',title:'تفعيل الموقع',intro:'اختر نوع هاتفك',retry:'📍 جرّب إرسال الموقع مرة أخرى',iphone1:'1. افتح إعدادات الموقع',iphone1p:'في Safari اضغط aA بجانب عنوان الموقع ثم Website Settings.',iphone2:'2. اسمح بالموقع',iphone2p:'اختر Allow للسماح للموقع باستخدام موقع الهاتف.',sam1:'1. افتح أذونات الموقع',sam1p:'في Chrome اضغط الرمز بجانب عنوان الموقع ثم Permissions.',sam2:'2. اسمح بالموقع',sam2p:'اختر Allow while using the site وتأكد أن Location/GPS مفعّل.'},
  en:{help:'Location permission problem?',title:'Enable location',intro:'Choose your phone type',retry:'📍 Try sending location again',iphone1:'1. Open website settings',iphone1p:'In Safari, tap aA beside the address and choose Website Settings.',iphone2:'2. Allow Location',iphone2p:'Choose Allow so the website can use your phone location.',sam1:'1. Open site permissions',sam1p:'In Chrome, tap the icon beside the address, then Permissions.',sam2:'2. Allow location',sam2p:'Choose Allow while using the site and make sure Location/GPS is on.'}
};
function updateGuideLanguage(){const g=guideText[lang]; $('t-help').textContent=g.help;$('helpTitle').textContent=g.title;$('helpIntro').textContent=g.intro;$('retryFromHelp').textContent=g.retry;const s=document.querySelectorAll('.step-title'),p=document.querySelectorAll('.step-text');[g.iphone1,g.iphone2,g.sam1,g.sam2].forEach((x,i)=>s[i].textContent=x);[g.iphone1p,g.iphone2p,g.sam1p,g.sam2p].forEach((x,i)=>p[i].textContent=x)}
const oldSetLang=setLang; setLang=function(v){oldSetLang(v);updateGuideLanguage()}; updateGuideLanguage();
$('locationHelpBtn')?.addEventListener('click',()=>{$('helpModal').hidden=false});
$('closeHelp')?.addEventListener('click',()=>{$('helpModal').hidden=true});
$('helpModal')?.addEventListener('click',e=>{if(e.target===$('helpModal'))$('helpModal').hidden=true});
document.querySelectorAll('.device-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.device-btn').forEach(b=>b.classList.toggle('active',b===btn));$('guideIphone').hidden=btn.dataset.device!=='iphone';$('guideSamsung').hidden=btn.dataset.device!=='samsung'}));
$('retryFromHelp')?.addEventListener('click',()=>{$('helpModal').hidden=true;startLocation()});
