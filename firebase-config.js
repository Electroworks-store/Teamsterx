// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBsV-g9DBRTCE9sk1bsYy4TRsohAETF7vg",
  authDomain: "teamhub-bf61f.firebaseapp.com",
  projectId: "teamhub-bf61f",
  storageBucket: "teamhub-bf61f.firebasestorage.app",
  messagingSenderId: "186552753103",
  appId: "1:186552753103:web:4a102aa3b91aa71c4150ba",
  measurementId: "G-1VH5ZLCH63"
};

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
