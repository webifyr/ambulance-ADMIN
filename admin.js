import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  increment,
  getDocs,
  writeBatch,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

setPersistence(auth, browserSessionPersistence).catch(console.error);

const $ = id => document.getElementById(id);

const loginCard = $('loginCard');
const dashboard = $('dashboard');
const loginForm = $('loginForm');
const loginMessage = $('loginMessage');
const requestsList = $('requestsList');
const search = $('search');
const chatList = $('chatList');
const chatGrid = $('chatAdminGrid');
const locationsList = $('locationsList');

let rows = [];
let chats = [];
let unsubRequests = null;
let unsubChats = null;
let unsubMessages = null;
let unsubLocations = null;
let unsubLocationShares = null;
let unsubProducts = null;
let adminProducts = [];
let unsubDonations = null;
let adminDonations = [];
let unsubAmbulanceChecks = null;
let locations = [];
let locationShares = [];
let ambulanceChecks = [];
let activeChatId = '';
let deletingChat = false;
let chatSnapshotReady = false;

const previousChatState = new Map();

let audioContext = null;
let originalTitle = document.title;
let titleFlashTimer = null;

const EMAIL_SETTINGS_DOC = doc(db, 'settings', 'notifications');

let emailRecipients = [];
let emailSettingsInitialized = false;

function normalizeRecipients(data = {}) {
  if (Array.isArray(data.emailRecipients)) {
    return data.emailRecipients
      .filter(x => x && x.email)
      .map(x => ({
        id: String(x.id || crypto.randomUUID()),
        email: String(x.email || '').trim().toLowerCase(),
        label: String(x.label || '').trim(),
        enabled: x.enabled !== false
      }));
  }

  if (data.alertEmail) {
    return [{
      id: 'legacy-admin',
      email: String(data.alertEmail).trim().toLowerCase(),
      label: 'מנהל',
      enabled: data.emailEnabled !== false
    }];
  }

  if (ADMIN_EMAIL) {
    return [{
      id: 'default-admin',
      email: ADMIN_EMAIL.toLowerCase(),
      label: 'מנהל',
      enabled: true
    }];
  }

  return [];
}

function renderEmailRecipients() {
  const list = $('emailRecipientsList');
  if (!list) return;

  $('emailTabCount').textContent =
    String(emailRecipients.filter(x => x.enabled).length);

  list.innerHTML = emailRecipients.map(r => `
    <article class="email-recipient-row" data-email-row="${esc(r.id)}">
      <div class="email-recipient-main">
        <strong>${esc(r.email)}</strong>
        <small>
          <span>${esc(r.label || 'ללא תיאור')}</span>
          <span class="email-status ${r.enabled ? '' : 'off'}">
            ${r.enabled ? 'פעיל' : 'מושבת'}
          </span>
        </small>
      </div>

      <div class="email-recipient-actions">
        <button type="button" data-email-edit="${esc(r.id)}">עריכה</button>
        <button type="button" data-email-toggle="${esc(r.id)}">
          ${r.enabled ? 'השבתה' : 'הפעלה'}
        </button>
        <button
          type="button"
          class="danger"
          data-email-delete="${esc(r.id)}">
          מחיקה
        </button>
      </div>
    </article>
  `).join('') || `
    <div class="email-empty">
      עדיין לא נוספו כתובות אימייל להתראות.
    </div>
  `;

  list.querySelectorAll('[data-email-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = emailRecipients.find(
        x => x.id === btn.dataset.emailEdit
      );

      if (!r) return;

      $('emailRecipientId').value = r.id;
      $('emailRecipientAddress').value = r.email;
      $('emailRecipientLabel').value = r.label || '';
      $('saveEmailRecipient').textContent = 'שמירת שינויים';
      $('cancelEmailEdit').hidden = false;
      $('emailRecipientAddress').focus();
    });
  });

  list.querySelectorAll('[data-email-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = emailRecipients.find(
        x => x.id === btn.dataset.emailToggle
      );

      if (!r) return;

      r.enabled = !r.enabled;
      await saveEmailRecipients('סטטוס האימייל עודכן');
    });
  });

  list.querySelectorAll('[data-email-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      emailRecipients = emailRecipients.filter(
        x => x.id !== btn.dataset.emailDelete
      );

      await saveEmailRecipients('כתובת האימייל נמחקה');
    });
  });
}

async function saveEmailRecipients(message = 'הגדרות האימייל נשמרו') {
  try {
    await setDoc(
      EMAIL_SETTINGS_DOC,
      {
        emailRecipients,
        emailEnabled:
          $('emailAlertsMaster')?.checked !== false,
        adminUrl:
          window.location.href.split('#')[0],
        updatedAt:
          serverTimestamp()
      },
      {
        merge: true
      }
    );

    renderEmailRecipients();
    showToast(message);

  } catch (err) {
    console.error('EMAIL SETTINGS SAVE:', err);
    showToast(
      'לא ניתן לשמור את הגדרות האימייל',
      'error'
    );
  }
}

async function loadEmailAlertSettings() {
  try {
    const snap = await getDoc(EMAIL_SETTINGS_DOC);
    const data = snap.exists() ? snap.data() : {};

    emailRecipients = normalizeRecipients(data);

    if ($('emailAlertsMaster')) {
      $('emailAlertsMaster').checked =
        data.emailEnabled !== false;
    }

    renderEmailRecipients();

  } catch (err) {
    console.warn('EMAIL SETTINGS LOAD:', err);

    emailRecipients =
      normalizeRecipients({});

    renderEmailRecipients();
  }
}

function initEmailAlertSettings() {
  loadEmailAlertSettings();

  if (emailSettingsInitialized) return;

  emailSettingsInitialized = true;

  $('emailRecipientForm')?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      const email =
        $('emailRecipientAddress').value
          .trim()
          .toLowerCase();

      const label =
        $('emailRecipientLabel').value.trim();

      const id =
        $('emailRecipientId').value;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showToast(
          'יש להזין כתובת אימייל תקינה',
          'error'
        );
      }

      const duplicate =
        emailRecipients.find(
          x => x.email === email && x.id !== id
        );

      if (duplicate) {
        return showToast(
          'כתובת האימייל כבר קיימת ברשימה',
          'error'
        );
      }

      if (id) {
        const r =
          emailRecipients.find(x => x.id === id);

        if (r) {
          r.email = email;
          r.label = label;
        }
      } else {
        emailRecipients.push({
          id: crypto.randomUUID(),
          email,
          label,
          enabled: true
        });
      }

      $('emailRecipientForm').reset();
      $('emailRecipientId').value = '';
      $('saveEmailRecipient').textContent =
        'הוספת אימייל';
      $('cancelEmailEdit').hidden = true;

      await saveEmailRecipients(
        id
          ? 'כתובת האימייל עודכנה'
          : 'כתובת אימייל נוספה'
      );
    }
  );

  $('cancelEmailEdit')?.addEventListener(
    'click',
    () => {
      $('emailRecipientForm').reset();
      $('emailRecipientId').value = '';
      $('saveEmailRecipient').textContent =
        'הוספת אימייל';
      $('cancelEmailEdit').hidden = true;
    }
  );

  $('emailAlertsMaster')?.addEventListener(
    'change',
    () => saveEmailRecipients(
      $('emailAlertsMaster').checked
        ? 'התראות האימייל הופעלו'
        : 'התראות האימייל הושבתו'
    )
  );
}

const REMINDER_NUMBER_KEY =
  'ambulanceEronReminderWhatsApp';

const REMINDER_DELAY_KEY =
  'ambulanceEronReminderDelay';

const DEFAULT_REMINDER_NUMBER =
  '0549496626';

let reminderTimer = null;

function getReminderNumber() {
  return localStorage.getItem(
    REMINDER_NUMBER_KEY
  ) || DEFAULT_REMINDER_NUMBER;
}

function getReminderDelayMinutes() {
  return Math.max(
    1,
    Number(
      localStorage.getItem(
        REMINDER_DELAY_KEY
      ) || 3
    )
  );
}

function chatTimestampMs(chat) {
  return (
    chat.updatedAt?.toMillis?.() ||
    chat.createdAt?.toMillis?.() ||
    Date.now()
  );
}

function pendingReminderChats() {
  const delayMs =
    getReminderDelayMinutes() *
    60 *
    1000;

  const now = Date.now();

  return chats.filter(chat => {
    if (chat.status === 'closed') {
      return false;
    }

    const unread =
      Number(chat.unreadForAdmin || 0) > 0;

    const visitorWaiting =
      chat.lastSender === 'visitor';

    const oldEnough =
      now - chatTimestampMs(chat) >= delayMs;

    return oldEnough &&
      (unread || visitorWaiting);
  });
}

function reminderMessage(pending) {
  const lines =
    pending
      .slice(0, 8)
      .map((c, i) =>
        (i + 1) +
        '. ' +
        (c.name || 'מבקר') +
        (c.phone ? ' - ' + c.phone : '') +
        (
          c.lastMessage
            ? ' - ' +
              String(c.lastMessage).slice(0, 70)
            : ''
        )
      );

  return (
    'התראת אמבולנס עירון 🚑\n' +
    'יש ' +
    pending.length +
    ' שיחות שלא נפתחו או לא נענו.\n\n' +
    lines.join('\n') +
    '\n\nיש להיכנס ללוח הניהול ולטפל בהודעות.'
  );
}

function updateWhatsAppReminder() {
  const bar =
    $('whatsappReminderBar');

  const link =
    $('openReminderWhatsApp');

  const badge =
    $('mobileReminderBadge');

  if (!bar || !link) return;

  const pending =
    pendingReminderChats();

  const count =
    pending.length;

  bar.hidden =
    count === 0;

  if (badge) {
    badge.hidden =
      count === 0;
  }

  if (!count) return;

  $('reminderTitle').textContent =
    count === 1
      ? 'שיחה אחת דורשת מעקב'
      : count +
        ' שיחות דורשות מעקב';

  $('reminderText').textContent =
    'עברו יותר מ-' +
    getReminderDelayMinutes() +
    ' דקות ללא פתיחה או מענה.';

  const number =
    whatsappNumber(
      getReminderNumber()
    );

  link.href =
    number
      ? 'https://wa.me/' +
        number +
        '?text=' +
        encodeURIComponent(
          reminderMessage(pending)
        )
      : '#';
}

function initReminderSettings() {
  const numberInput =
    $('reminderWhatsAppNumber');

  const delaySelect =
    $('reminderDelay');

  if (numberInput) {
    numberInput.value =
      getReminderNumber();
  }

  if (delaySelect) {
    delaySelect.value =
      String(
        getReminderDelayMinutes()
      );
  }

  $('saveReminderSettings')
    ?.addEventListener(
      'click',
      () => {
        const number =
          numberInput?.value.trim() ||
          DEFAULT_REMINDER_NUMBER;

        const delay =
          delaySelect?.value ||
          '3';

        localStorage.setItem(
          REMINDER_NUMBER_KEY,
          number
        );

        localStorage.setItem(
          REMINDER_DELAY_KEY,
          delay
        );

        updateWhatsAppReminder();

        showToast(
          'הגדרות תזכורת WhatsApp נשמרו'
        );
      }
    );

  clearInterval(
    reminderTimer
  );

  reminderTimer =
    setInterval(
      updateWhatsAppReminder,
      15000
    );

  updateWhatsAppReminder();
}

function waitingReplyChats() {
  return chats.filter(
    c =>
      c.status !== 'closed' &&
      c.lastSender === 'visitor'
  );
}

function updateUnansweredChatAlert() {
  const bar =
    $('unansweredChatBar');

  if (!bar) return;

  const waiting =
    waitingReplyChats();

  bar.hidden =
    waiting.length === 0;

  if (!waiting.length) {
    document.title =
      originalTitle;

    if (titleFlashTimer) {
      clearInterval(
        titleFlashTimer
      );

      titleFlashTimer = null;
    }

    return;
  }

  $('unansweredChatTitle').textContent =
    waiting.length === 1
      ? 'אדם אחד ממתין למענה'
      : waiting.length +
        ' אנשים ממתינים למענה';

  const latest =
    waiting[0];

  $('unansweredChatText').textContent =
    (latest?.name || 'מבקר') +
    (
      latest?.lastMessage
        ? ': ' +
          String(
            latest.lastMessage
          ).slice(0, 90)
        : ' שלח הודעה חדשה.'
    );

  if (!titleFlashTimer) {
    let on = false;

    titleFlashTimer =
      setInterval(() => {
        on = !on;

        document.title =
          on
            ? '🔔 הודעה חדשה - אמבולנס עירון'
            : originalTitle;
      }, 950);
  }
}

function playChatAlertSound() {
  try {
    audioContext =
      audioContext ||
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

    if (
      audioContext.state === 'suspended'
    ) {
      audioContext.resume();
    }

    const now =
      audioContext.currentTime;

    [
      [740, 0],
      [980, .13]
    ].forEach(
      ([freq, delay]) => {
        const osc =
          audioContext.createOscillator();

        const gain =
          audioContext.createGain();

        osc.type = 'sine';

        osc.frequency.value =
          freq;

        gain.gain.setValueAtTime(
          0.0001,
          now + delay
        );

        gain.gain.exponentialRampToValueAtTime(
          0.16,
          now + delay + .02
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + delay + .18
        );

        osc.connect(gain);
        gain.connect(
          audioContext.destination
        );

        osc.start(
          now + delay
        );

        osc.stop(
          now + delay + .2
        );
      }
    );

  } catch (e) {
    console.warn(
      'ALERT SOUND:',
      e
    );
  }
}

function showBrowserChatNotification(chat) {
  if (
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return;
  }

  try {
    const n =
      new Notification(
        'הודעה חדשה - אמבולנס עירון',
        {
          body:
            (chat.name || 'מבקר') +
            ': ' +
            (
              chat.lastMessage ||
              'שלח הודעה חדשה'
            ),
          icon:
            'assets/logo.jpeg',
          tag:
            'chat-' + chat.id,
          renotify:
            true
        }
      );

    n.onclick = () => {
      window.focus();
      openChat(chat.id);
      n.close();
    };

    setTimeout(
      () => n.close(),
      12000
    );

  } catch (e) {
    console.warn(
      'BROWSER NOTIFICATION:',
      e
    );
  }
}

function alertForNewVisitorMessages(nextChats) {
  if (!chatSnapshotReady) {
    previousChatState.clear();

    nextChats.forEach(c =>
      previousChatState.set(
        c.id,
        {
          unread:
            Number(
              c.unreadForAdmin || 0
            ),
          lastSender:
            c.lastSender,
          updated:
            c.updatedAt?.toMillis?.() ||
            c.createdAt?.toMillis?.() ||
            0
        }
      )
    );

    chatSnapshotReady = true;
    return;
  }

  for (const c of nextChats) {
    const prev =
      previousChatState.get(c.id);

    const nowUnread =
      Number(
        c.unreadForAdmin || 0
      );

    const nowUpdated =
      c.updatedAt?.toMillis?.() ||
      c.createdAt?.toMillis?.() ||
      0;

    const isNewVisitorMessage =
      c.lastSender === 'visitor' &&
      (
        !prev ||
        nowUnread >
          Number(
            prev.unread || 0
          ) ||
        (
          nowUpdated >
            Number(
              prev.updated || 0
            ) &&
          prev.lastSender !== 'visitor'
        )
      );

    if (isNewVisitorMessage) {
      playChatAlertSound();

      navigator.vibrate?.(
        [180, 90, 180]
      );

      showBrowserChatNotification(c);

      showToast(
        '🔔 הודעה חדשה מאת ' +
        (c.name || 'מבקר')
      );
    }
  }

  previousChatState.clear();

  nextChats.forEach(c =>
    previousChatState.set(
      c.id,
      {
        unread:
          Number(
            c.unreadForAdmin || 0
          ),
        lastSender:
          c.lastSender,
        updated:
          c.updatedAt?.toMillis?.() ||
          c.createdAt?.toMillis?.() ||
          0
      }
    )
  );
}

function initChatAlerts() {
  const btn =
    $('enableChatNotifications');

  if (btn) {
    const refresh = () => {
      if (
        !('Notification' in window)
      ) {
        btn.textContent =
          'הדפדפן אינו תומך בהתראות';

        btn.disabled = true;

        return;
      }

      if (
        Notification.permission ===
        'granted'
      ) {
        btn.textContent =
          '✓ התראות הדפדפן פעילות';

      } else if (
        Notification.permission ===
        'denied'
      ) {
        btn.textContent =
          'ההתראות חסומות בדפדפן';

      } else {
        btn.textContent =
          'הפעלת התראות בדפדפן';
      }
    };

    refresh();

    btn.addEventListener(
      'click',
      async () => {
        try {
          if (
            'Notification' in window &&
            Notification.permission !==
              'granted'
          ) {
            await Notification
              .requestPermission();
          }

          playChatAlertSound();
          refresh();

        } catch (e) {
          console.warn(e);
        }
      }
    );
  }

  $('showUnansweredChats')
    ?.addEventListener(
      'click',
      () => {
        activateTab(
          'chats'
        );

        const first =
          waitingReplyChats()[0];

        if (first) {
          openChat(first.id);
        }
      }
    );

  updateUnansweredChatAlert();
}

function esc(v = '') {
  return String(v).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[c])
  );
}

function dateText(ts) {
  return ts?.toDate
    ? ts
        .toDate()
        .toLocaleString(
          'he-IL',
          {
            dateStyle: 'short',
            timeStyle: 'short'
          }
        )
    : '';
}

function phoneDigits(phone = '') {
  return String(phone)
    .replace(/\D/g, '');
}

function whatsappNumber(phone = '') {
  const d =
    phoneDigits(phone);

  if (!d) return '';

  if (d.startsWith('0')) {
    return '972' +
      d.slice(1);
  }

  return d;
}

function showToast(message, type = 'ok') {
  const toast =
    $('adminToast');

  if (!toast) return;

  toast.textContent =
    message;

  toast.className =
    `admin-toast show ${type}`;

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(
      () =>
        toast.className =
          'admin-toast',
      2600
    );
}

loginForm?.addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    loginMessage.textContent = '';

    try {
      await signInWithEmailAndPassword(
        auth,
        ADMIN_EMAIL,
        $('adminPassword').value
      );

    } catch (err) {
      console.error(err);

      loginMessage.textContent =
        'הכניסה נכשלה. יש לבדוק את הסיסמה.';
    }
  }
);

$('logoutBtn')
  ?.addEventListener(
    'click',
    () => signOut(auth)
  );

$('mobileLogoutBtn')
  ?.addEventListener(
    'click',
    () => signOut(auth)
  );

onAuthStateChanged(
  auth,
  user => {
    const ok =
      user?.email?.toLowerCase() ===
      ADMIN_EMAIL.toLowerCase();

    loginCard.hidden =
      !!ok;

    dashboard.hidden =
      !ok;

    if (ok) {
      loadRequests();
      loadChats();
      loadLocations();
      loadLocationShares();
      loadAdminProducts();
      loadAdminDonations();
      initLocationShareCreator();
      initReminderSettings();
      initChatAlerts();
      initEmailAlertSettings();
      loadAmbulanceChecks();

    } else {
      unsubRequests?.();
      unsubChats?.();
      unsubMessages?.();
      unsubLocations?.();
      unsubLocationShares?.();
      unsubProducts?.();
      unsubDonations?.();
      unsubAmbulanceChecks?.();

      unsubRequests =
      unsubChats =
      unsubMessages =
      unsubLocations =
      unsubLocationShares =
      unsubDonations =
      unsubAmbulanceChecks =
        null;

      activeChatId = '';

      clearInterval(
        reminderTimer
      );

      reminderTimer = null;

      chatSnapshotReady = false;

      previousChatState.clear();

      if (titleFlashTimer) {
        clearInterval(
          titleFlashTimer
        );

        titleFlashTimer = null;
      }

      document.title =
        originalTitle;
    }
  }
);

function activateTab(tab) {
  document
    .querySelectorAll('[data-tab]')
    .forEach(b =>
      b.classList.toggle(
        'active',
        b.dataset.tab === tab
      )
    );

  document
    .querySelectorAll('.tab-pane')
    .forEach(p =>
      p.classList.toggle(
        'active',
        p.id === tab + 'Tab'
      )
    );

  document
    .querySelectorAll('[data-mobile-tab]')
    .forEach(b =>
      b.classList.toggle(
        'active',
        b.dataset.mobileTab === tab
      )
    );
}

document
  .querySelectorAll('[data-tab]')
  .forEach(btn =>
    btn.addEventListener(
      'click',
      () =>
        activateTab(
          btn.dataset.tab
        )
    )
  );

document
  .querySelectorAll('[data-mobile-tab]')
  .forEach(btn =>
    btn.addEventListener(
      'click',
      () =>
        activateTab(
          btn.dataset.mobileTab
        )
    )
  );

function renderRequests() {
  const term =
    (search?.value || '')
      .trim()
      .toLowerCase();

  const filtered =
    rows.filter(x =>
      [
        x.name,
        x.phone,
        x.service,
        x.message
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );

  requestsList.innerHTML =
    filtered.map(x => `
      <article class="request">

        <div class="request-top">

          <div>
            <h3>${esc(x.name)}</h3>

            <div class="meta">
              <span>${esc(x.phone)}</span>
              <span>${esc(x.service)}</span>
              <span>${dateText(x.createdAt)}</span>
            </div>
          </div>

          <div class="request-controls">

            <div class="request-contact-actions">

              <a
                class="request-contact-btn call"
                href="tel:${esc(x.phone || '')}">
                <span>☎</span>
                <b>חיוג</b>
              </a>

              <a
                class="request-contact-btn whatsapp"
                href="https://wa.me/${whatsappNumber(x.phone)}"
                target="_blank"
                rel="noopener">
                <span>WA</span>
                <b>WhatsApp</b>
              </a>

            </div>

            <select data-status="${x.id}">

              <option
                value="new"
                ${x.status === 'new' ? 'selected' : ''}>
                חדש
              </option>

              <option
                value="contacted"
                ${x.status === 'contacted' ? 'selected' : ''}>
                נוצר קשר
              </option>

              <option
                value="done"
                ${x.status === 'done' ? 'selected' : ''}>
                הושלם
              </option>

            </select>

            <button
              class="delete"
              data-delete="${x.id}">
              מחיקה
            </button>

          </div>

        </div>

        <p>
          ${esc(x.message || 'ללא הערות')}
        </p>

      </article>
    `).join('') ||
    '<p class="empty-text">אין בקשות.</p>';

  $('allCount').textContent =
    rows.length;

  $('newCount').textContent =
    rows.filter(
      x => x.status === 'new'
    ).length;

  $('doneCount').textContent =
    rows.filter(
      x => x.status === 'done'
    ).length;

  $('requestTabCount').textContent =
    rows.filter(
      x => x.status === 'new'
    ).length;

  document
    .querySelectorAll('[data-status]')
    .forEach(el =>
      el.onchange = () =>
        updateDoc(
          doc(
            db,
            'requests',
            el.dataset.status
          ),
          {
            status:
              el.value
          }
        )
    );

  document
    .querySelectorAll('[data-delete]')
    .forEach(el =>
      el.onclick = async () => {
        if (el.disabled) return;

        el.disabled = true;

        try {
          await deleteDoc(
            doc(
              db,
              'requests',
              el.dataset.delete
            )
          );

          showToast(
            'הבקשה נמחקה בהצלחה'
          );

        } catch (err) {
          console.error(
            'DELETE REQUEST ERROR:',
            err
          );

          showToast(
            'לא ניתן למחוק את הבקשה',
            'error'
          );

          el.disabled = false;
        }
      }
    );
}

function loadRequests() {
  if (unsubRequests) return;

  unsubRequests =
    onSnapshot(
      query(
        collection(
          db,
          'requests'
        ),
        orderBy(
          'createdAt',
          'desc'
        )
      ),

      snap => {
        rows =
          snap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );

        renderRequests();
      },

      err => {
        console.error(err);

        requestsList.innerHTML =
          '<p>לא ניתן לטעון בקשות. יש לבדוק את כללי Firestore.</p>';
      }
    );
}

function renderChats() {
  const term =
    (search?.value || '')
      .trim()
      .toLowerCase();

  const filtered =
    chats.filter(x =>
      [
        x.name,
        x.phone,
        x.lastMessage
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );

  chatList.innerHTML = '';

  if (!filtered.length) {
    chatList.innerHTML = `
      <div class="admin-chat-error">
        <strong>עדיין אין שיחות.</strong>
        <br>
        <small>שיחה חדשה מהאתר תופיע כאן מיד.</small>
      </div>
    `;

  } else {
    filtered.forEach(chat => {
      const item =
        document.createElement(
          'div'
        );

      item.className =
        `chat-list-item ${
          chat.id === activeChatId
            ? 'active'
            : ''
        }`;

      item.dataset.chatId =
        chat.id;

      item.tabIndex = 0;

      item.setAttribute(
        'role',
        'button'
      );

      item.innerHTML = `
        <div class="chat-avatar">
          ${esc((chat.name || '?').slice(0, 1))}
        </div>

        <div class="chat-list-copy">

          <div>
            <strong>
              ${esc(chat.name || 'מבקר')}
            </strong>

            <time>
              ${dateText(chat.updatedAt || chat.createdAt)}
            </time>
          </div>

          <p>
            ${esc(chat.lastMessage || 'שיחה חדשה')}
          </p>

        </div>

        <div class="chat-row-actions">

          ${
            Number(
              chat.unreadForAdmin || 0
            ) > 0
              ? `<b class="unread">${Number(chat.unreadForAdmin)}</b>`
              : ''
          }

          <button
            type="button"
            class="chat-mini-delete">
            ×
          </button>

        </div>
      `;

      const open =
        () => openChat(chat.id);

      item.addEventListener(
        'click',
        e => {
          if (
            e.target.closest(
              '.chat-mini-delete'
            )
          ) {
            return;
          }

          open();
        }
      );

      item.addEventListener(
        'keydown',
        e => {
          if (
            (
              e.key === 'Enter' ||
              e.key === ' '
            ) &&
            !e.target.closest(
              '.chat-mini-delete'
            )
          ) {
            e.preventDefault();
            open();
          }
        }
      );

      item
        .querySelector(
          '.chat-mini-delete'
        )
        ?.addEventListener(
          'click',
          async e => {
            e.stopPropagation();

            await deleteChat(
              chat.id,
              chat.name || 'המבקר'
            );
          }
        );

      chatList.appendChild(
        item
      );
    });
  }

  const unread =
    chats.reduce(
      (n, x) =>
        n +
        Number(
          x.unreadForAdmin || 0
        ),
      0
    );

  $('chatTabCount').textContent =
    unread;

  $('openChats').textContent =
    chats.filter(
      x => x.status !== 'closed'
    ).length +
    ' פתוחות';
}

function loadChats() {
  if (unsubChats) return;

  unsubChats =
    onSnapshot(
      collection(
        db,
        'chats'
      ),

      snap => {
        const nextChats =
          snap.docs
            .map(
              d => ({
                id: d.id,
                ...d.data()
              })
            )
            .sort(
              (a, b) => {
                const at =
                  a.updatedAt?.toMillis?.() ||
                  a.createdAt?.toMillis?.() ||
                  0;

                const bt =
                  b.updatedAt?.toMillis?.() ||
                  b.createdAt?.toMillis?.() ||
                  0;

                return bt - at;
              }
            );

        alertForNewVisitorMessages(
          nextChats
        );

        chats = nextChats;

        renderChats();
        updateUnansweredChatAlert();
        updateWhatsAppReminder();

        if (activeChatId) {
          const c =
            chats.find(
              x =>
                x.id ===
                activeChatId
            );

          if (c) {
            fillRoom(c);
          } else {
            closeRoom();
          }
        }
      },

      err => {
        console.error(
          'ADMIN CHATS ERROR:',
          err
        );

        chatList.innerHTML = `
          <div class="admin-chat-error">
            <strong>לא ניתן לטעון שיחות</strong>
            <br>
            <span>
              ${esc(err?.code || err?.message || 'Firebase error')}
            </span>
            <br>
            <small>
              יש לבדוק את כללי Firestore ואת חשבון המנהל.
            </small>
          </div>
        `;
      }
    );
}

function openChat(id) {
  const chat =
    chats.find(
      x => x.id === id
    );

  if (!chat) {
    showToast(
      'לא ניתן למצוא את השיחה',
      'error'
    );

    return;
  }

  activateTab('chats');

  activeChatId = id;

  renderChats();

  const empty =
    $('chatEmpty');

  const content =
    $('chatRoomContent');

  empty.hidden = true;
  content.hidden = false;

  empty.style.display =
    'none';

  content.style.display =
    'flex';

  chatGrid?.classList.add(
    'room-open'
  );

  fillRoom(chat);

  unsubMessages?.();

  unsubMessages =
    onSnapshot(
      query(
        collection(
          db,
          'chats',
          id,
          'messages'
        ),
        orderBy(
          'createdAt',
          'asc'
        )
      ),

      snap => {
        const msgs =
          snap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );

        $('adminMessages').innerHTML =
          msgs.map(m => `
            <div class="admin-msg ${m.sender === 'admin' ? 'admin' : 'visitor'}">
              <div>
                ${esc(m.text || '')}
              </div>
              <small>
                ${dateText(m.createdAt)}
              </small>
            </div>
          `).join('') ||
          '<div class="room-no-messages">עדיין אין הודעות.</div>';

        requestAnimationFrame(
          () =>
            $('adminMessages').scrollTop =
              $('adminMessages').scrollHeight
        );
      },

      err => {
        console.error(
          'MESSAGES ERROR:',
          err
        );

        $('adminMessages').innerHTML = `
          <div class="admin-chat-error">
            לא ניתן לטעון הודעות:
            ${esc(err?.code || err?.message || '')}
          </div>
        `;
      }
    );

  updateDoc(
    doc(
      db,
      'chats',
      id
    ),
    {
      unreadForAdmin: 0,
      adminOpenedAt:
        serverTimestamp()
    }
  )
    .then(
      updateWhatsAppReminder
    )
    .catch(
      err =>
        console.warn(
          'UNREAD RESET:',
          err
        )
    );

  setTimeout(
    () =>
      $('adminReply')?.focus(),
    120
  );
}

function fillRoom(c) {
  $('roomName').textContent =
    c.name || 'מבקר';

  $('roomPhone').textContent =
    c.phone || 'ללא מספר';

  $('roomStatus').textContent =
    c.status === 'closed'
      ? 'סגורה'
      : 'פתוחה';

  $('roomStatusSelect').value =
    c.status || 'open';

  const wa =
    $('roomWhatsApp');

  const call =
    $('roomCall');

  const digits =
    String(c.phone || '')
      .replace(/\D/g, '');

  if (wa) {
    wa.href =
      digits
        ? `https://wa.me/${
            digits.startsWith('0')
              ? '972' + digits.slice(1)
              : digits
          }`
        : '#';
  }

  if (call) {
    call.href =
      c.phone
        ? `tel:${c.phone}`
        : '#';
  }
}

function closeRoom() {
  activeChatId = '';

  unsubMessages?.();

  unsubMessages = null;

  const empty =
    $('chatEmpty');

  const content =
    $('chatRoomContent');

  empty.hidden = false;
  content.hidden = true;

  empty.style.display = '';
  content.style.display = '';

  chatGrid?.classList.remove(
    'room-open'
  );

  renderChats();
}

async function deleteChat(chatId, name = 'המבקר') {
  if (deletingChat) return;

  deletingChat = true;

  showToast(
    'מוחק את השיחה...',
    'pending'
  );

  try {
    const messagesSnap =
      await getDocs(
        collection(
          db,
          'chats',
          chatId,
          'messages'
        )
      );

    const chunks = [];

    for (
      let i = 0;
      i < messagesSnap.docs.length;
      i += 450
    ) {
      chunks.push(
        messagesSnap.docs.slice(
          i,
          i + 450
        )
      );
    }

    for (const chunk of chunks) {
      const batch =
        writeBatch(db);

      chunk.forEach(
        d =>
          batch.delete(d.ref)
      );

      await batch.commit();
    }

    await deleteDoc(
      doc(
        db,
        'chats',
        chatId
      )
    );

    if (
      activeChatId === chatId
    ) {
      closeRoom();
    }

    showToast(
      'השיחה נמחקה'
    );

  } catch (err) {
    console.error(
      'DELETE CHAT ERROR:',
      err
    );

    showToast(
      'לא ניתן למחוק את השיחה: ' +
      (
        err?.code ||
        err?.message ||
        ''
      ),
      'error'
    );

  } finally {
    deletingChat = false;
  }
}

$('chatBackBtn')
  ?.addEventListener(
    'click',
    () =>
      chatGrid?.classList.remove(
        'room-open'
      )
  );

$('closeRoomBtn')
  ?.addEventListener(
    'click',
    closeRoom
  );

$('deleteChatBtn')
  ?.addEventListener(
    'click',
    () => {
      if (!activeChatId) return;

      const c =
        chats.find(
          x =>
            x.id ===
              activeChatId
        );

      deleteChat(
        activeChatId,
        c?.name || 'המבקר'
      );
    }
  );

$('roomStatusSelect')
  ?.addEventListener(
    'change',
    async () => {
      if (!activeChatId) return;

      try {
        await updateDoc(
          doc(
            db,
            'chats',
            activeChatId
          ),
          {
            status:
              $('roomStatusSelect').value,
            updatedAt:
              serverTimestamp()
          }
        );

        showToast(
          $('roomStatusSelect').value === 'closed'
            ? 'השיחה נסגרה'
            : 'השיחה נפתחה'
        );

      } catch (err) {
        console.error(err);

        showToast(
          'לא ניתן לשנות סטטוס',
          'error'
        );
      }
    }
  );

$('adminReplyForm')
  ?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      if (!activeChatId) {
        showToast(
          'יש לבחור שיחה תחילה',
          'error'
        );

        return;
      }

      const text =
        $('adminReply').value.trim();

      if (!text) return;

      const btn =
        e.currentTarget.querySelector(
          'button[type="submit"]'
        );

      btn.disabled = true;

      try {
        await addDoc(
          collection(
            db,
            'chats',
            activeChatId,
            'messages'
          ),
          {
            text,
            sender:
              'admin',
            createdAt:
              serverTimestamp()
          }
        );

        await updateDoc(
          doc(
            db,
            'chats',
            activeChatId
          ),
          {
            lastMessage:
              text,
            lastSender:
              'admin',
            adminMessageCount:
              increment(1),
            updatedAt:
              serverTimestamp(),
            status:
              'open'
          }
        );

        $('adminReply').value = '';

        $('adminReply').focus();

        updateWhatsAppReminder();
        updateUnansweredChatAlert();

      } catch (err) {
        console.error(
          'ADMIN SEND ERROR:',
          err
        );

        showToast(
          'לא ניתן לשלוח תשובה: ' +
          (
            err?.code ||
            err?.message ||
            'Firebase error'
          ),
          'error'
        );

      } finally {
        btn.disabled = false;
      }
    }
  );

$('adminReply')
  ?.addEventListener(
    'keydown',
    e => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey
      ) {
        e.preventDefault();

        $('adminReplyForm')
          ?.requestSubmit();
      }
    }
  );


// ============================================================
// OLD LOCATIONS
// WAZE ONLY
// ============================================================

function renderLocations() {
  if (!locationsList) return;

  const term =
    (search?.value || '')
      .trim()
      .toLowerCase();

  const filtered =
    locations.filter(x =>
      [
        x.name,
        x.phone,
        x.status,
        x.latitude,
        x.longitude
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );

  locationsList.innerHTML =
    filtered.map(x => {
      const lat =
        Number(x.latitude);

      const lng =
        Number(x.longitude);

      const valid =
        Number.isFinite(lat) &&
        Number.isFinite(lng);

      const wazeUrl =
        valid
          ? `https://www.waze.com/ul?ll=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&navigate=yes`
          : '#';

      const active =
        x.status !== 'handled';

      return `
        <article class="location-admin-card">

          <div class="location-admin-top">

            <div>

              <h3>
                📍 ${esc(x.name || 'פנייה ללא שם')}
              </h3>

              <div class="location-admin-meta">

                <span>
                  ${esc(x.phone || 'ללא מספר')}
                </span>

                <span>
                  דיוק משוער:
                  ${Number(x.accuracy || 0)}
                  מ׳
                </span>

                <span>
                  ${dateText(x.updatedAt || x.createdAt)}
                </span>

                <span class="location-status-pill ${active ? '' : 'handled'}">
                  ${active ? 'פעיל' : 'טופל'}
                </span>

              </div>

            </div>

            <div class="location-admin-actions">

              ${
                valid
                  ? `
                    <a
                      class="map"
                      href="${wazeUrl}"
                      target="_blank"
                      rel="noopener noreferrer">
                      🗺️ ניווט ב-Waze
                    </a>
                  `
                  : ''
              }

              <a
                class="call"
                href="tel:${esc(x.phone || '')}">
                חיוג
              </a>

              <button
                class="handled"
                data-location-handled="${x.id}">
                ${active ? 'טופל' : 'פתיחה מחדש'}
              </button>

              <button
                class="delete-location"
                data-location-delete="${x.id}">
                מחיקה
              </button>

            </div>

          </div>

          <div class="location-coordinates">
            ${
              valid
                ? lat.toFixed(6) +
                  ', ' +
                  lng.toFixed(6)
                : 'No coordinates'
            }
          </div>

        </article>
      `;
    }).join('') ||
    '<p class="empty-text">עדיין אין מיקומים משותפים.</p>';

  const activeCount =
    locations.filter(
      x =>
        x.status !== 'handled'
    ).length;

  $('locationTabCount').textContent =
    activeCount;

  $('activeLocations').textContent =
    activeCount +
    ' מיקומים פעילים';

  document
    .querySelectorAll(
      '[data-location-handled]'
    )
    .forEach(
      btn =>
        btn.onclick =
          async () => {
            const item =
              locations.find(
                x =>
                  x.id ===
                  btn.dataset.locationHandled
              );

            try {
              await updateDoc(
                doc(
                  db,
                  'locations',
                  btn.dataset.locationHandled
                ),
                {
                  status:
                    item?.status === 'handled'
                      ? 'active'
                      : 'handled',
                  updatedAt:
                    serverTimestamp()
                }
              );

              showToast(
                item?.status === 'handled'
                  ? 'המיקום נפתח מחדש'
                  : 'הפנייה סומנה כטופלה'
              );

            } catch (err) {
              console.error(err);

              showToast(
                'לא ניתן לעדכן את המיקום',
                'error'
              );
            }
          }
    );

  document
    .querySelectorAll(
      '[data-location-delete]'
    )
    .forEach(
      btn =>
        btn.onclick =
          async () => {
            try {
              await deleteDoc(
                doc(
                  db,
                  'locations',
                  btn.dataset.locationDelete
                )
              );

              showToast(
                'המיקום נמחק'
              );

            } catch (err) {
              console.error(err);

              showToast(
                'לא ניתן למחוק את המיקום',
                'error'
              );
            }
          }
    );
}

function loadLocations() {
  if (unsubLocations) return;

  unsubLocations =
    onSnapshot(
      collection(
        db,
        'locations'
      ),

      snap => {
        locations =
          snap.docs
            .map(
              d => ({
                id: d.id,
                ...d.data()
              })
            )
            .sort(
              (a, b) => {
                const at =
                  a.updatedAt?.toMillis?.() ||
                  a.createdAt?.toMillis?.() ||
                  0;

                const bt =
                  b.updatedAt?.toMillis?.() ||
                  b.createdAt?.toMillis?.() ||
                  0;

                return bt - at;
              }
            );

        renderLocations();
      },

      err => {
        console.error(
          'LOCATIONS ERROR:',
          err
        );

        if (locationsList) {
          locationsList.innerHTML =
            '<p class="empty-text">לא ניתן לטעון מיקומים. יש לבדוק את כללי Firestore החדשים.</p>';
        }
      }
    );
}


// ============================================================
// LOCATION SHARE / LIVE LOCATION FINDER
// WAZE ONLY
// ============================================================

function createSecureShareId() {
  const bytes =
    new Uint8Array(24);

  crypto.getRandomValues(
    bytes
  );

  return Array
    .from(
      bytes,
      b =>
        b
          .toString(16)
          .padStart(2, '0')
    )
    .join('');
}

function locationShareUrl(shareId) {
  const base =
    new URL(
      'https://ambulance-eron.web.app/location.html'
    );

  base.searchParams.set(
    'id',
    shareId
  );

  return base.toString();
}

function locationShareMessage(name, url) {
  const who =
    name
      ? ` ${name}`
      : '';

  return `שלום${who},
אמבולנס עירון מבקש לקבל את מיקומך כדי להגיע אליך במהירות ובדיוק.
יש לפתוח את הקישור ולאשר שיתוף מיקום בדפדפן:
${url}

המיקום ישותף רק לאחר אישורך.`;
}

function locationShareStatus(item) {
  if (
    item.sharing === true &&
    item.status === 'active'
  ) {
    return {
      text:
        'מיקום חי',
      cls:
        'live'
    };
  }

  if (
    item.status ===
    'requesting_permission'
  ) {
    return {
      text:
        'ממתין לאישור',
      cls:
        'waiting'
    };
  }

  if (
    item.status ===
    'stopped'
  ) {
    return {
      text:
        'השיתוף הופסק',
      cls:
        'stopped'
    };
  }

  return {
    text:
      'הקישור נשלח / ממתין',
    cls:
      'waiting'
  };
}

function locationShareTime(item) {
  const ts =
    item.lastUpdate ||
    item.updatedAt ||
    item.openedAt ||
    item.createdAt;

  return (
    dateText(ts) ||
    '—'
  );
}

function renderLocationShares() {
  const list =
    $('locationSessionsList');

  if (!list) return;

  const term =
    (search?.value || '')
      .trim()
      .toLowerCase();

  const filtered =
    locationShares.filter(
      x =>
        [
          x.name,
          x.phone,
          x.status,
          x.latitude,
          x.longitude,
          x.id
        ]
          .join(' ')
          .toLowerCase()
          .includes(term)
    );

  const liveCount =
    locationShares.filter(
      x =>
        x.sharing === true &&
        x.status === 'active'
    ).length;

  if ($('locatorTabCount')) {
    $('locatorTabCount').textContent =
      String(liveCount);
  }

  if ($('liveLocationCount')) {
    $('liveLocationCount').textContent =
      `${liveCount} פעילים`;
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="location-session-empty">
        <span>📡</span>
        <strong>
          עדיין אין שיתופי מיקום
        </strong>
        <p>
          צור קישור ושלח אותו למשתמש.
        </p>
      </div>
    `;

    return;
  }

  list.innerHTML =
    filtered.map(item => {
      const lat =
        Number(item.latitude);

      const lng =
        Number(item.longitude);

      const valid =
        Number.isFinite(lat) &&
        Number.isFinite(lng);

      const status =
        locationShareStatus(item);

      const shareUrl =
        locationShareUrl(item.id);

      const phone =
        String(
          item.phone || ''
        );

      const wa =
        whatsappNumber(phone);

      const msg =
        locationShareMessage(
          item.name || '',
          shareUrl
        );

      const wazeUrl =
        valid
          ? `https://www.waze.com/ul?ll=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&navigate=yes`
          : '#';

      return `
        <article class="location-session-card ${status.cls}">

          <div class="location-session-top">

            <div>

              <div class="location-session-name-row">

                <h3>
                  📍 ${esc(item.name || 'ללא שם')}
                </h3>

                <span class="location-share-status ${status.cls}">
                  ${esc(status.text)}
                </span>

              </div>

              <div class="location-session-meta">

                <span>
                  ☎ ${esc(phone || 'ללא מספר')}
                </span>

                <span>
                  עדכון אחרון:
                  ${esc(locationShareTime(item))}
                </span>

                ${
                  valid
                    ? `
                      <span>
                        דיוק:
                        ${Math.round(Number(item.accuracy || 0))}
                        מ׳
                      </span>
                    `
                    : ''
                }

              </div>

            </div>

          </div>

          ${
            valid
              ? `
                <div class="location-session-coordinates">

                  <strong>
                    ${lat.toFixed(6)},
                    ${lng.toFixed(6)}
                  </strong>

                  <small>
                    המיקום מתעדכן כל עוד המשתמש משתף והעמוד פתוח.
                  </small>

                </div>
              `
              : `
                <div class="location-session-waiting">
                  ממתין שהמשתמש יפתח את הקישור ויאשר שיתוף מיקום.
                </div>
              `
          }

          <div class="location-session-actions">

            ${
              valid
                ? `
                  <a
                    class="location-action-waze"
                    href="${wazeUrl}"
                    target="_blank"
                    rel="noopener noreferrer">
                    🗺️ ניווט ב-Waze
                  </a>
                `
                : ''
            }

            ${
              phone
                ? `
                  <a href="tel:${esc(phone)}">
                    ☎ חיוג
                  </a>
                `
                : ''
            }

            ${
              wa
                ? `
                  <a
                    href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}"
                    target="_blank"
                    rel="noopener">
                    WhatsApp
                  </a>
                `
                : ''
            }

            <button
              type="button"
              data-share-copy="${esc(item.id)}">
              העתקת קישור
            </button>

            ${
              item.status !== 'stopped'
                ? `
                  <button
                    type="button"
                    data-share-stop="${esc(item.id)}">
                    הפסקת שיתוף
                  </button>
                `
                : ''
            }

            <button
              type="button"
              class="danger"
              data-share-delete="${esc(item.id)}">
              מחיקה
            </button>

          </div>

        </article>
      `;
    }).join('');

  list
    .querySelectorAll(
      '[data-share-copy]'
    )
    .forEach(
      btn => {
        btn.addEventListener(
          'click',
          async () => {
            const url =
              locationShareUrl(
                btn.dataset.shareCopy
              );

            try {
              await navigator.clipboard.writeText(
                url
              );

              showToast(
                'הקישור הועתק'
              );

            } catch (err) {
              console.warn(
                'COPY LOCATION LINK:',
                err
              );

              window.prompt(
                'העתק את הקישור:',
                url
              );
            }
          }
        );
      }
    );

  list
    .querySelectorAll(
      '[data-share-stop]'
    )
    .forEach(
      btn => {
        btn.addEventListener(
          'click',
          async () => {
            try {
              await updateDoc(
                doc(
                  db,
                  'locationShares',
                  btn.dataset.shareStop
                ),
                {
                  sharing:
                    false,
                  status:
                    'stopped',
                  stoppedAt:
                    serverTimestamp()
                }
              );

              showToast(
                'שיתוף המיקום סומן כמופסק'
              );

            } catch (err) {
              console.error(
                'STOP LOCATION SHARE:',
                err
              );

              showToast(
                'לא ניתן לעצור את השיתוף',
                'error'
              );
            }
          }
        );
      }
    );

  list
    .querySelectorAll(
      '[data-share-delete]'
    )
    .forEach(
      btn => {
        btn.addEventListener(
          'click',
          async () => {
            if (
              !confirm(
                'למחוק את קישור שיתוף המיקום?'
              )
            ) {
              return;
            }

            try {
              await deleteDoc(
                doc(
                  db,
                  'locationShares',
                  btn.dataset.shareDelete
                )
              );

              showToast(
                'שיתוף המיקום נמחק'
              );

            } catch (err) {
              console.error(
                'DELETE LOCATION SHARE:',
                err
              );

              showToast(
                'לא ניתן למחוק את השיתוף',
                'error'
              );
            }
          }
        );
      }
    );
}

function loadLocationShares() {
  if (unsubLocationShares) {
    return;
  }

  unsubLocationShares =
    onSnapshot(
      query(
        collection(
          db,
          'locationShares'
        ),
        orderBy(
          'createdAt',
          'desc'
        )
      ),

      snap => {
        locationShares =
          snap.docs.map(
            d => ({
              id: d.id,
              ...d.data()
            })
          );

        renderLocationShares();
      },

      err => {
        console.error(
          'LOCATION SHARES ERROR:',
          err
        );

        const list =
          $('locationSessionsList');

        if (list) {
          list.innerHTML = `
            <div class="location-session-empty">

              <strong>
                לא ניתן לטעון שיתופי מיקום
              </strong>

              <p>
                ${esc(err?.code || err?.message || '')}
              </p>

            </div>
          `;
        }
      }
    );
}

function initLocationShareCreator() {
  const form =
    $('locationShareForm');

  if (
    !form ||
    form.dataset.initialized === '1'
  ) {
    return;
  }

  form.dataset.initialized =
    '1';

  form.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      const name =
        $('locationShareName')
          ?.value
          .trim() || '';

      const phone =
        $('locationSharePhone')
          ?.value
          .trim() || '';

      const digits =
        phoneDigits(phone);

      if (
        digits.length < 9
      ) {
        showToast(
          'יש להזין מספר טלפון תקין',
          'error'
        );

        return;
      }

      const btn =
        $('createLocationShareBtn');

      if (btn) {
        btn.disabled = true;
      }

      try {
        const shareId =
          createSecureShareId();

        const ref =
          doc(
            db,
            'locationShares',
            shareId
          );

        await setDoc(
          ref,
          {
            name,
            phone,
            status:
              'waiting',
            sharing:
              false,
            createdAt:
              serverTimestamp()
          }
        );

        const url =
          locationShareUrl(
            shareId
          );

        const message =
          locationShareMessage(
            name,
            url
          );

        const wa =
          whatsappNumber(phone);

        if (
          $('locationShareUrl')
        ) {
          $('locationShareUrl').value =
            url;
        }

        if (
          $('locationSharePerson')
        ) {
          $('locationSharePerson').textContent =
            name || phone;
        }

        const result =
          $('locationShareResult');

        if (result) {
          result.hidden = false;
        }

        const waBtn =
          $('sendLocationWhatsAppBtn');

        if (waBtn) {
          waBtn.href =
            wa
              ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}`
              : '#';
        }

        const smsBtn =
          $('sendLocationSmsBtn');

        if (smsBtn) {
          smsBtn.href =
            `sms:${phone}?body=${encodeURIComponent(message)}`;
        }

        const openBtn =
          $('openLocationShareBtn');

        if (openBtn) {
          openBtn.dataset.url =
            url;
        }

        showToast(
          'קישור שיתוף המיקום נוצר'
        );

      } catch (err) {
        console.error(
          'CREATE LOCATION SHARE:',
          err
        );

        showToast(
          'לא ניתן ליצור קישור מיקום: ' +
          (
            err?.code ||
            err?.message ||
            ''
          ),
          'error'
        );

      } finally {
        if (btn) {
          btn.disabled = false;
        }
      }
    }
  );

  $('copyLocationShareBtn')
    ?.addEventListener(
      'click',
      async () => {
        const url =
          $('locationShareUrl')
            ?.value || '';

        if (!url) return;

        try {
          await navigator.clipboard.writeText(
            url
          );

          showToast(
            'הקישור הועתק'
          );

        } catch (err) {
          console.warn(
            'COPY GENERATED LOCATION LINK:',
            err
          );

          window.prompt(
            'העתק את הקישור:',
            url
          );
        }
      }
    );

  $('openLocationShareBtn')
    ?.addEventListener(
      'click',
      e => {
        const url =
          e.currentTarget.dataset.url ||
          $('locationShareUrl')?.value;

        if (url) {
          window.open(
            url,
            '_blank',
            'noopener,noreferrer'
          );
        }
      }
    );
}

search?.addEventListener(
  'input',
  () => {
    renderRequests();
    renderChats();
    renderLocations();
    renderLocationShares();
    renderAmbulanceChecks();
  }
);

// ============================================================
// AMBULANCE CHECKS
// ============================================================

function ambulanceCheckDateText(item) {
  if (item.createdAt?.toDate) {
    const d = item.createdAt.toDate();
    return {
      date: d.toLocaleDateString('he-IL'),
      time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    };
  }

  if (item.createdAtClient) {
    const d = new Date(item.createdAtClient);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toLocaleDateString('he-IL'),
        time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      };
    }
  }

  return { date: '—', time: '—' };
}

function renderAmbulanceChecks() {
  const list = $('ambulanceChecksList');
  if (!list) return;

  const term = (search?.value || '').trim().toLowerCase();
  const filtered = ambulanceChecks.filter(item =>
    [
      item.inspectorName,
      item.ambulanceNumber,
      item.generalNotes,
      ...(Array.isArray(item.items) ? item.items.map(x => x?.name || '') : [])
    ].join(' ').toLowerCase().includes(term)
  );

  if ($('checkTabCount')) {
    $('checkTabCount').textContent = String(ambulanceChecks.length);
  }

  if (!filtered.length) {
    list.innerHTML = '<div class="checks-empty">עדיין לא נשמרו בדיקות אמבולנס.</div>';
    return;
  }

  list.innerHTML = filtered.map(item => {
    const when = ambulanceCheckDateText(item);
    const shortages = Array.isArray(item.items)
      ? item.items.filter(x => x?.shortage)
      : [];
    const statusShortage = Number(item.shortageCount || shortages.length) > 0;

    return `
      <article class="ambulance-check-card">
        <div class="ambulance-check-top">
          <div class="ambulance-check-title">
            <h3>🚑 אמבולנס ${esc(item.ambulanceNumber || '—')}</h3>
            <p>בוצע על ידי <strong>${esc(item.inspectorName || '—')}</strong></p>
          </div>
          <span class="check-history-status ${statusShortage ? 'shortage' : ''}">
            ${statusShortage ? `${Number(item.shortageCount || shortages.length)} חוסרים` : 'תקין ✓'}
          </span>
        </div>

        <div class="ambulance-check-meta">
          <span>📅 ${esc(when.date)}</span>
          <span>🕐 ${esc(when.time)}</span>
          <span>✓ ${Number(item.completedCount || 0)} / ${Number(item.totalItems || 0)} פריטים</span>
          ${item.defibSerial ? `<span>דפיברילטור: ${esc(item.defibSerial)}</span>` : ''}
          ${item.padsExpiry ? `<span>תוקף מדבקות: ${esc(item.padsExpiry)}</span>` : ''}
        </div>

        ${item.generalNotes ? `<div class="ambulance-check-notes">${esc(item.generalNotes)}</div>` : ''}

        ${shortages.length ? `
          <div class="check-shortages">
            ${shortages.map(x => `<span>${esc(x.name)}: ${esc(x.quantity)} / תקן ${esc(x.expected)}</span>`).join('')}
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function loadAmbulanceChecks() {
  if (unsubAmbulanceChecks) return;

  unsubAmbulanceChecks = onSnapshot(
    query(collection(db, 'ambulanceChecks'), orderBy('createdAt', 'desc')),
    snap => {
      ambulanceChecks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAmbulanceChecks();
    },
    err => {
      console.error('AMBULANCE CHECKS ERROR:', err);
      const list = $('ambulanceChecksList');
      if (list) {
        list.innerHTML = `<div class="checks-empty">לא ניתן לטעון בדיקות אמבולנס: ${esc(err?.code || err?.message || '')}</div>`;
      }
    }
  );
}


// ============================================================
// PRODUCTS MANAGER
// ============================================================

function productEsc(v = '') {
  return esc(v);
}

function resetProductForm() {
  const form = $('productAdminForm');
  form?.reset();
  if ($('productEditId')) $('productEditId').value = '';
  if ($('productOrder')) $('productOrder').value = '100';
  if ($('productActive')) $('productActive').checked = true;
  if ($('saveProductBtn')) $('saveProductBtn').textContent = '+ הוספת מוצר';
  if ($('cancelProductEditBtn')) $('cancelProductEditBtn').hidden = true;
  if ($('productImage1Status')) $('productImage1Status').textContent = 'חובה במוצר חדש';
  if ($('productImage2Status')) $('productImage2Status').textContent = 'אופציונלי';
}

async function uploadProductImage(file, productId, slot) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('יש לבחור קובץ תמונה בלבד');
  if (file.size > 12 * 1024 * 1024) throw new Error('גודל כל תמונה חייב להיות עד 12MB');

  // Compress and save the image directly in the Firestore product document.
  // No Firebase Storage upload is needed, so Storage permission/bucket errors cannot block saving.
  const MAX_SIDE = 1200;
  const TARGET_BYTES = 180 * 1024;

  const readAsDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('IMAGE_READ_FAILED'));
    reader.readAsDataURL(blob);
  });

  const original = await readAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    el.src = original;
  });

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.84;
  let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  while (blob && blob.size > TARGET_BYTES && quality > 0.44) {
    quality -= 0.08;
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  if (!blob) throw new Error('לא ניתן לעבד את התמונה');
  if (blob.size > 260 * 1024) throw new Error('התמונה גדולה מדי גם לאחר דחיסה. נסה תמונה קטנה יותר.');

  return await readAsDataURL(blob);
}

async function safeDeleteProductImage(url) {
  if (!url || !String(url).includes('firebasestorage')) return;
  try {
    await deleteObject(storageRef(storage, url));
  } catch (err) {
    console.warn('DELETE PRODUCT IMAGE:', err);
  }
}

function renderAdminProducts() {
  const list = $('adminProductsList');
  if (!list) return;
  if ($('productTabCount')) $('productTabCount').textContent = String(adminProducts.length);

  if (!adminProducts.length) {
    list.innerHTML = '<div class="products-empty">עדיין לא נוספו מוצרים דרך לוח הניהול.</div>';
    return;
  }

  list.innerHTML = adminProducts.map(item => `
    <article class="admin-product-card">
      <div class="admin-product-images">
        ${item.image1 ? `<img src="${productEsc(item.image1)}" alt="">` : '<div></div>'}
        ${item.image2 ? `<img src="${productEsc(item.image2)}" alt="">` : '<div></div>'}
      </div>
      <div class="admin-product-copy">
        <h3>${productEsc(item.nameHe || item.nameAr || item.nameEn || 'מוצר')}</h3>
        <p>${productEsc(item.descHe || item.descAr || item.descEn || '')}</p>
        <div class="admin-product-meta">
          ${item.price ? `<span>${productEsc(item.price)}</span>` : ''}
          <span>סדר: ${Number(item.order || 0)}</span>
          <span class="${item.active !== false ? 'on' : 'off'}">${item.active !== false ? 'פעיל באתר' : 'מוסתר'}</span>
        </div>
      </div>
      <div class="admin-product-actions">
        <button type="button" data-product-edit="${productEsc(item.id)}">עריכה</button>
        <button type="button" data-product-toggle="${productEsc(item.id)}">${item.active !== false ? 'השבתה' : 'הפעלה'}</button>
        <button type="button" class="danger" data-product-delete="${productEsc(item.id)}">מחיקה</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-product-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = adminProducts.find(x => x.id === btn.dataset.productEdit);
      if (!item) return;
      activateTab('products');
      $('productEditId').value = item.id;
      $('productNameHe').value = item.nameHe || '';
      $('productNameAr').value = item.nameAr || '';
      $('productNameEn').value = item.nameEn || '';
      $('productDescHe').value = item.descHe || '';
      $('productDescAr').value = item.descAr || '';
      $('productDescEn').value = item.descEn || '';
      $('productPrice').value = item.price || '';
      $('productOrder').value = Number(item.order ?? 100);
      $('productItems').value = Array.isArray(item.items) ? item.items.join('\n') : '';
      $('productActive').checked = item.active !== false;
      $('saveProductBtn').textContent = 'שמירת שינויים';
      $('cancelProductEditBtn').hidden = false;
      $('productImage1Status').textContent = item.image1 ? 'קיימת תמונה — בחר חדשה רק להחלפה' : 'אין תמונה';
      $('productImage2Status').textContent = item.image2 ? 'קיימת תמונה — בחר חדשה רק להחלפה' : 'אין תמונה';
      $('productNameHe').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('productNameHe').focus();
    });
  });

  list.querySelectorAll('[data-product-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = adminProducts.find(x => x.id === btn.dataset.productToggle);
      if (!item) return;
      try {
        await updateDoc(doc(db, 'products', item.id), {
          active: item.active === false,
          updatedAt: serverTimestamp()
        });
        showToast(item.active === false ? 'המוצר הופעל' : 'המוצר הושבת');
      } catch (err) {
        console.error(err);
        showToast('לא ניתן לשנות את סטטוס המוצר', 'error');
      }
    });
  });

  list.querySelectorAll('[data-product-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = adminProducts.find(x => x.id === btn.dataset.productDelete);
      if (!item || !confirm(`למחוק את המוצר "${item.nameHe || 'מוצר'}"?`)) return;
      btn.disabled = true;
      try {
        await deleteDoc(doc(db, 'products', item.id));
        await Promise.all([safeDeleteProductImage(item.image1), safeDeleteProductImage(item.image2)]);
        if ($('productEditId')?.value === item.id) resetProductForm();
        showToast('המוצר נמחק');
      } catch (err) {
        console.error('DELETE PRODUCT:', err);
        showToast('לא ניתן למחוק את המוצר', 'error');
        btn.disabled = false;
      }
    });
  });
}

function loadAdminProducts() {
  if (unsubProducts) return;
  unsubProducts = onSnapshot(collection(db, 'products'), snap => {
    adminProducts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const oa = Number(a.order ?? 100), ob = Number(b.order ?? 100);
      if (oa !== ob) return oa - ob;
      const at = a.createdAt?.toMillis?.() || 0, bt = b.createdAt?.toMillis?.() || 0;
      return bt - at;
    });
    renderAdminProducts();
  }, err => {
    console.error('PRODUCTS ADMIN ERROR:', err);
    if ($('adminProductsList')) $('adminProductsList').innerHTML = `<div class="products-empty">לא ניתן לטעון מוצרים: ${productEsc(err?.code || err?.message || '')}</div>`;
  });
}

$('productAdminForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const editId = $('productEditId').value.trim();
  const old = editId ? adminProducts.find(x => x.id === editId) : null;
  const file1 = $('productImage1').files?.[0] || null;
  const file2 = $('productImage2').files?.[0] || null;
  if (!editId && !file1) return showToast('יש לבחור לפחות תמונה ראשונה למוצר חדש', 'error');

  const saveBtn = $('saveProductBtn');
  const progress = $('productUploadProgress');
  saveBtn.disabled = true;
  progress.hidden = false;

  const productId = editId || doc(collection(db, 'products')).id;
  let image1 = old?.image1 || '';
  let image2 = old?.image2 || '';
  try {
    if (file1) image1 = await uploadProductImage(file1, productId, 'image1');
    if (file2) image2 = await uploadProductImage(file2, productId, 'image2');

    const data = {
      nameHe: $('productNameHe').value.trim(),
      nameAr: $('productNameAr').value.trim(),
      nameEn: $('productNameEn').value.trim(),
      descHe: $('productDescHe').value.trim(),
      descAr: $('productDescAr').value.trim(),
      descEn: $('productDescEn').value.trim(),
      price: $('productPrice').value.trim(),
      order: Number($('productOrder').value || 100),
      items: $('productItems').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30),
      image1,
      image2,
      active: $('productActive').checked,
      updatedAt: serverTimestamp()
    };

    if (editId) {
      await updateDoc(doc(db, 'products', productId), data);
      if (file1 && old?.image1 && old.image1 !== image1) await safeDeleteProductImage(old.image1);
      if (file2 && old?.image2 && old.image2 !== image2) await safeDeleteProductImage(old.image2);
      showToast('המוצר עודכן בהצלחה');
    } else {
      await setDoc(doc(db, 'products', productId), { ...data, createdAt: serverTimestamp() });
      showToast('המוצר נוסף לעמוד המכירה');
    }
    resetProductForm();
  } catch (err) {
    console.error('SAVE PRODUCT:', err);
    showToast(err?.message || 'לא ניתן לשמור את המוצר', 'error');
  } finally {
    saveBtn.disabled = false;
    progress.hidden = true;
  }
});

$('cancelProductEditBtn')?.addEventListener('click', resetProductForm);


// ===== Donation requests =====
function donationEsc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function donationDate(ts){try{return ts?.toDate?.().toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})||'';}catch{return '';}}
function renderAdminDonations(){
  const list=$('adminDonationsList'); if(!list) return;
  const total=adminDonations.reduce((sum,x)=>sum+Number(x.amount||0),0);
  if($('donationTabCount')) $('donationTabCount').textContent=String(adminDonations.length);
  if($('donationsTotalCount')) $('donationsTotalCount').textContent=String(adminDonations.length);
  if($('donationsNewCount')) $('donationsNewCount').textContent=String(adminDonations.filter(x=>(x.status||'new')==='new').length);
  if($('donationsTotalAmount')) $('donationsTotalAmount').textContent=total.toLocaleString('he-IL')+'₪';
  if(!adminDonations.length){list.innerHTML='<div class="donations-empty">עדיין לא התקבלו בקשות תרומה.</div>';return;}
  list.innerHTML=adminDonations.map(x=>{
    const phone=donationEsc(x.phone||''); const wa=String(x.phone||'').replace(/\D/g,'').replace(/^0/,'972');
    return `<article class="admin-donation-card" data-id="${donationEsc(x.id)}">
      <div class="admin-donation-amount"><small>סכום</small><strong>${Number(x.amount||0).toLocaleString('he-IL')}₪</strong><span>${donationEsc(x.currency||'ILS')}</span></div>
      <div class="admin-donation-copy"><div class="admin-donation-title"><h3>${x.anonymous?'תורם אנונימי':donationEsc(x.name||'ללא שם')}</h3><span>${donationDate(x.createdAt)}</span></div><p>${phone}${x.email?' · '+donationEsc(x.email):''}</p>${x.note?`<blockquote>${donationEsc(x.note)}</blockquote>`:''}</div>
      <div class="admin-donation-actions"><select data-donation-status><option value="new" ${(x.status||'new')==='new'?'selected':''}>חדש</option><option value="contacted" ${x.status==='contacted'?'selected':''}>נוצר קשר</option><option value="completed" ${x.status==='completed'?'selected':''}>הושלם</option><option value="cancelled" ${x.status==='cancelled'?'selected':''}>בוטל</option></select><div><a href="tel:${phone}">☎ חיוג</a><a href="https://wa.me/${wa}" target="_blank" rel="noopener">WA</a><button type="button" data-delete-donation>מחיקה</button></div></div>
    </article>`;
  }).join('');
  list.querySelectorAll('[data-donation-status]').forEach(sel=>sel.addEventListener('change',async()=>{const id=sel.closest('[data-id]')?.dataset.id;if(!id)return;try{await updateDoc(doc(db,'donations',id),{status:sel.value,updatedAt:serverTimestamp()});showToast('סטטוס התרומה עודכן');}catch(e){console.error(e);showToast('לא ניתן לעדכן סטטוס','error');}}));
  list.querySelectorAll('[data-delete-donation]').forEach(btn=>btn.addEventListener('click',async()=>{const id=btn.closest('[data-id]')?.dataset.id;if(!id)return;btn.disabled=true;try{await deleteDoc(doc(db,'donations',id));showToast('בקשת התרומה נמחקה');}catch(e){console.error(e);showToast('לא ניתן למחוק','error');btn.disabled=false;}}));
}
function loadAdminDonations(){
  if(unsubDonations) return;
  unsubDonations=onSnapshot(query(collection(db,'donations'),orderBy('createdAt','desc')),snap=>{adminDonations=snap.docs.map(d=>({id:d.id,...d.data()}));renderAdminDonations();},err=>{console.error('DONATIONS ADMIN ERROR',err);if($('adminDonationsList')) $('adminDonationsList').innerHTML=`<div class="donations-empty">לא ניתן לטעון תרומות: ${donationEsc(err?.code||err?.message||'')}</div>`;});
}
