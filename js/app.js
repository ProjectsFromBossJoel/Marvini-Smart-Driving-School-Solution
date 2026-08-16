// js/app.js
// ============================================================
// MARVINI LESSON & QUIZ MANAGEMENT (Shared Resources)
// NO schoolId needed – these are platform-wide.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, query, orderBy, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


// ── FIREBASE CONFIG ──
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



// ── CLOUDINARY CONFIG ──
const CLOUDINARY_CLOUD = "drs2xpwho"; 
const MARVINI_LESSON_UPLOAD_PRESET = "lesson_videos_upload";
const MARVINI_QUIZ_IMAGE_PRESET = "quiz_images_upload";

// ── UTILITY: XHR upload with progress ──
function marviniUploadToCloudinaryWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
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

// ── CONFIRMATION DIALOG ──
let marviniConfirmResolve = null;
window.marviniShowConfirm = function(title, msg) {
  return new Promise((resolve) => {
    document.getElementById('marviniConfirmTitle').textContent = title;
    document.getElementById('marviniConfirmMsg').textContent = msg;
    marviniConfirmResolve = resolve;
    openModal('marviniConfirmModal');
  });
};
window.marviniCloseConfirm = function(confirmed) {
  closeModal('marviniConfirmModal');
  if (marviniConfirmResolve) {
    marviniConfirmResolve(confirmed);
    marviniConfirmResolve = null;
  }
};
document.getElementById('marviniConfirmOkBtn').addEventListener('click', () => marviniCloseConfirm(true));

// ──────────────────────────────────────────────────────────────
// 1. LESSONS MANAGEMENT
// ──────────────────────────────────────────────────────────────

let marviniAllLessonFolders = [];
let marviniAllLessonsFlat = [];
let marviniCurrentLessonFolderPath = null;

async function marviniLoadLessons() {
  try {
    const [lessonSnaps, folderSnaps] = await Promise.all([
      getDocs(collection(db, "lessons")),
      getDocs(collection(db, "lessonFolders"))
    ]);
    marviniAllLessonsFlat = lessonSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
    const customFolders = folderSnaps.docs.map(d => {
      const data = d.data();
      const parentPath = data.parentPath || null;
      const path = data.path || (parentPath ? `${parentPath}/${data.name}` : data.name);
      return { id: d.id, name: data.name, description: data.description || '', parentPath, path };
    });
    marviniAllLessonFolders = customFolders.sort((a,b) => a.name.localeCompare(b.name));
    marviniRenderLessonFolderView();
  } catch(e) { console.error(e); }
}

function marviniRenderLessonFolderView() {
  const path = marviniCurrentLessonFolderPath;
  const titleEl = document.getElementById('marviniLessonsPageTitle');
  const subEl = document.getElementById('marviniLessonsPageSub');
  const backBtn = document.getElementById('marviniLessonBackBtn');
  const addLessonBtn = document.getElementById('marviniLessonAddLessonBtn');
  const breadcrumbEl = document.getElementById('marviniLessonBreadcrumb');
  const tableCard = document.getElementById('marviniLessonTableCard');

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
    breadcrumbEl.innerHTML = marviniRenderLessonBreadcrumb(path);
    tableCard.style.display = "block";
    marviniRenderLessonsTableForFolder(path);
  }

  const subfolders = marviniAllLessonFolders.filter(f => (f.parentPath || null) === path);
  const grid = document.getElementById('marviniLessonFoldersGrid');
  if (!subfolders.length) {
    grid.innerHTML = path
      ? `<div style="grid-column:1/-1;color:var(--slate-dim);font-size:13px;padding:8px 0;">No subfolders here.</div>`
      : `<div style="grid-column:1/-1;text-align:center;color:var(--slate-dim);padding:32px;">No folders yet. Create one to get started.</div>`;
    return;
  }
  grid.innerHTML = subfolders.map(f => `
    <div class="stat-card" style="cursor:pointer;position:relative;" onclick="marviniOpenLessonFolder('${f.path.replace(/'/g, "\\'")}')">
      <div class="stat-card-icon" style="background:rgba(242,169,59,0.1)"><i class="fas fa-folder" style="color:var(--amber)"></i></div>
      <div class="stat-card-value" style="font-size:18px;">${escapeHtml(f.name)}</div>
      <div class="stat-card-label">${marviniAllLessonsFlat.filter(l => (l.folder || '') === f.path).length + marviniAllLessonFolders.filter(sf => (sf.parentPath || null) === f.path).length} items</div>
      ${f.description ? `<div style="font-size:11px;color:var(--slate-dim);margin-top:4px;">${escapeHtml(f.description)}</div>` : ''}
    </div>
  `).join('');
}

function marviniRenderLessonBreadcrumb(path) {
  const segments = path.split('/');
  let acc = '';
  const parts = segments.map((seg, idx) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const isLast = idx === segments.length - 1;
    return isLast
      ? `<span style="color:var(--amber);font-weight:600;">${escapeHtml(seg)}</span>`
      : `<span style="cursor:pointer;text-decoration:underline;" onclick="marviniOpenLessonFolder('${acc.replace(/'/g, "\\'")}')">${escapeHtml(seg)}</span>`;
  });
  const rootLink = `<span style="cursor:pointer;text-decoration:underline;" onclick="marviniBackToLessonFolders()">All folders</span>`;
  return [rootLink, ...parts].join(' <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> ');
}

window.marviniOpenLessonFolder = function(path) {
  marviniCurrentLessonFolderPath = path;
  marviniRenderLessonFolderView();
};
window.marviniBackToLessonFolders = function() {
  marviniCurrentLessonFolderPath = null;
  marviniRenderLessonFolderView();
};
window.marviniLessonFolderGoUp = function() {
  if (!marviniCurrentLessonFolderPath) return;
  const idx = marviniCurrentLessonFolderPath.lastIndexOf('/');
  marviniCurrentLessonFolderPath = idx === -1 ? null : marviniCurrentLessonFolderPath.substring(0, idx);
  marviniRenderLessonFolderView();
};

function marviniRenderLessonsTableForFolder(path) {
  const tbody = document.getElementById('marviniLessonsTable');
  const lessons = marviniAllLessonsFlat.filter(l => (l.folder || '') === path);
  if (!lessons.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-dim);padding:32px;">No lessons in this folder yet.</td></tr>`;
    return;
  }
  // Calculate average completion (optional)
  tbody.innerHTML = lessons.map(l => {
    // We don't have progress data in Marvini, so we'll show a placeholder
    const avgCompletion = '—';
    return `
    <tr>
      <td><div style="font-weight:600">${escapeHtml(l.title)}</div></td>
      <td><span class="stage-pill">${escapeHtml(l.category || 'Theory')}</span></td>
      <td style="color:var(--slate-dim)">${l.duration || '—'}</td>
      <td style="color:var(--amber)">${avgCompletion}</td>
      <td style="color:var(--slate-dim);font-size:12px;">${(() => {
        if (!l.createdAt?.toDate) return '—';
        const d = l.createdAt.toDate();
        const dateStr = d.toLocaleDateString('en-GB');
        let hours = d.getHours();
        const minutes = d.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${dateStr} at ${hours}:${minutes} ${ampm}`;
      })()}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-icon btn-outline" onclick="marviniOpenEditLessonModal('${l.id}')"><i class="fas fa-eye"></i></button>
        <button class="btn btn-icon btn-danger" onclick="marviniDeleteLesson('${l.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

// ── LESSON FOLDER CRUD ──
window.marviniOpenAddFolderModal = async function() {
  const isTopLevel = !marviniCurrentLessonFolderPath;
  document.getElementById('marviniNewFolderCourseGroup').style.display = isTopLevel ? "block" : "none";
  document.getElementById('marviniNewFolderTitleGroup').style.display = isTopLevel ? "none" : "block";
  document.getElementById('marviniNewFolderDescGroup').style.display = isTopLevel ? "none" : "block";
  document.getElementById('marviniAddFolderModalTitle').textContent = isTopLevel ? "New course folder" : "New subfolder";
  document.getElementById('marviniNewFolderTitle').value = '';
  document.getElementById('marviniNewFolderDescription').value = '';
  const hint = document.getElementById('marviniNewFolderParentHint');
  if (hint) hint.textContent = isTopLevel
    ? "This folder will be created at the top level."
    : `This subfolder will be created inside "${marviniCurrentLessonFolderPath}".`;
  if (isTopLevel) {
    const sel = document.getElementById('marviniNewFolderCourseSelect');
    sel.innerHTML = '<option value="">Select course…</option>';
    try {
      // Use existing top‑level lesson folders as course options
      const topLevel = marviniAllLessonFolders.filter(f => f.parentPath === null);
      topLevel.forEach(f => {
        sel.innerHTML += `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`;
      });
      if (topLevel.length === 0) {
        sel.innerHTML += `<option value="" disabled>No course folders yet – create one first</option>`;
      }
    } catch(e) { console.error(e); }
  }
  openModal('marviniAddFolderModal');
};
window.marviniCloseAddFolderModal = function() { closeModal('marviniAddFolderModal'); };

window.marviniCreateLessonFolder = async function() {
  const isTopLevel = !marviniCurrentLessonFolderPath;
  const parentPath = marviniCurrentLessonFolderPath || null;
  let name, description = '';
  if (isTopLevel) {
    name = document.getElementById('marviniNewFolderCourseSelect').value.trim();
    if (!name) { showToast("Select a course.", "error"); return; }
  } else {
    name = document.getElementById('marviniNewFolderTitle').value.trim();
    description = document.getElementById('marviniNewFolderDescription').value.trim();
    if (!name) { showToast("Enter a subfolder title.", "error"); return; }
  }
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (marviniAllLessonFolders.some(f => f.path.toLowerCase() === path.toLowerCase())) {
    showToast("A folder with that name already exists here.", "error");
    return;
  }
  try {
    await addDoc(collection(db, "lessonFolders"), { name, description, parentPath, path, createdAt: serverTimestamp() });
    marviniCloseAddFolderModal();
    showToast("Folder created ✓", "success");
    await marviniLoadLessons();
  } catch(e) {
    console.error(e);
    showToast("Could not create folder. Try again.", "error");
  }
};

// ── LESSON CRUD ──
function marviniPopulateLessonFolderSelect(selectId, selectedValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const sorted = [...marviniAllLessonFolders].sort((a,b) => a.path.localeCompare(b.path));
  sel.innerHTML = sorted.map(f => {
    const depth = f.path.split('/').length - 1;
    const indent = depth > 0 ? '— '.repeat(depth) : '';
    return `<option value="${escapeHtml(f.path)}">${indent}${escapeHtml(f.name)}</option>`;
  }).join('');
  if (selectedValue) sel.value = selectedValue;
}

window.marviniOpenLessonQuizPrompt = function() {
  openModal('marviniLessonQuizPromptModal');
};
window.marviniCloseLessonQuizPrompt = function() {
  closeModal('marviniLessonQuizPromptModal');
};
window.marviniHandleLessonQuizPromptNo = function() {
  closeModal('marviniLessonQuizPromptModal');
  marviniOpenAddLessonModal();
};
window.marviniHandleLessonQuizPromptYes = function() {
  closeModal('marviniLessonQuizPromptModal');
  // Navigate to quizzes page
  showPage('quizzes', document.querySelector('[data-page="quizzes"]'));
};

window.marviniOpenAddLessonModal = function() {
  document.getElementById('marviniEditLessonId').value = '';
  document.getElementById('marviniLessonModalTitle').textContent = 'Add video lesson';
  document.getElementById('marviniLessonTitle').value = '';
  document.getElementById('marviniLessonDuration').value = '';
  document.getElementById('marviniLessonVideoFile').value = '';
  document.getElementById('marviniLessonThumbFile').value = '';
  document.getElementById('marviniLessonVideoPreview').style.display = 'none';
  document.getElementById('marviniLessonThumbPreview').style.display = 'none';
  document.getElementById('marviniLessonVideoText').textContent = 'Tap to upload lesson video (MP4)';
  document.getElementById('marviniLessonThumbText').textContent = 'Tap to upload thumbnail (leave blank for auto)';
  marviniPopulateLessonFolderSelect('marviniLessonFolder', marviniCurrentLessonFolderPath || (marviniAllLessonFolders[0] && marviniAllLessonFolders[0].path));
  // Populate quiz dropdown later
  openModal('marviniLessonModal');
};

window.marviniPreviewLessonVideo = function(input) {
  const file = input.files[0];
  if (!file) return;
  const video = document.getElementById('marviniLessonVideoPreview');
  video.src = URL.createObjectURL(file);
  video.style.display = 'block';
  document.getElementById('marviniLessonVideoText').textContent = file.name;
};
window.marviniPreviewLessonThumb = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('marviniLessonThumbPreview');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('marviniLessonThumbText').textContent = file.name;
  };
  reader.readAsDataURL(file);
};

window.marviniSaveLesson = async function() {
  const id = document.getElementById('marviniEditLessonId').value;
  const title = document.getElementById('marviniLessonTitle').value.trim();
  const folder = document.getElementById('marviniLessonFolder').value;
  const category = document.getElementById('marviniLessonCategory').value;
  const duration = document.getElementById('marviniLessonDuration').value.trim();
  const videoFile = document.getElementById('marviniLessonVideoFile').files[0];
  const thumbFile = document.getElementById('marviniLessonThumbFile').files[0];
  const assignedQuizId = document.getElementById('marviniLessonAssignedQuiz').value || null;

  if (!title || !videoFile) { showToast("Title and video file are required.", "error"); return; }
  if (!folder) { showToast("Select a course folder.", "error"); return; }

  const btn = document.getElementById('marviniLessonSaveBtn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';

  const progWrap = document.getElementById('marviniLessonUploadProgressWrap');
  const progBar = document.getElementById('marviniLessonUploadProgressBar');
  const progPct = document.getElementById('marviniLessonUploadProgressPct');
  const progLabel = document.getElementById('marviniLessonUploadProgressLabel');
  progWrap.style.display = 'block';
  progBar.style.width = '0%';
  progPct.textContent = '0%';
  progLabel.textContent = 'Uploading video…';

  try {
    const cloudinaryFolder = `lessons/${folder}`;
    let videoUrl, videoDurationSec;
    if (videoFile) {
      const fd = new FormData();
      fd.append('file', videoFile);
      fd.append('upload_preset', MARVINI_LESSON_UPLOAD_PRESET);
      fd.append('resource_type', 'video');
      fd.append('folder', cloudinaryFolder);
      const data = await marviniUploadToCloudinaryWithProgress(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
        fd,
        (pct) => { progBar.style.width = pct + '%'; progPct.textContent = pct + '%'; }
      );
      videoUrl = data.secure_url;
      videoDurationSec = data.duration || null;
    }

    let thumbUrl = '';
    if (thumbFile) {
      progLabel.textContent = 'Uploading thumbnail…';
      progBar.style.width = '0%';
      progPct.textContent = '0%';
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading thumbnail…';
      const fd = new FormData();
      fd.append('file', thumbFile);
      fd.append('upload_preset', MARVINI_LESSON_UPLOAD_PRESET);
      fd.append('folder', cloudinaryFolder);
      const data = await marviniUploadToCloudinaryWithProgress(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
        fd,
        (pct) => { progBar.style.width = pct + '%'; progPct.textContent = pct + '%'; }
      );
      thumbUrl = data.secure_url;
    } else {
      thumbUrl = videoUrl.replace('/video/upload/', '/video/upload/so_1,f_jpg/').replace(/\.[^/.]+$/, '.jpg');
    }

    progLabel.textContent = 'Saving…';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    const dataObj = { title, videoUrl, category, duration, folder, videoDurationSec, thumbnailUrl: thumbUrl, assignedQuizId };
    if (id) {
      await updateDoc(doc(db, "lessons", id), dataObj);
    } else {
      dataObj.createdAt = serverTimestamp();
      await addDoc(collection(db, "lessons"), dataObj);
    }
    marviniCloseLessonModal();
    showToast(id ? "Lesson updated ✓" : "Lesson published ✓", "success");
    await marviniLoadLessons();
    if (folder) marviniOpenLessonFolder(folder);
  } catch(e) {
    console.error(e);
    showToast("Could not save lesson. Try again.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    progWrap.style.display = 'none';
  }
};

window.marviniCloseLessonModal = function() {
  const video = document.getElementById('marviniLessonVideoPreview');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  closeModal('marviniLessonModal');
};

window.marviniOpenEditLessonModal = function(lessonId) {
  const lesson = marviniAllLessonsFlat.find(l => l.id === lessonId);
  if (!lesson) return showToast("Lesson not found.", "error");
  document.getElementById('marviniEditLessonId').value = lesson.id;
  document.getElementById('marviniLessonModalTitle').textContent = 'Edit lesson';
  document.getElementById('marviniLessonTitle').value = lesson.title || '';
  document.getElementById('marviniLessonCategory').value = lesson.category || 'Theory';
  document.getElementById('marviniLessonDuration').value = lesson.duration || '';
  document.getElementById('marviniLessonVideoFile').value = '';
  document.getElementById('marviniLessonThumbFile').value = '';
  document.getElementById('marviniLessonVideoText').textContent = 'Tap to replace video';
  document.getElementById('marviniLessonThumbText').textContent = 'Tap to replace thumbnail';
  marviniPopulateLessonFolderSelect('marviniLessonFolder', lesson.folder || marviniCurrentLessonFolderPath || (marviniAllLessonFolders[0] && marviniAllLessonFolders[0].path));
  const videoPreview = document.getElementById('marviniLessonVideoPreview');
  videoPreview.src = lesson.videoUrl || '';
  videoPreview.style.display = lesson.videoUrl ? 'block' : 'none';
  const thumbPreview = document.getElementById('marviniLessonThumbPreview');
  thumbPreview.src = lesson.thumbnailUrl || '';
  thumbPreview.style.display = lesson.thumbnailUrl ? 'block' : 'none';
  // Populate quiz dropdown later
  openModal('marviniLessonModal');
};

window.marviniDeleteLesson = async function(id) {
  if (!(await marviniShowConfirm("Delete lesson", "Delete this lesson?"))) return;
  await deleteDoc(doc(db, "lessons", id));
  showToast("Lesson removed.", "success");
  await marviniLoadLessons();
};

// ──────────────────────────────────────────────────────────────
// 2. QUIZZES MANAGEMENT
// ──────────────────────────────────────────────────────────────

let marviniAllQuizCategories = [];
let marviniAllQuizzesFlat = [];
let marviniCurrentQuizCategoryPath = null;
let marviniCurrentQuizQuestions = [];

async function marviniLoadQuizzes() {
  try {
    const [catSnaps, quizSnaps] = await Promise.all([
      getDocs(collection(db, "quizCategories")),
      getDocs(collection(db, "quizzes"))
    ]);
    marviniAllQuizCategories = catSnaps.docs.map(d => {
      const data = d.data();
      const parentPath = data.parentPath || null;
      const path = data.path || (parentPath ? `${parentPath}/${data.name}` : data.name);
      return { id: d.id, name: data.name, description: data.description || '', parentPath, path };
    }).sort((a,b) => a.name.localeCompare(b.name));
    marviniAllQuizzesFlat = quizSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
    marviniRenderQuizFolderView();
  } catch(e) { console.error(e); }
}

function marviniRenderQuizFolderView() {
  const path = marviniCurrentQuizCategoryPath;
  const titleEl = document.getElementById('marviniQuizPageTitle');
  const subEl = document.getElementById('marviniQuizPageSub');
  const backBtn = document.getElementById('marviniQuizBackBtn');
  const addQuizBtn = document.getElementById('marviniQuizAddQuizBtn');
  const breadcrumbEl = document.getElementById('marviniQuizBreadcrumb');
  const tableCard = document.getElementById('marviniQuizTableCard');
  const isLeaf = path && path.split('/').length >= 2;

  if (!path) {
    titleEl.textContent = "Quizzes";
    subEl.textContent = "Select a course folder to manage its quiz categories.";
    backBtn.style.display = "none";
    breadcrumbEl.style.display = "none";
    addQuizBtn.style.display = "none";
    tableCard.style.display = "none";
  } else {
    const segments = path.split('/');
    titleEl.textContent = segments[segments.length - 1];
    subEl.textContent = isLeaf ? `Quizzes inside "${path}".` : `Categories inside "${path}".`;
    backBtn.style.display = "inline-flex";
    breadcrumbEl.style.display = "block";
    breadcrumbEl.innerHTML = marviniRenderQuizBreadcrumb(path);
    addQuizBtn.style.display = isLeaf ? "inline-flex" : "none";
    tableCard.style.display = isLeaf ? "block" : "none";
    if (isLeaf) marviniRenderQuizzesTableForCategory(path);
  }

  const subfolders = marviniAllQuizCategories.filter(f => (f.parentPath || null) === path);
  const grid = document.getElementById('marviniQuizFoldersGrid');
  if (!subfolders.length) {
    grid.innerHTML = path
      ? `<div style="grid-column:1/-1;color:var(--slate-dim);font-size:13px;padding:8px 0;">No subfolders here.</div>`
      : `<div style="grid-column:1/-1;text-align:center;color:var(--slate-dim);padding:32px;">No course folders yet. Create one to get started.</div>`;
    if (isLeaf) grid.style.display = "none"; else grid.style.display = "grid";
    return;
  }
  grid.style.display = "grid";
  grid.innerHTML = subfolders.map(f => {
    const quizCount = marviniAllQuizzesFlat.filter(q => (q.categoryPath || '') === f.path).length;
    const subfolderCount = marviniAllQuizCategories.filter(sf => (sf.parentPath || null) === f.path).length;
    const count = quizCount + subfolderCount;
    return `
    <div class="stat-card" style="cursor:pointer;position:relative;" onclick="marviniOpenQuizFolder('${f.path.replace(/'/g, "\\'")}')">
      <div class="stat-card-icon" style="background:rgba(242,169,59,0.1)"><i class="fas fa-folder" style="color:var(--amber)"></i></div>
      <div class="stat-card-value" style="font-size:18px;">${escapeHtml(f.name)}</div>
      <div class="stat-card-label">${count} item${count === 1 ? '' : 's'}</div>
      ${f.description ? `<div style="font-size:11px;color:var(--slate-dim);margin-top:4px;">${escapeHtml(f.description)}</div>` : ''}
    </div>`;
  }).join('');
}

function marviniRenderQuizBreadcrumb(path) {
  const segments = path.split('/');
  let acc = '';
  const parts = segments.map((seg, idx) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const isLast = idx === segments.length - 1;
    return isLast
      ? `<span style="color:var(--amber);font-weight:600;">${escapeHtml(seg)}</span>`
      : `<span style="cursor:pointer;text-decoration:underline;" onclick="marviniOpenQuizFolder('${acc.replace(/'/g, "\\'")}')">${escapeHtml(seg)}</span>`;
  });
  const rootLink = `<span style="cursor:pointer;text-decoration:underline;" onclick="marviniBackToQuizFolders()">All categories</span>`;
  return [rootLink, ...parts].join(' <i class="fas fa-chevron-right" style="font-size:9px;margin:0 4px;"></i> ');
}

window.marviniOpenQuizFolder = function(path) {
  marviniCurrentQuizCategoryPath = path;
  marviniRenderQuizFolderView();
};
window.marviniBackToQuizFolders = function() {
  marviniCurrentQuizCategoryPath = null;
  marviniRenderQuizFolderView();
};
window.marviniQuizFolderGoUp = function() {
  if (!marviniCurrentQuizCategoryPath) return;
  const idx = marviniCurrentQuizCategoryPath.lastIndexOf('/');
  marviniCurrentQuizCategoryPath = idx === -1 ? null : marviniCurrentQuizCategoryPath.substring(0, idx);
  marviniRenderQuizFolderView();
};

function marviniRenderQuizzesTableForCategory(path) {
  const tbody = document.getElementById('marviniAdminQuizTable');
  const quizzes = marviniAllQuizzesFlat.filter(q => (q.categoryPath || '') === path);
  if (!quizzes.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-dim);padding:32px;">No quizzes in this category yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = quizzes.map(q => `
    <tr>
      <td><div style="font-weight:600">${escapeHtml(q.title)}</div></td>
      <td style="color:var(--slate-dim)">${q.questionCount || 0}</td>
      <td><span class="stage-pill">${q.passMark || 60}%</span></td>
      <td style="color:var(--amber)">${q.avgScore != null ? q.avgScore + '%' : '—'}</td>
      <td style="color:var(--slate-dim)">${q.completionPct != null ? q.completionPct + '%' : '—'}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-icon btn-outline" title="Manage" onclick="marviniOpenEditQuizModal('${q.id}')"><i class="fas fa-eye"></i></button>
        <button class="btn btn-icon btn-danger" onclick="marviniDeleteQuiz('${q.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

// ── QUIZ CATEGORY CRUD ──
window.marviniOpenAddQuizCategoryModal = async function() {
  const isTopLevel = !marviniCurrentQuizCategoryPath;
  document.getElementById('marviniNewQuizCategoryCourseGroup').style.display = isTopLevel ? "block" : "none";
  document.getElementById('marviniNewQuizCategoryTitleGroup').style.display = isTopLevel ? "none" : "block";
  document.getElementById('marviniNewQuizCategoryDescGroup').style.display = isTopLevel ? "none" : "block";
  document.getElementById('marviniAddQuizCategoryModalTitle').textContent = isTopLevel ? "New course folder" : "New category";
  document.getElementById('marviniNewQuizCategoryTitle').value = '';
  document.getElementById('marviniNewQuizCategoryDescription').value = '';
  document.getElementById('marviniQuizCategorySaveBtn').innerHTML = '<i class="fas fa-folder-plus"></i> Create';
  const hint = document.getElementById('marviniNewQuizCategoryParentHint');
  if (hint) hint.textContent = isTopLevel ? "This folder will be created at the top level." : `This category will be created inside "${marviniCurrentQuizCategoryPath}".`;
  if (isTopLevel) {
    const sel = document.getElementById('marviniNewQuizCategoryCourseSelect');
    sel.innerHTML = '<option value="">Select course…</option>';
    try {
      // Use existing top‑level lesson folders as course options
      const topLevel = marviniAllLessonFolders.filter(f => f.parentPath === null);
      topLevel.forEach(f => {
        sel.innerHTML += `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`;
      });
      if (topLevel.length === 0) {
        sel.innerHTML += `<option value="" disabled>No course folders yet – create one first</option>`;
      }
    } catch(e) { console.error(e); }
  }
  openModal('marviniAddQuizCategoryModal');
};
window.marviniCloseAddQuizCategoryModal = function() { closeModal('marviniAddQuizCategoryModal'); };

window.marviniSaveQuizCategory = async function() {
  const editId = document.getElementById('marviniEditQuizCategoryId').value;
  const isTopLevel = !marviniCurrentQuizCategoryPath;
  const parentPath = marviniCurrentQuizCategoryPath || null;

  if (editId) {
    // Editing existing category
    const cat = marviniAllQuizCategories.find(f => f.id === editId);
    if (!cat) return showToast("Category not found.", "error");
    if (isTopLevel) {
      // Editing a top-level course folder
      const newCourseName = document.getElementById('marviniNewQuizCategoryCourseSelect').value.trim();
      if (!newCourseName) { showToast("Select a course.", "error"); return; }
      const oldPath = cat.path;
      const newPath = newCourseName;
      if (newPath !== oldPath && marviniAllQuizCategories.some(f => f.id !== editId && f.path.toLowerCase() === newPath.toLowerCase())) {
        showToast("A folder for that course already exists.", "error");
        return;
      }
      const btn = document.getElementById('marviniQuizCategorySaveBtn');
      const origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
      try {
        await updateDoc(doc(db, "quizCategories", editId), { name: newCourseName, path: newPath });
        // Update subcategories and quizzes if path changed
        if (newPath !== oldPath) {
          const affectedSubcats = marviniAllQuizCategories.filter(f => f.id !== editId && f.path.startsWith(oldPath + '/'));
          for (const sf of affectedSubcats) {
            const updatedPath = newPath + sf.path.slice(oldPath.length);
            const updatedParentPath = sf.parentPath === oldPath ? newPath : (newPath + sf.parentPath.slice(oldPath.length));
            await updateDoc(doc(db, "quizCategories", sf.id), { path: updatedPath, parentPath: updatedParentPath });
          }
          const affectedQuizzes = marviniAllQuizzesFlat.filter(q => q.categoryPath === oldPath || (q.categoryPath || '').startsWith(oldPath + '/'));
          for (const quiz of affectedQuizzes) {
            const updatedCategoryPath = newPath + quiz.categoryPath.slice(oldPath.length);
            await updateDoc(doc(db, "quizzes", quiz.id), { categoryPath: updatedCategoryPath, courseName: newCourseName });
          }
          if (marviniCurrentQuizCategoryPath === oldPath) marviniCurrentQuizCategoryPath = newPath;
          else if (marviniCurrentQuizCategoryPath && marviniCurrentQuizCategoryPath.startsWith(oldPath + '/')) {
            marviniCurrentQuizCategoryPath = newPath + marviniCurrentQuizCategoryPath.slice(oldPath.length);
          }
        }
        marviniCloseAddQuizCategoryModal();
        showToast("Course folder updated ✓", "success");
        await marviniLoadQuizzes();
      } catch(e) { console.error(e); showToast("Update failed.", "error"); }
      finally { btn.disabled = false; btn.innerHTML = origHTML; }
      return;
    } else {
      // Editing a subcategory
      const newName = document.getElementById('marviniNewQuizCategoryTitle').value.trim();
      const newDesc = document.getElementById('marviniNewQuizCategoryDescription').value.trim();
      if (!newName) { showToast("Name is required.", "error"); return; }
      const newPath = cat.parentPath ? `${cat.parentPath}/${newName}` : newName;
      try {
        await updateDoc(doc(db, "quizCategories", editId), { name: newName, description: newDesc, path: newPath });
        marviniCloseAddQuizCategoryModal();
        showToast("Category updated ✓", "success");
        await marviniLoadQuizzes();
      } catch(e) { showToast("Update failed.", "error"); }
      return;
    }
  }

  // Creating new
  let name, description = '';
  if (isTopLevel) {
    name = document.getElementById('marviniNewQuizCategoryCourseSelect').value.trim();
    if (!name) { showToast("Select a course.", "error"); return; }
  } else {
    name = document.getElementById('marviniNewQuizCategoryTitle').value.trim();
    description = document.getElementById('marviniNewQuizCategoryDescription').value.trim();
    if (!name) { showToast("Enter a category name.", "error"); return; }
  }
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (marviniAllQuizCategories.some(f => f.path.toLowerCase() === path.toLowerCase())) {
    showToast("A folder with that name already exists here.", "error");
    return;
  }
  try {
    await addDoc(collection(db, "quizCategories"), { name, description, parentPath, path, createdAt: serverTimestamp() });
    marviniCloseAddQuizCategoryModal();
    showToast("Folder created ✓", "success");
    await marviniLoadQuizzes();
  } catch(e) { showToast("Could not create folder.", "error"); }
};

// ── QUIZ CRUD ──
window.marviniOpenAddQuizModal = function() {
  if (!marviniCurrentQuizCategoryPath || marviniCurrentQuizCategoryPath.split('/').length < 2) {
    showToast("Open a category first (inside a course folder).", "error");
    return;
  }
  document.getElementById('marviniEditQuizId').value = '';
  document.getElementById('marviniEditQuizTitle').value = '';
  document.getElementById('marviniEditQuizPassMark').value = 60;
  document.getElementById('marviniEditQuizModalTitle').textContent = "New quiz";
  document.getElementById('marviniQuizQuestionsSection').style.display = "none";
  document.getElementById('marviniQuizDeleteBtn').style.display = "none";
  openModal('marviniEditQuizModal');
};

window.marviniOpenEditQuizModal = async function(quizId) {
  const q = marviniAllQuizzesFlat.find(x => x.id === quizId);
  if (!q) return showToast("Quiz not found.", "error");
  document.getElementById('marviniEditQuizId').value = q.id;
  document.getElementById('marviniEditQuizTitle').value = q.title || '';
  document.getElementById('marviniEditQuizPassMark').value = q.passMark || 60;
  document.getElementById('marviniEditQuizModalTitle').textContent = "Edit quiz";
  document.getElementById('marviniQuizQuestionsSection').style.display = "block";
  document.getElementById('marviniQuizDeleteBtn').style.display = "inline-flex";
  await marviniLoadQuizQuestions(quizId);
  openModal('marviniEditQuizModal');
};

window.marviniCloseEditQuizModal = function() {
  closeModal('marviniEditQuizModal');
};

window.marviniSaveQuizMeta = async function() {
  const id = document.getElementById('marviniEditQuizId').value;
  const title = document.getElementById('marviniEditQuizTitle').value.trim();
  const passMark = parseInt(document.getElementById('marviniEditQuizPassMark').value) || 60;
  if (!title) { showToast("Quiz title is required.", "error"); return; }
  if (id) {
    try {
      await updateDoc(doc(db, "quizzes", id), { title, passMark });
      showToast("Quiz updated ✓", "success");
      await marviniLoadQuizzes();
    } catch(e) { showToast("Update failed.", "error"); }
    return;
  }
  const segments = marviniCurrentQuizCategoryPath.split('/');
  try {
    const ref = await addDoc(collection(db, "quizzes"), {
      title, passMark,
      courseName: segments[0],
      categoryName: segments[segments.length - 1],
      categoryPath: marviniCurrentQuizCategoryPath,
      questionCount: 0, avgScore: null, completionPct: null,
      createdAt: serverTimestamp()
    });
    showToast("Quiz created ✓ Now add some questions.", "success");
    await marviniLoadQuizzes();
    marviniOpenEditQuizModal(ref.id);
  } catch(e) { showToast("Could not create quiz.", "error"); }
};

window.marviniDeleteQuiz = async function(id) {
  if (!(await marviniShowConfirm("Delete quiz", "Delete this quiz and all its questions?"))) return;
  try {
    const qSnap = await getDocs(query(collection(db, "quizQuestions"), where("quizId", "==", id)));
    await Promise.all(qSnap.docs.map(d => deleteDoc(doc(db, "quizQuestions", d.id))));
    await deleteDoc(doc(db, "quizzes", id));
    closeModal('marviniEditQuizModal');
    await marviniLoadQuizzes();
    showToast("Quiz removed.", "success");
  } catch(e) { showToast("Delete failed.", "error"); }
};
window.marviniDeleteQuizFromModal = function() {
  marviniDeleteQuiz(document.getElementById('marviniEditQuizId').value);
};

// ── QUIZ QUESTIONS ──
async function marviniLoadQuizQuestions(quizId) {
  try {
    const snaps = await getDocs(query(collection(db, "quizQuestions"), where("quizId", "==", quizId)));
    marviniCurrentQuizQuestions = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.order||0)-(b.order||0));
    marviniRenderQuizQuestionsList();
  } catch(e) { console.error(e); }
}

function marviniRenderQuizQuestionsList() {
  document.getElementById('marviniQuizQuestionCount').textContent = `(${marviniCurrentQuizQuestions.length})`;
  const list = document.getElementById('marviniQuizQuestionsList');
  if (!marviniCurrentQuizQuestions.length) {
    list.innerHTML = '<div style="color:var(--slate-dim);font-size:13px;">No questions yet. Add one or import a CSV.</div>';
    return;
  }
  list.innerHTML = marviniCurrentQuizQuestions.map((q, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--asphalt-deep);border:1px solid var(--border);border-radius:8px;">
      ${q.imageUrl ? `<img src="${q.imageUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;" />` : `<div style="width:40px;height:40px;border-radius:6px;background:rgba(242,169,59,0.1);display:flex;align-items:center;justify-content:center;color:var(--amber);flex-shrink:0;"><i class="fas fa-question" style="font-size:12px;"></i></div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${i+1}. ${escapeHtml(q.text || '')}</div>
        <div style="font-size:11px;color:var(--slate-dim);">Correct: ${escapeHtml(q.correctLabel || '—')}</div>
      </div>
      <button class="btn btn-icon btn-outline" onclick="marviniOpenEditQuestionModal('${q.id}')"><i class="fas fa-pen"></i></button>
      <button class="btn btn-icon btn-danger" onclick="marviniDeleteQuestion('${q.id}')"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');
}

window.marviniOpenAddQuestionModal = function() {
  document.getElementById('marviniEditQuestionId').value = '';
  document.getElementById('marviniAddQuestionModalTitle').textContent = "Add question";
  document.getElementById('marviniQBuilderText').value = '';
  document.getElementById('marviniQBuilderOptA').value = '';
  document.getElementById('marviniQBuilderOptB').value = '';
  document.getElementById('marviniQBuilderOptC').value = '';
  document.getElementById('marviniQBuilderOptD').value = '';
  document.getElementById('marviniQBuilderCorrect').value = 'A';
  document.getElementById('marviniQBuilderImgFile').value = '';
  document.getElementById('marviniQBuilderImgPreview').style.display = 'none';
  document.getElementById('marviniQBuilderImgText').textContent = 'Tap to upload an image';
  document.getElementById('marviniQBuilderSaveBtn')._imageUrl = null;
  openModal('marviniAddQuestionModal');
};

window.marviniOpenEditQuestionModal = function(questionId) {
  const q = marviniCurrentQuizQuestions.find(x => x.id === questionId);
  if (!q) return;
  document.getElementById('marviniEditQuestionId').value = q.id;
  document.getElementById('marviniAddQuestionModalTitle').textContent = "Edit question";
  document.getElementById('marviniQBuilderText').value = q.text || '';
  document.getElementById('marviniQBuilderOptA').value = q.options?.find(o=>o.label==='A')?.text || '';
  document.getElementById('marviniQBuilderOptB').value = q.options?.find(o=>o.label==='B')?.text || '';
  document.getElementById('marviniQBuilderOptC').value = q.options?.find(o=>o.label==='C')?.text || '';
  document.getElementById('marviniQBuilderOptD').value = q.options?.find(o=>o.label==='D')?.text || '';
  document.getElementById('marviniQBuilderCorrect').value = q.correctLabel || 'A';
  const preview = document.getElementById('marviniQBuilderImgPreview');
  if (q.imageUrl) { preview.src = q.imageUrl; preview.style.display = 'block'; document.getElementById('marviniQBuilderImgText').textContent = 'Change image'; }
  else { preview.style.display = 'none'; document.getElementById('marviniQBuilderImgText').textContent = 'Tap to upload an image'; }
  document.getElementById('marviniQBuilderSaveBtn')._imageUrl = q.imageUrl || null;
  openModal('marviniAddQuestionModal');
};

window.marviniCloseAddQuestionModal = function() {
  closeModal('marviniAddQuestionModal');
};

window.marviniPreviewQuestionImage = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('marviniQBuilderImgPreview').src = e.target.result;
    document.getElementById('marviniQBuilderImgPreview').style.display = 'block';
    document.getElementById('marviniQBuilderImgText').textContent = file.name;
  };
  reader.readAsDataURL(file);
};

async function marviniUploadQuizImage(file, quizId) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', MARVINI_QUIZ_IMAGE_PRESET);
  fd.append('folder', `quiz_questions/${quizId}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Image upload failed");
  const data = await res.json();
  return data.secure_url;
}

window.marviniSaveQuestion = async function() {
  const quizId = document.getElementById('marviniEditQuizId').value;
  const editId = document.getElementById('marviniEditQuestionId').value;
  const text = document.getElementById('marviniQBuilderText').value.trim();
  const optA = document.getElementById('marviniQBuilderOptA').value.trim();
  const optB = document.getElementById('marviniQBuilderOptB').value.trim();
  const optC = document.getElementById('marviniQBuilderOptC').value.trim();
  const optD = document.getElementById('marviniQBuilderOptD').value.trim();
  const correctLabel = document.getElementById('marviniQBuilderCorrect').value;
  const imgFile = document.getElementById('marviniQBuilderImgFile').files[0];

  if (!text || !optA || !optB) { showToast("Question text and at least options A & B are required.", "error"); return; }

  const btn = document.getElementById('marviniQBuilderSaveBtn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let imageUrl = btn._imageUrl || null;
    if (imgFile) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading image…';
      imageUrl = await marviniUploadQuizImage(imgFile, quizId);
    }
    const options = [
      { label: 'A', text: optA }, { label: 'B', text: optB },
      ...(optC ? [{ label: 'C', text: optC }] : []),
      ...(optD ? [{ label: 'D', text: optD }] : [])
    ];

    if (editId) {
      await updateDoc(doc(db, "quizQuestions", editId), { text, imageUrl, options, correctLabel });
    } else {
      await addDoc(collection(db, "quizQuestions"), {
        quizId, text, imageUrl, options, correctLabel,
        order: marviniCurrentQuizQuestions.length, createdAt: serverTimestamp()
      });
    }
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: editId ? marviniCurrentQuizQuestions.length : marviniCurrentQuizQuestions.length + 1 });

    marviniCloseAddQuestionModal();
    showToast("Question saved ✓", "success");
    await marviniLoadQuizQuestions(quizId);
    await marviniLoadQuizzes();
  } catch(e) {
    console.error(e);
    showToast("Could not save question. Try again.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
};

window.marviniDeleteQuestion = async function(id) {
  if (!(await marviniShowConfirm("Delete question", "Delete this question?"))) return;
  const quizId = document.getElementById('marviniEditQuizId').value;
  try {
    await deleteDoc(doc(db, "quizQuestions", id));
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: Math.max(0, marviniCurrentQuizQuestions.length - 1) });
    showToast("Question removed.", "success");
    await marviniLoadQuizQuestions(quizId);
    await marviniLoadQuizzes();
  } catch(e) { showToast("Delete failed.", "error"); }
};

// ── CSV IMPORT ──
let marviniPendingCsvRows = [];

function marviniParseQuizCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = [];
    let cur = '', inQuotes = false;
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; }
      else { cur += ch; }
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

window.marviniOpenQuizCsvModal = function() {
  document.getElementById('marviniQuizCsvFile').value = '';
  document.getElementById('marviniQuizCsvPreview').textContent = '';
  document.getElementById('marviniQuizCsvProgressWrap').style.display = 'none';
  document.getElementById('marviniQuizCsvProgressBar').style.width = '0%';
  document.getElementById('marviniQuizCsvProgressPct').textContent = '0%';
  marviniPendingCsvRows = [];
  openModal('marviniQuizCsvModal');
};
window.marviniCloseQuizCsvModal = function() {
  closeModal('marviniQuizCsvModal');
};

document.addEventListener("change", (e) => {
  if (e.target.id === "marviniQuizCsvFile") {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      marviniPendingCsvRows = marviniParseQuizCsv(ev.target.result);
      document.getElementById('marviniQuizCsvPreview').textContent = `${marviniPendingCsvRows.length} question(s) found and ready to import.`;
    };
    reader.readAsText(file);
  }
});

window.marviniImportQuizCsv = async function() {
  const quizId = document.getElementById('marviniEditQuizId').value;
  if (!marviniPendingCsvRows.length) { showToast("Choose a CSV file first.", "error"); return; }

  const importBtn = document.querySelector("#marviniQuizCsvModal .btn-primary");
  const originalBtnHTML = importBtn.innerHTML;
  const progWrap = document.getElementById('marviniQuizCsvProgressWrap');
  const progBar = document.getElementById('marviniQuizCsvProgressBar');
  const progPct = document.getElementById('marviniQuizCsvProgressPct');
  const progLabel = document.getElementById('marviniQuizCsvProgressLabel');

  importBtn.disabled = true;
  importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…';
  progWrap.style.display = 'block';
  progBar.style.width = '0%';
  progPct.textContent = '0%';
  progLabel.textContent = 'Importing questions…';

  try {
    let order = marviniCurrentQuizQuestions.length;
    const total = marviniPendingCsvRows.length;
    let done = 0;
    for (const row of marviniPendingCsvRows) {
      if (!row.text || !row.optA || !row.optB || !row.correctLabel) { done++; continue; }
      const options = [
        { label: 'A', text: row.optA }, { label: 'B', text: row.optB },
        ...(row.optC ? [{ label: 'C', text: row.optC }] : []),
        ...(row.optD ? [{ label: 'D', text: row.optD }] : [])
      ];
      await addDoc(collection(db, "quizQuestions"), {
        quizId, text: row.text, imageUrl: row.imageUrl, options, correctLabel: row.correctLabel,
        order: order++, createdAt: serverTimestamp()
      });
      done++;
      const pct = Math.round((done / total) * 100);
      progBar.style.width = pct + '%';
      progPct.textContent = pct + '%';
    }
    await updateDoc(doc(db, "quizzes", quizId), { questionCount: order });
    marviniCloseQuizCsvModal();
    showToast(`${marviniPendingCsvRows.length} question(s) imported ✓`, "success");
    await marviniLoadQuizQuestions(quizId);
    await marviniLoadQuizzes();
  } catch(e) {
    console.error(e);
    showToast("Import failed. Check the CSV format.", "error");
  } finally {
    importBtn.disabled = false;
    importBtn.innerHTML = originalBtnHTML;
    progWrap.style.display = 'none';
  }
};


// Make lesson/quiz loaders accessible from the inline script
window.marviniLoadLessons = marviniLoadLessons;
window.marviniLoadQuizzes = marviniLoadQuizzes;


// ──────────────────────────────────────────────────────────────
// 3. UPDATE SHOWPAGE TO LOAD LESSONS & QUIZZES
// ──────────────────────────────────────────────────────────────

// Override or extend the existing showPage function.
// We'll patch it to include lessons and quizzes loading.
// Since we are inside the module, we can modify the behavior.

// Find the existing showPage function (it's defined above using `function showPage`).
// We'll wrap it to preserve the original functionality but add our own logic.
// Since we cannot easily override the existing one without breaking, we'll add a listener.

// But easier: we can modify the existing showPage function in the code directly.
// We'll instruct the user to add these lines inside the existing showPage function.

// In the user's code, there is a `showPage` function that handles navigation.
// They need to add:
//   if (name === "lessons") { await marviniLoadLessons(); }
//   if (name === "quizzes") { await marviniLoadQuizzes(); }
// I'll provide the updated showPage code snippet.

// However, since we are in the module and the user has the original showPage,
// we can just provide the final complete showPage function.

// I'll present the final showPage function as a replacement.

// In the user's HTML, there is an existing showPage function. I'll provide the updated version.
// I'll include the full function in the answer.

// ── FINAL SHOWPAGE (replace the existing one) ──
// The user should locate the existing showPage function and replace it with this:

/*
async function showPage(name, btn) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const titles = {
    dashboard:'Dashboard', schools:'Schools', reports:'Reports', profile:'Profile',
    lessons:'Video Lessons', quizzes:'Quizzes'
  };
  document.getElementById("topbarTitle").textContent = titles[name] || "Dashboard";

  // ── AUTO-REFRESH DATA WHEN SWITCHING PAGES ──
  if (name === "dashboard") {
    // Already handled by listener
  } else if (name === "schools") {
    // Already handled
  } else if (name === "reports") {
    // Already handled
  } else if (name === "lessons") {
    await marviniLoadLessons();
  } else if (name === "quizzes") {
    await marviniLoadQuizzes();
  } else if (name === "profile") {
    loadProfile();
  }
  if (window.innerWidth < 900) document.getElementById("sidebar").classList.remove("open");
}
*/

// The user should replace the existing showPage function with the one above.