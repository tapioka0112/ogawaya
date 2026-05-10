import admin from 'firebase-admin';

export function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    const serviceAccount = JSON.parse(rawJson);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON または GOOGLE_APPLICATION_CREDENTIALS が未設定です');
  }
  return admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

export function getFirestore() {
  initializeFirebaseAdmin();
  return admin.firestore();
}

export { admin };
