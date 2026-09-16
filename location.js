import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const shareId = new URLSearchParams(location.search).get('id') || '';
let watchId = null, busy = false, authPromise = null;

const i18n = {
 he:{dir:'rtl',title:'שיתוף מיקום עם צוות האמבולנס',sub:'לחץ על הכפתור הירוק כדי לשתף את המיקום שלך עם צוות האמבולנס.',name:'שם',phone:'מספר טלפון',btn:'📍 שתף את המיקום שלי עכשיו',finding:'🟡 מאתר את המיקום שלך...',ok:'🟢 המיקום נשלח וממשיך להתעדכן',denied:'🔴 הרשאת המיקום חסומה. יש לאפשר Location לאתר בדפדפן וללחוץ שוב.',unavailable:'🔴 לא ניתן לקבל מיקום. ודא ש-GPS פעיל ונסה שוב.',timeout:'🔴 איתור המיקום ארך זמן רב מדי. נסה שוב.',invalid:'הקישור אינו תקין או שפג תוקפו.',secure:'המיקום משמש רק לצורך איתור הפנייה ומתן השירות.',back:'חזרה לאתר'},
 ar:{dir:'rtl',title:'شارك موقعك مع فريق الإسعاف',sub:'اضغط الزر الأخضر لمشاركة موقعك مباشرة مع فريق الإسعاف.',name:'الاسم',phone:'رقم الهاتف',btn:'📍 مشاركة موقعي الآن',finding:'🟡 جارٍ تحديد موقعك...',ok:'🟢 تم إرسال الموقع ويستمر تحديثه',denied:'🔴 إذن الموقع محظور. اسمح للموقع باستخدام Location من المتصفح ثم اضغط مرة أخرى.',unavailable:'🔴 تعذر الحصول على الموقع. تأكد من تشغيل GPS وحاول مجددًا.',timeout:'🔴 استغرق تحديد الموقع وقتًا طويلًا. حاول مجددًا.',invalid:'الرابط غير صالح أو منتهي.',secure:'يستخدم الموقع فقط للوصول إليك وتقديم الخدمة.',back:'العودة إلى الموقع'},
 en:{dir:'ltr',title:'Share your location with the ambulance team',sub:'Tap the green button to share your location directly with the ambulance team.',name:'Name',phone:'Phone number',btn:'📍 Share my location now',finding:'🟡 Finding your location...',ok:'🟢 Location sent and continues updating',denied:'🔴 Location permission is blocked. Allow Location for this site, then tap again.',unavailable:'🔴 Could not get your location. Make sure GPS is enabled and try again.',timeout:'🔴 Location timed out. Please try again.',invalid:'This link is invalid or expired.',secure:'Your location is used only to reach you and provide the service.',back:'Back to website'}
};
let lang='he';
const t=k=>i18n[lang][k]||k;
function setLang(v){lang=v;document.documentElement.lang=v;document.documentElement.dir=i18n[v].dir;document.body.dir=i18n[v].dir;['title','sub','name','phone','btn','secure','back'].forEach(k=>{const el=$('t-'+k);if(el)el.textContent=t(k)});document.querySelectorAll('[data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===v));}
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.dataset.lang)));
function status(msg,cls=''){ $('status').textContent=msg; $('status').className='status '+cls; }
async function ensureAuth(){ if(auth.currentUser) return auth.currentUser; if(!authPromise) authPromise=signInAnonymously(auth); return authPromise; }
async function savePosition(pos, first=false){
  await ensureAuth();
  const c=pos.coords;
  await updateDoc(doc(db,'locationShares',shareId),{
    latitude:c.latitude, longitude:c.longitude, accuracy:Math.round(c.accuracy||0),
    status:'active', sharing:true, lastUpdate:serverTimestamp(), updatedAtClient:new Date()
  });
  status(t('ok'),'success');
  if(first){busy=false;$('shareBtn').disabled=false;}
}
function geoError(err){
  console.warn('Geolocation error',err); busy=false; $('shareBtn').disabled=false;
  if(err?.code===1) status(t('denied'),'error');
  else if(err?.code===3) status(t('timeout'),'error');
  else status(t('unavailable'),'error');
}
function startLocation(){
  if(busy) return;
  if(!shareId){status(t('invalid'),'error');return;}
  if(!window.isSecureContext){status('🔴 HTTPS is required for location access.','error');return;}
  if(!navigator.geolocation){status(t('unavailable'),'error');return;}
  busy=true;$('shareBtn').disabled=true;status(t('finding'),'finding');
  // Start geolocation immediately inside the user's tap. This is important on iPhone/Samsung.
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{
      await savePosition(pos,true);
      if(watchId!==null) navigator.geolocation.clearWatch(watchId);
      watchId=navigator.geolocation.watchPosition(
        p=>savePosition(p,false).catch(console.error),
        e=>{if(e?.code===1) geoError(e)},
        {enableHighAccuracy:true,maximumAge:10000,timeout:60000}
      );
    }catch(e){console.error(e);busy=false;$('shareBtn').disabled=false;status(t('unavailable'),'error');}
  },geoError,{enableHighAccuracy:true,maximumAge:15000,timeout:30000});
  // Anonymous sign-in runs in parallel; it never delays the browser permission prompt.
  ensureAuth().catch(console.error);
}
$('shareBtn').addEventListener('click',startLocation);
window.addEventListener('pagehide',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId)});
(async()=>{
  setLang('he');
  if(!shareId){status(t('invalid'),'error');$('shareBtn').disabled=true;return;}
  try{
    const snap=await getDoc(doc(db,'locationShares',shareId));
    if(!snap.exists()){status(t('invalid'),'error');$('shareBtn').disabled=true;return;}
    const d=snap.data();$('personName').value=d.name||'';$('personPhone').value=d.phone||'';
  }catch(e){console.error(e);status(t('invalid'),'error');$('shareBtn').disabled=true;}
})();
