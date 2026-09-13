// upload-utils.js

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CLOUD_NAME = 'drs2xpwho';
const UPLOAD_PRESET = 'certificates_uploads'; // your real unsigned preset — used for ALL categories
const GLOBAL_CATEGORIES = ['lessons', 'quizzes']; // never nested per-school

const _schoolSlugCache = {};

/**
 * Resolves a school's folder slug (e.g. "DekayDrivingSch").
 * Looks for schools/{schoolId}.folderSlug first (set this field once per school
 * for full control over naming); falls back to a sanitized school name;
 * falls back to the raw schoolId if the doc can't be read.
 */
export async function getSchoolFolderSlug(db, schoolId) {
  if (!schoolId) return 'Unassigned';
  if (_schoolSlugCache[schoolId]) return _schoolSlugCache[schoolId];
  let slug = schoolId;
  try {
    const snap = await getDoc(doc(db, 'schools', schoolId));
    if (snap.exists()) {
      const data = snap.data();
      const raw = data.folderSlug || data.name || schoolId;
      slug = raw.replace(/\bDriving\s*School\b/gi, 'DrivingSch')
                .replace(/\bSchool\b/gi, 'Sch')
                .replace(/[^a-zA-Z0-9]/g, '');
    }
  } catch (e) { /* keep schoolId as fallback slug */ }
  _schoolSlugCache[schoolId] = slug;
  return slug;
}

/**
 * Uploads a file/dataURL to Cloudinary, nested under the correct school folder
 * unless category is global (lessons/quizzes).
 * category examples: 'certificates', 'students', 'instructors', 'admins', 'class_documents', 'vehicles'
 */
export async function uploadToCloudinary(db, fileOrDataUrl, category, schoolId, resourceType = 'image') {
  const isGlobal = GLOBAL_CATEGORIES.includes(category);
  const folder = isGlobal
    ? category
    : `${category}/${await getSchoolFolderSlug(db, schoolId)}`;

  const formData = new FormData();
  formData.append('file', fileOrDataUrl);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Upload failed (${res.status})`);
  }
  const json = await res.json();
  return json.secure_url;
}