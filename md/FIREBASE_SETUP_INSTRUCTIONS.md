# 🔥 Firebase Setup Instructions for New Project

## Project Details
- **Project ID**: `teamhub-bf61f`
- **Project Name**: TeamHub

---

## 📋 Step-by-Step Setup

### 1. Enable Authentication
1. Go to https://console.firebase.google.com/project/teamhub-bf61f/authentication
2. Click "Get started"
3. Enable **Email/Password** authentication
4. Enable **Google** authentication (optional)

### 2. Create Firestore Database
1. Go to https://console.firebase.google.com/project/teamhub-bf61f/firestore
2. Click "Create database"
3. Choose **"Start in test mode"** (we'll add proper rules next)
4. Select your preferred location (e.g., `us-central1`)
5. Click "Enable"

### 3. Deploy Firestore Security Rules
1. Go to https://console.firebase.google.com/project/teamhub-bf61f/firestore/rules
2. **Replace ALL rules** with the following:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - each user can only access their own document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Teams collection - ALL MEMBERS HAVE EQUAL PERMISSIONS
    match /teams/{teamId} {
      // Anyone authenticated can read, create, and update teams
      allow read, create, update: if request.auth != null;
      
      // Team subcollections - ALL AUTHENTICATED USERS HAVE FULL ACCESS
      match /tasks/{taskId} {
        allow read, create, update, delete: if request.auth != null;
      }
      
      match /messages/{messageId} {
        allow read, create, update, delete: if request.auth != null;
      }
      
      match /events/{eventId} {
        allow read, create, update, delete: if request.auth != null;
      }
      
      match /activities/{activityId} {
        allow read, create, update, delete: if request.auth != null;
      }
    }
    
    // Join requests collection
    match /joinRequests/{requestId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Click **"Publish"**
4. Wait 10 seconds for rules to propagate

### 4. Test Your Application
1. Open your TeamApp (refresh with Ctrl+Shift+R)
2. Create a new account or sign in
3. Test all features:
   - ✅ Create tasks
   - ✅ Delete tasks (including old ones)
   - ✅ Edit profile settings
   - ✅ Check team section updates
   - ✅ Add events
   - ✅ Send messages

---

## 🎯 What's Been Updated

### Files Modified:
1. **`.env`** - Stores new Firebase configuration
2. **`main.js`** - Updated Firebase config object
3. **`firestore.rules`** - Simplified rules (ready to deploy)

### New Project Benefits:
- ✅ No suspended API key issues
- ✅ Fresh Firestore database
- ✅ Simplified security rules
- ✅ All team members have equal permissions

---

## 🔒 Security Note

The current rules are permissive (any authenticated user can access any team). This is intentional for testing. Once everything works, you can add more restrictive rules like:

```javascript
// More restrictive (future enhancement)
allow read: if request.auth != null && request.auth.uid in resource.data.members.keys();
```

But for now, keep the simple rules to ensure everything works! 🚀

---

## 📞 Need Help?

If you encounter any issues:
1. Check Firebase Console for error messages
2. Check browser console for detailed errors
3. Verify Authentication is enabled
4. Verify Firestore rules are published
5. Hard refresh browser (Ctrl+Shift+R)
