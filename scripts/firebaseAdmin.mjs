import admin from 'firebase-admin';

export function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON が未設定です');
  }

  const serviceAccount = JSON.parse(rawJson);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export function getFirestore() {
  initializeFirebaseAdmin();
  return admin.firestore();
}

export { admin };
