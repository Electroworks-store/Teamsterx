/**
 * ============================================
 * FIREBASE CONFIGURATION (SECURE)
 * ============================================
 * 
 * SECURITY NOTE:
 * Firebase Web API keys are PUBLIC IDENTIFIERS, NOT secrets.
 * Security is enforced via:
 *   1. Firestore Security Rules (see firestore.rules)
 *   2. Firebase Storage Rules (see storage.rules)
 *   3. Google Cloud API Key Restrictions (HTTP referrers + API limits)
 *   4. Domain allow-listing
 * 
 * NEVER place service account credentials or admin SDK keys in frontend code.
 * Those are TRUE SECRETS and must remain server-side only.
 * 
 * For detailed security documentation, see: SECURITY.md
 */

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

/**
 * Load Firebase configuration from environment variables
 * In production, these are injected at build time by Vite/bundler
 * In development, these are loaded from .env file (never committed to Git)
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || window.__ENV__?.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || window.__ENV__?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || window.__ENV__?.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || window.__ENV__?.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || window.__ENV__?.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || window.__ENV__?.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || window.__ENV__?.VITE_FIREBASE_MEASUREMENT_ID
};

/**
 * ============================================
 * RUNTIME CONFIGURATION VALIDATION
 * ============================================
 * Validates Firebase config before initialization.
 * Fails loudly with clear error messages if config is missing or invalid.
 * This prevents silent failures and makes misconfiguration obvious.
 */
function assertFirebaseConfig(cfg) {
  const requiredKeys = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId'
  ];

  const missing = requiredKeys.filter(key => {
    const value = cfg[key];
    // Check if missing, empty, or still contains placeholder text
    return !value || value.includes('your-') || value.includes('your_');
  });

  if (missing.length > 0) {
    const errorMsg = `
🚨 FIREBASE CONFIGURATION ERROR 🚨

Missing or invalid Firebase config keys: ${missing.join(', ')}

This usually means:
  1. You haven't created a .env file yet
  2. Environment variables aren't set correctly
  3. The dev server needs to be restarted

How to fix:
  1. Copy .env.example to .env
  2. Fill in your Firebase config values from Firebase Console
  3. Restart your dev server

For detailed setup instructions, see: SECURITY.md
    `.trim();

    console.error(errorMsg);
    throw new Error(`Invalid Firebase configuration. Missing keys: ${missing.join(', ')}`);
  }

  // Warn if running with development config in production
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    if (cfg.authDomain && cfg.authDomain.includes('localhost')) {
      console.warn(
        '⚠️ [SECURITY WARNING] Running production site with localhost config. ' +
        'Verify environment variables are set correctly for production.'
      );
    }
  }

  console.log('✅ Firebase configuration validated successfully');
}

// Validate configuration before initializing Firebase
assertFirebaseConfig(firebaseConfig);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

/**
 * FIRESTORE SECURITY RULES
 * 
 * Copy these rules to your Firestore Security Rules in Firebase Console:
 * 
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     // Messages collection
 *     match /messages/{messageId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     
 *     // Events collection
 *     match /events/{eventId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     
 *     // Tasks collection
 *     match /tasks/{taskId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     
 *     // Activities collection
 *     match /activities/{activityId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     
 *     // Users collection
 *     match /users/{userId} {
 *       allow read, write: if request.auth != null && request.auth.uid == userId;
 *     }
 *   }
 * }
 */

/**
 * FIRESTORE DATABASE STRUCTURE
 * 
 * Collections:
 * 
 * 1. messages/
 *    - author: string
 *    - text: string
 *    - timestamp: timestamp
 *    - time: string
 * 
 * 2. events/
 *    - title: string
 *    - date: string
 *    - time: string
 *    - description: string
 *    - createdBy: string
 *    - timestamp: timestamp
 * 
 * 3. tasks/
 *    - title: string
 *    - description: string
 *    - assignee: string
 *    - priority: string (low, medium, high)
 *    - status: string (todo, inprogress, done)
 *    - createdBy: string
 *    - timestamp: timestamp
 * 
 * 4. activities/
 *    - type: string (message, task, calendar)
 *    - user: string
 *    - description: string
 *    - timestamp: timestamp
 * 
 * 5. users/
 *    - displayName: string
 *    - email: string
 *    - photoURL: string
 *    - status: string
 *    - lastActive: timestamp
 */

// Export configuration (if using modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { firebaseConfig };
}
