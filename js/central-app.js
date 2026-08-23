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
    return;
  }
  tbody.innerHTML = active.map(s => {
    const name = `${s.firstName||''} ${s.lastName||''}`.trim() || '—';
    const statusClass = s.status === 'active' ? 'good' : 'bad';
    return `<tr>
      <td><strong>${escapeHtml(name)}</strong><div style="font-size:11px;color:var(--slate-dim);">${escapeHtml(s.email||'')}</div></td>
      <td><span class="badge">${escapeHtml(s.courseType||'—')}</span></td>
      <td><span class="badge">Stage ${s.trainingStage || 1}</span></td>
      <td><span class="badge ${statusClass}">${escapeHtml(s.status||'active')}</span></td>
      <td style="font-size:12px;color:var(--slate-dim);">${fmtDate(s.createdAt)}</td>
      <td class="row-actions">
        <button class="icon-btn" title="View / edit" onclick="window.openStudentDetail('${s.id}')"><i class="fas fa-eye"></i></button>
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
// LESSONS & QUIZZES (platform-wide — unchanged data model, carried over)
// Full implementations kept out of this file for brevity in this pass;
// they are identical to the working versions already in your codebase
// (marviniLoadLessons / marviniLoadQuizzes and their supporting functions).
// Re-attach that existing, already-working script block here unmodified —
// nothing about the schema or Cloudinary presets changes for this rebuild.
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

/* ============================================================
   HOW TO ADD THE NEXT SCHOOL-SCOPED MODULE (Instructors, Attendance,
   Classes, Vehicles, Certificates, Enquiries, Permissions):

   1. In admin.html, replace the matching #schoolsub-<name> placeholder
      div with real markup (toolbar + table/panel), copied from Dekay's
      admin.html section for that feature.
   2. In this file, add a loadSchool<Name>() function that queries
      collection(db, "<collectionName>") filtered with
      where("schoolId", "==", currentSchoolId) — copy the query + render
      logic straight from Dekay's admin.html/app.js, it already works.
   3. In showSchoolSubpage(), add:
        if (subpage === '<name>') loadSchool<Name>();
   4. Any create/update Firestore write for that module must include
      schoolId: currentSchoolId, exactly like the Students module above.

   This keeps every module on the same predictable pattern instead of
   inventing new architecture per feature.
============================================================ */