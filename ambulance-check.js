import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserSessionPersistence).catch(console.error);
const $ = id => document.getElementById(id);

const SECTIONS = [
  { title:'ציוד רפואי', items:[
    ['מספריים – מל״ע',1],['חוסם עורקים',2],['פד גזה',20],['תחבושת אישית',5],['תחבושת בינונית',2],['משולש',10],['מיקרופור',3],['צווארון פילדלפיה (2 מבוגר, 1 ילד)',3],['סטטוסקופ',1],['מד לחץ דם',1],['מד סטורציה',1],['ערכת לידה',1],['ערכת עירוי',3],['קופסת איסוף לחומר חד',1],['טבליות אספירין','5–10'],['גלוקוג׳ל',2],['גלוקומטר כולל דוקרנים וסטיקים',1],['דפיברילטור',1]
  ]},
  { title:'ציוד נשימתי', items:[
    ['אמבו מבוגר',1],['מסכת הנשמה (מבוגר מס׳ 5 + ילד מס׳ 2)',2],['שקיות העשרה',2],['מסנן ויראלי',2],['סקשן קטטר שאיבה מס׳ 18/8',1],['אמבו ילדים',1],['מסכת הנשמה מס׳ 0',1],['צנרת לסקשן',10],['מנתב אוויר 0/00/1/2/3/4','2 כ״א'],['חמצן נייד',1]
  ]},
  { title:'חמצן', items:[
    ['חמצן נייד רזרבה',1],['מיכל חמצן גדול',1],['מסכות חמצן מבוגר',10],['מסכות חמצן ילדים',5]
  ]},
  { title:'ציוד כללי / משקי', items:[
    ['שמיכות',1],['כרית',1],['סדין',10],['מגבת נייר',1],['סבון נוזלי',1],['כליה',1],['בקבוק שתן',1],['סיר שתן',1],['בקבוק מים',1],['כפפות ח.פ',2],['אלונקת גלגלים',2],['כיסא מתקפל',1],['אלונקת שדה',1],['לוח גב + חד וייס + רצועות',1],['מסכות פה ח.פ',1],['משקפי מגן',3],['מטף כיבוי אש',3],['אפוד זוהר',1],['פנס תאור',2],['תאורה פנימית',1],['שקיות פסולת',1],['כלי נהג',2]
  ]}
];

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function showToast(text,type='ok'){const t=$('checkToast');t.textContent=text;t.className=`check-toast show ${type}`;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.className='check-toast',2600);}
function expectedMin(v){const n=parseInt(String(v),10);return Number.isFinite(n)?n:0;}

function renderSections(){
  let index=0;
  $('checkSections').innerHTML=SECTIONS.map(section=>{
    const rows=section.items.map(([name,expected])=>{
      const id=`item-${index++}`;
      return `<div class="check-row" data-item-row="${id}" data-name="${esc(name)}" data-expected="${esc(expected)}">
        <div><div class="item-name">${esc(name)}</div><div class="item-required">תקן: ${esc(expected)}</div></div>
        <input class="qty-input" data-qty="${id}" type="number" min="0" step="1" placeholder="כמות" inputmode="numeric">
        <label class="check-toggle" data-toggle-label="${id}"><input data-check="${id}" type="checkbox" disabled><span>קיים ✓</span></label>
        <div class="item-state state-wait" data-state="${id}">טרם נבדק</div>
      </div>`;
    }).join('');
    return `<section class="check-section"><div class="check-section-head"><h2>${esc(section.title)}</h2><span>כמות → סימון ✓</span></div><div class="check-items">${rows}</div></section>`;
  }).join('');

  document.querySelectorAll('[data-qty]').forEach(input=>{
    input.addEventListener('input',()=>{
      const id=input.dataset.qty;
      const check=document.querySelector(`[data-check="${id}"]`);
      const label=document.querySelector(`[data-toggle-label="${id}"]`);
      const hasValue=input.value!=='' && Number(input.value)>=0;
      check.disabled=!hasValue;
      label.classList.toggle('ready',hasValue);
      if(!hasValue){check.checked=false;}
      updateRow(id);
      updateSummary();
    });
  });
  document.querySelectorAll('[data-check]').forEach(check=>check.addEventListener('change',()=>{updateRow(check.dataset.check);updateSummary();}));
  updateSummary();
}

function updateRow(id){
  const row=document.querySelector(`[data-item-row="${id}"]`);
  const qty=document.querySelector(`[data-qty="${id}"]`);
  const check=document.querySelector(`[data-check="${id}"]`);
  const state=document.querySelector(`[data-state="${id}"]`);
  const expected=row.dataset.expected;
  const actual=qty.value===''?null:Number(qty.value);
  row.classList.remove('done','shortage'); state.className='item-state state-wait'; state.textContent='טרם נבדק';
  if(actual===null)return;
  const min=expectedMin(expected);
  if(check.checked){
    if(min && actual<min){row.classList.add('shortage');state.className='item-state state-short';state.textContent=`חוסר: ${Math.max(0,min-actual)}`;}
    else{row.classList.add('done');state.className='item-state state-ok';state.textContent='נבדק ✓';}
  } else { state.textContent='הכמות הוזנה — יש לסמן ✓'; }
}

function allRows(){return [...document.querySelectorAll('[data-item-row]')];}
function updateSummary(){
  const rows=allRows();
  const done=rows.filter(row=>document.querySelector(`[data-check="${row.dataset.itemRow}"]`)?.checked).length;
  const shortages=rows.filter(row=>{const id=row.dataset.itemRow;const q=document.querySelector(`[data-qty="${id}"]`);const c=document.querySelector(`[data-check="${id}"]`);return c?.checked && Number(q?.value)<expectedMin(row.dataset.expected);}).length;
  $('completionText').textContent=`${done} / ${rows.length} פריטים סומנו`;
  $('shortageText').textContent=shortages?`${shortages} פריטים מתחת לתקן`:'הזן כמות לכל פריט ולאחר מכן סמן ✓ אם הוא קיים.';
}

function collectItems(){
  return allRows().map(row=>{
    const id=row.dataset.itemRow;
    const qty=document.querySelector(`[data-qty="${id}"]`);
    const check=document.querySelector(`[data-check="${id}"]`);
    return {name:row.dataset.name,expected:row.dataset.expected,quantity:qty.value===''?null:Number(qty.value),checked:!!check.checked,shortage:check.checked && Number(qty.value)<expectedMin(row.dataset.expected)};
  });
}

$('checkLoginForm').addEventListener('submit',async e=>{e.preventDefault();$('checkLoginMessage').textContent='';try{await signInWithEmailAndPassword(auth,ADMIN_EMAIL,$('checkPassword').value);}catch(err){console.error(err);$('checkLoginMessage').textContent='הכניסה נכשלה. יש לבדוק את הסיסמה.';}});
$('checkLogoutBtn').addEventListener('click',()=>signOut(auth));

onAuthStateChanged(auth,user=>{
  const ok=user?.email?.toLowerCase()===ADMIN_EMAIL.toLowerCase();
  $('checkLogin').hidden=!!ok;$('checkApp').hidden=!ok;
  if(ok){renderSections();setTimeout(()=>$('inspectorName')?.focus(),100);}
});

$('ambulanceCheckForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const inspector=$('inspectorName').value.trim();
  const ambulance=$('ambulanceNumber').value.trim();
  const items=collectItems();
  const missingQty=items.filter(x=>x.quantity===null);
  const unchecked=items.filter(x=>!x.checked);
  if(!inspector||!ambulance)return showToast('יש למלא שם בודק ומספר אמבולנס','error');
  if(missingQty.length)return showToast(`יש להזין כמות עבור ${missingQty.length} פריטים`,'error');
  if(unchecked.length)return showToast(`יש ${unchecked.length} פריטים שלא סומנו ✓`,'error');
  const btn=$('submitCheckBtn');btn.disabled=true;
  try{
    await addDoc(collection(db,'ambulanceChecks'),{
      inspectorName:inspector,ambulanceNumber:ambulance,generalNotes:$('generalNotes').value.trim(),defibSerial:$('defibSerial').value.trim(),padsExpiry:$('padsExpiry').value||'',items,totalItems:items.length,shortageCount:items.filter(x=>x.shortage).length,completedCount:items.filter(x=>x.checked).length,status:items.some(x=>x.shortage)?'shortage':'complete',createdAt:serverTimestamp(),createdAtClient:new Date().toISOString(),adminEmail:auth.currentUser?.email||ADMIN_EMAIL
    });
    showToast('בדיקת האמבולנס נשמרה בהצלחה ✓');
    e.currentTarget.reset();renderSections();
  }catch(err){console.error('SAVE AMBULANCE CHECK:',err);showToast('לא ניתן לשמור את הבדיקה','error');}
  finally{btn.disabled=false;}
});
