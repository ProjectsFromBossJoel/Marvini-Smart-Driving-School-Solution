const admin = require("firebase-admin");

module.exports = async (req, res) => {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    }
    // A cheap, harmless call that proves the credential actually works
    const list = await admin.auth().listUsers(1);
    res.status(200).json({ ok: true, sampleUserCount: list.users.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};