import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(req, res) {
  // CORS — restrict this to your Firebase Hosting domain once live
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { idToken, targetUid, newPassword } = req.body || {};
  if (!idToken || !targetUid || !newPassword) {
    return res.status(400).json({ error: 'Missing idToken, targetUid, or newPassword.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const db = admin.firestore();
    const callerDoc = await db.collection('users').doc(decoded.uid).get();
    const callerRole = callerDoc.exists ? callerDoc.data().role : null;

    if (callerRole !== 'superAdmin') {
      return res.status(403).json({ error: 'Not authorized. Super admin access required.' });
    }

    await admin.auth().updateUser(targetUid, { password: newPassword });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('manual-reset-password error:', err);
    return res.status(500).json({ error: err.message || 'Could not reset password.' });
  }
}