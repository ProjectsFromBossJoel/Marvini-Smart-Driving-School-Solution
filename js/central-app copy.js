// js/central-app.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, serverTimestamp, query, where, orderBy, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA5TnyzHJpcHcM2N-77gkyAaj7yRru3-V0",
  authDomain: "marvini-smart-driving-school.firebaseapp.com",
  projectId: "marvini-smart-driving-school",
  storageBucket: "marvini-smart-driving-school.firebasestorage.app",
  messagingSenderId: "750557352716",
  appId: "1:750557352716:web:dcae14b3dacaea88a4ef29",
  measurementId: "G-RHRMJLDLDK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const schoolsCol = collection(db, "schools");

// ── Cloudinary (reusing Marvini's existing cloud) ──
const CLOUDINARY_CLOUD = "drs2xpwho";
// ── Manual password reset — Vercel function backed by Firebase Admin SDK ──
const MANUAL_PASSWORD_RESET_API = "https://marvini-smart-driving-school-solution.vercel.app/api/manual-reset-password";
// NOTE: create this UNSIGNED upload preset in the Cloudinary console before
// school image uploads will work: Settings > Upload > Add upload preset,
// name it exactly "school_images_upload", signing mode = Unsigned.
const SCHOOL_IMAGE_PRESET = "school_images_upload";
// Lessons/quizzes are global (not per-school) — reuse the same presets Dekay's
// own admin already uses on this Cloudinary cloud, no new preset needed.
const LESSON_UPLOAD_PRESET = "lesson_videos_upload";
const QUIZ_IMAGE_PRESET = "quiz_images_upload";

function escapeHtml(str){ return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
window.escapeHtml = escapeHtml;

// Renders a 34px round avatar from a photo URL, or initials if none is set.
function avatarHtml(photoUrl, firstName, lastName, size){
  size = size || 34;
  const initials = ((firstName||'')[0] || '') + ((lastName||'')[0] || '') || '?';
  if (photoUrl) {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background-image:url(${photoUrl});background-size:cover;background-position:center;border:1.5px solid var(--amber);flex-shrink:0;"></div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(242,169,59,0.15);border:1.5px solid var(--amber);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.38)}px;font-weight:700;color:var(--amber);flex-shrink:0;">${escapeHtml(initials)}</div>`;
}
window.avatarHtml = avatarHtml;

// ── SCHOOL VISIBILITY CHECKLIST (shared by lesson folders & quiz categories) ──
function renderSchoolsChecklist(containerId, selectedIds){
  const container = document.getElementById(containerId);
  if (!container) return;
  const searchEl = document.getElementById(containerId.replace('SchoolsList', 'SchoolsSearch'));
  if (searchEl) searchEl.value = '';
  const ids = selectedIds || [];
  if (!allSchools.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--slate-dim);">No schools found.</div>';
    return;
  }
  container.innerHTML = allSchools.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
      <input type="checkbox" value="${s.id}" class="school-visibility-check" ${ids.includes(s.id) ? 'checked' : ''} style="accent-color:var(--amber);width:15px;height:15px;">
      <span style="font-size:13px;">${escapeHtml(s.name)}</span>
    </label>`).join('');
}
window.renderSchoolsChecklist = renderSchoolsChecklist;

window.toggleAllSchoolsCheck = function(containerId){
  const container = document.getElementById(containerId);
  if (!container) return;
  const boxes = container.querySelectorAll('.school-visibility-check:not([style*="display: none"])');
  const visibleBoxes = Array.from(boxes).filter(cb => cb.closest('label').style.display !== 'none');
  const allChecked = visibleBoxes.every(cb => cb.checked);
  visibleBoxes.forEach(cb => { cb.checked = !allChecked; });
};

window.filterSchoolsChecklist = function(inputEl, containerId){
  const term = inputEl.value.trim().toLowerCase();
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('label').forEach(label => {
    const name = label.querySelector('span')?.textContent.toLowerCase() || '';
    label.style.display = !term || name.includes(term) ? 'flex' : 'none';
  });
};

function getCheckedSchoolIds(containerId){
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.school-visibility-check:checked')).map(cb => cb.value);
}

async function updateTopbarUser(user){
  const wrap = document.getElementById('topbarUser');
  const nameEl = document.getElementById('topbarUserName');
  const avatarImg = document.getElementById('topbarUserAvatar');
  const initialsEl = document.getElementById('topbarUserInitials');
  if (!user) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  let name = user.email || 'Admin';
  let photoUrl = null;
  try {
    const snap = await getDoc(doc(db, "portalAdmins", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.name) name = data.name;
      photoUrl = data.photoUrl || null;
    }
  } catch(e) { /* non-fatal — fall back to email / initials */ }
  nameEl.textContent = name;
  if (photoUrl) {
    avatarImg.src = photoUrl;
    avatarImg.style.display = 'block';
    initialsEl.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    initialsEl.style.display = 'flex';
    const initials = name.trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase() || '?';
    initialsEl.textContent = initials;
  }
}
window.updateTopbarUser = updateTopbarUser;

// ============================================================
// DASHBOARD HERO — greeting, weather (Open-Meteo, no key needed), tip
// ============================================================
function renderDashGreeting(){
  const greetEl = document.getElementById('dashGreeting');
  const dateEl = document.getElementById('dashDate');
  if (!greetEl || !dateEl) return;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';
  const nameEl = document.getElementById('topbarUserName');
  const firstName = (nameEl && nameEl.textContent && nameEl.textContent !== '—') ? nameEl.textContent.split(' ')[0] : '';
  greetEl.textContent = firstName ? `${greeting}, ${firstName} 👋` : `${greeting} 👋`;
  dateEl.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const WMO_WEATHER = {
  0: ['sun', 'Clear sky'], 1: ['partlycloudy', 'Mostly clear'], 2: ['partlycloudy', 'Partly cloudy'], 3: ['cloudy', 'Overcast'],
  45: ['fog', 'Foggy'], 48: ['fog', 'Foggy'],
  51: ['rain', 'Light drizzle'], 53: ['rain', 'Drizzle'], 55: ['rain', 'Heavy drizzle'],
  61: ['rain', 'Light rain'], 63: ['rain', 'Rain'], 65: ['heavyrain', 'Heavy rain'],
  80: ['heavyrain', 'Rain showers'], 81: ['heavyrain', 'Rain showers'], 82: ['heavyrain', 'Violent showers'],
  95: ['thunder', 'Thunderstorm'], 96: ['thunder', 'Thunderstorm'], 99: ['thunder', 'Thunderstorm']
};

// Small colored SVG weather icons (Google-Weather-ish: warm sun, soft cloud, blue rain, yellow bolt)
function weatherIconSvg(type){
  const sun = `<circle cx="32" cy="32" r="15" fill="url(#wSun)"/>
    <g stroke="#FFB300" stroke-width="3" stroke-linecap="round">
      <line x1="32" y1="4" x2="32" y2="12"/><line x1="32" y1="52" x2="32" y2="60"/>
      <line x1="4" y1="32" x2="12" y2="32"/><line x1="52" y1="32" x2="60" y2="32"/>
      <line x1="12.7" y1="12.7" x2="18.3" y2="18.3"/><line x1="45.7" y1="45.7" x2="51.3" y2="51.3"/>
      <line x1="12.7" y1="51.3" x2="18.3" y2="45.7"/><line x1="45.7" y1="18.3" x2="51.3" y2="12.7"/>
    </g>`;
  const cloud = (cx, cy, scale) => `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="url(#wCloud)">
      <circle cx="24" cy="34" r="12"/><circle cx="36" cy="28" r="15"/><circle cx="46" cy="36" r="10"/>
      <rect x="16" y="34" width="40" height="16" rx="8"/>
    </g>`;
  const drop = (x, y) => `<path d="M${x} ${y} c3 4 5 6.5 5 9a5 5 0 1 1-10 0c0-2.5 2-5 5-9z" fill="#4FC3F7"/>`;
  const bolt = `<path d="M35 40 L26 54 L32 54 L28 66 L42 48 L35 48 Z" fill="#FFC107" transform="translate(0,-8)"/>`;

  const defs = `<defs>
      <radialGradient id="wSun" cx="35%" cy="35%" r="65%"><stop offset="0%" stop-color="#FFD54F"/><stop offset="100%" stop-color="#FFA000"/></radialGradient>
      <linearGradient id="wCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F7F9FA"/><stop offset="100%" stop-color="#CFD8DC"/></linearGradient>
    </defs>`;

  let body = '';
  switch(type){
    case 'sun': body = sun; break;
    case 'partlycloudy': body = `<g transform="translate(-6,-8) scale(0.72)">${sun}</g>${cloud(4,10,0.72)}`; break;
    case 'cloudy': body = cloud(0,0,1); break;
    case 'fog': body = `${cloud(0,-6,0.85)}<g stroke="#B0BEC5" stroke-width="3" stroke-linecap="round">
        <line x1="12" y1="46" x2="52" y2="46"/><line x1="16" y1="54" x2="48" y2="54"/></g>`; break;
    case 'rain': body = `${cloud(0,-8,0.85)}${drop(22,44)}${drop(34,48)}${drop(44,44)}`; break;
    case 'heavyrain': body = `${cloud(0,-10,0.85)}${drop(16,42)}${drop(26,48)}${drop(36,42)}${drop(46,48)}`; break;
    case 'thunder': body = `${cloud(0,-10,0.85)}${bolt}`; break;
    default: body = sun;
  }
  return `<svg viewBox="0 0 64 64" width="100%" height="100%">${defs}${body}</svg>`;
}

async function renderDashWeather(){
  const iconEl = document.getElementById('dashWeatherIcon');
  const tempEl = document.getElementById('dashWeatherTemp');
  const descEl = document.getElementById('dashWeatherDesc');
  if (!tempEl) return;
  try {
    // Accra, Ghana coordinates — no API key required for Open-Meteo.
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=5.6037&longitude=-0.1870&current=temperature_2m,weather_code&timezone=Africa%2FAccra');
    const data = await res.json();
    const temp = Math.round(data?.current?.temperature_2m);
    const code = data?.current?.weather_code;
    const [icon, desc] = WMO_WEATHER[code] || ['partlycloudy', 'Weather unavailable'];
    tempEl.textContent = isNaN(temp) ? '--°' : `${temp}°C`;
    descEl.textContent = desc;
    iconEl.innerHTML = weatherIconSvg(icon);
  } catch(e) {
    descEl.textContent = 'Weather unavailable';
  }
}

const DASH_TIPS = [
  "Remind instructors to log attendance right after each session — it keeps completion stats accurate for every school.",
  "Encourage schools to keep their student photos up to date; it helps instructors verify identity on test day.",
  "A quick weekly check of pending approvals keeps new students and instructors from waiting too long.",
  "Schools with a filled-in bio and cover photo tend to get more enquiries from the public site.",
  "Remind instructors that defensive driving habits are best taught early — Stage 1 sets the tone.",
  "Enquiries marked 'New' for more than 48 hours are worth a nudge to the school — quick replies convert better.",
  "Keeping vehicle maintenance notes current avoids double-booking a car that's actually in the shop.",
  "A short WhatsApp follow-up after a road test can turn a good student experience into a referral."
];
let dashTipRotateTimer = null;
let dashTipIndex = Math.floor(Date.now() / 86400000) % DASH_TIPS.length;
function renderDashTip(){
  const tipEl = document.getElementById('dashTipText');
  if (!tipEl) return;
  tipEl.textContent = DASH_TIPS[dashTipIndex];
  if (dashTipRotateTimer) clearInterval(dashTipRotateTimer);
  dashTipRotateTimer = setInterval(() => {
    const el = document.getElementById('dashTipText');
    if (!el) { clearInterval(dashTipRotateTimer); dashTipRotateTimer = null; return; }
    dashTipIndex = (dashTipIndex + 1) % DASH_TIPS.length;
    el.textContent = DASH_TIPS[dashTipIndex];
  }, 9000);
}

function renderDashboardHero(){
  renderDashGreeting();
  renderDashWeather();
  renderDashTip();
}
window.renderDashboardHero = renderDashboardHero;

function fmtDate(ts){
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}


// ── Generic button-loading helper: disables + spins while an async action runs ──
function withBtnLoading(btn, fn){
  if (!btn) return Promise.resolve(fn());
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  return Promise.resolve(fn()).finally(() => {
    btn.disabled = false;
    btn.innerHTML = original;
  });
}
window.withBtnLoading = withBtnLoading;

let toastTimer = null;
function showToast(message, isError){
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
window.showToast = showToast;

function openModal(id){ const el = document.getElementById(id); if (el) el.classList.add('show'); }
function closeModal(id){ const el = document.getElementById(id); if (el) el.classList.remove('show'); }
window.openModal = openModal;
window.closeModal = closeModal;

let confirmResolve = null;
function showConfirm(title, msg){
  return new Promise((resolve) => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    confirmResolve = resolve;
    openModal('confirmModal');
  });
}
document.getElementById('confirmOkBtn').addEventListener('click', () => {
  closeModal('confirmModal');
  if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
});
document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target.id === 'confirmModal') {
    closeModal('confirmModal');
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  }
});

// ============================================================
// AUTH
// ============================================================
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('app');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginSubmit = document.getElementById('loginSubmit');
const adminEmailEl = document.getElementById('adminEmail');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Signing in…';
  try {
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
  } catch (err) {
    loginError.textContent = 'Could not sign in. Check the email and password and try again.';
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
  }
});
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

let unsubscribeSchools = null;
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Central dashboard is superAdmin-only — school-scoped "admin" accounts
    // (like admin@test.com, which carries Dekay's schoolId) must be rejected here.
    let role = null;
    try {
      const userDocSnap = await getDoc(doc(db, 'users', user.uid));
      role = userDocSnap.exists() ? userDocSnap.data().role : null;
    } catch (err) {
      role = null;
    }

    if (role !== 'superAdmin') {
      loginError.textContent = 'This portal is restricted to super admin accounts.';
      await signOut(auth);
      return;
    }

    loginScreen.style.display = 'none';
    appShell.classList.add('show');
    adminEmailEl.textContent = user.email;
    updateTopbarUser(user).then(renderDashboardHero);
    if (!unsubscribeSchools) startSchoolsListener();
  } else {
    appShell.classList.remove('show');
    loginScreen.style.display = 'flex';
    if (unsubscribeSchools) { unsubscribeSchools(); unsubscribeSchools = null; }
  }
});

// ============================================================
// TOP-LEVEL NAVIGATION
// ============================================================
const PAGE_META = {
  dashboard:    { title: 'Dashboard', sub: 'Overview of every driving school on the portal' },
  schools:      { title: 'Schools', sub: 'Click a school to manage everything about it' },
  reports:      { title: 'Reports', sub: 'How schools are distributed across Ghana' },
  lessons:      { title: 'Video Lessons', sub: 'Manage platform-wide video lessons (shared across all schools).' },
  quizzes:      { title: 'Quizzes', sub: 'Manage platform-wide quizzes and questions (shared across all schools).' },
  profile:      { title: 'My Profile', sub: 'Your personal admin profile' },
  siteSettings: { title: 'Site Settings', sub: 'Edit the content shown on the public landing page' },
  pmgmBio:      { title: 'PM/GM Bio', sub: 'Edit the PM/GM leadership bio card shown on the landing page' }
};

let currentSchoolId = null; // null = at top level

window.showPage = function(pageName, navLinkElement){
  currentSchoolId = null;
  document.getElementById('navTopLevel').style.display = 'flex';
  document.getElementById('navTopLevel').style.flexDirection = 'column';
  document.getElementById('navSchoolScope').style.display = 'none';
  document.getElementById('breadcrumb').style.display = 'none';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageName}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('#navTopLevel .nav-link').forEach(l => l.classList.remove('active'));
  const link = navLinkElement || document.querySelector(`#navTopLevel .nav-link[data-page="${pageName}"]`);
  if (link) link.classList.add('active');

  const meta = PAGE_META[pageName];
  if (meta) { document.getElementById('pageTitle').textContent = meta.title; document.getElementById('pageSubtitle').textContent = meta.sub; }

  if (pageName === 'dashboard') renderDashboardHero();
  if (pageName === 'lessons') loadLessons();
  if (pageName === 'quizzes') loadQuizzes();
  if (pageName === 'profile') loadMyProfile();
  if (pageName === 'siteSettings') loadSiteSettings();
  if (pageName === 'pmgmBio') loadPmgmBio();
};

document.querySelectorAll('#navTopLevel .nav-link[data-page]').forEach(link => {
  link.addEventListener('click', () => window.showPage(link.dataset.page, link));
});

// ============================================================
// SCHOOLS — CARD GRID
// ============================================================
let allSchools = [];

function startSchoolsListener(){
  const q = query(schoolsCol, orderBy('createdAt', 'desc'));
  unsubscribeSchools = onSnapshot(q, (snap) => {
    allSchools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderSchoolGrid(document.getElementById('schoolSearch').value);
    renderReports();
    if (currentSchoolId) renderSchoolDetailOverview(); // keep detail view fresh if open
    updatePmgmLiveStats();
  }, (err) => showToast('Could not load schools: ' + err.message, true));
}

function renderDashboard(){
  document.getElementById('statTotal').textContent = allSchools.length;
  const regions = new Set(allSchools.map(s => s.region).filter(Boolean));
  document.getElementById('statRegions').textContent = regions.size;
  const recentTableBody = document.getElementById('recentTableBody');

  if (!allSchools.length){
    document.getElementById('statRecent').textContent = '—';
    document.getElementById('statRecentSub').textContent = 'No schools yet';
    recentTableBody.innerHTML = `<tr class="empty-row"><td colspan="4">No schools yet. Add your first one from the Schools page.</td></tr>`;
    return;
  }
  const newest = allSchools[0];
  document.getElementById('statRecent').textContent = newest.name;
  document.getElementById('statRecentSub').textContent = `Added ${fmtDate(newest.createdAt)}`;

  recentTableBody.innerHTML = allSchools.slice(0,5).map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td><span class="badge">${escapeHtml(s.region || '—')}</span></td>
      <td style="font-size:12px;">${s.email ? escapeHtml(s.email) : (s.phone1 ? escapeHtml(s.phone1) : '—')}</td>
      <td><a class="site-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url || '')}</a></td>
    </tr>`).join('');
}

function renderReports(){
  const reportBars = document.getElementById('reportBars');
  if (!allSchools.length){ reportBars.innerHTML = `<div style="padding:20px;color:var(--slate-dim);">No schools yet.</div>`; return; }
  const counts = {};
  allSchools.forEach(s => { const r = s.region || 'Unspecified'; counts[r] = (counts[r]||0)+1; });
  const max = Math.max(...Object.values(counts));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  reportBars.innerHTML = sorted.map(([region,count]) => `
    <div style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid var(--border);">
      <div style="width:140px;flex-shrink:0;font-size:13px;">${escapeHtml(region)}</div>
      <div style="flex:1;height:10px;border-radius:6px;background:var(--asphalt-deep);overflow:hidden;"><div style="height:100%;background:var(--amber);border-radius:6px;width:${(count/max*100).toFixed(0)}%"></div></div>
      <div style="width:34px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--slate);">${count}</div>
    </div>`).join('');
}

function renderSchoolGrid(filterTerm){
  const grid = document.getElementById('schoolGrid');
  const term = (filterTerm || '').trim().toLowerCase();
  const filtered = allSchools.filter(s => (s.name||'').toLowerCase().includes(term) || (s.region||'').toLowerCase().includes(term));

  let html = filtered.map(s => {
    const cover = s.imageUrl ? `background-image:url(${s.imageUrl});` : '';
    const statusClass = (s.status === 'inactive') ? 'inactive' : '';
    return `
    <div class="school-card" onclick="window.openSchoolDetail('${s.id}')">
      <button class="edit-fab" title="Quick edit" onclick="event.stopPropagation();window.openSchoolModalById('${s.id}')"><i class="fas fa-pen" style="font-size:12px;"></i></button>
      <div class="cover" style="${cover}">
        ${!s.imageUrl ? '<i class="fas fa-school"></i>' : ''}
        <div class="status-dot ${statusClass}" title="${statusClass ? 'Inactive' : 'Active'}"></div>
      </div>
      <div class="body">
        <p class="name">${escapeHtml(s.name)}</p>
        <p class="region"><i class="fas fa-map-marker-alt" style="margin-right:4px;color:var(--slate-dim);"></i>${escapeHtml(s.region || '—')}</p>
        <div class="mini-stats">
          <div class="mini-stat"><b>${s._studentCount ?? '—'}</b><span>Students</span></div>
          <div class="mini-stat"><b>${s._instructorCount ?? '—'}</b><span>Instructors</span></div>
        </div>
      </div>
    </div>`;
  }).join('');

  html += `<div class="add-school-card" onclick="document.getElementById('openAddModal').click()"><i class="fas fa-plus"></i><span>Add a driving school</span></div>`;
  grid.innerHTML = html;

  // Lazy-load live counts per card (kept light: one query per school, cached on the object)
  filtered.forEach(s => hydrateSchoolCardCounts(s));
}

async function hydrateSchoolCardCounts(school){
  try {
    const [studSnap, instrSnap] = await Promise.all([
      getDocs(query(collection(db, "students"), where("schoolId", "==", school.id))),
      getDocs(query(collection(db, "instructors"), where("schoolId", "==", school.id)))
    ]);
    school._studentCount = studSnap.size;
    school._instructorCount = instrSnap.size;
    // Patch just this card's numbers in place rather than re-rendering the whole grid
    document.querySelectorAll('.school-card').forEach(card => {
      if (card.getAttribute('onclick')?.includes(`'${school.id}'`)) {
        const stats = card.querySelectorAll('.mini-stat b');
        if (stats[0]) stats[0].textContent = school._studentCount;
        if (stats[1]) stats[1].textContent = school._instructorCount;
      }
    });
  } catch(e) { /* non-fatal — counts just stay as — */ }
}

document.getElementById('schoolSearch').addEventListener('input', (e) => renderSchoolGrid(e.target.value));

// ── Add/Edit school modal ──
const overlay = document.getElementById('schoolOverlay');
const schoolForm = document.getElementById('schoolForm');
const modalTitle = document.getElementById('modalTitle');
const formError = document.getElementById('formError');
const schoolIdInput = document.getElementById('schoolId');
const schoolNameInput = document.getElementById('schoolName');
const schoolRegionInput = document.getElementById('schoolRegion');
const schoolUrlInput = document.getElementById('schoolUrl');
const schoolEmailInput = document.getElementById('schoolEmail');
const schoolPhone1Input = document.getElementById('schoolPhone1');
const schoolPhone2Input = document.getElementById('schoolPhone2');
const schoolStatusInput = document.getElementById('schoolStatus');
const schoolImgFile = document.getElementById('schoolImgFile');
const schoolImgPreview = document.getElementById('schoolImgPreview');
const schoolImgText = document.getElementById('schoolImgText');
let pendingSchoolImageUrl = null;

schoolImgFile.addEventListener('change', () => {
  const file = schoolImgFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => { schoolImgPreview.src = e.target.result; schoolImgPreview.style.display = 'block'; schoolImgText.textContent = file.name; };
  reader.readAsDataURL(file);
});

function openSchoolModal(school){
  formError.textContent = '';
  schoolForm.reset();
  pendingSchoolImageUrl = school?.imageUrl || null;
  schoolImgPreview.style.display = school?.imageUrl ? 'block' : 'none';
  if (school?.imageUrl) schoolImgPreview.src = school.imageUrl;
  schoolImgText.textContent = school?.imageUrl ? 'Tap to change image' : 'Tap to upload a school logo / cover photo';

  if (school) {
    modalTitle.textContent = 'Edit driving school';
    schoolIdInput.value = school.id;
    schoolNameInput.value = school.name || '';
    schoolRegionInput.value = school.region || '';
    schoolEmailInput.value = school.email || '';
    schoolPhone1Input.value = school.phone1 || '';
    schoolPhone2Input.value = school.phone2 || '';
    schoolUrlInput.value = school.url || '';
    schoolStatusInput.value = school.status || 'active';
  } else {
    modalTitle.textContent = 'Add driving school';
    schoolIdInput.value = '';
    schoolStatusInput.value = 'active';
  }
  openModal('schoolOverlay');
  schoolNameInput.focus();
}
window.openSchoolModalById = (id) => openSchoolModal(allSchools.find(s => s.id === id));
window.openSchoolEditFromDetail = () => openSchoolModal(allSchools.find(s => s.id === currentSchoolId));

document.getElementById('openAddModal').addEventListener('click', () => openSchoolModal(null));
document.getElementById('modalClose').addEventListener('click', () => closeModal('schoolOverlay'));
document.getElementById('modalCancel').addEventListener('click', () => closeModal('schoolOverlay'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal('schoolOverlay'); });

async function uploadSchoolImage(file){
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', SCHOOL_IMAGE_PRESET);
  fd.append('folder', 'schools');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Image upload failed — check that the "school_images_upload" unsigned preset exists in Cloudinary.');
  const data = await res.json();
  return data.secure_url;
}

schoolForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  const name = schoolNameInput.value.trim();
  const region = schoolRegionInput.value;
  const email = schoolEmailInput.value.trim();
  const phone1 = schoolPhone1Input.value.trim();
  const phone2 = schoolPhone2Input.value.trim();
  const status = schoolStatusInput.value;
  let url = schoolUrlInput.value.trim();

  if (!name || !region || !url){ formError.textContent = 'Fill in the school name, region, and website link.'; return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const submitBtn = document.getElementById('modalSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    let imageUrl = pendingSchoolImageUrl;
    const file = schoolImgFile.files[0];
    if (file) {
      submitBtn.textContent = 'Uploading image…';
      imageUrl = await uploadSchoolImage(file);
    }

    const data = { name, region, url, status, email: email || null, phone1: phone1 || null, phone2: phone2 || null };
    if (imageUrl) data.imageUrl = imageUrl;

    const id = schoolIdInput.value;
    submitBtn.textContent = 'Saving…';
    if (id) {
      await updateDoc(doc(db, 'schools', id), data);
      showToast(`Updated ${name}.`);
    } else {
      await addDoc(schoolsCol, { ...data, createdAt: serverTimestamp() });
      showToast(`Added ${name}.`);
    }
    closeModal('schoolOverlay');
  } catch (err) {
    formError.textContent = 'Could not save: ' + err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save school';
  }
});

// ============================================================
// SCHOOL DETAIL SCOPE
// ============================================================
window.openSchoolDetail = function(schoolId){
  currentSchoolId = schoolId;
  const school = allSchools.find(s => s.id === schoolId);
  if (!school) { showToast('School not found.', true); return; }

  document.getElementById('navTopLevel').style.display = 'none';
  document.getElementById('navSchoolScope').style.display = 'flex';
  document.getElementById('navSchoolScope').style.flexDirection = 'column';
  document.getElementById('schoolScopeLabel').textContent = school.name;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-school-detail').classList.add('active');

  showSchoolSubpage('overview');
};

window.backToSchools = function(){
  currentSchoolId = null;
  window.showPage('schools');
};

function showSchoolSubpage(subpage, navEl){
  const school = allSchools.find(s => s.id === currentSchoolId);
  if (!school) return;

  document.querySelectorAll('#navSchoolScope .nav-link[data-school-page]').forEach(l => l.classList.remove('active'));
  const link = navEl || document.querySelector(`#navSchoolScope .nav-link[data-school-page="${subpage}"]`);
  if (link) link.classList.add('active');

  document.querySelectorAll('.school-subpage').forEach(p => p.style.display = 'none');
  const target = document.getElementById(`schoolsub-${subpage}`);
  if (target) target.style.display = 'block';

  const labelMap = {
  overview:'Overview', students:'Students', instructors:'Instructors', courses:'Courses', attendance:'Attendance',
  classes:'Classes', vehicles:'Vehicles', certificates:'Certificates', enquiries:'Enquiries',
  staff:'Staff Management', settings:'School Settings'
};

  document.getElementById('pageTitle').textContent = `${school.name} — ${labelMap[subpage] || subpage}`;
  document.getElementById('pageSubtitle').textContent = `Managing ${labelMap[subpage]?.toLowerCase() || subpage} for this school only.`;

  const bc = document.getElementById('breadcrumb');
  bc.style.display = 'block';
  bc.innerHTML = `<span class="crumb-link" onclick="window.backToSchools()">Schools</span> <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> <span class="crumb-current">${escapeHtml(school.name)} · ${labelMap[subpage] || subpage}</span>`;

  if (subpage === 'overview') renderSchoolDetailOverview();
  if (subpage === 'students') loadSchoolStudents();
  if (subpage === 'instructors') loadSchoolInstructors();
  if (subpage === 'courses') loadSchoolCourses();
  if (subpage === 'attendance') loadSchoolAttendance();
  if (subpage === 'classes') loadSchoolClasses();
  if (subpage === 'vehicles') loadSchoolVehicles();
  if (subpage === 'certificates') loadSchoolCertificates();
  if (subpage === 'notifications') loadSchoolNotificationsPage();
  if (subpage === 'enquiries') loadSchoolEnquiries();
  if (subpage === 'staff') loadSchoolStaff();
  if (subpage === 'settings') renderSchoolSettings();
}

document.querySelectorAll('#navSchoolScope .nav-link[data-school-page]').forEach(link => {
  link.addEventListener('click', () => showSchoolSubpage(link.dataset.schoolPage, link));
});

async function renderSchoolDetailOverview(){
  const school = allSchools.find(s => s.id === currentSchoolId);
  if (!school) return;
  const infoEl = document.getElementById('schoolDetailInfo');
  infoEl.innerHTML = `
    <div style="display:grid;grid-template-columns:140px 1fr;gap:10px 16px;">
      <div style="color:var(--slate-dim);">Region</div><div>${escapeHtml(school.region || '—')}</div>
      <div style="color:var(--slate-dim);">Email</div><div>${school.email ? escapeHtml(school.email) : '—'}</div>
      <div style="color:var(--slate-dim);">Phone 1</div><div>${school.phone1 ? escapeHtml(school.phone1) : '—'}</div>
      <div style="color:var(--slate-dim);">Phone 2</div><div>${school.phone2 ? escapeHtml(school.phone2) : '—'}</div>
      <div style="color:var(--slate-dim);">Website</div><div><a class="site-link" href="${escapeHtml(school.url)}" target="_blank">${escapeHtml(school.url || '—')}</a></div>
      <div style="color:var(--slate-dim);">Status</div><div><span class="badge ${school.status==='inactive'?'bad':'good'}">${escapeHtml(school.status || 'active')}</span></div>
      <div style="color:var(--slate-dim);">Added</div><div>${fmtDate(school.createdAt)}</div>
    </div>`;

  try {
    const [studSnap, instrSnap] = await Promise.all([
      getDocs(query(collection(db, "students"), where("schoolId", "==", currentSchoolId))),
      getDocs(query(collection(db, "instructors"), where("schoolId", "==", currentSchoolId)))
    ]);
    const students = studSnap.docs.map(d => d.data());
    const pending = students.filter(s => s.status === 'pending').length;
    document.getElementById('schStatStudents').textContent = students.length;
    document.getElementById('schStatStudentsSub').textContent = `${students.filter(s=>s.status==='active').length} active`;
    document.getElementById('schStatInstructors').textContent = instrSnap.size;
    document.getElementById('schStatPending').textContent = pending;
  } catch(e) { console.error(e); }
}

// ============================================================
// STUDENTS MODULE (school-scoped, fully built — the reference module)
// ============================================================
let schoolStudents = [];
let schoolStudentsUnsub = null;

function loadSchoolStudents(){
  if (schoolStudentsUnsub) { schoolStudentsUnsub(); schoolStudentsUnsub = null; }
  const q = query(collection(db, "students"), where("schoolId", "==", currentSchoolId));
  schoolStudentsUnsub = onSnapshot(q, (snap) => {
    schoolStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchoolStudents();
  }, (err) => showToast('Could not load students: ' + err.message, true));
}

function renderSchoolStudents(){
  const term = (document.getElementById('schStudentSearch').value || '').toLowerCase();
  const pending = schoolStudents.filter(s => s.status === 'pending');
  const active = schoolStudents.filter(s => s.status !== 'pending').filter(s => {
    const name = `${s.firstName||''} ${s.lastName||''} ${s.email||''}`.toLowerCase();
    return !term || name.includes(term);
  });

  const pendingPanel = document.getElementById('schPendingPanel');
  const pendingBody = document.getElementById('schPendingTableBody');
  const pendingCount = document.getElementById('schPendingCount');
  if (pending.length) {
    pendingPanel.style.display = 'block';
    pendingCount.textContent = pending.length;
    pendingBody.innerHTML = pending.map(s => {
      const name = `${s.firstName||''} ${s.lastName||''}`.trim() || '—';
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(s.avatarUrl, s.firstName, s.lastName)}<div><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(s.email||'')}</div></div></div></td>
        <td><span class="badge">${escapeHtml(s.courseType||'—')}</span></td>
        <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(s.createdAt)}</td>
        <td class="row-actions">
          <button class="icon-btn" style="color:var(--good);border-color:rgba(63,166,106,0.4);" title="Approve" onclick="window.approveStudent('${s.id}')"><i class="fas fa-check"></i></button>
          <button class="icon-btn danger" title="Disapprove" onclick="window.disapproveStudent('${s.id}')"><i class="fas fa-times"></i></button>
        </td>
      </tr>`;
    }).join('');
  } else {
    pendingPanel.style.display = 'none';
  }

  const tbody = document.getElementById('schStudentsTableBody');
  if (!active.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No students match.</td></tr>`;
    return;
  }
  tbody.innerHTML = active.map(s => {
    const name = `${s.firstName||''} ${s.lastName||''}`.trim() || '—';
    const statusClass = s.status === 'active' ? 'good' : 'bad';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(s.avatarUrl, s.firstName, s.lastName)}<div><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(s.email||'')}</div></div></div></td>
      <td><span class="badge">${escapeHtml(s.courseType||'—')}</span></td>
      <td><span class="badge">Stage ${s.trainingStage || 1}</span></td>
      <td><span class="badge ${statusClass}">${escapeHtml(s.status||'active')}</span></td>
      <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(s.createdAt)}</td>
      <td class="row-actions">
        <button class="icon-btn" title="View / edit" onclick="window.openStudentDetail('${s.id}')"><i class="fas fa-eye"></i></button>
        <button class="icon-btn" title="Edit role permissions" onclick="window.openEditStudentRoleModal('${s.roleKey || 'Standard'}')"><i class="fas fa-shield-alt"></i></button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('schStudentSearch').addEventListener('input', renderSchoolStudents);

window.approveStudent = async function(uid){
  if (!(await showConfirm('Approve student', 'Approve this student? They will be able to sign in.'))) return;
  try {
    await updateDoc(doc(db, 'students', uid), { status: 'active', trainingStage: 1 });
    showToast('Student approved ✓');
  } catch(e) { showToast('Approval failed: ' + e.message, true); }
};
window.disapproveStudent = async function(uid){
  if (!(await showConfirm('Disapprove student', 'Disapprove this student? Their account will be removed.'))) return;
  try {
    await deleteDoc(doc(db, 'students', uid));
    showToast('Student disapproved and removed.');
  } catch(e) { showToast('Failed: ' + e.message, true); }
};

// ── Add student ──
document.getElementById('schOpenAddStudentBtn').addEventListener('click', async () => {
  document.getElementById('schAddStudentError').textContent = '';
  ['schNewFirst','schNewLast','schNewEmail','schNewPhone','schNewPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schNewCourse').value = 'Manual';
  document.getElementById('schNewStudentPhotoFile').value = '';
  document.getElementById('schNewStudentPhotoPreview').style.display = 'none';
  document.getElementById('schNewStudentPhotoText').textContent = 'Tap to upload a photo';
  await populatePortalRoleSelect('schNewRole', 'student', 'Standard');
  openModal('schAddStudentModal');
});
document.getElementById('schNewStudentPhotoFile').addEventListener('change', () => {
  const file = document.getElementById('schNewStudentPhotoFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('schNewStudentPhotoPreview').src = e.target.result;
    document.getElementById('schNewStudentPhotoPreview').style.display = 'block';
    document.getElementById('schNewStudentPhotoText').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('schCreateStudentBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schAddStudentError');
  errEl.textContent = '';
  const first = document.getElementById('schNewFirst').value.trim();
  const last = document.getElementById('schNewLast').value.trim();
  const email = document.getElementById('schNewEmail').value.trim();
  const phone = document.getElementById('schNewPhone').value.trim();
  const course = document.getElementById('schNewCourse').value;
  const roleKey = document.getElementById('schNewRole')?.value || 'Standard';
  const pass = document.getElementById('schNewPassword').value;

  if (!first || !last || !email || !pass) { errEl.textContent = 'Fill in all required fields.'; return; }

  const btn = document.getElementById('schCreateStudentBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';

  try {
    // Create the Auth user via REST API so the admin stays signed in
    // (identical pattern to Dekay's own createStudent()).
    const apiKey = firebaseConfig.apiKey;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, returnSecureToken: false })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || 'Could not create account.';
      errEl.textContent = msg.includes('EMAIL_EXISTS') ? 'That email is already registered.' : msg;
      return;
    }
    const uid = data.localId;

    const photoFile = document.getElementById('schNewStudentPhotoFile').files[0];
    const avatarUrl = photoFile ? await uploadSchoolImage(photoFile) : null;

    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(doc(db, 'students', uid), {
      firstName: first, lastName: last, email, phone,
      courseType: course, role: 'student', roleKey, trainingStage: 1, status: 'active',
      avatarUrl,
      createdAt: serverTimestamp(), enrolDate: new Date().toLocaleDateString('en-GB'),
      schoolId: currentSchoolId
    });

    closeModal('schAddStudentModal');
    showToast(`${first} ${last} enrolled ✓`);
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not create account. Check the details and try again.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create account';
  }
});


// Staff photo preview
document.getElementById('schStaffPhotoFile').addEventListener('change', () => {
  const file = document.getElementById('schStaffPhotoFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('schStaffPhotoPreview').src = e.target.result;
    document.getElementById('schStaffPhotoPreview').style.display = 'block';
    document.getElementById('schStaffPhotoText').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

// Edit-staff photo preview
document.getElementById('schEditStaffPhotoFile').addEventListener('change', () => {
  const file = document.getElementById('schEditStaffPhotoFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('schEditStaffPhotoPreview').src = e.target.result;
    document.getElementById('schEditStaffPhotoPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
});


// ── Student detail / edit / delete / reset password ──
window.openStudentDetail = function(uid){
  const s = schoolStudents.find(x => x.id === uid);
  if (!s) return;
  document.getElementById('schStudentDetailTitle').textContent = `${s.firstName||''} ${s.lastName||''}`.trim() || 'Student';
  document.getElementById('schStudentDetailBody').innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div onclick="document.getElementById('schEditStudentPhotoFile').click()" style="cursor:pointer;display:inline-block;">
        ${avatarHtml(s.avatarUrl, s.firstName, s.lastName, 84)}
      </div>
      <div style="font-size:11px;color:var(--slate-dim);margin-top:6px;">Tap photo to change</div>
      <input type="file" id="schEditStudentPhotoFile" accept="image/*" style="display:none">
    </div>
    <div class="form-row">
      <div class="field"><label>First name</label><input id="schEditFirst" type="text" value="${escapeHtml(s.firstName||'')}"></div>
      <div class="field"><label>Last name</label><input id="schEditLast" type="text" value="${escapeHtml(s.lastName||'')}"></div>
    </div>
    <div class="field"><label>Email</label><input value="${escapeHtml(s.email||'')}" disabled style="opacity:.6;"></div>
    <div class="field"><label>Phone</label><input id="schEditPhone" type="tel" value="${escapeHtml(s.phone||'')}"></div>
    <div class="form-row">
      <div class="field"><label>Course type</label>
        <select id="schEditCourse" class="field-select">
          ${['Manual','Automatic','Motorcycle','Commercial Bus','Truck / HGV'].map(c => `<option value="${c}" ${s.courseType===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Training stage</label>
        <select id="schEditStage" class="field-select">
          ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${Number(s.trainingStage||1)===n?'selected':''}>Stage ${n}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="field"><label>Branch</label>
        <select id="schEditBranch" class="field-select">
          <option value="">Select branch…</option>
          ${['Ablekuma','Adenta','Amasaman','Dansoman'].map(b => `<option value="${b}" ${s.branch===b?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Date of birth</label><input id="schEditDob" type="date" value="${s.dob||''}"></div>
    </div>
    <div class="field"><label>Ghana Card number</label><input id="schEditGhCardNumber" type="text" value="${escapeHtml(s.ghCardNumber||'')}" placeholder="GHA-123456789-1"></div>
    <div class="field"><label>Status</label>
      <select id="schEditStatus" class="field-select">
        <option value="active" ${s.status==='active'?'selected':''}>Active</option>
        <option value="inactive" ${s.status==='inactive'?'selected':''}>Inactive</option>
      </select>
    </div>
    <div class="field"><label>Role</label>
      <select id="schEditRole" class="field-select"><option value="${s.roleKey||'Standard'}">${escapeHtml(s.roleKey||'Standard')}</option></select>
      <div style="font-size:11px;color:var(--slate-dim);margin-top:4px;">Controls which portal features this student can access.</div>
    </div>
    <div class="field" style="font-size:11.5px;color:var(--slate-dim);">Enrolled: ${s.enrolDate ? escapeHtml(s.enrolDate) : fmtDate(s.createdAt)}</div>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <button class="btn btn-outline" style="flex:1;" onclick="window.resetStudentPassword('${s.email||''}')"><i class="fas fa-key"></i> Email reset link</button>
      <button class="btn btn-outline" style="flex:1;" onclick="window.openManualPasswordModal('${uid}')"><i class="fas fa-user-shield"></i> Set manually</button>
    </div>
  `;
  document.getElementById('schStudentSaveBtn').onclick = () => saveStudentDetail(uid);
  document.getElementById('schStudentDeleteBtn').onclick = () => deleteStudentDetail(uid);
  populatePortalRoleSelect('schEditRole', 'student', s.roleKey || 'Standard');
  openModal('schStudentDetailModal');
};

async function saveStudentDetail(uid){
  const btn = document.getElementById('schStudentSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const newPhotoFile = document.getElementById('schEditStudentPhotoFile')?.files[0];
    const updates = {
      firstName: document.getElementById('schEditFirst').value.trim(),
      lastName: document.getElementById('schEditLast').value.trim(),
      phone: document.getElementById('schEditPhone').value.trim(),
      courseType: document.getElementById('schEditCourse').value,
      trainingStage: parseInt(document.getElementById('schEditStage').value),
      branch: document.getElementById('schEditBranch').value || null,
      dob: document.getElementById('schEditDob').value || null,
      ghCardNumber: document.getElementById('schEditGhCardNumber').value.trim(),
      status: document.getElementById('schEditStatus').value,
      roleKey: document.getElementById('schEditRole')?.value || 'Standard'
    };
    if (newPhotoFile) updates.avatarUrl = await uploadSchoolImage(newPhotoFile);
    await updateDoc(doc(db, 'students', uid), updates);
    closeModal('schStudentDetailModal');
    showToast('Student updated ✓');
  } catch(e) { showToast('Update failed: ' + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save changes'; }
}

async function deleteStudentDetail(uid){
  if (!(await showConfirm('Delete student', 'Delete this student? This cannot be undone.'))) return;
  try {
    await deleteDoc(doc(db, 'students', uid));
    closeModal('schStudentDetailModal');
    showToast('Student deleted.');
  } catch(e) { showToast('Delete failed: ' + e.message, true); }
}

window.resetStudentPassword = async function(email){
  if (!email) { showToast('This student has no email on file.', true); return; }
  if (!(await showConfirm('Send password reset', `Send a password reset link to ${email}?`))) return;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email} ✓`);
  } catch(e) { showToast('Could not send reset email: ' + e.message, true); }
};

// ============================================================
// INSTRUCTORS MODULE (school-scoped, built on the same recipe as Students)
// ============================================================
let schoolInstructors = [];
let schoolInstructorsUnsub = null;

function loadSchoolInstructors(){
  if (schoolInstructorsUnsub) { schoolInstructorsUnsub(); schoolInstructorsUnsub = null; }
  const q = query(collection(db, "instructors"), where("schoolId", "==", currentSchoolId));
  schoolInstructorsUnsub = onSnapshot(q, (snap) => {
    schoolInstructors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchoolInstructors();
  }, (err) => showToast('Could not load instructors: ' + err.message, true));
}

function renderSchoolInstructors(){
  const term = (document.getElementById('schInstructorSearch').value || '').toLowerCase();
  const pending = schoolInstructors.filter(i => i.status === 'pending');
  const approved = schoolInstructors.filter(i => i.status !== 'pending').filter(i => {
    const name = `${i.firstName||''} ${i.lastName||''} ${i.email||''}`.toLowerCase();
    return !term || name.includes(term);
  });

  const pendingPanel = document.getElementById('schPendingInstructorPanel');
  const pendingBody = document.getElementById('schPendingInstructorTableBody');
  const pendingCount = document.getElementById('schPendingInstructorCount');
  if (pending.length) {
    pendingPanel.style.display = 'block';
    pendingCount.textContent = pending.length;
    pendingBody.innerHTML = pending.map(i => {
      const name = `${i.firstName||''} ${i.lastName||''}`.trim() || '—';
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(i.profilePhoto || i.avatarUrl, i.firstName, i.lastName)}<div><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(i.email||'')}</div></div></div></td>
        <td><span class="badge">${escapeHtml(i.branch||'—')}</span></td>
        <td style="font-size:12px;color:var(--slate-dim);">${i.experience || '—'} yrs</td>
        <td class="row-actions">
          <button class="icon-btn" style="color:var(--good);border-color:rgba(63,166,106,0.4);" title="Approve" onclick="window.approveInstructor('${i.id}')"><i class="fas fa-check"></i></button>
          <button class="icon-btn danger" title="Disapprove" onclick="window.disapproveInstructor('${i.id}')"><i class="fas fa-times"></i></button>
        </td>
      </tr>`;
    }).join('');
  } else {
    pendingPanel.style.display = 'none';
  }

  const tbody = document.getElementById('schInstructorsTableBody');
  if (!approved.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No instructors match.</td></tr>`;
    return;
  }
  tbody.innerHTML = approved.map(i => {
    const name = `${i.firstName||''} ${i.lastName||''}`.trim() || '—';
    const statusClass = i.status === 'active' ? 'good' : 'bad';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(i.profilePhoto || i.avatarUrl, i.firstName, i.lastName)}<strong>${escapeHtml(name)}</strong></div></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(i.email||'')}</td>
      <td><span class="badge">${escapeHtml(i.branch||'—')}</span></td>
      <td><span class="badge ${statusClass}">${escapeHtml(i.status||'active')}</span></td>
      <td class="row-actions">
        <button class="icon-btn" title="View / edit" onclick="window.openInstructorDetail('${i.id}')"><i class="fas fa-eye"></i></button>
        <button class="icon-btn" title="Edit role permissions" onclick="window.openEditInstructorRoleModal('${i.roleKey || 'Standard'}')"><i class="fas fa-shield-alt"></i></button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('schInstructorSearch').addEventListener('input', renderSchoolInstructors);

window.approveInstructor = async function(uid){
  if (!(await showConfirm('Approve instructor', 'Approve this instructor? They will be able to sign in.'))) return;
  try {
    await updateDoc(doc(db, 'instructors', uid), { status: 'active' });
    showToast('Instructor approved ✓');
  } catch(e) { showToast('Approval failed: ' + e.message, true); }
};
window.disapproveInstructor = async function(uid){
  if (!(await showConfirm('Disapprove instructor', 'Disapprove this instructor? Their application will be removed.'))) return;
  try {
    await deleteDoc(doc(db, 'instructors', uid));
    showToast('Instructor disapproved and removed.');
  } catch(e) { showToast('Failed: ' + e.message, true); }
};

// ── Add instructor ──
function wireInstrFilePreview(fileId, previewId, textId){
  const el = document.getElementById(fileId);
  if (!el) return;
  el.addEventListener('change', () => {
    const file = el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById(previewId).src = e.target.result;
      document.getElementById(previewId).style.display = 'block';
      document.getElementById(textId).textContent = file.name;
    };
    reader.readAsDataURL(file);
  });
}
wireInstrFilePreview('schInstrNewPhotoFile', 'schInstrNewPhotoPreview', 'schInstrNewPhotoText');
wireInstrFilePreview('schInstrNewGhFrontFile', 'schInstrNewGhFrontPreview', 'schInstrNewGhFrontText');
wireInstrFilePreview('schInstrNewGhBackFile', 'schInstrNewGhBackPreview', 'schInstrNewGhBackText');
document.getElementById('schInstrNewCertFile').addEventListener('change', () => {
  const f = document.getElementById('schInstrNewCertFile').files[0];
  if (f) document.getElementById('schInstrNewCertFileText').textContent = f.name;
});

document.getElementById('schOpenAddInstructorBtn').addEventListener('click', async () => {
  document.getElementById('schAddInstructorError').textContent = '';
  await populatePortalRoleSelect('schInstrNewRole', 'instructor', 'Standard');
  ['schInstrNewFirst','schInstrNewLast','schInstrNewEmail','schInstrNewPhone','schInstrNewPassword',
   'schInstrNewDob','schInstrNewEngagementDate','schInstrNewExp','schInstrNewGhCardNumber','schInstrNewQual','schInstrNewCert',
   'schInstrNewGuarName','schInstrNewGuarEmail','schInstrNewGuarPhone',
   'schInstrNewRef1Name','schInstrNewRef1Email','schInstrNewRef1Phone',
   'schInstrNewRef2Name','schInstrNewRef2Email','schInstrNewRef2Phone'
  ].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schInstrNewBranch').value = '';
  ['schInstrNewPhotoFile','schInstrNewGhFrontFile','schInstrNewGhBackFile','schInstrNewCertFile'].forEach(id => document.getElementById(id).value = '');
  ['schInstrNewPhotoPreview','schInstrNewGhFrontPreview','schInstrNewGhBackPreview'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('schInstrNewPhotoText').textContent = 'Tap to upload a profile photo';
  document.getElementById('schInstrNewGhFrontText').textContent = 'Upload front';
  document.getElementById('schInstrNewGhBackText').textContent = 'Upload back';
  document.getElementById('schInstrNewCertFileText').textContent = 'Tap to upload certificate (PDF or image)';
  openModal('schAddInstructorModal');
});

async function uploadInstructorImage(file, folder){
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', SCHOOL_IMAGE_PRESET);
  fd.append('folder', folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Image upload failed.');
  const data = await res.json();
  return data.secure_url;
}

document.getElementById('schCreateInstructorBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schAddInstructorError');
  errEl.textContent = '';
  const first = document.getElementById('schInstrNewFirst').value.trim();
  const last = document.getElementById('schInstrNewLast').value.trim();
  const email = document.getElementById('schInstrNewEmail').value.trim();
  const phone = document.getElementById('schInstrNewPhone').value.trim();
  const branch = document.getElementById('schInstrNewBranch').value;
  const dob = document.getElementById('schInstrNewDob').value;
  const dateOfEngagement = document.getElementById('schInstrNewEngagementDate').value;
  const experience = parseInt(document.getElementById('schInstrNewExp').value) || 0;
  const ghCardNumber = document.getElementById('schInstrNewGhCardNumber').value.trim();
  const qualifications = document.getElementById('schInstrNewQual').value.trim();
  const certificationName = document.getElementById('schInstrNewCert').value.trim();
  const guarantor = {
    name: document.getElementById('schInstrNewGuarName').value.trim(),
    email: document.getElementById('schInstrNewGuarEmail').value.trim(),
    phone: document.getElementById('schInstrNewGuarPhone').value.trim()
  };
  const references = [
    { name: document.getElementById('schInstrNewRef1Name').value.trim(), email: document.getElementById('schInstrNewRef1Email').value.trim(), phone: document.getElementById('schInstrNewRef1Phone').value.trim() },
    { name: document.getElementById('schInstrNewRef2Name').value.trim(), email: document.getElementById('schInstrNewRef2Email').value.trim(), phone: document.getElementById('schInstrNewRef2Phone').value.trim() }
  ];
  const roleKey = document.getElementById('schInstrNewRole')?.value || 'Standard';
  const pass = document.getElementById('schInstrNewPassword').value;

  if (!first || !last || !email || !pass) { errEl.textContent = 'Fill in all required fields.'; return; }

  const btn = document.getElementById('schCreateInstructorBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';

  try {
    const apiKey = firebaseConfig.apiKey;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, returnSecureToken: false })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || 'Could not create account.';
      errEl.textContent = msg.includes('EMAIL_EXISTS') ? 'That email is already registered.' : msg;
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create instructor';
      return;
    }
    const uid = data.localId;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading photos…';
    const photoFile = document.getElementById('schInstrNewPhotoFile').files[0];
    const ghFrontFile = document.getElementById('schInstrNewGhFrontFile').files[0];
    const ghBackFile = document.getElementById('schInstrNewGhBackFile').files[0];
    const certFile = document.getElementById('schInstrNewCertFile').files[0];
    const [profilePhoto, ghCardFront, ghCardBack, certDocUrl] = await Promise.all([
      photoFile ? uploadInstructorImage(photoFile, 'instructors') : Promise.resolve(null),
      ghFrontFile ? uploadInstructorImage(ghFrontFile, 'instructors/ghcards') : Promise.resolve(null),
      ghBackFile ? uploadInstructorImage(ghBackFile, 'instructors/ghcards') : Promise.resolve(null),
      certFile ? uploadInstructorImage(certFile, 'instructors/certifications') : Promise.resolve(null)
    ]);
    const certifications = (certificationName || certDocUrl)
      ? [{ name: certificationName || 'Certification', documentUrl: certDocUrl }]
      : [];

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(doc(db, 'instructors', uid), {
      firstName: first, lastName: last, email, phone,
      branch: branch || null, dob: dob || null, dateOfEngagement: dateOfEngagement || null,
      profilePhoto, ghCardFront, ghCardBack, ghCardNumber,
      qualifications, certifications, experience,
      guarantor, references,
      role: 'instructor', roleKey, status: 'active',
      assignedCourses: [], createdAt: serverTimestamp(),
      schoolId: currentSchoolId
    });

    closeModal('schAddInstructorModal');
    showToast(`${first} ${last} added as instructor ✓`);
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not create account. Check the details and try again.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create instructor';
  }
});

// ── Instructor detail / edit / delete / reset password (full parity with Dekay) ──
let _schInstrEditPhoto = null, _schInstrEditGhFront = null, _schInstrEditGhBack = null;

function renderInstrCertifications(certs){
  if (!certs) return '<div style="color:var(--slate-dim);font-size:12px;">No certifications.</div>';
  if (typeof certs === 'string') return `<div style="font-size:13px;color:var(--chalk);">${escapeHtml(certs)}</div>`;
  if (Array.isArray(certs) && certs.length) {
    return certs.map(c => {
      const name = c.name || 'Certification';
      const url = c.documentUrl || c.url;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:6px;margin-bottom:6px;">
        <span style="font-size:12px;">${escapeHtml(name)}</span>
        ${url ? `<a href="${url}" target="_blank" class="btn btn-outline" style="padding:3px 10px;font-size:11px;"><i class="fas fa-download"></i></a>` : ''}
      </div>`;
    }).join('');
  }
  return '<div style="color:var(--slate-dim);font-size:12px;">No certifications.</div>';
}

window.openInstructorDetail = function(uid){
  const i = schoolInstructors.find(x => x.id === uid);
  if (!i) return;
  _schInstrEditPhoto = i.profilePhoto || i.avatarUrl || null;
  _schInstrEditGhFront = i.ghCardFront || null;
  _schInstrEditGhBack = i.ghCardBack || null;

  document.getElementById('schInstructorDetailTitle').textContent = `${i.firstName||''} ${i.lastName||''}`.trim() || 'Instructor';
  document.getElementById('schInstructorDetailBody').innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div onclick="document.getElementById('schInstrEditPhotoFile').click()" style="cursor:pointer;display:inline-block;">
        ${avatarHtml(_schInstrEditPhoto, i.firstName, i.lastName, 84)}
      </div>
      <div style="font-size:11px;color:var(--slate-dim);margin-top:6px;">Tap photo to change</div>
      <input type="file" id="schInstrEditPhotoFile" accept="image/*" style="display:none">
    </div>

    <div class="form-row">
      <div class="field"><label>First name</label><input id="schInstrEditFirst" type="text" value="${escapeHtml(i.firstName||'')}"></div>
      <div class="field"><label>Last name</label><input id="schInstrEditLast" type="text" value="${escapeHtml(i.lastName||'')}"></div>
    </div>
    <div class="field"><label>Email</label><input value="${escapeHtml(i.email||'')}" disabled style="opacity:.6;"></div>
    <div class="field"><label>Phone</label><input id="schInstrEditPhone" type="tel" value="${escapeHtml(i.phone||'')}"></div>
    <div class="form-row">
      <div class="field"><label>Date of birth</label><input id="schInstrEditDob" type="date" value="${i.dob||''}"></div>
      <div class="field"><label>Branch</label>
        <select id="schInstrEditBranch" class="field-select">
          <option value="">Select branch…</option>
          ${['Ablekuma','Adenta','Amasaman','Dansoman'].map(b => `<option value="${b}" ${i.branch===b?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="field"><label>Date of engagement</label><input id="schInstrEditEngagement" type="date" value="${i.dateOfEngagement||''}"></div>
      <div class="field"><label>Date of exit</label><input id="schInstrEditExit" type="date" value="${i.dateOfExit||''}"></div>
    </div>
    <div class="field"><label>Years of experience</label><input id="schInstrEditExperience" type="number" min="0" value="${i.experience || 0}"></div>
    <div class="field"><label>Qualifications</label><textarea id="schInstrEditQualifications" rows="2" style="width:100%;padding:11px 13px;border-radius:8px;border:1.5px solid var(--border);background:var(--asphalt-deep);color:var(--chalk);font-family:inherit;">${escapeHtml(i.qualifications||'')}</textarea></div>

    <div class="field"><label>Certifications on file</label>${renderInstrCertifications(i.certifications)}</div>
    <div class="field"><label>Add / replace certifications (text)</label><input id="schInstrEditCert" type="text" value="${(Array.isArray(i.certifications) && i.certifications[0]?.name) || (typeof i.certifications === 'string' ? escapeHtml(i.certifications) : '')}" placeholder="e.g. Defensive Driving, First Aid"></div>
    <div class="field">
      <label>Replace certificate document <span style="color:var(--slate-dim);font-weight:400;">(optional — leave blank to keep current file)</span></label>
      <div class="img-upload-area" onclick="document.getElementById('schInstrEditCertFile').click()">
        <i class="fas fa-file-certificate" style="color:var(--amber);margin-right:6px;"></i>
        <span id="schInstrEditCertFileText" style="font-size:12px;color:var(--slate-dim);">Tap to upload a new certificate file</span>
      </div>
      <input type="file" id="schInstrEditCertFile" accept=".pdf,.png,.jpg,.jpeg" style="display:none">
    </div>

    <div class="field"><label>Ghana Card number</label><input id="schInstrEditGhCardNumber" type="text" value="${escapeHtml(i.ghCardNumber||'')}"></div>
    <div class="form-row">
      <div class="field">
        <label>Ghana Card — front</label>
        ${i.ghCardFront ? `<img src="${i.ghCardFront}" style="max-width:100%;max-height:90px;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="document.getElementById('schInstrEditGhFrontFile').click()">` : `<div class="img-upload-area" onclick="document.getElementById('schInstrEditGhFrontFile').click()"><span style="font-size:12px;color:var(--slate-dim);">Upload front</span></div>`}
        <input type="file" id="schInstrEditGhFrontFile" accept="image/*" style="display:none">
      </div>
      <div class="field">
        <label>Ghana Card — back</label>
        ${i.ghCardBack ? `<img src="${i.ghCardBack}" style="max-width:100%;max-height:90px;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="document.getElementById('schInstrEditGhBackFile').click()">` : `<div class="img-upload-area" onclick="document.getElementById('schInstrEditGhBackFile').click()"><span style="font-size:12px;color:var(--slate-dim);">Upload back</span></div>`}
        <input type="file" id="schInstrEditGhBackFile" accept="image/*" style="display:none">
      </div>
    </div>

    <div class="field" style="margin-top:6px;"><label style="color:var(--amber);font-weight:700;">Guarantor</label></div>
    <div class="form-row">
      <div class="field"><label>Name</label><input id="schInstrEditGuarName" type="text" value="${escapeHtml(i.guarantor?.name||'')}"></div>
      <div class="field"><label>Email</label><input id="schInstrEditGuarEmail" type="email" value="${escapeHtml(i.guarantor?.email||'')}"></div>
    </div>
    <div class="field"><label>Phone</label><input id="schInstrEditGuarPhone" type="tel" value="${escapeHtml(i.guarantor?.phone||'')}"></div>

    <div class="field" style="margin-top:6px;"><label style="color:var(--amber);font-weight:700;">References</label></div>
    <div class="form-row">
      <div class="field"><label>Ref 1 name</label><input id="schInstrEditRef1Name" type="text" value="${escapeHtml(i.references?.[0]?.name||'')}"></div>
      <div class="field"><label>Ref 1 email</label><input id="schInstrEditRef1Email" type="email" value="${escapeHtml(i.references?.[0]?.email||'')}"></div>
    </div>
    <div class="field"><label>Ref 1 phone</label><input id="schInstrEditRef1Phone" type="tel" value="${escapeHtml(i.references?.[0]?.phone||'')}"></div>
    <div class="form-row">
      <div class="field"><label>Ref 2 name</label><input id="schInstrEditRef2Name" type="text" value="${escapeHtml(i.references?.[1]?.name||'')}"></div>
      <div class="field"><label>Ref 2 email</label><input id="schInstrEditRef2Email" type="email" value="${escapeHtml(i.references?.[1]?.email||'')}"></div>
    </div>
    <div class="field"><label>Ref 2 phone</label><input id="schInstrEditRef2Phone" type="tel" value="${escapeHtml(i.references?.[1]?.phone||'')}"></div>

    <div class="field"><label>Status</label>
      <select id="schInstrEditStatus" class="field-select">
        <option value="active" ${i.status==='active'?'selected':''}>Active</option>
        <option value="inactive" ${i.status==='inactive'?'selected':''}>Inactive</option>
      </select>
    </div>
    <div class="field"><label>Role</label>
      <select id="schInstrEditRole" class="field-select"><option value="${i.roleKey||'Standard'}">${escapeHtml(i.roleKey||'Standard')}</option></select>
      <div style="font-size:11px;color:var(--slate-dim);margin-top:4px;">Controls which portal features this instructor can access.</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <button class="btn btn-outline" style="flex:1;" onclick="window.resetInstructorPassword('${i.email||''}')"><i class="fas fa-key"></i> Email reset link</button>
      <button class="btn btn-outline" style="flex:1;" onclick="window.openManualPasswordModal('${uid}')"><i class="fas fa-user-shield"></i> Set manually</button>
    </div>
  `;

  wireInstrFilePreview2('schInstrEditPhotoFile', (url) => { _schInstrEditPhoto = url; });
  wireInstrFilePreview2('schInstrEditGhFrontFile', (url) => { _schInstrEditGhFront = url; });
  wireInstrFilePreview2('schInstrEditGhBackFile', (url) => { _schInstrEditGhBack = url; });

  document.getElementById('schInstructorSaveBtn').onclick = () => saveInstructorDetail(uid);
  document.getElementById('schInstructorDeleteBtn').onclick = () => deleteInstructorDetail(uid);
  populatePortalRoleSelect('schInstrEditRole', 'instructor', i.roleKey || 'Standard');
  openModal('schInstructorDetailModal');
};

// Reads a chosen file as a data URL immediately (used only to know a new file was picked);
// the actual Cloudinary upload happens on Save so we don't upload photos the admin never confirms.
function wireInstrFilePreview2(fileId, onPicked){
  const el = document.getElementById(fileId);
  if (!el) return;
  el.addEventListener('change', () => {
    const file = el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => onPicked(e.target.result); // temp preview data-URL; replaced with real URL on save
    reader.readAsDataURL(file);
  });
}

async function saveInstructorDetail(uid){
  const btn = document.getElementById('schInstructorSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const updates = {
      firstName: document.getElementById('schInstrEditFirst').value.trim(),
      lastName: document.getElementById('schInstrEditLast').value.trim(),
      phone: document.getElementById('schInstrEditPhone').value.trim(),
      dob: document.getElementById('schInstrEditDob').value || null,
      branch: document.getElementById('schInstrEditBranch').value || null,
      dateOfEngagement: document.getElementById('schInstrEditEngagement').value || null,
      dateOfExit: document.getElementById('schInstrEditExit').value || null,
      experience: parseInt(document.getElementById('schInstrEditExperience').value) || 0,
      qualifications: document.getElementById('schInstrEditQualifications').value.trim(),
      ghCardNumber: document.getElementById('schInstrEditGhCardNumber').value.trim(),
      guarantor: {
        name: document.getElementById('schInstrEditGuarName').value.trim(),
        email: document.getElementById('schInstrEditGuarEmail').value.trim(),
        phone: document.getElementById('schInstrEditGuarPhone').value.trim()
      },
      references: [
        { name: document.getElementById('schInstrEditRef1Name').value.trim(), email: document.getElementById('schInstrEditRef1Email').value.trim(), phone: document.getElementById('schInstrEditRef1Phone').value.trim() },
        { name: document.getElementById('schInstrEditRef2Name').value.trim(), email: document.getElementById('schInstrEditRef2Email').value.trim(), phone: document.getElementById('schInstrEditRef2Phone').value.trim() }
      ],
      status: document.getElementById('schInstrEditStatus').value,
      roleKey: document.getElementById('schInstrEditRole')?.value || 'Standard'
    };
    // Upload any newly-picked images (data URLs) to Cloudinary before saving
    const photoFile = document.getElementById('schInstrEditPhotoFile').files[0];
    const ghFrontFile = document.getElementById('schInstrEditGhFrontFile').files[0];
    const ghBackFile = document.getElementById('schInstrEditGhBackFile').files[0];
    const certFile = document.getElementById('schInstrEditCertFile')?.files[0];
    if (photoFile) updates.profilePhoto = await uploadInstructorImage(photoFile, 'instructors');
    if (ghFrontFile) updates.ghCardFront = await uploadInstructorImage(ghFrontFile, 'instructors/ghcards');
    if (ghBackFile) updates.ghCardBack = await uploadInstructorImage(ghBackFile, 'instructors/ghcards');

    const certText = document.getElementById('schInstrEditCert').value.trim();
    if (certText || certFile) {
      const currentInstr = schoolInstructors.find(x => x.id === uid);
      const existing = (currentInstr && Array.isArray(currentInstr.certifications)) ? (currentInstr.certifications[0] || {}) : {};
      const newDocUrl = certFile ? await uploadInstructorImage(certFile, 'instructors/certifications') : existing.documentUrl || null;
      updates.certifications = [{ name: certText || existing.name || 'Certification', documentUrl: newDocUrl }];
    }

    await updateDoc(doc(db, 'instructors', uid), updates);
    closeModal('schInstructorDetailModal');
    showToast('Instructor updated ✓');
  } catch(e) { showToast('Update failed: ' + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save changes'; }
}

async function deleteInstructorDetail(uid){
  if (!(await showConfirm('Delete instructor', 'Delete this instructor? This cannot be undone.'))) return;
  try {
    await deleteDoc(doc(db, 'instructors', uid));
    closeModal('schInstructorDetailModal');
    showToast('Instructor deleted.');
  } catch(e) { showToast('Delete failed: ' + e.message, true); }
}

window.resetInstructorPassword = async function(email){
  if (!email) { showToast('This instructor has no email on file.', true); return; }
  if (!(await showConfirm('Send password reset', `Send a password reset link to ${email}?`))) return;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email} ✓`);
  } catch(e) { showToast('Could not send reset email: ' + e.message, true); }
};

// ── Manual password set (superAdmin only, direct overwrite via Vercel function) ──
window.openManualPasswordModal = function(uid){
  if (!uid) { showToast('No account found for this user.', true); return; }
  document.getElementById('manualPwdTargetUid').value = uid;
  document.getElementById('manualPwdNewValue').value = '';
  document.getElementById('manualPwdError').textContent = '';
  openModal('manualPasswordModal');
};

document.getElementById('manualPwdSaveBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('manualPwdError');
  errEl.textContent = '';
  const targetUid = document.getElementById('manualPwdTargetUid').value;
  const newPassword = document.getElementById('manualPwdNewValue').value;

  if (!newPassword || newPassword.length < 6) { errEl.textContent = 'Enter a password of at least 6 characters.'; return; }

  const btn = document.getElementById('manualPwdSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(MANUAL_PASSWORD_RESET_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, targetUid, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not set password.');
    closeModal('manualPasswordModal');
    showToast('Password updated ✓');
  } catch(e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-key"></i> Set password';
  }
});

// ── STAFF PASSWORD OPTIONS MODAL (used by the Staff Management table) ──
window.openStaffPasswordOptions = function(uid, email){
  document.getElementById('schStaffPwdTargetUid').value = uid || '';
  document.getElementById('schStaffPwdTargetEmail').value = email || '';
  openModal('schStaffPasswordModal');
};

window.chooseUpdateManually = function(){
  const uid = document.getElementById('schStaffPwdTargetUid').value;
  closeModal('schStaffPasswordModal');
  window.openManualPasswordModal(uid);
};

window.chooseSendResetEmail = async function(){
  const email = document.getElementById('schStaffPwdTargetEmail').value;
  closeModal('schStaffPasswordModal');
  if (!email) { showToast('This staff member has no email on file.', true); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email} ✓`);
  } catch(e) { showToast('Could not send reset email: ' + e.message, true); }
};

// Kept for the Students/Instructors detail modals, which still use the direct email-reset button.
window.resetStaffPassword = async function(email){
  if (!email) { showToast('This staff member has no email on file.', true); return; }
  if (!(await showConfirm('Send password reset', `Send a password reset link to ${email}?`))) return;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email} ✓`);
  } catch(e) { showToast('Could not send reset email: ' + e.message, true); }
};

// ============================================================
// COURSES MODULE (school-scoped: courses collection filtered by schoolId)
// NOTE: courses created here always carry schoolId. Pre-existing course docs
// from before multi-tenancy (created by a school's own standalone admin
// panel) won't have schoolId and so won't appear here until re-saved.
// ============================================================
let schoolCourses = [];
let schoolCoursesUnsub = null;
let schCourseStudentsCache = [];
let schCourseInstructorsCache = [];

function loadSchoolCourses(){
  if (schoolCoursesUnsub) { schoolCoursesUnsub(); schoolCoursesUnsub = null; }
  const q = query(collection(db, "courses"), where("schoolId", "==", currentSchoolId));
  schoolCoursesUnsub = onSnapshot(q, (snap) => {
    schoolCourses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchoolCourses();
  }, (err) => showToast('Could not load courses: ' + err.message, true));
}

function renderSchoolCourses(){
  const term = (document.getElementById('schCourseSearch').value || '').toLowerCase();
  const filtered = schoolCourses.filter(c => (c.name || c.title || '').toLowerCase().includes(term));
  const tbody = document.getElementById('schCoursesTableBody');
  if (!filtered.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No courses added yet.</td></tr>`; return; }

  const maxCount = Math.max(1, ...schoolCourses.map(x => Math.max((x.assignedStudents||[]).length, (x.assignedInstructors||[]).length)));
  tbody.innerHTML = filtered.map(c => {
    const name = c.name || c.title || '—';
    const studentCount = (c.assignedStudents || []).length;
    const instructorCount = (c.assignedInstructors || []).length;
    const studentPct = Math.round((studentCount / maxCount) * 100);
    const instructorPct = Math.round((instructorCount / maxCount) * 100);
    const staffingHtml = (studentCount === 0 && instructorCount === 0)
      ? '<span style="color:var(--slate-dim);font-size:12px;">Unassigned</span>'
      : `<div style="display:flex;flex-direction:column;gap:4px;min-width:110px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <i class="fas fa-user-graduate" style="font-size:10px;color:var(--slate-dim);width:14px;"></i>
            <div style="flex:1;height:6px;background:var(--asphalt-deep);border-radius:50px;overflow:hidden;"><div style="height:100%;width:${studentPct}%;background:var(--amber);border-radius:50px;"></div></div>
            <span style="font-size:11px;font-weight:600;color:var(--amber);width:16px;text-align:right;">${studentCount}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <i class="fas fa-chalkboard-teacher" style="font-size:10px;color:var(--slate-dim);width:14px;"></i>
            <div style="flex:1;height:6px;background:var(--asphalt-deep);border-radius:50px;overflow:hidden;"><div style="height:100%;width:${instructorPct}%;background:var(--info);border-radius:50px;"></div></div>
            <span style="font-size:11px;font-weight:600;color:var(--info);width:16px;text-align:right;">${instructorCount}</span>
          </div>
        </div>`;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px;"><i class="fas ${c.icon||'fa-car'}" style="color:var(--amber);font-size:16px;"></i><div><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(c.category||'personal')}</div></div></div></td>
      <td><span class="badge">${escapeHtml(c.category||'personal')}</span></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(c.duration||'—')}</td>
      <td style="color:var(--amber);font-weight:600;">GH₵ ${c.price != null ? c.price : '—'}</td>
      <td style="font-weight:600;">${studentCount}</td>
      <td>${staffingHtml}</td>
      <td class="row-actions">
        <button class="icon-btn" title="View / edit" onclick="window.openSchCourseModal('${c.id}', this)"><i class="fas fa-eye"></i></button>
        <button class="icon-btn danger" title="Delete" onclick="window.deleteSchCourse('${c.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('schCourseSearch').addEventListener('input', renderSchoolCourses);

window.toggleSchCourseCustomName = function(sel){
  const custom = document.getElementById('schCourseNameCustom');
  custom.style.display = sel.value === '__custom__' ? 'block' : 'none';
  if (sel.value !== '__custom__') custom.value = '';
};

async function loadSchCourseStudentsAndInstructors(assignedStudentIds, assignedInstructorIds){
  try {
    const [studSnap, instrSnap] = await Promise.all([
      getDocs(query(collection(db, "students"), where("schoolId", "==", currentSchoolId))),
      getDocs(query(collection(db, "instructors"), where("schoolId", "==", currentSchoolId)))
    ]);
    schCourseStudentsCache = studSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    schCourseInstructorsCache = instrSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => i.status !== 'pending');
  } catch(e) { console.error(e); }

  const studentList = document.getElementById('schCourseStudentList');
  studentList.innerHTML = schCourseStudentsCache.length
    ? schCourseStudentsCache.map(s => {
        const name = `${s.firstName||''} ${s.lastName||''}`.trim() || s.email;
        const checked = (assignedStudentIds||[]).includes(s.id) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
          <input type="checkbox" value="${s.id}" data-name="${escapeHtml(name)}" class="sch-course-student-check" ${checked} style="accent-color:var(--amber);width:15px;height:15px;">
          <span style="font-size:13px;">${escapeHtml(name)}</span>
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--slate-dim);">No students yet.</div>';

  const instrList = document.getElementById('schCourseInstructorList');
  instrList.innerHTML = schCourseInstructorsCache.length
    ? schCourseInstructorsCache.map(i => {
        const name = `${i.firstName||''} ${i.lastName||''}`.trim() || i.email;
        const checked = (assignedInstructorIds||[]).includes(i.id) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
          <input type="checkbox" value="${i.id}" data-name="${escapeHtml(name)}" class="sch-course-instructor-check" ${checked} style="accent-color:var(--amber);width:15px;height:15px;">
          <span style="font-size:13px;">${escapeHtml(name)}</span>
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--slate-dim);">No active instructors yet.</div>';
}

document.getElementById('schOpenAddCourseBtn').addEventListener('click', async () => {
  document.getElementById('schCourseError').textContent = '';
  document.getElementById('schCourseId').value = '';
  document.getElementById('schCourseModalTitle').textContent = 'Add course';
  document.getElementById('schCourseNameSelect').value = '';
  document.getElementById('schCourseNameCustom').style.display = 'none';
  document.getElementById('schCourseNameCustom').value = '';
  document.getElementById('schCourseCategory').value = 'personal';
  document.getElementById('schCourseDuration').value = '';
  document.getElementById('schCoursePrice').value = '';
  document.getElementById('schCourseLevel').value = 'beginner';
  document.getElementById('schCourseDesc').value = '';
  document.getElementById('schCourseIcon').value = 'fa-car';
  document.getElementById('schCourseDeleteBtn').style.display = 'none';
  await loadSchCourseStudentsAndInstructors([], []);
  openModal('schCourseModal');
});

window.openSchCourseModal = async function(id, btn){
  const c = schoolCourses.find(x => x.id === id);
  if (!c) return;
  document.getElementById('schCourseError').textContent = '';
  document.getElementById('schCourseId').value = c.id;
  document.getElementById('schCourseModalTitle').textContent = 'Edit course';
  const known = ['Manual','Automatic','Motorcycle','Commercial Bus','Truck / HGV'];
  const name = c.name || c.title || '';
  if (known.includes(name)) {
    document.getElementById('schCourseNameSelect').value = name;
    document.getElementById('schCourseNameCustom').style.display = 'none';
  } else {
    document.getElementById('schCourseNameSelect').value = '__custom__';
    document.getElementById('schCourseNameCustom').style.display = 'block';
    document.getElementById('schCourseNameCustom').value = name;
  }
  document.getElementById('schCourseCategory').value = c.category || 'personal';
  document.getElementById('schCourseDuration').value = c.duration || '';
  document.getElementById('schCoursePrice').value = c.price != null ? c.price : '';
  document.getElementById('schCourseLevel').value = c.level || 'beginner';
  document.getElementById('schCourseDesc').value = c.description || '';
  document.getElementById('schCourseIcon').value = c.icon || 'fa-car';
  document.getElementById('schCourseDeleteBtn').style.display = 'inline-flex';
  await withBtnLoading(btn, () => loadSchCourseStudentsAndInstructors(c.assignedStudents || [], c.assignedInstructors || []));
  openModal('schCourseModal');
};

document.getElementById('schCourseSaveBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schCourseError');
  errEl.textContent = '';
  const id = document.getElementById('schCourseId').value;
  const selectVal = document.getElementById('schCourseNameSelect').value;
  const name = selectVal === '__custom__' ? document.getElementById('schCourseNameCustom').value.trim() : selectVal.trim();
  const category = document.getElementById('schCourseCategory').value;
  const duration = document.getElementById('schCourseDuration').value.trim();
  const price = document.getElementById('schCoursePrice').value.trim();
  const level = document.getElementById('schCourseLevel').value;
  const description = document.getElementById('schCourseDesc').value.trim();
  const icon = document.getElementById('schCourseIcon').value;

  if (!name || !duration) { errEl.textContent = 'Course name and duration are required.'; return; }

  const assignedStudents = Array.from(document.querySelectorAll('.sch-course-student-check:checked')).map(cb => cb.value);
  const assignedStudentNames = Array.from(document.querySelectorAll('.sch-course-student-check:checked')).map(cb => cb.dataset.name);
  const assignedInstructors = Array.from(document.querySelectorAll('.sch-course-instructor-check:checked')).map(cb => cb.value);
  const assignedInstructorNames = Array.from(document.querySelectorAll('.sch-course-instructor-check:checked')).map(cb => cb.dataset.name);

  const btn = document.getElementById('schCourseSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const payload = { name, category, duration, price: price ? Number(price) : null, level, description, icon, assignedStudents, assignedStudentNames, assignedInstructors, assignedInstructorNames, schoolId: currentSchoolId };

    let prevAssignedInstructors = [];
    let prevName = name;
    if (id) {
      const existing = schoolCourses.find(x => x.id === id);
      prevAssignedInstructors = existing?.assignedInstructors || [];
      prevName = existing?.name || existing?.title || name;
      await updateDoc(doc(db, 'courses', id), payload);
    } else {
      await addDoc(collection(db, 'courses'), { ...payload, createdAt: serverTimestamp() });
    }

    // Keep each assigned student's courseType in sync
    await Promise.all(assignedStudents.map(sid => updateDoc(doc(db, 'students', sid), { courseType: name }).catch(() => {})));

    // Reciprocal sync: add this course to newly-assigned instructors, remove from unassigned ones
    await Promise.all(assignedInstructors.map(async (iid) => {
      try {
        const iRef = doc(db, 'instructors', iid);
        const iSnap = await getDoc(iRef);
        if (!iSnap.exists()) return;
        let courses = iSnap.data().assignedCourses || [];
        if (courses && typeof courses === 'object' && !Array.isArray(courses)) courses = Object.values(courses);
        if (!Array.isArray(courses)) courses = [];
        courses = courses.filter(c => c !== prevName);
        if (!courses.includes(name)) courses.push(name);
        await updateDoc(iRef, { assignedCourses: courses });
      } catch(e) { console.error(e); }
    }));
    const removedInstructorIds = prevAssignedInstructors.filter(pid => !assignedInstructors.includes(pid));
    await Promise.all(removedInstructorIds.map(async (iid) => {
      try {
        const iRef = doc(db, 'instructors', iid);
        const iSnap = await getDoc(iRef);
        if (!iSnap.exists()) return;
        let courses = iSnap.data().assignedCourses || [];
        if (courses && typeof courses === 'object' && !Array.isArray(courses)) courses = Object.values(courses);
        if (!Array.isArray(courses)) courses = [];
        courses = courses.filter(c => c !== prevName && c !== name);
        await updateDoc(iRef, { assignedCourses: courses });
      } catch(e) { console.error(e); }
    }));

    closeModal('schCourseModal');
    showToast('Course saved ✓');
  } catch(e) { errEl.textContent = 'Save failed: ' + e.message; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save'; }
});

document.getElementById('schCourseDeleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('schCourseId').value;
  if (!id) return;
  if (!(await showConfirm('Delete course', 'Delete this course?'))) return;
  try { await deleteDoc(doc(db, 'courses', id)); closeModal('schCourseModal'); showToast('Course deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
});

window.deleteSchCourse = async function(id){
  if (!(await showConfirm('Delete course', 'Delete this course?'))) return;
  try { await deleteDoc(doc(db, 'courses', id)); showToast('Course deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
};

// ============================================================
// LESSONS & QUIZZES (platform-wide — unchanged, still placeholders)
// ============================================================
// ============================================================
// LESSONS MODULE (platform-wide — global collection, no schoolId)
// ============================================================
let allLessonFolders = [];
let allLessonsFlat = [];
let currentLessonFolderPath = null;

let lessonFoldersUnsub = null;

function rebuildCentralLessons(rawLessons, rawFolders, allProgress){
  allLessonsFlat = rawLessons;
  allLessonsFlat.forEach(l => {
    const pcts = [];
    Object.values(allProgress).forEach(progressMap => {
      if (progressMap && progressMap[l.id] !== undefined) pcts.push(progressMap[l.id]);
    });
    l.avgCompletion = pcts.length ? Math.round(pcts.reduce((s,p) => s+p, 0) / pcts.length) : 0;
    l.watcherCount = pcts.length;
  });
  window._allLessons = allLessonsFlat;

  allLessonFolders = rawFolders.map(data => {
    const parentPath = data.parentPath || null;
    const path = data.path || (parentPath ? `${parentPath}/${data.name}` : data.name);
    return { id: data.id, name: data.name, description: data.description || '', parentPath, path, allowedSchoolIds: data.allowedSchoolIds || [] };
  }).sort((a,b) => a.name.localeCompare(b.name));

  renderLessonFolderView();
}

async function loadLessons(){
  try {
    const progressSnaps = await getDocs(collection(db, "lessonProgress"));
    const allProgress = {};
    progressSnaps.docs.forEach(d => { allProgress[d.id] = d.data(); });
    window._centralLessonProgress = allProgress;

    if (!lessonFoldersUnsub) {
      lessonFoldersUnsub = onSnapshot(collection(db, "lessonFolders"), (snap) => {
        const rawFolders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildCentralLessons(allLessonsFlat, rawFolders, window._centralLessonProgress || {});
      }, (e) => showToast('Could not load lesson folders: ' + e.message, true));
    }

    const lessonSnaps = await getDocs(collection(db, "lessons"));
    const rawLessons = lessonSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
    // seed folders once from a fresh read so first render doesn't wait on the listener
    const folderSnaps = await getDocs(collection(db, "lessonFolders"));
    const rawFolders = folderSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
    rebuildCentralLessons(rawLessons, rawFolders, allProgress);
  } catch(e) { console.error(e); showToast('Could not load lessons: ' + e.message, true); }
}

function renderLessonBreadcrumb(path){
  const segments = path.split('/');
  let acc = '';
  const parts = segments.map((seg, idx) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const isLast = idx === segments.length - 1;
    return isLast
      ? `<span class="crumb-current">${escapeHtml(seg)}</span>`
      : `<span class="crumb-link" onclick="window.openLessonFolder('${acc.replace(/'/g, "\\'")}')">${escapeHtml(seg)}</span>`;
  });
  const rootLink = `<span class="crumb-link" onclick="window.backToLessonFolders()">All folders</span>`;
  return [rootLink, ...parts].join(' <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> ');
}

function renderLessonFolderView(){
  const path = currentLessonFolderPath;
  const titleEl = document.getElementById("lessonsPageTitle");
  const subEl = document.getElementById("lessonsPageSub");
  const backBtn = document.getElementById("lessonBackBtn");
  const addLessonBtn = document.getElementById("lessonAddLessonBtn");
  const breadcrumbEl = document.getElementById("lessonBreadcrumb");
  const tableCard = document.getElementById("lessonTableCard");

  if (!path) {
    titleEl.textContent = "Video Lessons";
    subEl.textContent = "Select a course folder to manage its video lessons.";
    backBtn.style.display = "none";
    breadcrumbEl.style.display = "none";
    addLessonBtn.style.display = "none";
    tableCard.style.display = "none";
  } else {
    const segments = path.split('/');
    titleEl.textContent = segments[segments.length - 1];
    subEl.textContent = `Videos and subfolders inside "${path}".`;
    backBtn.style.display = "inline-flex";
    addLessonBtn.style.display = "inline-flex";
    breadcrumbEl.style.display = "block";
    breadcrumbEl.innerHTML = renderLessonBreadcrumb(path);
    tableCard.style.display = "block";
    renderLessonsTableForFolder(path);
  }

  const subfolders = allLessonFolders.filter(f => (f.parentPath || null) === path);
  const grid = document.getElementById("lessonFoldersGrid");
  if (!subfolders.length) {
    grid.innerHTML = path
      ? `<div class="empty-state" style="grid-column:1/-1;">No subfolders here.</div>`
      : `<div class="empty-state" style="grid-column:1/-1;">No folders yet. Create one to get started.</div>`;
    return;
  }
  grid.innerHTML = subfolders.map(f => {
    const videoCount = allLessonsFlat.filter(l => (l.folder || '') === f.path).length;
    const subfolderCount = allLessonFolders.filter(sf => (sf.parentPath || null) === f.path).length;
    const count = videoCount + subfolderCount;
    return `
      <div class="stat-card" style="cursor:pointer;position:relative;padding-top:34px;" onclick="window.openLessonFolder('${f.path.replace(/'/g, "\\'")}')">
        <button class="icon-btn" title="Edit folder" style="position:absolute;top:10px;right:44px;" onclick="event.stopPropagation();window.openEditFolderModal('${f.id}')"><i class="fas fa-pen" style="font-size:11px;"></i></button>
        <button class="icon-btn danger" title="Delete folder" style="position:absolute;top:10px;right:10px;" onclick="event.stopPropagation();window.deleteLessonFolder('${f.id}','${f.path.replace(/'/g, "\\'")}')"><i class="fas fa-trash" style="font-size:11px;"></i></button>
        <p class="label"><i class="fas fa-folder" style="color:var(--amber);margin-right:6px;"></i>${escapeHtml(f.name)}</p>
        <p class="value" style="font-size:18px;">${count} file${count===1?'':'s'}</p>
        ${f.description ? `<p class="sub">${escapeHtml(f.description)}</p>` : ''}
      </div>`;
  }).join('');
}

window.openLessonFolder = function(path){ currentLessonFolderPath = path; renderLessonFolderView(); };
window.backToLessonFolders = function(){ currentLessonFolderPath = null; renderLessonFolderView(); };
window.lessonFolderGoUp = function(){
  if (!currentLessonFolderPath) return;
  const idx = currentLessonFolderPath.lastIndexOf('/');
  currentLessonFolderPath = idx === -1 ? null : currentLessonFolderPath.substring(0, idx);
  renderLessonFolderView();
};

window.deleteLessonFolder = async function(folderId, folderPath){
  const hasVideos = allLessonsFlat.some(l => (l.folder || '') === folderPath);
  const hasSubfolders = allLessonFolders.some(f => (f.parentPath || null) === folderPath);
  const warning = (hasVideos || hasSubfolders)
    ? "This folder contains videos or subfolders. Deleting it will not delete those items, but they will become orphaned. Delete anyway?"
    : "Delete this folder?";
  if (!(await showConfirm("Delete folder", warning))) return;
  try {
    await deleteDoc(doc(db, "lessonFolders", folderId));
    showToast("Folder deleted.");
    await loadLessons();
  } catch(e) { showToast("Could not delete folder: " + e.message, true); }
};

function renderLessonsTableForFolder(path){
  const tbody = document.getElementById("lessonsTable");
  if (!tbody) return;
  const lessons = allLessonsFlat.filter(l => (l.folder || '') === path);
  if (!lessons.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No lessons in this folder yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = lessons.map(l => `<tr>
    <td><strong>${escapeHtml(l.title)}</strong></td>
    <td><span class="badge">${escapeHtml(l.category || 'Theory')}</span></td>
    <td style="color:var(--slate-dim);">${escapeHtml(l.duration || '—')}</td>
    <td style="color:var(--amber);">${(l.avgCompletion !== undefined) ? l.avgCompletion + '% (' + l.watcherCount + ')' : '—'}</td>
    <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(l.createdAt)}</td>
    <td class="row-actions">
      <button class="icon-btn" title="View / edit" onclick="window.openEditLessonModal('${l.id}')"><i class="fas fa-eye"></i></button>
      <button class="icon-btn danger" title="Delete" onclick="window.deleteLesson('${l.id}')"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
}

window.openAddFolderModal = async function(){
  const isTopLevel = !currentLessonFolderPath;
  document.getElementById("newFolderCourseGroup").style.display = isTopLevel ? "block" : "none";
  document.getElementById("newFolderTitleGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("newFolderDescGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("addFolderModalTitle").textContent = isTopLevel ? "New course folder" : "New subfolder";
  document.getElementById("newFolderTitle").value = '';
  document.getElementById("newFolderDescription").value = '';
  const hint = document.getElementById("newFolderParentHint");
  if (hint) hint.textContent = isTopLevel ? "This folder will be created at the top level." : `This subfolder will be created inside "${currentLessonFolderPath}".`;
  if (isTopLevel) {
    const sel = document.getElementById("newFolderCourseSelect");
    sel.innerHTML = '<option value="">Select course…</option>';
    try {
      const coursesSnap = await getDocs(collection(db, "courses"));
      coursesSnap.docs.forEach(d => {
        const name = d.data().name || d.data().title;
        if (name) sel.innerHTML += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      });
    } catch(e) { console.error(e); }
  }
  renderSchoolsChecklist("newFolderSchoolsList", []);
  openModal("addFolderModal");
};

window.createLessonFolder = async function(){
  const isTopLevel = !currentLessonFolderPath;
  const parentPath = currentLessonFolderPath || null;
  let name, description = '';
  if (isTopLevel) {
    name = document.getElementById("newFolderCourseSelect").value.trim();
    if (!name) { showToast("Select a course.", true); return; }
  } else {
    name = document.getElementById("newFolderTitle").value.trim();
    description = document.getElementById("newFolderDescription").value.trim();
    if (!name) { showToast("Enter a subfolder title.", true); return; }
  }
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (allLessonFolders.some(f => f.path.toLowerCase() === path.toLowerCase())) {
    showToast("A folder with that name already exists here.", true);
    return;
  }
  const allowedSchoolIds = getCheckedSchoolIds("newFolderSchoolsList");
  try {
    await addDoc(collection(db, "lessonFolders"), { name, description, parentPath, path, allowedSchoolIds, createdAt: serverTimestamp() });
    closeModal("addFolderModal");
    showToast("Folder created ✓");
    await loadLessons();
  } catch(e) { showToast("Could not create folder: " + e.message, true); }
};

window.openEditFolderModal = function(folderId){
  const folder = allLessonFolders.find(f => f.id === folderId);
  if (!folder) return showToast("Folder not found.", true);
  document.getElementById("editFolderId").value = folder.id;
  document.getElementById("editFolderTitle").value = folder.name || '';
  document.getElementById("editFolderDescription").value = folder.description || '';
  renderSchoolsChecklist("editFolderSchoolsList", folder.allowedSchoolIds || []);
  openModal("editFolderModal");
};

window.updateLessonFolder = async function(){
  const folderId = document.getElementById("editFolderId").value;
  const newName = document.getElementById("editFolderTitle").value.trim();
  const newDescription = document.getElementById("editFolderDescription").value.trim();
  if (!newName) { showToast("Folder name is required.", true); return; }
  const folder = allLessonFolders.find(f => f.id === folderId);
  if (!folder) { showToast("Folder not found.", true); return; }
  const oldPath = folder.path;
  const newPath = folder.parentPath ? `${folder.parentPath}/${newName}` : newName;
  if (newPath !== oldPath && allLessonFolders.some(f => f.id !== folderId && f.path.toLowerCase() === newPath.toLowerCase())) {
    showToast("A folder with that name already exists here.", true);
    return;
  }
  const allowedSchoolIds = getCheckedSchoolIds("editFolderSchoolsList");
  const btn = document.querySelector("#editFolderModal .btn-primary");
  const originalHTML = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    await updateDoc(doc(db, "lessonFolders", folderId), { name: newName, description: newDescription, path: newPath, allowedSchoolIds });
    if (newPath !== oldPath) {
      const affectedSubfolders = allLessonFolders.filter(f => f.id !== folderId && f.path.startsWith(oldPath + '/'));
      for (const sf of affectedSubfolders) {
        const updatedPath = newPath + sf.path.slice(oldPath.length);
        const updatedParentPath = sf.parentPath === oldPath ? newPath : (newPath + sf.parentPath.slice(oldPath.length));
        await updateDoc(doc(db, "lessonFolders", sf.id), { path: updatedPath, parentPath: updatedParentPath });
      }
      const affectedLessons = allLessonsFlat.filter(l => l.folder === oldPath || (l.folder || '').startsWith(oldPath + '/'));
      for (const lesson of affectedLessons) {
        const updatedFolder = newPath + lesson.folder.slice(oldPath.length);
        await updateDoc(doc(db, "lessons", lesson.id), { folder: updatedFolder });
      }
      if (currentLessonFolderPath === oldPath) currentLessonFolderPath = newPath;
      else if (currentLessonFolderPath && currentLessonFolderPath.startsWith(oldPath + '/')) {
        currentLessonFolderPath = newPath + currentLessonFolderPath.slice(oldPath.length);
      }
    }
    closeModal("editFolderModal");
    showToast("Folder updated ✓");
    await loadLessons();
  } catch(e) { showToast("Could not update folder: " + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = originalHTML; }
};

function populateLessonFolderSelect(selectId, selectedValue){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const sorted = [...allLessonFolders].sort((a,b) => a.path.localeCompare(b.path));
  sel.innerHTML = sorted.map(f => {
    const depth = f.path.split('/').length - 1;
    const indent = depth > 0 ? '— '.repeat(depth) : '';
    return `<option value="${escapeHtml(f.path)}">${indent}${escapeHtml(f.name)}</option>`;
  }).join('');
  if (selectedValue) sel.value = selectedValue;
}

function courseFromFolderPath(path){ return (path || '').split('/')[0] || ''; }

function populateQuizAssignSelect(selectId, selectedValue, courseName){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const quizzes = window._allQuizzes || allQuizzesFlat || [];
  const scoped = courseName
    ? quizzes.filter(q => (q.courseName || (q.categoryPath || '').split('/')[0] || '').trim().toLowerCase() === courseName.trim().toLowerCase())
    : quizzes;
  sel.innerHTML = '<option value="">No quiz — don\'t auto-launch</option>' +
    (scoped.length
      ? scoped.map(q => `<option value="${q.id}">${escapeHtml(q.title || 'Untitled quiz')} (${escapeHtml(q.categoryPath || '')})</option>`).join('')
      : `<option value="" disabled>No quizzes found for this course</option>`);
  sel.value = selectedValue || '';
}

window.refreshLessonQuizOptions = function(folderSelectId, quizSelectId){
  const folderVal = document.getElementById(folderSelectId)?.value || '';
  populateQuizAssignSelect(quizSelectId, '', courseFromFolderPath(folderVal));
};

window.openAddLessonModal = function(){
  document.getElementById("lessonTitle").value = '';
  document.getElementById("lessonDuration").value = '';
  document.getElementById("lessonVideoFile").value = '';
  document.getElementById("lessonThumbFile").value = '';
  document.getElementById("lessonVideoPreview").style.display = 'none';
  document.getElementById("lessonThumbPreview").style.display = 'none';
  document.getElementById("lessonVideoText").textContent = 'Tap to upload lesson video (MP4)';
  document.getElementById("lessonThumbText").textContent = 'Tap to upload thumbnail (leave blank for auto)';
  populateLessonFolderSelect("lessonFolder", currentLessonFolderPath || (allLessonFolders[0] && allLessonFolders[0].path));
  populateQuizAssignSelect("lessonAssignedQuiz", "", courseFromFolderPath(document.getElementById("lessonFolder").value));
  openModal("addLessonModal");
};

window.openLessonQuizPrompt = function(){ openModal("lessonQuizPromptModal"); };
window.handleLessonQuizPromptNo = function(){ closeModal("lessonQuizPromptModal"); window.openAddLessonModal(); };
window.handleLessonQuizPromptYes = function(){
  closeModal("lessonQuizPromptModal");
  window.showPage('quizzes', document.querySelector('#navTopLevel .nav-link[data-page="quizzes"]'));
};

window.previewLessonVideo = function(input){
  const file = input.files[0]; if (!file) return;
  const video = document.getElementById("lessonVideoPreview");
  video.src = URL.createObjectURL(file); video.style.display = "block";
  document.getElementById("lessonVideoText").textContent = file.name;
};
window.previewLessonThumb = function(input){
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById("lessonThumbPreview");
    img.src = e.target.result; img.style.display = "block";
    document.getElementById("lessonThumbText").textContent = file.name;
  };
  reader.readAsDataURL(file);
};
window.previewEditLessonVideo = function(input){
  const file = input.files[0]; if (!file) return;
  const video = document.getElementById("editLessonVideoPreview");
  video.src = URL.createObjectURL(file); video.style.display = "block";
  document.getElementById("editLessonVideoText").textContent = file.name;
};
window.previewEditLessonThumb = function(input){
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById("editLessonThumbPreview");
    img.src = e.target.result; img.style.display = "block";
    document.getElementById("editLessonThumbText").textContent = file.name;
  };
  reader.readAsDataURL(file);
};
window.closeEditLessonModal = function(){
  const video = document.getElementById("editLessonVideoPreview");
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  closeModal("editLessonModal");
};

function uploadToCloudinaryWithProgress(url, formData, onProgress){
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded/e.total)*100)); };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error?.message || "Upload failed"));
      } catch(e) { reject(e); }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

window.addLesson = async function(){
  const title    = document.getElementById("lessonTitle").value.trim();
  const folder   = document.getElementById("lessonFolder").value;
  const category = document.getElementById("lessonCategory").value;
  const duration = document.getElementById("lessonDuration").value.trim();
  const videoFile = document.getElementById("lessonVideoFile").files[0];
  const thumbFile = document.getElementById("lessonThumbFile").files[0];
  const assignedQuizId = document.getElementById("lessonAssignedQuiz").value || null;

  if (!title || !videoFile) { showToast("Title and video file are required.", true); return; }
  if (!folder) { showToast("Select a course folder.", true); return; }

  const btn = document.querySelector("#addLessonModal .btn-primary");
  const originalHTML = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading video…';

  const progWrap = document.getElementById("lessonUploadProgressWrap");
  const progBar = document.getElementById("lessonUploadProgressBar");
  const progPct = document.getElementById("lessonUploadProgressPct");
  const progLabel = document.getElementById("lessonUploadProgressLabel");
  progWrap.style.display = "block"; progBar.style.width = "0%"; progPct.textContent = "0%"; progLabel.textContent = "Uploading video…";

  try {
    const cloudinaryFolder = `lessons/${folder}`;
    const videoFd = new FormData();
    videoFd.append("file", videoFile);
    videoFd.append("upload_preset", LESSON_UPLOAD_PRESET);
    videoFd.append("resource_type", "video");
    videoFd.append("folder", cloudinaryFolder);
    const videoData = await uploadToCloudinaryWithProgress(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`, videoFd,
      (pct) => { progBar.style.width = pct + "%"; progPct.textContent = pct + "%"; }
    );
    const videoUrl = videoData.secure_url;
    const videoDurationSec = videoData.duration || null;

    let thumbUrl = "";
    if (thumbFile) {
      progLabel.textContent = "Uploading thumbnail…"; progBar.style.width = "0%"; progPct.textContent = "0%";
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading thumbnail…';
      const thumbFd = new FormData();
      thumbFd.append("file", thumbFile);
      thumbFd.append("upload_preset", LESSON_UPLOAD_PRESET);
      thumbFd.append("folder", cloudinaryFolder);
      const thumbData = await uploadToCloudinaryWithProgress(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, thumbFd,
        (pct) => { progBar.style.width = pct + "%"; progPct.textContent = pct + "%"; }
      );
      thumbUrl = thumbData.secure_url;
    } else {
      thumbUrl = videoUrl.replace('/video/upload/', '/video/upload/so_1,f_jpg/').replace(/\.[^/.]+$/, '.jpg');
    }

    progLabel.textContent = "Saving…"; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    await addDoc(collection(db, "lessons"), {
      title, videoUrl, category, duration, folder, videoDurationSec,
      thumbnailUrl: thumbUrl, assignedQuizId, createdAt: serverTimestamp()
    });

    closeModal("addLessonModal");
    showToast("Lesson published ✓");
    await loadLessons();
    window.openLessonFolder(folder);
  } catch(e) { showToast("Could not publish lesson: " + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = originalHTML; progWrap.style.display = "none"; }
};

window.openEditLessonModal = function(lessonId){
  const lesson = (window._allLessons || []).find(l => l.id === lessonId);
  if (!lesson) return showToast("Lesson not found.", true);

  document.getElementById("editLessonId").value = lesson.id;
  document.getElementById("editLessonTitle").value = lesson.title || '';
  document.getElementById("editLessonCategory").value = lesson.category || 'Theory';
  document.getElementById("editLessonDuration").value = lesson.duration || '';
  document.getElementById("editLessonVideoFile").value = '';
  document.getElementById("editLessonThumbFile").value = '';
  document.getElementById("editLessonVideoText").textContent = 'Tap to replace video';
  document.getElementById("editLessonThumbText").textContent = 'Tap to replace thumbnail';
  populateLessonFolderSelect("editLessonFolder", lesson.folder || currentLessonFolderPath || (allLessonFolders[0] && allLessonFolders[0].path));
  populateQuizAssignSelect("editLessonAssignedQuiz", lesson.assignedQuizId || "", courseFromFolderPath(document.getElementById("editLessonFolder").value));

  const videoPreview = document.getElementById("editLessonVideoPreview");
  videoPreview.src = lesson.videoUrl || ''; videoPreview.style.display = lesson.videoUrl ? 'block' : 'none';
  const thumbPreview = document.getElementById("editLessonThumbPreview");
  thumbPreview.src = lesson.thumbnailUrl || ''; thumbPreview.style.display = lesson.thumbnailUrl ? 'block' : 'none';

  const avgEl = document.getElementById("editLessonAvgCompletion");
  if (avgEl) avgEl.textContent = lesson.watcherCount ? `— Avg. ${lesson.avgCompletion || 0}% across ${lesson.watcherCount} student${lesson.watcherCount > 1 ? 's' : ''} (all schools)` : '— No watch data yet';

  openModal("editLessonModal");
};

window.updateLesson = async function(){
  const id       = document.getElementById("editLessonId").value;
  const title    = document.getElementById("editLessonTitle").value.trim();
  const folder   = document.getElementById("editLessonFolder").value;
  const category = document.getElementById("editLessonCategory").value;
  const duration = document.getElementById("editLessonDuration").value.trim();
  const videoFile = document.getElementById("editLessonVideoFile").files[0];
  const thumbFile = document.getElementById("editLessonThumbFile").files[0];
  const assignedQuizId = document.getElementById("editLessonAssignedQuiz").value || null;

  if (!title) { showToast("Title is required.", true); return; }
  if (!folder) { showToast("Select a course folder.", true); return; }

  const btn = document.querySelector("#editLessonModal .btn-primary");
  const originalHTML = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  const progWrap = document.getElementById("editLessonUploadProgressWrap");
  const progBar = document.getElementById("editLessonUploadProgressBar");
  const progPct = document.getElementById("editLessonUploadProgressPct");
  const progLabel = document.getElementById("editLessonUploadProgressLabel");

  try {
    const updates = { title, category, duration, folder, assignedQuizId };
    const cloudinaryFolder = `lessons/${folder}`;

    if (videoFile) {
      progWrap.style.display = "block"; progBar.style.width = "0%"; progPct.textContent = "0%"; progLabel.textContent = "Uploading video…";
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading video…';
      const videoFd = new FormData();
      videoFd.append("file", videoFile);
      videoFd.append("upload_preset", LESSON_UPLOAD_PRESET);
      videoFd.append("resource_type", "video");
      videoFd.append("folder", cloudinaryFolder);
      const videoData = await uploadToCloudinaryWithProgress(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`, videoFd,
        (pct) => { progBar.style.width = pct + "%"; progPct.textContent = pct + "%"; }
      );
      updates.videoUrl = videoData.secure_url;
      updates.videoDurationSec = videoData.duration || null;
      if (!thumbFile) updates.thumbnailUrl = videoData.secure_url.replace('/video/upload/', '/video/upload/so_1,f_jpg/').replace(/\.[^/.]+$/, '.jpg');
    }
    if (thumbFile) {
      progWrap.style.display = "block"; progBar.style.width = "0%"; progPct.textContent = "0%"; progLabel.textContent = "Uploading thumbnail…";
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading thumbnail…';
      const thumbFd = new FormData();
      thumbFd.append("file", thumbFile);
      thumbFd.append("upload_preset", LESSON_UPLOAD_PRESET);
      thumbFd.append("folder", cloudinaryFolder);
      const thumbData = await uploadToCloudinaryWithProgress(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, thumbFd,
        (pct) => { progBar.style.width = pct + "%"; progPct.textContent = pct + "%"; }
      );
      updates.thumbnailUrl = thumbData.secure_url;
    }

    progLabel.textContent = "Saving…"; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    await updateDoc(doc(db, "lessons", id), updates);

    closeModal("editLessonModal");
    showToast("Lesson updated ✓");
    await loadLessons();
    window.openLessonFolder(folder);
  } catch(e) { showToast("Could not update lesson: " + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = originalHTML; progWrap.style.display = "none"; }
};

window.deleteLesson = async function(id){
  if (!(await showConfirm("Delete lesson", "Delete this lesson?"))) return;
  try { await deleteDoc(doc(db, "lessons", id)); await loadLessons(); showToast("Lesson removed."); }
  catch(e) { showToast("Delete failed: " + e.message, true); }
};

// ============================================================
// QUIZZES MODULE (platform-wide — global collection, no schoolId)
// ============================================================
let allQuizCategories = [];
let allQuizzesFlat = [];
let currentQuizCategoryPath = null;
let currentQuizQuestions = [];

let quizCategoriesUnsub = null;

function rebuildCentralQuizCategories(rawCats){
  allQuizCategories = rawCats.map(data => {
    const parentPath = data.parentPath || null;
    const path = data.path || (parentPath ? `${parentPath}/${data.name}` : data.name);
    return { id: data.id, name: data.name, description: data.description || '', parentPath, path, allowedSchoolIds: data.allowedSchoolIds || [] };
  }).sort((a,b) => a.name.localeCompare(b.name));
  renderQuizFolderView();
}

async function loadQuizzes(){
  try {
    if (!quizCategoriesUnsub) {
      quizCategoriesUnsub = onSnapshot(collection(db, "quizCategories"), (snap) => {
        rebuildCentralQuizCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (e) => showToast('Could not load quiz categories: ' + e.message, true));
    }
    const [catSnaps, quizSnaps] = await Promise.all([
      getDocs(collection(db, "quizCategories")),
      getDocs(collection(db, "quizzes"))
    ]);
    rebuildCentralQuizCategories(catSnaps.docs.map(d => ({ id: d.id, ...d.data() })));
    allQuizzesFlat = quizSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
    window._allQuizzes = allQuizzesFlat;
    renderQuizFolderView();
  } catch(e) { console.error(e); showToast('Could not load quizzes: ' + e.message, true); }
}

function renderQuizBreadcrumb(path){
  const segments = path.split('/');
  let acc = '';
  const parts = segments.map((seg, idx) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const isLast = idx === segments.length - 1;
    return isLast
      ? `<span class="crumb-current">${escapeHtml(seg)}</span>`
      : `<span class="crumb-link" onclick="window.openQuizFolder('${acc.replace(/'/g, "\\'")}')">${escapeHtml(seg)}</span>`;
  });
  const rootLink = `<span class="crumb-link" onclick="window.backToQuizFolders()">All categories</span>`;
  return [rootLink, ...parts].join(' <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> ');
}

function renderQuizFolderView(){
  const path = currentQuizCategoryPath;
  const titleEl = document.getElementById("quizPageTitle");
  const subEl = document.getElementById("quizPageSub");
  const backBtn = document.getElementById("quizBackBtn");
  const addQuizBtn = document.getElementById("quizAddQuizBtn");
  const breadcrumbEl = document.getElementById("quizBreadcrumb");
  const tableCard = document.getElementById("quizTableCard");
  const isLeaf = path && path.split('/').length >= 2;

  if (!path) {
    titleEl.textContent = "Quizzes";
    subEl.textContent = "Select a course folder to manage its quiz categories.";
    backBtn.style.display = "none"; breadcrumbEl.style.display = "none";
    addQuizBtn.style.display = "none"; tableCard.style.display = "none";
  } else {
    const segments = path.split('/');
    titleEl.textContent = segments[segments.length - 1];
    subEl.textContent = isLeaf ? `Quizzes inside "${path}".` : `Categories inside "${path}".`;
    backBtn.style.display = "inline-flex";
    breadcrumbEl.style.display = "block"; breadcrumbEl.innerHTML = renderQuizBreadcrumb(path);
    addQuizBtn.style.display = isLeaf ? "inline-flex" : "none";
    tableCard.style.display = isLeaf ? "block" : "none";
    if (isLeaf) renderQuizzesTableForCategory(path);
  }

  const subfolders = allQuizCategories.filter(f => (f.parentPath || null) === path);
  const grid = document.getElementById("quizFoldersGrid");
  if (!subfolders.length) {
    grid.innerHTML = path
      ? `<div class="empty-state" style="grid-column:1/-1;">No subfolders here.</div>`
      : `<div class="empty-state" style="grid-column:1/-1;">No course folders yet. Create one to get started.</div>`;
    grid.style.display = isLeaf ? "none" : "grid";
    return;
  }
  grid.style.display = "grid";
  grid.innerHTML = subfolders.map(f => {
    const quizCount = allQuizzesFlat.filter(q => (q.categoryPath || '') === f.path).length;
    const subfolderCount = allQuizCategories.filter(sf => (sf.parentPath || null) === f.path).length;
    const count = quizCount + subfolderCount;
    return `
      <div class="stat-card" style="cursor:pointer;position:relative;padding-top:34px;" onclick="window.openQuizFolder('${f.path.replace(/'/g, "\\'")}')">
        <button class="icon-btn" title="Edit" style="position:absolute;top:10px;right:44px;" onclick="event.stopPropagation();window.openEditQuizCategoryModal('${f.id}')"><i class="fas fa-pen" style="font-size:11px;"></i></button>
        <button class="icon-btn danger" title="Delete" style="position:absolute;top:10px;right:10px;" onclick="event.stopPropagation();window.deleteQuizCategory('${f.id}','${f.path.replace(/'/g, "\\'")}')"><i class="fas fa-trash" style="font-size:11px;"></i></button>
        <p class="label"><i class="fas fa-folder" style="color:var(--amber);margin-right:6px;"></i>${escapeHtml(f.name)}</p>
        <p class="value" style="font-size:18px;">${count} item${count===1?'':'s'}</p>
        ${f.description ? `<p class="sub">${escapeHtml(f.description)}</p>` : ''}
      </div>`;
  }).join('');
}

window.openQuizFolder = function(path){ currentQuizCategoryPath = path; renderQuizFolderView(); };
window.backToQuizFolders = function(){ currentQuizCategoryPath = null; renderQuizFolderView(); };
window.quizFolderGoUp = function(){
  if (!currentQuizCategoryPath) return;
  const idx = currentQuizCategoryPath.lastIndexOf('/');
  currentQuizCategoryPath = idx === -1 ? null : currentQuizCategoryPath.substring(0, idx);
  renderQuizFolderView();
};

window.deleteQuizCategory = async function(id, path){
  const hasQuizzes = allQuizzesFlat.some(q => (q.categoryPath || '') === path);
  const hasSubfolders = allQuizCategories.some(f => (f.parentPath || null) === path);
  const warning = (hasQuizzes || hasSubfolders)
    ? "This folder contains quizzes or subfolders. Deleting it won't delete those, but they'll be orphaned. Delete anyway?"
    : "Delete this folder?";
  if (!(await showConfirm("Delete folder", warning))) return;
  try { await deleteDoc(doc(db, "quizCategories", id)); showToast("Folder deleted."); await loadQuizzes(); }
  catch(e) { showToast("Could not delete folder: " + e.message, true); }
};

window.openAddQuizCategoryModal = async function(){
  document.getElementById("editQuizCategoryId").value = '';
  renderSchoolsChecklist("newQuizCategorySchoolsList", []);
  const isTopLevel = !currentQuizCategoryPath;
  document.getElementById("newQuizCategoryCourseGroup").style.display = isTopLevel ? "block" : "none";
  document.getElementById("newQuizCategoryTitleGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("newQuizCategoryDescGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("addQuizCategoryModalTitle").textContent = isTopLevel ? "New course folder" : "New category";
  document.getElementById("newQuizCategoryTitle").value = '';
  document.getElementById("newQuizCategoryDescription").value = '';
  document.getElementById("quizCategorySaveBtn").innerHTML = '<i class="fas fa-folder-plus"></i> Create';
  const hint = document.getElementById("newQuizCategoryParentHint");
  if (hint) hint.textContent = isTopLevel ? "This folder will be created at the top level." : `This category will be created inside "${currentQuizCategoryPath}".`;
  if (isTopLevel) {
    const sel = document.getElementById("newQuizCategoryCourseSelect");
    sel.innerHTML = '<option value="">Select course…</option>';
    try {
      const coursesSnap = await getDocs(collection(db, "courses"));
      coursesSnap.docs.forEach(d => {
        const name = d.data().name || d.data().title;
        if (name) sel.innerHTML += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      });
    } catch(e) { console.error(e); }
  }
  openModal("addQuizCategoryModal");
};

window.openEditQuizCategoryModal = async function(id){
  const cat = allQuizCategories.find(f => f.id === id);
  if (!cat) return showToast("Category not found.", true);
  document.getElementById("editQuizCategoryId").value = id;
  renderSchoolsChecklist("newQuizCategorySchoolsList", cat.allowedSchoolIds || []);
  const isTopLevel = !cat.parentPath;
  document.getElementById("newQuizCategoryCourseGroup").style.display = isTopLevel ? "block" : "none";
  document.getElementById("newQuizCategoryTitleGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("newQuizCategoryDescGroup").style.display = isTopLevel ? "none" : "block";
  document.getElementById("addQuizCategoryModalTitle").textContent = isTopLevel ? "Edit course folder" : "Edit category";
  document.getElementById("newQuizCategoryTitle").value = cat.name || '';
  document.getElementById("newQuizCategoryDescription").value = cat.description || '';
  document.getElementById("quizCategorySaveBtn").innerHTML = '<i class="fas fa-save"></i> Save';
  if (isTopLevel) {
    const sel = document.getElementById("newQuizCategoryCourseSelect");
    sel.innerHTML = '<option value="">Select course…</option>';
    try {
      const coursesSnap = await getDocs(collection(db, "courses"));
      coursesSnap.docs.forEach(d => {
        const name = d.data().name || d.data().title;
        if (name) sel.innerHTML += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      });
    } catch(e) { console.error(e); }
    sel.value = cat.name || '';
    const hint = document.getElementById("newQuizCategoryParentHint");
    if (hint) hint.textContent = "Changing the course will move this folder and everything inside it to the new course.";
  }
  openModal("addQuizCategoryModal");
};

window.saveQuizCategory = async function(){
  const editId = document.getElementById("editQuizCategoryId").value;
  if (editId) {
    const cat = allQuizCategories.find(f => f.id === editId);
    const isTopLevel = !cat.parentPath;
    if (isTopLevel) {
      const newCourseName = document.getElementById("newQuizCategoryCourseSelect").value.trim();
      if (!newCourseName) { showToast("Select a course.", true); return; }
      const oldPath = cat.path;
      const newPath = newCourseName;
      if (newPath !== oldPath && allQuizCategories.some(f => f.id !== editId && f.path.toLowerCase() === newPath.toLowerCase())) {
        showToast("A folder for that course already exists.", true);
        return;
      }
      const btn = document.getElementById("quizCategorySaveBtn");
      const originalHTML = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
      const topAllowedSchoolIds = getCheckedSchoolIds("newQuizCategorySchoolsList");
      try {
        await updateDoc(doc(db, "quizCategories", editId), { name: newCourseName, path: newPath, allowedSchoolIds: topAllowedSchoolIds });
        if (newPath !== oldPath) {
          const affectedSubcats = allQuizCategories.filter(f => f.id !== editId && f.path.startsWith(oldPath + '/'));
          for (const sf of affectedSubcats) {
            const updatedPath = newPath + sf.path.slice(oldPath.length);
            const updatedParentPath = sf.parentPath === oldPath ? newPath : (newPath + sf.parentPath.slice(oldPath.length));
            await updateDoc(doc(db, "quizCategories", sf.id), { path: updatedPath, parentPath: updatedParentPath });
          }
          const affectedQuizzes = allQuizzesFlat.filter(q => q.categoryPath === oldPath || (q.categoryPath || '').startsWith(oldPath + '/'));
          for (const quiz of affectedQuizzes) {
            const updatedCategoryPath = newPath + quiz.categoryPath.slice(oldPath.length);
            await updateDoc(doc(db, "quizzes", quiz.id), { categoryPath: updatedCategoryPath, courseName: newCourseName });
          }
          if (currentQuizCategoryPath === oldPath) currentQuizCategoryPath = newPath;
          else if (currentQuizCategoryPath && currentQuizCategoryPath.startsWith(oldPath + '/')) {
            currentQuizCategoryPath = newPath + currentQuizCategoryPath.slice(oldPath.length);
          }
        }
        closeModal("addQuizCategoryModal");
        showToast("Course folder updated ✓");
        await loadQuizzes();
      } catch(e) { showToast("Update failed: " + e.message, true); }
      finally { btn.disabled = false; btn.innerHTML = originalHTML; }
      return;
    }
    const newName = document.getElementById("newQuizCategoryTitle").value.trim();
    const newDesc = document.getElementById("newQuizCategoryDescription").value.trim();
    if (!newName) { showToast("Name is required.", true); return; }
    const newPath = cat.parentPath ? `${cat.parentPath}/${newName}` : newName;
    const subAllowedSchoolIds = getCheckedSchoolIds("newQuizCategorySchoolsList");
    try {
      await updateDoc(doc(db, "quizCategories", editId), { name: newName, description: newDesc, path: newPath, allowedSchoolIds: subAllowedSchoolIds });
      closeModal("addQuizCategoryModal");
      showToast("Category updated ✓");
      await loadQuizzes();
    } catch(e) { showToast("Update failed: " + e.message, true); }
    return;
  }
  const isTopLevel = !currentQuizCategoryPath;
  const parentPath = currentQuizCategoryPath || null;
  let name, description = '';
  if (isTopLevel) {
    name = document.getElementById("newQuizCategoryCourseSelect").value.trim();
    if (!name) { showToast("Select a course.", true); return; }
  } else {
    name = document.getElementById("newQuizCategoryTitle").value.trim();
    description = document.getElementById("newQuizCategoryDescription").value.trim();
    if (!name) { showToast("Enter a category name.", true); return; }
  }
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (allQuizCategories.some(f => f.path.toLowerCase() === path.toLowerCase())) {
    showToast("A folder with that name already exists here.", true);
    return;
  }
  const newCatAllowedSchoolIds = getCheckedSchoolIds("newQuizCategorySchoolsList");
  try {
    await addDoc(collection(db, "quizCategories"), { name, description, parentPath, path, allowedSchoolIds: newCatAllowedSchoolIds, createdAt: serverTimestamp() });
    closeModal("addQuizCategoryModal");
    showToast("Folder created ✓");
    await loadQuizzes();
  } catch(e) { showToast("Could not create folder: " + e.message, true); }
};

function renderQuizzesTableForCategory(path){
  const tbody = document.getElementById("adminQuizTable");
  const quizzes = allQuizzesFlat.filter(q => (q.categoryPath || '') === path);
  if (!quizzes.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No quizzes in this category yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = quizzes.map(q => `<tr>
    <td><strong>${escapeHtml(q.title)}</strong></td>
    <td style="color:var(--slate-dim);">${q.questionCount || 0}</td>
    <td><span class="badge">${q.passMark || 60}%</span></td>
    <td style="color:var(--amber);">${q.avgScore != null ? q.avgScore + '%' : '—'}</td>
    <td style="color:var(--slate-dim);">${q.completionPct != null ? q.completionPct + '%' : '—'}</td>
    <td class="row-actions">
      <button class="icon-btn" title="Manage" onclick="window.openEditQuizModal('${q.id}')"><i class="fas fa-eye"></i></button>
      <button class="icon-btn danger" title="Delete" onclick="window.deleteQuiz('${q.id}')"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
}

window.openAddQuizModal = function(){
  if (!currentQuizCategoryPath || currentQuizCategoryPath.split('/').length < 2) {
    showToast("Open a category first (inside a course folder).", true);
    return;
  }
  document.getElementById("editQuizId").value = '';
  document.getElementById("editQuizTitle").value = '';
  document.getElementById("editQuizPassMark").value = 60;
  document.getElementById("editQuizModalTitle").textContent = "New quiz";
  document.getElementById("quizQuestionsSection").style.display = "none";
  document.getElementById("quizDeleteBtn").style.display = "none";
  openModal("editQuizModal");
};

window.openEditQuizModal = async function(quizId){
  const q = allQuizzesFlat.find(x => x.id === quizId);
  if (!q) return showToast("Quiz not found.", true);
  document.getElementById("editQuizId").value = q.id;
  document.getElementById("editQuizTitle").value = q.title || '';
  document.getElementById("editQuizPassMark").value = q.passMark || 60;
  document.getElementById("editQuizModalTitle").textContent = "Edit quiz";
  document.getElementById("quizQuestionsSection").style.display = "block";
  document.getElementById("quizDeleteBtn").style.display = "inline-flex";
  await loadQuizQuestions(quizId);
  openModal("editQuizModal");
};

window.saveQuizMeta = async function(){
  const id = document.getElementById("editQuizId").value;
  const title = document.getElementById("editQuizTitle").value.trim();
  const passMark = parseInt(document.getElementById("editQuizPassMark").value) || 60;
  if (!title) { showToast("Quiz title is required.", true); return; }
  if (id) {
    try { await updateDoc(doc(db, "quizzes", id), { title, passMark }); showToast("Quiz updated ✓"); await loadQuizzes(); }
    catch(e) { showToast("Update failed: " + e.message, true); }
    return;
  }
  const segments = currentQuizCategoryPath.split('/');
  try {
    const ref = await addDoc(collection(db, "quizzes"), {
      title, passMark, courseName: segments[0], categoryName: segments[segments.length - 1],
      categoryPath: currentQuizCategoryPath, questionCount: 0, avgScore: null, completionPct: null,
      createdAt: serverTimestamp()
    });
    showToast("Quiz created ✓ Now add some questions.");
    await loadQuizzes();
    window.openEditQuizModal(ref.id);
  } catch(e) { showToast("Could not create quiz: " + e.message, true); }
};

window.deleteQuiz = async function(id){
  if (!(await showConfirm("Delete quiz", "Delete this quiz and all its questions?"))) return;
  try {
    const qSnap = await getDocs(query(collection(db, "quizQuestions"), where("quizId", "==", id)));
    await Promise.all(qSnap.docs.map(d => deleteDoc(doc(db, "quizQuestions", d.id))));
    await deleteDoc(doc(db, "quizzes", id));
    closeModal("editQuizModal");
    await loadQuizzes();
    showToast("Quiz removed.");
  } catch(e) { showToast("Delete failed: " + e.message, true); }
};
window.deleteQuizFromModal = function(){ window.deleteQuiz(document.getElementById("editQuizId").value); };

async function loadQuizQuestions(quizId){
  try {
    const snaps = await getDocs(query(collection(db, "quizQuestions"), where("quizId", "==", quizId)));
    currentQuizQuestions = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.order||0)-(b.order||0));
    renderQuizQuestionsList();
  } catch(e) { console.error(e); }
}

function renderQuizQuestionsList(){
  document.getElementById("quizQuestionCount").textContent = `(${currentQuizQuestions.length})`;
  const list = document.getElementById("quizQuestionsList");
  if (!currentQuizQuestions.length) {
    list.innerHTML = '<div style="color:var(--slate-dim);font-size:13px;">No questions yet. Add one or import a CSV.</div>';
    return;
  }
  list.innerHTML = currentQuizQuestions.map((q, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:8px;">
      ${q.imageUrl ? `<img src="${q.imageUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;" />` : `<div style="width:40px;height:40px;border-radius:6px;background:rgba(242,169,59,0.1);display:flex;align-items:center;justify-content:center;color:var(--amber);flex-shrink:0;"><i class="fas fa-question" style="font-size:12px;"></i></div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${i+1}. ${escapeHtml(q.text || '')}</div>
        <div style="font-size:11px;color:var(--slate-dim);">Correct: ${escapeHtml(q.correctLabel || '—')}</div>
      </div>
      <button class="icon-btn" onclick="window.openEditQuestionModal('${q.id}')"><i class="fas fa-pen"></i></button>
      <button class="icon-btn danger" onclick="window.deleteQuestion('${q.id}')"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

window.openAddQuestionModal = function(){
  document.getElementById("editQuestionId").value = '';
  document.getElementById("addQuestionModalTitle").textContent = "Add question";
  document.getElementById("qBuilderText").value = '';
  document.getElementById("qBuilderOptA").value = '';
  document.getElementById("qBuilderOptB").value = '';
  document.getElementById("qBuilderOptC").value = '';
  document.getElementById("qBuilderOptD").value = '';
  document.getElementById("qBuilderCorrect").value = 'A';
  document.getElementById("qBuilderImgFile").value = '';
  document.getElementById("qBuilderImgPreview").style.display = 'none';
  document.getElementById("qBuilderImgText").textContent = 'Tap to upload an image';
  document.getElementById("qBuilderSaveBtn")._imageUrl = null;
  openModal("addQuestionModal");
};

window.openEditQuestionModal = function(questionId){
  const q = currentQuizQuestions.find(x => x.id === questionId);
  if (!q) return;
  document.getElementById("editQuestionId").value = q.id;
  document.getElementById("addQuestionModalTitle").textContent = "Edit question";
  document.getElementById("qBuilderText").value = q.text || '';
  document.getElementById("qBuilderOptA").value = q.options?.find(o=>o.label==='A')?.text || '';
  document.getElementById("qBuilderOptB").value = q.options?.find(o=>o.label==='B')?.text || '';
  document.getElementById("qBuilderOptC").value = q.options?.find(o=>o.label==='C')?.text || '';
  document.getElementById("qBuilderOptD").value = q.options?.find(o=>o.label==='D')?.text || '';
  document.getElementById("qBuilderCorrect").value = q.correctLabel || 'A';
  const preview = document.getElementById("qBuilderImgPreview");
  if (q.imageUrl) { preview.src = q.imageUrl; preview.style.display = 'block'; document.getElementById("qBuilderImgText").textContent = 'Change image'; }
  else { preview.style.display = 'none'; document.getElementById("qBuilderImgText").textContent = 'Tap to upload an image'; }
  document.getElementById("qBuilderSaveBtn")._imageUrl = q.imageUrl || null;
  openModal("addQuestionModal");
};

window.previewQuestionImage = function(input){
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("qBuilderImgPreview").src = e.target.result;
    document.getElementById("qBuilderImgPreview").style.display = 'block';
    document.getElementById("qBuilderImgText").textContent = file.name;
  };
  reader.readAsDataURL(file);
};

async function uploadQuizImage(file, quizId){
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", QUIZ_IMAGE_PRESET);
  fd.append("folder", `quiz_questions/${quizId}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Image upload failed");
  const data = await res.json();
  return data.secure_url;
}

window.saveQuestion = async function(){
  const quizId = document.getElementById("editQuizId").value;
  const editId = document.getElementById("editQuestionId").value;
  const text = document.getElementById("qBuilderText").value.trim();
  const optA = document.getElementById("qBuilderOptA").value.trim();
  const optB = document.getElementById("qBuilderOptB").value.trim();
  const optC = document.getElementById("qBuilderOptC").value.trim();
  const optD = document.getElementById("qBuilderOptD").value.trim();
  const correctLabel = document.getElementById("qBuilderCorrect").value;
  const imgFile = document.getElementById("qBuilderImgFile").files[0];

  if (!text || !optA || !optB) { showToast("Question text and at least options A & B are required.", true); return; }

  const btn = document.getElementById("qBuilderSaveBtn");
  const originalHTML = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let imageUrl = btn._imageUrl || null;
    if (imgFile) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading image…'; imageUrl = await uploadQuizImage(imgFile, quizId); }
    const options = [
      { label: 'A', text: optA }, { label: 'B', text: optB },
      ...(optC ? [{ label: 'C', text: optC }] : []),
      ...(optD ? [{ label: 'D', text: optD }] : [])
    ];
    if (editId) {
      await updateDoc(doc(db, "quizQuestions", editId), { text, imageUrl, options, correctLabel });
    } else {
      await addDoc(collection(db, "quizQuestions"), { quizId, text, imageUrl, options, correctLabel, order: currentQuizQuestions.length, createdAt: serverTimestamp() });
    }
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: editId ? currentQuizQuestions.length : currentQuizQuestions.length + 1 });
    closeModal("addQuestionModal");
    showToast("Question saved ✓");
    await loadQuizQuestions(quizId);
    await loadQuizzes();
  } catch(e) { showToast("Could not save question: " + e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = originalHTML; }
};

window.deleteQuestion = async function(id){
  if (!(await showConfirm("Delete question", "Delete this question?"))) return;
  const quizId = document.getElementById("editQuizId").value;
  try {
    await deleteDoc(doc(db, "quizQuestions", id));
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: Math.max(0, currentQuizQuestions.length - 1) });
    showToast("Question removed.");
    await loadQuizQuestions(quizId);
    await loadQuizzes();
  } catch(e) { showToast("Delete failed: " + e.message, true); }
};

let _pendingCsvRows = [];
function parseQuizCsv(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = []; let cur = '', inQuotes = false;
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    if (cells.length >= 7) {
      rows.push({
        text: cells[0].trim(), imageUrl: cells[1].trim() || null,
        optA: cells[2].trim(), optB: cells[3].trim(), optC: cells[4].trim(), optD: cells[5].trim(),
        correctLabel: cells[6].trim().toUpperCase()
      });
    }
  }
  return rows;
}

window.openQuizCsvModal = function(){
  document.getElementById("quizCsvFile").value = '';
  document.getElementById("quizCsvPreview").textContent = '';
  document.getElementById("quizCsvProgressWrap").style.display = 'none';
  document.getElementById("quizCsvProgressBar").style.width = '0%';
  document.getElementById("quizCsvProgressPct").textContent = '0%';
  _pendingCsvRows = [];
  openModal("quizCsvModal");
};

document.addEventListener("change", (e) => {
  if (e.target.id === "quizCsvFile") {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      _pendingCsvRows = parseQuizCsv(ev.target.result);
      document.getElementById("quizCsvPreview").textContent = `${_pendingCsvRows.length} question(s) found and ready to import.`;
    };
    reader.readAsText(file);
  }
});

window.importQuizCsv = async function(){
  const quizId = document.getElementById("editQuizId").value;
  if (!_pendingCsvRows.length) { showToast("Choose a CSV file first.", true); return; }
  const importBtn = document.querySelector("#quizCsvModal .btn-primary");
  const originalBtnHTML = importBtn.innerHTML;
  const progWrap = document.getElementById("quizCsvProgressWrap");
  const progBar = document.getElementById("quizCsvProgressBar");
  const progPct = document.getElementById("quizCsvProgressPct");
  const progLabel = document.getElementById("quizCsvProgressLabel");
  importBtn.disabled = true; importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…';
  progWrap.style.display = "block"; progBar.style.width = "0%"; progPct.textContent = "0%"; progLabel.textContent = "Importing questions…";
  try {
    let order = currentQuizQuestions.length;
    const total = _pendingCsvRows.length; let done = 0;
    for (const row of _pendingCsvRows) {
      if (!row.text || !row.optA || !row.optB || !row.correctLabel) { done++; continue; }
      const options = [
        { label: 'A', text: row.optA }, { label: 'B', text: row.optB },
        ...(row.optC ? [{ label: 'C', text: row.optC }] : []),
        ...(row.optD ? [{ label: 'D', text: row.optD }] : [])
      ];
      await addDoc(collection(db, "quizQuestions"), { quizId, text: row.text, imageUrl: row.imageUrl, options, correctLabel: row.correctLabel, order: order++, createdAt: serverTimestamp() });
      done++;
      const pct = Math.round((done / total) * 100);
      progBar.style.width = pct + "%"; progPct.textContent = pct + "%";
    }
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: order });
    closeModal("quizCsvModal");
    showToast(`${_pendingCsvRows.length} question(s) imported ✓`);
    await loadQuizQuestions(quizId);
    await loadQuizzes();
  } catch(e) { showToast("Import failed. Check the CSV format.", true); }
  finally { importBtn.disabled = false; importBtn.innerHTML = originalBtnHTML; progWrap.style.display = "none"; }
};

function fmtDateTime(cls){
  if (!cls?.date || !cls?.time) return '—';
  const start = new Date(`${cls.date}T${cls.time}`);
  const dateStr = start.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = start.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  return `${dateStr} · ${timeStr}`;
}
function classStatus(cls){
  const start = new Date(`${cls.date}T${cls.time}`);
  const end = cls.endDate && cls.endTime ? new Date(`${cls.endDate}T${cls.endTime}`) : new Date(start.getTime() + (cls.durationMinutes||60)*60000);
  const now = new Date();
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'ongoing';
  return 'completed';
}

// ============================================================
// ATTENDANCE MODULE (school-scoped, read + status toggle + delete)
// ============================================================
let schoolAttendance = [];
let schoolAttendanceStudentMap = {};
let schoolAttendanceUnsub = null;

async function loadSchoolAttendance(){
  if (schoolAttendanceUnsub) { schoolAttendanceUnsub(); schoolAttendanceUnsub = null; }
  try {
    const studSnap = await getDocs(query(collection(db, "students"), where("schoolId", "==", currentSchoolId)));
    schoolAttendanceStudentMap = {};
    studSnap.docs.forEach(d => { schoolAttendanceStudentMap[d.id] = d.data(); });
  } catch(e) { console.error(e); }

  const q = query(collection(db, "attendance"), where("schoolId", "==", currentSchoolId));
  schoolAttendanceUnsub = onSnapshot(q, (snap) => {
    schoolAttendance = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.date?.toDate?.() || new Date(b.date||0)) - (a.date?.toDate?.() || new Date(a.date||0)));
    renderSchoolAttendance();
  }, (err) => showToast('Could not load attendance: ' + err.message, true));
}

function renderSchoolAttendance(){
  const term = (document.getElementById('schAttSearch').value || '').toLowerCase();
  const statusFilter = document.getElementById('schAttStatusFilter').value;
  const tbody = document.getElementById('schAttTableBody');

  const filtered = schoolAttendance.filter(r => {
    const student = schoolAttendanceStudentMap[r.studentId];
    const name = student ? `${student.firstName||''} ${student.lastName||''}`.toLowerCase() : '';
    return (!term || name.includes(term)) && (!statusFilter || r.status === statusFilter);
  });

  if (!filtered.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No attendance records found.</td></tr>`; return; }

  tbody.innerHTML = filtered.map(r => {
    const student = schoolAttendanceStudentMap[r.studentId];
    const name = student ? `${student.firstName||''} ${student.lastName||''}`.trim() : (r.studentId || '—');
    const dateStr = r.date?.toDate ? fmtDate(r.date) : (r.date || '—');
    const statusClass = r.status === 'present' ? 'good' : r.status === 'excused' ? 'warn' : 'bad';
    return `<tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td style="font-size:12px;color:var(--slate-dim);">${dateStr}</td>
      <td><span class="badge">${escapeHtml(r.courseName || student?.courseType || '—')}</span></td>
      <td style="font-size:12px;">${escapeHtml(r.classTitle || '—')}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(r.status || '—')}</span></td>
      <td class="row-actions">
        <button class="icon-btn" style="color:var(--good);border-color:rgba(63,166,106,0.4);" title="Mark present" onclick="window.toggleSchAttendance('${r.id}','present')"><i class="fas fa-check"></i></button>
        <button class="icon-btn danger" title="Mark absent" onclick="window.toggleSchAttendance('${r.id}','absent')"><i class="fas fa-times"></i></button>
        <button class="icon-btn danger" title="Delete" onclick="window.deleteSchAttendance('${r.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('schAttSearch').addEventListener('input', renderSchoolAttendance);
document.getElementById('schAttStatusFilter').addEventListener('change', renderSchoolAttendance);

window.toggleSchAttendance = async function(id, status){
  try { await updateDoc(doc(db, 'attendance', id), { status }); showToast(`Marked ${status} ✓`); }
  catch(e) { showToast('Update failed: ' + e.message, true); }
};
window.deleteSchAttendance = async function(id){
  if (!(await showConfirm('Delete record', 'Delete this attendance record?'))) return;
  try { await deleteDoc(doc(db, 'attendance', id)); showToast('Record deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
};

// ============================================================
// ============================================================
// CLASSES MODULE (school-scoped) — full parity: vehicle, students,
// online link, document attachments, attendance summary.
// ============================================================
let schoolClasses = [];
let schoolClassesUnsub = null;
let schClassPendingDocFiles = [];
let schClassExistingDocs = [];

function loadSchoolClasses(){
  if (schoolClassesUnsub) { schoolClassesUnsub(); schoolClassesUnsub = null; }
  const q = query(collection(db, "classes"), where("schoolId", "==", currentSchoolId));
  schoolClassesUnsub = onSnapshot(q, (snap) => {
    schoolClasses = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
    renderSchoolClasses();
  }, (err) => showToast('Could not load classes: ' + err.message, true));
}

function renderSchoolClasses(){
  const term = (document.getElementById('schClassSearch').value || '').toLowerCase();
  const filtered = schoolClasses.filter(c => {
    const text = `${c.title||''} ${c.courseName||''}`.toLowerCase();
    return !term || text.includes(term);
  });
  const tbody = document.getElementById('schClassesTableBody');
  if (!filtered.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No classes scheduled yet.</td></tr>`; return; }

  tbody.innerHTML = filtered.map(c => {
    const status = classStatus(c);
    const statusClass = status === 'ongoing' ? 'good' : status === 'upcoming' ? 'warn' : 'bad';
    const extras = [
      c.vehicleName ? '<i class="fas fa-car-side" title="Vehicle assigned"></i>' : '',
      (c.documents && c.documents.length) ? '<i class="fas fa-paperclip" title="Has documents"></i>' : ''
    ].filter(Boolean).join(' ');
    return `<tr>
      <td><strong>${escapeHtml(c.title||'—')}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(c.description||'')} ${extras}</div></td>
      <td><span class="badge">${escapeHtml(c.courseName||'—')}</span></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(c.instructorName||'—')}</td>
      <td style="font-size:12px;">${fmtDateTime(c)}</td>
      <td><span style="font-size:12px;color:var(--slate-dim);"><i class="fas ${c.mode==='online'?'fa-video':'fa-map-marker-alt'}"></i> ${escapeHtml(c.mode||'in-person')}</span></td>
      <td><span class="badge ${statusClass}">${status}</span></td>
      <td class="row-actions"><button class="icon-btn" title="Edit" onclick="window.openSchClassModal('${c.id}')"><i class="fas fa-eye"></i></button></td>
    </tr>`;
  }).join('');
}
document.getElementById('schClassSearch').addEventListener('input', renderSchoolClasses);

async function populateSchClassInstructorSelect(selectedId){
  const sel = document.getElementById('schClassInstructor');
  sel.innerHTML = '<option value="">Select instructor…</option>';
  try {
    const snap = await getDocs(query(collection(db, "instructors"), where("schoolId", "==", currentSchoolId)));
    snap.docs.forEach(d => {
      const i = d.data();
      const name = `${i.firstName||''} ${i.lastName||''}`.trim();
      sel.innerHTML += `<option value="${d.id}" data-name="${escapeHtml(name)}" ${d.id===selectedId?'selected':''}>${escapeHtml(name)}</option>`;
    });
  } catch(e) { console.error(e); }
}

async function populateSchClassVehicleSelect(selectedId){
  const sel = document.getElementById('schClassVehicle');
  sel.innerHTML = '<option value="">Select vehicle…</option>';
  try {
    const snap = await getDocs(query(collection(db, "vehicles"), where("schoolId", "==", currentSchoolId)));
    snap.docs.forEach(d => {
      const v = d.data();
      const name = `${v.year||''} ${v.make||''} ${v.model||''}`.trim();
      sel.innerHTML += `<option value="${d.id}" data-name="${escapeHtml(name)}" ${d.id===selectedId?'selected':''}>${escapeHtml(name)}</option>`;
    });
  } catch(e) { console.error(e); }
}

async function renderSchClassStudentCheckboxes(preSelectedIds){
  const list = document.getElementById('schClassStudentList');
  list.innerHTML = 'Loading…';
  try {
    const snap = await getDocs(query(collection(db, "students"), where("schoolId", "==", currentSchoolId)));
    const students = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'pending');
    if (!students.length) { list.innerHTML = '<div style="font-size:12px;color:var(--slate-dim);">No students yet.</div>'; return; }
    list.innerHTML = students.map(s => {
      const name = `${s.firstName||''} ${s.lastName||''}`.trim() || s.email;
      const checked = (preSelectedIds||[]).includes(s.id) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
        <input type="checkbox" value="${s.id}" data-name="${escapeHtml(name)}" class="sch-class-student-check" ${checked} style="accent-color:var(--amber);width:15px;height:15px;">
        <span style="font-size:13px;">${escapeHtml(name)}</span>
      </label>`;
    }).join('');
  } catch(e) { list.innerHTML = '<div style="font-size:12px;color:var(--brake);">Could not load students.</div>'; }
}

window.toggleSchClassOnlineFields = function(){
  const mode = document.getElementById('schClassMode').value;
  document.getElementById('schClassOnlineFields').style.display = mode === 'online' ? 'block' : 'none';
};

function renderSchClassDocsList(){
  const container = document.getElementById('schClassDocsList');
  const existing = schClassExistingDocs.map((d, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:6px;">
      <a href="${d.url}" target="_blank" style="font-size:12px;color:var(--amber);text-decoration:none;"><i class="fas fa-file"></i> ${escapeHtml(d.name||'Document')}</a>
      <button type="button" class="icon-btn danger" style="width:24px;height:24px;" onclick="window.removeSchClassExistingDoc(${i})"><i class="fas fa-times" style="font-size:10px;"></i></button>
    </div>`).join('');
  const pending = schClassPendingDocFiles.map((f, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--asphalt-deep);border:1px dashed var(--border);border-radius:6px;">
      <span style="font-size:12px;color:var(--chalk);"><i class="fas fa-clock" style="color:var(--amber);"></i> ${escapeHtml(f.name)} (will upload on save)</span>
      <button type="button" class="icon-btn danger" style="width:24px;height:24px;" onclick="window.removeSchClassPendingDoc(${i})"><i class="fas fa-times" style="font-size:10px;"></i></button>
    </div>`).join('');
  container.innerHTML = existing + pending;
}
window.removeSchClassExistingDoc = function(i){ schClassExistingDocs.splice(i,1); renderSchClassDocsList(); };
window.removeSchClassPendingDoc = function(i){ schClassPendingDocFiles.splice(i,1); renderSchClassDocsList(); };

document.getElementById('schClassDocsFile').addEventListener('change', (e) => {
  schClassPendingDocFiles.push(...Array.from(e.target.files));
  e.target.value = '';
  renderSchClassDocsList();
});

async function uploadSchClassDocuments(files, folderLabel){
  if (!files || !files.length) return [];
  const out = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', 'class_doc_upload');
    fd.append('folder', `class_documents/${folderLabel}`);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, { method: 'POST', body: fd });
      if (res.ok) { const data = await res.json(); out.push({ url: data.secure_url, name: file.name }); }
    } catch(e) { console.error('Document upload failed:', e); }
  }
  return out;
}

async function loadSchClassAttendanceSummary(classId){
  const wrap = document.getElementById('schClassAttendanceSummaryWrap');
  const box = document.getElementById('schClassAttendanceSummary');
  wrap.style.display = 'block';
  box.textContent = 'Loading…';
  try {
    const snap = await getDocs(query(collection(db, 'attendance'), where('classId', '==', classId)));
    const records = snap.docs.map(d => d.data());
    if (!records.length) { box.textContent = 'No attendance records yet.'; return; }
    const present = records.filter(r => r.status === 'present').length;
    const absent = records.filter(r => r.status === 'absent').length;
    box.innerHTML = `<span class="badge good">${present} present</span> &nbsp; <span class="badge bad">${absent} absent</span> &nbsp; <span class="badge">${records.length} total</span>`;
  } catch(e) { box.textContent = 'Could not load attendance.'; }
}

document.getElementById('schOpenAddClassBtn').addEventListener('click', async () => {
  document.getElementById('schClassError').textContent = '';
  document.getElementById('schClassId').value = '';
  document.getElementById('schClassModalTitle').textContent = 'Schedule class';
  ['schClassTitle','schClassDesc','schClassCourse','schClassDate','schClassTime','schClassEndDate','schClassEndTime','schClassPlatform','schClassLink'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schClassMode').value = 'in-person';
  window.toggleSchClassOnlineFields();
  document.getElementById('schClassDeleteBtn').style.display = 'none';
  document.getElementById('schClassAttendanceSummaryWrap').style.display = 'none';
  schClassPendingDocFiles = [];
  schClassExistingDocs = [];
  renderSchClassDocsList();
  await populateSchClassInstructorSelect('');
  await populateSchClassVehicleSelect('');
  await renderSchClassStudentCheckboxes([]);
  openModal('schClassModal');
});

window.openSchClassModal = async function(id){
  const c = schoolClasses.find(x => x.id === id);
  if (!c) return;
  document.getElementById('schClassError').textContent = '';
  document.getElementById('schClassId').value = c.id;
  document.getElementById('schClassModalTitle').textContent = 'Edit class';
  document.getElementById('schClassTitle').value = c.title || '';
  document.getElementById('schClassDesc').value = c.description || '';
  document.getElementById('schClassCourse').value = c.courseName || '';
  document.getElementById('schClassDate').value = c.date || '';
  document.getElementById('schClassTime').value = c.time || '';
  document.getElementById('schClassEndDate').value = c.endDate || '';
  document.getElementById('schClassEndTime').value = c.endTime || '';
  document.getElementById('schClassMode').value = c.mode || 'in-person';
  document.getElementById('schClassPlatform').value = c.platform || '';
  document.getElementById('schClassLink').value = c.meetingLink || '';
  window.toggleSchClassOnlineFields();
  document.getElementById('schClassDeleteBtn').style.display = 'inline-flex';
  schClassPendingDocFiles = [];
  schClassExistingDocs = [...(c.documents || [])];
  renderSchClassDocsList();
  await populateSchClassInstructorSelect(c.instructorId || '');
  await populateSchClassVehicleSelect(c.vehicleId || '');
  await renderSchClassStudentCheckboxes(c.studentIds || []);
  await loadSchClassAttendanceSummary(c.id);
  openModal('schClassModal');
};

document.getElementById('schClassSaveBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schClassError');
  errEl.textContent = '';
  const id = document.getElementById('schClassId').value;
  const title = document.getElementById('schClassTitle').value.trim();
  const description = document.getElementById('schClassDesc').value.trim();
  const courseName = document.getElementById('schClassCourse').value.trim();
  const instrSel = document.getElementById('schClassInstructor');
  const instructorId = instrSel.value;
  const instructorName = instrSel.selectedOptions[0]?.dataset?.name || '';
  const vehSel = document.getElementById('schClassVehicle');
  const vehicleId = vehSel.value || null;
  const vehicleName = vehSel.selectedOptions[0]?.dataset?.name || null;
  const date = document.getElementById('schClassDate').value;
  const time = document.getElementById('schClassTime').value;
  const endDate = document.getElementById('schClassEndDate').value;
  const endTime = document.getElementById('schClassEndTime').value;
  const mode = document.getElementById('schClassMode').value;
  const platform = mode === 'online' ? document.getElementById('schClassPlatform').value : null;
  const meetingLink = mode === 'online' ? document.getElementById('schClassLink').value.trim() : null;
  const studentCbs = document.querySelectorAll('.sch-class-student-check:checked');
  const studentIds = Array.from(studentCbs).map(cb => cb.value);
  const studentNames = Array.from(studentCbs).map(cb => cb.dataset.name);

  if (!title || !date || !time || !endDate || !endTime) { errEl.textContent = 'Title, start and end date/time are required.'; return; }
  const durationMinutes = Math.max(1, Math.round((new Date(`${endDate}T${endTime}`) - new Date(`${date}T${time}`)) / 60000));

  const btn = document.getElementById('schClassSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let documents = [...schClassExistingDocs];
    if (schClassPendingDocFiles.length) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading documents…';
      const uploaded = await uploadSchClassDocuments(schClassPendingDocFiles, title || 'class');
      documents = documents.concat(uploaded);
    }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    const payload = {
      title, description, courseName, instructorId, instructorName,
      vehicleId, vehicleName,
      date, time, endDate, endTime, durationMinutes, mode,
      platform, meetingLink,
      studentIds, studentNames, documents,
      schoolId: currentSchoolId
    };
    if (id) await updateDoc(doc(db, 'classes', id), payload);
    else await addDoc(collection(db, 'classes'), { ...payload, createdAt: serverTimestamp() });
    closeModal('schClassModal');
    showToast('Class saved ✓');
  } catch(e) { errEl.textContent = 'Save failed: ' + e.message; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save'; }
});

document.getElementById('schClassDeleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('schClassId').value;
  if (!id) return;
  if (!(await showConfirm('Delete class', 'Delete this class?'))) return;
  try { await deleteDoc(doc(db, 'classes', id)); closeModal('schClassModal'); showToast('Class deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
});

// ============================================================
// VEHICLES MODULE (school-scoped)
// NOTE: requires an unsigned Cloudinary preset named exactly
// "vehicle_images_upload" (same as Dekay's own admin uses).
// ============================================================
const VEHICLE_IMAGE_PRESET = "vehicle_images_upload";
let schoolVehicles = [];
let schoolVehiclesUnsub = null;
let pendingVehicleImageUrl = null;

function loadSchoolVehicles(){
  if (!schoolClassesUnsub) loadSchoolClasses(); // needed so busy badges & schedules can be computed
  if (schoolVehiclesUnsub) { schoolVehiclesUnsub(); schoolVehiclesUnsub = null; }
  const q = query(collection(db, "vehicles"), where("schoolId", "==", currentSchoolId));
  schoolVehiclesUnsub = onSnapshot(q, (snap) => {
    schoolVehicles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchoolVehicles();
  }, (err) => showToast('Could not load vehicles: ' + err.message, true));
}

function isVehicleCurrentlyBusy(vehicleId){
  const now = new Date();
  return schoolClasses.some(c => {
    if (c.vehicleId !== vehicleId) return false;
    const start = new Date(`${c.date}T${c.time}`);
    const end = c.endDate && c.endTime ? new Date(`${c.endDate}T${c.endTime}`) : new Date(start.getTime() + (c.durationMinutes||60)*60000);
    return now >= start && now <= end;
  });
}

function renderSchoolVehicles(){
  const grid = document.getElementById('schVehicleGrid');
  if (!schoolVehicles.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No vehicles added yet.</div>`; return; }
  grid.innerHTML = schoolVehicles.map(v => {
    const cover = v.imageUrl ? `background-image:url(${v.imageUrl});background-size:cover;background-position:center;` : '';
    const busy = isVehicleCurrentlyBusy(v.id);
    return `<div class="school-card" onclick="window.openSchVehicleModal('${v.id}')">
      <div class="cover" style="${cover}">
        ${!v.imageUrl ? '<i class="fas fa-car-side"></i>' : ''}
        ${busy ? '<div class="status-dot" style="background:var(--brake);" title="In use right now"></div>' : ''}
      </div>
      <div class="body">
        <p class="name">${escapeHtml(String(v.year||''))} ${escapeHtml(v.make||'')} ${escapeHtml(v.model||'')} ${busy ? '<span class="badge bad" style="margin-left:6px;font-size:10px;">Busy</span>' : ''}</p>
        <p class="region">${escapeHtml(v.trim||'—')}</p>
        <div class="mini-stats">
          <div class="mini-stat"><b style="font-size:12px;">${escapeHtml(v.engineType||'—')}</b><span>Engine</span></div>
          <div class="mini-stat"><b style="font-size:12px;">${escapeHtml(v.transmissionType||'—')}</b><span>Trans.</span></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

const schVehicleImgFile = document.getElementById('schVehicleImgFile');
schVehicleImgFile.addEventListener('change', () => {
  const file = schVehicleImgFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('schVehicleImgPreview').src = e.target.result;
    document.getElementById('schVehicleImgPreview').style.display = 'block';
    document.getElementById('schVehicleImgText').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('schOpenAddVehicleBtn').addEventListener('click', () => {
  document.getElementById('schVehicleError').textContent = '';
  document.getElementById('schVehicleId').value = '';
  document.getElementById('schVehicleModalTitle').textContent = 'Add vehicle';
  ['schVehicleYear','schVehicleMake','schVehicleModel','schVehicleTrim'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schVehicleEngine').value = 'Petrol';
  document.getElementById('schVehicleTransmission').value = 'Manual';
  document.getElementById('schVehicleImgPreview').style.display = 'none';
  document.getElementById('schVehicleImgText').textContent = 'Tap to upload a photo';
  document.getElementById('schVehicleDeleteBtn').style.display = 'none';
  pendingVehicleImageUrl = null;
  schVehicleImgFile.value = '';
  openModal('schVehicleModal');
});

window.openSchVehicleModal = function(id){
  const v = schoolVehicles.find(x => x.id === id);
  if (!v) return;
  document.getElementById('schVehicleError').textContent = '';
  document.getElementById('schVehicleId').value = v.id;
  document.getElementById('schVehicleModalTitle').textContent = 'Edit vehicle';
  document.getElementById('schVehicleYear').value = v.year || '';
  document.getElementById('schVehicleMake').value = v.make || '';
  document.getElementById('schVehicleModel').value = v.model || '';
  document.getElementById('schVehicleTrim').value = v.trim || '';
  document.getElementById('schVehicleEngine').value = v.engineType || 'Petrol';
  document.getElementById('schVehicleTransmission').value = v.transmissionType || 'Manual';
  const preview = document.getElementById('schVehicleImgPreview');
  if (v.imageUrl) { preview.src = v.imageUrl; preview.style.display = 'block'; document.getElementById('schVehicleImgText').textContent = 'Tap to change photo'; }
  else { preview.style.display = 'none'; document.getElementById('schVehicleImgText').textContent = 'Tap to upload a photo'; }
  document.getElementById('schVehicleDeleteBtn').style.display = 'inline-flex';
  pendingVehicleImageUrl = v.imageUrl || null;
  schVehicleImgFile.value = '';

  const scheduleWrap = document.getElementById('schVehicleScheduleWrap');
  const scheduleList = document.getElementById('schVehicleScheduleList');
  const assigned = schoolClasses.filter(c => c.vehicleId === id)
    .sort((a,b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
  if (assigned.length) {
    scheduleWrap.style.display = 'block';
    scheduleList.innerHTML = assigned.map(c => `<div style="padding:8px 10px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:6px;font-size:12px;">
      <strong>${escapeHtml(c.title||'—')}</strong><br>
      <span style="color:var(--slate-dim);">${fmtDateTime(c)} · ${escapeHtml(c.instructorName||'—')} · ${escapeHtml(c.courseName||'—')}</span>
    </div>`).join('');
  } else {
    scheduleWrap.style.display = 'none';
    scheduleList.innerHTML = '';
  }

  openModal('schVehicleModal');
};

document.getElementById('schVehicleSaveBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schVehicleError');
  errEl.textContent = '';
  const id = document.getElementById('schVehicleId').value;
  const year = document.getElementById('schVehicleYear').value.trim();
  const make = document.getElementById('schVehicleMake').value.trim();
  const model = document.getElementById('schVehicleModel').value.trim();
  const trim = document.getElementById('schVehicleTrim').value.trim();
  const engineType = document.getElementById('schVehicleEngine').value;
  const transmissionType = document.getElementById('schVehicleTransmission').value;
  if (!year || !make || !model) { errEl.textContent = 'Year, make and model are required.'; return; }

  const btn = document.getElementById('schVehicleSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let imageUrl = pendingVehicleImageUrl;
    const file = schVehicleImgFile.files[0];
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', VEHICLE_IMAGE_PRESET);
      fd.append('folder', 'vehicles');
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Image upload failed — check the "vehicle_images_upload" unsigned preset exists in Cloudinary.');
      const data = await res.json();
      imageUrl = data.secure_url;
    }
    const payload = { year: Number(year), make, model, trim, engineType, transmissionType, imageUrl, schoolId: currentSchoolId };
    if (id) await updateDoc(doc(db, 'vehicles', id), payload);
    else await addDoc(collection(db, 'vehicles'), { ...payload, createdAt: serverTimestamp() });
    closeModal('schVehicleModal');
    showToast('Vehicle saved ✓');
  } catch(e) { errEl.textContent = 'Save failed: ' + e.message; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save'; }
});

document.getElementById('schVehicleDeleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('schVehicleId').value;
  if (!id) return;
  if (!(await showConfirm('Delete vehicle', 'Delete this vehicle from the fleet?'))) return;
  try { await deleteDoc(doc(db, 'vehicles', id)); closeModal('schVehicleModal'); showToast('Vehicle deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
});

// ============================================================
// CERTIFICATES MODULE (school-scoped, read/view/download/delete)
// TODO (not yet ported): certificate generation UI (html2canvas render
// + DVLA checklist). This lists certificates already created via Dekay's
// own admin so the central dashboard isn't blind to them.
// ============================================================
let schoolCertificates = [];
let schoolCertificatesUnsub = null;

function loadSchoolCertificates(){
  if (schoolCertificatesUnsub) { schoolCertificatesUnsub(); schoolCertificatesUnsub = null; }
  const q = query(collection(db, "certificates"), where("schoolId", "==", currentSchoolId));
  schoolCertificatesUnsub = onSnapshot(q, (snap) => {
    schoolCertificates = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
    renderSchoolCertificates();
  }, (err) => showToast('Could not load certificates: ' + err.message, true));
}

function renderSchoolCertificates(){
  const term = (document.getElementById('schCertSearch').value || '').toLowerCase();
  const filtered = schoolCertificates.filter(c => {
    const text = `${c.studentName||''} ${c.serialNumber||''}`.toLowerCase();
    return !term || text.includes(term);
  });
  const tbody = document.getElementById('schCertTableBody');
  if (!filtered.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No certificates issued yet.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(c => `<tr>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(c.serialNumber||'—')}</td>
    <td><strong>${escapeHtml(c.studentName||'—')}</strong></td>
    <td><span class="badge">${escapeHtml(c.course||'—')}</span></td>
    <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(c.issueDate||'—')}</td>
    <td class="row-actions">
      ${c.imageUrl ? `<a class="icon-btn" title="View" href="${escapeHtml(c.imageUrl)}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;"><i class="fas fa-eye"></i></a>` : ''}
      <button class="icon-btn danger" title="Delete" onclick="window.deleteSchCertificate('${c.id}')"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
}
document.getElementById('schCertSearch').addEventListener('input', renderSchoolCertificates);

window.deleteSchCertificate = async function(id){
  if (!(await showConfirm('Delete certificate', 'Delete this certificate record?'))) return;
  try { await deleteDoc(doc(db, 'certificates', id)); showToast('Certificate deleted.'); }
  catch(e) { showToast('Delete failed: ' + e.message, true); }
};

// ============================================================
// ENQUIRIES MODULE (school-scoped, read + status update)
// ============================================================
let schoolEnquiries = [];
let schoolEnquiriesUnsub = null;

function loadSchoolEnquiries(){
  if (schoolEnquiriesUnsub) { schoolEnquiriesUnsub(); schoolEnquiriesUnsub = null; }
  const q = query(collection(db, "enquiries"), where("schoolId", "==", currentSchoolId));
  schoolEnquiriesUnsub = onSnapshot(q, (snap) => {
    schoolEnquiries = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
    if (document.getElementById('schEnquiryStatusFilter')) renderSchoolEnquiries();
  }, (err) => showToast('Could not load enquiries: ' + err.message, true));
}
// Load enquiries as soon as a school is opened, so the nav badge is right even before visiting the page
const _origOpenSchoolDetail = window.openSchoolDetail;
window.openSchoolDetail = function(schoolId){
  _origOpenSchoolDetail(schoolId);
  loadSchoolEnquiries();
};

function renderSchoolEnquiries(){
  const tbody = document.getElementById('schEnquiriesTableBody');
  const filterVal = document.getElementById('schEnquiryStatusFilter').value;
  const filtered = filterVal ? schoolEnquiries.filter(e => e.status === filterVal) : schoolEnquiries;

  const pendingCount = schoolEnquiries.filter(e => e.status === 'new').length;
  const navBadge = document.getElementById('schEnquiriesNavBadge');
  if (navBadge) {
    navBadge.textContent = pendingCount;
    navBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }

  if (!filtered.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No enquiries found.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(e => {
    const waPhone = (e.phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return `<tr>
    <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(e.createdAt)}</td>
    <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><strong>${escapeHtml(e.firstName||'')} ${escapeHtml(e.lastName||'')}</strong></td>
    <td style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.phone ? `<a class="site-link" href="tel:${escapeHtml(e.phone)}">${escapeHtml(e.phone)}</a>` : '—'}</td>
    <td><span class="badge">${escapeHtml(e.courseType||'—')}</span></td>
    <td style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(e.message||'')}">${escapeHtml(e.message||'—')}</td>
    <td>
      <select class="field-select" style="padding:6px 8px;font-size:12px;width:100%;" onchange="window.updateSchEnquiryStatus('${e.id}', this.value)">
        <option value="new" ${e.status==='new'?'selected':''}>New</option>
        <option value="contacted" ${e.status==='contacted'?'selected':''}>Contacted</option>
        <option value="booked" ${e.status==='booked'?'selected':''}>Booked</option>
        <option value="closed" ${e.status==='closed'?'selected':''}>Closed</option>
      </select>
    </td>
    <td class="row-actions" style="white-space:nowrap;">
      <button class="icon-btn" title="View" onclick="window.viewSchEnquiry('${e.id}')"><i class="fas fa-eye"></i></button>
      ${waPhone ? `<a class="btn btn-outline" style="padding:5px 8px;font-size:11px;" href="https://wa.me/233${waPhone}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i></a>` : ''}
    </td>
  </tr>`;
  }).join('');
}
document.getElementById('schEnquiryStatusFilter').addEventListener('change', renderSchoolEnquiries);

window.updateSchEnquiryStatus = async function(id, status){
  try { await updateDoc(doc(db, 'enquiries', id), { status }); showToast('Status updated ✓'); }
  catch(e) { showToast('Update failed: ' + e.message, true); }
};

window.viewSchEnquiry = function(id){
  const e = schoolEnquiries.find(x => x.id === id);
  if (!e) return;
  const waPhone = (e.phone || '').replace(/\D/g, '').replace(/^0+/, '');
  const waBtn = document.getElementById('schEnquiryDetailWaBtn');
  if (waPhone) {
    waBtn.href = `https://wa.me/233${waPhone}`;
    waBtn.style.display = 'inline-flex';
  } else {
    waBtn.style.display = 'none';
  }
  document.getElementById('schEnquiryDetailBody').innerHTML = `
    <div style="display:grid;grid-template-columns:110px 1fr;gap:10px 16px;font-size:13.5px;">
      <div style="color:var(--slate-dim);">Name</div><div><strong>${escapeHtml(e.firstName||'')} ${escapeHtml(e.lastName||'')}</strong></div>
      <div style="color:var(--slate-dim);">Date</div><div>${fmtDate(e.createdAt)}</div>
      <div style="color:var(--slate-dim);">Phone</div><div>${e.phone ? `<a class="site-link" href="tel:${escapeHtml(e.phone)}">${escapeHtml(e.phone)}</a>` : '—'}</div>
      <div style="color:var(--slate-dim);">Email</div><div>${e.email ? `<a class="site-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '—'}</div>
      <div style="color:var(--slate-dim);">Course</div><div><span class="badge">${escapeHtml(e.courseType||'—')}</span></div>
      <div style="color:var(--slate-dim);">Status</div><div><span class="badge">${escapeHtml(e.status||'new')}</span></div>
    </div>
    <div style="margin-top:16px;">
      <div style="color:var(--slate-dim);font-size:13.5px;margin-bottom:6px;">Message</div>
      <div style="background:var(--asphalt-deep);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(e.message||'—')}</div>
    </div>
  `;
  openModal('schEnquiryDetailModal');
};

// ============================================================
// NOTIFICATIONS MODULE (school-scoped, combined student + instructor)
// ============================================================
let schNotifStudents = [];
let schNotifInstructors = [];
let schNotifType = 'student';

async function loadSchoolNotificationsPage(){
  window.switchSchNotifType('student');
  try {
    const [studSnap, instrSnap] = await Promise.all([
      getDocs(query(collection(db, "students"), where("schoolId", "==", currentSchoolId))),
      getDocs(query(collection(db, "instructors"), where("schoolId", "==", currentSchoolId)))
    ]);
    schNotifStudents = studSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'pending');
    schNotifInstructors = instrSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => i.status !== 'pending');
    renderSchNotifCheckboxes();
    await loadSchNotifSentList();
  } catch(e) { showToast('Could not load recipients: ' + e.message, true); }
}

function renderSchNotifCheckboxes(){
  const studentList = document.getElementById('schNotifStudentList');
  studentList.innerHTML = schNotifStudents.length
    ? schNotifStudents.map(s => {
        const name = `${s.firstName||''} ${s.lastName||''}`.trim() || s.email;
        return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
          <input type="checkbox" value="${s.id}" class="sch-notif-student-check" style="accent-color:var(--amber);width:15px;height:15px;">
          <span style="font-size:13px;">${escapeHtml(name)}</span>
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--slate-dim);">No students yet.</div>';

  const instrList = document.getElementById('schNotifInstructorList');
  instrList.innerHTML = schNotifInstructors.length
    ? schNotifInstructors.map(i => {
        const name = `${i.firstName||''} ${i.lastName||''}`.trim() || i.email;
        return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border);">
          <input type="checkbox" value="${i.id}" class="sch-notif-instructor-check" style="accent-color:var(--amber);width:15px;height:15px;">
          <span style="font-size:13px;">${escapeHtml(name)}</span>
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--slate-dim);">No instructors yet.</div>';
}

window.filterSchNotifRecipients = function(term){
  const t = (term || '').toLowerCase();
  document.querySelectorAll('#schNotifStudentList label, #schNotifInstructorList label').forEach(label => {
    const name = label.querySelector('span')?.textContent.toLowerCase() || '';
    label.style.display = !t || name.includes(t) ? 'flex' : 'none';
  });
};

window.switchSchNotifType = function(type){
  schNotifType = type;
  document.getElementById('schNotifTabStudent').className = type === 'student' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('schNotifTabInstructor').className = type === 'instructor' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('schNotifTabBoth').className = type === 'both' ? 'btn btn-primary' : 'btn btn-outline';

  document.getElementById('schNotifStudentList').style.display = (type === 'student' || type === 'both') ? 'block' : 'none';
  document.getElementById('schNotifInstructorList').style.display = (type === 'instructor' || type === 'both') ? 'block' : 'none';

  const allLabel = document.getElementById('schNotifyAllLabel');
  allLabel.textContent = type === 'both' ? 'All recipients (students & instructors)' : (type === 'student' ? 'All students' : 'All instructors');
  document.getElementById('schNotifyAll').checked = false;
  document.querySelectorAll('.sch-notif-student-check, .sch-notif-instructor-check').forEach(cb => { cb.checked = false; cb.disabled = false; });
  const searchInput = document.getElementById('schNotifRecipientSearch');
  if (searchInput) { searchInput.value = ''; window.filterSchNotifRecipients(''); }
};

window.toggleSchAllRecipients = function(allCb){
  const checked = allCb.checked;
  if (schNotifType === 'student' || schNotifType === 'both') {
    document.querySelectorAll('.sch-notif-student-check').forEach(cb => { cb.checked = checked; cb.disabled = checked; });
  }
  if (schNotifType === 'instructor' || schNotifType === 'both') {
    document.querySelectorAll('.sch-notif-instructor-check').forEach(cb => { cb.checked = checked; cb.disabled = checked; });
  }
};

window.sendSchNotification = async function(){
  const message = document.getElementById('schNotifMessage').value.trim();
  const icon = document.getElementById('schNotifIcon').value;
  if (!message) { showToast('Enter a message.', true); return; }

  let studentIds = [], instructorIds = [];
  if (schNotifType === 'student' || schNotifType === 'both') {
    studentIds = Array.from(document.querySelectorAll('.sch-notif-student-check:checked')).map(cb => cb.value);
  }
  if (schNotifType === 'instructor' || schNotifType === 'both') {
    instructorIds = Array.from(document.querySelectorAll('.sch-notif-instructor-check:checked')).map(cb => cb.value);
  }
  const total = studentIds.length + instructorIds.length;
  if (!total) { showToast('Select at least one recipient.', true); return; }

  try {
    const writes = [];
    studentIds.forEach(id => writes.push(addDoc(collection(db, "notifications"), {
      studentId: id, message, icon, read: false, type: 'admin',
      createdAt: serverTimestamp(), schoolId: currentSchoolId
    })));
    instructorIds.forEach(id => writes.push(addDoc(collection(db, "instructorNotifications"), {
      instructorId: id, message, icon, read: false, type: 'admin',
      createdAt: serverTimestamp(), schoolId: currentSchoolId
    })));
    await Promise.all(writes);
    showToast(`Sent to ${total} recipient${total>1?'s':''} ✓`);
    document.getElementById('schNotifMessage').value = '';
    document.querySelectorAll('.sch-notif-student-check, .sch-notif-instructor-check').forEach(cb => cb.checked = false);
    document.getElementById('schNotifyAll').checked = false;
    await loadSchNotifSentList();
  } catch(e) { showToast('Send failed: ' + e.message, true); }
};

async function loadSchNotifSentList(){
  const list = document.getElementById('schNotifSentList');
  try {
    const [studentSnaps, instrSnaps] = await Promise.all([
      getDocs(query(collection(db, "notifications"), where("schoolId", "==", currentSchoolId))),
      getDocs(query(collection(db, "instructorNotifications"), where("schoolId", "==", currentSchoolId)))
    ]);
    const items = [
      ...studentSnaps.docs.map(d => ({ id: d.id, ...d.data(), _kind: 'student' })),
      ...instrSnaps.docs.map(d => ({ id: d.id, ...d.data(), _kind: 'instructor' }))
    ].sort((a,b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0)).slice(0, 30);

    if (!items.length) { list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--slate-dim);font-size:13px;">No notifications sent yet.</div>`; return; }

    list.innerHTML = items.map(n => {
      let recipient = 'Unknown';
      if (n._kind === 'student') {
        const s = schNotifStudents.find(x => x.id === n.studentId);
        recipient = s ? `${s.firstName||''} ${s.lastName||''}`.trim() : 'Unknown student';
      } else {
        const i = schNotifInstructors.find(x => x.id === n.instructorId);
        recipient = i ? `${i.firstName||''} ${i.lastName||''}`.trim() : 'Unknown instructor';
      }
      const badge = n._kind === 'instructor' ? ' <span style="color:var(--info);font-size:10px;">(Instructor)</span>' : '';
      return `<div style="padding:12px 16px;border-bottom:1px solid var(--border);">
        <div style="font-size:11px;color:var(--slate-dim);margin-bottom:3px;">To: <strong style="color:var(--amber)">${escapeHtml(recipient)}</strong>${badge} · ${fmtDate(n.createdAt)}</div>
        <div style="font-size:13px;">${escapeHtml(n.message)}</div>
      </div>`;
    }).join('');
  } catch(e) { list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--brake);font-size:13px;">Could not load.</div>`; }
}

// ============================================================
// STUDENT / INSTRUCTOR ROLES MODULE (global: studentRoles/{key}, instructorRoles/{key})
// Mirrors the Staff "Edit role" pattern — a named role holds a set of
// page/feature toggles and can be assigned to any student or instructor
// across every school. Replaces the old per-school Permissions page.
// ============================================================
const defaultStudentRolePages = {
  dashboard: { label: 'Dashboard', enabled: true, locked: true },
  lessons: { label: 'Video Lessons', enabled: true },
  quizzes: { label: 'Quizzes', enabled: true },
  courses: { label: 'Courses', enabled: true },
  attendance: { label: 'Attendance', enabled: true, locked: true },
  progress: { label: 'My Progress', enabled: true },
  classes: { label: 'My Classes', enabled: true },
  instructors: { label: 'My Instructors', enabled: true },
  notifications: { label: 'Notifications', enabled: true, locked: true },
  profile: { label: 'Profile', enabled: true, locked: true },
  faqs: { label: 'FAQs', enabled: true },
  contact: { label: 'Contact School', enabled: true },
  checkin: { label: 'Attendance Check-in', enabled: true },
  editProfile: { label: 'Edit Profile', enabled: true }
};
const defaultInstructorRolePages = {
  dashboard: { label: 'Dashboard', enabled: true, locked: true },
  students: { label: 'My Students', enabled: true, locked: true },
  lessons: { label: 'Video Lessons', enabled: true },
  courses: { label: 'Courses', enabled: true },
  attendance: { label: 'Student Attendance', enabled: true, locked: true },
  myAttendance: { label: 'My Attendance', enabled: true },
  quizzes: { label: 'Quizzes', enabled: true },
  settings: { label: 'Settings', enabled: true, locked: true },
  checkin: { label: 'Class Check-in', enabled: true },
  manageAttendance: { label: 'Manage Student Attendance', enabled: true },
  manageMyAttendance: { label: 'Manage Own Attendance', enabled: true }
};

let allStudentRoles = {};
let allInstructorRoles = {};

async function loadStudentRoleDefinitions(){
  try {
    const snap = await getDocs(collection(db, "studentRoles"));
    if (snap.empty) { await seedDefaultStudentRoles(); return; }
    allStudentRoles = {};
    snap.docs.forEach(d => { allStudentRoles[d.id] = d.data(); });
  } catch(e) { console.error("Could not load student roles:", e); }
}
async function seedDefaultStudentRoles(){
  try {
    await setDoc(doc(db, "studentRoles", "Standard"), { label: "Standard", pages: defaultStudentRolePages });
    const snap = await getDocs(collection(db, "studentRoles"));
    allStudentRoles = {};
    snap.docs.forEach(d => { allStudentRoles[d.id] = d.data(); });
  } catch(e) { console.error("Could not seed student roles:", e); }
}

async function loadInstructorRoleDefinitions(){
  try {
    const snap = await getDocs(collection(db, "instructorRoles"));
    if (snap.empty) { await seedDefaultInstructorRoles(); return; }
    allInstructorRoles = {};
    snap.docs.forEach(d => { allInstructorRoles[d.id] = d.data(); });
  } catch(e) { console.error("Could not load instructor roles:", e); }
}
async function seedDefaultInstructorRoles(){
  try {
    await setDoc(doc(db, "instructorRoles", "Standard"), { label: "Standard", pages: defaultInstructorRolePages });
    const snap = await getDocs(collection(db, "instructorRoles"));
    allInstructorRoles = {};
    snap.docs.forEach(d => { allInstructorRoles[d.id] = d.data(); });
  } catch(e) { console.error("Could not seed instructor roles:", e); }
}

// Populates a role <select> for the add/edit student or instructor forms.
async function populatePortalRoleSelect(selectId, type, selectedKey){
  if (type === 'student') await loadStudentRoleDefinitions();
  else await loadInstructorRoleDefinitions();
  const roles = type === 'student' ? allStudentRoles : allInstructorRoles;
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = Object.entries(roles).map(([key, r]) =>
    `<option value="${key}" ${key === (selectedKey||'Standard') ? 'selected' : ''}>${escapeHtml(r.label || key)}</option>`
  ).join('') || '<option value="Standard">Standard</option>';
}

// Shield-icon handlers on the Students/Instructors tables — opens the
// permission matrix for that person's assigned role. Editing here changes
// access for everyone assigned to the role, exactly like staff role editing.
window.openEditStudentRoleModal = async function(roleKey){
  await loadStudentRoleDefinitions();
  openEditPortalRoleModal('student', roleKey || 'Standard', allStudentRoles, defaultStudentRolePages, 'studentRoles');
};
window.openEditInstructorRoleModal = async function(roleKey){
  await loadInstructorRoleDefinitions();
  openEditPortalRoleModal('instructor', roleKey || 'Standard', allInstructorRoles, defaultInstructorRolePages, 'instructorRoles');
};

function openEditPortalRoleModal(type, roleKey, rolesCache, defaults, collectionName){
  const role = rolesCache[roleKey];
  if (!role) { showToast('Role not found.', true); return; }
  document.getElementById('schEditPortalRoleType').value = type;
  document.getElementById('schEditPortalRoleKey').value = roleKey;
  document.getElementById('schEditPortalRoleTitle').textContent = `Edit ${type === 'student' ? 'student' : 'instructor'} role: ${role.label || roleKey}`;
  document.getElementById('schEditPortalRoleError').textContent = '';

  const pages = { ...defaults, ...(role.pages || {}) };
  const matrix = document.getElementById('schEditPortalRoleMatrix');
  matrix.innerHTML = Object.entries(pages).map(([key, p]) => {
    const locked = p.locked ? 'disabled' : '';
    const lockIcon = p.locked ? '<i class="fas fa-lock" style="color:var(--amber);margin-left:6px;font-size:10px;" title="Required"></i>' : '';
    return `<label style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:8px;cursor:${p.locked?'default':'pointer'};">
      <span style="font-size:13px;font-weight:500;">${escapeHtml(p.label || key)}${lockIcon}</span>
      <input type="checkbox" class="sch-portal-role-check" data-key="${key}" data-label="${escapeHtml(p.label || key)}" data-locked="${!!p.locked}" ${p.enabled !== false ? 'checked' : ''} ${locked} style="width:18px;height:18px;accent-color:var(--amber);" />
    </label>`;
  }).join('');

  document.getElementById('schEditPortalRoleModal')._collectionName = collectionName;
  openModal('schEditPortalRoleModal');
}

document.getElementById('schSavePortalRoleBtn').addEventListener('click', async () => {
  const type = document.getElementById('schEditPortalRoleType').value;
  const roleKey = document.getElementById('schEditPortalRoleKey').value;
  const collectionName = document.getElementById('schEditPortalRoleModal')._collectionName;
  const errEl = document.getElementById('schEditPortalRoleError');
  errEl.textContent = '';
  if (!roleKey || !collectionName) { errEl.textContent = 'Role not found.'; return; }

  const pages = {};
  document.querySelectorAll('.sch-portal-role-check').forEach(cb => {
    pages[cb.dataset.key] = { label: cb.dataset.label, locked: cb.dataset.locked === 'true', enabled: cb.checked };
  });

  const btn = document.getElementById('schSavePortalRoleBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    await updateDoc(doc(db, collectionName, roleKey), { pages, updatedAt: serverTimestamp() });
    if (collectionName === 'studentRoles' && allStudentRoles[roleKey]) allStudentRoles[roleKey].pages = pages;
    if (collectionName === 'instructorRoles' && allInstructorRoles[roleKey]) allInstructorRoles[roleKey].pages = pages;
    closeModal('schEditPortalRoleModal');
    showToast('Permissions updated ✓');
  } catch(e) { errEl.textContent = 'Could not save: ' + e.message; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save permissions'; }
});

// ============================================================
// SETTINGS SUBPAGE — reuses the existing Add/Edit School modal
// ============================================================
function renderSchoolSettings(){
  const school = allSchools.find(s => s.id === currentSchoolId);
  if (!school) return;
  document.getElementById('schSettingsInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:140px 1fr;gap:10px 16px;">
      <div style="color:var(--slate-dim);">Name</div><div>${escapeHtml(school.name)}</div>
      <div style="color:var(--slate-dim);">Region</div><div>${escapeHtml(school.region || '—')}</div>
      <div style="color:var(--slate-dim);">Email</div><div>${school.email ? escapeHtml(school.email) : '—'}</div>
      <div style="color:var(--slate-dim);">Phone 1</div><div>${school.phone1 ? escapeHtml(school.phone1) : '—'}</div>
      <div style="color:var(--slate-dim);">Phone 2</div><div>${school.phone2 ? escapeHtml(school.phone2) : '—'}</div>
      <div style="color:var(--slate-dim);">Website</div><div><a class="site-link" href="${escapeHtml(school.url)}" target="_blank">${escapeHtml(school.url || '—')}</a></div>
      <div style="color:var(--slate-dim);">Status</div><div><span class="badge ${school.status==='inactive'?'bad':'good'}">${escapeHtml(school.status || 'active')}</span></div>
    </div>`;
}


// ============================================================
// MY PROFILE MODULE (personal, per signed-in admin account)
// Firestore: portalAdmins/{uid}
// ============================================================
let pendingMyProfileImageUrl = null;

window.viewMyProfilePhoto = function(){
  const preview = document.getElementById('myProfileImgPreview');
  if (!preview.src || preview.style.display === 'none') { showToast('No photo uploaded yet.', true); return; }
  document.getElementById('myProfileImgViewLarge').src = preview.src;
  openModal('myProfileImgViewModal');
};

async function loadMyProfile(){
  const user = auth.currentUser;
  document.getElementById('pAccountEmail').value = user?.email || '—';
  document.getElementById('myProfileError').textContent = '';
  if (!user) return;
  try {
    const snap = await getDoc(doc(db, "portalAdmins", user.uid));
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('myProfileName').value = data.name || '';
    document.getElementById('myProfileBio').value = data.bio || '';
    pendingMyProfileImageUrl = data.photoUrl || null;
    const preview = document.getElementById('myProfileImgPreview');
    if (data.photoUrl) { preview.src = data.photoUrl; preview.style.display = 'block'; document.getElementById('myProfileImgText').textContent = 'Tap to change photo'; }
    else { preview.style.display = 'none'; document.getElementById('myProfileImgText').textContent = 'Tap to upload a photo'; }
  } catch(e) { showToast('Could not load your profile: ' + e.message, true); }
}

document.getElementById('myProfileImgFile').addEventListener('change', () => {
  const file = document.getElementById('myProfileImgFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('myProfileImgPreview').src = e.target.result;
    document.getElementById('myProfileImgPreview').style.display = 'block';
    document.getElementById('myProfileImgText').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('myProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('myProfileError');
  errEl.textContent = '';
  const user = auth.currentUser;
  if (!user) return;
  const btn = document.getElementById('myProfileSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let photoUrl = pendingMyProfileImageUrl;
    const file = document.getElementById('myProfileImgFile').files[0];
    if (file) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading photo…';
      photoUrl = await uploadInstructorImage(file, 'admins');
    }
    await setDoc(doc(db, "portalAdmins", user.uid), {
      name: document.getElementById('myProfileName').value.trim(),
      bio: document.getElementById('myProfileBio').value.trim(),
      email: user.email,
      photoUrl: photoUrl || null,
      updatedAt: serverTimestamp()
    }, { merge: true });
    pendingMyProfileImageUrl = photoUrl;
    updateTopbarUser(user);
    showToast('Profile saved ✓');
  } catch(e) {
    errEl.textContent = 'Could not save: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save profile';
  }
});

window.resetPortalAdminPassword = async function(){
  const email = auth.currentUser?.email;
  if (!email) { showToast('No signed-in account found.', true); return; }
  if (!(await showConfirm('Send password reset', `Send a password reset link to ${email}?`))) return;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email} ✓`);
  } catch(e) { showToast('Could not send reset email: ' + e.message, true); }
};

// ============================================================
// SITE SETTINGS MODULE (public landing page content)
// Firestore: portalSettings/siteSettings
// ============================================================
const SITE_SETTINGS_DOC = doc(db, "portalSettings", "siteSettings");
let pendingSiteSettingsImageUrl = null;

async function loadSiteSettings(){
  document.getElementById('pSiteError').textContent = '';
  try {
    const snap = await getDoc(SITE_SETTINGS_DOC);
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('pSiteName').value = data.name || '';
    document.getElementById('pSiteTagline').value = data.tagline || '';
    document.getElementById('pSiteBio').value = data.bio || '';
    document.getElementById('pSiteEmail').value = data.email || '';
    document.getElementById('pSitePhone').value = data.phone || '';
    document.getElementById('pSiteFacebook').value = data.facebook || '';
    document.getElementById('pSiteInstagram').value = data.instagram || '';
    document.getElementById('pSiteTwitter').value = data.twitter || '';
    document.getElementById('pSiteWhatsapp').value = data.whatsapp || '';
    pendingSiteSettingsImageUrl = data.imageUrl || null;
    const preview = document.getElementById('pSiteImgPreview');
    if (data.imageUrl) { preview.src = data.imageUrl; preview.style.display = 'block'; document.getElementById('pSiteImgText').textContent = 'Tap to change photo'; }
    else { preview.style.display = 'none'; document.getElementById('pSiteImgText').textContent = 'Tap to upload a hero photo'; }
  } catch(e) { showToast('Could not load site settings: ' + e.message, true); }
}

document.getElementById('pSiteImgFile').addEventListener('change', () => {
  const file = document.getElementById('pSiteImgFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('pSiteImgPreview').src = e.target.result;
    document.getElementById('pSiteImgPreview').style.display = 'block';
    document.getElementById('pSiteImgText').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('siteSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('pSiteError');
  errEl.textContent = '';
  const btn = document.getElementById('pSiteSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let imageUrl = pendingSiteSettingsImageUrl;
    const file = document.getElementById('pSiteImgFile').files[0];
    if (file) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading photo…';
      imageUrl = await uploadInstructorImage(file, 'site');
    }
    const data = {
      name: document.getElementById('pSiteName').value.trim(),
      tagline: document.getElementById('pSiteTagline').value.trim(),
      bio: document.getElementById('pSiteBio').value.trim(),
      email: document.getElementById('pSiteEmail').value.trim(),
      phone: document.getElementById('pSitePhone').value.trim(),
      facebook: document.getElementById('pSiteFacebook').value.trim(),
      instagram: document.getElementById('pSiteInstagram').value.trim(),
      twitter: document.getElementById('pSiteTwitter').value.trim(),
      whatsapp: document.getElementById('pSiteWhatsapp').value.trim(),
      imageUrl: imageUrl || null,
      updatedAt: serverTimestamp()
    };
    await setDoc(SITE_SETTINGS_DOC, data, { merge: true });
    pendingSiteSettingsImageUrl = imageUrl;
    showToast('Site settings saved ✓');
  } catch(e) {
    errEl.textContent = 'Could not save: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save site settings';
  }
});

// ============================================================
// PM/GM BIO MODULE (leadership bio card shown on the landing page)
// Firestore: portalSettings/pmgmBio
// Stat 1 (schools) and Stat 2 (regions) are always computed live from
// allSchools — never stored — so they can't drift out of date.
// ============================================================
const PMGM_BIO_DOC = doc(db, "portalSettings", "pmgmBio");
let pendingPmgmImageUrl = null;

function updatePmgmLiveStats(){
  const schoolCount = allSchools.length;
  const regionCount = new Set(allSchools.map(s => s.region).filter(Boolean)).size;
  const num1 = document.getElementById('pmgmStat1Num');
  const num2 = document.getElementById('pmgmStat2Num');
  if (num1) num1.value = schoolCount;
  if (num2) num2.value = regionCount;
  const p1 = document.getElementById('pmgmPreviewS1Num');
  const p2 = document.getElementById('pmgmPreviewS2Num');
  if (p1) p1.textContent = schoolCount;
  if (p2) p2.textContent = regionCount;
}

function wirePmgmPreview(inputEl, previewEl){
  inputEl.addEventListener('input', () => { previewEl.textContent = inputEl.value.trim() || previewEl.textContent; });
}

async function loadPmgmBio(){
  document.getElementById('pmgmError').textContent = '';
  updatePmgmLiveStats();
  try {
    const snap = await getDoc(PMGM_BIO_DOC);
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('pmgmName').value = data.name || '';
    document.getElementById('pmgmBadge').value = data.badge || '';
    document.getElementById('pmgmRole').value = data.role || '';
    document.getElementById('pmgmBio').value = data.bio || '';
    document.getElementById('pmgmStat1Label').value = data.stat1Label || 'Schools';
    document.getElementById('pmgmStat2Label').value = data.stat2Label || 'Cities';
    document.getElementById('pmgmStat3Num').value = data.stat3Num || '';
    document.getElementById('pmgmStat3Label').value = data.stat3Label || '';
    pendingPmgmImageUrl = data.imageUrl || null;
    const preview = document.getElementById('pmgmImgPreview');
    if (data.imageUrl) { preview.src = data.imageUrl; preview.style.display = 'block'; document.getElementById('pmgmImgText').textContent = 'Tap to change photo'; }
    else { preview.style.display = 'none'; document.getElementById('pmgmImgText').textContent = 'Tap to upload a profile photo'; }

    document.getElementById('pmgmPreviewName').textContent = data.name || '—';
    document.getElementById('pmgmPreviewBadge').textContent = data.badge || 'PM/GM';
    document.getElementById('pmgmPreviewRole').textContent = data.role || '—';
    document.getElementById('pmgmPreviewBio').textContent = data.bio || '—';
    document.getElementById('pmgmPreviewS1Label').textContent = data.stat1Label || 'Schools';
    document.getElementById('pmgmPreviewS2Label').textContent = data.stat2Label || 'Cities';
    document.getElementById('pmgmPreviewS3Num').textContent = data.stat3Num || '0';
    document.getElementById('pmgmPreviewS3Label').textContent = data.stat3Label || 'Portal';
    document.getElementById('pmgmPreviewImg').src = data.imageUrl || '';
  } catch(e) { showToast('Could not load PM/GM bio: ' + e.message, true); }
}

wirePmgmPreview(document.getElementById('pmgmName'), document.getElementById('pmgmPreviewName'));
wirePmgmPreview(document.getElementById('pmgmBadge'), document.getElementById('pmgmPreviewBadge'));
wirePmgmPreview(document.getElementById('pmgmRole'), document.getElementById('pmgmPreviewRole'));
wirePmgmPreview(document.getElementById('pmgmBio'), document.getElementById('pmgmPreviewBio'));
wirePmgmPreview(document.getElementById('pmgmStat1Label'), document.getElementById('pmgmPreviewS1Label'));
wirePmgmPreview(document.getElementById('pmgmStat2Label'), document.getElementById('pmgmPreviewS2Label'));
wirePmgmPreview(document.getElementById('pmgmStat3Num'), document.getElementById('pmgmPreviewS3Num'));
wirePmgmPreview(document.getElementById('pmgmStat3Label'), document.getElementById('pmgmPreviewS3Label'));

document.getElementById('pmgmImgFile').addEventListener('change', () => {
  const file = document.getElementById('pmgmImgFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('pmgmImgPreview').src = e.target.result;
    document.getElementById('pmgmImgPreview').style.display = 'block';
    document.getElementById('pmgmImgText').textContent = file.name;
    document.getElementById('pmgmPreviewImg').src = e.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('pmgmBioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('pmgmError');
  errEl.textContent = '';
  const btn = document.getElementById('pmgmSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let imageUrl = pendingPmgmImageUrl;
    const file = document.getElementById('pmgmImgFile').files[0];
    if (file) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading photo…';
      imageUrl = await uploadInstructorImage(file, 'pmgm'); // reuses school_images_upload preset
    }
    const data = {
      name: document.getElementById('pmgmName').value.trim(),
      badge: document.getElementById('pmgmBadge').value.trim(),
      role: document.getElementById('pmgmRole').value.trim(),
      bio: document.getElementById('pmgmBio').value.trim(),
      stat1Label: document.getElementById('pmgmStat1Label').value.trim(),
      stat2Label: document.getElementById('pmgmStat2Label').value.trim(),
      stat3Num: document.getElementById('pmgmStat3Num').value.trim(),
      stat3Label: document.getElementById('pmgmStat3Label').value.trim(),
      imageUrl: imageUrl || null,
      updatedAt: serverTimestamp()
    };
    await setDoc(PMGM_BIO_DOC, data, { merge: true });
    pendingPmgmImageUrl = imageUrl;
    showToast('PM/GM bio saved ✓');
  } catch(e) {
    errEl.textContent = 'Could not save: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save PM/GM bio';
  }
});


// ============================================================
// STAFF MODULE (school-scoped: schools/{schoolId}/staff/{uid})
// ============================================================
let schoolStaff = [];
let schoolStaffUnsub = null;
let allRoles = {};

// ── Load staff list for the current school ──
function loadSchoolStaff(){
  if (schoolStaffUnsub) { schoolStaffUnsub(); schoolStaffUnsub = null; }
  // Also load roles definitions
  loadRolesDefinitions();

  const q = query(collection(db, "schools", currentSchoolId, "staff"));
  schoolStaffUnsub = onSnapshot(q, (snap) => {
    schoolStaff = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchoolStaff();
  }, (err) => showToast('Could not load staff: ' + err.message, true));
}

// ── Load role definitions from global collection ──
async function loadRolesDefinitions(){
  try {
    const snap = await getDocs(collection(db, "roles"));
    if (snap.empty) {
      // Seed default roles if none exist
      await seedDefaultRoles();
      return;
    }
    allRoles = {};
    snap.docs.forEach(d => { allRoles[d.id] = d.data(); });
  } catch(e) {
    console.error("Could not load roles:", e);
  }
}

// ── Seed default roles ──
async function seedDefaultRoles(){
  const defaultRoles = {
    CEO: {
      label: "CEO",
      description: "Full access to all school features",
      pages: {
        dashboard: { access: true, read: true, create: true, update: true, delete: true },
        students: { access: true, read: true, create: true, update: true, delete: true },
        instructors: { access: true, read: true, create: true, update: true, delete: true },
        attendance: { access: true, read: true, create: true, update: true, delete: true },
        classes: { access: true, read: true, create: true, update: true, delete: true },
        vehicles: { access: true, read: true, create: true, update: true, delete: true },
        certificates: { access: true, read: true, create: true, update: true, delete: true },
        lessons: { access: true, read: true, create: true, update: true, delete: true },
        quizzes: { access: true, read: true, create: true, update: true, delete: true },
        courses: { access: true, read: true, create: true, update: true, delete: true },
        enquiries: { access: true, read: true, create: false, update: true, delete: false },
        notifications: { access: true, read: false, create: true, update: false, delete: false },
        permissions: { access: true, read: false, create: false, update: false, delete: false },
        staff: { access: true, read: true, create: true, update: true, delete: true },
        settings: { access: true, read: true, create: true, update: true, delete: false }
      }
    },
    AdminAssistant: {
      label: "Administrative Assistant",
      description: "Can view and edit students, but cannot delete or manage instructors",
      pages: {
        dashboard: { access: true, read: true, create: false, update: false, delete: false },
        students: { access: true, read: true, create: true, update: true, delete: false },
        instructors: { access: true, read: true, create: false, update: false, delete: false },
        attendance: { access: true, read: true, create: true, update: true, delete: false },
        classes: { access: true, read: true, create: true, update: true, delete: false },
        vehicles: { access: true, read: true, create: false, update: false, delete: false },
        certificates: { access: true, read: true, create: false, update: false, delete: false },
        lessons: { access: true, read: true, create: false, update: false, delete: false },
        quizzes: { access: true, read: true, create: false, update: false, delete: false },
        courses: { access: true, read: true, create: false, update: false, delete: false },
        enquiries: { access: true, read: true, create: false, update: true, delete: false },
        notifications: { access: false, read: false, create: false, update: false, delete: false },
        permissions: { access: false, read: false, create: false, update: false, delete: false },
        staff: { access: false, read: false, create: false, update: false, delete: false },
        settings: { access: false, read: false, create: false, update: false, delete: false }
      }
    },
    BranchManager: {
      label: "Branch Manager",
      description: "Manage their branch only (students, instructors, classes)",
      pages: {
        dashboard: { access: true, read: true, create: false, update: false, delete: false },
        students: { access: true, read: true, create: true, update: true, delete: false },
        instructors: { access: true, read: true, create: true, update: true, delete: false },
        attendance: { access: true, read: true, create: true, update: true, delete: false },
        classes: { access: true, read: true, create: true, update: true, delete: false },
        vehicles: { access: true, read: true, create: false, update: false, delete: false },
        certificates: { access: true, read: true, create: false, update: false, delete: false },
        lessons: { access: true, read: true, create: false, update: false, delete: false },
        quizzes: { access: true, read: true, create: false, update: false, delete: false },
        courses: { access: true, read: true, create: false, update: false, delete: false },
        enquiries: { access: true, read: true, create: false, update: true, delete: false },
        notifications: { access: false, read: false, create: false, update: false, delete: false },
        permissions: { access: false, read: false, create: false, update: false, delete: false },
        staff: { access: false, read: false, create: false, update: false, delete: false },
        settings: { access: false, read: false, create: false, update: false, delete: false }
      }
    }
  };

  try {
    const writes = [];
    Object.entries(defaultRoles).forEach(([key, role]) => {
      writes.push(setDoc(doc(db, "roles", key), role));
    });
    await Promise.all(writes);
    // Reload roles
    const snap = await getDocs(collection(db, "roles"));
    allRoles = {};
    snap.docs.forEach(d => { allRoles[d.id] = d.data(); });
  } catch(e) {
    console.error("Could not seed default roles:", e);
  }
}

// ── Render staff table ──
function renderSchoolStaff(){
  const term = (document.getElementById('schStaffSearch').value || '').toLowerCase();
  const filtered = schoolStaff.filter(s => {
    const name = `${s.firstName||''} ${s.lastName||''} ${s.email||''}`.toLowerCase();
    const roleLabel = allRoles[s.role]?.label || s.role || '';
    return !term || name.includes(term) || roleLabel.toLowerCase().includes(term);
  });

  const tbody = document.getElementById('schStaffTableBody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No staff members found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const roleLabel = allRoles[s.role]?.label || s.role || '—';
    const statusClass = s.status === 'active' ? 'good' : 'bad';
    const name = `${s.firstName||''} ${s.lastName||''}`.trim() || s.email || '—';
    const avatar = s.avatarUrl
      ? `<div style="width:30px;height:30px;border-radius:50%;background-image:url(${s.avatarUrl});background-size:cover;background-position:center;flex-shrink:0;border:1.5px solid var(--amber);"></div>`
      : `<div style="width:30px;height:30px;border-radius:50%;background:rgba(242,169,59,0.15);border:1.5px solid var(--amber);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--amber);flex-shrink:0;">${(s.firstName?.[0]||'')+(s.lastName?.[0]||'')||'?'}</div>`;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px;">${avatar}<div><strong>${escapeHtml(name)}</strong></div></div></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(s.email||'—')}</td>
      <td><span class="badge">${escapeHtml(roleLabel)}</span></td>
      <td>${s.branch ? `<span class="badge">${escapeHtml(s.branch)}</span>` : '—'}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(s.status||'active')}</span></td>
      <td class="row-actions">
        <button class="icon-btn" title="Edit staff" onclick="window.openEditStaffModal('${s.id}')"><i class="fas fa-pen"></i></button>
        <button class="icon-btn" title="Password options" onclick="window.openStaffPasswordOptions('${s.id}','${escapeHtml(s.email||'')}')"><i class="fas fa-key"></i></button>
        <button class="icon-btn" title="Edit role permissions" onclick="window.openEditRoleModal('${s.role}')"><i class="fas fa-shield-alt"></i></button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('schStaffSearch').addEventListener('input', renderSchoolStaff);

// ── Open Add Staff modal ──
document.getElementById('schOpenAddStaffBtn').addEventListener('click', async () => {
  document.getElementById('schAddStaffError').textContent = '';
  ['schStaffFirst','schStaffLast','schStaffEmail','schStaffPhone','schStaffPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schStaffBranchSelect').value = '';
  document.getElementById('schStaffStatusSelect').value = 'active';
  document.getElementById('schStaffBranchField').style.display = 'none';
  document.getElementById('schStaffPhotoFile').value = '';
  document.getElementById('schStaffPhotoPreview').style.display = 'none';
  document.getElementById('schStaffPhotoText').textContent = 'Tap to upload a photo';

  await loadRolesDefinitions();

  const roleSel = document.getElementById('schStaffRoleSelect');
  roleSel.innerHTML = '<option value="">Select role…</option>';
  if (Object.keys(allRoles).length === 0) {
    roleSel.innerHTML = '<option value="">No roles defined – please create roles first</option>';
  } else {
    Object.entries(allRoles).forEach(([key, role]) => {
      roleSel.innerHTML += `<option value="${key}">${escapeHtml(role.label)}</option>`;
    });
  }
  roleSel.onchange = function(){
    document.getElementById('schStaffBranchField').style.display = this.value === 'BranchManager' ? 'block' : 'none';
  };

  openModal('schAddStaffModal');
});

// ── Create staff member (creates a real Firebase Auth account, same
//    pattern as createStudent()/createInstructor()) ──
document.getElementById('schCreateStaffBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schAddStaffError');
  errEl.textContent = '';
  const first = document.getElementById('schStaffFirst').value.trim();
  const last = document.getElementById('schStaffLast').value.trim();
  const email = document.getElementById('schStaffEmail').value.trim();
  const phone = document.getElementById('schStaffPhone').value.trim();
  const role = document.getElementById('schStaffRoleSelect').value;
  const branch = document.getElementById('schStaffBranchSelect').value;
  const status = document.getElementById('schStaffStatusSelect').value;
  const pass = document.getElementById('schStaffPassword').value;

  if (!first || !last || !email || !pass || !role) { errEl.textContent = 'Fill in all required fields.'; return; }

  const btn = document.getElementById('schCreateStaffBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';

  try {
    const apiKey = firebaseConfig.apiKey;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, returnSecureToken: false })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || 'Could not create account.';
      errEl.textContent = msg.includes('EMAIL_EXISTS') ? 'That email is already registered.' : msg;
      return;
    }
    const uid = data.localId;

// --- upload photo if selected ---
let avatarUrl = null;
const photoFile = document.getElementById('schStaffPhotoFile').files[0];
if (photoFile) {
  try {
    avatarUrl = await uploadSchoolImage(photoFile);
  } catch (uploadErr) {
    console.warn('Staff photo upload failed:', uploadErr);
    // non‑fatal – proceed without photo
  }
}

await setDoc(doc(db, "schools", currentSchoolId, "staff", uid), {
  uid, firstName: first, lastName: last, email, phone,
  role, branch: (role === 'BranchManager' && branch) ? branch : null,
  status: status || 'active',
  avatarUrl,   // <-- added
  createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});

    closeModal('schAddStaffModal');
    showToast(`${first} ${last} added as ${allRoles[role]?.label || role} ✓`);
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not add staff: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create staff account';
  }
});

// ── Open Edit Staff modal ──
window.openEditStaffModal = async function(staffUid){
  const staff = schoolStaff.find(s => s.id === staffUid);
  if (!staff) {
    showToast('Staff member not found.', true);
    return;
  }

  // Ensure roles are loaded
  if (Object.keys(allRoles).length === 0) {
    await loadRolesDefinitions();
  }

  document.getElementById('schEditStaffUid').value = staffUid;
  document.getElementById('schEditStaffTitle').textContent = `Edit: ${staff.firstName||''} ${staff.lastName||''}`.trim() || 'Staff';

  // Populate profile fields
  document.getElementById('schEditStaffFirst').value = staff.firstName || '';
  document.getElementById('schEditStaffLast').value = staff.lastName || '';
  document.getElementById('schEditStaffEmail').value = staff.email || '';
  document.getElementById('schEditStaffPhone').value = staff.phone || '';
  document.getElementById('schEditStaffPhotoFile').value = '';
  const photoPreview = document.getElementById('schEditStaffPhotoPreview');
  if (staff.avatarUrl) { photoPreview.src = staff.avatarUrl; photoPreview.style.display = 'block'; }
  else { photoPreview.src = ''; photoPreview.style.display = 'none'; }

  // Populate role dropdown
  const roleSel = document.getElementById('schEditStaffRoleSelect');
  roleSel.innerHTML = '<option value="">Select role…</option>';
  Object.entries(allRoles).forEach(([key, role]) => {
    roleSel.innerHTML += `<option value="${key}" ${key === staff.role ? 'selected' : ''}>${escapeHtml(role.label)}</option>`;
  });

  // Populate branch dropdown
  const branchSel = document.getElementById('schEditStaffBranchSelect');
  branchSel.value = staff.branch || '';

  // Status
  document.getElementById('schEditStaffStatusSelect').value = staff.status || 'active';

  // Toggle branch field
  const branchField = document.getElementById('schEditStaffBranchField');
  branchField.style.display = staff.role === 'BranchManager' ? 'block' : 'none';
  document.getElementById('schEditStaffRoleSelect').onchange = function(){
    branchField.style.display = this.value === 'BranchManager' ? 'block' : 'none';
  };

  document.getElementById('schEditStaffError').textContent = '';
  openModal('schEditStaffModal');
};

// ── Save staff changes ──
document.getElementById('schSaveStaffBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schEditStaffError');
  errEl.textContent = '';
  const uid = document.getElementById('schEditStaffUid').value;
  const firstName = document.getElementById('schEditStaffFirst').value.trim();
  const lastName = document.getElementById('schEditStaffLast').value.trim();
  const phone = document.getElementById('schEditStaffPhone').value.trim();
  const role = document.getElementById('schEditStaffRoleSelect').value;
  const branch = document.getElementById('schEditStaffBranchSelect').value;
  const status = document.getElementById('schEditStaffStatusSelect').value;

  if (!uid || !role) {
    errEl.textContent = 'Role is required.';
    return;
  }
  if (!firstName || !lastName) {
    errEl.textContent = 'First and last name are required.';
    return;
  }

  const btn = document.getElementById('schSaveStaffBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    const updates = {
      firstName, lastName, phone,
      role,
      branch: (role === 'BranchManager' && branch) ? branch : null,
      status,
      updatedAt: serverTimestamp()
    };

    const photoFile = document.getElementById('schEditStaffPhotoFile').files[0];
    if (photoFile) {
      updates.avatarUrl = await uploadSchoolImage(photoFile);
    }

    await updateDoc(doc(db, "schools", currentSchoolId, "staff", uid), updates);
    closeModal('schEditStaffModal');
    showToast('Staff updated ✓');
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not update: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save changes';
  }
});

// ── Delete staff ──
document.getElementById('schDeleteStaffBtn').addEventListener('click', async () => {
  const uid = document.getElementById('schEditStaffUid').value;
  if (!uid) return;
  if (!(await showConfirm('Remove staff member', 'Remove this staff member from the school? They will still exist as a user but lose their staff role.'))) return;

  try {
    await deleteDoc(doc(db, "schools", currentSchoolId, "staff", uid));
    closeModal('schEditStaffModal');
    showToast('Staff removed.');
  } catch(e) {
    showToast('Remove failed: ' + e.message, true);
  }
});

// ── Open Edit Role modal (global role permissions) ──
window.openEditRoleModal = async function(roleKey){
  // Ensure roles are loaded
  if (Object.keys(allRoles).length === 0) {
    await loadRolesDefinitions();
  }
  const role = allRoles[roleKey];
  if (!role) {
    showToast('Role not found. Please ensure roles are seeded.', true);
    return;
  }

  document.getElementById('schEditRoleKey').value = roleKey;
  document.getElementById('schEditRoleName').textContent = role.label || roleKey;
  document.getElementById('schEditRoleError').textContent = '';

  // Build the permission matrix
  const matrix = document.getElementById('schEditRoleMatrix');
  const pages = role.pages || {};
  // Backfill rows for roles that were seeded before Lessons/Quizzes existed,
  // so the checkboxes still show up (defaulting to hidden until explicitly enabled)
  if (!pages.lessons) pages.lessons = { access: false, read: false, create: false, update: false, delete: false };
  if (!pages.quizzes) pages.quizzes = { access: false, read: false, create: false, update: false, delete: false };
  if (!pages.courses) pages.courses = { access: false, read: false, create: false, update: false, delete: false };
  const pageNames = Object.keys(pages).sort();
  const actions = ['access', 'create', 'read', 'update', 'delete'];
  const actionLabels = { access: 'Page Access', create: 'Create', read: 'Read', update: 'Update', delete: 'Delete' };
  const actionColors = { access: 'var(--chalk)', create: 'var(--amber)', read: 'var(--info)', update: 'var(--good)', delete: 'var(--brake)' };

  if (!pageNames.length) {
    matrix.innerHTML = '<div style="color:var(--slate-dim);font-size:13px;">No pages defined for this role.</div>';
    openModal('schEditRoleModal');
    return;
  }

  let html = `<table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--slate);border-bottom:1px solid var(--border);">Page</th>
        ${actions.map(a => `<th style="padding:6px 8px;text-align:center;font-size:11px;color:${actionColors[a]};border-bottom:1px solid var(--border);">${actionLabels[a]}</th>`).join('')}
      </tr>
    </thead>
    <tbody>`;

  pageNames.forEach(page => {
    const perms = pages[page] || {};
    html += `<tr>
      <td style="padding:8px 8px;border-bottom:1px solid var(--border-subtle);font-size:13px;font-weight:500;">${page.charAt(0).toUpperCase()+page.slice(1)}</td>`;
    actions.forEach(a => {
      const rawVal = (a === 'access' && perms.access === undefined) ? perms.read : perms[a];
      const checked = rawVal === true ? 'checked' : '';
      html += `<td style="padding:8px 8px;text-align:center;border-bottom:1px solid var(--border-subtle);">
        <input type="checkbox" class="sch-role-perm-check" data-page="${page}" data-action="${a}" ${checked} style="accent-color:var(--amber);width:16px;height:16px;">
      </td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  matrix.innerHTML = html;

  openModal('schEditRoleModal');
};

// ── Save role permissions ──
document.getElementById('schSaveRoleBtn').addEventListener('click', async () => {
  const roleKey = document.getElementById('schEditRoleKey').value;
  const errEl = document.getElementById('schEditRoleError');
  errEl.textContent = '';

  const checkboxes = document.querySelectorAll('.sch-role-perm-check');
  const pages = {};

  checkboxes.forEach(cb => {
    const page = cb.dataset.page;
    const action = cb.dataset.action;
    if (!pages[page]) pages[page] = {};
    pages[page][action] = cb.checked;
  });

  const role = allRoles[roleKey];
  if (!role) {
    errEl.textContent = 'Role not found.';
    return;
  }

  const btn = document.getElementById('schSaveRoleBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    await updateDoc(doc(db, "roles", roleKey), {
      pages: pages,
      updatedAt: serverTimestamp()
    });
    // Update local cache
    allRoles[roleKey].pages = pages;
    closeModal('schEditRoleModal');
    showToast(`Permissions for "${role.label}" updated ✓`);
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not save: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save permissions';
  }
});
