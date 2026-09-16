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

const i18n = {
  he:{dir:'rtl',title:'שיתוף מיקום עם צוות האמבולנס',sub:'המערכת מנסה לאתר ולשתף את המיקום שלך באופן אוטומטי כדי לחסוך זמן במקרה חירום.',name:'שם',phone:'מספר טלפון',btn:'📍 נסה שוב לשתף מיקום',idle:'🔴 לא ניתן לאתר את המיקום. לחץ שוב וודא ש-GPS פעיל',finding:'🟡 מאתר את המיקום שלך...',ok:'🟢 המיקום שותף בהצלחה וממשיך להתעדכן',denied:'גישה למיקום נחסמה. יש לאפשר Location לאתר בהגדרות הדפדפן ולנסות שוב.',unavailable:'לא הצלחנו לקבל מיקום. הפעל GPS/Location ונסה שוב.',timeout:'איתור המיקום לקח יותר מדי זמן. נסה שוב במקום פתוח.',invalid:'הקישור אינו תקין או שפג תוקפו.',secure:'המיקום משמש רק לצורך איתור הפנייה ומתן השירות.',back:'חזרה לאתר'},
  ar:{dir:'rtl',title:'مشاركة الموقع مع طاقم الإسعاف',sub:'يحاول النظام تحديد موقعك ومشاركته تلقائيًا لتوفير الوقت في حالات الطوارئ.',name:'الاسم',phone:'رقم الهاتف',btn:'📍 إعادة محاولة مشاركة الموقع',idle:'🔴 تعذر تحديد الموقع. اضغط مرة أخرى وتأكد أن GPS يعمل',finding:'🟡 جارٍ تحديد موقعك...',ok:'🟢 تم إرسال الموقع ويستمر تحديثه',denied:'تم رفض إذن الموقع. اسمح للموقع من إعدادات المتصفح ثم حاول مجددًا.',unavailable:'تعذر الحصول على الموقع. فعّل GPS/Location وحاول مجددًا.',timeout:'استغرق تحديد الموقع وقتًا طويلًا. حاول مرة أخرى في مكان مفتوح.',invalid:'الرابط غير صالح أو منتهي.',secure:'يستخدم الموقع فقط للوصول إليك وتقديم الخدمة.',back:'العودة للموقع'},
  en:{dir:'ltr',title:'Share location with the ambulance team',sub:'The system automatically tries to locate and share your position to save time in an emergency.',name:'Name',phone:'Phone number',btn:'📍 Try location sharing again',idle:'🔴 Location unavailable. Tap again and make sure GPS is on',finding:'🟡 Finding your location...',ok:'🟢 Location shared successfully and updating',denied:'Location permission was denied. Allow Location for this site in browser settings and try again.',unavailable:'Could not get your location. Turn on GPS/Location and try again.',timeout:'Location request timed out. Try again in an open area.',invalid:'This link is invalid or expired.',secure:'Your location is used only to reach you and provide the service.',back:'Back to website'}
};
let lang='he';
function t(k){return i18n[lang][k]||k}
function setLang(v){lang=v; document.documentElement.lang=v; document.documentElement.dir=i18n[v].dir; document.body.dir=i18n[v].dir; ['title','sub','name','phone','btn','secure','back'].forEach(k=>{const el=$('t-'+k); if(el) el.textContent=t(k)}); document.querySelectorAll('[data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===v));}
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.dataset.lang)));
function status(msg,cls=''){ $('status').textContent=msg; $('status').className='status '+cls; }
function geoError(err){
  console.warn('Geolocation error', err);
  busy=false; $('shareBtn').disabled=false;
  if(err?.code===1){
    status(t('denied'),'error');
    return;
  }
  // Do not fail immediately on mobile: try a cached/network fix, then a fresh fix.
  if(!hasFix && retryCount < 2){
    retryCount++;
    status(t('finding'),'finding');
    clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>requestPosition(false),700);
    return;
  }
  status(err?.code===3?t('timeout'):t('unavailable'),'error');
}
async function savePosition(pos){
  // Geolocation must be requested immediately from the user's tap on iOS.
  // Authentication can finish in parallel; wait for it only when saving.
  try { if (authReady) await authReady; else if (!auth.currentUser) await signInAnonymously(auth); }
  catch(e){ console.error('Anonymous auth failed', e); }
  const c=pos.coords;
  await updateDoc(doc(db,'locationShares',shareId),{
    status:'live', sharing:true, latitude:c.latitude, longitude:c.longitude,
    accuracy:Math.round(c.accuracy||0), altitude:c.altitude??null, heading:c.heading??null, speed:c.speed??null,
    updatedAt:serverTimestamp(), lastSeenAt:serverTimestamp()
  });
  hasFix=true; status(t('ok'),'success'); busy=false; $('shareBtn').disabled=false;
}
function requestPosition(highAccuracy=true){
  if(!navigator.geolocation) return geoError({code:2});
  navigator.geolocation.getCurrentPosition(async p=>{
    try { await savePosition(p); }
    catch(e){ console.error(e); status(t('unavailable'),'error'); busy=false; $('shareBtn').disabled=false; return; }

    if(watchId!==null) navigator.geolocation.clearWatch(watchId);
    // Keep updating while the emergency page is open. maximumAge allows iOS and
    // Samsung browsers to return a recent fix immediately while GPS refines it.
    watchId=navigator.geolocation.watchPosition(
      p=>savePosition(p).catch(console.error),
      e=>{ if(e?.code===1) geoError(e); },
      {enableHighAccuracy:true, maximumAge:10000, timeout:60000}
    );
  }, geoError, {
    enableHighAccuracy:highAccuracy,
    maximumAge: highAccuracy ? 15000 : 60000,
    timeout: highAccuracy ? 30000 : 60000
  });
}
async function startLocation(){
  if(busy) return;
  if(!shareId){status(t('invalid'),'error'); return;}
  if(!window.isSecureContext){status('יש לפתוח את הקישור דרך HTTPS כדי לאפשר GPS.','error'); return;}
  if(!navigator.geolocation){status(t('unavailable'),'error'); return;}
  busy=true; retryCount=0; $('shareBtn').disabled=true; status(t('finding'),'finding');

  // IMPORTANT FOR iPHONE / SAMSUNG:
  // Start the browser permission/GPS request synchronously from the tap.
  // Never await Firebase/network work before navigator.geolocation.
  if(!auth.currentUser && !authReady){
    authReady=signInAnonymously(auth).catch(e=>{ console.error(e); return null; });
  }
  requestPosition(false);
}

$('shareBtn').addEventListener('click',startLocation);
window.addEventListener('pagehide',()=>{clearTimeout(retryTimer); if(watchId!==null) navigator.geolocation.clearWatch(watchId)});
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && !hasFix && !busy) setTimeout(startLocation,250); });
window.addEventListener('pageshow',()=>{ if(!hasFix && !busy) setTimeout(startLocation,250); });
(async()=>{
  setLang('he');
  if(!shareId){status(t('invalid'),'error'); $('shareBtn').disabled=true; return;}
  try{
    const snap=await getDoc(doc(db,'locationShares',shareId));
    if(!snap.exists()){status(t('invalid'),'error'); $('shareBtn').disabled=true; return;}
    const d=snap.data(); $('personName').value=d.name||''; $('personPhone').value=d.phone||'';
    status(t('finding'),'finding');
    // Emergency flow: request/start location automatically as soon as the page opens.
    // Browsers/OS may still show their mandatory one-time permission prompt; websites cannot bypass it.
    setTimeout(startLocation, 150);
  }catch(e){console.error(e); status(t('invalid'),'error');}
})();
