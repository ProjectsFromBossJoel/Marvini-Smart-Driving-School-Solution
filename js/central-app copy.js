// js/central-app.js
// ============================================================
// M-SMART CENTRAL ADMIN — v2
// Architecture:
//   - Top-level pages: dashboard / schools / reports / lessons / quizzes / profile
//   - "schools" is now a card grid (schools collection + imageUrl field)
//   - Clicking a card enters SCHOOL DETAIL SCOPE: sidebar swaps to school-scoped
//     nav, breadcrumb shows Schools > <School> > <Section>, and every Firestore
//     query in that scope is filtered with where("schoolId","==", currentSchoolId)
//     — matching the schema Dekay's own admin already writes.
//   - Students module is fully built as the reference implementation.
//     Instructors / Attendance / Classes / Vehicles / Certificates / Enquiries /
//     Permissions follow the exact same recipe (see comment block at bottom).
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
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
// NOTE: create this UNSIGNED upload preset in the Cloudinary console before
// school image uploads will work: Settings > Upload > Add upload preset,
// name it exactly "school_images_upload", signing mode = Unsigned.
const SCHOOL_IMAGE_PRESET = "school_images_upload";

function escapeHtml(str){ return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
window.escapeHtml = escapeHtml;

function fmtDate(ts){
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

// ============================================================
// GENERIC PAGINATION HELPER — used by every table that can grow large
// (Students, Instructors, Attendance, Classes, Certificates, Enquiries).
// 10 rows per page. Each table keeps its own page number under a key.
// ============================================================
const PAGE_SIZE = 10;
const pageState = {};
function getPage(key){ return pageState[key] || 1; }
function setPage(key, p){ pageState[key] = p; }
function paginateArray(arr, key){
  const total = arr.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let page = getPage(key);
  if (page > totalPages) { page = totalPages; setPage(key, page); }
  const start = (page - 1) * PAGE_SIZE;
  return { items: arr.slice(start, start + PAGE_SIZE), total, page, totalPages };
}
window.__pagerCallbacks = {};
window.__pagerGo = function(key, page){
  setPage(key, page);
  if (window.__pagerCallbacks[key]) window.__pagerCallbacks[key]();
};
function renderPager(elId, key, total, rerenderFn){
  const el = document.getElementById(elId);
  if (!el) return;
  window.__pagerCallbacks[key] = rerenderFn;
  if (!total) { el.innerHTML = ''; return; }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = getPage(key);
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border);font-size:12px;color:var(--slate-dim);flex-wrap:wrap;gap:8px;">
      <span>Showing ${start}–${end} of ${total}</span>
      <div style="display:flex;align-items:center;gap:10px;">
        <button class="icon-btn" ${page<=1?'disabled':''} onclick="window.__pagerGo('${key}',${page-1})"><i class="fas fa-chevron-left"></i></button>
        <span>Page ${page} of ${totalPages}</span>
        <button class="icon-btn" ${page>=totalPages?'disabled':''} onclick="window.__pagerGo('${key}',${page+1})"><i class="fas fa-chevron-right"></i></button>
      </div>
    </div>`;
}

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
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.style.display = 'none';
    appShell.classList.add('show');
    adminEmailEl.textContent = user.email;
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
  dashboard: { title: 'Dashboard', sub: 'Overview of every driving school on the portal' },
  schools:   { title: 'Schools', sub: 'Click a school to manage everything about it' },
  reports:   { title: 'Reports', sub: 'How schools are distributed across Ghana' },
  lessons:   { title: 'Video Lessons', sub: 'Manage platform-wide video lessons (shared across all schools).' },
  quizzes:   { title: 'Quizzes', sub: 'Manage platform-wide quizzes and questions (shared across all schools).' },
  profile:   { title: 'Portal Profile', sub: 'Edit the profile card shown on the public landing page' }
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

  if (pageName === 'lessons') loadLessons();
  if (pageName === 'quizzes') loadQuizzes();
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

    const data = { name, region, url, status };
    if (email) data.email = email;
    if (phone1) data.phone1 = phone1;
    if (phone2) data.phone2 = phone2;
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
    overview:'Overview', students:'Students', instructors:'Instructors', attendance:'Attendance',
    classes:'Classes', vehicles:'Vehicles', certificates:'Certificates', enquiries:'Enquiries',
    permissions:'Permissions', settings:'School Settings'
  };
  document.getElementById('pageTitle').textContent = `${school.name} — ${labelMap[subpage] || subpage}`;
  document.getElementById('pageSubtitle').textContent = `Managing ${labelMap[subpage]?.toLowerCase() || subpage} for this school only.`;

  const bc = document.getElementById('breadcrumb');
  bc.style.display = 'block';
  bc.innerHTML = `<span class="crumb-link" onclick="window.backToSchools()">Schools</span> <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> <span class="crumb-current">${escapeHtml(school.name)} · ${labelMap[subpage] || subpage}</span>`;

  if (subpage === 'overview') renderSchoolDetailOverview();
  if (subpage === 'students') loadSchoolStudents();
  if (subpage === 'instructors') loadSchoolInstructors();
  if (subpage === 'attendance') loadSchoolAttendance();
  if (subpage === 'classes') loadSchoolClasses();
  if (subpage === 'vehicles') loadSchoolVehicles();
  if (subpage === 'certificates') loadSchoolCertificates();
  if (subpage === 'enquiries') loadSchoolEnquiries();
  if (subpage === 'permissions') loadSchoolPermissions();
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
        <td><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(s.email||'')}</div></td>
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
    renderPager('schStudentsPagination', 'schStudents', 0, renderSchoolStudents);
    return;
  }
  const { items: pageStudents, total: studentTotal } = paginateArray(active, 'schStudents');
  tbody.innerHTML = pageStudents.map(s => {
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
      </td>
    </tr>`;
  }).join('');
  renderPager('schStudentsPagination', 'schStudents', studentTotal, renderSchoolStudents);
}
document.getElementById('schStudentSearch').addEventListener('input', () => { setPage('schStudents', 1); renderSchoolStudents(); });

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
document.getElementById('schOpenAddStudentBtn').addEventListener('click', () => {
  document.getElementById('schAddStudentError').textContent = '';
  ['schNewFirst','schNewLast','schNewEmail','schNewPhone','schNewPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schNewCourse').value = 'Manual';
  openModal('schAddStudentModal');
});

document.getElementById('schCreateStudentBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schAddStudentError');
  errEl.textContent = '';
  const first = document.getElementById('schNewFirst').value.trim();
  const last = document.getElementById('schNewLast').value.trim();
  const email = document.getElementById('schNewEmail').value.trim();
  const phone = document.getElementById('schNewPhone').value.trim();
  const course = document.getElementById('schNewCourse').value;
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

    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(doc(db, 'students', uid), {
      firstName: first, lastName: last, email, phone,
      courseType: course, role: 'student', trainingStage: 1, status: 'active',
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

// ── Student detail / edit / delete / reset password ──
window.openStudentDetail = function(uid){
  const s = schoolStudents.find(x => x.id === uid);
  if (!s) return;
  document.getElementById('schStudentDetailTitle').textContent = `${s.firstName||''} ${s.lastName||''}`.trim() || 'Student';
  document.getElementById('schStudentDetailBody').innerHTML = `
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
    <div class="field"><label>Status</label>
      <select id="schEditStatus" class="field-select">
        <option value="active" ${s.status==='active'?'selected':''}>Active</option>
        <option value="inactive" ${s.status==='inactive'?'selected':''}>Inactive</option>
      </select>
    </div>
    <button class="btn btn-outline" style="width:100%;margin-top:6px;" onclick="window.resetStudentPassword('${s.email||''}')"><i class="fas fa-key"></i> Send password reset email</button>
  `;
  document.getElementById('schStudentSaveBtn').onclick = () => saveStudentDetail(uid);
  document.getElementById('schStudentDeleteBtn').onclick = () => deleteStudentDetail(uid);
  openModal('schStudentDetailModal');
};

async function saveStudentDetail(uid){
  const btn = document.getElementById('schStudentSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    await updateDoc(doc(db, 'students', uid), {
      firstName: document.getElementById('schEditFirst').value.trim(),
      lastName: document.getElementById('schEditLast').value.trim(),
      phone: document.getElementById('schEditPhone').value.trim(),
      courseType: document.getElementById('schEditCourse').value,
      trainingStage: parseInt(document.getElementById('schEditStage').value),
      status: document.getElementById('schEditStatus').value
    });
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
    renderPager('schInstructorsPagination', 'schInstructors', 0, renderSchoolInstructors);
    return;
  }
  const { items: pageInstructors, total: instructorTotal } = paginateArray(approved, 'schInstructors');
  tbody.innerHTML = pageInstructors.map(i => {
    const name = `${i.firstName||''} ${i.lastName||''}`.trim() || '—';
    const statusClass = i.status === 'active' ? 'good' : 'bad';
    // Fallback covers instructors saved under an older field name; if this
    // still shows "—" the branch was genuinely never set on that record —
    // open Edit and set it there.
    const branch = i.branch || i.branchName || i.location || '—';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(i.profilePhoto || i.avatarUrl, i.firstName, i.lastName)}<strong>${escapeHtml(name)}</strong></div></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(i.email||'')}</td>
      <td><span class="badge">${escapeHtml(branch)}</span></td>
      <td><span class="badge ${statusClass}">${escapeHtml(i.status||'active')}</span></td>
      <td class="row-actions">
        <button class="icon-btn" title="View / edit" onclick="window.openInstructorDetail('${i.id}')"><i class="fas fa-eye"></i></button>
      </td>
    </tr>`;
  }).join('');
  renderPager('schInstructorsPagination', 'schInstructors', instructorTotal, renderSchoolInstructors);
}
document.getElementById('schInstructorSearch').addEventListener('input', () => { setPage('schInstructors', 1); renderSchoolInstructors(); });

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

document.getElementById('schOpenAddInstructorBtn').addEventListener('click', () => {
  document.getElementById('schAddInstructorError').textContent = '';
  ['schInstrNewFirst','schInstrNewLast','schInstrNewEmail','schInstrNewPhone','schInstrNewPassword',
   'schInstrNewDob','schInstrNewEngagementDate','schInstrNewExp','schInstrNewGhCardNumber','schInstrNewQual','schInstrNewCert',
   'schInstrNewGuarName','schInstrNewGuarEmail','schInstrNewGuarPhone',
   'schInstrNewRef1Name','schInstrNewRef1Email','schInstrNewRef1Phone',
   'schInstrNewRef2Name','schInstrNewRef2Email','schInstrNewRef2Phone'
  ].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schInstrNewBranch').value = '';
  ['schInstrNewPhotoFile','schInstrNewGhFrontFile','schInstrNewGhBackFile'].forEach(id => document.getElementById(id).value = '');
  ['schInstrNewPhotoPreview','schInstrNewGhFrontPreview','schInstrNewGhBackPreview'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('schInstrNewPhotoText').textContent = 'Tap to upload a profile photo';
  document.getElementById('schInstrNewGhFrontText').textContent = 'Upload front';
  document.getElementById('schInstrNewGhBackText').textContent = 'Upload back';
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
  const certifications = document.getElementById('schInstrNewCert').value.trim();
  const guarantor = {
    name: document.getElementById('schInstrNewGuarName').value.trim(),
    email: document.getElementById('schInstrNewGuarEmail').value.trim(),
    phone: document.getElementById('schInstrNewGuarPhone').value.trim()
  };
  const references = [
    { name: document.getElementById('schInstrNewRef1Name').value.trim(), email: document.getElementById('schInstrNewRef1Email').value.trim(), phone: document.getElementById('schInstrNewRef1Phone').value.trim() },
    { name: document.getElementById('schInstrNewRef2Name').value.trim(), email: document.getElementById('schInstrNewRef2Email').value.trim(), phone: document.getElementById('schInstrNewRef2Phone').value.trim() }
  ];
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
    const [profilePhoto, ghCardFront, ghCardBack] = await Promise.all([
      photoFile ? uploadInstructorImage(photoFile, 'instructors') : Promise.resolve(null),
      ghFrontFile ? uploadInstructorImage(ghFrontFile, 'instructors/ghcards') : Promise.resolve(null),
      ghBackFile ? uploadInstructorImage(ghBackFile, 'instructors/ghcards') : Promise.resolve(null)
    ]);

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(doc(db, 'instructors', uid), {
      firstName: first, lastName: last, email, phone,
      branch: branch || null, dob: dob || null, dateOfEngagement: dateOfEngagement || null,
      profilePhoto, ghCardFront, ghCardBack, ghCardNumber,
      qualifications, certifications, experience,
      guarantor, references,
      role: 'instructor', status: 'active',
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
    <div class="field"><label>Add / replace certifications (text)</label><input id="schInstrEditCert" type="text" value="${typeof i.certifications === 'string' ? escapeHtml(i.certifications) : ''}" placeholder="e.g. Defensive Driving, First Aid"></div>

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
    <button class="btn btn-outline" style="width:100%;margin-top:6px;" onclick="window.resetInstructorPassword('${i.email||''}')"><i class="fas fa-key"></i> Send password reset email</button>
  `;

  wireInstrFilePreview2('schInstrEditPhotoFile', (url) => { _schInstrEditPhoto = url; });
  wireInstrFilePreview2('schInstrEditGhFrontFile', (url) => { _schInstrEditGhFront = url; });
  wireInstrFilePreview2('schInstrEditGhBackFile', (url) => { _schInstrEditGhBack = url; });

  document.getElementById('schInstructorSaveBtn').onclick = () => saveInstructorDetail(uid);
  document.getElementById('schInstructorDeleteBtn').onclick = () => deleteInstructorDetail(uid);
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
      status: document.getElementById('schInstrEditStatus').value
    };
    const certText = document.getElementById('schInstrEditCert').value.trim();
    if (certText) updates.certifications = certText;

    // Upload any newly-picked images (data URLs) to Cloudinary before saving
    const photoFile = document.getElementById('schInstrEditPhotoFile').files[0];
    const ghFrontFile = document.getElementById('schInstrEditGhFrontFile').files[0];
    const ghBackFile = document.getElementById('schInstrEditGhBackFile').files[0];
    if (photoFile) updates.profilePhoto = await uploadInstructorImage(photoFile, 'instructors');
    if (ghFrontFile) updates.ghCardFront = await uploadInstructorImage(ghFrontFile, 'instructors/ghcards');
    if (ghBackFile) updates.ghCardBack = await uploadInstructorImage(ghBackFile, 'instructors/ghcards');

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

// ============================================================
// LESSONS & QUIZZES (platform-wide — unchanged, still placeholders)
// ============================================================
async function loadLessons(){
  document.getElementById('lessonFoldersGrid').innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Lessons module unchanged — reattach your existing marviniLoadLessons() logic here.</div>`;
}
async function loadQuizzes(){
  document.getElementById('quizFoldersGrid').innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Quizzes module unchanged — reattach your existing marviniLoadQuizzes() logic here.</div>`;
}
window.lessonFolderGoUp = () => {};
window.quizFolderGoUp = () => {};
window.openAddFolderModal = () => showToast('Reattach existing lesson-folder modal logic.', true);
window.openAddQuizCategoryModal = () => showToast('Reattach existing quiz-category modal logic.', true);
window.openLessonQuizPrompt = () => {};
window.openAddQuizModal = () => {};

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

function loadSchoolAttendance(){
  if (schoolAttendanceUnsub) { schoolAttendanceUnsub(); schoolAttendanceUnsub = null; }
  const q = query(collection(db, "attendance"), where("schoolId", "==", currentSchoolId));
  schoolAttendanceUnsub = onSnapshot(q, async (snap) => {
    schoolAttendance = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.date?.toDate?.() || new Date(b.date||0)) - (a.date?.toDate?.() || new Date(a.date||0)));

    // Resolve student names by fetching each referenced student doc directly
    // by ID, rather than pre-filtering students by schoolId first. Some
    // legacy attendance records point at students whose own schoolId field
    // is missing/inconsistent — a bulk schoolId-filtered query would silently
    // drop those and print the raw ID instead of a name. Fetching by ID
    // sidesteps that mismatch entirely.
    const missingIds = [...new Set(
      schoolAttendance.map(r => r.studentId).filter(id => id && !schoolAttendanceStudentMap[id])
    )];
    if (missingIds.length) {
      await Promise.all(missingIds.map(async (id) => {
        try {
          const studentDoc = await getDoc(doc(db, "students", id));
          if (studentDoc.exists()) schoolAttendanceStudentMap[id] = studentDoc.data();
        } catch(e) { /* leave unresolved — falls back to raw ID below */ }
      }));
    }
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

  if (!filtered.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No attendance records found.</td></tr>`;
    renderPager('schAttPagination', 'schAtt', 0, renderSchoolAttendance);
    return;
  }

  const { items: pageAtt, total: attTotal } = paginateArray(filtered, 'schAtt');
  tbody.innerHTML = pageAtt.map(r => {
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
  renderPager('schAttPagination', 'schAtt', attTotal, renderSchoolAttendance);
}
document.getElementById('schAttSearch').addEventListener('input', () => { setPage('schAtt', 1); renderSchoolAttendance(); });
document.getElementById('schAttStatusFilter').addEventListener('change', () => { setPage('schAtt', 1); renderSchoolAttendance(); });

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
// CLASSES MODULE (school-scoped)
// TODO (not yet ported from Dekay): vehicle assignment, student
// assignment + double-booking checks, document attachments, online
// meeting link fields. Add/Edit here covers the core scheduling fields.
// ============================================================
let schoolClasses = [];
let schoolClassesUnsub = null;

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
  if (!filtered.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No classes scheduled yet.</td></tr>`;
    renderPager('schClassesPagination', 'schClasses', 0, renderSchoolClasses);
    return;
  }

  const { items: pageClasses, total: classTotal } = paginateArray(filtered, 'schClasses');
  tbody.innerHTML = pageClasses.map(c => {
    const status = classStatus(c);
    const statusClass = status === 'ongoing' ? 'good' : status === 'upcoming' ? 'warn' : 'bad';
    return `<tr>
      <td><strong>${escapeHtml(c.title||'—')}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(c.description||'')}</div></td>
      <td><span class="badge">${escapeHtml(c.courseName||'—')}</span></td>
      <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(c.instructorName||'—')}</td>
      <td style="font-size:12px;">${fmtDateTime(c)}</td>
      <td><span style="font-size:12px;color:var(--slate-dim);"><i class="fas ${c.mode==='online'?'fa-video':'fa-map-marker-alt'}"></i> ${escapeHtml(c.mode||'in-person')}</span></td>
      <td><span class="badge ${statusClass}">${status}</span></td>
      <td class="row-actions"><button class="icon-btn" title="Edit" onclick="window.openSchClassModal('${c.id}')"><i class="fas fa-eye"></i></button></td>
    </tr>`;
  }).join('');
  renderPager('schClassesPagination', 'schClasses', classTotal, renderSchoolClasses);
}
document.getElementById('schClassSearch').addEventListener('input', () => { setPage('schClasses', 1); renderSchoolClasses(); });

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

document.getElementById('schOpenAddClassBtn').addEventListener('click', async () => {
  document.getElementById('schClassError').textContent = '';
  document.getElementById('schClassId').value = '';
  document.getElementById('schClassModalTitle').textContent = 'Schedule class';
  ['schClassTitle','schClassDesc','schClassCourse','schClassDate','schClassTime','schClassEndDate','schClassEndTime'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('schClassMode').value = 'in-person';
  document.getElementById('schClassDeleteBtn').style.display = 'none';
  await populateSchClassInstructorSelect('');
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
  document.getElementById('schClassDeleteBtn').style.display = 'inline-flex';
  await populateSchClassInstructorSelect(c.instructorId || '');
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
  const date = document.getElementById('schClassDate').value;
  const time = document.getElementById('schClassTime').value;
  const endDate = document.getElementById('schClassEndDate').value;
  const endTime = document.getElementById('schClassEndTime').value;
  const mode = document.getElementById('schClassMode').value;

  if (!title || !date || !time || !endDate || !endTime) { errEl.textContent = 'Title, start and end date/time are required.'; return; }
  const durationMinutes = Math.max(1, Math.round((new Date(`${endDate}T${endTime}`) - new Date(`${date}T${time}`)) / 60000));

  const btn = document.getElementById('schClassSaveBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const payload = { title, description, courseName, instructorId, instructorName, date, time, endDate, endTime, durationMinutes, mode, schoolId: currentSchoolId };
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
  if (!filtered.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No certificates issued yet.</td></tr>`;
    renderPager('schCertPagination', 'schCert', 0, renderSchoolCertificates);
    return;
  }
  const { items: pageCerts, total: certTotal } = paginateArray(filtered, 'schCert');
  tbody.innerHTML = pageCerts.map(c => `<tr>
    <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(c.serialNumber||'—')}</td>
    <td><strong>${escapeHtml(c.studentName||'—')}</strong></td>
    <td><span class="badge">${escapeHtml(c.course||'—')}</span></td>
    <td style="font-size:12px;color:var(--slate-dim);">${escapeHtml(c.issueDate||'—')}</td>
    <td class="row-actions">
      ${c.imageUrl ? `<a class="icon-btn" title="View" href="${escapeHtml(c.imageUrl)}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;"><i class="fas fa-eye"></i></a>` : ''}
      <button class="icon-btn danger" title="Delete" onclick="window.deleteSchCertificate('${c.id}')"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
  renderPager('schCertPagination', 'schCert', certTotal, renderSchoolCertificates);
}
document.getElementById('schCertSearch').addEventListener('input', () => { setPage('schCert', 1); renderSchoolCertificates(); });

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
    renderSchoolEnquiries();
  }, (err) => showToast('Could not load enquiries: ' + err.message, true));
}

function renderSchoolEnquiries(){
  const tbody = document.getElementById('schEnquiriesTableBody');
  if (!schoolEnquiries.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No enquiries yet.</td></tr>`;
    renderPager('schEnquiriesPagination', 'schEnquiries', 0, renderSchoolEnquiries);
    return;
  }
  const { items: pageEnq, total: enqTotal } = paginateArray(schoolEnquiries, 'schEnquiries');
  tbody.innerHTML = pageEnq.map(e => `<tr>
    <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(e.createdAt)}</td>
    <td><strong>${escapeHtml(e.firstName||'')} ${escapeHtml(e.lastName||'')}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(e.email||'')}</div></td>
    <td style="font-size:12px;">${escapeHtml(e.phone||'—')}</td>
    <td><span class="badge">${escapeHtml(e.courseType||'—')}</span></td>
    <td style="font-size:12px;max-width:240px;">${escapeHtml(e.message||'—')}</td>
    <td>
      <select class="field-select" style="padding:6px 10px;font-size:12px;" onchange="window.updateSchEnquiryStatus('${e.id}', this.value)">
        <option value="new" ${e.status==='new'?'selected':''}>New</option>
        <option value="contacted" ${e.status==='contacted'?'selected':''}>Contacted</option>
        <option value="booked" ${e.status==='booked'?'selected':''}>Booked</option>
        <option value="closed" ${e.status==='closed'?'selected':''}>Closed</option>
      </select>
    </td>
  </tr>`).join('');
  renderPager('schEnquiriesPagination', 'schEnquiries', enqTotal, renderSchoolEnquiries);
}

window.updateSchEnquiryStatus = async function(id, status){
  try { await updateDoc(doc(db, 'enquiries', id), { status }); showToast('Status updated ✓'); }
  catch(e) { showToast('Update failed: ' + e.message, true); }
};

// ============================================================
// PERMISSIONS MODULE (school-scoped: schools/{schoolId}/permissions/{type})
// ============================================================
const defaultStudentPerms = {
  dashboard: { label: 'Dashboard', enabled: true, locked: true },
  lessons: { label: 'Video Lessons', enabled: true, locked: true },
  quizzes: { label: 'Quizzes', enabled: true },
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
const defaultInstructorPerms = {
  dashboard: { label: 'Dashboard', enabled: true, locked: true },
  students: { label: 'My Students', enabled: true, locked: true },
  attendance: { label: 'Student Attendance', enabled: true, locked: true },
  myAttendance: { label: 'My Attendance', enabled: true },
  quizzes: { label: 'Quizzes', enabled: true },
  settings: { label: 'Settings', enabled: true, locked: true },
  checkin: { label: 'Class Check-in', enabled: true },
  manageAttendance: { label: 'Manage Student Attendance', enabled: true },
  manageMyAttendance: { label: 'Manage Own Attendance', enabled: true }
};

let currentSchPermTab = 'student';
window.switchSchPermTab = function(tab){
  currentSchPermTab = tab;
  document.getElementById('schPermStudentPanel').style.display = tab === 'student' ? 'block' : 'none';
  document.getElementById('schPermInstructorPanel').style.display = tab === 'instructor' ? 'block' : 'none';
  document.getElementById('schPermTabStudentBtn').className = tab === 'student' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('schPermTabInstructorBtn').className = tab === 'instructor' ? 'btn btn-primary' : 'btn btn-outline';
};

async function loadSchoolPermissions(){
  window.switchSchPermTab('student');
  try {
    const [studSnap, instrSnap] = await Promise.all([
      getDoc(doc(db, "schools", currentSchoolId, "permissions", "student_permissions")),
      getDoc(doc(db, "schools", currentSchoolId, "permissions", "instructor_permissions"))
    ]);
    renderSchPermList('schPermStudentList', studSnap.exists() ? studSnap.data() : defaultStudentPerms, 'student');
    renderSchPermList('schPermInstructorList', instrSnap.exists() ? instrSnap.data() : defaultInstructorPerms, 'instructor');
  } catch(e) { showToast('Could not load permissions: ' + e.message, true); }
}

function renderSchPermList(containerId, perms, type){
  const container = document.getElementById(containerId);
  container.innerHTML = Object.entries(perms).map(([key, p]) => {
    const locked = p.locked ? 'disabled' : '';
    const lockIcon = p.locked ? '<i class="fas fa-lock" style="color:var(--amber);margin-left:6px;font-size:10px;" title="Required"></i>' : '';
    return `<label style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:8px;cursor:${p.locked?'default':'pointer'};">
      <span style="font-size:13px;font-weight:500;">${escapeHtml(p.label)}${lockIcon}</span>
      <input type="checkbox" class="sch-perm-${type}-check" data-key="${key}" ${p.enabled?'checked':''} ${locked} style="width:18px;height:18px;accent-color:var(--amber);" />
    </label>`;
  }).join('');
}

window.saveSchPermissions = async function(type){
  const checkClass = `sch-perm-${type}-check`;
  const defaults = type === 'student' ? defaultStudentPerms : defaultInstructorPerms;
  const docId = type === 'student' ? 'student_permissions' : 'instructor_permissions';
  const perms = {};
  Object.entries(defaults).forEach(([key, p]) => { perms[key] = { ...p }; });
  document.querySelectorAll(`.${checkClass}`).forEach(cb => {
    const key = cb.dataset.key;
    if (perms[key] && !perms[key].locked) perms[key].enabled = cb.checked;
  });
  try {
    const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(doc(db, "schools", currentSchoolId, "permissions", docId), perms, { merge: true });
    showToast(`${type === 'student' ? 'Student' : 'Instructor'} permissions saved ✓`);
  } catch(e) { showToast('Save failed: ' + e.message, true); }
};

// ============================================================
//  — reuses the existing Add/Edit School modal
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
        dashboard: { read: true, create: true, update: true, delete: true },
        students: { read: true, create: true, update: true, delete: true },
        instructors: { read: true, create: true, update: true, delete: true },
        attendance: { read: true, create: true, update: true, delete: true },
        classes: { read: true, create: true, update: true, delete: true },
        vehicles: { read: true, create: true, update: true, delete: true },
        certificates: { read: true, create: true, update: true, delete: true },
        enquiries: { read: true, create: false, update: true, delete: false },
        notifications: { read: false, create: true, update: false, delete: false },
        permissions: { read: false, create: false, update: false, delete: false },
        staff: { read: true, create: true, update: true, delete: true },
        settings: { read: true, create: true, update: true, delete: false }
      }
    },
    AdminAssistant: {
      label: "Administrative Assistant",
      description: "Can view and edit students, but cannot delete or manage instructors",
      pages: {
        dashboard: { read: true, create: false, update: false, delete: false },
        students: { read: true, create: true, update: true, delete: false },
        instructors: { read: true, create: false, update: false, delete: false },
        attendance: { read: true, create: true, update: true, delete: false },
        classes: { read: true, create: true, update: true, delete: false },
        vehicles: { read: true, create: false, update: false, delete: false },
        certificates: { read: true, create: false, update: false, delete: false },
        enquiries: { read: true, create: false, update: true, delete: false },
        notifications: { read: false, create: false, update: false, delete: false },
        permissions: { read: false, create: false, update: false, delete: false },
        staff: { read: false, create: false, update: false, delete: false },
        settings: { read: false, create: false, update: false, delete: false }
      }
    },
    BranchManager: {
      label: "Branch Manager",
      description: "Manage their branch only (students, instructors, classes)",
      pages: {
        dashboard: { read: true, create: false, update: false, delete: false },
        students: { read: true, create: true, update: true, delete: false },
        instructors: { read: true, create: true, update: true, delete: false },
        attendance: { read: true, create: true, update: true, delete: false },
        classes: { read: true, create: true, update: true, delete: false },
        vehicles: { read: true, create: false, update: false, delete: false },
        certificates: { read: true, create: false, update: false, delete: false },
        enquiries: { read: true, create: false, update: true, delete: false },
        notifications: { read: false, create: false, update: false, delete: false },
        permissions: { read: false, create: false, update: false, delete: false },
        staff: { read: false, create: false, update: false, delete: false },
        settings: { read: false, create: false, update: false, delete: false }
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
        <button class="icon-btn" title="Edit role permissions" onclick="window.openEditRoleModal('${s.role}')"><i class="fas fa-shield-alt"></i></button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('schStaffSearch').addEventListener('input', renderSchoolStaff);

// ── Open Add Staff modal ──
document.getElementById('schOpenAddStaffBtn').addEventListener('click', async () => {
  document.getElementById('schAddStaffError').textContent = '';
  document.getElementById('schStaffUserSelect').value = '';
  document.getElementById('schStaffRoleSelect').value = '';
  document.getElementById('schStaffBranchSelect').value = '';
  document.getElementById('schStaffStatusSelect').value = 'active';

  // Populate role dropdown
  const roleSel = document.getElementById('schStaffRoleSelect');
  roleSel.innerHTML = '<option value="">Select role…</option>';
  Object.entries(allRoles).forEach(([key, role]) => {
    roleSel.innerHTML += `<option value="${key}">${escapeHtml(role.label)}</option>`;
  });

  // Populate user dropdown (exclude users already in staff)
  const userSel = document.getElementById('schStaffUserSelect');
  userSel.innerHTML = '<option value="">Loading users…</option>';
  try {
    const staffUids = new Set(schoolStaff.map(s => s.id));
    const snap = await getDocs(query(collection(db, "users"), where("role", "in", ["admin", "instructor", "student"])));
    userSel.innerHTML = '<option value="">Select a user…</option>';
    snap.docs.forEach(d => {
      if (!staffUids.has(d.id)) {
        const u = d.data();
        const name = `${u.firstName||''} ${u.lastName||''}`.trim() || u.email;
        userSel.innerHTML += `<option value="${d.id}" data-name="${escapeHtml(name)}" data-email="${escapeHtml(u.email||'')}" data-avatar="${escapeHtml(u.avatarUrl||'')}">${escapeHtml(name)} (${escapeHtml(u.role||'user')})</option>`;
      }
    });
    if (userSel.options.length <= 1) {
      userSel.innerHTML = '<option value="">No available users</option>';
    }
  } catch(e) {
    console.error(e);
    userSel.innerHTML = '<option value="">Error loading users</option>';
  }

  // Toggle branch field based on role
  document.getElementById('schStaffRoleSelect').onchange = function(){
    const branchField = document.getElementById('schStaffBranchField');
    branchField.style.display = this.value === 'BranchManager' ? 'block' : 'none';
  };

  openModal('schAddStaffModal');
});

// ── Create staff member ──
document.getElementById('schCreateStaffBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('schAddStaffError');
  errEl.textContent = '';
  const userSelect = document.getElementById('schStaffUserSelect');
  const uid = userSelect.value;
  const role = document.getElementById('schStaffRoleSelect').value;
  const branch = document.getElementById('schStaffBranchSelect').value;
  const status = document.getElementById('schStaffStatusSelect').value;

  if (!uid || !role) {
    errEl.textContent = 'Select a user and a role.';
    return;
  }

  const btn = document.getElementById('schCreateStaffBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';

  try {
    const selectedOption = userSelect.options[userSelect.selectedIndex];
    const firstName = selectedOption.dataset.name?.split(' ')[0] || '';
    const lastName = selectedOption.dataset.name?.split(' ').slice(1).join(' ') || '';
    const email = selectedOption.dataset.email || '';
    const avatarUrl = selectedOption.dataset.avatar || null;

    await setDoc(doc(db, "schools", currentSchoolId, "staff", uid), {
      uid,
      firstName,
      lastName,
      email,
      avatarUrl,
      role,
      branch: (role === 'BranchManager' && branch) ? branch : null,
      status: status || 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    closeModal('schAddStaffModal');
    showToast(`Staff added with role: ${allRoles[role]?.label || role} ✓`);
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Could not add staff: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Add staff';
  }
});

// ── Open Edit Staff modal ──
window.openEditStaffModal = function(staffUid){
  const staff = schoolStaff.find(s => s.id === staffUid);
  if (!staff) return;

  document.getElementById('schEditStaffUid').value = staffUid;
  document.getElementById('schEditStaffTitle').textContent = `Edit: ${staff.firstName||''} ${staff.lastName||''}`.trim() || 'Staff';

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
  const role = document.getElementById('schEditStaffRoleSelect').value;
  const branch = document.getElementById('schEditStaffBranchSelect').value;
  const status = document.getElementById('schEditStaffStatusSelect').value;

  if (!uid || !role) {
    errEl.textContent = 'Role is required.';
    return;
  }

  const btn = document.getElementById('schSaveStaffBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    await updateDoc(doc(db, "schools", currentSchoolId, "staff", uid), {
      role,
      branch: (role === 'BranchManager' && branch) ? branch : null,
      status,
      updatedAt: serverTimestamp()
    });
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
window.openEditRoleModal = function(roleKey){
  const role = allRoles[roleKey];
  if (!role) {
    showToast('Role not found.', true);
    return;
  }

  document.getElementById('schEditRoleKey').value = roleKey;
  document.getElementById('schEditRoleName').textContent = role.label || roleKey;
  document.getElementById('schEditRoleError').textContent = '';

  // Build the permission matrix
  const matrix = document.getElementById('schEditRoleMatrix');
  const pages = role.pages || {};
  const pageNames = Object.keys(pages).sort();
  const actions = ['create', 'read', 'update', 'delete'];
  const actionLabels = { create: 'Create', read: 'Read', update: 'Update', delete: 'Delete' };
  const actionColors = { create: 'var(--amber)', read: 'var(--info)', update: 'var(--good)', delete: 'var(--brake)' };

  if (!pageNames.length) {
    matrix.innerHTML = '<div style="color:var(--slate-dim);font-size:13px;">No pages defined for this role.</div>';
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
      const checked = perms[a] === true ? 'checked' : '';
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

// ── Hook into showSchoolSubpage ──
const _origShowSchoolSubpage = window.showSchoolSubpage || showSchoolSubpage;
window.showSchoolSubpage = function(subpage, navEl){
  if (_origShowSchoolSubpage) _origShowSchoolSubpage(subpage, navEl);
  if (subpage === 'staff') loadSchoolStaff();
};

// ── Also load staff when school detail opens ──
const _origOpenSchoolDetail2 = window.openSchoolDetail;
window.openSchoolDetail = function(schoolId){
  _origOpenSchoolDetail2(schoolId);
  // Staff will load when the tab is clicked
};

/* ============================================================
   REMAINING GAPS (documented, not yet built in this pass):
   - Lessons/Quizzes are still shared/platform-wide placeholders.
   - Certificate generation UI (html2canvas render + DVLA checklist) not yet ported.
   - Portal Profile page (top-level) still says "wire back in".
   - Staff permissions are defined but not yet enforced in the UI;
     the superAdmin can edit roles, but we still need to apply
     permission checks to each page (phase 2).
============================================================ */


/* ============================================================
   REMAINING GAPS (documented, not yet built in this pass):
   - Lessons/Quizzes are still shared/platform-wide placeholders.
   - Classes: no vehicle/student assignment or conflict checking.
   - Certificates: view/delete only, no generation UI.
   - Portal Profile page (top-level) still says "wire back in".
============================================================ */