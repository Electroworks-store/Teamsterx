# 🔒 Security Documentation

## Overview

This document explains how API keys and secrets are managed in this Firebase web application.

## 🎯 Security Model

### What is Public (Frontend-Safe)

These values are **PUBLIC IDENTIFIERS**, not secrets. They can safely appear in frontend code:

- ✅ Firebase API Key (`apiKey`)
- ✅ Auth Domain (`authDomain`)
- ✅ Project ID (`projectId`)
- ✅ Storage Bucket (`storageBucket`)
- ✅ Messaging Sender ID (`messagingSenderId`)
- ✅ App ID (`appId`)
- ✅ Measurement ID (`measurementId`)

**Why?** Firebase Web API keys are designed to be public. They identify your Firebase project and enable client-side SDKs to connect.

### What is Secret (NEVER in Frontend)

These must **NEVER** appear in frontend code or Git:

- ❌ Service Account JSON files
- ❌ Admin SDK private keys
- ❌ OAuth client secrets
- ❌ Database connection strings with passwords
- ❌ Third-party API secrets (Stripe, SendGrid, etc.)

## 🛡️ How Security is Enforced

Frontend security relies on **server-side enforcement**, not hiding keys:

### 1. Firestore Security Rules (`firestore.rules`)

Controls who can read/write database documents:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users can access
    match /teams/{teamId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 2. Firebase Storage Rules (`storage.rules`)

Controls file upload/download permissions:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 3. Google Cloud API Key Restrictions

**CRITICAL**: Your Firebase API key MUST be restricted in Google Cloud Console.

#### How to Restrict Your API Key:

1. Go to: [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Select your Firebase API key
3. Under **"Application restrictions"**:
   - Select **"HTTP referrers (web sites)"**
   - Add your production domain:
     ```
     https://electroworks-store.github.io/*
     ```
   - Add localhost for development:
     ```
     http://localhost/*
     http://127.0.0.1/*
     ```
4. Under **"API restrictions"**:
   - Select **"Restrict key"**
   - Enable ONLY these APIs:
     - Identity Toolkit API (Firebase Auth)
     - Cloud Firestore API
     - Firebase Storage API
     - Firebase Analytics (if used)
     - Token Service API

**What This Does**: Prevents your API key from being used on unauthorized domains or for unintended Google Cloud services.

## 🚨 What Happened (Google Abuse Warning)

**Issue**: API keys were hard-coded in `main.js`, `firebase-config.js`, and HTML files committed to Git.

**Why This is a Problem**:
- Anyone can view your source code on GitHub
- API keys can be scraped and used on other domains
- Without restrictions, bad actors could abuse your Firebase quota

**Solution Implemented**:
1. ✅ Moved all config to environment variables (`.env`)
2. ✅ Added `.env` to `.gitignore` (never committed)
3. ✅ Created `.env.example` as a safe template
4. ✅ Added runtime validation (fails loudly if config missing)
5. ✅ Added this security documentation

## 📋 Setup Instructions

### For Developers (Local Development)

1. **Copy the template**:
   ```bash
   cp .env.example .env
   ```

2. **Fill in your Firebase config**:
   - Get values from [Firebase Console](https://console.firebase.google.com/)
   - Project Settings → General → Your apps → SDK setup and configuration
   - Copy each value into `.env`

3. **Never commit `.env`**:
   ```bash
   # .gitignore already includes:
   .env
   .env.local
   ```

4. **Run your dev server**:
   ```bash
   # Vite automatically loads .env variables
   npm run dev
   ```

### For Production Deployment

#### Option 1: GitHub Pages with Vite

1. **Set secrets in GitHub**:
   - Go to: Repository → Settings → Secrets and variables → Actions
   - Add each `VITE_*` variable as a repository secret

2. **Update GitHub Actions workflow**:
   ```yaml
   - name: Build
     env:
       VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
       VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
       # ... etc
     run: npm run build
   ```

#### Option 2: Manual Build

1. **Set environment variables**:
   ```bash
   export VITE_FIREBASE_API_KEY="your-key"
   export VITE_FIREBASE_AUTH_DOMAIN="your-domain"
   # ... etc
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Deploy the `dist/` folder**

## 🧪 Runtime Validation

The app includes automatic validation that **fails loudly** if config is missing:

```javascript
function assertFirebaseConfig(cfg) {
  const missing = Object.entries(cfg)
    .filter(([_, v]) => !v || v.includes('your-'))
    .map(([k]) => k);

  if (missing.length) {
    console.error(
      "🚨 [SECURITY] Missing or invalid Firebase config keys:",
      missing
    );
    throw new Error(
      "Invalid Firebase configuration. Check .env file."
    );
  }
}
```

This prevents silent failures and makes misconfiguration obvious.

## ✅ Security Checklist

After setup, verify:

- [ ] `.env` file exists locally with real values
- [ ] `.env` is listed in `.gitignore`
- [ ] `.env.example` is committed (no real keys)
- [ ] No `AIza...` strings in `main.js`, `firebase-config.js`, or HTML files
- [ ] `assertFirebaseConfig()` is called before Firebase initialization
- [ ] API key is restricted in Google Cloud Console (HTTP referrers + API restrictions)
- [ ] Firestore Security Rules are deployed and tested
- [ ] Storage Security Rules are deployed and tested
- [ ] App works in production with environment variables

## 🔍 Git History Cleanup (If Needed)

If API keys were committed to Git history:

1. **Rotate your Firebase API key**:
   - Go to Google Cloud Console → Credentials
   - Create a new API key with restrictions
   - Update Firebase config to use new key
   - Delete the old key

2. **Clean Git history** (optional, advanced):
   ```bash
   # Use git-filter-repo to remove sensitive data
   git filter-repo --invert-paths --path firebase-config.js
   ```

   **Warning**: This rewrites history. Coordinate with all team members.

## 📚 Learn More

- [Firebase Security Rules](https://firebase.google.com/docs/rules)
- [API Key Best Practices](https://cloud.google.com/docs/authentication/api-keys)
- [Firebase Web API Keys](https://firebase.google.com/docs/projects/api-keys)
- [Securing Client-Side Apps](https://firebase.google.com/docs/rules/get-started)

## 🆘 Need Help?

If you see error messages like:

- `"Missing Firebase config keys"`
- `"Invalid Firebase configuration"`
- `"Firebase: Error (auth/invalid-api-key)"`

**Solution**: Check that:
1. `.env` file exists
2. All `VITE_*` variables are set correctly
3. No typos in variable names
4. Dev server was restarted after changing `.env`

---

**Last Updated**: December 17, 2025  
**Maintained By**: Development Team
