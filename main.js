// ===================================
// FIREBASE CONFIGURATION
// ===================================
/**
 * SECURITY NOTE:
 * Firebase Web API keys are PUBLIC IDENTIFIERS, NOT secrets.
 * Security is enforced via Firestore/Storage rules and API key restrictions.
 * Never place service account credentials or admin keys in frontend code.
 * See SECURITY.md for detailed documentation.
 */
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || window.__ENV__?.VITE_FIREBASE_API_KEY || "AIzaSyBsV-g9DBRTCE9sk1bsYy4TRsohAETF7vg",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || window.__ENV__?.VITE_FIREBASE_AUTH_DOMAIN || "teamhub-bf61f.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || window.__ENV__?.VITE_FIREBASE_PROJECT_ID || "teamhub-bf61f",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || window.__ENV__?.VITE_FIREBASE_STORAGE_BUCKET || "teamhub-bf61f.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || window.__ENV__?.VITE_FIREBASE_MESSAGING_SENDER_ID || "186552753103",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || window.__ENV__?.VITE_FIREBASE_APP_ID || "1:186552753103:web:4a102aa3b91aa71c4150ba",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || window.__ENV__?.VITE_FIREBASE_MEASUREMENT_ID || "G-1VH5ZLCH63"
};

// Initialize Firebase
let db, auth;
let currentAuthUser = null;

// Debug flag - set to true only during development
const DEBUG = false;

// ===================================
// DEBUG_PERMS FLAG - Enable verbose permission debugging
// Set to true to log Firestore write details (paths, keys, payloads)
// ===================================
const DEBUG_PERMS = false;  // DISABLED for production - prevents logging UIDs, paths, doc IDs

// ===================================
// RUNTIME CONFIGURATION VALIDATION
// ===================================
/**
 * Validates Firebase configuration before initialization.
 * Prevents silent failures by failing loudly with clear error messages.
 * This makes misconfiguration immediately obvious in development.
 */
function assertFirebaseConfig(cfg) {
    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    const missing = requiredKeys.filter(key => !cfg[key] || cfg[key].includes('your-') || cfg[key].includes('your_'));
    
    if (missing.length > 0) {
        const errorMsg = `
🚨 FIREBASE CONFIGURATION ERROR 🚨
Missing or invalid keys: ${missing.join(', ')}

Fix:
  1. Copy .env.example to .env
  2. Fill in Firebase config from Firebase Console
  3. Restart dev server

See SECURITY.md for detailed instructions.
        `.trim();
        console.error(errorMsg);
        throw new Error(`Invalid Firebase configuration. Missing: ${missing.join(', ')}`);
    }
    
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && cfg.authDomain?.includes('localhost')) {
        console.warn('⚠️ [SECURITY] Production site using localhost config. Check environment variables.');
    }
    
    if (DEBUG || DEBUG_PERMS) {
        console.log('✅ Firebase configuration validated');
    }
}

// Validate before initializing
assertFirebaseConfig(firebaseConfig);

// ===================================
// FIRESTORE ERROR LOGGER HELPER
// Centralized logging for permission-denied and other Firestore errors
// ===================================
// ===================================
// ENHANCED FIRESTORE ERROR LOGGER
// ===================================
// This comprehensive logger provides detailed diagnostics for permission-denied errors:
// - Fetches and displays the ACTUAL Firestore document (resource.data)
// - Shows the MERGED document after applying updates (request.resource.data)
// - Field-by-field comparison showing what changed
// - Auth context with permission checks (creator match, role validation)
// - Color-coded output for quick visual scanning
// - Helps diagnose EXACTLY which Firestore rule condition failed
//
// FIXES APPLIED (v=48):
// - Added missing task fields: budget, spreadsheetId, showOnCalendar
// - Made teamId validation conditional for legacy tasks (like title)
// - Made teamId IMMUTABILITY checks conditional across ALL collections:
//   * Tasks: (!('teamId' in resource.data) || fieldUnchanged('teamId'))
//   * Events: Same conditional check
//   * Spreadsheets: Same conditional check
//   * LinkLobbyGroups: Same conditional check
//   * Transactions: Same conditional check
//   * TeamJoinInfo: Made createdAt check conditional too
// - This allows updates to legacy docs created before teamId was added
// - Enhanced diagnostics to show actual vs merged document state
// ===================================

async function logFirestoreError(op, path, payload, extraContext, error) {
    const isPermDenied = error?.code === 'permission-denied';
    const prefix = isPermDenied ? '🔒 [PERMISSION-DENIED]' : '❌ [FIRESTORE ERROR]';
    
    // Truncate large arrays in payload for readability
    const truncateValue = (val) => {
        if (Array.isArray(val) && val.length > 5) {
            return `[Array(${val.length}): ${JSON.stringify(val.slice(0, 3))}... +${val.length - 3} more]`;
        }
        if (typeof val === 'object' && val !== null) {
            const keys = Object.keys(val);
            if (keys.length > 10) {
                return `{Object with ${keys.length} keys: ${keys.slice(0, 5).join(', ')}...}`;
            }
        }
        return val;
    };
    
    const payloadPreview = {};
    if (payload && typeof payload === 'object') {
        for (const [k, v] of Object.entries(payload)) {
            payloadPreview[k] = truncateValue(v);
        }
    }
    
    // For permission-denied on UPDATE, try to fetch the ACTUAL document to diagnose
    let actualDocData = null;
    let mergedDocData = null;
    if (isPermDenied && path && !path.includes('<new>') && db) {
        try {
            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const docRef = doc(db, ...path.split('/'));
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                actualDocData = docSnap.data();
                // Simulate what merged doc would look like
                mergedDocData = { ...actualDocData, ...payload };
            }
        } catch (fetchErr) {
            console.warn('⚠️ Could not fetch document for diagnosis:', fetchErr.message);
        }
    }
    
    console.group(`${prefix} ${op}`);
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ff4444; font-weight: bold');
    console.log('%c📍 OPERATION:', 'color: #ff8800; font-weight: bold', op);
    console.log('%c📂 PATH:', 'color: #ff8800; font-weight: bold', path);
    console.log('%c🚫 ERROR CODE:', 'color: #ff0000; font-weight: bold', error?.code || 'unknown');
    console.log('%c💬 ERROR MESSAGE:', 'color: #ff0000; font-weight: bold', error?.message || String(error));
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ff4444; font-weight: bold');
    console.log('%c📦 PAYLOAD KEYS:', 'color: #00aaff; font-weight: bold', payload ? Object.keys(payload) : 'N/A');
    console.log('%c📦 PAYLOAD DATA:', 'color: #00aaff; font-weight: bold', payloadPreview);
    
    if (actualDocData) {
        console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ffaa00; font-weight: bold');
        console.log('%c📄 ACTUAL FIRESTORE DOC (resource.data):', 'color: #ffaa00; font-weight: bold');
        console.log('Keys:', Object.keys(actualDocData));
        console.log('Data:', actualDocData);
        console.log('%c🔀 MERGED DOC (request.resource.data):', 'color: #aa00ff; font-weight: bold');
        console.log('Keys:', Object.keys(mergedDocData));
        console.log('Data:', mergedDocData);
        console.log('%c🔍 FIELD COMPARISON:', 'color: #00ff88; font-weight: bold');
        console.log('• teamId:', { before: actualDocData.teamId, after: mergedDocData.teamId, hasField: 'teamId' in mergedDocData });
        console.log('• title:', { before: actualDocData.title, after: mergedDocData.title, hasField: 'title' in mergedDocData });
        console.log('• createdBy:', { before: actualDocData.createdBy, after: mergedDocData.createdBy, unchanged: actualDocData.createdBy === mergedDocData.createdBy });
        console.log('• createdAt:', { before: actualDocData.createdAt, after: mergedDocData.createdAt, hasInOld: 'createdAt' in actualDocData });
    }
    
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #00ff00; font-weight: bold');
    if (extraContext) {
        console.log('%c🔐 AUTH CONTEXT:', 'color: #00ff00; font-weight: bold', extraContext);
        if (isPermDenied && extraContext.taskCreatedBy && extraContext.uid) {
            console.log('%c✅ Creator Match:', 'color: ' + (extraContext.taskCreatedBy === extraContext.uid ? '#00ff00' : '#ff0000') + '; font-weight: bold', 
                extraContext.taskCreatedBy === extraContext.uid ? 'YES' : 'NO',
                `(${extraContext.uid} ${extraContext.taskCreatedBy === extraContext.uid ? '===' : '!=='} ${extraContext.taskCreatedBy})`);
        }
        if (isPermDenied && extraContext.userRole) {
            console.log('%c👑 User Role:', 'color: #ffaa00; font-weight: bold', extraContext.userRole,
                '(Admin check:', ['admin', 'owner'].includes(extraContext.userRole) ? 'PASS' : 'FAIL' + ')');
        }
    }
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #ff4444; font-weight: bold');
    
    if (error?.stack) {
        console.log('%c📚 STACK TRACE:', 'color: #888; font-style: italic');
        console.log(error.stack);
    }
    console.groupEnd();
    
    // Also log a one-liner for quick scanning
    console.error(`${prefix} ${op} @ ${path} | keys=[${payload ? Object.keys(payload).join(',') : ''}] | ${error?.code}: ${error?.message}`);
}

// ===================================
// EARLY GLOBAL FUNCTIONS (must be defined before DOM loads)
// ===================================
window.generateJoinLink = function() {
    if (!appState?.currentTeamData?.teamCode) {
        if (typeof showToast === 'function') {
            showToast('No team code available', 'error');
        } else {
            alert('No team code available');
        }
        return;
    }
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const joinUrl = `${baseUrl}/index.html?join=${appState.currentTeamData.teamCode}`;
    
    navigator.clipboard.writeText(joinUrl).then(() => {
        if (typeof showToast === 'function') {
            showToast('Join link copied to clipboard!', 'success');
        } else {
            alert('Join link copied!');
        }
    }).catch(() => {
        prompt('Copy this join link:', joinUrl);
    });
};

// ===================================
// TABLE PRESETS
// ===================================
const TASKS_TABLE_PRESET = {
    columns: ['title', 'status', 'assignee', 'priority', 'dueDate', 'progress'],
    columnSettings: {
        status: {
            options: [
                { label: 'To Do', color: '#8E8E93' },
                { label: 'In Progress', color: '#007AFF' },
                { label: 'Done', color: '#34C759' }
            ]
        },
        priority: {
            options: [
                { label: 'Low', color: '#34C759' },
                { label: 'Medium', color: '#FF9500' },
                { label: 'High', color: '#FF3B30' }
            ]
        }
    }
};

const LEADS_TABLE_PRESET = {
    columns: ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes'],
    columnSettings: {
        status: {
            options: [
                { label: 'New', color: '#007AFF' },
                { label: 'Contacted', color: '#5856D6' },
                { label: 'Qualified', color: '#FF9500' },
                { label: 'Won', color: '#34C759' },
                { label: 'Lost', color: '#FF3B30' }
            ]
        },
        source: {
            options: [
                { label: 'Website', color: '#007AFF' },
                { label: 'Referral', color: '#34C759' },
                { label: 'Ad Campaign', color: '#FF9500' },
                { label: 'Social Media', color: '#5856D6' },
                { label: 'Other', color: '#8E8E93' }
            ]
        }
    }
};

// Debug helper functions
function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

function debugError(...args) {
    if (DEBUG) {
        console.error(...args);
    }
}

// ===================================
// EARLY DARK MODE SUPPORT
// Apply dark mode immediately on page load from localStorage
// ===================================
function applyDarkModeEarly() {
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true') {
        document.body.classList.add('dark-mode');
    }
}
// Run immediately
applyDarkModeEarly();

// ===================================
// ROLE MANAGEMENT HELPERS
// ===================================
function getCurrentUserRole(teamData) {
    const uid = currentAuthUser?.uid;
    if (!uid || !teamData?.members) return 'member';
    return teamData.members[uid]?.role || 'member';
}

function isOwner(teamData) {
    return getCurrentUserRole(teamData) === 'owner';
}

function isAdmin(teamData) {
    const role = getCurrentUserRole(teamData);
    return role === 'owner' || role === 'admin';
}

/**
 * Check if current user has permission for a specific action
 * Finances editing is allowed for owner and admin roles
 */
function hasPermission(action) {
    if (!appState.currentTeamData) return false;
    
    switch (action) {
        case 'editFinances':
        case 'editTasks':
        case 'editCalendar':
            return isAdmin(appState.currentTeamData);
        case 'manageTeam':
        case 'editSettings':
            return isOwner(appState.currentTeamData);
        default:
            return true; // Default to allow
    }
}

// ===================================
// METRICS VISIBILITY HELPERS
// ===================================
/**
 * METRICS FEATURE OVERVIEW
 * ========================
 * 
 * The Metrics tab provides performance insights for users and teams.
 * Access is controlled by a team-level visibility setting that only the
 * owner can change via Settings > Metrics Visibility.
 * 
 * VISIBILITY OPTIONS:
 * - owner-only:   Only team owner sees metrics (full team view)
 * - admin-owner:  Owner + admins see metrics (full team view)
 * - members-own:  Everyone sees metrics, but members only see their own stats
 * - everyone:     Everyone sees full team metrics including member breakdown
 * 
 * ACCESS MODES:
 * - 'none': User cannot access the Metrics tab at all (nav item hidden)
 * - 'self': User sees only their personal stats (no team section)
 * - 'team': User sees both personal and team-wide stats
 * 
 * SECURITY GUARANTEES:
 * 1. Nav item is hidden for users with mode='none' (updateNavVisibilityForMetrics)
 * 2. computePersonalMetrics() always filters by userId - no other user data exposed
 * 3. Team section is only rendered when access.mode === 'team'
 * 4. Member breakdown (names/counts) only shown in 'team' mode
 * 5. Settings card only visible to owner (checked in updateSettingsVisibility)
 * 6. handleMetricsVisibilitySave() validates owner role before Firestore write
 * 7. No new Firestore reads - all metrics computed from existing appState data
 * 
 * DATA FLOW:
 * 1. Team data loads → userCanViewMetrics() computes access
 * 2. Access stored in appState.metricsAccess
 * 3. updateNavVisibilityForMetrics() shows/hides nav based on access
 * 4. renderMetrics() respects access.mode when building HTML
 * 5. Settings change → refreshMetricsAccess() → updates nav + view
 */

/**
 * Get the metrics visibility setting from team data.
 * @param {Object} teamData - The team document data
 * @returns {string} - 'owner-only' | 'admin-owner' | 'members-own' | 'everyone'
 */
function getMetricsVisibilitySetting(teamData) {
    return teamData?.settings?.metricsVisibility || 'owner-only';
}

/**
 * Determine if the current user can view metrics and what mode they have.
 * 
 * SECURITY NOTE: This is the central access control function. Changes here
 * affect who can see the Metrics tab and what data they can view.
 * 
 * @param {Object} teamData - The team document data
 * @param {string} currentUserId - The current user's UID
 * @returns {{ canAccess: boolean, mode: 'none' | 'self' | 'team' }}
 */
function userCanViewMetrics(teamData, currentUserId) {
    if (!teamData || !currentUserId) {
        return { canAccess: false, mode: 'none' };
    }
    
    const userRole = getCurrentUserRole(teamData);
    const visibility = getMetricsVisibilitySetting(teamData);
    
    switch (visibility) {
        case 'owner-only':
            // Only owner can access, and they see full team metrics
            if (userRole === 'owner') {
                return { canAccess: true, mode: 'team' };
            }
            return { canAccess: false, mode: 'none' };
            
        case 'admin-owner':
            // Owner and admins can access full team metrics
            if (userRole === 'owner' || userRole === 'admin') {
                return { canAccess: true, mode: 'team' };
            }
            return { canAccess: false, mode: 'none' };
            
        case 'members-own':
            // Everyone can access, but members only see their own metrics
            if (userRole === 'owner' || userRole === 'admin') {
                return { canAccess: true, mode: 'team' };
            }
            return { canAccess: true, mode: 'self' };
            
        case 'everyone':
            // Everyone can access and see all team metrics
            return { canAccess: true, mode: 'team' };
            
        default:
            // Default to owner-only for safety
            if (userRole === 'owner') {
                return { canAccess: true, mode: 'team' };
            }
            return { canAccess: false, mode: 'none' };
    }
}

/**
 * Update the visibility of the metrics nav item based on access.
 * Should be called after team data is loaded.
 */
function updateNavVisibilityForMetrics() {
    const metricsNavItem = document.getElementById('metricsNavItem');
    if (!metricsNavItem) return;
    
    const access = appState.metricsAccess;
    if (access?.canAccess) {
        metricsNavItem.classList.remove('hidden');
        metricsNavItem.style.display = '';
    } else {
        metricsNavItem.classList.add('hidden');
        metricsNavItem.style.display = 'none';
    }
}

// ===================================
// FINANCES TAB VISIBILITY SYSTEM
// ===================================

/**
 * Get the finances enabled setting from team data.
 * @param {Object} teamData - The team document data
 * @returns {boolean} - Whether finances tab is enabled
 */
function getFinancesEnabledSetting(teamData) {
    return teamData?.settings?.financesEnabled || false;
}

/**
 * Get the finances visibility setting from team data.
 * @param {Object} teamData - The team document data
 * @returns {string} - 'owner-only' | 'admin-owner' | 'everyone'
 */
function getFinancesVisibilitySetting(teamData) {
    return teamData?.settings?.financesVisibility || 'owner-only';
}

/**
 * Determine if the current user can view finances and what mode they have.
 * 
 * @param {Object} teamData - The team document data
 * @param {string} currentUserId - The current user's UID
 * @returns {{ canAccess: boolean, mode: 'none' | 'full' }}
 */
function userCanViewFinances(teamData, currentUserId) {
    if (!teamData || !currentUserId) {
        return { canAccess: false, mode: 'none' };
    }
    
    // First check if finances is enabled
    const isEnabled = getFinancesEnabledSetting(teamData);
    if (!isEnabled) {
        return { canAccess: false, mode: 'none' };
    }
    
    const userRole = getCurrentUserRole(teamData);
    const visibility = getFinancesVisibilitySetting(teamData);
    
    switch (visibility) {
        case 'owner-only':
            // Only owner can access
            if (userRole === 'owner') {
                return { canAccess: true, mode: 'full' };
            }
            return { canAccess: false, mode: 'none' };
            
        case 'admin-owner':
            // Owner and admins can access
            if (userRole === 'owner' || userRole === 'admin') {
                return { canAccess: true, mode: 'full' };
            }
            return { canAccess: false, mode: 'none' };
            
        case 'everyone':
            // Everyone can access
            return { canAccess: true, mode: 'full' };
            
        default:
            // Default to owner-only for safety
            if (userRole === 'owner') {
                return { canAccess: true, mode: 'full' };
            }
            return { canAccess: false, mode: 'none' };
    }
}

/**
 * Update the visibility of the finances nav item based on access.
 * Should be called after team data is loaded.
 */
function updateNavVisibilityForFinances() {
    const financesNavItem = document.getElementById('financesNavItem');
    if (!financesNavItem) return;
    
    const access = appState.financesAccess;
    if (access?.canAccess) {
        financesNavItem.classList.remove('hidden');
        financesNavItem.style.display = '';
    } else {
        financesNavItem.classList.add('hidden');
        financesNavItem.style.display = 'none';
    }
}

// ===================================
// AUTHENTICATION CHECK
// ===================================
async function initializeFirebaseAuth() {
    try {
        // Import Firebase modules
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
        const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Apply dark mode immediately if set in localStorage
        let localDark = localStorage.getItem('darkMode');
        if (localDark !== null) {
            localDark = localDark === 'true';
            applyDarkMode(localDark);
        }

        // Check authentication state
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // User is signed in
                currentAuthUser = user;
                appState.currentUser = user.displayName || user.email.split('@')[0];
                updateUserProfile(user);
                console.log('✅ User authenticated');
                
                // Sync public profile for teammate visibility
                // This ensures other users can see this user's basic info
                try {
                    await syncPublicProfile({
                        displayName: user.displayName || user.email.split('@')[0],
                        email: user.email,
                        photoURL: user.photoURL || null
                    });
                } catch (profileError) {
                    // Non-critical - don't block auth flow
                    console.warn('Public profile sync deferred');
                }
                
                // Track session login time for force logout feature
                if (!localStorage.getItem('sessionLoginAt')) {
                    localStorage.setItem('sessionLoginAt', Date.now().toString());
                }
                // Apply animation preferences from user settings
                loadAnimationPreference().then(enabled => {
                    applyAnimationPreference(enabled);
                });
                // Start listening for force logout events
                startForceLogoutListener();
                // Initialize team after authentication
                await initializeUserTeam();
                
                // Check for pending join code from URL
                const pendingJoinCode = sessionStorage.getItem('pendingJoinCode');
                if (pendingJoinCode) {
                    sessionStorage.removeItem('pendingJoinCode');
                    // Small delay to ensure UI is ready
                    setTimeout(() => {
                        processJoinCode(pendingJoinCode);
                    }, 1000);
                }
            } else {
                // No user signed in - clear sensitive data and redirect to login
                console.log('❌ No user authenticated - redirecting to login');
                // LocalStorage Safety Cleanup
                localStorage.removeItem('currentTeamId');
                localStorage.removeItem('messages');
                localStorage.removeItem('tasks');
                localStorage.removeItem('teammates');
                localStorage.removeItem('lastInvitationLink'); // Legacy cleanup
                // Clear in-memory invitation link
                if (window.lastInvitationLink) {
                    delete window.lastInvitationLink;
                }
                // Reset app state
                appState.currentTeamId = null;
                appState.userTeams = [];
                appState.messages = [];
                appState.events = [];
                appState.tasks = [];
                appState.activities = [];
                appState.teammates = [];
                window.location.href = 'account.html';
            }
        });

    } catch (error) {
        console.error('Firebase initialization error:', error.code || error.message);
        debugError('Full Firebase error:', error);
        console.log('❌ Firebase failed to initialize - redirecting to login');
        
        // LocalStorage Safety Cleanup on error
        localStorage.removeItem('currentTeamId');
        localStorage.removeItem('messages');
        localStorage.removeItem('tasks');
        localStorage.removeItem('teammates');
        localStorage.removeItem('lastInvitationLink'); // Legacy cleanup
        
        // Clear in-memory invitation link
        if (window.lastInvitationLink) {
            delete window.lastInvitationLink;
        }
        
        // Redirect to login on Firebase error
        window.location.href = 'account.html';
    }
}

// Update user profile in UI
async function updateUserProfile(user) {
    const userNameEl = document.querySelector('.user-name');
    const userAvatarEl = document.querySelector('.user-avatar');
    
    // Load user settings from Firestore
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        let displayName = user.displayName || user.email.split('@')[0];
        let avatarColor = '#0078D4'; // Default color
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            displayName = userData.displayName || displayName;
            avatarColor = userData.avatarColor || avatarColor;
        }
        
        // Update sidebar profile with settings
        updateSidebarProfile(displayName, avatarColor);
        
    } catch (error) {
        console.error('Error loading user settings:', error.code || error.message);
        debugError('Full error:', error);
        // Fallback to basic profile update
        if (userNameEl) {
            userNameEl.textContent = user.displayName || user.email.split('@')[0];
        }
    }
}

// Update user profile from localStorage
function updateUserProfileFromStorage(userInfo) {
    const userNameEl = document.querySelector('.user-name');
    const userAvatarEl = document.querySelector('.user-avatar');
    
    if (userNameEl) {
        userNameEl.textContent = userInfo.displayName;
    }
    
    if (userAvatarEl && userInfo.photoURL) {
        userAvatarEl.innerHTML = `<img src="${escapeHtml(userInfo.photoURL)}" alt="User Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
    }
}

// ===================================
// TOAST NOTIFICATION SYSTEM
// ===================================
function showToast(message, type = 'info', duration = 4000, title = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-times-circle"></i>',
        warning: '<i class="fas fa-exclamation-triangle"></i>',
        info: '<i class="fas fa-info-circle"></i>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('closing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Sign out function
async function signOutUser() {
    try {
        // Stop force logout listener
        stopForceLogoutListener();
        
        // Stop team members listener
        if (typeof stopTeamMembersListener === 'function') {
            stopTeamMembersListener();
        }
        
        if (auth) {
            const { signOut } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
            await signOut(auth);
        }
        
        // LocalStorage Safety Cleanup - Remove sensitive cached data
        localStorage.removeItem('currentTeamId');
        localStorage.removeItem('messages');
        localStorage.removeItem('tasks');
        localStorage.removeItem('teammates');
        localStorage.removeItem('lastInvitationLink');
        
        // Reset app state to default values
        appState.currentSection = 'activity';
        appState.currentUser = 'Loading...';
        appState.currentTeamId = null;
        appState.userTeams = [];
        appState.messages = [];
        appState.events = [];
        appState.tasks = [];
        appState.activities = [];
        appState.teammates = [];
        appState.calendarView = 'month';
        appState.currentDate = new Date();
        
        // Clear in-memory invitation link before localStorage.clear()
        if (window.lastInvitationLink) {
            delete window.lastInvitationLink;
        }
        
        // Clear any remaining local storage completely
        localStorage.clear();
        
        // Redirect to login
        window.location.href = 'account.html';
    } catch (error) {
        console.error('Sign out error:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// Make signOut available globally
window.signOutUser = signOutUser;

// ===================================
// APP STATE MANAGEMENT
// ===================================
const appState = {
    currentSection: 'activity',
    currentUser: 'Loading...',
    currentTeamId: null, // Current team the user is viewing
    userTeams: [], // All teams the user belongs to
    messages: [],
    events: [],
    tasks: [],
    activities: [],
    teammates: [], // Real team members only
    calendarView: 'month', // 'month' or 'week'
    currentDate: new Date(),
    spreadsheets: [], // Spreadsheet configurations
    currentSpreadsheet: null, // Currently open spreadsheet
    metricsVisibility: 'owner-only', // Current team's metrics visibility setting
    metricsAccess: { canAccess: false, mode: 'none' }, // Metrics visibility access for current user
    graphTypes: {}, // Stores graph type per chart: { graphId: 'bar' | 'line' | 'pie' }
    metricsChartConfig: {}, // Stores per-chart config: { graphId: { yAxisMin, yAxisMax, primaryColor, ... } }
    // Finances state
    financesEnabled: false, // Whether finances tab is enabled for this team
    financesVisibility: 'owner-only', // Current team's finances visibility setting
    financesAccess: { canAccess: false, mode: 'none' }, // Finances visibility access for current user
    transactions: [], // Cached transactions for current team
    financesFilters: { type: 'all', category: 'all', date: 'all', search: '' } // Current filter state
};

// ===================================
// NAVIGATION
// ===================================
// Function to switch tabs programmatically
window.switchTab = function(sectionName) {
    // Check metrics access before allowing navigation
    if (sectionName === 'metrics' && !appState.metricsAccess?.canAccess) {
        showToast("You don't have access to metrics yet.", 'info', 3000);
        // Redirect to overview instead
        window.switchTab('activity');
        return;
    }
    
    // Check finances access before allowing navigation
    if (sectionName === 'finances' && !appState.financesAccess?.canAccess) {
        showToast("You don't have access to finances yet.", 'info', 3000);
        // Redirect to overview instead
        window.switchTab('activity');
        return;
    }
    
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');
    
    // Update active nav item
    navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.section === sectionName) {
            nav.classList.add('active');
        }
    });
    
    // Update active section
    sections.forEach(section => section.classList.remove('active'));
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    appState.currentSection = sectionName;
    
    // Clear chat notification badge when navigating to chat
    if (sectionName === 'chat') {
        const badge = document.getElementById('chatNotificationBadge');
        if (badge) {
            badge.style.display = 'none';
            badge.textContent = '0';
            appState.unreadMessages = 0;
        }
        // Store last seen timestamp for chat
        if (appState.currentTeamId) {
            localStorage.setItem(`chatLastSeen_${appState.currentTeamId}`, Date.now().toString());
        }
    }
    
    // Render metrics when navigating to metrics tab
    if (sectionName === 'metrics') {
        renderMetrics();
    }
    
    // Render finances when navigating to finances tab
    if (sectionName === 'finances') {
        loadTransactions(); // This will also call renderFinances
    }
};

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionName = item.dataset.section;
            
            // Update active nav item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Update active section
            sections.forEach(section => section.classList.remove('active'));
            document.getElementById(`${sectionName}-section`).classList.add('active');
            
            appState.currentSection = sectionName;
            
            // Show/hide delete chat history option for owners in settings
            if (sectionName === 'settings') {
                updateSettingsVisibility();
            }
            
            // Clear chat notification badge when navigating to chat
            if (sectionName === 'chat') {
                const chatBadge = document.getElementById('chatNotificationBadge');
                if (chatBadge) {
                    chatBadge.style.display = 'none';
                    chatBadge.textContent = '0';
                }
                // Store last seen timestamp for chat
                if (appState.currentTeamId) {
                    localStorage.setItem(`chatLastSeen_${appState.currentTeamId}`, Date.now().toString());
                }
                // Apply chat appearance preferences
                loadChatAppearanceSettings().then(preferences => {
                    applyChatAppearance(preferences);
                });
                // Scroll to bottom when opening chat
                setTimeout(() => {
                    const chatMessages = document.getElementById('chatMessages');
                    if (chatMessages) {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                }, 100);
            }
            
            // Initialize section-specific functionality
            if (sectionName === 'settings') {
                loadAccountSettings();
            } else if (sectionName === 'team') {
                initTeamSection();
            } else if (sectionName === 'metrics') {
                // Check access before rendering metrics
                if (!appState.metricsAccess?.canAccess) {
                    showToast("You don't have access to metrics yet.", 'info', 3000);
                    // Redirect to overview
                    window.switchTab('activity');
                    return;
                }
                renderMetrics();
            } else if (sectionName === 'finances') {
                // Check access before rendering finances
                if (!appState.financesAccess?.canAccess) {
                    showToast("You don't have access to finances yet.", 'info', 3000);
                    // Redirect to overview
                    window.switchTab('activity');
                    return;
                }
                loadTransactions(); // This will also call renderFinances
            }
        });
    });
}

// ===================================
// CHAT FUNCTIONALITY
// ===================================

// Mention system state
let mentionState = {
    isActive: false,
    startIndex: -1,
    selectedIndex: 0,
    filteredTeammates: [],
    currentFilter: 'all' // 'all' or 'mentions'
};

// Reply system state
let replyState = {
    currentReply: null // { messageId, userId, displayName, previewText }
};

// Reactions system state
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '✅'];
let reactionsState = {
    activeMessageId: null, // ID of message with open reactions bar
    reactionsBarElement: null, // Reference to the floating reactions bar
    longPressTimer: null, // Timer for mobile long-press detection
    longPressTriggered: false // Flag to prevent click after long-press
};

function initChat() {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    const chatMessages = document.getElementById('chatMessages');
    const clearAllBtn = document.getElementById('clearAllMessagesBtn');
    const mentionDropdown = document.getElementById('mentionDropdown');
    const chatFilterToggle = document.getElementById('chatFilterToggle');
    const replyCancelBtn = document.getElementById('replyCancelBtn');

    // Show clear all button only for owners
    if (clearAllBtn) {
        const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
        if (currentUserRole === 'owner') {
            clearAllBtn.style.display = 'block';
        }
        clearAllBtn.addEventListener('click', clearAllMessages);
    }

    // Initialize reply cancel button
    if (replyCancelBtn) {
        replyCancelBtn.addEventListener('click', clearReplyContext);
    }

    // Initialize chat filter toggle
    if (chatFilterToggle) {
        chatFilterToggle.addEventListener('click', (e) => {
            const filterBtn = e.target.closest('.filter-btn');
            if (!filterBtn) return;
            
            const filter = filterBtn.dataset.filter;
            mentionState.currentFilter = filter;
            
            // Update active state
            chatFilterToggle.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
            
            // Re-display messages with filter
            displayMessages();
        });
    }

    // Messages will be loaded from Firestore when team data loads
    // Don't load from localStorage as it's not team-specific

    // Send message on button click
    sendBtn.addEventListener('click', sendMessage);

    // Send message on Enter key (modified to handle mentions and replies)
    chatInput.addEventListener('keydown', (e) => {
        if (mentionState.isActive) {
            handleMentionKeydown(e);
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Handle input for mention detection and /r command
    chatInput.addEventListener('input', (e) => {
        handleMentionInput(e);
        handleReplyCommand(e);
    });

    // Close mention dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.mention-dropdown') && !e.target.closest('.chat-input')) {
            closeMentionDropdown();
        }
    });

    // Hide delete buttons when clicking outside messages
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.message')) {
            document.querySelectorAll('.message.show-delete').forEach(msg => {
                msg.classList.remove('show-delete');
            });
        }
    });

    // Initialize reactions system listeners
    initReactionsListeners();

    async function sendMessage() {
        const messageText = chatInput.value.trim();
        
        if (messageText === '') return;

        // Close mention dropdown if open
        closeMentionDropdown();

        // Extract mentions from message text
        const mentions = extractMentions(messageText);

        // Get current user's avatar color from teammates
        const currentTeammate = appState.teammates?.find(t => t.id === currentAuthUser?.uid);
        const avatarColor = currentTeammate?.avatarColor || '#0078D4';

        const message = {
            author: appState.currentUser,
            text: messageText,
            userId: currentAuthUser?.uid,
            avatarColor: avatarColor,
            mentions: mentions // Array of user IDs mentioned
        };

        // Add reply data if replying to a message
        if (replyState.currentReply) {
            message.repliedTo = {
                messageId: replyState.currentReply.messageId,
                userId: replyState.currentReply.userId,
                displayName: replyState.currentReply.displayName,
                preview: replyState.currentReply.previewText.substring(0, 100) // Limit preview length
            };
        }

        // Don't add to state yet - let Firestore listener handle it
        // This ensures consistency across all clients
        
        // Encrypt and save to Firestore (team-scoped and encrypted)
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                // Manually encrypt the message first - this guarantees no plaintext reaches Firestore
                const encryptedText = await encryptMessage(message.text, appState.currentTeamId);
                
                // Only save if encryption succeeded
                await saveMessageToFirestore({
                    ...message,
                    text: encryptedText // Pass pre-encrypted text
                });

                // Send notifications to mentioned users
                if (mentions.length > 0) {
                    sendMentionNotifications(mentions, messageText);
                }
                
            } catch (error) {
                console.error('Message encryption failed:', error.code || error.message);
                debugError('Full error:', error);
                
                // If encryption failed, show error and abort
                if (error.message === 'ENCRYPTION_FAILED') {
                    showToast('Message encryption failed. Message not sent.', 'error', 5000, 'Encryption Failed');
                } else {
                    showToast('Failed to send message. Please try again.', 'error', 5000, 'Send Failed');
                }
                
                // Don't display message, don't clear input, don't add activity
                return;
            }
        }

        // Message will be displayed automatically by Firestore onSnapshot listener
        // This ensures the UI always uses the real Firestore doc ID

        // Add to activity feed
        addActivity({
            type: 'message',
            description: 'sent a message in Team Chat'
        });

        // Clear input and reply context
        chatInput.value = '';
        clearReplyContext();
        
        // Chat will auto-scroll when onSnapshot updates the messages
    }

    function displayMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'message';
        messageEl.dataset.messageId = message.id; // Store message ID for deletion
        
        // Get sender's info from teammates using userId
        let avatarColor = message.avatarColor || '#0078D4';
        let authorName = message.author || 'User';
        
        if (message.userId) {
            const sender = appState.teammates?.find(t => t.id === message.userId);
            if (sender) {
                avatarColor = sender.avatarColor || '#0078D4';
                authorName = sender.name; // Use displayName from teammates
            }
        }
        
        // Get initials for avatar using generateAvatar function
        const initials = generateAvatar(authorName);
        
        // Create avatar element
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.style.background = avatarColor;
        avatarDiv.style.color = 'white';
        avatarDiv.style.display = 'flex';
        avatarDiv.style.alignItems = 'center';
        avatarDiv.style.justifyContent = 'center';
        avatarDiv.style.fontWeight = '600';
        avatarDiv.textContent = initials; // Use textContent for initials
        
        // Create content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // === REPLY CONTEXT BLOCK ===
        // Polished compact card showing the message being replied to
        // Structure: [accent bar] [content: author name + preview text]
        if (message.repliedTo) {
            const replyContext = document.createElement('div');
            replyContext.className = 'message-reply-context';
            
            // Accent color bar on left side
            const replyBar = document.createElement('div');
            replyBar.className = 'reply-context-bar';
            
            // Content area with author and preview
            const replyContent = document.createElement('div');
            replyContent.className = 'reply-context-content';
            
            // Author name with reply icon
            const replyAuthor = document.createElement('div');
            replyAuthor.className = 'reply-context-author';
            const authorIcon = document.createElement('i');
            authorIcon.className = 'fas fa-reply';
            replyAuthor.appendChild(authorIcon);
            replyAuthor.appendChild(document.createTextNode(` ${message.repliedTo.displayName}`));
            
            // Preview text (truncated)
            const replyText = document.createElement('div');
            replyText.className = 'reply-context-text';
            
            // Check if original message still exists for better UX
            const originalMessage = appState.messages?.find(m => m.id === message.repliedTo.messageId);
            if (originalMessage) {
                replyText.textContent = message.repliedTo.preview || 'View message';
            } else {
                replyText.textContent = message.repliedTo.preview || 'Original message not available';
                if (!message.repliedTo.preview) {
                    replyText.classList.add('reply-context-unavailable');
                }
            }
            
            replyContent.appendChild(replyAuthor);
            replyContent.appendChild(replyText);
            replyContext.appendChild(replyBar);
            replyContext.appendChild(replyContent);
            
            // Click to scroll to original message with highlight animation
            replyContext.addEventListener('click', (e) => {
                e.stopPropagation();
                scrollToOriginalMessage(message.repliedTo.messageId);
            });
            
            contentDiv.appendChild(replyContext);
        }
        
        // Create header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        
        const authorSpan = document.createElement('span');
        authorSpan.className = 'message-author';
        authorSpan.textContent = authorName; // Use textContent for author name
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = message.time; // Use textContent for time
        
        headerDiv.appendChild(authorSpan);
        headerDiv.appendChild(timeSpan);
        
        // Create message text element with mention rendering
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        
        // Render mentions as clickable pills if message has mentions
        if (message.mentions && message.mentions.length > 0) {
            const renderedContent = renderMessageWithMentions(message.text, message.mentions);
            textDiv.appendChild(renderedContent);
        } else {
            textDiv.textContent = message.text; // Use textContent for message text - never innerHTML
        }
        
        // Store mentions data on element for filtering
        messageEl.dataset.mentions = JSON.stringify(message.mentions || []);

        // === ACTION BUTTONS CONTAINER ===
        // Groups Reply and Delete buttons with consistent alignment
        // Uses unified .message-actions container for proper spacing
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';

        // Reply button - available on all messages
        const replyBtn = document.createElement('button');
        replyBtn.className = 'message-action-btn message-reply-btn';
        replyBtn.innerHTML = '<i class="fas fa-reply"></i><span>Reply</span>';
        replyBtn.title = 'Reply to this message';
        replyBtn.tabIndex = 0; // Make keyboard accessible
        replyBtn.onclick = (e) => {
            e.stopPropagation();
            setReplyContext(message.id, message.userId, authorName, message.text);
        };
        actionsDiv.appendChild(replyBtn);
        
        // Determine if delete button should be shown
        // Show delete button only if:
        // 1. User created this message (owns it), OR
        // 2. User is admin/owner (can delete any message)
        const currentUserId = currentAuthUser?.uid;
        const currentUserRole = appState.teammates?.find(t => t.id === currentUserId)?.role || 'member';
        const isCreator = message.userId === currentUserId;
        const isAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner';
        const canDelete = isCreator || isAdminOrOwner;
        
        if (canDelete) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'message-action-btn message-delete-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
            deleteBtn.title = 'Delete message';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteMessage(message.id, message.userId);
            };
            actionsDiv.appendChild(deleteBtn);
        }
        
        // === REACTIONS DISPLAY ===
        // Show aggregated reactions below message text
        // Load from subcollection for new messages, fall back to legacy reactions map
        const reactionsDisplay = document.createElement('div');
        reactionsDisplay.className = 'message-reactions-display';
        reactionsDisplay.dataset.messageId = message.id;
        
        // First show legacy reactions if they exist (for backward compatibility)
        if (message.reactions && Object.keys(message.reactions).length > 0) {
            renderReactionsDisplay(reactionsDisplay, message.reactions);
        }
        
        // Then async load from subcollection (will override if present)
        loadMessageReactions(message.id).then(subcollectionReactions => {
            if (Object.keys(subcollectionReactions).length > 0) {
                renderReactionsDisplay(reactionsDisplay, subcollectionReactions);
            }
        }).catch(err => {
            // Silently fail - legacy reactions will remain
            debugLog('Could not load reactions subcollection:', err.message);
        });
        
        // === MESSAGE INTERACTION HANDLERS ===
        // Desktop: click to show reactions
        // Mobile: long-press to show reactions
        
        // Long press detection for mobile
        let longPressTimer = null;
        let touchMoved = false;
        
        messageEl.addEventListener('touchstart', (e) => {
            if (e.target.closest('.message-action-btn') || e.target.closest('.message-reactions-display')) {
                return;
            }
            touchMoved = false;
            reactionsState.longPressTriggered = false;
            longPressTimer = setTimeout(() => {
                reactionsState.longPressTriggered = true;
                // Hide actions on other messages
                document.querySelectorAll('.message').forEach(msg => {
                    if (msg !== messageEl) msg.classList.remove('show-actions');
                });
                messageEl.classList.add('show-actions');
                toggleReactionsBar(message.id, messageEl);
            }, 400); // 400ms long press
        }, { passive: true });
        
        messageEl.addEventListener('touchmove', () => {
            touchMoved = true;
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, { passive: true });
        
        messageEl.addEventListener('touchend', (e) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            // Prevent click event if long press was triggered
            if (reactionsState.longPressTriggered) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        // Desktop click handler
        messageEl.onclick = (e) => {
            // Don't trigger on action button clicks or reactions display
            if (e.target.closest('.message-action-btn') || e.target.closest('.message-reactions-display')) {
                return;
            }
            
            // Don't trigger if this was a long press on mobile
            if (reactionsState.longPressTriggered) {
                reactionsState.longPressTriggered = false;
                return;
            }
            
            // Hide action buttons on all other messages
            document.querySelectorAll('.message').forEach(msg => {
                if (msg !== messageEl) {
                    msg.classList.remove('show-actions');
                }
            });
            // Toggle action buttons on clicked message
            messageEl.classList.toggle('show-actions');
            
            // Toggle reactions bar
            toggleReactionsBar(message.id, messageEl);
        };
        
        // Assemble the message
        // Structure: [header] [text] [reactions] [actions container]
        contentDiv.appendChild(headerDiv);
        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(reactionsDisplay);
        contentDiv.appendChild(actionsDiv);
        
        messageEl.appendChild(avatarDiv);
        messageEl.appendChild(contentDiv);
        
        chatMessages.appendChild(messageEl);
    }

    function displayMessages() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // Clear existing messages
        chatMessages.innerHTML = '';
        
        // Filter messages based on current filter state
        let messagesToDisplay = appState.messages || [];
        const currentUserId = currentAuthUser?.uid;
        
        if (mentionState.currentFilter === 'mentions' && currentUserId) {
            // Filter to only messages that mention current user
            messagesToDisplay = messagesToDisplay.filter(msg => 
                msg.mentions && msg.mentions.includes(currentUserId)
            );
            
            // Show empty state if no mentions
            if (messagesToDisplay.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'chat-empty-state';
                emptyState.style.cssText = 'text-align: center; padding: 40px 20px; color: var(--text-secondary);';
                emptyState.innerHTML = `
                    <i class="fas fa-at" style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;"></i>
                    <p style="margin: 0; font-size: 14px;">No messages mentioning you yet</p>
                `;
                chatMessages.appendChild(emptyState);
                return;
            }
        }
        
        // Display filtered messages with date separators
        if (messagesToDisplay.length > 0) {
            let lastDate = null;
            
            messagesToDisplay.forEach(msg => {
                // Get the date of the current message
                const messageDate = msg.timestamp ? new Date(msg.timestamp.seconds * 1000) : new Date();
                const messageDateStr = messageDate.toDateString();
                
                // Add date separator if the date has changed
                if (lastDate !== messageDateStr) {
                    const dateSeparator = document.createElement('div');
                    dateSeparator.className = 'date-separator';
                    
                    // Format date label
                    const today = new Date().toDateString();
                    const yesterday = new Date(Date.now() - 86400000).toDateString();
                    let dateLabel;
                    
                    if (messageDateStr === today) {
                        dateLabel = 'Today';
                    } else if (messageDateStr === yesterday) {
                        dateLabel = 'Yesterday';
                    } else {
                        dateLabel = messageDate.toLocaleDateString('en-US', { 
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                        });
                    }
                    
                    const dateSpan = document.createElement('span');
                    dateSpan.textContent = dateLabel; // Use textContent instead of innerHTML
                    dateSeparator.appendChild(dateSpan);
                    chatMessages.appendChild(dateSeparator);
                    lastDate = messageDateStr;
                }
                
                displayMessage(msg);
            });
            
            // Scroll to bottom after rendering
            scrollChatToBottom();
        }
    }
    
    // Helper function to scroll chat to bottom
    function scrollChatToBottom() {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            requestAnimationFrame(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }
    }
    
    // Make displayMessages and scroll helper available globally
    window.displayMessages = displayMessages;
    window.scrollChatToBottom = scrollChatToBottom;
    
    // Function to switch tabs programmatically
    window.switchTab = function(sectionName) {
        const navItems = document.querySelectorAll('.nav-item');
        const sections = document.querySelectorAll('.content-section');
        
        // Update active nav item
        navItems.forEach(nav => {
            if (nav.dataset.section === sectionName) {
                nav.classList.add('active');
            } else {
                nav.classList.remove('active');
            }
        });
        
        // Update active section
        sections.forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        appState.currentSection = sectionName;
        
        // Clear chat notification badge when navigating to chat
        if (sectionName === 'chat') {
            const chatBadge = document.getElementById('chatNotificationBadge');
            if (chatBadge) {
                chatBadge.style.display = 'none';
                chatBadge.textContent = '0';
            }
            // Store last seen timestamp for chat
            if (appState.currentTeamId) {
                localStorage.setItem(`chatLastSeen_${appState.currentTeamId}`, Date.now().toString());
            }
            // Scroll to bottom when opening chat
            setTimeout(() => scrollChatToBottom(), 100);
        }
        
        // Initialize section-specific functionality
        if (sectionName === 'settings') {
            loadAccountSettings();
        } else if (sectionName === 'team') {
            initTeamSection();
        }
    };

    function loadMessages() {
        const savedMessages = loadFromLocalStorage('messages');
        if (savedMessages) {
            appState.messages = savedMessages;
            savedMessages.forEach(msg => displayMessage(msg));
        }
    }
}

// ===================================
// @MENTION SYSTEM FUNCTIONS
// ===================================

/**
 * Handle input changes in chat to detect @ mentions
 */
function handleMentionInput(e) {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const text = input.value;
    
    // Find the last @ before cursor
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
        if (text[i] === '@') {
            // Check if it's a valid mention start (beginning or preceded by space)
            if (i === 0 || /\s/.test(text[i - 1])) {
                atIndex = i;
                break;
            }
        }
        // Stop if we hit a space (no @ in this word)
        if (text[i] === ' ') break;
    }
    
    if (atIndex >= 0) {
        // Extract search query after @
        const query = text.substring(atIndex + 1, cursorPos).toLowerCase();
        
        // Don't show dropdown if query contains spaces (mention completed)
        if (query.includes(' ')) {
            closeMentionDropdown();
            return;
        }
        
        // Filter teammates based on query
        const teammates = appState.teammates || [];
        mentionState.filteredTeammates = teammates.filter(t => {
            const name = (t.name || '').toLowerCase();
            const email = (t.email || '').toLowerCase();
            return name.includes(query) || email.includes(query) || fuzzyMatch(query, name);
        });
        
        mentionState.isActive = true;
        mentionState.startIndex = atIndex;
        mentionState.selectedIndex = 0;
        
        showMentionDropdown();
    } else {
        closeMentionDropdown();
    }
}

/**
 * Simple fuzzy matching for mention search
 */
function fuzzyMatch(query, target) {
    if (!query) return true;
    let queryIdx = 0;
    for (let i = 0; i < target.length && queryIdx < query.length; i++) {
        if (target[i] === query[queryIdx]) {
            queryIdx++;
        }
    }
    return queryIdx === query.length;
}

/**
 * Handle keyboard navigation in mention dropdown
 */
function handleMentionKeydown(e) {
    const dropdown = document.getElementById('mentionDropdown');
    if (!dropdown || dropdown.style.display === 'none') return;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            mentionState.selectedIndex = Math.min(
                mentionState.selectedIndex + 1,
                mentionState.filteredTeammates.length - 1
            );
            updateMentionSelection();
            break;
            
        case 'ArrowUp':
            e.preventDefault();
            mentionState.selectedIndex = Math.max(mentionState.selectedIndex - 1, 0);
            updateMentionSelection();
            break;
            
        case 'Enter':
        case 'Tab':
            e.preventDefault();
            if (mentionState.filteredTeammates.length > 0) {
                selectMention(mentionState.filteredTeammates[mentionState.selectedIndex]);
            }
            break;
            
        case 'Escape':
            e.preventDefault();
            closeMentionDropdown();
            break;
    }
}

/**
 * Show the mention dropdown with filtered teammates
 */
function showMentionDropdown() {
    const dropdown = document.getElementById('mentionDropdown');
    if (!dropdown) return;
    
    dropdown.innerHTML = '';
    
    if (mentionState.filteredTeammates.length === 0) {
        dropdown.innerHTML = '<div class="mention-dropdown-empty">No teammates found</div>';
    } else {
        const header = document.createElement('div');
        header.className = 'mention-dropdown-header';
        header.textContent = 'Mention a teammate';
        dropdown.appendChild(header);
        
        mentionState.filteredTeammates.forEach((teammate, index) => {
            const item = document.createElement('div');
            item.className = 'mention-item' + (index === mentionState.selectedIndex ? ' selected' : '');
            item.dataset.index = index;
            
            // Avatar
            const avatar = document.createElement('div');
            avatar.className = 'mention-item-avatar';
            avatar.style.background = teammate.avatarColor || '#0078D4';
            avatar.textContent = generateAvatar(teammate.name);
            
            // Info
            const info = document.createElement('div');
            info.className = 'mention-item-info';
            
            const name = document.createElement('div');
            name.className = 'mention-item-name';
            name.textContent = teammate.name;
            
            const role = document.createElement('div');
            role.className = 'mention-item-role';
            role.textContent = teammate.occupation || teammate.role || '';
            
            info.appendChild(name);
            info.appendChild(role);
            
            item.appendChild(avatar);
            item.appendChild(info);
            
            // Click to select
            item.addEventListener('click', () => selectMention(teammate));
            
            // Hover to highlight
            item.addEventListener('mouseenter', () => {
                mentionState.selectedIndex = index;
                updateMentionSelection();
            });
            
            dropdown.appendChild(item);
        });
    }
    
    dropdown.style.display = 'block';
}

/**
 * Update visual selection in dropdown
 */
function updateMentionSelection() {
    const dropdown = document.getElementById('mentionDropdown');
    if (!dropdown) return;
    
    dropdown.querySelectorAll('.mention-item').forEach((item, index) => {
        item.classList.toggle('selected', index === mentionState.selectedIndex);
    });
    
    // Scroll selected item into view
    const selected = dropdown.querySelector('.mention-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
    }
}

/**
 * Select a teammate from the mention dropdown
 */
function selectMention(teammate) {
    const input = document.getElementById('chatInput');
    if (!input || !teammate) return;
    
    const text = input.value;
    const beforeMention = text.substring(0, mentionState.startIndex);
    const afterMention = text.substring(input.selectionStart);
    
    // Insert @Name 
    const mentionText = `@${teammate.name} `;
    input.value = beforeMention + mentionText + afterMention;
    
    // Position cursor after the mention
    const newCursorPos = mentionState.startIndex + mentionText.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    input.focus();
    
    closeMentionDropdown();
}

/**
 * Close the mention dropdown
 */
function closeMentionDropdown() {
    const dropdown = document.getElementById('mentionDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    mentionState.isActive = false;
    mentionState.startIndex = -1;
    mentionState.selectedIndex = 0;
    mentionState.filteredTeammates = [];
}

/**
 * Extract mentioned user IDs from message text
 * Looks for @Name patterns and matches to teammates
 */
function extractMentions(text) {
    const mentions = [];
    const teammates = appState.teammates || [];
    
    if (!teammates.length) return mentions;
    
    // Sort teammates by name length (longest first) for accurate matching
    const sortedTeammates = [...teammates].sort((a, b) => 
        (b.name || '').length - (a.name || '').length
    );
    
    // Build regex to match all teammate names after @
    for (const teammate of sortedTeammates) {
        const name = teammate.name || '';
        if (!name) continue;
        
        // Escape special regex characters in name
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`@${escapedName}(?=\\s|$|[.,!?])`, 'gi');
        
        if (regex.test(text) && !mentions.includes(teammate.id)) {
            mentions.push(teammate.id);
        }
    }
    
    return mentions;
}

/**
 * Send notifications to mentioned users
 */
async function sendMentionNotifications(mentionedUserIds, messageText) {
    if (!mentionedUserIds || mentionedUserIds.length === 0) return;
    if (!currentAuthUser || !appState.currentTeamId) return;
    
    const currentUserId = currentAuthUser.uid;
    const senderName = appState.currentUser || 'Someone';
    
    // Truncate message for notification preview
    const preview = messageText.length > 50 
        ? messageText.substring(0, 50) + '...' 
        : messageText;
    
    for (const userId of mentionedUserIds) {
        // Don't notify yourself
        if (userId === currentUserId) continue;
        
        try {
            // Add notification to user's notification collection
            const { doc, collection, addDoc, serverTimestamp } = 
                await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            
            const notificationsRef = collection(db, 'users', userId, 'notifications');
            await addDoc(notificationsRef, {
                type: 'mention',
                title: `${senderName} mentioned you`,
                message: preview,
                teamId: appState.currentTeamId,
                senderId: currentUserId,
                read: false,
                timestamp: serverTimestamp()
            });
            
            debugLog('📣 Sent mention notification to:', userId);
        } catch (error) {
            console.error('Failed to send mention notification:', error);
        }
    }
}

/**
 * Render message text with mention pills
 */
function renderMessageWithMentions(text, mentions = []) {
    if (!mentions || mentions.length === 0) {
        // No mentions, return sanitized text
        const div = document.createElement('span');
        div.textContent = text;
        return div;
    }
    
    const teammates = appState.teammates || [];
    const currentUserId = currentAuthUser?.uid;
    const container = document.createElement('span');
    
    // Build a map of mentioned user names
    const mentionedUsers = mentions.map(userId => {
        const teammate = teammates.find(t => t.id === userId);
        return teammate ? { id: userId, name: teammate.name } : null;
    }).filter(Boolean);
    
    // Create regex to match @Name patterns for mentioned users
    if (mentionedUsers.length === 0) {
        container.textContent = text;
        return container;
    }
    
    // Sort by name length (longest first) to avoid partial matches
    mentionedUsers.sort((a, b) => b.name.length - a.name.length);
    
    // Build regex pattern
    const namePatterns = mentionedUsers.map(u => 
        '@' + u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|');
    const mentionRegex = new RegExp(`(${namePatterns})`, 'gi');
    
    // Split text and process
    const parts = text.split(mentionRegex);
    
    parts.forEach(part => {
        if (!part) return;
        
        // Check if this part is a mention
        const matchedUser = mentionedUsers.find(u => 
            part.toLowerCase() === `@${u.name.toLowerCase()}`
        );
        
        if (matchedUser) {
            const pill = document.createElement('span');
            pill.className = 'mention-pill';
            if (matchedUser.id === currentUserId) {
                pill.classList.add('mention-me');
            }
            pill.textContent = part;
            pill.title = `Click to view ${matchedUser.name}`;
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                // Navigate to Team tab and scroll to teammate
                navigateToTeammate(matchedUser.id);
            });
            container.appendChild(pill);
        } else {
            const span = document.createElement('span');
            span.textContent = part;
            container.appendChild(span);
        }
    });
    
    return container;
}

// ===================================
// CHAT REPLY SYSTEM FUNCTIONS
// ===================================

/**
 * Set the reply context when user clicks Reply on a message
 * @param {string} messageId - ID of the message being replied to
 * @param {string} userId - User ID of the original message author
 * @param {string} displayName - Display name of the original author
 * @param {string} messageText - The text of the original message (for preview)
 */
function setReplyContext(messageId, userId, displayName, messageText) {
    // Create preview text (first 80 characters)
    const previewText = messageText.length > 80 
        ? messageText.substring(0, 80) + '...' 
        : messageText;
    
    replyState.currentReply = {
        messageId,
        userId,
        displayName,
        previewText
    };
    
    // Update the UI
    showReplyPreviewBar(displayName, previewText);
    
    // Focus the input
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.focus();
    }
}

/**
 * Clear the current reply context
 */
function clearReplyContext() {
    replyState.currentReply = null;
    hideReplyPreviewBar();
}

/**
 * Show the reply preview bar above the input
 * @param {string} name - Name of the person being replied to
 * @param {string} preview - Preview of the message being replied to
 */
function showReplyPreviewBar(name, preview) {
    const bar = document.getElementById('replyPreviewBar');
    const nameEl = document.getElementById('replyToName');
    const previewEl = document.getElementById('replyToPreview');
    
    if (bar && nameEl && previewEl) {
        nameEl.textContent = name;
        previewEl.textContent = preview;
        bar.style.display = 'flex';
    }
}

/**
 * Hide the reply preview bar
 */
function hideReplyPreviewBar() {
    const bar = document.getElementById('replyPreviewBar');
    if (bar) {
        bar.style.display = 'none';
    }
}

/**
 * Handle /r command in chat input for quick reply
 * Detects "/r " at the start of input and auto-sets reply context
 */
function handleReplyCommand(e) {
    const input = e.target;
    const value = input.value;
    
    // Check if input starts with "/r " (with space) or "/r" followed by more text
    if (value.startsWith('/r ') || value === '/r') {
        // Only process if we don't already have a reply context set
        if (replyState.currentReply) return;
        
        // Find a suitable message to reply to
        const currentUserId = currentAuthUser?.uid;
        const messages = appState.messages || [];
        
        // Strategy: First try to find the last message that mentions current user,
        // otherwise find the last message from someone else
        let targetMessage = null;
        
        // Look for last message mentioning current user
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.mentions && msg.mentions.includes(currentUserId) && msg.userId !== currentUserId) {
                targetMessage = msg;
                break;
            }
        }
        
        // If no mention found, find last message from someone else
        if (!targetMessage) {
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.userId !== currentUserId) {
                    targetMessage = msg;
                    break;
                }
            }
        }
        
        if (targetMessage) {
            // Get author name
            let authorName = targetMessage.author || 'User';
            const sender = appState.teammates?.find(t => t.id === targetMessage.userId);
            if (sender) {
                authorName = sender.name;
            }
            
            // Set reply context
            setReplyContext(
                targetMessage.id,
                targetMessage.userId,
                authorName,
                targetMessage.text
            );
            
            // Remove /r from input, keeping any text after the space
            if (value.startsWith('/r ')) {
                input.value = value.substring(3);
            } else {
                input.value = '';
            }
        } else {
            // No suitable message found
            if (value === '/r ' || value === '/r') {
                showToast('No recent message to reply to.', 'info', 3000);
                input.value = '';
            }
        }
    }
}

/**
 * Scroll to the original message and highlight it
 * @param {string} messageId - ID of the message to scroll to
 */
function scrollToOriginalMessage(messageId) {
    const messageEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
    
    if (messageEl) {
        // Scroll to the message
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add highlight effect
        messageEl.classList.add('reply-highlight');
        
        // Remove highlight after animation completes
        setTimeout(() => {
            messageEl.classList.remove('reply-highlight');
        }, 2000);
    } else {
        showToast('Original message not found in current view', 'info', 3000);
    }
}

/**
 * Reset reply state when switching teams or contexts
 * Called when team changes or chat panel closes
 */
function resetReplyState() {
    clearReplyContext();
}

// ===================================
// REACTIONS SYSTEM
// ===================================

/**
 * Toggle the reactions bar for a message
 * @param {string} messageId - ID of the message
 * @param {HTMLElement} messageEl - The message element
 */
function toggleReactionsBar(messageId, messageEl) {
    // If clicking the same message, close the bar
    if (reactionsState.activeMessageId === messageId && reactionsState.reactionsBarElement) {
        closeReactionsBar();
        return;
    }
    
    // Close any existing bar
    closeReactionsBar();
    
    // Create and show new reactions bar
    showReactionsBar(messageId, messageEl);
}

/**
 * Show the reactions bar above a message (WhatsApp/Instagram style)
 * @param {string} messageId - ID of the message
 * @param {HTMLElement} messageEl - The message element
 */
function showReactionsBar(messageId, messageEl) {
    const bar = document.createElement('div');
    bar.className = 'reactions-bar';
    bar.dataset.messageId = messageId;
    
    // Add emoji buttons
    REACTION_EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-emoji-btn';
        btn.textContent = emoji;
        btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleReaction(messageId, emoji);
        };
        // Prevent touch events from bubbling
        btn.ontouchend = (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleReaction(messageId, emoji);
        };
        bar.appendChild(btn);
    });
    
    // Append to body for proper positioning (fixed)
    document.body.appendChild(bar);
    
    // Position the bar - WhatsApp style (above the message bubble, slightly to the right)
    const messageContent = messageEl.querySelector('.message-content');
    const messageBubble = messageEl.querySelector('.message-text');
    const targetEl = messageBubble || messageContent || messageEl;
    const rect = targetEl.getBoundingClientRect();
    const chatContainer = document.getElementById('chatMessages');
    const chatRect = chatContainer?.getBoundingClientRect() || { left: 0, right: window.innerWidth };
    
    // Calculate position
    const barHeight = 48; // Approximate height of bar
    const barWidth = 220; // Approximate width of bar
    const padding = 8;
    
    // Vertical position: above the message bubble
    let top = rect.top - barHeight - padding;
    
    // If too close to top of viewport, position below
    if (top < 60) {
        top = rect.bottom + padding;
    }
    
    // Horizontal position: centered on message, but keep within viewport
    let left = rect.left + (rect.width / 2) - (barWidth / 2);
    
    // Clamp to viewport bounds
    const minLeft = chatRect.left + 8;
    const maxLeft = chatRect.right - barWidth - 8;
    left = Math.max(minLeft, Math.min(maxLeft, left));
    
    // Apply position
    bar.style.position = 'fixed';
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
    bar.style.zIndex = '10001';
    
    reactionsState.activeMessageId = messageId;
    reactionsState.reactionsBarElement = bar;
    
    // Animate in
    requestAnimationFrame(() => {
        bar.classList.add('active');
    });
}

/**
 * Close the reactions bar
 */
function closeReactionsBar() {
    if (reactionsState.reactionsBarElement) {
        reactionsState.reactionsBarElement.classList.remove('active');
        // Remove after animation
        setTimeout(() => {
            if (reactionsState.reactionsBarElement) {
                reactionsState.reactionsBarElement.remove();
                reactionsState.reactionsBarElement = null;
            }
        }, 150);
    }
    reactionsState.activeMessageId = null;
    // Clear long press state
    if (reactionsState.longPressTimer) {
        clearTimeout(reactionsState.longPressTimer);
        reactionsState.longPressTimer = null;
    }
    reactionsState.longPressTriggered = false;
}

/**
 * Toggle a reaction on a message
 * Uses reactions subcollection: /teams/{teamId}/messages/{messageId}/reactions/{userId}
 * Each user can only modify their own reaction document
 * @param {string} messageId - ID of the message
 * @param {string} emoji - The emoji to toggle
 */
async function toggleReaction(messageId, emoji) {
    if (!currentAuthUser || !appState.currentTeamId || !db) return;
    
    const userId = currentAuthUser.uid;
    
    try {
        const { doc, getDoc, setDoc, deleteDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Reference to user's reaction document in the subcollection
        const reactionRef = doc(db, 'teams', appState.currentTeamId, 'messages', messageId, 'reactions', userId);
        const reactionDoc = await getDoc(reactionRef);
        
        if (reactionDoc.exists()) {
            const currentEmoji = reactionDoc.data().emoji;
            if (currentEmoji === emoji) {
                // Same emoji - remove reaction (toggle off)
                await deleteDoc(reactionRef);
            } else {
                // Different emoji - update to new emoji
                await setDoc(reactionRef, {
                    emoji: emoji,
                    userId: userId,
                    updatedAt: serverTimestamp()
                });
            }
        } else {
            // No existing reaction - create new one
            await setDoc(reactionRef, {
                emoji: emoji,
                userId: userId,
                updatedAt: serverTimestamp()
            });
        }
        
        // Refresh the reactions display for this message
        await refreshMessageReactions(messageId);
        
        // Close reactions bar after toggling
        closeReactionsBar();
        
    } catch (error) {
        console.error('Error toggling reaction:', error);
        showToast('Failed to update reaction', 'error');
    }
}

/**
 * Fetch and refresh reactions display for a specific message
 * @param {string} messageId - ID of the message
 */
async function refreshMessageReactions(messageId) {
    try {
        const { collection, getDocs } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const reactionsRef = collection(db, 'teams', appState.currentTeamId, 'messages', messageId, 'reactions');
        const reactionsSnapshot = await getDocs(reactionsRef);
        
        // Aggregate reactions by emoji
        const reactionsByEmoji = {};
        reactionsSnapshot.forEach(doc => {
            const data = doc.data();
            const emoji = data.emoji;
            if (emoji) {
                if (!reactionsByEmoji[emoji]) {
                    reactionsByEmoji[emoji] = [];
                }
                reactionsByEmoji[emoji].push(doc.id); // doc.id is the userId
            }
        });
        
        // Find the reactions display container for this message
        const container = document.querySelector(`.message-reactions-display[data-message-id="${messageId}"]`);
        if (container) {
            renderReactionsDisplay(container, reactionsByEmoji);
        }
    } catch (error) {
        console.error('Error refreshing reactions:', error);
    }
}

/**
 * Load reactions for a message from the subcollection
 * @param {string} messageId - ID of the message
 * @returns {Object} Aggregated reactions { emoji: [userIds] }
 */
async function loadMessageReactions(messageId) {
    if (!db || !appState.currentTeamId) return {};
    
    try {
        const { collection, getDocs } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const reactionsRef = collection(db, 'teams', appState.currentTeamId, 'messages', messageId, 'reactions');
        const reactionsSnapshot = await getDocs(reactionsRef);
        
        // Aggregate reactions by emoji
        const reactionsByEmoji = {};
        reactionsSnapshot.forEach(doc => {
            const data = doc.data();
            const emoji = data.emoji;
            if (emoji) {
                if (!reactionsByEmoji[emoji]) {
                    reactionsByEmoji[emoji] = [];
                }
                reactionsByEmoji[emoji].push(doc.id);
            }
        });
        
        return reactionsByEmoji;
    } catch (error) {
        console.error('Error loading reactions:', error);
        return {};
    }
}

/**
 * Render the reactions display for a message
 * @param {HTMLElement} container - The container element
 * @param {Object} reactions - Reactions object { emoji: [userIds] }
 */
function renderReactionsDisplay(container, reactions) {
    container.innerHTML = '';
    
    if (!reactions || Object.keys(reactions).length === 0) {
        container.style.display = 'none';
        return;
    }
    
    let hasReactions = false;
    
    Object.entries(reactions).forEach(([emoji, userIds]) => {
        if (userIds && userIds.length > 0) {
            hasReactions = true;
            const chip = document.createElement('button');
            chip.className = 'reaction-chip';
            
            // Highlight if current user reacted
            if (currentAuthUser && userIds.includes(currentAuthUser.uid)) {
                chip.classList.add('user-reacted');
            }
            
            chip.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">${userIds.length}</span>`;
            chip.onclick = (e) => {
                e.stopPropagation();
                const messageId = container.dataset.messageId;
                toggleReaction(messageId, emoji);
            };
            
            // Tooltip showing who reacted
            const names = userIds.map(uid => {
                const teammate = appState.teammates?.find(t => t.id === uid);
                return teammate?.name || 'Unknown';
            }).join(', ');
            chip.title = names;
            
            container.appendChild(chip);
        }
    });
    
    container.style.display = hasReactions ? 'flex' : 'none';
}

/**
 * Close reactions bar on scroll or click outside
 */
function initReactionsListeners() {
    const chatMessages = document.getElementById('chatMessages');
    
    // Close on scroll
    if (chatMessages) {
        chatMessages.addEventListener('scroll', closeReactionsBar);
    }
    
    // Close on click outside
    document.addEventListener('click', (e) => {
        if (reactionsState.reactionsBarElement && 
            !e.target.closest('.reactions-bar') && 
            !e.target.closest('.message')) {
            closeReactionsBar();
        }
    });
}

// ===================================
// ===================================
// MESSAGE MANAGEMENT (OUTSIDE initChat FOR GLOBAL ACCESS)
// ===================================

/**
 * Delete a message from Firestore
 * 
 * Permission model (matches Firestore rules):
 * - Members can delete their own messages (userId matches auth.uid)
 * - Admins and owners can delete any message
 * 
 * UI behavior:
 * - Delete button only shown when user has permission
 * - Deletion triggers Firestore deleteDoc
 * - onSnapshot listener auto-updates UI when deletion succeeds
 * 
 * @param {string} messageId - The Firestore document ID
 * @param {string} messageUserId - The userId who created the message (for permission check)
 */
async function deleteMessage(messageId, messageUserId) {
    if (!messageId || !appState.currentTeamId || !db || !currentAuthUser) {
        console.error('❌ Cannot delete: missing required data', {
            hasMessageId: !!messageId,
            hasTeamId: !!appState.currentTeamId,
            hasDb: !!db,
            hasAuth: !!currentAuthUser
        });
        return;
    }
    
    const currentUserId = currentAuthUser.uid;
    const teamId = appState.currentTeamId;
    
    try {
        // Fetch the team document to get accurate role information
        const { doc, getDoc, deleteDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', teamId);
        const teamSnap = await getDoc(teamRef);
        
        if (!teamSnap.exists()) {
            console.error('❌ Team document not found:', { teamId, currentUserId });
            showToast('Team not found. Please try again.', 'error');
            return;
        }
        
        const teamData = teamSnap.data();
        const currentUserRole = getCurrentUserRole(teamData);
        
        // Find the message object in appState to verify its userId
        const message = appState.messages.find(m => m.id === messageId);
        const actualMessageUserId = messageUserId || message?.userId;
        
        // Check if user has permission to delete this message
        const isCreator = actualMessageUserId === currentUserId;
        const isAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner';
        
        debugLog('🔍 Delete permission check:', {
            messageId,
            messageUserId: actualMessageUserId,
            currentUserId,
            currentUserRole,
            isCreator,
            isAdminOrOwner,
            teamId
        });
        
        if (!isCreator && !isAdminOrOwner) {
            console.error('❌ Permission denied:', {
                reason: 'User is neither creator nor admin/owner',
                messageUserId: actualMessageUserId,
                currentUserId,
                currentUserRole
            });
            showToast('You can only delete your own messages', 'error');
            return;
        }
        
        // Delete from Firestore using the real Firestore document ID
        const messageRef = doc(db, 'teams', teamId, 'messages', messageId);
        await deleteDoc(messageRef);
        
        debugLog('✅ Message deleted successfully from Firestore:', { messageId });
        showToast('Message deleted', 'success');
        
        // UI will update automatically via onSnapshot listener
        // No need to manually update appState.messages or call displayMessages()
        
    } catch (error) {
        console.error('❌ Error deleting message:', {
            error: error.message,
            code: error.code,
            messageId,
            messageUserId,
            teamId,
            currentUserId
        });
        
        // Handle specific error cases
        if (error.code === 'permission-denied') {
            showToast('You don\'t have permission to delete this message', 'error');
        } else if (error.code === 'not-found') {
            console.warn('⚠️ Message not found in Firestore (may have been already deleted)');
            showToast('Message not found', 'error');
        } else {
            showToast('Failed to delete message. Please try again.', 'error');
        }
    }
}

// Clear all messages (owner only)
// Show delete chat history modal (owner only)
window.showDeleteChatHistoryModal = function() {
    const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    if (currentUserRole !== 'owner') {
        showToast('Only team owners can delete chat history', 'error');
        return;
    }
    
    openModal('deleteChatHistoryModal');
};

// Clear all messages from team chat
async function clearAllMessages() {
    if (!appState.currentTeamId || !db) {
        showToast('Cannot delete messages right now', 'error');
        return;
    }
    
    const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    if (currentUserRole !== 'owner') {
        showToast('Only team owners can clear all messages', 'error');
        return;
    }
    
    try {
        const { getDocs, deleteDoc, collection } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const messagesRef = collection(db, 'teams', appState.currentTeamId, 'messages');
        const snapshot = await getDocs(messagesRef);
        
        if (snapshot.empty) {
            showToast('No messages to delete', 'info');
            closeModal('deleteChatHistoryModal');
            return;
        }
        
        const deletePromises = [];
        snapshot.forEach(messageDoc => {
            deletePromises.push(deleteDoc(messageDoc.ref));
        });
        
        await Promise.all(deletePromises);
        
        // Clear local state (onSnapshot will also update but this is immediate)
        appState.messages = [];
        displayMessages();
        
        debugLog(`✅ Deleted ${deletePromises.length} messages from chat history`);
        showToast(`Successfully deleted ${deletePromises.length} message${deletePromises.length === 1 ? '' : 's'}`, 'success');
        
        // Close modal
        closeModal('deleteChatHistoryModal');
        
    } catch (error) {
        console.error('Error clearing messages:', error.code || error.message);
        if (error.code === 'permission-denied') {
            showToast('Permission denied. Only owners can delete chat history.', 'error');
        } else {
            showToast('Failed to clear messages. Please try again.', 'error');
        }
    }
}

// ===================================
// CALENDAR FUNCTIONALITY
// ===================================
function initCalendar() {
    const calendarTitle = document.getElementById('calendarTitle');
    const calendarDays = document.getElementById('calendarDays');
    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');
    const addEventBtn = document.getElementById('addEventBtn');

    // Load events from Firestore
    loadEventsFromFirestore();

    // Create view toggle buttons
    const calendarHeader = document.querySelector('.calendar-header');
    if (calendarHeader && !document.querySelector('.calendar-view-toggle')) {
        const viewToggle = document.createElement('div');
        viewToggle.className = 'calendar-view-toggle';
        viewToggle.innerHTML = `
            <button class="view-toggle-btn active" data-view="month">
                <i class="fas fa-calendar"></i> Month
            </button>
            <button class="view-toggle-btn" data-view="week">
                <i class="fas fa-calendar-week"></i> Week
            </button>
        `;
        calendarHeader.appendChild(viewToggle);

        // View toggle handlers
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                appState.calendarView = btn.dataset.view;
                renderCalendar();
            });
        });
    }

    // Navigation buttons
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            if (appState.calendarView === 'month') {
                appState.currentDate.setMonth(appState.currentDate.getMonth() - 1);
            } else {
                appState.currentDate.setDate(appState.currentDate.getDate() - 7);
            }
            renderCalendar();
        });
    }

    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            if (appState.calendarView === 'month') {
                appState.currentDate.setMonth(appState.currentDate.getMonth() + 1);
            } else {
                appState.currentDate.setDate(appState.currentDate.getDate() + 7);
            }
            renderCalendar();
        });
    }

    // Add event button
    if (addEventBtn) {
        addEventBtn.addEventListener('click', () => {
            openModal('eventModal');
        });
    }

    // Initial render
    renderCalendar();

    // Expose for external use
    window.displayCalendarEvents = () => renderCalendar();
    window.renderCalendar = renderCalendar;
}

function renderCalendar() {
    const calendarSection = document.getElementById('calendar-section');
    const calendarTitle = document.getElementById('calendarTitle');
    const calendarDays = document.getElementById('calendarDays');
    const dayHeaders = document.querySelectorAll('.calendar-day-header');
    
    // Check if calendar section exists
    if (!calendarTitle || !calendarDays) {
        console.log('Calendar elements not found - calendar section may not be visible yet');
        return;
    }
    
    // Check if calendar section is currently active
    const isCalendarActive = calendarSection && calendarSection.classList.contains('active');
    console.log(`Rendering calendar in ${appState.calendarView} view with ${appState.events.length} events (active: ${isCalendarActive})`);
    
    if (appState.calendarView === 'month') {
        // Show day headers in month view
        dayHeaders.forEach(header => header.style.display = '');
        renderMonthView(calendarTitle, calendarDays);
    } else {
        // Hide day headers in week view
        dayHeaders.forEach(header => header.style.display = 'none');
        renderWeekView(calendarTitle, calendarDays);
    }
}

function renderMonthView(titleEl, daysEl) {
    const year = appState.currentDate.getFullYear();
    const month = appState.currentDate.getMonth();
    
    titleEl.textContent = new Date(year, month).toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
    });

    let firstDayOfMonth = new Date(year, month, 1).getDay();
    // Adjust for Monday start: 0 (Sunday) becomes 6, 1 (Monday) becomes 0, etc.
    firstDayOfMonth = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = '';
    const today = new Date();
    
    // Generate occurrences for the entire month
    const rangeStart = new Date(year, month, 1, 0, 0, 0);
    const rangeEnd = new Date(year, month + 1, 0, 23, 59, 59);
    const allOccurrences = getAllEventOccurrences(appState.events, rangeStart, rangeEnd);
    
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const isToday = date.toDateString() === today.toDateString();
        
        // Filter occurrences for this day
        const dayEvents = allOccurrences.filter(e => {
            const eventDate = e.date instanceof Date ? e.date : new Date(e.date);
            return eventDate.toDateString() === date.toDateString();
        });
        
        const eventItemsHtml = dayEvents.slice(0, 2).map(evt => {
            const color = evt.color || '#0078d4';
            const startTime = evt.date instanceof Date ? evt.date : new Date(evt.date);
            const timeStr = formatTime24(startTime.getHours(), startTime.getMinutes());
            const isPrivate = evt.visibility === 'private' || evt.visibility === 'admins';
            const lockIcon = isPrivate ? '<i class="fas fa-lock month-event-lock"></i>' : '';
            const repeatIcon = evt.isRecurrence ? '<i class="fas fa-redo month-event-repeat"></i>' : '';
            const eventId = evt.masterId || evt.id;
            return `<div class="month-event-item" onclick="viewEventDetails('${escapeHtml(eventId)}', '${evt.occurrenceDate ? evt.occurrenceDate.toISOString() : ''}'); event.stopPropagation();" style="background: ${escapeHtml(color)}15; border-left: 3px solid ${escapeHtml(color)};">
                <span class="month-event-time" style="color: ${escapeHtml(color)};">${timeStr}</span>
                <span class="month-event-title">${escapeHtml(evt.title)}</span>
                ${lockIcon}${repeatIcon}
            </div>`;
        }).join('');
        
        // Add offset for the first week to align with correct day
        const dayOffset = day === 1 ? `style="grid-column-start: ${firstDayOfMonth + 1};"` : '';
        
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''}" data-date="${date.toISOString()}" ${dayOffset}>
                <div class="day-number">${day}</div>
                ${dayEvents.length > 0 ? `<div class="month-events">${eventItemsHtml}${dayEvents.length > 2 ? `<div class="month-event-more">+${dayEvents.length - 2} more</div>` : ''}</div>` : ''}
            </div>
        `;
    }
    
    // No next month days needed
    
    daysEl.innerHTML = html;
    
    // Add click handlers
    document.querySelectorAll('.calendar-day:not(.other-month)').forEach(day => {
        day.addEventListener('click', () => {
            const dateStr = day.dataset.date;
            if (dateStr) {
                appState.currentDate = new Date(dateStr);
                appState.calendarView = 'week';
                document.querySelector('[data-view="week"]').click();
            }
        });
    });
}

function renderWeekView(titleEl, daysEl) {
    const startOfWeek = getStartOfWeek(appState.currentDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    
    if (DEBUG) {
        console.log(`📅 Week view: ${startOfWeek.toDateString()} to ${endOfWeek.toDateString()}`);
        console.log(`📋 Total events in appState: ${appState.events.length}`);
    }
    
    titleEl.textContent = `${startOfWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    
    // Read CSS variables for positioning (single source of truth)
    const styles = getComputedStyle(document.documentElement);
    const HEADER_HEIGHT = parseInt(styles.getPropertyValue('--week-header-h')) || 60;
    const ALLDAY_HEIGHT = parseInt(styles.getPropertyValue('--week-allday-h')) || 40;
    const SLOT_HEIGHT = parseInt(styles.getPropertyValue('--week-slot-h')) || 48;
    
    // Full 24-hour range with default focus on 08:00-18:00
    const START_HOUR = 0;
    const END_HOUR = 23;
    const DEFAULT_SCROLL_HOUR = 8;
    
    // Total offset = header + all-day strip
    const GRID_START = HEADER_HEIGHT + ALLDAY_HEIGHT;
    
    // Generate occurrences for the week range
    const rangeStart = new Date(startOfWeek);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(endOfWeek);
    rangeEnd.setHours(23, 59, 59, 999);
    const allOccurrences = getAllEventOccurrences(appState.events, rangeStart, rangeEnd);
    
    // Wrap in scrollable container
    let html = '<div class="week-view-scroll-container">';
    html += '<div class="week-view">';
    
    // Time column with header and all-day label
    html += '<div class="week-time-column">';
    html += '<div class="week-time-header"></div>';
    html += '<div class="week-time-allday">Tasks</div>';
    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
        const hourFormatted = formatTime24(hour, 0);
        html += `<div class="week-time-slot">${hourFormatted}</div>`;
    }
    html += '</div>';
    
    // Day columns
    const today = new Date();
    const currentHour = today.getHours();
    const currentMinute = today.getMinutes();
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + i);
        const isToday = date.toDateString() === today.toDateString();
        
        html += `<div class="week-day-column ${isToday ? 'today-column' : ''}" data-date="${date.toISOString()}" style="position: relative;">`;
        
        // Day header
        html += `<div class="week-day-header ${isToday ? 'today' : ''}">
            <div class="week-day-name">${date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
            <div class="week-day-number">${date.getDate()}</div>
        </div>`;
        
        // Get tasks with due dates for this day (only if showOnCalendar is not false)
        const dayTasks = appState.tasks.filter(t => {
            if (!t.dueDate || t.status === 'done') return false;
            if (t.hasOwnProperty('showOnCalendar') && t.showOnCalendar === false) return false;
            const taskDate = new Date(t.dueDate);
            return taskDate.toDateString() === date.toDateString();
        });
        
        // All-day strip for tasks with improved hover dropdown showing all tasks
        html += `<div class="week-allday-strip" data-date="${date.toISOString()}">`;
        
        if (dayTasks.length > 0) {
            // Show first 2 tasks
            const maxVisible = 2;
            dayTasks.slice(0, maxVisible).forEach((task) => {
                html += `
                    <div class="week-allday-task" 
                         onclick="event.stopPropagation(); navigateToTaskSheet('${escapeHtml(task.id)}')"
                         title="${escapeHtml(task.title)}">
                        <i class="fas fa-check-circle"></i>
                        <span>${escapeHtml(task.title.length > 12 ? task.title.substring(0, 12) + '…' : task.title)}</span>
                    </div>
                `;
            });
            
            // If more than 2 tasks, show hover indicator
            if (dayTasks.length > maxVisible) {
                html += `<div class="week-allday-more">+${dayTasks.length - maxVisible}</div>`;
            }
            
            // Create hover dropdown with ALL tasks for this day
            const allTasksHtml = dayTasks.map(t => `
                <div class="week-task-dropdown-item" onclick="event.stopPropagation(); navigateToTaskSheet('${escapeHtml(t.id)}')">
                    <div class="task-dropdown-checkbox">
                        <i class="fas fa-${t.status === 'done' ? 'check-circle' : 'circle'}"></i>
                    </div>
                    <div class="task-dropdown-content">
                        <div class="task-dropdown-title">${escapeHtml(t.title)}</div>
                        ${t.priority ? `<span class="task-dropdown-priority priority-${t.priority}">${t.priority}</span>` : ''}
                    </div>
                </div>
            `).join('');
            
            html += `
                <div class="week-task-dropdown">
                    <div class="week-task-dropdown-header">
                        <i class="fas fa-calendar-check"></i>
                        ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''} due today
                    </div>
                    ${allTasksHtml}
                </div>
            `;
        }
        
        html += '</div>';
        
        // Get all event occurrences for this day
        const dayEvents = allOccurrences.filter(e => {
            const eventDate = e.date instanceof Date ? e.date : new Date(e.date);
            return eventDate.toDateString() === date.toDateString();
        });
        
        if (i === 0 || dayEvents.length > 0 || dayTasks.length > 0) {
            if (DEBUG) {
                console.log(`Day ${i} (${date.toDateString()}): ${dayEvents.length} events, ${dayTasks.length} tasks`);
            }
        }
        
        // Time slots (cells for grid)
        for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
            const isCurrent = isToday && hour === currentHour;
            html += `<div class="week-time-cell ${isCurrent ? 'current-hour' : ''}" data-hour="${hour}" data-date="${date.toISOString()}"></div>`;
        }
        
        // Calculate overlapping events and assign lanes
        const eventsWithTimes = dayEvents.map(event => {
            const eventStartDate = new Date(event.date);
            const eventEndDate = event.endDate ? new Date(event.endDate) : new Date(eventStartDate.getTime() + 60*60*1000);
            return {
                ...event,
                startMinutes: eventStartDate.getHours() * 60 + eventStartDate.getMinutes(),
                endMinutes: eventEndDate.getHours() * 60 + eventEndDate.getMinutes(),
                startDate: eventStartDate,
                endDate: eventEndDate
            };
        }).sort((a, b) => a.startMinutes - b.startMinutes);
        
        // Assign lanes for overlapping events
        const lanes = [];
        eventsWithTimes.forEach(event => {
            let laneIndex = 0;
            while (lanes[laneIndex] && lanes[laneIndex].endMinutes > event.startMinutes) {
                laneIndex++;
            }
            event.laneIndex = laneIndex;
            lanes[laneIndex] = event;
        });
        const totalLanes = lanes.length || 1;
        
        // Render events as absolutely positioned blocks with lane support
        eventsWithTimes.forEach(event => {
            const startHour = event.startDate.getHours();
            const startMinute = event.startDate.getMinutes();
            
            const minutesSinceStart = (startHour - START_HOUR) * 60 + startMinute;
            const topPosition = GRID_START + (minutesSinceStart * SLOT_HEIGHT / 60);
            const durationMinutes = event.endMinutes - event.startMinutes;
            const height = Math.max((durationMinutes * SLOT_HEIGHT / 60), 24);
            
            const eventColor = event.color || '#007AFF';
            const shortEvent = height < 40;
            
            // Calculate width and left position based on lanes
            const laneWidth = (100 - 4) / totalLanes; // 4% for gaps
            const leftPercent = 2 + (event.laneIndex * laneWidth);
            const widthPercent = laneWidth - 1;
            
            // Format times in 24h format
            const startTimeStr = formatTime24(event.startDate.getHours(), event.startDate.getMinutes());
            const endTimeStr = formatTime24(event.endDate.getHours(), event.endDate.getMinutes());
            
            // Check for privacy indicators
            const isPrivate = event.visibility === 'private' || event.visibility === 'admins';
            const lockIcon = isPrivate ? '<i class="fas fa-lock week-event-lock"></i>' : '';
            const repeatIcon = event.isRecurrence ? '<i class="fas fa-redo week-event-repeat"></i>' : '';
            const eventId = event.masterId || event.id;
            const occurrenceDateStr = event.occurrenceDate ? event.occurrenceDate.toISOString() : '';
            
            html += `
                <div class="week-event-block ${shortEvent ? 'short-event' : ''} ${isPrivate ? 'private-event' : ''}" 
                     draggable="true"
                     data-event-id="${escapeHtml(eventId)}"
                     onclick="event.stopPropagation(); viewEventDetails('${escapeHtml(eventId)}', '${occurrenceDateStr}')" 
                     style="top: ${topPosition}px; height: ${height}px; left: ${leftPercent}%; width: ${widthPercent}%; border-left-color: ${escapeHtml(eventColor)};">
                    <div class="week-event-title">${escapeHtml(event.title)}${lockIcon}${repeatIcon}</div>
                    <div class="week-event-time">${startTimeStr}–${endTimeStr}</div>
                </div>
            `;
        });
        
        html += '</div>';
    }
    
    html += '</div>'; // Close .week-view
    
    // Current time indicator spanning all days (outside day columns)
    const todayIndex = [...Array(7)].findIndex((_, i) => {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + i);
        return date.toDateString() === today.toDateString();
    });
    
    if (todayIndex !== -1) {
        const minutesSinceStart = (currentHour - START_HOUR) * 60 + currentMinute;
        const topPosition = GRID_START + (minutesSinceStart * SLOT_HEIGHT / 60);
        const timeLabel = formatTime24(currentHour, currentMinute);
        html += `<div class="week-current-time-line" style="top: ${topPosition}px;" data-time="${timeLabel}"></div>`;
    }
    
    html += '</div>'; // Close .week-view-scroll-container
    daysEl.innerHTML = html;
    
    // Auto-scroll to default hour (08:00) after render
    requestAnimationFrame(() => {
        const scrollContainer = daysEl.querySelector('.week-view-scroll-container');
        if (scrollContainer) {
            const scrollTo = (DEFAULT_SCROLL_HOUR - START_HOUR) * SLOT_HEIGHT;
            scrollContainer.scrollTop = scrollTo;
        }
    });
    
    // Initialize drag-and-drop for events
    initCalendarDragDrop();
}

// Format time in 24-hour format (HH:MM)
function formatTime24(hours, minutes) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Generate event occurrences for repeating events within a date range
 * @param {Object} event - The master event object
 * @param {Date} rangeStart - Start of the visible range
 * @param {Date} rangeEnd - End of the visible range
 * @returns {Array} Array of occurrence objects
 */
function getEventOccurrences(event, rangeStart, rangeEnd) {
    const occurrences = [];
    const repeat = event.repeat || 'none';
    
    if (DEBUG && repeat !== 'none') {
        console.log('🔄 Generating occurrences for repeating event:', {
            eventId: event.id,
            title: event.title,
            repeat: repeat,
            repeatStart: event.repeatStart,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString()
        });
    }
    
    // Non-repeating events: return single occurrence if in range
    if (repeat === 'none') {
        const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
        if (eventDate >= rangeStart && eventDate <= rangeEnd) {
            occurrences.push({
                ...event,
                occurrenceId: event.id,
                occurrenceDate: eventDate,
                masterId: event.id
            });
        }
        return occurrences;
    }
    
    // Get the repeat start date (defaults to event date)
    const repeatStart = event.repeatStart 
        ? (event.repeatStart instanceof Date ? event.repeatStart : new Date(event.repeatStart))
        : (event.date instanceof Date ? event.date : new Date(event.date));
    
    // Calculate event duration in milliseconds
    const eventStartDate = event.date instanceof Date ? event.date : new Date(event.date);
    const eventEndDate = event.endDate 
        ? (event.endDate instanceof Date ? event.endDate : new Date(event.endDate))
        : new Date(eventStartDate.getTime() + 60 * 60 * 1000); // Default 1 hour
    const durationMs = eventEndDate.getTime() - eventStartDate.getTime();
    
    // Start time components from original event
    const startHour = eventStartDate.getHours();
    const startMinute = eventStartDate.getMinutes();
    
    // Generate occurrences based on repeat type
    let currentDate = new Date(repeatStart);
    
    // Don't generate occurrences before the repeat start
    if (currentDate < rangeStart) {
        // Fast-forward to rangeStart
        switch (repeat) {
            case 'daily':
                const daysDiff = Math.floor((rangeStart - currentDate) / (24 * 60 * 60 * 1000));
                currentDate.setDate(currentDate.getDate() + daysDiff);
                break;
            case 'weekly':
                const weeksDiff = Math.floor((rangeStart - currentDate) / (7 * 24 * 60 * 60 * 1000));
                currentDate.setDate(currentDate.getDate() + (weeksDiff * 7));
                break;
            case 'monthly':
                currentDate.setFullYear(rangeStart.getFullYear());
                currentDate.setMonth(rangeStart.getMonth() - 1);
                break;
            case 'yearly':
                currentDate.setFullYear(rangeStart.getFullYear() - 1);
                break;
        }
    }
    
    // Limit iterations to prevent infinite loops
    const maxIterations = 400; // ~1 year of daily events
    let iterations = 0;
    
    while (currentDate <= rangeEnd && iterations < maxIterations) {
        iterations++;
        
        // Check if this occurrence is valid and in range
        const occurrenceDate = new Date(currentDate);
        occurrenceDate.setHours(startHour, startMinute, 0, 0);
        
        if (occurrenceDate >= rangeStart && occurrenceDate <= rangeEnd && occurrenceDate >= repeatStart) {
            // For monthly: check if day exists in this month
            if (repeat === 'monthly') {
                const targetDay = repeatStart.getDate();
                const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
                if (targetDay > daysInMonth) {
                    // Skip this month if day doesn't exist (e.g., 31st in February)
                    currentDate.setMonth(currentDate.getMonth() + 1);
                    continue;
                }
            }
            
            // For yearly: check for Feb 29 on non-leap years
            if (repeat === 'yearly') {
                const targetMonth = repeatStart.getMonth();
                const targetDay = repeatStart.getDate();
                if (targetMonth === 1 && targetDay === 29) {
                    const year = currentDate.getFullYear();
                    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                    if (!isLeapYear) {
                        currentDate.setFullYear(currentDate.getFullYear() + 1);
                        continue;
                    }
                }
            }
            
            const occurrenceEndDate = new Date(occurrenceDate.getTime() + durationMs);
            const dateKey = `${occurrenceDate.getFullYear()}${String(occurrenceDate.getMonth() + 1).padStart(2, '0')}${String(occurrenceDate.getDate()).padStart(2, '0')}`;
            
            occurrences.push({
                ...event,
                date: occurrenceDate,
                endDate: occurrenceEndDate,
                occurrenceId: `${event.id}_${dateKey}`,
                occurrenceDate: occurrenceDate,
                masterId: event.id,
                isRecurrence: true
            });
        }
        
        // Move to next occurrence
        switch (repeat) {
            case 'daily':
                currentDate.setDate(currentDate.getDate() + 1);
                break;
            case 'weekly':
                currentDate.setDate(currentDate.getDate() + 7);
                break;
            case 'monthly':
                currentDate.setMonth(currentDate.getMonth() + 1);
                // Ensure we're on the right day of month
                const targetDay = repeatStart.getDate();
                const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
                currentDate.setDate(Math.min(targetDay, daysInMonth));
                break;
            case 'yearly':
                currentDate.setFullYear(currentDate.getFullYear() + 1);
                break;
        }
    }
    
    return occurrences;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Get all event occurrences for a date range, expanding repeating events
 * @param {Array} events - Array of master events
 * @param {Date} rangeStart - Start of the visible range
 * @param {Date} rangeEnd - End of the visible range
 * @returns {Array} Array of all occurrences
 */
function getAllEventOccurrences(events, rangeStart, rangeEnd) {
    let allOccurrences = [];
    
    for (const event of events) {
        const occurrences = getEventOccurrences(event, rangeStart, rangeEnd);
        allOccurrences = allOccurrences.concat(occurrences);
    }
    
    return allOccurrences;
}

// Toggle task overflow popover
window.toggleTaskOverflowPopover = function(element) {
    const popover = element.querySelector('.week-overflow-popover');
    if (popover) {
        const isVisible = popover.classList.contains('show');
        // Close all other popovers first
        document.querySelectorAll('.week-overflow-popover.show').forEach(p => p.classList.remove('show'));
        if (!isVisible) {
            popover.classList.add('show');
        }
    }
};

// Navigate to the sheet containing a specific task
window.navigateToTaskSheet = function(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) {
        showToast('Task not found', 'error');
        console.error('Task not found:', taskId);
        return;
    }
    
    console.log('Task found:', task);
    
    // Check if task has sheetId
    if (!task.sheetId) {
        showToast('This task is not associated with a sheet', 'info');
        console.log('Task has no sheetId, opening task details instead');
        // Just open the task details modal instead
        if (window.viewTaskDetails) {
            window.viewTaskDetails(taskId);
        }
        return;
    }
    
    // Find the spreadsheet that contains this task
    const spreadsheet = appState.spreadsheets.find(s => s.id === task.sheetId);
    if (!spreadsheet) {
        showToast('Sheet not found', 'info');
        console.error('Sheet not found for sheetId:', task.sheetId);
        // Fallback to opening task details
        if (window.viewTaskDetails) {
            window.viewTaskDetails(taskId);
        }
        return;
    }
    
    // Switch to tasks tab first
    window.switchTab('tasks');
    
    // Open the spreadsheet panel
    setTimeout(() => {
        openSpreadsheetPanel(spreadsheet);
        
        // Highlight the task row
        setTimeout(() => {
            const taskRow = document.querySelector(`tr[data-task-id="${taskId}"]`);
            if (taskRow) {
                taskRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                taskRow.classList.add('highlight-row');
                setTimeout(() => taskRow.classList.remove('highlight-row'), 2000);
            }
        }, 300);
    }, 100);
};

// Close popovers when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.week-allday-overflow')) {
        document.querySelectorAll('.week-overflow-popover.show').forEach(p => p.classList.remove('show'));
    }
});

function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    // Adjust so Monday is the first day of the week (0 = Sunday, 1 = Monday, etc.)
    const diff = day === 0 ? -6 : 1 - day; // If Sunday, go back 6 days; otherwise go back to Monday
    const result = new Date(d);
    result.setDate(d.getDate() + diff);
    return result;
}

// ===================================
// CALENDAR DRAG AND DROP
// ===================================
function initCalendarDragDrop() {
    const eventBlocks = document.querySelectorAll('.week-event-block[draggable="true"]');
    const dayColumns = document.querySelectorAll('.week-day-column');
    const timeCells = document.querySelectorAll('.week-time-cell');
    
    eventBlocks.forEach(block => {
        block.addEventListener('dragstart', handleEventDragStart);
        block.addEventListener('dragend', handleEventDragEnd);
    });
    
    dayColumns.forEach(column => {
        column.addEventListener('dragover', handleEventDragOver);
        column.addEventListener('dragleave', handleEventDragLeave);
        column.addEventListener('drop', handleEventDrop);
    });
    
    timeCells.forEach(cell => {
        cell.addEventListener('dragover', handleCellDragOver);
        cell.addEventListener('dragleave', handleCellDragLeave);
        cell.addEventListener('drop', handleCellDrop);
    });
}

let draggedEventId = null;

function handleEventDragStart(e) {
    draggedEventId = e.target.dataset.eventId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedEventId);
}

function handleEventDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedEventId = null;
    
    // Remove all drag-over highlights
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleEventDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleEventDragLeave(e) {
    e.target.classList.remove('drag-over');
}

function handleCellDragOver(e) {
    e.preventDefault();
    e.target.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
}

function handleCellDragLeave(e) {
    e.target.classList.remove('drag-over');
}

async function handleEventDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const column = e.currentTarget;
    column.classList.remove('drag-over');
    
    if (!draggedEventId) return;
    
    const newDateStr = column.dataset.date;
    if (!newDateStr) return;
    
    await rescheduleEvent(draggedEventId, new Date(newDateStr));
}

async function handleCellDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const cell = e.target;
    cell.classList.remove('drag-over');
    
    if (!draggedEventId) return;
    
    const hour = parseInt(cell.dataset.hour);
    const dateStr = cell.dataset.date;
    if (isNaN(hour) || !dateStr) return;
    
    const newDate = new Date(dateStr);
    newDate.setHours(hour, 0, 0, 0);
    
    await rescheduleEvent(draggedEventId, newDate, hour);
}

async function rescheduleEvent(eventId, newDate, newHour = null) {
    const event = appState.events.find(e => e.id === eventId);
    if (!event) {
        showToast('Event not found', 'error');
        return;
    }
    
    // Calculate the new start time
    const oldDate = new Date(event.date);
    const oldEndDate = event.endDate ? new Date(event.endDate) : new Date(oldDate.getTime() + 60*60*1000);
    const duration = oldEndDate.getTime() - oldDate.getTime();
    
    // Create new date preserving original time unless hour is specified
    const newStartDate = new Date(newDate);
    if (newHour !== null) {
        newStartDate.setHours(newHour, 0, 0, 0);
    } else {
        newStartDate.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0);
    }
    
    const newEndDate = new Date(newStartDate.getTime() + duration);
    
    // Update local state
    event.date = newStartDate;
    event.endDate = newEndDate;
    event.time = newStartDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    event.endTime = newEndDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    
    // Update in Firestore
    try {
        await updateEventInFirestore(event);
        showToast('Event rescheduled', 'success');
        renderCalendar(); // Re-render to show changes
    } catch (error) {
        console.error('Error rescheduling event:', error);
        showToast('Failed to reschedule event', 'error');
    }
}

// ===================================
// TASK MANAGEMENT
// ===================================

// Spreadsheet state for sorting, filtering, selection
const spreadsheetState = {
    sortColumn: null,
    sortDirection: 'asc',
    filters: { status: '', priority: '', assignee: '' },
    searchQuery: '',
    selectedTasks: new Set()
};

function initTasks() {
    const addTaskBtn = document.getElementById('addTaskBtn');

    // Don't load from localStorage on init - Firestore will provide the source of truth
    // Tasks will be loaded via loadTasksFromFirestore() in loadTeamData()
    
    // Add task button
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', () => {
            // Reset form for new task
            document.getElementById('taskForm').reset();
            delete document.getElementById('taskForm').dataset.editingTaskId;
            
            // Update modal title and button for unified modal
            const titleEl = document.querySelector('#taskModal .unified-modal-title h2');
            const submitBtn = document.querySelector('#taskModal .unified-btn-primary');
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-plus-circle"></i> New Task';
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Task';
            
            populateTaskAssigneeDropdown(); // Populate with current team members
            populateTaskSpreadsheetDropdown(); // Populate with available spreadsheets
            resetTaskModalDropdowns(); // Reset all custom dropdowns to defaults
            
            // Set minimum date to today
            const taskDueDateInput = document.getElementById('taskDueDate');
            if (taskDueDateInput) {
                const today = new Date().toISOString().split('T')[0];
                taskDueDateInput.setAttribute('min', today);
            }
            
            openModal('taskModal');
        });
    }

    // Create spreadsheet card handler
    const createSpreadsheetBtn = document.getElementById('createSpreadsheetCard');
    if (createSpreadsheetBtn) {
        createSpreadsheetBtn.addEventListener('click', () => {
            openModal('spreadsheetModal');
        });
    }

    // Initialize spreadsheet modal handlers
    initSpreadsheetModal();
    
    // Initialize custom column modal handlers
    initCustomColumnModal();
    
    // Initialize spreadsheet panel handlers
    initSpreadsheetPanelHandlers();
    
    // Initialize spreadsheet context menu
    initSpreadsheetContextMenu();

    // Progress bar update (range slider + number input + fill bar + badge sync)
    const progressSlider = document.getElementById('taskProgressSlider');
    const progressInput = document.getElementById('taskProgress');
    const progressFill = document.getElementById('taskProgressFill');
    const progressBadge = document.getElementById('taskProgressBadge');
    
    function updateProgressVisuals(value) {
        if (progressFill) {
            progressFill.style.width = value + '%';
        }
        if (progressBadge) {
            progressBadge.textContent = value + '%';
        }
    }
    
    if (progressSlider && progressInput) {
        // Sync slider to input and visuals
        progressSlider.addEventListener('input', () => {
            const value = progressSlider.value;
            progressInput.value = value;
            updateProgressVisuals(value);
        });
        
        // Sync input to slider and visuals
        progressInput.addEventListener('input', () => {
            let value = parseInt(progressInput.value) || 0;
            value = Math.max(0, Math.min(100, value));
            progressSlider.value = value;
            updateProgressVisuals(value);
        });
        
        // On change (when user finishes typing), clamp and sync
        progressInput.addEventListener('change', () => {
            let value = parseInt(progressInput.value) || 0;
            value = Math.max(0, Math.min(100, value));
            progressInput.value = value;
            progressSlider.value = value;
            updateProgressVisuals(value);
        });
    }

    function loadTasks() {
        // Deprecated - kept for compatibility but not used
        // Tasks are now loaded from Firestore real-time listener
    }

    // ===================================
    // DISPLAY TASKS - Main entry point
    // ===================================
    function displayTasks() {
        // Update overview section counters
        const todoCount = appState.tasks.filter(t => t.status === 'todo').length;
        const inProgressCount = appState.tasks.filter(t => t.status === 'inprogress').length;
        const doneCount = appState.tasks.filter(t => t.status === 'done').length;
        const totalCount = appState.tasks.length;

        // Update metrics in overview
        const totalTasksCountEl = document.getElementById('totalTasksCount');
        const inProgressTasksCountEl = document.getElementById('inProgressTasksCount');
        const completedTasksCountEl = document.getElementById('completedTasksCount');
        
        if (totalTasksCountEl) totalTasksCountEl.textContent = totalCount;
        if (inProgressTasksCountEl) inProgressTasksCountEl.textContent = inProgressCount;
        if (completedTasksCountEl) completedTasksCountEl.textContent = doneCount;

        // Render spreadsheet cards
        renderSpreadsheetCards();
        
        // If spreadsheet panel is open, refresh its data
        if (appState.currentSpreadsheet) {
            renderSpreadsheetTable(appState.currentSpreadsheet);
        }
    }

    // ===================================
    // SPREADSHEET CARDS
    // ===================================
    function renderSpreadsheetCards() {
        const container = document.getElementById('spreadsheetCards');
        if (!container) return;

        // Keep the create card
        const createCardEl = container.querySelector('.create-new');
        container.innerHTML = '';
        if (createCardEl) container.appendChild(createCardEl);

        // Initialize spreadsheets array if not exists
        if (!appState.spreadsheets) {
            appState.spreadsheets = [];
        }

        // If no spreadsheets exist AND we've already loaded from Firestore, create a default "All Tasks" spreadsheet
        // IMPORTANT: Check _spreadsheetsLoaded flag to avoid race condition where displayTasks() is called
        // before loadSpreadsheetsFromFirestore() completes
        if (appState.spreadsheets.length === 0 && appState._spreadsheetsLoaded) {
            const defaultSpreadsheet = {
                id: 'default',
                name: 'All Tasks',
                color: '#0070f3',
                icon: 'fa-list-check',
                visibility: 'team',
                type: 'tasks',
                columns: ['title', 'status', 'assignee', 'priority', 'dueDate', 'progress'],
                createdBy: currentAuthUser?.uid || null,
                _needsFirstSave: true  // Flag to save only once
            };
            appState.spreadsheets.push(defaultSpreadsheet);
            // Save to Firestore ONCE (only if we have a valid user and it's truly new)
            // NOTE: saveSpreadsheetToFirestore will check if doc exists and handle create vs update
            if (currentAuthUser?.uid && defaultSpreadsheet._needsFirstSave) {
                delete defaultSpreadsheet._needsFirstSave;  // Remove flag before save
                // Only try to create if there's no existing 'default' spreadsheet in Firestore
                // The saveSpreadsheetToFirestore function will check doc existence
                saveSpreadsheetToFirestore(defaultSpreadsheet).catch(err => {
                    // Silently ignore if it already exists - will be loaded on next refresh
                    if (err.code !== 'permission-denied') {
                        console.warn('Could not create default spreadsheet:', err.message);
                    }
                });
            }
        }

        // Filter spreadsheets by visibility (show team + own private)
        const visibleSpreadsheets = appState.spreadsheets.filter(s => {
            if (s.visibility === 'private') {
                return s.createdBy === currentAuthUser?.uid;
            }
            return true; // team visibility or no visibility set (legacy)
        });

        // Render spreadsheet cards
        visibleSpreadsheets.forEach(spreadsheet => {
            const card = buildSpreadsheetCard(spreadsheet);
            container.insertBefore(card, createCardEl);
        });
    }

    // Build spreadsheet card with improved design
    function buildSpreadsheetCard(spreadsheet) {
        const card = document.createElement('div');
        card.className = 'spreadsheet-card';
        card.dataset.spreadsheetId = spreadsheet.id;

        // Determine if this is a leads table
        const isLeadsTable = spreadsheet.type === 'leads';

        // Count tasks/leads in this spreadsheet
        const spreadsheetTasks = getTasksForSpreadsheet(spreadsheet);
        const taskCount = spreadsheetTasks.length;
        const completedCount = spreadsheetTasks.filter(t => t.status === 'done').length;
        const progressPercent = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

        // Check if this is a private spreadsheet
        const isPrivate = spreadsheet.visibility === 'private';
        const privateTag = isPrivate ? '<span class="spreadsheet-private-tag"><i class="fas fa-lock"></i> Private</span>' : '';

        // Different metrics for leads vs tasks
        let metaHtml;
        if (isLeadsTable) {
            const wonCount = spreadsheetTasks.filter(t => t.status === 'won').length;
            metaHtml = `
                <span><i class="fas fa-user-tie"></i> ${taskCount} leads</span>
                <span><i class="fas fa-trophy"></i> ${wonCount} won</span>
            `;
        } else {
            metaHtml = `
                <span><i class="fas fa-tasks"></i> ${taskCount} tasks</span>
                <span><i class="fas fa-check-circle"></i> ${completedCount} done</span>
            `;
        }

        card.innerHTML = `
            <button class="spreadsheet-card-menu-btn" title="More options">
                <i class="fas fa-ellipsis-v"></i>
            </button>
            <div class="spreadsheet-card-header-row">
                <div class="spreadsheet-card-icon" style="background: ${spreadsheet.color}15; color: ${spreadsheet.color};">
                    <i class="fas ${spreadsheet.icon || 'fa-table'}"></i>
                </div>
            </div>
            <div class="spreadsheet-card-content">
                <h4 class="spreadsheet-card-title">${escapeHtml(spreadsheet.name)}</h4>
                <div class="spreadsheet-card-meta">
                    ${metaHtml}
                </div>
            </div>
            ${privateTag}
        `;

        // Click handler for the card (open spreadsheet)
        card.addEventListener('click', (e) => {
            // Don't open if clicking the menu button
            if (e.target.closest('.spreadsheet-card-menu-btn')) return;
            openSpreadsheetPanel(spreadsheet);
        });
        
        // 3-dot menu button click
        const menuBtn = card.querySelector('.spreadsheet-card-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showSpreadsheetContextMenu(e, spreadsheet);
            });
        }
        
        // Right-click context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showSpreadsheetContextMenu(e, spreadsheet);
        });
        
        return card;
    }

    // ===================================
    // SPREADSHEET CONTEXT MENU
    // ===================================
    let contextMenuSpreadsheet = null;
    
    function initSpreadsheetContextMenu() {
        const menu = document.getElementById('spreadsheetContextMenu');
        if (!menu) return;
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target)) {
                hideSpreadsheetContextMenu();
            }
        });
        
        // Close menu on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideSpreadsheetContextMenu();
            }
        });
        
        // Open action
        document.getElementById('contextMenuOpen')?.addEventListener('click', () => {
            if (contextMenuSpreadsheet) {
                openSpreadsheetPanel(contextMenuSpreadsheet);
            }
            hideSpreadsheetContextMenu();
        });
        
        // Rename action
        document.getElementById('contextMenuRename')?.addEventListener('click', () => {
            if (contextMenuSpreadsheet) {
                promptRenameSpreadsheet(contextMenuSpreadsheet);
            }
            hideSpreadsheetContextMenu();
        });
        
        // Delete action
        document.getElementById('contextMenuDelete')?.addEventListener('click', () => {
            if (contextMenuSpreadsheet) {
                confirmDeleteSpreadsheet(contextMenuSpreadsheet);
            }
            hideSpreadsheetContextMenu();
        });
    }
    
    function showSpreadsheetContextMenu(e, spreadsheet) {
        const menu = document.getElementById('spreadsheetContextMenu');
        if (!menu) return;
        
        contextMenuSpreadsheet = spreadsheet;
        
        // Position menu near cursor
        let x = e.clientX;
        let y = e.clientY;
        
        // Show temporarily to get dimensions
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('visible');
        
        // Adjust if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            x = window.innerWidth - rect.width - 10;
        }
        if (rect.bottom > window.innerHeight) {
            y = window.innerHeight - rect.height - 10;
        }
        
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        // Disable delete for "default" spreadsheet
        const deleteItem = document.getElementById('contextMenuDelete');
        if (deleteItem) {
            if (spreadsheet.id === 'default') {
                deleteItem.style.opacity = '0.4';
                deleteItem.style.pointerEvents = 'none';
            } else {
                deleteItem.style.opacity = '1';
                deleteItem.style.pointerEvents = 'auto';
            }
        }
    }
    
    function hideSpreadsheetContextMenu() {
        const menu = document.getElementById('spreadsheetContextMenu');
        if (menu) {
            menu.classList.remove('visible');
        }
        contextMenuSpreadsheet = null;
    }
    
    function promptRenameSpreadsheet(spreadsheet) {
        // If the spreadsheet panel is open and it's the same spreadsheet, focus the title input
        if (appState.currentSpreadsheet?.id === spreadsheet.id) {
            const titleInput = document.querySelector('.spreadsheet-title-input');
            if (titleInput) {
                titleInput.focus();
                titleInput.select();
                return;
            }
        }
        
        // Otherwise, open the spreadsheet panel first and then focus the title
        openSpreadsheetPanel(spreadsheet);
        
        // Wait for panel to open, then focus and select the title input
        setTimeout(() => {
            const titleInput = document.querySelector('.spreadsheet-title-input');
            if (titleInput) {
                titleInput.focus();
                titleInput.select();
            }
        }, 100);
    }
    
    async function confirmDeleteSpreadsheet(spreadsheet) {
        if (spreadsheet.id === 'default') {
            showToast('Cannot delete the default spreadsheet', 'error');
            return;
        }
        
        // Check permissions
        if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
            if (spreadsheet.createdBy !== currentAuthUser?.uid) {
                showToast('You can only delete spreadsheets you created', 'error');
                return;
            }
        }
        
        // Get task count
        const taskCount = appState.tasks.filter(t => t.spreadsheetId === spreadsheet.id).length;
        const message = taskCount > 0 
            ? `Delete "${spreadsheet.name}"? This will also delete ${taskCount} task(s) in this spreadsheet.`
            : `Delete "${spreadsheet.name}"?`;
        
        if (!confirm(message)) return;
        
        try {
            // Delete from Firestore
            if (db && appState.currentTeamId) {
                const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                await deleteDoc(doc(db, 'teams', appState.currentTeamId, 'spreadsheets', spreadsheet.id));
                
                // Also delete tasks in this spreadsheet
                if (taskCount > 0) {
                    const tasksToDelete = appState.tasks.filter(t => t.spreadsheetId === spreadsheet.id);
                    for (const task of tasksToDelete) {
                        await deleteDoc(doc(db, 'teams', appState.currentTeamId, 'tasks', task.id));
                    }
                    // Remove from local state
                    appState.tasks = appState.tasks.filter(t => t.spreadsheetId !== spreadsheet.id);
                }
            }
            
            // Remove from local state
            appState.spreadsheets = appState.spreadsheets.filter(s => s.id !== spreadsheet.id);
            
            // Close panel if this spreadsheet was open
            if (appState.currentSpreadsheet?.id === spreadsheet.id) {
                closeSpreadsheetPanel();
            }
            
            renderSpreadsheetCards();
            showToast('Spreadsheet deleted', 'success');
        } catch (error) {
            console.error('Error deleting spreadsheet:', error);
            showToast('Failed to delete spreadsheet', 'error');
        }
    }
    
    // Expose functions
    window.initSpreadsheetContextMenu = initSpreadsheetContextMenu;

    // ===================================
    // SPREADSHEET PANEL
    // ===================================
    function openSpreadsheetPanel(spreadsheet) {
        appState.currentSpreadsheet = spreadsheet;
        
        const panel = document.getElementById('spreadsheetPanel');
        const tasksSection = document.getElementById('tasks-section');
        if (!panel || !tasksSection) return;

        // Determine if this is a leads table
        const isLeadsTable = spreadsheet.type === 'leads';
        const firstCol = isLeadsTable ? 'leadName' : 'title';
        
        // Ensure first column is present and columns are valid
        if (!spreadsheet.columns) {
            // Set default columns based on table type
            if (isLeadsTable) {
                spreadsheet.columns = ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes'];
            } else {
                spreadsheet.columns = ['title', 'status', 'assignee', 'priority', 'dueDate', 'progress'];
            }
        } else {
            // Ensure first column is present
            if (!spreadsheet.columns.includes(firstCol)) {
                spreadsheet.columns.unshift(firstCol);
            }
            // Remove duplicate columns
            spreadsheet.columns = [...new Set(spreadsheet.columns)];
            // For leads tables, filter out task-only columns that don't apply
            if (isLeadsTable) {
                const validLeadsCols = ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes'];
                spreadsheet.columns = spreadsheet.columns.filter(col => 
                    validLeadsCols.includes(col) || col.startsWith('custom_')
                );
            }
        }

        // Reset state
        spreadsheetState.selectedTasks.clear();
        spreadsheetState.searchQuery = '';
        spreadsheetState.filters = { status: '', priority: '', assignee: '' };
        updateBatchActionsBar();

        // Set title and icon
        const titleInput = panel.querySelector('.spreadsheet-title-input');
        const iconPreview = document.getElementById('spreadsheetIconPreview');
        if (titleInput) {
            titleInput.value = spreadsheet.name;
        }
        if (iconPreview) {
            // Validate icon class - must be a valid FontAwesome class
            const iconClass = (spreadsheet.icon || 'fa-table').replace(/[^a-zA-Z0-9-]/g, '');
            iconPreview.innerHTML = `<i class="fas ${iconClass}"></i>`;
            iconPreview.style.background = `${spreadsheet.color}15`;
            iconPreview.style.color = spreadsheet.color;
        }

        // Populate column toggles
        populateColumnToggles(spreadsheet);
        
        // Populate filter assignee dropdown
        populateFilterAssigneeDropdown();

        // Clear search
        const searchInput = document.getElementById('spreadsheetSearch');
        if (searchInput) searchInput.value = '';

        // Render the table
        renderSpreadsheetTable(spreadsheet);

        // Show panel by adding class to tasks section (hides cards, shows panel)
        tasksSection.classList.add('spreadsheet-open');
    }

    // Close spreadsheet panel
    window.closeSpreadsheetPanel = function() {
        const tasksSection = document.getElementById('tasks-section');
        if (tasksSection) {
            tasksSection.classList.remove('spreadsheet-open');
            appState.currentSpreadsheet = null;
            spreadsheetState.selectedTasks.clear();
        }
    };

    // ===================================
    // COLUMN TOGGLES
    // ===================================
    // COLUMN TOGGLES - With Drag Reorder
    // Toggle switch + drag handle for reordering
    // ===================================
    function populateColumnToggles(spreadsheet) {
        // Built-in columns based on spreadsheet type
        // For tasks: excludes 'title' (always shown)
        // For leads: excludes 'leadName' (always shown)
        const isLeadsTable = spreadsheet?.type === 'leads';
        
        const taskColumns = [
            { id: 'status', label: 'Status' },
            { id: 'assignee', label: 'Assignee' },
            { id: 'priority', label: 'Priority' },
            { id: 'dueDate', label: 'Due Date' },
            { id: 'progress', label: 'Progress' },
            { id: 'budget', label: 'Budget' },
            { id: 'estimatedTime', label: 'Est. Time' }
        ];
        
        const leadsColumns = [
            { id: 'status', label: 'Status' },
            { id: 'source', label: 'Source' },
            { id: 'value', label: 'Value' },
            { id: 'contact', label: 'Contact' },
            { id: 'createdAt', label: 'Created' },
            { id: 'notes', label: 'Notes' }
        ];
        
        const allColumns = isLeadsTable ? leadsColumns : taskColumns;

        const container = document.getElementById('columnToggles');
        if (!container) return;

        container.innerHTML = '';
        
        // Close any existing context menu
        document.querySelectorAll('.column-context-menu').forEach(m => m.remove());
        
        // Sort columns: active ones first in their saved order, then inactive
        const sortedColumns = [...allColumns].sort((a, b) => {
            const aIndex = spreadsheet.columns.indexOf(a.id);
            const bIndex = spreadsheet.columns.indexOf(b.id);
            if (aIndex === -1 && bIndex === -1) return 0;
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });

        let draggedItem = null;
        let isDragging = false;

        // Helper function to create column item with improved drag handling
        function createColumnItem(col, isCustom = false) {
            const colId = col.id;
            const colLabel = isCustom ? col.name : col.label;
            const isActive = spreadsheet.columns.includes(colId);
            
            const item = document.createElement('div');
            item.className = `column-toggle-item ${isActive ? 'active' : ''} ${isCustom ? 'custom-column' : ''}`;
            item.dataset.columnId = colId;
            item.dataset.isCustom = isCustom ? 'true' : 'false';
            
            // Clean minimal design: drag handle, toggle, label
            item.innerHTML = `
                <div class="column-drag-handle" draggable="true"><i class="fas fa-grip-vertical"></i></div>
                <span class="column-toggle-switch"></span>
                <span class="column-toggle-label">${escapeHtml(colLabel)}</span>
                <input type="checkbox" ${isActive ? 'checked' : ''} data-column="${colId}">
            `;
            
            // Right-click context menu for custom columns
            if (isCustom) {
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showColumnContextMenu(e, colId, colLabel, spreadsheet);
                });
            }

            const dragHandle = item.querySelector('.column-drag-handle');
            const toggleSwitch = item.querySelector('.column-toggle-switch');

            // Toggle switch click - separate from drag
            toggleSwitch.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isDragging) return; // Don't toggle if dragging
                
                // Permission check for column visibility toggle
                if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
                    showToast('Only team owners and admins can modify columns', 'error');
                    return;
                }
                
                const checkbox = item.querySelector('input');
                checkbox.checked = !checkbox.checked;
                
                if (checkbox.checked) {
                    if (!spreadsheet.columns.includes(colId)) {
                        spreadsheet.columns.push(colId);
                    }
                    item.classList.add('active');
                } else {
                    spreadsheet.columns = spreadsheet.columns.filter(c => c !== colId);
                    item.classList.remove('active');
                }
                
                saveSpreadsheetToFirestore(spreadsheet);
                renderSpreadsheetTable(spreadsheet);
            });
            
            // Also allow clicking the label to toggle
            item.querySelector('.column-toggle-label').addEventListener('click', (e) => {
                if (isDragging) return;
                toggleSwitch.click();
            });

            // Drag events - only on drag handle
            dragHandle.addEventListener('dragstart', (e) => {
                // Permission check for drag reorder
                if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
                    e.preventDefault();
                    showToast('Only team owners and admins can reorder columns', 'error');
                    return;
                }
                
                isDragging = true;
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', colId);
            });

            dragHandle.addEventListener('dragend', () => {
                isDragging = false;
                item.classList.remove('dragging');
                container.querySelectorAll('.column-toggle-item').forEach(el => {
                    el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
                });
                draggedItem = null;
            });

            // Drop zone events on the item itself
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (draggedItem && draggedItem !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                    if (e.clientY < midY) {
                        item.classList.add('drag-over-top');
                    } else {
                        item.classList.add('drag-over-bottom');
                    }
                }
            });

            item.addEventListener('dragleave', (e) => {
                if (!item.contains(e.relatedTarget)) {
                    item.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const insertBefore = item.classList.contains('drag-over-top');
                item.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
                
                if (draggedItem && draggedItem !== item) {
                    const draggedId = draggedItem.dataset.columnId;
                    const targetId = item.dataset.columnId;
                    
                    // Build new column order from current DOM order
                    const allItems = Array.from(container.querySelectorAll('.column-toggle-item'));
                    const activeIds = [];
                    
                    allItems.forEach(el => {
                        const id = el.dataset.columnId;
                        if (spreadsheet.columns.includes(id) && id !== draggedId) {
                            activeIds.push(id);
                        }
                    });
                    
                    // Find where to insert dragged column
                    if (spreadsheet.columns.includes(draggedId)) {
                        const targetIndex = activeIds.indexOf(targetId);
                        if (targetIndex >= 0) {
                            if (insertBefore) {
                                activeIds.splice(targetIndex, 0, draggedId);
                            } else {
                                activeIds.splice(targetIndex + 1, 0, draggedId);
                            }
                        } else {
                            activeIds.push(draggedId);
                        }
                        
                        spreadsheet.columns = activeIds;
                        saveSpreadsheetToFirestore(spreadsheet);
                        populateColumnToggles(spreadsheet);
                        renderSpreadsheetTable(spreadsheet);
                    }
                }
            });

            return item;
        }

        // Create built-in column items
        sortedColumns.forEach(col => {
            container.appendChild(createColumnItem(col, false));
        });
        
        // Also render custom columns
        if (spreadsheet.customColumns && spreadsheet.customColumns.length > 0) {
            // Sort custom columns by their position in spreadsheet.columns
            const sortedCustom = [...spreadsheet.customColumns].sort((a, b) => {
                const aIndex = spreadsheet.columns.indexOf(a.id);
                const bIndex = spreadsheet.columns.indexOf(b.id);
                if (aIndex === -1 && bIndex === -1) return 0;
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });
            
            sortedCustom.forEach(customCol => {
                container.appendChild(createColumnItem(customCol, true));
            });
        }
    }
    
    // Show context menu for custom columns (right-click or menu button)
    function showColumnContextMenu(e, columnId, columnName, spreadsheet) {
        // Close any existing menu
        document.querySelectorAll('.column-context-menu').forEach(m => m.remove());
        
        // Permission check
        if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
            showToast('Only team owners and admins can modify columns', 'error');
            return;
        }
        
        const menu = document.createElement('div');
        menu.className = 'column-context-menu';
        menu.innerHTML = `
            <div class="column-context-menu-item edit-column" data-column-id="${columnId}">
                <i class="fas fa-pen"></i>
                <span>Edit Column</span>
            </div>
            <div class="column-context-menu-divider"></div>
            <div class="column-context-menu-item danger delete-column" data-column-id="${columnId}">
                <i class="fas fa-trash"></i>
                <span>Delete Column</span>
            </div>
        `;
        
        // Position menu
        const x = e.clientX || e.pageX;
        const y = e.clientY || e.pageY;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        document.body.appendChild(menu);
        
        // Adjust if off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
        
        // Edit column handler
        menu.querySelector('.edit-column').addEventListener('click', () => {
            menu.remove();
            if (window.openColumnEditModal) {
                window.openColumnEditModal(columnId, false);
            }
        });
        
        // Delete column handler
        menu.querySelector('.delete-column').addEventListener('click', async () => {
            menu.remove();
            
            // Confirm deletion
            if (!confirm(`Delete column "${columnName}"? This will remove the column and all its data from tasks.`)) {
                return;
            }
            
            try {
                // Remove from customColumns array
                if (spreadsheet.customColumns) {
                    spreadsheet.customColumns = spreadsheet.customColumns.filter(c => c.id !== columnId);
                }
                
                // Remove from active columns
                spreadsheet.columns = spreadsheet.columns.filter(c => c !== columnId);
                
                // Remove custom field data from all tasks
                appState.tasks.forEach(task => {
                    if (task.customFields && task.customFields[columnId] !== undefined) {
                        delete task.customFields[columnId];
                    }
                });
                
                // Save to Firestore
                await saveSpreadsheetToFirestore(spreadsheet);
                
                // Re-render
                populateColumnToggles(spreadsheet);
                renderSpreadsheetTable(spreadsheet);
                
                showToast(`Column "${columnName}" deleted`, 'success');
            } catch (error) {
                console.error('Error deleting column:', error);
                showToast('Failed to delete column', 'error');
            }
        });
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 10);
    }

    // ===================================
    // CUSTOM COLUMN MODAL
    // Create and manage custom columns with color support
    // ===================================
    
    // Track editing state for column modal
    let editingColumnId = null; // null = create mode, string = edit mode
    let editingColumnIsBuiltIn = false;
    
    function initCustomColumnModal() {
        console.log('🔧 initCustomColumnModal called');
        const addColumnBtn = document.getElementById('addColumnBtn');
        const modal = document.getElementById('customColumnModal');
        const closeBtn = document.getElementById('closeCustomColumnModal');
        const cancelBtn = document.getElementById('cancelCustomColumn');
        const createBtn = document.getElementById('createCustomColumn');
        const nameInput = document.getElementById('customColumnName');
        const nameError = document.getElementById('columnNameError');
        const typeSelector = document.getElementById('inputTypeSelector');
        const dropdownGroup = document.getElementById('dropdownOptionsGroup');
        const sliderGroup = document.getElementById('sliderConfigGroup');
        const addOptionBtn = document.getElementById('addDropdownOption');
        const addRangeBtn = document.getElementById('addColorRange');
        const iconPicker = document.getElementById('iconPicker');
        const optionsList = document.getElementById('dropdownOptionsList');
        const colorRangesList = document.getElementById('sliderColorRanges');
        
        console.log('🔧 addColumnBtn:', addColumnBtn);
        console.log('🔧 modal:', modal);

        let selectedType = 'dropdown';
        let selectedIcon = 'fa-tag';

        // Open modal for creating new column
        if (addColumnBtn) {
            console.log('🔧 Adding click listener to addColumnBtn');
            addColumnBtn.addEventListener('click', () => {
                console.log('🔧 Add column button clicked!');
                
                // Check role-based permissions - only owner/admin can add columns
                if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
                    showToast('Only team owners and admins can add columns', 'error');
                    return;
                }
                
                editingColumnId = null;
                editingColumnIsBuiltIn = false;
                resetCustomColumnModal();
                updateModalTitle('Create Column');
                openModal('customColumnModal');
            });
        } else {
            console.warn('⚠️ addColumnBtn not found!');
        }

        // Close modal
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal('customColumnModal'));
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('customColumnModal'));

        // Type selector - supports both old and new class names
        if (typeSelector) {
            typeSelector.querySelectorAll('.type-option, .unified-segmented-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Don't allow type change for assignee column (its options are teammates)
                    if (editingColumnIsBuiltIn && editingColumnId === 'assignee') return;
                    
                    typeSelector.querySelectorAll('.type-option, .unified-segmented-option').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    selectedType = btn.dataset.type;

                    // Show/hide type-specific options (but not for assignee)
                    if (editingColumnId !== 'assignee') {
                        if (dropdownGroup) dropdownGroup.style.display = selectedType === 'dropdown' ? 'flex' : 'none';
                        if (sliderGroup) sliderGroup.style.display = selectedType === 'slider' ? 'flex' : 'none';
                    }
                });
            });
        }

        // Icon picker - supports both old and new class names
        if (iconPicker) {
            iconPicker.querySelectorAll('.icon-option, .unified-icon-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    iconPicker.querySelectorAll('.icon-option, .unified-icon-option').forEach(b => b.classList.remove('active', 'selected'));
                    btn.classList.add('active');
                    btn.classList.add('selected');
                    selectedIcon = btn.dataset.icon;
                });
            });
        }

        // Add dropdown option with color picker
        if (addOptionBtn) {
            addOptionBtn.addEventListener('click', () => {
                addDropdownOptionInput();
            });
        }
        
        // Add color range for slider
        if (addRangeBtn) {
            addRangeBtn.addEventListener('click', () => {
                addColorRangeInput();
            });
        }

        // Delegated click handler for color swatches and remove buttons
        if (optionsList) {
            optionsList.addEventListener('click', (e) => {
                // Remove option button
                if (e.target.closest('.remove-option-btn')) {
                    const item = e.target.closest('.dropdown-option-item');
                    if (optionsList.children.length > 1) {
                        item.remove();
                    }
                }
                // Color swatch click
                if (e.target.closest('.color-swatch')) {
                    const swatch = e.target.closest('.color-swatch');
                    const picker = swatch.closest('.option-color-picker');
                    picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                }
            });
        }
        
        // Delegated click handler for color ranges
        if (colorRangesList) {
            colorRangesList.addEventListener('click', (e) => {
                // Remove range button
                if (e.target.closest('.remove-range-btn')) {
                    const item = e.target.closest('.color-range-item');
                    if (colorRangesList.children.length > 1) {
                        item.remove();
                    }
                }
                // Color swatch click
                if (e.target.closest('.color-swatch')) {
                    const swatch = e.target.closest('.color-swatch');
                    const picker = swatch.closest('.range-color-picker');
                    picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                }
            });
        }

        // Create/Update column button
        if (createBtn) {
            createBtn.addEventListener('click', async () => {
                // Double-check permissions before saving
                if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
                    showToast('Only team owners and admins can modify columns', 'error');
                    closeModal('customColumnModal');
                    return;
                }
                
                const name = nameInput.value.trim();
                
                // Validate
                if (!name) {
                    nameError.textContent = 'Please enter a column name';
                    nameInput.focus();
                    return;
                }
                nameError.textContent = '';

                // Get dropdown options with colors if applicable
                let options = [];
                if (selectedType === 'dropdown') {
                    const items = optionsList.querySelectorAll('.dropdown-option-item');
                    items.forEach(item => {
                        const input = item.querySelector('.dropdown-option-input');
                        const activeSwatch = item.querySelector('.color-swatch.active');
                        const val = input.value.trim();
                        if (val) {
                            options.push({
                                label: val,
                                color: activeSwatch?.dataset.color || '#9CA3AF'
                            });
                        }
                    });
                    if (options.length < 1) {
                        showToast('Please add at least one dropdown option', 'warning');
                        return;
                    }
                }

                // Get slider config with color ranges if applicable
                let sliderMin = 0, sliderMax = 100, colorRanges = [];
                if (selectedType === 'slider') {
                    sliderMin = parseInt(document.getElementById('sliderMin').value) || 0;
                    sliderMax = parseInt(document.getElementById('sliderMax').value) || 100;
                    if (sliderMax <= sliderMin) {
                        showToast('Max must be greater than Min', 'warning');
                        return;
                    }
                    
                    // Get color ranges
                    const rangeItems = colorRangesList.querySelectorAll('.color-range-item');
                    rangeItems.forEach(item => {
                        const minInput = item.querySelector('.range-min-input');
                        const maxInput = item.querySelector('.range-max-input');
                        const activeSwatch = item.querySelector('.color-swatch.active');
                        colorRanges.push({
                            min: parseInt(minInput.value) || 0,
                            max: parseInt(maxInput.value) || 100,
                            color: activeSwatch?.dataset.color || '#9CA3AF'
                        });
                    });
                }

                // Update existing column or create new
                if (editingColumnId) {
                    // EDIT MODE
                    if (editingColumnIsBuiltIn) {
                        // Built-in column: update all customizable properties (stored in spreadsheet.columnSettings)
                        if (!appState.currentSpreadsheet.columnSettings) {
                            appState.currentSpreadsheet.columnSettings = {};
                        }
                        
                        const settings = {
                            label: name,
                            icon: selectedIcon,
                            type: selectedType
                        };
                        
                        // Add type-specific settings (not for assignee - its options are teammates)
                        if (editingColumnId !== 'assignee') {
                            if (selectedType === 'dropdown') {
                                settings.options = options;
                            } else if (selectedType === 'slider') {
                                settings.min = sliderMin;
                                settings.max = sliderMax;
                                settings.colorRanges = colorRanges;
                            }
                        }
                        
                        appState.currentSpreadsheet.columnSettings[editingColumnId] = settings;
                    } else {
                        // Custom column: update all properties including type change
                        const customCol = appState.currentSpreadsheet.customColumns?.find(c => c.id === editingColumnId);
                        if (customCol) {
                            customCol.name = name;
                            customCol.icon = selectedIcon;
                            customCol.type = selectedType;
                            
                            // Clear old type-specific data and set new
                            customCol.options = selectedType === 'dropdown' ? options : null;
                            customCol.min = selectedType === 'slider' ? sliderMin : null;
                            customCol.max = selectedType === 'slider' ? sliderMax : null;
                            customCol.colorRanges = selectedType === 'slider' ? colorRanges : null;
                        }
                    }
                    
                    await saveSpreadsheetToFirestore(appState.currentSpreadsheet);
                    populateColumnToggles(appState.currentSpreadsheet);
                    renderSpreadsheetTable(appState.currentSpreadsheet);
                    showToast(`Column "${name}" updated`, 'success');
                } else {
                    // CREATE MODE
                    const customColumn = {
                        id: 'custom_' + Date.now(),
                        name: name,
                        type: selectedType,
                        icon: selectedIcon,
                        options: selectedType === 'dropdown' ? options : null,
                        min: selectedType === 'slider' ? sliderMin : null,
                        max: selectedType === 'slider' ? sliderMax : null,
                        colorRanges: selectedType === 'slider' ? colorRanges : null,
                        createdAt: Date.now()
                    };

                    // Add to current spreadsheet
                    if (appState.currentSpreadsheet) {
                        if (!appState.currentSpreadsheet.customColumns) {
                            appState.currentSpreadsheet.customColumns = [];
                        }
                        appState.currentSpreadsheet.customColumns.push(customColumn);
                        
                        // Add to active columns
                        appState.currentSpreadsheet.columns.push(customColumn.id);

                        await saveSpreadsheetToFirestore(appState.currentSpreadsheet);
                        populateColumnToggles(appState.currentSpreadsheet);
                        renderSpreadsheetTable(appState.currentSpreadsheet);
                        showToast(`Column "${name}" created`, 'success');
                    }
                }
                
                closeModal('customColumnModal');
            });
        }
        
        // Update modal title
        function updateModalTitle(title) {
            const headerH2 = modal?.querySelector('.modal-header h2') || modal?.querySelector('.unified-modal-title h2');
            if (headerH2) {
                headerH2.innerHTML = `<i class="fas fa-columns"></i> ${title}`;
            }
            // Update button text
            if (createBtn) {
                createBtn.innerHTML = editingColumnId 
                    ? '<i class="fas fa-check"></i> Save' 
                    : '<i class="fas fa-plus"></i> Create';
            }
        }

        // Reset modal to defaults (for create mode)
        function resetCustomColumnModal() {
            if (nameInput) nameInput.value = '';
            if (nameError) nameError.textContent = '';
            
            // Enable type selector
            if (typeSelector) {
                typeSelector.style.opacity = '1';
                typeSelector.style.pointerEvents = 'auto';
            }
            
            // Reset type selector - supports both old and new class names
            selectedType = 'dropdown';
            if (typeSelector) {
                typeSelector.querySelectorAll('.type-option, .unified-segmented-option').forEach(b => b.classList.remove('active'));
                typeSelector.querySelector('[data-type="dropdown"]')?.classList.add('active');
            }
            if (dropdownGroup) dropdownGroup.style.display = 'flex';
            if (sliderGroup) sliderGroup.style.display = 'none';

            // Reset dropdown options with color pickers
            if (optionsList) {
                optionsList.innerHTML = createDropdownOptionHTML(1) + createDropdownOptionHTML(2);
            }
            
            // Reset slider color ranges
            if (colorRangesList) {
                colorRangesList.innerHTML = `
                    ${createColorRangeHTML(0, 33, '#9CA3AF')}
                    ${createColorRangeHTML(34, 66, '#EAB308')}
                    ${createColorRangeHTML(67, 100, '#22C55E')}
                `;
            }

            // Reset slider config
            const sliderMinInput = document.getElementById('sliderMin');
            const sliderMaxInput = document.getElementById('sliderMax');
            if (sliderMinInput) sliderMinInput.value = '0';
            if (sliderMaxInput) sliderMaxInput.value = '100';

            // Reset icon picker - supports both old and new class names
            selectedIcon = 'fa-tag';
            if (iconPicker) {
                iconPicker.querySelectorAll('.icon-option, .unified-icon-option').forEach(b => b.classList.remove('active', 'selected'));
                const tagIcon = iconPicker.querySelector('[data-icon="fa-tag"]');
                if (tagIcon) {
                    tagIcon.classList.add('active');
                    tagIcon.classList.add('selected');
                }
            }
        }
        
        // Create dropdown option HTML with color picker
        function createDropdownOptionHTML(num, label = '', color = '#9CA3AF') {
            const colors = ['#9CA3AF', '#3B82F6', '#22C55E', '#EAB308', '#F97316', '#EF4444', '#A855F7'];
            return `
                <div class="dropdown-option-item">
                    <input type="text" class="dropdown-option-input" placeholder="Option ${num}" maxlength="25" value="${escapeHtml(label)}">
                    <div class="option-color-picker">
                        ${colors.map(c => `<button type="button" class="color-swatch ${c === color ? 'active' : ''}" data-color="${c}" style="background: ${c}" title="${getColorName(c)}"></button>`).join('')}
                    </div>
                    <button type="button" class="remove-option-btn" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }
        
        // Create color range HTML for slider
        function createColorRangeHTML(min, max, color = '#9CA3AF') {
            const colors = ['#9CA3AF', '#3B82F6', '#22C55E', '#EAB308', '#F97316', '#EF4444', '#A855F7'];
            return `
                <div class="color-range-item">
                    <input type="number" class="range-min-input" value="${min}" min="0" placeholder="Min">
                    <span class="range-separator">–</span>
                    <input type="number" class="range-max-input" value="${max}" placeholder="Max">
                    <div class="range-color-picker">
                        ${colors.map(c => `<button type="button" class="color-swatch ${c === color ? 'active' : ''}" data-color="${c}" style="background: ${c}" title="${getColorName(c)}"></button>`).join('')}
                    </div>
                    <button type="button" class="remove-range-btn" title="Remove range">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }
        
        // Get color name from hex
        function getColorName(hex) {
            const names = {
                '#9CA3AF': 'Grey', '#3B82F6': 'Blue', '#22C55E': 'Green',
                '#EAB308': 'Yellow', '#F97316': 'Orange', '#EF4444': 'Red', '#A855F7': 'Purple'
            };
            return names[hex] || 'Color';
        }

        function addDropdownOptionInput() {
            const count = optionsList.children.length + 1;
            optionsList.insertAdjacentHTML('beforeend', createDropdownOptionHTML(count));
            optionsList.lastElementChild.querySelector('input').focus();
        }
        
        function addColorRangeInput() {
            const lastRange = colorRangesList.lastElementChild;
            const lastMax = lastRange ? parseInt(lastRange.querySelector('.range-max-input').value) || 0 : 0;
            colorRangesList.insertAdjacentHTML('beforeend', createColorRangeHTML(lastMax + 1, lastMax + 33));
        }
        
        // Expose function to open modal in edit mode (called when clicking column header)
        window.openColumnEditModal = function(columnId, isBuiltIn = false) {
            // Block editing of 'title' and 'leadName' columns entirely (first column)
            if (columnId === 'title') {
                showToast('The Task column cannot be edited', 'info');
                return;
            }
            if (columnId === 'leadName') {
                showToast('The Lead column cannot be edited', 'info');
                return;
            }
            
            // Check role-based permissions - only owner/admin can edit columns
            if (appState.currentTeamData && !isAdmin(appState.currentTeamData)) {
                showToast('Only team owners and admins can edit columns', 'error');
                return;
            }
            
            editingColumnId = columnId;
            editingColumnIsBuiltIn = isBuiltIn;
            
            // Built-in column definitions with default options
            // Includes both Task columns and Lead columns
            const builtInColumns = {
                // === TASK COLUMNS ===
                'title': { label: 'Title', icon: 'fa-heading', type: 'text' },
                'status': { 
                    label: 'Status', icon: 'fa-circle-notch', type: 'dropdown',
                    defaultOptions: appState.currentSpreadsheet?.type === 'leads' 
                        ? [
                            { label: 'New', color: '#007AFF' },
                            { label: 'Contacted', color: '#5856D6' },
                            { label: 'Qualified', color: '#FF9500' },
                            { label: 'Won', color: '#34C759' },
                            { label: 'Lost', color: '#FF3B30' }
                        ]
                        : [
                            { label: 'To Do', color: '#9CA3AF' },
                            { label: 'In Progress', color: '#3B82F6' },
                            { label: 'Review', color: '#EAB308' },
                            { label: 'Done', color: '#22C55E' }
                        ]
                },
                'assignee': { label: 'Assignee', icon: 'fa-user', type: 'dropdown' },
                'priority': { 
                    label: 'Priority', icon: 'fa-flag', type: 'dropdown',
                    defaultOptions: [
                        { label: 'Low', color: '#22C55E' },
                        { label: 'Medium', color: '#EAB308' },
                        { label: 'High', color: '#F97316' },
                        { label: 'Critical', color: '#EF4444' }
                    ]
                },
                'dueDate': { label: 'Due Date', icon: 'fa-calendar', type: 'date' },
                'progress': { 
                    label: 'Progress', icon: 'fa-chart-line', type: 'slider',
                    defaultColorRanges: [
                        { min: 0, max: 33, color: '#EF4444' },
                        { min: 34, max: 66, color: '#EAB308' },
                        { min: 67, max: 100, color: '#22C55E' }
                    ]
                },
                'budget': { label: 'Budget', icon: 'fa-dollar-sign', type: 'number' },
                'estimatedTime': { label: 'Est. Time', icon: 'fa-clock', type: 'number' },
                
                // === LEAD COLUMNS ===
                'leadName': { label: 'Lead Name', icon: 'fa-user', type: 'text' },
                'source': { 
                    label: 'Source', icon: 'fa-globe', type: 'dropdown',
                    defaultOptions: [
                        { label: 'Website', color: '#007AFF' },
                        { label: 'Referral', color: '#34C759' },
                        { label: 'Ad Campaign', color: '#FF9500' },
                        { label: 'Social Media', color: '#5856D6' },
                        { label: 'Other', color: '#8E8E93' }
                    ]
                },
                'value': { label: 'Value', icon: 'fa-dollar-sign', type: 'number' },
                'contact': { label: 'Contact', icon: 'fa-phone', type: 'text' },
                'createdAt': { label: 'Created', icon: 'fa-calendar-plus', type: 'date' },
                'notes': { label: 'Notes', icon: 'fa-sticky-note', type: 'text' }
            };
            
            if (isBuiltIn) {
                const colDef = builtInColumns[columnId];
                if (!colDef) return;
                
                const customSettings = appState.currentSpreadsheet?.columnSettings?.[columnId] || {};
                
                // Populate form with built-in column data (using custom settings if available)
                if (nameInput) nameInput.value = customSettings.label || colDef.label;
                selectedIcon = customSettings.icon || colDef.icon;
                selectedType = customSettings.type || colDef.type;
                
                // Select icon
                if (iconPicker) {
                    iconPicker.querySelectorAll('.icon-option').forEach(b => b.classList.remove('active'));
                    iconPicker.querySelector(`[data-icon="${selectedIcon}"]`)?.classList.add('active');
                }
                
                // For assignee column - disable type selector (it must stay as dropdown with teammate options)
                if (columnId === 'assignee') {
                    if (typeSelector) {
                        typeSelector.style.opacity = '0.5';
                        typeSelector.style.pointerEvents = 'none';
                        typeSelector.querySelectorAll('.type-option').forEach(b => b.classList.remove('active'));
                        typeSelector.querySelector(`[data-type="dropdown"]`)?.classList.add('active');
                    }
                    if (dropdownGroup) dropdownGroup.style.display = 'none';
                    if (sliderGroup) sliderGroup.style.display = 'none';
                } else {
                    // Enable type selector for other built-in columns (they can change type now)
                    if (typeSelector) {
                        typeSelector.style.opacity = '1';
                        typeSelector.style.pointerEvents = 'auto';
                        typeSelector.querySelectorAll('.type-option').forEach(b => b.classList.remove('active'));
                        typeSelector.querySelector(`[data-type="${selectedType}"]`)?.classList.add('active');
                    }
                    
                    // Show type-specific options based on current type
                    if (dropdownGroup) dropdownGroup.style.display = selectedType === 'dropdown' ? 'flex' : 'none';
                    if (sliderGroup) sliderGroup.style.display = selectedType === 'slider' ? 'flex' : 'none';
                    
                    // Populate dropdown options with colors
                    if (selectedType === 'dropdown' && optionsList) {
                        optionsList.innerHTML = '';
                        const opts = customSettings.options || colDef.defaultOptions || [];
                        opts.forEach((opt, i) => {
                            const label = typeof opt === 'string' ? opt : opt.label;
                            const color = typeof opt === 'string' ? '#9CA3AF' : (opt.color || '#9CA3AF');
                            optionsList.insertAdjacentHTML('beforeend', createDropdownOptionHTML(i + 1, label, color));
                        });
                        if (opts.length === 0) {
                            optionsList.innerHTML = createDropdownOptionHTML(1) + createDropdownOptionHTML(2);
                        }
                    }
                    
                    // Populate slider config with color ranges
                    if (selectedType === 'slider') {
                        const sliderMinInput = document.getElementById('sliderMin');
                        const sliderMaxInput = document.getElementById('sliderMax');
                        if (sliderMinInput) sliderMinInput.value = customSettings.min || 0;
                        if (sliderMaxInput) sliderMaxInput.value = customSettings.max || 100;
                        
                        if (colorRangesList) {
                            colorRangesList.innerHTML = '';
                            const ranges = customSettings.colorRanges || colDef.defaultColorRanges || [
                                { min: 0, max: 33, color: '#9CA3AF' },
                                { min: 34, max: 66, color: '#EAB308' },
                                { min: 67, max: 100, color: '#22C55E' }
                            ];
                            ranges.forEach(r => {
                                colorRangesList.insertAdjacentHTML('beforeend', createColorRangeHTML(r.min, r.max, r.color));
                            });
                        }
                    }
                }
                
            } else {
                // Custom column editing
                const customCol = appState.currentSpreadsheet?.customColumns?.find(c => c.id === columnId);
                if (!customCol) return;
                
                if (nameInput) nameInput.value = customCol.name;
                selectedType = customCol.type;
                selectedIcon = customCol.icon;
                
                // Enable type selector for custom columns (allow type changes)
                if (typeSelector) {
                    typeSelector.style.opacity = '1';
                    typeSelector.style.pointerEvents = 'auto';
                    typeSelector.querySelectorAll('.type-option').forEach(b => b.classList.remove('active'));
                    typeSelector.querySelector(`[data-type="${selectedType}"]`)?.classList.add('active');
                }
                
                // Select icon
                if (iconPicker) {
                    iconPicker.querySelectorAll('.icon-option').forEach(b => b.classList.remove('active'));
                    iconPicker.querySelector(`[data-icon="${selectedIcon}"]`)?.classList.add('active');
                }
                
                // Show type-specific options
                if (dropdownGroup) dropdownGroup.style.display = selectedType === 'dropdown' ? 'flex' : 'none';
                if (sliderGroup) sliderGroup.style.display = selectedType === 'slider' ? 'flex' : 'none';
                
                // Populate dropdown options with colors
                if (selectedType === 'dropdown' && optionsList) {
                    optionsList.innerHTML = '';
                    const opts = customCol.options || [];
                    opts.forEach((opt, i) => {
                        // Handle both old format (string) and new format (object with label/color)
                        const label = typeof opt === 'string' ? opt : opt.label;
                        const color = typeof opt === 'string' ? '#9CA3AF' : (opt.color || '#9CA3AF');
                        optionsList.insertAdjacentHTML('beforeend', createDropdownOptionHTML(i + 1, label, color));
                    });
                    if (opts.length === 0) {
                        optionsList.innerHTML = createDropdownOptionHTML(1) + createDropdownOptionHTML(2);
                    }
                }
                
                // Populate slider config with color ranges
                if (selectedType === 'slider') {
                    const sliderMinInput = document.getElementById('sliderMin');
                    const sliderMaxInput = document.getElementById('sliderMax');
                    if (sliderMinInput) sliderMinInput.value = customCol.min || 0;
                    if (sliderMaxInput) sliderMaxInput.value = customCol.max || 100;
                    
                    if (colorRangesList) {
                        colorRangesList.innerHTML = '';
                        const ranges = customCol.colorRanges || [
                            { min: 0, max: 33, color: '#9CA3AF' },
                            { min: 34, max: 66, color: '#EAB308' },
                            { min: 67, max: 100, color: '#22C55E' }
                        ];
                        ranges.forEach(r => {
                            colorRangesList.insertAdjacentHTML('beforeend', createColorRangeHTML(r.min, r.max, r.color));
                        });
                    }
                }
            }
            
            updateModalTitle('Edit Column');
            openModal('customColumnModal');
        };
    }

    // ===================================
    // SPREADSHEET TABLE RENDERING
    // =================================== 
    function renderSpreadsheetTable(spreadsheet) {
        const tableContainer = document.getElementById('tableContainer');
        if (!tableContainer) return;

        // Get filtered and sorted tasks for this spreadsheet
        let tasks = getFilteredAndSortedTasks();
        
        // Get all tasks for this spreadsheet (without search/filter applied)
        const spreadsheetTasks = getTasksForSpreadsheet(spreadsheet);
        
        // Determine if this is a leads table
        const isLeadsTable = spreadsheet.type === 'leads';
        const itemName = isLeadsTable ? 'lead' : 'task';
        const itemNamePlural = isLeadsTable ? 'leads' : 'tasks';
        const addBtnId = isLeadsTable ? 'addLeadPanelBtn' : 'addTaskPanelBtn';

        if (tasks.length === 0 && spreadsheetTasks.length === 0) {
            tableContainer.innerHTML = `
                <div class="spreadsheet-empty">
                    <i class="fas fa-${isLeadsTable ? 'user-plus' : 'clipboard-list'}"></i>
                    <h4>No ${itemNamePlural} yet</h4>
                    <p>Create your first ${itemName} to get started</p>
                    <button class="btn-primary empty-state-btn" onclick="openAddItemModal()">
                        <i class="fas fa-plus"></i> Add ${itemName.charAt(0).toUpperCase() + itemName.slice(1)}
                    </button>
                </div>
            `;
            return;
        }

        if (tasks.length === 0) {
            tableContainer.innerHTML = `
                <div class="spreadsheet-empty">
                    <i class="fas fa-search"></i>
                    <h4>No matching ${itemNamePlural}</h4>
                    <p>Try adjusting your search or filters</p>
                    <button class="btn-secondary empty-state-btn" onclick="clearFilters()">
                        <i class="fas fa-times"></i> Clear Filters
                    </button>
                </div>
            `;
            return;
        }

        // Build table HTML - use spreadsheet.columns as the single source of truth for visible columns
        // This array contains both built-in and custom column IDs that are currently visible
        // Deduplicate columns and set proper defaults based on table type
        let visibleColumns = spreadsheet.columns;
        if (!visibleColumns || visibleColumns.length === 0) {
            visibleColumns = isLeadsTable 
                ? ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes']
                : ['title', 'status', 'assignee', 'priority', 'dueDate'];
        } else {
            // Remove duplicates
            visibleColumns = [...new Set(visibleColumns)];
        }
        const firstColHeader = isLeadsTable ? 'Lead' : 'Task';
        
        let tableHTML = `
            <table class="spreadsheet-table">
                <thead>
                    <tr>
                        ${visibleColumns.map(col => {
                            // Column header - clickable icon to edit column settings (except title/leadName column)
                            const isCustom = col.startsWith('custom_');
                            const icon = getColumnIcon(col, spreadsheet);
                            const label = getColumnLabel(col, spreadsheet);
                            const isFirstCol = col === 'title' || col === 'leadName';
                            const clickableClass = isFirstCol ? '' : 'column-header-clickable';
                            return `<th title="${label}" class="${clickableClass}" data-column-id="${col}" data-is-custom="${isCustom}">
                                ${isFirstCol ? firstColHeader : `<i class="fas ${icon} column-header-icon"></i>`}
                            </th>`;
                        }).join('')}
                        <th title="Actions"><i class="fas fa-ellipsis-h"></i></th>
                    </tr>
                </thead>
                <tbody>
        `;

        tasks.forEach(task => {
            const isCompleted = task.status === 'done';
            tableHTML += `<tr class="${isCompleted ? 'row-completed' : ''}" data-task-id="${task.id}">`;
            
            visibleColumns.forEach(col => {
                tableHTML += renderTableCell(task, col, spreadsheet);
            });

            tableHTML += `
                <td>
                    <div class="row-actions">
                        <button class="row-action-btn" onclick="editTask(appState.tasks.find(t => t.id === '${task.id}'))" data-tooltip="Edit">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="row-action-btn delete" onclick="deleteTask('${task.id}', event)" data-tooltip="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tableHTML += '</tr>';
        });

        tableHTML += `
                </tbody>
            </table>
            <button class="add-row-btn" onclick="openAddItemModal()">
                <i class="fas fa-plus"></i> Add new ${isLeadsTable ? 'lead' : 'task'}
            </button>
        `;

        tableContainer.innerHTML = tableHTML;

        // Add event listeners
        initTableEventListeners(spreadsheet);
    }

    // Initialize table event listeners
    function initTableEventListeners(spreadsheet) {
        const tableContainer = document.getElementById('tableContainer');
        if (!tableContainer) return;
        
        // ===================================
        // COLUMN HEADER CLICK TO EDIT
        // Click on column header icon to open edit popup
        // ===================================
        tableContainer.querySelectorAll('.column-header-clickable').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const columnId = header.dataset.columnId;
                const isCustom = header.dataset.isCustom === 'true';
                // Open column edit modal
                if (window.openColumnEditModal) {
                    window.openColumnEditModal(columnId, !isCustom);
                }
            });
        });
        
        // ===================================
        // INLINE EDITING IMPLEMENTATION PLAN:
        // 1. Title: Click cell → text input, Enter/blur saves
        // 2. Due Date: Click cell → date picker, change saves  
        // 3. Budget: Click cell → number input with $, blur saves
        // 4. Est. Time: Click cell → number input, blur saves
        // 5. Progress: Existing drag-to-edit functionality
        // 6. Priority/Assignee: Existing dropdown functionality
        // ===================================
        
        // Initialize inline text editing (title, budget, est time, date)
        initInlineTextEditing(tableContainer);
        
        // ===================================
        // INLINE EDITING: Progress Bar Drag
        // ===================================
        initInlineProgressEditing(tableContainer);
        
        // ===================================
        // INLINE EDITING: Priority Dropdown
        // ===================================
        initInlinePriorityEditing(tableContainer);
        
        // ===================================
        // INLINE EDITING: Assignee Dropdown
        // ===================================
        initInlineAssigneeEditing(tableContainer);
        
        // ===================================
        // INLINE EDITING: Custom Columns
        // ===================================
        initCustomColumnEditing(tableContainer, spreadsheet);
        
        // ===================================
        // INLINE EDITING: Built-in Dropdowns (Status/Priority with custom settings)
        // ===================================
        initBuiltInDropdownEditing(tableContainer, spreadsheet);
    }
    
    // ===================================
    // BUILT-IN DROPDOWN EDITING (Status/Priority with columnSettings)
    // Handles .custom-dropdown-cell.built-in-dropdown cells
    // ===================================
    function initBuiltInDropdownEditing(container, spreadsheet) {
        container.querySelectorAll('.custom-dropdown-cell.built-in-dropdown').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = cell.dataset.taskId;
                const columnId = cell.dataset.columnId; // 'status' or 'priority'
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                closeAllInlineDropdowns();
                showBuiltInDropdown(cell, task, columnId, spreadsheet);
            });
        });
    }
    
    function showBuiltInDropdown(cell, task, columnId, spreadsheet) {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-edit-dropdown built-in-col-dropdown';
        
        // Get settings from spreadsheet columnSettings
        const settings = spreadsheet?.columnSettings?.[columnId];
        const options = settings?.options || [];
        
        // Get current value based on column type
        let currentValue = '';
        if (columnId === 'status') {
            // For leads, status is stored as-is (New, Contacted, etc.)
            // For tasks, status uses codes (todo, inprogress, done)
            const taskStatusMap = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
            currentValue = taskStatusMap[task.status] || task.status;
        } else if (columnId === 'priority') {
            currentValue = (task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1);
        } else if (columnId === 'source') {
            currentValue = task.source || '';
        }
        
        // Build options HTML
        let optionsHTML = '';
        options.forEach(opt => {
            const label = typeof opt === 'string' ? opt : opt.label;
            const color = typeof opt === 'string' ? '#9CA3AF' : (opt.color || '#9CA3AF');
            const isActive = currentValue === label;
            optionsHTML += `
                <div class="inline-dropdown-option ${isActive ? 'active' : ''}" data-value="${escapeHtml(label)}" data-color="${color}">
                    <span class="option-color-dot" style="background: ${color}"></span>
                    <span>${escapeHtml(label)}</span>
                    ${isActive ? '<i class="fas fa-check"></i>' : ''}
                </div>
            `;
        });
        
        dropdown.innerHTML = optionsHTML;
        
        positionInlineDropdown(dropdown, cell);
        document.body.appendChild(dropdown);
        
        requestAnimationFrame(() => dropdown.classList.add('visible'));
        
        dropdown.querySelectorAll('.inline-dropdown-option').forEach(option => {
            option.addEventListener('click', async () => {
                const newValue = option.dataset.value;
                const newColor = option.dataset.color || '#9CA3AF';
                await updateBuiltInDropdownValue(task, columnId, newValue, newColor, cell);
                closeAllInlineDropdowns();
            });
        });
        
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnOutsideClick);
        }, 10);
    }
    
    async function updateBuiltInDropdownValue(task, columnId, newDisplayValue, newColor, cell) {
        // Convert display value to internal value
        let newValue = newDisplayValue;
        if (columnId === 'status') {
            // Check if this is a task status (has mapping) or lead status (store as-is)
            const statusMap = { 'To Do': 'todo', 'In Progress': 'inprogress', 'Done': 'done' };
            // Only use map if the display value is a task status
            if (statusMap[newDisplayValue]) {
                newValue = statusMap[newDisplayValue];
            } else {
                // For leads or custom statuses, store as-is
                newValue = newDisplayValue;
            }
        } else if (columnId === 'priority') {
            newValue = newDisplayValue.toLowerCase();
        } else if (columnId === 'source') {
            // For source, store as-is
            newValue = newDisplayValue;
        }
        
        const oldValue = task[columnId];
        if (oldValue === newValue) return;
        
        // Update local state
        task[columnId] = newValue;
        
        // Update cell visual with colored pill
        const pillSpan = cell.querySelector('.custom-dropdown-pill');
        if (pillSpan) {
            pillSpan.style.background = `${newColor}20`;
            pillSpan.style.color = newColor;
            const dotSpan = pillSpan.querySelector('.pill-dot');
            if (dotSpan) dotSpan.style.background = newColor;
            pillSpan.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('pill-dot'))) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        node.textContent = newDisplayValue;
                    }
                }
            });
            // Find and update text content
            const textContent = Array.from(pillSpan.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
            if (textContent) {
                textContent.textContent = '\n                                ' + newDisplayValue + '\n                            ';
            } else {
                // Rebuild pill inner content
                pillSpan.innerHTML = `<span class="pill-dot" style="background: ${newColor}"></span>${escapeHtml(newDisplayValue)}`;
            }
        }
        
        // Show save feedback
        showInlineSaveFeedback(cell.closest('td'));
        
        // Save to Firestore
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(task.id));
                await updateDoc(taskRef, { 
                    [columnId]: newValue,
                    updatedAt: serverTimestamp()
                });
                debugLog(`✅ Task ${columnId} updated:`, task.id, newValue);
            } catch (error) {
                console.error(`Error updating task ${columnId}:`, error);
                task[columnId] = oldValue;
            }
        }
        
        saveToLocalStorage('tasks', appState.tasks);
        
        // Update metrics if needed
        if (typeof aggregateAndRenderMetrics === 'function') {
            aggregateAndRenderMetrics();
        }
    }
    
    // ===================================
    // INLINE TEXT EDITING (Title, Date, Budget, Est. Time, Leads fields)
    // Click cell → input field → Enter/blur saves, Escape cancels
    // ===================================
    function initInlineTextEditing(container) {
        // Title cells (also handles leadName since both use .cell-title-editable)
        container.querySelectorAll('.cell-title-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                // Check if this is a leads spreadsheet by looking for leadName in the task
                const taskId = cell.dataset.taskId;
                const task = appState.tasks.find(t => t.id === taskId);
                const field = task?.leadName !== undefined ? 'leadName' : 'title';
                startInlineEdit(cell, field, 'text');
            });
        });
        
        // Date cells
        container.querySelectorAll('.cell-date-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'dueDate', 'date');
            });
        });
        
        // Budget cells
        container.querySelectorAll('.cell-budget-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'budget', 'number');
            });
        });
        
        // Est. Time cells
        container.querySelectorAll('.cell-time-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'estimatedTime', 'number');
            });
        });
        
        // Source cells (leads)
        container.querySelectorAll('.cell-source-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'source', 'text');
            });
        });
        
        // Value cells (leads)
        container.querySelectorAll('.cell-value-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'value', 'currency');
            });
        });
        
        // Contact cells (leads)
        container.querySelectorAll('.cell-contact-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'contact', 'text');
            });
        });
        
        // Notes cells (leads)
        container.querySelectorAll('.cell-notes-editable').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(cell, 'notes', 'text');
            });
        });
    }
    
    function startInlineEdit(cell, field, inputType) {
        // Don't start if already editing
        if (cell.querySelector('.inline-edit-input')) return;
        
        const taskId = cell.dataset.taskId;
        const task = appState.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        const originalValue = task[field];
        const displayValue = cell.textContent.trim();
        
        // Store original HTML for cancel
        const originalHTML = cell.innerHTML;
        
        // Create input based on type
        let input;
        if (inputType === 'date') {
            input = document.createElement('input');
            input.type = 'date';
            input.className = 'inline-edit-input inline-edit-date';
            // Format date for input
            if (originalValue) {
                const d = new Date(originalValue);
                input.value = d.toISOString().split('T')[0];
            }
        } else if (inputType === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.className = 'inline-edit-input inline-edit-number';
            input.min = '0';
            input.step = field === 'budget' ? '0.01' : '0.5';
            input.value = originalValue || '';
            input.placeholder = field === 'budget' ? '0.00' : '0';
        } else if (inputType === 'currency') {
            // Currency input for lead value
            input = document.createElement('input');
            input.type = 'number';
            input.className = 'inline-edit-input inline-edit-currency';
            input.min = '0';
            input.step = '1';
            input.value = originalValue || '';
            input.placeholder = '0';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'inline-edit-input inline-edit-text';
            input.value = originalValue || '';
            input.placeholder = field === 'source' ? 'e.g., Website, Referral...' : 
                               field === 'contact' ? 'Email or phone...' :
                               field === 'leadName' ? 'Lead name...' :
                               field === 'notes' ? 'Add notes...' : 'Enter value...';
            
            // Add real-time 20-word limit for title/leadName
            if (field === 'title' || field === 'leadName') {
                input.addEventListener('input', (e) => {
                    const MAX_WORDS = 20;
                    const words = e.target.value.split(/\s+/).filter(word => word.length > 0);
                    if (words.length > MAX_WORDS) {
                        e.target.value = words.slice(0, MAX_WORDS).join(' ');
                    }
                });
            }
        }
        
        // Replace cell content with input
        cell.innerHTML = '';
        cell.classList.add('editing');
        cell.appendChild(input);
        input.focus();
        input.select();
        
        // Handle save on blur
        input.addEventListener('blur', () => {
            saveInlineEdit(cell, task, field, input.value, originalValue, originalHTML);
        });
        
        // Handle Enter to save, Escape to cancel
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineEdit(cell, originalHTML);
            }
        });
    }
    
    async function saveInlineEdit(cell, task, field, newValue, originalValue, originalHTML) {
        cell.classList.remove('editing');
        
        // Parse value based on field type
        let parsedValue = newValue;
        if (field === 'budget') {
            parsedValue = newValue ? parseFloat(newValue) : null;
            if (parsedValue !== null && parsedValue < 0) parsedValue = 0;
        } else if (field === 'estimatedTime') {
            parsedValue = newValue ? parseFloat(newValue) : null;
            if (parsedValue !== null && parsedValue < 0) parsedValue = 0;
        } else if (field === 'value') {
            // Lead value (currency)
            parsedValue = newValue ? parseFloat(newValue) : null;
            if (parsedValue !== null && parsedValue < 0) parsedValue = 0;
        } else if (field === 'dueDate') {
            parsedValue = newValue ? new Date(newValue).getTime() : null;
        } else if (field === 'title' || field === 'leadName') {
            parsedValue = newValue.trim();
            if (!parsedValue) {
                // Title/leadName is required, revert
                cancelInlineEdit(cell, originalHTML);
                return;
            }
            // 20 word limit
            const wordCount = parsedValue.split(/\s+/).filter(word => word.length > 0).length;
            if (wordCount > 20) {
                parsedValue = parsedValue.split(/\s+/).slice(0, 20).join(' ');
                showToast('Name limited to 20 words', 'warning');
            }
        } else if (field === 'source' || field === 'contact' || field === 'notes') {
            // Leads text fields
            parsedValue = newValue.trim() || null;
        }
        
        // Check if value actually changed
        if (parsedValue === originalValue || 
            (parsedValue === null && originalValue === null) ||
            (parsedValue === '' && !originalValue)) {
            // Restore original display
            cell.innerHTML = originalHTML;
            return;
        }
        
        // Update local state
        task[field] = parsedValue;
        
        // Update cell display
        updateCellDisplay(cell, task, field);
        
        // Show save feedback
        showInlineSaveFeedback(cell);
        
        // Save to Firestore
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(task.id));
                await updateDoc(taskRef, { 
                    [field]: parsedValue,
                    updatedAt: serverTimestamp()
                });
                debugLog(`✅ Task ${field} updated:`, task.id, parsedValue);
            } catch (error) {
                const path = `teams/${appState.currentTeamId}/tasks/${task.id}`;
                logFirestoreError(`saveInlineEdit(${field})`, path, { [field]: parsedValue }, {
                    uid: currentAuthUser?.uid,
                    teamId: appState.currentTeamId,
                    taskId: task.id,
                    taskCreatedBy: task.createdBy,
                    userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
                }, error);
                // Revert on error
                task[field] = originalValue;
                cell.innerHTML = originalHTML;
            }
        }
        
        // Update local storage
        saveToLocalStorage('tasks', appState.tasks);
    }
    
    function cancelInlineEdit(cell, originalHTML) {
        cell.classList.remove('editing');
        cell.innerHTML = originalHTML;
    }
    
    function updateCellDisplay(cell, task, field) {
        switch (field) {
            case 'title':
                cell.innerHTML = escapeHtml(task.title || '');
                break;
            case 'leadName':
                cell.innerHTML = escapeHtml(task.leadName || '');
                break;
            case 'dueDate':
                if (!task.dueDate) {
                    cell.innerHTML = '—';
                    cell.className = 'cell-date-editable cell-editable date-cell';
                } else {
                    const date = new Date(task.dueDate);
                    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const dueDate = new Date(date);
                    dueDate.setHours(0, 0, 0, 0);
                    const diff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                    let dateClass = '';
                    if (task.status !== 'done') {
                        if (diff < 0) dateClass = 'overdue';
                        else if (diff === 0) dateClass = 'today';
                    }
                    cell.innerHTML = formatted;
                    cell.className = `cell-date-editable cell-editable date-cell ${dateClass}`;
                }
                break;
            case 'budget':
                cell.innerHTML = task.budget ? '$' + parseFloat(task.budget).toFixed(2) : '—';
                break;
            case 'estimatedTime':
                cell.innerHTML = task.estimatedTime ? task.estimatedTime + 'h' : '—';
                break;
            case 'source':
                cell.innerHTML = escapeHtml(task.source || '—');
                break;
            case 'value':
                cell.innerHTML = task.value ? '$' + parseFloat(task.value).toLocaleString() : '—';
                break;
            case 'contact':
                cell.innerHTML = escapeHtml(task.contact || '—');
                break;
            case 'notes':
                cell.innerHTML = escapeHtml(task.notes || '—');
                break;
        }
        cell.dataset.taskId = task.id;
    }

    // ===================================
    // INLINE PROGRESS EDITING - Clean Range Input
    // Simple input[type=range] with real-time updates
    // ===================================
    function initInlineProgressEditing(container) {
        container.querySelectorAll('.progress-cell-inline').forEach(cell => {
            const taskId = cell.dataset.taskId;
            const slider = cell.querySelector('.progress-range-slider');
            const text = cell.querySelector('.progress-text');
            
            if (!slider || !taskId) return;
            
            // Update visual on input (while dragging)
            slider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                text.textContent = value + '%';
                slider.style.setProperty('--progress', value + '%');
                
                if (value === 100) {
                    slider.classList.add('complete');
                } else {
                    slider.classList.remove('complete');
                }
            });
            
            // Save on change (when released)
            slider.addEventListener('change', async (e) => {
                const newProgress = parseInt(e.target.value);
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                const oldProgress = task.progress || 0;
                if (oldProgress === newProgress) return;
                
                // Update local state
                task.progress = newProgress;
                
                // Show save feedback
                showInlineSaveFeedback(cell);
                
                // Save to Firestore
                if (db && currentAuthUser && appState.currentTeamId) {
                    try {
                        const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                        const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(taskId));
                        const payload = { progress: newProgress, updatedAt: serverTimestamp() };
                        await updateDoc(taskRef, payload);
                        debugLog('✅ Task progress updated:', taskId, newProgress);
                    } catch (error) {
                        const path = `teams/${appState.currentTeamId}/tasks/${taskId}`;
                        logFirestoreError('updateTaskProgress', path, { progress: newProgress }, {
                            uid: currentAuthUser?.uid,
                            teamId: appState.currentTeamId,
                            taskId: taskId,
                            taskCreatedBy: task.createdBy,
                            taskAssignee: task.assignee,
                            taskAssigneeId: task.assigneeId,
                            userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
                        }, error);
                    }
                }
            });
        });
    }

    // ===================================
    // INLINE PRIORITY EDITING
    // Apple-like floating dropdown
    // ===================================
    function initInlinePriorityEditing(container) {
        container.querySelectorAll('.priority-badge-inline').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = badge.dataset.taskId;
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                // Close any existing dropdowns
                closeAllInlineDropdowns();
                
                // Create and show dropdown
                showPriorityDropdown(badge, task);
            });
        });
    }
    
    function showPriorityDropdown(badge, task) {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-edit-dropdown priority-dropdown';
        dropdown.innerHTML = `
            <div class="inline-dropdown-option ${task.priority === 'low' ? 'active' : ''}" data-value="low">
                <span class="priority-dot low"></span>
                <span>Low</span>
                ${task.priority === 'low' ? '<i class="fas fa-check"></i>' : ''}
            </div>
            <div class="inline-dropdown-option ${task.priority === 'medium' ? 'active' : ''}" data-value="medium">
                <span class="priority-dot medium"></span>
                <span>Medium</span>
                ${task.priority === 'medium' ? '<i class="fas fa-check"></i>' : ''}
            </div>
            <div class="inline-dropdown-option ${task.priority === 'high' ? 'active' : ''}" data-value="high">
                <span class="priority-dot high"></span>
                <span>High</span>
                ${task.priority === 'high' ? '<i class="fas fa-check"></i>' : ''}
            </div>
        `;
        
        // Position dropdown
        positionInlineDropdown(dropdown, badge);
        document.body.appendChild(dropdown);
        
        // Add animation class
        requestAnimationFrame(() => dropdown.classList.add('visible'));
        
        // Handle option selection
        dropdown.querySelectorAll('.inline-dropdown-option').forEach(option => {
            option.addEventListener('click', async () => {
                const newPriority = option.dataset.value;
                await updateTaskPriority(task, newPriority, badge);
                closeAllInlineDropdowns();
            });
        });
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnOutsideClick);
        }, 10);
    }
    
    async function updateTaskPriority(task, newPriority, badge) {
        const oldPriority = task.priority;
        if (oldPriority === newPriority) return;
        
        // Update local state
        task.priority = newPriority;
        
        // Update badge visual
        const priorityLabel = newPriority.charAt(0).toUpperCase() + newPriority.slice(1);
        badge.className = `priority-badge priority-badge-inline ${newPriority}`;
        badge.innerHTML = priorityLabel;
        badge.dataset.taskId = task.id;
        
        // Show save feedback
        showInlineSaveFeedback(badge.closest('td'));
        
        // Save to Firestore
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(task.id));
                await updateDoc(taskRef, { 
                    priority: newPriority,
                    updatedAt: serverTimestamp()
                });
                debugLog('✅ Task priority updated:', task.id, newPriority);
            } catch (error) {
                const path = `teams/${appState.currentTeamId}/tasks/${task.id}`;
                logFirestoreError('updateTaskPriority', path, { priority: newPriority }, {
                    uid: currentAuthUser?.uid,
                    teamId: appState.currentTeamId,
                    taskId: task.id,
                    taskCreatedBy: task.createdBy,
                    taskAssignee: task.assignee,
                    userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
                }, error);
                task.priority = oldPriority;
            }
        }
        
        saveToLocalStorage('tasks', appState.tasks);
    }

    // ===================================
    // INLINE ASSIGNEE EDITING
    // Teammate dropdown similar to chat mentions
    // ===================================
    function initInlineAssigneeEditing(container) {
        container.querySelectorAll('.assignee-cell-inline').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = cell.dataset.taskId;
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                // Close any existing dropdowns
                closeAllInlineDropdowns();
                
                // Create and show dropdown
                showAssigneeDropdown(cell, task);
            });
        });
    }
    
    function showAssigneeDropdown(cell, task) {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-edit-dropdown assignee-dropdown';
        
        let optionsHTML = `
            <div class="inline-dropdown-option ${!task.assigneeId ? 'active' : ''}" data-value="">
                <div class="assignee-option-avatar" style="background: #8E8E93">?</div>
                <span>Unassigned</span>
                ${!task.assigneeId ? '<i class="fas fa-check"></i>' : ''}
            </div>
        `;
        
        appState.teammates.forEach(member => {
            const isActive = task.assigneeId === member.id;
            const initials = (member.name || member.email || '?').substring(0, 1).toUpperCase();
            const color = member.avatarColor || '#0070f3';
            optionsHTML += `
                <div class="inline-dropdown-option ${isActive ? 'active' : ''}" data-value="${member.id}" data-name="${escapeHtml(member.name || member.email)}">
                    <div class="assignee-option-avatar" style="background: ${color}">${initials}</div>
                    <span>${escapeHtml(member.name || member.email)}</span>
                    ${isActive ? '<i class="fas fa-check"></i>' : ''}
                </div>
            `;
        });
        
        dropdown.innerHTML = optionsHTML;
        
        // Position dropdown
        positionInlineDropdown(dropdown, cell);
        document.body.appendChild(dropdown);
        
        // Add animation class
        requestAnimationFrame(() => dropdown.classList.add('visible'));
        
        // Handle option selection
        dropdown.querySelectorAll('.inline-dropdown-option').forEach(option => {
            option.addEventListener('click', async () => {
                const newAssigneeId = option.dataset.value;
                const newAssigneeName = option.dataset.name || '';
                await updateTaskAssignee(task, newAssigneeId, newAssigneeName, cell);
                closeAllInlineDropdowns();
            });
        });
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnOutsideClick);
        }, 10);
    }
    
    async function updateTaskAssignee(task, newAssigneeId, newAssigneeName, cell) {
        const oldAssigneeId = task.assigneeId;
        if (oldAssigneeId === newAssigneeId) return;
        
        // Update local state
        task.assigneeId = newAssigneeId || null;
        task.assignee = newAssigneeName || 'Unassigned';
        
        // Update cell visual
        const assignee = appState.teammates.find(m => m.id === newAssigneeId) || {};
        const fullName = newAssigneeName || 'Unassigned';
        const firstName = fullName.split(' ')[0];
        const initials = firstName.substring(0, 1).toUpperCase();
        const color = assignee.avatarColor || '#8E8E93';
        
        cell.innerHTML = `
            <div class="assignee-avatar" style="background: ${color}">${initials}</div>
            <span class="assignee-name">${escapeHtml(firstName)}</span>
        `;
        cell.title = fullName;
        
        // Show save feedback
        showInlineSaveFeedback(cell.closest('td'));
        
        // Save to Firestore
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(task.id));
                await updateDoc(taskRef, { 
                    assigneeId: newAssigneeId || null,
                    assignee: newAssigneeName || 'Unassigned',
                    updatedAt: serverTimestamp()
                });
                debugLog('✅ Task assignee updated:', task.id, newAssigneeName);
            } catch (error) {
                const path = `teams/${appState.currentTeamId}/tasks/${task.id}`;
                logFirestoreError('updateTaskAssignee', path, { assigneeId: newAssigneeId, assignee: newAssigneeName }, {
                    uid: currentAuthUser?.uid,
                    teamId: appState.currentTeamId,
                    taskId: task.id,
                    taskCreatedBy: task.createdBy,
                    userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
                }, error);
                task.assigneeId = oldAssigneeId;
            }
        }
        
        saveToLocalStorage('tasks', appState.tasks);
    }

    // ===================================
    // INLINE EDIT HELPERS
    // ===================================
    function positionInlineDropdown(dropdown, trigger) {
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        
        // Default: position below
        let top = rect.bottom + 4;
        let left = rect.left;
        
        // Check if dropdown would go off bottom of screen
        const dropdownHeight = 150; // estimated
        if (top + dropdownHeight > viewportHeight - 20) {
            top = rect.top - dropdownHeight - 4;
        }
        
        // Check if dropdown would go off right of screen
        const dropdownWidth = 180;
        if (left + dropdownWidth > viewportWidth - 20) {
            left = viewportWidth - dropdownWidth - 20;
        }
        
        dropdown.style.position = 'fixed';
        dropdown.style.top = top + 'px';
        dropdown.style.left = left + 'px';
        dropdown.style.zIndex = '100001';
    }
    
    function closeAllInlineDropdowns() {
        document.querySelectorAll('.inline-edit-dropdown').forEach(d => d.remove());
        document.removeEventListener('click', closeDropdownOnOutsideClick);
    }
    
    function closeDropdownOnOutsideClick(e) {
        if (!e.target.closest('.inline-edit-dropdown') && !e.target.closest('.priority-badge-inline') && !e.target.closest('.assignee-cell-inline') && !e.target.closest('.custom-dropdown-cell')) {
            closeAllInlineDropdowns();
        }
    }
    
    // ===================================
    // INLINE EDITING: Custom Columns
    // ===================================
    function initCustomColumnEditing(container, spreadsheet) {
        if (!spreadsheet?.customColumns?.length) return;
        
        // Custom Dropdown cells
        container.querySelectorAll('.custom-dropdown-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = cell.dataset.taskId;
                const columnId = cell.dataset.columnId;
                const task = appState.tasks.find(t => t.id === taskId);
                const customCol = spreadsheet.customColumns.find(cc => cc.id === columnId);
                if (!task || !customCol) return;
                
                closeAllInlineDropdowns();
                showCustomDropdown(cell, task, customCol);
            });
        });
        
        // Custom Slider cells with color ranges
        container.querySelectorAll('.custom-slider-cell').forEach(cell => {
            const taskId = cell.dataset.taskId;
            const columnId = cell.dataset.columnId;
            const slider = cell.querySelector('.custom-slider-input');
            const valueBadge = cell.querySelector('.custom-slider-badge') || cell.querySelector('.custom-slider-value');
            
            if (!slider || !taskId || !columnId) return;
            
            const customCol = spreadsheet.customColumns.find(cc => cc.id === columnId);
            if (!customCol) return;
            
            const min = customCol.min || 0;
            const max = customCol.max || 100;
            const colorRanges = customCol.colorRanges || [];
            
            // Helper to get color for a value
            function getSliderColor(val) {
                for (const range of colorRanges) {
                    if (val >= range.min && val <= range.max) {
                        return range.color;
                    }
                }
                return '#9CA3AF';
            }
            
            slider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                valueBadge.textContent = value;
                const pct = ((value - min) / (max - min)) * 100;
                slider.style.setProperty('--progress', pct + '%');
                
                // Update color based on ranges
                const color = getSliderColor(value);
                slider.style.setProperty('--slider-color', color);
                valueBadge.style.background = color;
            });
            
            slider.addEventListener('change', async (e) => {
                const newValue = parseInt(e.target.value);
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                if (!task.customFields) task.customFields = {};
                task.customFields[columnId] = newValue;
                
                showInlineSaveFeedback(cell.closest('td'));
                
                await saveCustomFieldValue(taskId, columnId, newValue);
            });
        });
        
        // Custom Number cells
        container.querySelectorAll('.custom-number-input').forEach(input => {
            const taskId = input.dataset.taskId;
            const columnId = input.dataset.columnId;
            if (!taskId || !columnId) return;
            
            input.addEventListener('blur', async () => {
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                const newValue = input.value ? parseFloat(input.value) : null;
                if (!task.customFields) task.customFields = {};
                
                if (task.customFields[columnId] === newValue) return;
                
                task.customFields[columnId] = newValue;
                showInlineSaveFeedback(input.closest('td'));
                await saveCustomFieldValue(taskId, columnId, newValue);
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
        });
        
        // Custom Text cells - click to edit
        container.querySelectorAll('.custom-text-cell').forEach(cell => {
            const taskId = cell.dataset.taskId;
            const columnId = cell.dataset.columnId;
            if (!taskId || !columnId) return;
            
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                if (cell.querySelector('.custom-text-input')) return; // Already editing
                
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                const currentValue = task.customFields?.[columnId] || '';
                const valueSpan = cell.querySelector('.custom-text-value');
                
                // Create input
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'custom-text-input';
                input.value = currentValue;
                input.placeholder = 'Enter text...';
                
                // Replace value span with input
                if (valueSpan) valueSpan.style.display = 'none';
                cell.appendChild(input);
                input.focus();
                input.select();
                
                // Save on blur
                input.addEventListener('blur', async () => {
                    const newValue = input.value.trim();
                    if (!task.customFields) task.customFields = {};
                    
                    task.customFields[columnId] = newValue || null;
                    
                    // Update display
                    if (valueSpan) {
                        valueSpan.innerHTML = newValue ? escapeHtml(newValue) : '<span class="text-placeholder">—</span>';
                        valueSpan.style.display = '';
                    }
                    input.remove();
                    
                    showInlineSaveFeedback(cell.closest('td'));
                    await saveCustomFieldValue(taskId, columnId, newValue || null);
                });
                
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur();
                    } else if (e.key === 'Escape') {
                        if (valueSpan) valueSpan.style.display = '';
                        input.remove();
                    }
                });
            });
        });
        
        // Custom Link cells - click to edit
        container.querySelectorAll('.custom-link-cell').forEach(cell => {
            const taskId = cell.dataset.taskId;
            const columnId = cell.dataset.columnId;
            if (!taskId || !columnId) return;
            
            // Click on empty cell or edit button to edit link
            const handleEditLink = (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                const task = appState.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                const currentUrl = task.customFields?.[columnId] || '';
                showLinkInputPopup(cell, task, columnId, currentUrl);
            };
            
            // Empty cell click
            if (cell.classList.contains('empty')) {
                cell.addEventListener('click', handleEditLink);
            }
            
            // Edit button click
            const editBtn = cell.querySelector('.link-edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', handleEditLink);
            }
        });
    }
    
    // Show link input popup for editing URLs
    function showLinkInputPopup(cell, task, columnId, currentUrl) {
        // Close any existing popup
        document.querySelectorAll('.link-input-popup').forEach(p => p.remove());
        
        const popup = document.createElement('div');
        popup.className = 'link-input-popup';
        popup.innerHTML = `
            <input type="url" placeholder="https://example.com" value="${escapeHtml(currentUrl)}">
            <div class="link-input-actions">
                <button class="link-cancel-btn">Cancel</button>
                <button class="link-save-btn">Save</button>
            </div>
        `;
        
        // Position popup
        const rect = cell.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.top = (rect.bottom + 5) + 'px';
        popup.style.left = rect.left + 'px';
        
        document.body.appendChild(popup);
        
        const input = popup.querySelector('input');
        input.focus();
        input.select();
        
        const saveLink = async () => {
            const newUrl = input.value.trim();
            if (!task.customFields) task.customFields = {};
            
            task.customFields[columnId] = newUrl || null;
            popup.remove();
            
            // Re-render the table to show updated link
            if (appState.currentSpreadsheet) {
                renderSpreadsheetTable(appState.currentSpreadsheet);
            }
            
            await saveCustomFieldValue(task.id, columnId, newUrl || null);
        };
        
        popup.querySelector('.link-save-btn').addEventListener('click', saveLink);
        popup.querySelector('.link-cancel-btn').addEventListener('click', () => popup.remove());
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveLink();
            } else if (e.key === 'Escape') {
                popup.remove();
            }
        });
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target) && !cell.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 10);
    }
    
    function showCustomDropdown(cell, task, customCol) {
        const dropdown = document.createElement('div');
        dropdown.className = 'inline-edit-dropdown custom-col-dropdown';
        
        const currentValue = task.customFields?.[customCol.id] || '';
        
        // Build options HTML with color support
        let optionsHTML = `
            <div class="inline-dropdown-option ${!currentValue ? 'active' : ''}" data-value="">
                <span>—</span>
                ${!currentValue ? '<i class="fas fa-check"></i>' : ''}
            </div>
        `;
        
        (customCol.options || []).forEach(opt => {
            // Support both old string format and new object format with colors
            const label = typeof opt === 'string' ? opt : opt.label;
            const color = typeof opt === 'string' ? '#9CA3AF' : (opt.color || '#9CA3AF');
            const isActive = currentValue === label;
            optionsHTML += `
                <div class="inline-dropdown-option ${isActive ? 'active' : ''}" data-value="${escapeHtml(label)}" data-color="${color}">
                    <span class="option-color-dot" style="background: ${color}"></span>
                    <span>${escapeHtml(label)}</span>
                    ${isActive ? '<i class="fas fa-check"></i>' : ''}
                </div>
            `;
        });
        
        dropdown.innerHTML = optionsHTML;
        
        positionInlineDropdown(dropdown, cell);
        document.body.appendChild(dropdown);
        
        requestAnimationFrame(() => dropdown.classList.add('visible'));
        
        dropdown.querySelectorAll('.inline-dropdown-option').forEach(option => {
            option.addEventListener('click', async () => {
                const newValue = option.dataset.value || null;
                const newColor = option.dataset.color || '#9CA3AF';
                await updateCustomDropdownValue(task, customCol.id, newValue, newColor, cell, customCol);
                closeAllInlineDropdowns();
            });
        });
        
        setTimeout(() => {
            document.addEventListener('click', closeDropdownOnOutsideClick);
        }, 10);
    }
    
    async function updateCustomDropdownValue(task, columnId, newValue, newColor, cell, customCol) {
        if (!task.customFields) task.customFields = {};
        
        const oldValue = task.customFields[columnId];
        if (oldValue === newValue) return;
        
        task.customFields[columnId] = newValue;
        
        // Update cell visual with colored pill
        const dropdownCell = cell.querySelector('.custom-dropdown-cell') || cell;
        if (newValue) {
            // Find color from options if not provided
            let color = newColor || '#9CA3AF';
            if (customCol && customCol.options) {
                const opt = customCol.options.find(o => 
                    (typeof o === 'string' ? o : o.label) === newValue
                );
                if (opt && typeof opt === 'object') {
                    color = opt.color || color;
                }
            }
            
            // Replace content with colored pill
            const existingPill = dropdownCell.querySelector('.custom-dropdown-pill');
            const existingValue = dropdownCell.querySelector('.custom-dropdown-value');
            
            const pillHTML = `<span class="custom-dropdown-pill" style="background: ${color}20; color: ${color}">
                <span class="pill-dot" style="background: ${color}"></span>
                ${escapeHtml(newValue)}
            </span>`;
            
            if (existingPill) {
                existingPill.outerHTML = pillHTML;
            } else if (existingValue) {
                existingValue.outerHTML = pillHTML;
            }
        } else {
            // Empty value - show placeholder
            const existingPill = dropdownCell.querySelector('.custom-dropdown-pill');
            if (existingPill) {
                existingPill.outerHTML = `<span class="custom-dropdown-value">—</span>`;
            } else {
                const existingValue = dropdownCell.querySelector('.custom-dropdown-value');
                if (existingValue) existingValue.textContent = '—';
            }
        }
        
        showInlineSaveFeedback(cell.closest('td'));
        
        await saveCustomFieldValue(task.id, columnId, newValue);
    }
    
    async function saveCustomFieldValue(taskId, columnId, value) {
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(taskId));
                await updateDoc(taskRef, { 
                    [`customFields.${columnId}`]: value 
                });
                debugLog('✅ Custom field updated:', taskId, columnId, value);
            } catch (error) {
                console.error('Error updating custom field:', error);
            }
        }
        
        saveToLocalStorage('tasks', appState.tasks);
    }

    function showInlineSaveFeedback(cell) {
        if (!cell) return;
        
        // Add saved indicator
        const indicator = document.createElement('span');
        indicator.className = 'inline-save-indicator';
        indicator.innerHTML = '<i class="fas fa-check"></i>';
        cell.style.position = 'relative';
        cell.appendChild(indicator);
        
        // Animate and remove
        requestAnimationFrame(() => {
            indicator.classList.add('visible');
            setTimeout(() => {
                indicator.classList.remove('visible');
                setTimeout(() => indicator.remove(), 200);
            }, 800);
        });
    }

    // Update row selection visuals
    function updateRowSelections() {
        const tableContainer = document.getElementById('tableContainer');
        if (!tableContainer) return;

        tableContainer.querySelectorAll('[data-task-checkbox]').forEach(cb => {
            const taskId = cb.dataset.taskCheckbox;
            const isSelected = spreadsheetState.selectedTasks.has(taskId);
            cb.checked = isSelected;
            cb.closest('tr').classList.toggle('selected', isSelected);
        });
    }

    // Update batch actions bar visibility
    function updateBatchActionsBar() {
        const bar = document.getElementById('batchActionsBar');
        const countEl = document.getElementById('selectedCount');
        const labelEl = document.getElementById('selectedItemsLabel');
        if (!bar || !countEl) return;

        const count = spreadsheetState.selectedTasks.size;
        countEl.textContent = count;
        
        // Update label based on spreadsheet type
        if (labelEl) {
            const isLeads = appState.currentSpreadsheet?.type === 'leads';
            labelEl.textContent = isLeads ? 'leads' : 'tasks';
        }
        
        bar.classList.toggle('active', count > 0);
    }

    // Helper: get tasks for a specific spreadsheet
    function getTasksForSpreadsheet(spreadsheet) {
        if (!spreadsheet || spreadsheet.id === 'default') {
            // "All Tasks" shows all tasks EXCEPT leads (leads have different presets)
            // Get all spreadsheet IDs that are of type 'leads'
            const leadsSpreadsheetIds = (appState.spreadsheets || [])
                .filter(s => s.type === 'leads')
                .map(s => s.id);
            
            // Filter out tasks that belong to leads spreadsheets
            return appState.tasks.filter(t => !leadsSpreadsheetIds.includes(t.spreadsheetId));
        }
        // Other spreadsheets only show tasks assigned to them
        return appState.tasks.filter(t => t.spreadsheetId === spreadsheet.id);
    }

    // Get filtered and sorted tasks for the current spreadsheet
    function getFilteredAndSortedTasks() {
        // Start with tasks for current spreadsheet
        let tasks = getTasksForSpreadsheet(appState.currentSpreadsheet);

        // Apply search
        if (spreadsheetState.searchQuery) {
            const query = spreadsheetState.searchQuery.toLowerCase();
            tasks = tasks.filter(t => 
                t.title.toLowerCase().includes(query) ||
                (t.description && t.description.toLowerCase().includes(query)) ||
                (t.assignee && t.assignee.toLowerCase().includes(query))
            );
        }

        // Apply filters
        if (spreadsheetState.filters.status) {
            tasks = tasks.filter(t => t.status === spreadsheetState.filters.status);
        }
        if (spreadsheetState.filters.priority) {
            tasks = tasks.filter(t => t.priority === spreadsheetState.filters.priority);
        }
        if (spreadsheetState.filters.assignee) {
            tasks = tasks.filter(t => t.assigneeId === spreadsheetState.filters.assignee);
        }

        // Always sort by closest due date
        tasks.sort((a, b) => {
            const aVal = a.dueDate || Infinity;
            const bVal = b.dueDate || Infinity;
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        });

        return tasks;
    }

    // Render individual table cell
    // Updated for FULL inline editing support (all fields)
    function renderTableCell(task, column, spreadsheet) {
        // Check if this is a custom column
        if (column.startsWith('custom_')) {
            const customCol = (spreadsheet?.customColumns || []).find(cc => cc.id === column);
            if (!customCol) return `<td>—</td>`;
            
            const value = task.customFields?.[column];
            
            switch (customCol.type) {
                case 'dropdown':
                    // Find the option with color (supports both old string format and new object format)
                    const displayValue = value || '—';
                    let optionColor = '#9CA3AF'; // default grey
                    if (value && customCol.options) {
                        const option = customCol.options.find(opt => 
                            (typeof opt === 'string' ? opt : opt.label) === value
                        );
                        if (option && typeof option === 'object') {
                            optionColor = option.color || '#9CA3AF';
                        }
                    }
                    // Render colored pill with dot indicator
                    const hasValue = value && value !== '—';
                    return `<td class="cell-editable">
                        <div class="custom-dropdown-cell" data-task-id="${task.id}" data-column-id="${column}">
                            ${hasValue 
                                ? `<span class="custom-dropdown-pill" style="background: ${optionColor}20; color: ${optionColor}">
                                    <span class="pill-dot" style="background: ${optionColor}"></span>
                                    ${escapeHtml(displayValue)}
                                   </span>`
                                : `<span class="custom-dropdown-value">${escapeHtml(displayValue)}</span>`
                            }
                            <i class="fas fa-chevron-down custom-dropdown-icon"></i>
                        </div>
                    </td>`;
                
                case 'slider':
                    const sliderValue = value !== undefined ? value : customCol.min || 0;
                    const min = customCol.min || 0;
                    const max = customCol.max || 100;
                    const pct = ((sliderValue - min) / (max - min)) * 100;
                    
                    // Find color based on ranges
                    let sliderColor = '#9CA3AF'; // default grey
                    if (customCol.colorRanges && customCol.colorRanges.length > 0) {
                        for (const range of customCol.colorRanges) {
                            if (sliderValue >= range.min && sliderValue <= range.max) {
                                sliderColor = range.color;
                                break;
                            }
                        }
                    }
                    
                    return `<td class="cell-editable">
                        <div class="custom-slider-cell" data-task-id="${task.id}" data-column-id="${column}" data-color-ranges='${JSON.stringify(customCol.colorRanges || [])}'>
                            <input type="range" class="progress-range-slider custom-slider-input" min="${min}" max="${max}" value="${sliderValue}" style="--progress: ${pct}%; --slider-color: ${sliderColor}">
                            <span class="custom-slider-badge" style="background: ${sliderColor}">${sliderValue}</span>
                        </div>
                    </td>`;
                
                case 'number':
                    const numValue = value !== undefined ? value : '';
                    return `<td class="cell-editable">
                        <input type="number" class="custom-number-input" data-task-id="${task.id}" data-column-id="${column}" value="${numValue}" placeholder="—">
                    </td>`;
                
                case 'text':
                    const textValue = value || '';
                    return `<td class="cell-editable">
                        <div class="custom-text-cell" data-task-id="${task.id}" data-column-id="${column}">
                            <span class="custom-text-value">${textValue ? escapeHtml(textValue) : '<span class="text-placeholder">—</span>'}</span>
                        </div>
                    </td>`;
                
                case 'link':
                    const linkValue = value || '';
                    if (linkValue) {
                        // Extract domain for display
                        let displayText = linkValue;
                        try {
                            const url = new URL(linkValue);
                            displayText = url.hostname.replace('www.', '');
                        } catch (e) {
                            displayText = linkValue.substring(0, 20) + (linkValue.length > 20 ? '...' : '');
                        }
                        return `<td class="cell-editable">
                            <div class="custom-link-cell" data-task-id="${task.id}" data-column-id="${column}" data-url="${escapeHtml(linkValue)}">
                                <a href="${escapeHtml(linkValue)}" target="_blank" rel="noopener noreferrer" class="custom-link-pill" onclick="event.stopPropagation()">
                                    <i class="fas fa-external-link-alt"></i>
                                    <span>${escapeHtml(displayText)}</span>
                                </a>
                                <button class="link-edit-btn" title="Edit link">
                                    <i class="fas fa-pen"></i>
                                </button>
                            </div>
                        </td>`;
                    }
                    return `<td class="cell-editable">
                        <div class="custom-link-cell empty" data-task-id="${task.id}" data-column-id="${column}">
                            <span class="link-placeholder">+ Add link</span>
                        </div>
                    </td>`;
                
                default:
                    return `<td>—</td>`;
            }
        }
        
        switch (column) {
            case 'title':
                // INLINE EDITABLE: Click to edit title directly
                return `<td class="cell-title-editable cell-editable" data-task-id="${task.id}">${escapeHtml(task.title)}</td>`;
            
            case 'status':
                // Check for custom settings with colors
                const statusSettings = spreadsheet?.columnSettings?.status;
                if (statusSettings?.options && statusSettings.options.length > 0) {
                    // Use custom dropdown rendering with colors
                    // For leads, status is stored directly (New, Contacted, etc.)
                    // For tasks, status uses codes (todo, inprogress, done)
                    const taskStatusMap = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
                    const statusValue = taskStatusMap[task.status] || task.status;
                    const statusOption = statusSettings.options.find(opt => opt.label === statusValue);
                    const statusColor = statusOption?.color || '#9CA3AF';
                    return `<td class="cell-editable">
                        <div class="custom-dropdown-cell built-in-dropdown" data-task-id="${task.id}" data-column-id="status">
                            <span class="custom-dropdown-pill" style="background: ${statusColor}20; color: ${statusColor}">
                                <span class="pill-dot" style="background: ${statusColor}"></span>
                                ${escapeHtml(statusValue)}
                            </span>
                            <i class="fas fa-chevron-down custom-dropdown-icon"></i>
                        </div>
                    </td>`;
                }
                // Default status rendering (task mode)
                const statusClass = task.status;
                const statusLabel = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' }[task.status] || task.status;
                return `<td><span class="status-badge ${statusClass}"><span class="dot"></span>${statusLabel}</span></td>`;
            
            case 'assignee':
                // INLINE EDITABLE: Assignee cell with click-to-edit
                const assignee = appState.teammates.find(m => m.id === task.assigneeId) || {};
                const fullName = task.assignee || 'Unassigned';
                const firstName = fullName.split(' ')[0];
                const initials = firstName.substring(0, 1).toUpperCase();
                const color = assignee.avatarColor || '#8E8E93';
                return `<td class="cell-editable"><div class="assignee-cell assignee-cell-inline" data-task-id="${task.id}" title="${escapeHtml(fullName)}"><div class="assignee-avatar" style="background: ${color}">${initials}</div><span class="assignee-name">${escapeHtml(firstName)}</span></div></td>`;
            
            case 'priority':
                // Check for custom settings with colors
                const prioritySettings = spreadsheet?.columnSettings?.priority;
                if (prioritySettings?.options && prioritySettings.options.length > 0) {
                    // Use custom dropdown rendering with colors
                    const priorityValue = (task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1);
                    const priorityOption = prioritySettings.options.find(opt => opt.label.toLowerCase() === (task.priority || 'medium'));
                    const priorityColor = priorityOption?.color || '#9CA3AF';
                    return `<td class="cell-editable">
                        <div class="custom-dropdown-cell built-in-dropdown" data-task-id="${task.id}" data-column-id="priority">
                            <span class="custom-dropdown-pill" style="background: ${priorityColor}20; color: ${priorityColor}">
                                <span class="pill-dot" style="background: ${priorityColor}"></span>
                                ${escapeHtml(priorityValue)}
                            </span>
                            <i class="fas fa-chevron-down custom-dropdown-icon"></i>
                        </div>
                    </td>`;
                }
                // Default priority rendering
                const priorityClass = task.priority || 'medium';
                const priorityLabel = (task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1);
                return `<td class="cell-editable"><span class="priority-badge priority-badge-inline ${priorityClass}" data-task-id="${task.id}">${priorityLabel}</span></td>`;
            
            case 'dueDate':
                // INLINE EDITABLE: Click to edit date
                if (!task.dueDate) {
                    return `<td class="cell-date-editable cell-editable date-cell" data-task-id="${task.id}">—</td>`;
                }
                const date = new Date(task.dueDate);
                const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dueDate = new Date(date);
                dueDate.setHours(0, 0, 0, 0);
                const diff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                let chipClass = '';
                if (task.status !== 'done') {
                    if (diff < 0) {
                        chipClass = 'date-chip-overdue';
                    } else if (diff === 0) {
                        chipClass = 'date-chip-today';
                    } else if (diff === 1) {
                        chipClass = 'date-chip-tomorrow';
                    } else if (diff === 2) {
                        chipClass = 'date-chip-soon';
                    }
                }
                const chipHtml = chipClass ? `<span class="date-chip ${chipClass}">${formatted}</span>` : formatted;
                return `<td class="cell-date-editable cell-editable date-cell" data-task-id="${task.id}">${chipHtml}</td>`;
            
            case 'progress':
                // Check for custom settings with color ranges
                const progressSettings = spreadsheet?.columnSettings?.progress;
                const progress = task.progress || (task.status === 'done' ? 100 : task.status === 'inprogress' ? 50 : 0);
                
                if (progressSettings?.colorRanges && progressSettings.colorRanges.length > 0) {
                    // Use custom slider rendering with color ranges
                    const pMin = progressSettings.min || 0;
                    const pMax = progressSettings.max || 100;
                    const pPct = ((progress - pMin) / (pMax - pMin)) * 100;
                    
                    // Find color based on ranges
                    let progressColor = '#9CA3AF';
                    for (const range of progressSettings.colorRanges) {
                        if (progress >= range.min && progress <= range.max) {
                            progressColor = range.color;
                            break;
                        }
                    }
                    
                    return `<td class="cell-editable">
                        <div class="custom-slider-cell" data-task-id="${task.id}" data-column-id="progress" data-color-ranges='${JSON.stringify(progressSettings.colorRanges)}'>
                            <input type="range" class="progress-range-slider custom-slider-input" min="${pMin}" max="${pMax}" value="${progress}" style="--progress: ${pPct}%; --slider-color: ${progressColor}">
                            <span class="custom-slider-badge" style="background: ${progressColor}">${progress}%</span>
                        </div>
                    </td>`;
                }
                
                // Default progress rendering
                const completeClass = progress === 100 ? 'complete' : '';
                return `<td class="cell-editable"><div class="progress-cell-inline" data-task-id="${task.id}"><input type="range" class="progress-range-slider ${completeClass}" min="0" max="100" value="${progress}" style="--progress: ${progress}%"><span class="progress-text">${progress}%</span></div></td>`;
            
            case 'budget':
                // INLINE EDITABLE: Click to edit budget
                return `<td class="cell-budget-editable cell-editable budget-cell" data-task-id="${task.id}">${task.budget ? '$' + parseFloat(task.budget).toFixed(2) : '—'}</td>`;
            
            case 'estimatedTime':
                // INLINE EDITABLE: Click to edit estimated time
                return `<td class="cell-time-editable cell-editable" data-task-id="${task.id}">${task.estimatedTime ? task.estimatedTime + 'h' : '—'}</td>`;
            
            // ===================================
            // LEADS COLUMNS
            // ===================================
            case 'leadName':
                // INLINE EDITABLE: Click to edit lead name directly
                return `<td class="cell-title-editable cell-editable" data-task-id="${task.id}">${escapeHtml(task.leadName || task.title || '')}</td>`;
            
            case 'source':
                // Lead source - check for custom settings with colors
                const sourceSettings = spreadsheet?.columnSettings?.source;
                if (sourceSettings?.options && sourceSettings.options.length > 0) {
                    // Use custom dropdown rendering with colors
                    const sourceValue = task.source || '—';
                    const sourceOption = sourceSettings.options.find(opt => opt.label === sourceValue);
                    const sourceColor = sourceOption?.color || '#9CA3AF';
                    const hasValue = sourceValue && sourceValue !== '—';
                    return `<td class="cell-editable">
                        <div class="custom-dropdown-cell built-in-dropdown" data-task-id="${task.id}" data-column-id="source">
                            ${hasValue 
                                ? `<span class="custom-dropdown-pill" style="background: ${sourceColor}20; color: ${sourceColor}">
                                    <span class="pill-dot" style="background: ${sourceColor}"></span>
                                    ${escapeHtml(sourceValue)}
                                   </span>`
                                : `<span class="custom-dropdown-value">${escapeHtml(sourceValue)}</span>`
                            }
                            <i class="fas fa-chevron-down custom-dropdown-icon"></i>
                        </div>
                    </td>`;
                }
                // Default text rendering
                return `<td class="cell-source-editable cell-editable" data-task-id="${task.id}">${escapeHtml(task.source || '—')}</td>`;
            
            case 'value':
                // Lead value (monetary) - inline editable
                return `<td class="cell-value-editable cell-editable value-cell" data-task-id="${task.id}">${task.value ? '$' + parseFloat(task.value).toLocaleString() : '—'}</td>`;
            
            case 'contact':
                // Contact info - inline editable text
                return `<td class="cell-contact-editable cell-editable" data-task-id="${task.id}">${escapeHtml(task.contact || '—')}</td>`;
            
            case 'createdAt':
                // Created date - readonly
                if (!task.createdAt) {
                    return `<td class="date-cell">—</td>`;
                }
                const createdDate = new Date(task.createdAt);
                const createdFormatted = createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return `<td class="date-cell">${createdFormatted}</td>`;
            
            case 'notes':
                // Notes - inline editable text
                return `<td class="cell-notes-editable cell-editable" data-task-id="${task.id}">${escapeHtml(task.notes || '—')}</td>`;
            
            default:
                return `<td>—</td>`;
        }
    }

    // Get column label
    function getColumnLabel(column, spreadsheet) {
        // Check for custom column
        if (column.startsWith('custom_')) {
            const customCol = (spreadsheet?.customColumns || []).find(cc => cc.id === column);
            return customCol?.name || column;
        }
        
        // Check for custom settings on built-in columns
        const customSettings = spreadsheet?.columnSettings?.[column];
        if (customSettings?.label) {
            return customSettings.label;
        }
        
        const labels = {
            title: 'Title',
            status: 'Status',
            assignee: 'Assignee',
            priority: 'Priority',
            dueDate: 'Due Date',
            progress: 'Progress',
            budget: 'Budget',
            estimatedTime: 'Est. Time',
            // Leads columns
            leadName: 'Lead Name',
            source: 'Source',
            value: 'Value',
            contact: 'Contact',
            createdAt: 'Created',
            notes: 'Notes'
        };
        return labels[column] || column;
    }

    // Get column icon
    function getColumnIcon(column, spreadsheet) {
        // Check for custom column
        if (column.startsWith('custom_')) {
            const customCol = (spreadsheet?.customColumns || []).find(cc => cc.id === column);
            return customCol?.icon || 'fa-columns';
        }
        
        // Check for custom settings on built-in columns
        const customSettings = spreadsheet?.columnSettings?.[column];
        if (customSettings?.icon) {
            return customSettings.icon;
        }
        
        const icons = {
            title: 'fa-heading',
            status: 'fa-circle-notch',
            assignee: 'fa-user',
            priority: 'fa-flag',
            dueDate: 'fa-calendar',
            progress: 'fa-chart-line',
            budget: 'fa-dollar-sign',
            estimatedTime: 'fa-clock',
            // Leads columns
            leadName: 'fa-user-tie',
            source: 'fa-bullhorn',
            value: 'fa-hand-holding-dollar',
            contact: 'fa-address-book',
            createdAt: 'fa-calendar-plus',
            notes: 'fa-sticky-note'
        };
        return icons[column] || 'fa-columns';
    }

    // ===================================
    // BATCH ACTIONS
    // ===================================
    window.batchMarkDone = async function() {
        const taskIds = Array.from(spreadsheetState.selectedTasks);
        for (const taskId of taskIds) {
            await updateTaskStatus(taskId, 'done');
        }
        spreadsheetState.selectedTasks.clear();
        updateBatchActionsBar();
        showToast(`${taskIds.length} tasks marked as done`, 'success');
    };

    window.batchChangeStatus = function() {
        const statuses = ['todo', 'inprogress', 'done'];
        const statusLabels = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
        
        // Simple modal for status selection
        const html = `
            <div class="modal active" id="batchStatusModal">
                <div class="modal-content" style="max-width: 300px;">
                    <div class="modal-header">
                        <h2>Change Status</h2>
                        <button class="modal-close" onclick="closeModal('batchStatusModal')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>New Status</label>
                            <select id="batchStatusSelect">
                                ${statuses.map(s => `<option value="${s}">${statusLabels[s]}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModal('batchStatusModal')">Cancel</button>
                        <button class="btn-primary" onclick="applyBatchStatus()">Apply</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    };

    window.applyBatchStatus = async function() {
        const status = document.getElementById('batchStatusSelect').value;
        const taskIds = Array.from(spreadsheetState.selectedTasks);
        for (const taskId of taskIds) {
            await updateTaskStatus(taskId, status);
        }
        spreadsheetState.selectedTasks.clear();
        updateBatchActionsBar();
        closeModal('batchStatusModal');
        showToast(`${taskIds.length} tasks updated`, 'success');
    };

    window.batchDelete = async function() {
        const taskIds = Array.from(spreadsheetState.selectedTasks);
        if (!confirm(`Are you sure you want to delete ${taskIds.length} tasks?`)) return;
        
        for (const taskId of taskIds) {
            await deleteTask(taskId);
        }
        spreadsheetState.selectedTasks.clear();
        updateBatchActionsBar();
        showToast(`${taskIds.length} tasks deleted`, 'success');
    };

    window.clearSelection = function() {
        spreadsheetState.selectedTasks.clear();
        updateRowSelections();
        updateBatchActionsBar();
    };

    // ===================================
    // FILTER & SEARCH
    // ===================================
    window.applyFilters = function() {
        spreadsheetState.filters.status = document.getElementById('filterStatus').value;
        spreadsheetState.filters.priority = document.getElementById('filterPriority').value;
        spreadsheetState.filters.assignee = document.getElementById('filterAssignee').value;
        
        if (appState.currentSpreadsheet) {
            renderSpreadsheetTable(appState.currentSpreadsheet);
        }
        
        // Close dropdown
        document.getElementById('filterDropdown').classList.remove('active');
    };

    window.clearFilters = function() {
        spreadsheetState.filters = { status: '', priority: '', assignee: '' };
        spreadsheetState.searchQuery = '';
        
        document.getElementById('filterStatus').value = '';
        document.getElementById('filterPriority').value = '';
        document.getElementById('filterAssignee').value = '';
        
        const searchInput = document.getElementById('spreadsheetSearch');
        if (searchInput) searchInput.value = '';
        
        if (appState.currentSpreadsheet) {
            renderSpreadsheetTable(appState.currentSpreadsheet);
        }
        
        document.getElementById('filterDropdown').classList.remove('active');
    };

    function populateFilterAssigneeDropdown() {
        const select = document.getElementById('filterAssignee');
        if (!select) return;
        
        select.innerHTML = '<option value="">All</option>';
        appState.teammates.forEach(member => {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = member.displayName || member.email;
            select.appendChild(option);
        });
    }

    // Toggle task complete from checkbox
    window.toggleTaskComplete = function(taskId, isComplete) {
        updateTaskStatus(taskId, isComplete ? 'done' : 'todo');
    };

    // Edit task function
    window.editTask = function(task) {
        // Populate modal with task data for editing
        document.getElementById('taskTitle').value = task.title;
        document.getElementById('taskDescription').value = task.description || '';
        
        if (task.dueDate) {
            const date = new Date(task.dueDate);
            document.getElementById('taskDueDate').value = date.toISOString().split('T')[0];
        }
        
        document.getElementById('taskBudget').value = task.budget || '';
        document.getElementById('taskEstimatedTime').value = task.estimatedTime || '';
        
        // Set Show on Calendar toggle (default to true for backward compatibility)
        const showOnCalendarCheckbox = document.getElementById('taskShowOnCalendar');
        if (showOnCalendarCheckbox) {
            showOnCalendarCheckbox.checked = task.showOnCalendar !== false;
        }
        
        // Update progress bar (range slider + number input + fill + badge)
        const progressInput = document.getElementById('taskProgress');
        const progressSlider = document.getElementById('taskProgressSlider');
        const progressFill = document.getElementById('taskProgressFill');
        const progressBadge = document.getElementById('taskProgressBadge');
        if (progressInput) {
            const progress = task.progress || 0;
            progressInput.value = progress;
            if (progressSlider) {
                progressSlider.value = progress;
            }
            if (progressFill) {
                progressFill.style.width = progress + '%';
            }
            if (progressBadge) {
                progressBadge.textContent = progress + '%';
            }
        }

        populateTaskAssigneeDropdown();
        populateTaskSpreadsheetDropdown(task.spreadsheetId); // Populate and select current spreadsheet
        
        // Set custom dropdown values
        setTimeout(() => {
            // Set Assignee
            setCustomDropdownValue('taskAssignee', task.assigneeId || '', (value, option) => {
                const avatar = option?.querySelector('.dropdown-assignee-avatar');
                const name = option?.dataset.name || option?.querySelector('span')?.textContent || 'Unassigned';
                if (avatar) {
                    return `
                        <div class="dropdown-assignee-avatar" style="${avatar.getAttribute('style')}">${avatar.textContent}</div>
                        <span>${name}</span>
                    `;
                }
                return `<span class="dropdown-placeholder">Select...</span>`;
            });
            
            // Set Priority
            setCustomDropdownValue('taskPriority', task.priority || 'medium', (value, option) => {
                const label = option?.querySelector('span:not(.priority-dot)')?.textContent || value;
                return `
                    <span class="priority-dot ${value}"></span>
                    <span>${label}</span>
                `;
            });
            
            // Set Status
            setCustomDropdownValue('taskStatus', task.status || 'todo', (value, option) => {
                const label = option?.querySelector('span:not(.status-dot)')?.textContent || value;
                return `
                    <span class="status-dot ${value}"></span>
                    <span>${label}</span>
                `;
            });
        }, 100);
        
        // Update word counter
        const counter = document.getElementById('taskTitleCounter');
        if (counter) {
            const words = (task.title || '').split(/\s+/).filter(word => word.length > 0);
            counter.textContent = `${words.length}/20 words`;
            counter.classList.remove('warning', 'limit');
            if (words.length >= 20) {
                counter.classList.add('limit');
            } else if (words.length >= 15) {
                counter.classList.add('warning');
            }
        }

        // Store task ID for editing
        document.getElementById('taskForm').dataset.editingTaskId = task.id;
        const titleEl = document.querySelector('#taskModal .unified-modal-title h2');
        const submitBtn = document.querySelector('#taskModal .unified-btn-primary');
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-edit"></i> Edit Task';
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
        
        openModal('taskModal');
    };
    
    // Helper function to set custom dropdown value
    function setCustomDropdownValue(inputId, value, getTriggerContent) {
        const trigger = document.getElementById(inputId + 'Trigger');
        const menu = document.getElementById(inputId + 'Menu');
        const hiddenInput = document.getElementById(inputId);
        
        if (!trigger || !menu || !hiddenInput) return;
        
        hiddenInput.value = value;
        
        // Update active state
        menu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.classList.remove('active');
            const check = opt.querySelector('.fa-check');
            if (check) check.remove();
        });
        
        const selectedOption = menu.querySelector(`[data-value="${value}"]`);
        if (selectedOption) {
            selectedOption.classList.add('active');
            if (!selectedOption.querySelector('.fa-check')) {
                selectedOption.innerHTML += '<i class="fas fa-check"></i>';
            }
            
            // Update trigger content
            const triggerContent = trigger.querySelector('.dropdown-trigger-content') || trigger.querySelector('.unified-dropdown-value');
            if (getTriggerContent && triggerContent) {
                triggerContent.innerHTML = getTriggerContent(value, selectedOption);
            }
        }
    }

    // Make displayTasks available globally
    window.displayTasks = displayTasks;

    // Initialize spreadsheet modal
    function initSpreadsheetModal() {
        // Add back button handler for spreadsheet panel
        const backBtn = document.querySelector('.spreadsheet-panel .back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', window.closeSpreadsheetPanel);
        }

        // Handle title editing in spreadsheet panel
        const titleInput = document.querySelector('.spreadsheet-title-input');
        if (titleInput) {
            const saveSpreadsheetName = async () => {
                if (appState.currentSpreadsheet && titleInput.value.trim()) {
                    const newName = titleInput.value.trim();
                    
                    // Skip if name hasn't changed
                    if (appState.currentSpreadsheet.name === newName) return;
                    
                    appState.currentSpreadsheet.name = newName;
                    
                    // Also update in appState.spreadsheets array
                    const spreadsheetIndex = appState.spreadsheets.findIndex(s => s.id === appState.currentSpreadsheet.id);
                    if (spreadsheetIndex !== -1) {
                        appState.spreadsheets[spreadsheetIndex].name = newName;
                    }
                    
                    // Save to Firestore
                    try {
                        await saveSpreadsheetToFirestore(appState.currentSpreadsheet);
                        console.log('Spreadsheet name saved:', newName);
                    } catch (error) {
                        console.error('Failed to save spreadsheet name:', error);
                        showToast('Failed to save name', 'error');
                    }
                    
                    // Update cards
                    renderSpreadsheetCards();
                }
            };
            
            titleInput.addEventListener('change', saveSpreadsheetName);
            titleInput.addEventListener('blur', saveSpreadsheetName);
        }

        // Handle settings button
        const settingsBtn = document.querySelector('.spreadsheet-panel .panel-action-btn:not(.primary)');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                showToast('Settings coming soon!', 'info');
            });
        }

        // Create spreadsheet modal HTML dynamically - Unified Modern Style
        const modalHTML = `
            <div class="unified-modal" id="spreadsheetModal">
                <div class="unified-modal-container">
                    <div class="unified-modal-header">
                        <div class="unified-modal-title">
                            <h2><i class="fas fa-table-cells"></i> New Spreadsheet</h2>
                            <p class="subtitle">Create a new spreadsheet for your team</p>
                        </div>
                        <button class="unified-modal-close" onclick="closeModal('spreadsheetModal')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <form id="spreadsheetForm">
                        <div class="unified-modal-body">
                            <div class="unified-form-grid">
                                <!-- Name - Full Width -->
                                <div class="unified-form-field full-width">
                                    <label class="unified-form-label">
                                        Name <span class="required">*</span>
                                    </label>
                                    <input type="text" class="unified-input" id="spreadsheetName" placeholder="My Tasks" required>
                                </div>
                                
                                <!-- Type Selector - Full Width -->
                                <div class="unified-form-field full-width">
                                    <label class="unified-form-label">
                                        <i class="fas fa-shapes"></i> Type
                                    </label>
                                    <div class="unified-segmented" id="typeSelectRow">
                                        <button type="button" class="unified-segmented-option active" data-type="tasks">
                                            <i class="fas fa-tasks"></i>
                                            <span>Tasks</span>
                                        </button>
                                        <button type="button" class="unified-segmented-option" data-type="leads">
                                            <i class="fas fa-user-plus"></i>
                                            <span>Leads</span>
                                        </button>
                                    </div>
                                    <input type="hidden" id="spreadsheetType" value="tasks">
                                </div>
                                
                                <!-- Icon -->
                                <div class="unified-form-field">
                                    <label class="unified-form-label">
                                        <i class="fas fa-icons"></i> Icon
                                    </label>
                                    <div class="unified-icon-grid" id="iconSelectGrid">
                                        <button type="button" class="unified-icon-option selected" data-icon="fa-table"><i class="fas fa-table"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-list-check"><i class="fas fa-list-check"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-clipboard-list"><i class="fas fa-clipboard-list"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-folder"><i class="fas fa-folder"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-calendar"><i class="fas fa-calendar"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-star"><i class="fas fa-star"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-briefcase"><i class="fas fa-briefcase"></i></button>
                                        <button type="button" class="unified-icon-option" data-icon="fa-bolt"><i class="fas fa-bolt"></i></button>
                                    </div>
                                    <input type="hidden" id="spreadsheetIcon" value="fa-table">
                                </div>
                                
                                <!-- Color -->
                                <div class="unified-form-field">
                                    <label class="unified-form-label">
                                        <i class="fas fa-palette"></i> Color
                                    </label>
                                    <div class="unified-color-grid" id="colorSelectGrid">
                                        <button type="button" class="unified-color-option selected" data-color="#0070f3" style="background: #0070f3;"></button>
                                        <button type="button" class="unified-color-option" data-color="#34c759" style="background: #34c759;"></button>
                                        <button type="button" class="unified-color-option" data-color="#ff9500" style="background: #ff9500;"></button>
                                        <button type="button" class="unified-color-option" data-color="#ff3b30" style="background: #ff3b30;"></button>
                                        <button type="button" class="unified-color-option" data-color="#af52de" style="background: #af52de;"></button>
                                        <button type="button" class="unified-color-option" data-color="#5856d6" style="background: #5856d6;"></button>
                                        <button type="button" class="unified-color-option" data-color="#00c7be" style="background: #00c7be;"></button>
                                        <button type="button" class="unified-color-option" data-color="#ff2d55" style="background: #ff2d55;"></button>
                                    </div>
                                    <input type="hidden" id="spreadsheetColor" value="#0070f3">
                                </div>
                                
                                <!-- Visibility - Full Width -->
                                <div class="unified-form-field full-width">
                                    <label class="unified-form-label">
                                        <i class="fas fa-eye"></i> Visibility
                                    </label>
                                    <div class="unified-visibility-options">
                                        <label class="unified-visibility-option selected" data-visibility="team">
                                            <input type="radio" name="spreadsheetVisibility" value="team" checked>
                                            <div class="unified-visibility-icon"><i class="fas fa-users"></i></div>
                                            <div class="unified-visibility-text">
                                                <span class="unified-visibility-title">Team</span>
                                                <span class="unified-visibility-desc">Visible to all team members</span>
                                            </div>
                                        </label>
                                        <label class="unified-visibility-option" data-visibility="private">
                                            <input type="radio" name="spreadsheetVisibility" value="private">
                                            <div class="unified-visibility-icon"><i class="fas fa-lock"></i></div>
                                            <div class="unified-visibility-text">
                                                <span class="unified-visibility-title">Private</span>
                                                <span class="unified-visibility-desc">Only visible to you</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="unified-modal-footer">
                            <button type="button" class="unified-btn unified-btn-secondary" onclick="closeModal('spreadsheetModal')">Cancel</button>
                            <button type="submit" class="unified-btn unified-btn-primary">
                                <i class="fas fa-plus"></i> Create Spreadsheet
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        // Only add if doesn't exist
        if (!document.getElementById('spreadsheetModal')) {
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Handle icon selection
        const iconGrid = document.getElementById('iconSelectGrid');
        const iconInput = document.getElementById('spreadsheetIcon');
        if (iconGrid && iconInput) {
            iconGrid.addEventListener('click', (e) => {
                const btn = e.target.closest('.unified-icon-option');
                if (btn) {
                    iconGrid.querySelectorAll('.unified-icon-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    iconInput.value = btn.dataset.icon;
                }
            });
        }

        // Handle color selection
        const colorGrid = document.getElementById('colorSelectGrid');
        const colorInput = document.getElementById('spreadsheetColor');
        if (colorGrid && colorInput) {
            colorGrid.addEventListener('click', (e) => {
                const btn = e.target.closest('.unified-color-option');
                if (btn) {
                    colorGrid.querySelectorAll('.unified-color-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    colorInput.value = btn.dataset.color;
                }
            });
        }

        // Handle type selection
        const typeSelectRow = document.getElementById('typeSelectRow');
        const typeInput = document.getElementById('spreadsheetType');
        if (typeSelectRow && typeInput) {
            typeSelectRow.addEventListener('click', (e) => {
                const btn = e.target.closest('.unified-segmented-option');
                if (btn) {
                    typeSelectRow.querySelectorAll('.unified-segmented-option').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    typeInput.value = btn.dataset.type;
                    // Update placeholder based on type
                    const nameInput = document.getElementById('spreadsheetName');
                    if (nameInput) {
                        nameInput.placeholder = btn.dataset.type === 'leads' ? 'My Leads' : 'My Tasks';
                    }
                }
            });
        }

        // Handle visibility selection
        const visibilityOptions = document.querySelectorAll('.unified-visibility-option');
        visibilityOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                visibilityOptions.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
        });

        // Handle form submission
        const form = document.getElementById('spreadsheetForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const name = document.getElementById('spreadsheetName').value;
                const icon = document.getElementById('spreadsheetIcon').value;
                const color = document.getElementById('spreadsheetColor').value;
                const visibility = document.querySelector('input[name="spreadsheetVisibility"]:checked').value;
                const type = document.getElementById('spreadsheetType').value || 'tasks';

                if (!appState.spreadsheets) {
                    appState.spreadsheets = [];
                }

                // Use preset based on type
                const preset = type === 'leads' ? LEADS_TABLE_PRESET : TASKS_TABLE_PRESET;

                // Generate unique ID with type prefix for reliable type detection on reload
                // leads_ prefix allows type detection even if type field is lost
                const idPrefix = type === 'leads' ? 'leads_' : 'tasks_';
                const uniqueId = idPrefix + Date.now().toString();

                const newSpreadsheet = {
                    id: uniqueId,
                    name: name,
                    type: type, // 'tasks' or 'leads'
                    icon: icon,
                    color: color,
                    visibility: visibility,
                    createdBy: currentAuthUser?.uid || null,
                    columns: [...preset.columns],
                    columnSettings: JSON.parse(JSON.stringify(preset.columnSettings))
                    // Don't set createdAt here - let saveSpreadsheetToFirestore handle it with serverTimestamp()
                };

                appState.spreadsheets.push(newSpreadsheet);
                
                // Save to Firestore
                await saveSpreadsheetToFirestore(newSpreadsheet);
                
                renderSpreadsheetCards();
                
                // Reset form and selections
                form.reset();
                iconGrid.querySelectorAll('.icon-option').forEach((b, i) => b.classList.toggle('active', i === 0));
                colorGrid.querySelectorAll('.color-option').forEach((b, i) => b.classList.toggle('active', i === 0));
                typeSelectRow.querySelectorAll('.type-option').forEach((b, i) => b.classList.toggle('active', i === 0));
                visibilityOptions.forEach((o, i) => o.classList.toggle('active', i === 0));
                document.getElementById('spreadsheetIcon').value = 'fa-table';
                document.getElementById('spreadsheetColor').value = '#0070f3';
                document.getElementById('spreadsheetType').value = 'tasks';
                
                closeModal('spreadsheetModal');
                
                showToast(`Spreadsheet "${name}" created!`, 'success');
            });
        }
    }

    // Initialize spreadsheet panel handlers
    function initSpreadsheetPanelHandlers() {
        // Back button - use ID for reliable selection
        const backBtn = document.getElementById('spreadsheetBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.closeSpreadsheetPanel();
            });
        }

        // Title input
        const titleInput = document.querySelector('.spreadsheet-title-input');
        if (titleInput) {
            const saveSpreadsheetName = async () => {
                if (appState.currentSpreadsheet && titleInput.value.trim()) {
                    const newName = titleInput.value.trim();
                    appState.currentSpreadsheet.name = newName;
                    
                    // Also update in the spreadsheets array
                    const idx = appState.spreadsheets.findIndex(s => s.id === appState.currentSpreadsheet.id);
                    if (idx !== -1) {
                        appState.spreadsheets[idx].name = newName;
                    }
                    
                    await saveSpreadsheetToFirestore(appState.currentSpreadsheet);
                    renderSpreadsheetCards();
                }
            };
            titleInput.addEventListener('change', saveSpreadsheetName);
            titleInput.addEventListener('blur', saveSpreadsheetName);
        }

        // Filter button
        const filterBtn = document.getElementById('filterBtn');
        const filterDropdown = document.getElementById('filterDropdown');
        if (filterBtn && filterDropdown) {
            filterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!filterDropdown.contains(e.target) && e.target !== filterBtn) {
                    filterDropdown.classList.remove('active');
                }
            });
        }

        // Batch action buttons
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        const batchStatusBtn = document.getElementById('batchStatusBtn');
        
        if (batchDeleteBtn) {
            batchDeleteBtn.addEventListener('click', window.batchDelete);
        }
        if (batchStatusBtn) {
            batchStatusBtn.addEventListener('click', window.batchChangeStatus);
        }

        // Sidebar toggle (close button inside sidebar)
        const toggleSidebar = document.getElementById('toggleSidebar');
        const columnSidebar = document.getElementById('columnSidebar');
        const openSidebarBtn = document.getElementById('openSidebarBtn');
        
        function updateSidebarVisibility() {
            const isCollapsed = columnSidebar && columnSidebar.classList.contains('collapsed');
            if (openSidebarBtn) {
                openSidebarBtn.style.display = isCollapsed ? 'flex' : 'none';
            }
        }
        
        if (toggleSidebar && columnSidebar) {
            toggleSidebar.addEventListener('click', () => {
                columnSidebar.classList.add('collapsed');
                updateSidebarVisibility();
            });
        }
        
        if (openSidebarBtn && columnSidebar) {
            openSidebarBtn.addEventListener('click', () => {
                columnSidebar.classList.remove('collapsed');
                updateSidebarVisibility();
            });
        }
        
        // Initialize sidebar button visibility
        updateSidebarVisibility();

        // Settings button
        const settingsBtn = document.getElementById('spreadsheetSettingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                showToast('Settings coming soon!', 'info');
            });
        }
        
        // Add task/lead button in panel header
        const addTaskPanelBtn = document.getElementById('addTaskPanelBtn');
        if (addTaskPanelBtn) {
            addTaskPanelBtn.addEventListener('click', () => {
                // Check if current spreadsheet is leads type
                if (appState.currentSpreadsheet?.type === 'leads') {
                    openAddLeadModal();
                    return;
                }
                
                // Reset form for new task
                document.getElementById('taskForm').reset();
                delete document.getElementById('taskForm').dataset.editingTaskId;
                const titleEl = document.querySelector('#taskModal .unified-modal-title h2');
                const submitBtn = document.querySelector('#taskModal .unified-btn-primary');
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-plus-circle"></i> New Task';
                if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Task';
                
                populateTaskAssigneeDropdown();
                // Default to current spreadsheet when adding from panel
                const currentSpreadsheetId = appState.currentSpreadsheet?.id || 'default';
                populateTaskSpreadsheetDropdown(currentSpreadsheetId);
                
                // Set minimum date to today
                const taskDueDateInput = document.getElementById('taskDueDate');
                if (taskDueDateInput) {
                    const today = new Date().toISOString().split('T')[0];
                    taskDueDateInput.setAttribute('min', today);
                }
                
                // Reset progress bar (range slider + number input + fill + badge)
                const progressInput = document.getElementById('taskProgress');
                const progressSlider = document.getElementById('taskProgressSlider');
                const progressFill = document.getElementById('taskProgressFill');
                const progressBadge = document.getElementById('taskProgressBadge');
                if (progressInput) {
                    progressInput.value = 0;
                    if (progressSlider) {
                        progressSlider.value = 0;
                    }
                    if (progressFill) {
                        progressFill.style.width = '0%';
                    }
                    if (progressBadge) {
                        progressBadge.textContent = '0%';
                    }
                }
                
                openModal('taskModal');
            });
        }
    }

    // Helper: Check if current user can edit this spreadsheet based on visibility
    function canEditSpreadsheet(spreadsheet) {
        if (!currentAuthUser) return false;
        
        // Creator can always edit their own
        if (spreadsheet.createdBy === currentAuthUser.uid) return true;
        
        // Get user role
        const userRole = appState.currentTeamData?.members?.[currentAuthUser.uid]?.role || 'member';
        
        // Check visibility permissions
        const vis = spreadsheet.visibility || 'team';
        if (vis === 'team') return true;  // Any member can edit team sheets
        if (vis === 'admins') return userRole === 'admin' || userRole === 'owner';
        if (vis === 'private') return false;  // Already checked creator above
        
        return false;
    }

    // Save spreadsheet to Firestore
    async function saveSpreadsheetToFirestore(spreadsheet) {
        if (!appState.currentTeamId || !db) {
            console.warn('Cannot save spreadsheet: no team or db');
            return;
        }
        
        if (!currentAuthUser?.uid) {
            console.warn('Cannot save spreadsheet: no authenticated user');
            return;
        }
        
        // PERMISSION CHECK: Verify user can edit this spreadsheet
        if (!canEditSpreadsheet(spreadsheet)) {
            // Silent return to avoid console spam - user doesn't have permission
            debugLog('⚠️ Skipping save - no edit permission for spreadsheet:', spreadsheet.id);
            return;
        }
        
        try {
            const { doc, setDoc, updateDoc, getDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const spreadsheetRef = doc(db, 'teams', appState.currentTeamId, 'spreadsheets', spreadsheet.id);
            
            // Check if doc exists to determine create vs update
            const docSnap = await getDoc(spreadsheetRef);
            const isNewDoc = !docSnap.exists();
            
            // Determine default columns based on type
            const isLeadsType = spreadsheet.type === 'leads';
            const defaultColumns = isLeadsType 
                ? ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes']
                : ['title', 'status', 'assignee', 'priority', 'dueDate', 'progress'];
            
            if (isNewDoc) {
                // CREATE: Full schema including immutable fields
                const createData = {
                    name: spreadsheet.name,
                    type: spreadsheet.type || 'tasks',
                    icon: spreadsheet.icon || 'fa-table',
                    color: spreadsheet.color || '#0070f3',
                    columns: spreadsheet.columns || defaultColumns,
                    visibility: spreadsheet.visibility || 'team',
                    createdBy: currentAuthUser.uid,  // IMMUTABLE: set only on create
                    teamId: appState.currentTeamId,   // IMMUTABLE: set only on create
                    createdAt: serverTimestamp(),     // IMMUTABLE: set only on create
                    updatedAt: serverTimestamp(),
                    customColumns: spreadsheet.customColumns || [],
                    columnSettings: spreadsheet.columnSettings || {}
                };
                
                // DEBUG_PERMS logging
                if (DEBUG_PERMS) {
                    console.log('[DEBUG_PERMS] CREATE spreadsheet:', {
                        path: `teams/${appState.currentTeamId}/spreadsheets/${spreadsheet.id}`,
                        keys: Object.keys(createData),
                        uid: currentAuthUser.uid
                    });
                }
                
                await setDoc(spreadsheetRef, createData);
                spreadsheet.createdBy = currentAuthUser.uid;
                console.log('Spreadsheet CREATED in Firestore:', spreadsheet.name);
            } else {
                // UPDATE: Only mutable fields (rules use affectedKeys check)
                const updateData = {
                    name: spreadsheet.name,
                    type: spreadsheet.type || 'tasks',
                    icon: spreadsheet.icon || 'fa-table',
                    color: spreadsheet.color || '#0070f3',
                    columns: spreadsheet.columns || defaultColumns,
                    visibility: spreadsheet.visibility || 'team',
                    updatedAt: serverTimestamp(),
                    customColumns: spreadsheet.customColumns || [],
                    columnSettings: spreadsheet.columnSettings || {}
                };
                // NOTE: createdBy, teamId, createdAt are NOT included - they're immutable
                
                // DEBUG_PERMS logging
                if (DEBUG_PERMS) {
                    const existingData = docSnap.data();
                    console.log('[DEBUG_PERMS] UPDATE spreadsheet:', {
                        path: `teams/${appState.currentTeamId}/spreadsheets/${spreadsheet.id}`,
                        keysBeingSent: Object.keys(updateData),
                        existingDocKeys: Object.keys(existingData),
                        uid: currentAuthUser.uid,
                        existingCreatedBy: existingData.createdBy,
                        existingTeamId: existingData.teamId,
                        existingCreatedAt: existingData.createdAt ? 'exists' : 'MISSING'
                    });
                }
                
                await updateDoc(spreadsheetRef, updateData);
                spreadsheet.createdBy = docSnap.data().createdBy;  // Preserve existing
                console.log('Spreadsheet UPDATED in Firestore:', spreadsheet.name);
            }
        } catch (error) {
            const path = `teams/${appState.currentTeamId}/spreadsheets/${spreadsheet.id}`;
            logFirestoreError('saveSpreadsheetToFirestore', path, spreadsheet, {
                uid: currentAuthUser?.uid,
                teamId: appState.currentTeamId,
                spreadsheetName: spreadsheet.name,
                spreadsheetVisibility: spreadsheet.visibility
            }, error);
            throw error;
        }
    }

    // Load spreadsheets from Firestore
    async function loadSpreadsheetsFromFirestore() {
        if (!appState.currentTeamId || !db) {
            console.warn('Cannot load spreadsheets: no team or db');
            return;
        }
        
        try {
            const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const spreadsheetsRef = collection(db, 'teams', appState.currentTeamId, 'spreadsheets');
            const snapshot = await getDocs(spreadsheetsRef);
            
            appState.spreadsheets = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const docId = docSnap.id;
                
                // ROBUST TYPE DETECTION: Check multiple sources
                // 1. First check saved type field
                // 2. Fallback to ID prefix (leads_ or tasks_)
                // 3. Last resort: check if columns contain lead-specific columns
                let spreadsheetType = data.type;
                
                if (!spreadsheetType) {
                    // Check ID prefix
                    if (docId.startsWith('leads_')) {
                        spreadsheetType = 'leads';
                    } else if (docId.startsWith('tasks_')) {
                        spreadsheetType = 'tasks';
                    } else {
                        // Check columns for lead indicators
                        const cols = data.columns || [];
                        if (cols.includes('leadName') || cols.includes('source') || cols.includes('value')) {
                            spreadsheetType = 'leads';
                        } else {
                            spreadsheetType = 'tasks';
                        }
                    }
                }
                
                const isLeadsType = spreadsheetType === 'leads';
                
                // Use type-appropriate default columns if none saved
                const defaultColumns = isLeadsType 
                    ? ['leadName', 'status', 'source', 'value', 'contact', 'createdAt', 'notes']
                    : ['title', 'status', 'assignee', 'priority', 'dueDate', 'progress'];
                
                // Ensure all column-related fields are loaded properly
                const spreadsheet = {
                    id: docSnap.id,
                    name: data.name,
                    type: spreadsheetType, // CRITICAL: Load the type!
                    icon: data.icon || 'fa-table',
                    color: data.color || '#0070f3',
                    columns: data.columns || defaultColumns,
                    visibility: data.visibility || 'team',
                    createdBy: data.createdBy,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    // Load custom columns with all properties (type, options, colors, ranges)
                    customColumns: data.customColumns || [],
                    // Load built-in column customizations
                    columnSettings: data.columnSettings || {}
                };
                
                // Debug logging
                console.log(`📊 Loaded spreadsheet "${spreadsheet.name}":`, {
                    id: spreadsheet.id,
                    type: spreadsheet.type,
                    savedType: data.type,
                    columns: spreadsheet.columns
                });
                
                appState.spreadsheets.push(spreadsheet);
            });
            
            // Set flag to indicate spreadsheets have been loaded from Firestore
            // This prevents race condition in renderSpreadsheetCards creating duplicate defaults
            appState._spreadsheetsLoaded = true;
            
            console.log('Loaded spreadsheets from Firestore:', appState.spreadsheets.length, 'with custom columns');
            renderSpreadsheetCards();
        } catch (error) {
            console.error('Error loading spreadsheets:', error);
            // Still set flag even on error to avoid stuck state
            appState._spreadsheetsLoaded = true;
        }
    }

    // Make loadSpreadsheetsFromFirestore available
    window.loadSpreadsheetsFromFirestore = loadSpreadsheetsFromFirestore;

    // Expose functions globally
    window.renderSpreadsheetCards = renderSpreadsheetCards;
    window.openSpreadsheetPanel = openSpreadsheetPanel;
    window.saveSpreadsheetToFirestore = saveSpreadsheetToFirestore;

    // Show task details in a clean modal
    window.showTaskDetails = function(task) {
        // Find creator info
        const creator = appState.teammates.find(m => m.id === task.createdBy) || {};
        const creatorName = creator.displayName || creator.email || 'Unknown';
        const creatorColor = creator.avatarColor || '#0078D4';
        const creatorInitials = creatorName.substring(0, 2).toUpperCase();

        // Find assignee info
        const assignee = appState.teammates.find(m => m.displayName === task.assignee || m.email === task.assignee) || {};
        const assigneeName = assignee.displayName || task.assignee || 'Unassigned';
        const assigneeColor = assignee.avatarColor || '#8E8E93';
        const assigneeInitials = assigneeName.substring(0, 2).toUpperCase();

        const modalHTML = `
            <div class="modal active" id="taskDetailsModal">
                <div class="modal-content" style="max-width: 650px;">
                    <div class="modal-header">
                        <h2><i class="fas fa-tasks"></i> Task Details</h2>
                        <button class="modal-close" onclick="closeTaskDetailsModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 32px;">
                        <div class="task-details-container">
                            <h3 class="task-details-title">${task.title}</h3>
                            
                            <div class="task-details-meta">
                                <div class="task-details-row">
                                    <div class="task-detail-item">
                                        <span class="detail-label"><i class="fas fa-user"></i> Created by</span>
                                        <div class="task-user-info">
                                            <div class="task-user-avatar" style="background: ${creatorColor};">${creatorInitials}</div>
                                            <span class="detail-value">${creatorName}</span>
                                        </div>
                                    </div>
                                    
                                    <div class="task-detail-item">
                                        <span class="detail-label"><i class="fas fa-user-check"></i> Assigned to</span>
                                        <div class="task-user-info">
                                            <div class="task-user-avatar" style="background: ${assigneeColor};">${assigneeInitials}</div>
                                            <span class="detail-value">${assigneeName}</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="task-details-row">
                                    <div class="task-detail-item">
                                        <span class="detail-label"><i class="fas fa-circle-notch"></i> Status</span>
                                        <span class="detail-value status-badge status-${task.status}">${task.status === 'todo' ? 'To Do' : task.status === 'inprogress' ? 'In Progress' : 'Done'}</span>
                                    </div>
                                    
                                    <div class="task-detail-item">
                                        <span class="detail-label"><i class="fas fa-flag"></i> Priority</span>
                                        <span class="detail-value priority-badge priority-${task.priority}">${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>
                                    </div>
                                </div>

                                ${task.dueDate ? `
                                <div class="task-detail-item full-width">
                                    <span class="detail-label"><i class="fas fa-calendar-alt"></i> Due Date</span>
                                    <span class="detail-value">${new Date(task.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                                ` : ''}
                            </div>

                            ${task.description ? `
                            <div class="task-details-description">
                                <span class="detail-label"><i class="fas fa-align-left"></i> Description</span>
                                <p class="detail-description">${task.description}</p>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existing = document.getElementById('taskDetailsModal');
        if (existing) existing.remove();

        // Add to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Close on backdrop click
        document.getElementById('taskDetailsModal').addEventListener('click', (e) => {
            if (e.target.id === 'taskDetailsModal') {
                closeTaskDetailsModal();
            }
        });
    };

    window.closeTaskDetailsModal = function() {
        const modal = document.getElementById('taskDetailsModal');
        if (modal) modal.remove();
    };
}

// Update task status
async function updateTaskStatus(taskId, newStatus) {
    const task = appState.tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;
    
    const oldStatus = task.status;
    task.status = newStatus;
    
    // Update in Firestore
    if (db && currentAuthUser && appState.currentTeamId) {
        try {
            const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', String(taskId));
            await updateDoc(taskRef, { 
                status: newStatus,
                updatedAt: serverTimestamp()
            });
            
            debugLog('✅ Task status updated:', taskId, newStatus);
            
            // Add activity only if NOT a private spreadsheet task
            const spreadsheet = appState.spreadsheets.find(s => s.id === task.spreadsheetId);
            const isPrivateSpreadsheet = spreadsheet && spreadsheet.visibility === 'private';
            
            if (!isPrivateSpreadsheet) {
                const statusText = newStatus === 'todo' ? 'To Do' : newStatus === 'in-progress' ? 'In Progress' : 'Done';
                addActivity({
                    type: 'task',
                    description: `marked task "${task.title}" as ${statusText}`
                });
            }
            
        } catch (error) {
            console.error('Error updating task status:', error.code || error.message);
            task.status = oldStatus; // Revert on error
        }
    }
    
    // Update local storage
    saveToLocalStorage('tasks', appState.tasks);
    
    // Refresh display
    if (window.displayTasks) {
        window.displayTasks();
    }
}

// Populate task assignee dropdown with team members
function populateTaskAssigneeDropdown() {
    const menu = document.getElementById('taskAssigneeMenu');
    const trigger = document.getElementById('taskAssigneeTrigger');
    const hiddenInput = document.getElementById('taskAssignee');
    
    if (!menu || !trigger || !hiddenInput) return;
    
    // Clear existing options
    menu.innerHTML = '';
    
    let optionsHTML = '';
    let firstMember = null;
    
    // Add current user first - check appState.teammates for proper display name
    if (currentAuthUser) {
        // Try to find current user in teammates for consistent display name
        const currentUserInTeam = appState.teammates?.find(t => t.id === currentAuthUser.uid);
        const displayName = currentUserInTeam?.name || currentAuthUser.displayName || currentAuthUser.email || 'You';
        const initials = displayName.substring(0, 1).toUpperCase();
        const color = currentUserInTeam?.avatarColor || '#0070F3';
        firstMember = { id: currentAuthUser.uid, name: displayName, initials, color };
        
        optionsHTML += `
            <div class="dropdown-menu-option" data-value="${currentAuthUser.uid}" data-name="${escapeHtml(displayName)}">
                <div class="dropdown-assignee-avatar" style="background: ${color}">${initials}</div>
                <span>${escapeHtml(displayName)} (You)</span>
            </div>
        `;
    }
    
    // Add team members
    if (appState.teammates && appState.teammates.length > 0) {
        appState.teammates.forEach(teammate => {
            // Skip current user (already added)
            if (currentAuthUser && teammate.id === currentAuthUser.uid) return;
            
            const name = teammate.name || teammate.email || 'Unknown';
            const initials = name.substring(0, 1).toUpperCase();
            const color = teammate.avatarColor || '#8E8E93';
            
            if (!firstMember) {
                firstMember = { id: teammate.id, name, initials, color };
            }
            
            optionsHTML += `
                <div class="dropdown-menu-option" data-value="${teammate.id}" data-name="${escapeHtml(name)}">
                    <div class="dropdown-assignee-avatar" style="background: ${color}">${initials}</div>
                    <span>${escapeHtml(name)}</span>
                </div>
            `;
        });
    }
    
    menu.innerHTML = optionsHTML || '<div class="dropdown-menu-option" style="color: var(--text-muted); cursor: default;">No team members</div>';
    
    // Set first member as default
    if (firstMember) {
        hiddenInput.value = firstMember.id;
        const triggerContent = trigger.querySelector('.dropdown-trigger-content') || trigger.querySelector('.unified-dropdown-value');
        if (triggerContent) {
            triggerContent.innerHTML = `
                <div class="dropdown-assignee-avatar" style="background: ${firstMember.color}">${firstMember.initials}</div>
                <span>${escapeHtml(firstMember.name)}</span>
            `;
        }
        // Mark as active
        const firstOption = menu.querySelector(`[data-value="${firstMember.id}"]`);
        if (firstOption) {
            firstOption.classList.add('active');
            firstOption.innerHTML += '<i class="fas fa-check"></i>';
        }
    }
}

// Populate task spreadsheet dropdown with available spreadsheets
function populateTaskSpreadsheetDropdown(defaultSpreadsheetId = null) {
    const menu = document.getElementById('taskSpreadsheetMenu');
    const trigger = document.getElementById('taskSpreadsheetTrigger');
    const hiddenInput = document.getElementById('taskSpreadsheet');
    
    if (!menu || !trigger || !hiddenInput) return;
    
    // Clear existing options
    menu.innerHTML = '';
    
    let optionsHTML = `
        <div class="dropdown-menu-option active" data-value="default">
            <i class="fas fa-list dropdown-icon"></i>
            <span>All Tasks</span>
            <i class="fas fa-check"></i>
        </div>
    `;
    
    // Add user's spreadsheets (visible ones only)
    if (appState.spreadsheets && appState.spreadsheets.length > 0) {
        appState.spreadsheets.forEach(spreadsheet => {
            if (spreadsheet.id === 'default') return; // Skip default, already added
            
            // Check visibility - only show team spreadsheets or own private spreadsheets
            if (spreadsheet.visibility === 'private' && 
                currentAuthUser && spreadsheet.createdBy !== currentAuthUser.uid) {
                return;
            }
            
            const icon = spreadsheet.icon || 'fa-table';
            optionsHTML += `
                <div class="dropdown-menu-option" data-value="${spreadsheet.id}">
                    <i class="fas ${icon} dropdown-icon"></i>
                    <span>${escapeHtml(spreadsheet.name)}</span>
                </div>
            `;
        });
    }
    
    menu.innerHTML = optionsHTML;
    
    // Set default selection
    let selectedId = 'default';
    if (defaultSpreadsheetId) {
        selectedId = defaultSpreadsheetId;
    } else if (appState.currentSpreadsheet && appState.currentSpreadsheet.id !== 'default') {
        selectedId = appState.currentSpreadsheet.id;
    }
    
    hiddenInput.value = selectedId;
    
    // Update trigger and active state
    const selectedOption = menu.querySelector(`[data-value="${selectedId}"]`);
    if (selectedOption) {
        // Remove active from all
        menu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.classList.remove('active');
            const check = opt.querySelector('.fa-check');
            if (check) check.remove();
        });
        // Add active to selected
        selectedOption.classList.add('active');
        selectedOption.innerHTML += '<i class="fas fa-check"></i>';
        
        const icon = selectedOption.querySelector('.dropdown-icon');
        const text = selectedOption.querySelector('span').textContent;
        const triggerContent = trigger.querySelector('.dropdown-trigger-content') || trigger.querySelector('.unified-dropdown-value');
        if (triggerContent) {
            triggerContent.innerHTML = `
                <i class="fas ${icon ? icon.classList[1] : 'fa-table'} dropdown-icon"></i>
                <span>${text}</span>
            `;
        }
    }
}

// ===================================
// TASK MODAL CUSTOM DROPDOWNS
// Initialize Apple-like dropdown components
// ===================================
function initTaskModalDropdowns() {
    // Priority dropdown
    setupCustomDropdown('taskPriority', (value, option) => {
        const dot = option.querySelector('.priority-dot, .unified-priority-dot');
        const label = option.querySelector('span:not(.priority-dot):not(.unified-priority-dot)').textContent;
        return `
            <span class="unified-priority-dot ${value}"></span>
            <span>${label}</span>
        `;
    });
    
    // Status dropdown
    setupCustomDropdown('taskStatus', (value, option) => {
        const label = option.querySelector('span:not(.status-dot):not(.unified-status-dot)').textContent;
        return `
            <span class="unified-status-dot ${value}"></span>
            <span>${label}</span>
        `;
    });
    
    // Assignee dropdown
    setupCustomDropdown('taskAssignee', (value, option) => {
        const avatar = option.querySelector('.dropdown-assignee-avatar, .unified-assignee-avatar');
        const name = option.dataset.name || option.querySelector('span').textContent;
        if (avatar) {
            return `
                <div class="unified-assignee-avatar" style="${avatar.getAttribute('style')}">${avatar.textContent}</div>
                <span>${name}</span>
            `;
        }
        return `<span>${name}</span>`;
    });
    
    // Spreadsheet dropdown
    setupCustomDropdown('taskSpreadsheet', (value, option) => {
        const icon = option.querySelector('.dropdown-icon, .unified-dropdown-icon');
        const text = option.querySelector('span').textContent;
        return `
            <i class="fas ${icon ? icon.classList[1] : 'fa-table'} unified-dropdown-icon"></i>
            <span>${text}</span>
        `;
    });
}

function setupCustomDropdown(inputId, getTriggerContent) {
    const container = document.getElementById(inputId + 'Dropdown');
    const trigger = document.getElementById(inputId + 'Trigger');
    const menu = document.getElementById(inputId + 'Menu');
    const hiddenInput = document.getElementById(inputId);
    
    if (!container || !trigger || !menu || !hiddenInput) return;
    
    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close other dropdowns first (support both old and unified classes)
        document.querySelectorAll('.custom-dropdown-menu.visible, .unified-dropdown-menu.visible').forEach(m => {
            if (m !== menu) {
                m.classList.remove('visible');
                const parentContainer = m.closest('.custom-dropdown-container') || m.closest('.unified-dropdown');
                const parentTrigger = parentContainer?.querySelector('.custom-dropdown-trigger, .unified-dropdown-trigger');
                parentTrigger?.classList.remove('active');
            }
        });
        
        const isOpen = menu.classList.contains('visible');
        menu.classList.toggle('visible');
        trigger.classList.toggle('active');
    });
    
    // Handle option selection (support both old and unified classes)
    menu.addEventListener('click', (e) => {
        const option = e.target.closest('.dropdown-menu-option, .unified-dropdown-option');
        if (!option || option.style.cursor === 'default') return;
        
        const value = option.dataset.value;
        
        // Update hidden input
        hiddenInput.value = value;
        
        // Update active state (support both old and unified classes)
        menu.querySelectorAll('.dropdown-menu-option, .unified-dropdown-option').forEach(opt => {
            opt.classList.remove('active', 'selected');
            const check = opt.querySelector('.fa-check');
            if (check) check.style.opacity = '0';
        });
        option.classList.add('active', 'selected');
        const checkIcon = option.querySelector('.fa-check');
        if (checkIcon) checkIcon.style.opacity = '1';
        
        // Update trigger content (support both old and unified classes)
        const triggerContent = trigger.querySelector('.dropdown-trigger-content, .unified-dropdown-value');
        if (getTriggerContent && triggerContent) {
            triggerContent.innerHTML = getTriggerContent(value, option);
        }
        
        // Close dropdown
        menu.classList.remove('visible');
        trigger.classList.remove('active');
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            menu.classList.remove('visible');
            trigger.classList.remove('active');
        }
    });
}

// ===================================
// 20-WORD LIMIT FOR TASK TITLE
// Real-time enforcement while typing
// ===================================
function initTaskTitleWordLimit() {
    const titleInput = document.getElementById('taskTitle');
    const counter = document.getElementById('taskTitleCounter');
    const MAX_WORDS = 20;
    
    if (!titleInput || !counter) return;
    
    titleInput.addEventListener('input', (e) => {
        let text = e.target.value;
        const words = text.split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;
        
        // Update counter
        counter.textContent = `${wordCount}/${MAX_WORDS} words`;
        
        // Update counter style based on word count
        counter.classList.remove('warning', 'limit');
        if (wordCount >= MAX_WORDS) {
            counter.classList.add('limit');
        } else if (wordCount >= MAX_WORDS - 5) {
            counter.classList.add('warning');
        }
        
        // If over limit, truncate to MAX_WORDS
        if (wordCount > MAX_WORDS) {
            // Get the position where we need to cut
            const truncatedWords = words.slice(0, MAX_WORDS);
            const truncatedText = truncatedWords.join(' ');
            
            // Preserve cursor position as much as possible
            const cursorPos = e.target.selectionStart;
            e.target.value = truncatedText;
            
            // Set cursor at end if it was beyond truncation point
            const newCursorPos = Math.min(cursorPos, truncatedText.length);
            e.target.setSelectionRange(newCursorPos, newCursorPos);
            
            // Update counter
            counter.textContent = `${MAX_WORDS}/${MAX_WORDS} words`;
            counter.classList.add('limit');
        }
    });
    
    // Also handle paste events
    titleInput.addEventListener('paste', (e) => {
        // Let the paste happen, then check word count
        setTimeout(() => {
            titleInput.dispatchEvent(new Event('input'));
        }, 0);
    });
}

// ===================================
// TASK MODAL PROGRESS BAR
// Modern gradient progress bar
// ===================================
function initTaskModalProgressSlider() {
    const progressInput = document.getElementById('taskProgress');
    const progressFill = document.getElementById('taskProgressFill');
    
    if (!progressInput) return;
    
    progressInput.addEventListener('input', (e) => {
        let value = parseInt(e.target.value) || 0;
        value = Math.max(0, Math.min(100, value));
        if (progressFill) {
            progressFill.style.width = value + '%';
        }
    });
    
    progressInput.addEventListener('change', (e) => {
        let value = parseInt(e.target.value) || 0;
        value = Math.max(0, Math.min(100, value));
        progressInput.value = value;
        if (progressFill) {
            progressFill.style.width = value + '%';
        }
    });
}

// ===================================
// RESET TASK MODAL DROPDOWNS
// Called when opening modal for new task
// ===================================
function resetTaskModalDropdowns() {
    // Reset Priority to Medium
    const priorityTrigger = document.getElementById('taskPriorityTrigger');
    const priorityInput = document.getElementById('taskPriority');
    const priorityMenu = document.getElementById('taskPriorityMenu');
    if (priorityTrigger && priorityInput && priorityMenu) {
        priorityInput.value = 'medium';
        const priorityTriggerContent = priorityTrigger.querySelector('.dropdown-trigger-content') || priorityTrigger.querySelector('.unified-dropdown-value');
        if (priorityTriggerContent) {
            priorityTriggerContent.innerHTML = `
                <span class="unified-priority-dot medium"></span>
                <span>Medium</span>
            `;
        }
        priorityMenu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.classList.remove('active');
            const check = opt.querySelector('.fa-check');
            if (check) check.remove();
            if (opt.dataset.value === 'medium') {
                opt.classList.add('active');
                opt.innerHTML += '<i class="fas fa-check"></i>';
            }
        });
    }
    
    // Reset Status to To Do
    const statusTrigger = document.getElementById('taskStatusTrigger');
    const statusInput = document.getElementById('taskStatus');
    const statusMenu = document.getElementById('taskStatusMenu');
    if (statusTrigger && statusInput && statusMenu) {
        statusInput.value = 'todo';
        const statusTriggerContent = statusTrigger.querySelector('.dropdown-trigger-content') || statusTrigger.querySelector('.unified-dropdown-value');
        if (statusTriggerContent) {
            statusTriggerContent.innerHTML = `
                <span class="unified-status-dot todo"></span>
                <span>To Do</span>
            `;
        }
        statusMenu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.classList.remove('active');
            const check = opt.querySelector('.fa-check');
            if (check) check.remove();
            if (opt.dataset.value === 'todo') {
                opt.classList.add('active');
                opt.innerHTML += '<i class="fas fa-check"></i>';
            }
        });
    }
    
    // Reset Assignee placeholder
    const assigneeTrigger = document.getElementById('taskAssigneeTrigger');
    const assigneeInput = document.getElementById('taskAssignee');
    if (assigneeTrigger && assigneeInput) {
        assigneeInput.value = '';
        const assigneeTriggerContent = assigneeTrigger.querySelector('.dropdown-trigger-content') || assigneeTrigger.querySelector('.unified-dropdown-value');
        if (assigneeTriggerContent) {
            assigneeTriggerContent.innerHTML = `
                <span class="dropdown-placeholder">Select...</span>
            `;
        }
    }
    
    // Reset Progress (range slider + number input + fill + badge)
    const progressInput = document.getElementById('taskProgress');
    const progressSlider = document.getElementById('taskProgressSlider');
    const progressFill = document.getElementById('taskProgressFill');
    const progressBadge = document.getElementById('taskProgressBadge');
    if (progressInput) {
        progressInput.value = 0;
        if (progressSlider) {
            progressSlider.value = 0;
        }
        if (progressFill) {
            progressFill.style.width = '0%';
        }
        if (progressBadge) {
            progressBadge.textContent = '0%';
        }
    }
    
    // Reset word counter
    const counter = document.getElementById('taskTitleCounter');
    if (counter) {
        counter.textContent = '0/20 words';
        counter.classList.remove('warning', 'limit');
    }
}

// Delete task function (global for onclick access)
window.deleteTask = async function(taskId, event) {
    if (DEBUG) console.log('🗑️ Delete task called with ID:', taskId);
    
    // Find the task to check permissions
    const taskIdStr = String(taskId);
    const task = appState.tasks.find(t => String(t.id) === taskIdStr);
    
    // Check permissions: admin/owner can delete any task, members can only delete their own
    if (db && currentAuthUser && appState.currentTeamId) {
        try {
            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const teamRef = doc(db, 'teams', appState.currentTeamId);
            const teamDoc = await getDoc(teamRef);
            const teamData = teamDoc.data();
            
            const userRole = getCurrentUserRole(teamData);
            const isAdminOrOwner = userRole === 'admin' || userRole === 'owner';
            const isCreator = task && task.createdBy === currentAuthUser.uid;
            
            if (!isAdminOrOwner && !isCreator) {
                showToast('You can only delete tasks you created.', 'error');
                return;
            }
        } catch (error) {
            console.error('Error checking permissions:', error);
        }
    }
    
    // Show custom delete popup near cursor
    showDeleteConfirmPopup(taskId, task?.title || 'this task', event);
        if (DEBUG) {
            console.log('📊 Current state:', {
                db: !!db,
                currentAuthUser: !!currentAuthUser,
                currentTeamId: appState.currentTeamId
            });
        }
        
        const taskTitle = task ? task.title : 'Unknown';
        if (DEBUG) console.log('📌 Found task:', task);
        
        // Delete from Firestore FIRST (before removing from local state)
        if (db && currentAuthUser && appState.currentTeamId) {
            try {
                const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
                const taskPath = `teams/${appState.currentTeamId}/tasks/${taskIdStr}`;
                if (DEBUG) console.log('🔥 Attempting to delete from Firestore path:', taskPath);
                
                const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', taskIdStr);
                await deleteDoc(taskRef);
                debugLog('✅ Task deleted from Firestore successfully');
                
                // Add to activity feed only if NOT a private spreadsheet task
                const spreadsheet = appState.spreadsheets.find(s => s.id === task?.spreadsheetId);
                const isPrivateSpreadsheet = spreadsheet && spreadsheet.visibility === 'private';
                
                if (!isPrivateSpreadsheet) {
                    addActivity({
                        type: 'task',
                        description: `deleted task "${taskTitle}"`
                    });
                }
            } catch (error) {
                console.error('❌ Error deleting task from Firestore:', error.code || error.message);
                
                // If task doesn't exist in Firestore (old task), allow local deletion
                if (error.code === 'not-found' || error.message.includes('No document to update')) {
                    console.log('⚠️ Task not found in Firestore (probably an old task). Deleting locally only.');
                } else {
                    showToast('Error deleting task from database. Please try again.', 'error', 5000, 'Delete Failed');
                    return; // Don't delete from local state if it's a real error
                }
            }
        } else {
            console.warn('⚠️ Skipping Firestore deletion - missing requirements');
        }
        
        // Remove from local state AFTER successful Firestore deletion
        appState.tasks = appState.tasks.filter(t => String(t.id) !== taskIdStr);
        saveToLocalStorage('tasks', appState.tasks);
        console.log('✅ Task removed from local state');
        
        // Update display
        window.displayTasks();
};

// Show custom delete confirmation popup near cursor
function showDeleteConfirmPopup(taskId, taskTitle, event) {
    // Remove any existing popup
    const existing = document.querySelector('.delete-confirm-popup');
    if (existing) existing.remove();
    
    // Get click position
    let x = event?.clientX || window.innerWidth / 2;
    let y = event?.clientY || window.innerHeight / 2;
    
    const popup = document.createElement('div');
    popup.className = 'delete-confirm-popup';
    popup.innerHTML = `
        <div class="delete-popup-content">
            <p>Delete <strong>${taskTitle}</strong>?</p>
            <div class="delete-popup-actions">
                <button class="delete-popup-btn cancel" onclick="closeDeletePopup()">Cancel</button>
                <button class="delete-popup-btn confirm" onclick="confirmDeleteTask('${taskId}')">Delete</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Position popup near cursor (adjust to keep on screen)
    const rect = popup.getBoundingClientRect();
    const padding = 10;
    
    // Position to left of cursor so delete button is near cursor
    x = Math.min(x - 20, window.innerWidth - rect.width - padding);
    x = Math.max(padding, x);
    y = Math.min(y - rect.height / 2, window.innerHeight - rect.height - padding);
    y = Math.max(padding, y);
    
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeDeletePopupOutside);
    }, 10);
}

function closeDeletePopupOutside(e) {
    const popup = document.querySelector('.delete-confirm-popup');
    if (popup && !popup.contains(e.target)) {
        closeDeletePopup();
    }
}

window.closeDeletePopup = function() {
    const popup = document.querySelector('.delete-confirm-popup');
    if (popup) popup.remove();
    document.removeEventListener('click', closeDeletePopupOutside);
};

window.confirmDeleteTask = async function(taskId) {
    closeDeletePopup();
    
    const taskIdStr = String(taskId);
    const task = appState.tasks.find(t => String(t.id) === taskIdStr);
    const taskTitle = task ? task.title : 'Unknown';
    
    if (DEBUG) {
        console.log('📊 Current state:', {
            db: !!db,
            currentAuthUser: !!currentAuthUser,
            currentTeamId: appState.currentTeamId
        });
    }
    
    if (DEBUG) console.log('📌 Found task:', task);
    
    // Delete from Firestore FIRST (before removing from local state)
    if (db && currentAuthUser && appState.currentTeamId) {
        try {
            const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            const taskPath = `teams/${appState.currentTeamId}/tasks/${taskIdStr}`;
            if (DEBUG) console.log('🔥 Attempting to delete from Firestore path:', taskPath);
            
            const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', taskIdStr);
            await deleteDoc(taskRef);
            debugLog('✅ Task deleted from Firestore successfully');
            
            // Add to activity feed
            addActivity({
                type: 'task',
                description: `deleted task "${taskTitle}"`
            });
        } catch (error) {
            console.error('❌ Error deleting task from Firestore:', error.code || error.message);
            
            // If task doesn't exist in Firestore (old task), allow local deletion
            if (error.code === 'not-found' || error.message.includes('No document to update')) {
                console.log('⚠️ Task not found in Firestore (probably an old task). Deleting locally only.');
            } else {
                showToast('Error deleting task from database. Please try again.', 'error', 5000, 'Delete Failed');
                return; // Don't delete from local state if it's a real error
            }
        }
    } else {
        console.warn('⚠️ Skipping Firestore deletion - missing requirements');
    }
    
    // Remove from local state AFTER successful Firestore deletion
    appState.tasks = appState.tasks.filter(t => String(t.id) !== taskIdStr);
    saveToLocalStorage('tasks', appState.tasks);
    console.log('✅ Task removed from local state');
    
    // Update display
    window.displayTasks();
    showToast('Task deleted', 'success');
};

// ===================================
// ACTIVITY FEED
// ===================================
function initActivityFeed() {
    // Activities are now loaded in loadTeamData() after team is initialized
    displayActivities();
    
    // Set up "See All" button click handler
    const seeAllBtn = document.getElementById('seeAllActivitiesBtn');
    if (seeAllBtn) {
        seeAllBtn.addEventListener('click', () => {
            showAllActivities = !showAllActivities;
            displayActivities();
        });
    }
}

// Add activity to Firestore
async function addActivity(activity) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        debugLog('Cannot add activity: missing db, auth, or teamId');
        return;
    }
    
    try {
        const { collection, addDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const activitiesRef = collection(db, 'teams', appState.currentTeamId, 'activities');
        
        // SECURITY: Rules require createdBy == request.auth.uid
        const activityData = {
            type: activity.type,
            createdBy: currentAuthUser.uid, // Required by rules (was userId)
            userName: currentAuthUser.displayName || currentAuthUser.email,
            description: activity.description,
            createdAt: serverTimestamp()
        };
        
        await addDoc(activitiesRef, activityData);
        debugLog('✅ Activity added to Firestore');
        
    } catch (error) {
        console.error('Error adding activity:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// Track whether all activities are shown
let showAllActivities = false;
const MAX_VISIBLE_ACTIVITIES = 5;

function displayActivities() {
    const activityFeed = document.querySelector('.activity-feed');
    if (!activityFeed) return;

    // Keep the existing sample activities if no saved activities
    if (appState.activities.length === 0) return;

    activityFeed.innerHTML = '';
    
    console.log(`📊 Displaying ${appState.activities.length} activities`);

    // Determine how many activities to show
    const activitiesToShow = showAllActivities 
        ? appState.activities 
        : appState.activities.slice(0, MAX_VISIBLE_ACTIVITIES);
    
    // Update the "See All" button visibility and text
    const seeAllBtn = document.getElementById('seeAllActivitiesBtn');
    if (seeAllBtn) {
        if (appState.activities.length > MAX_VISIBLE_ACTIVITIES) {
            seeAllBtn.style.display = 'inline-block';
            seeAllBtn.textContent = showAllActivities ? 'Show Less' : `See All (${appState.activities.length})`;
        } else {
            seeAllBtn.style.display = 'none';
        }
    }

    activitiesToShow.forEach(activity => {
        
        const iconClass = activity.type === 'task' ? 'task-icon' : 
                         activity.type === 'message' ? 'message-icon' : 
                         activity.type === 'team' ? 'team-icon' : 'calendar-icon';
        const icon = activity.type === 'task' ? 'fa-check-circle' : 
                    activity.type === 'message' ? 'fa-comment' : 
                    activity.type === 'team' ? 'fa-user-plus' : 'fa-calendar';

        const activityEl = document.createElement('div');
        activityEl.className = 'activity-item';
        
        // Create icon container
        const iconDiv = document.createElement('div');
        iconDiv.className = `activity-icon ${iconClass}`;
        const iconElement = document.createElement('i');
        iconElement.className = `fas ${icon}`;
        iconDiv.appendChild(iconElement);
        
        // Create content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'activity-content';
        
        // Create header with user name and description
        const headerDiv = document.createElement('div');
        headerDiv.className = 'activity-header';
        
        const userNameStrong = document.createElement('strong');
        userNameStrong.textContent = activity.userName || activity.user; // Use textContent for user name
        
        const descriptionText = document.createTextNode(' ' + activity.description); // Use textNode for description
        
        headerDiv.appendChild(userNameStrong);
        headerDiv.appendChild(descriptionText);
        
        // Create time element
        const timeDiv = document.createElement('div');
        timeDiv.className = 'activity-time';
        timeDiv.textContent = activity.timeAgo; // Use textContent for time
        
        contentDiv.appendChild(headerDiv);
        contentDiv.appendChild(timeDiv);
        
        activityEl.appendChild(iconDiv);
        activityEl.appendChild(contentDiv);
        
        activityFeed.appendChild(activityEl);
    });
}

// Load activities from Firestore with real-time listener
async function loadActivities() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        debugLog('Cannot load activities: missing db, auth, or teamId');
        return;
    }
    
    try {
        const { collection, query, onSnapshot, orderBy, limit } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const activitiesRef = collection(db, 'teams', appState.currentTeamId, 'activities');
        const q = query(activitiesRef, orderBy('createdAt', 'desc'), limit(50));
        
        // Real-time listener
        onSnapshot(q, (querySnapshot) => {
            const activities = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const timestamp = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
                
                activities.push({
                    id: doc.id,
                    type: data.type,
                    user: data.userName,
                    userName: data.userName,
                    userId: data.userId,
                    description: data.description,
                    timestamp: timestamp,
                    timeAgo: getTimeAgo(timestamp)
                });
            });
            
            appState.activities = activities;
            debugLog(`✅ Loaded ${activities.length} activities`);
            displayActivities();
            updateNotifications(activities);
            updateOverview(); // Update overview with latest data
            updateMetricsIfActive(); // Update metrics if active
        }, (error) => {
            // Handle Firestore listener errors (network issues, timeouts, etc.)
            if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ Activities listener temporarily unavailable, will auto-retry');
            } else {
                console.error('Error in activities snapshot listener:', error.code || error.message);
                debugError('Full error:', error);
            }
        });
        
    } catch (error) {
        console.error('Error loading activities from Firestore:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// ===================================
// OVERVIEW/DASHBOARD FUNCTIONS
// ===================================
function updateOverview() {
    updateOverviewStats();
    updateOverviewTasks();
    updateOverviewEvents();
}

function updateOverviewStats() {
    // Count my tasks (not done, assigned to current user)
    const uid = currentAuthUser?.uid;
    const displayName = currentAuthUser?.displayName?.toLowerCase();
    const email = currentAuthUser?.email?.toLowerCase();
    
    const myTasks = appState.tasks.filter(task => {
        if (task.status === 'done') return false;
        
        // Check by assigneeId (UID)
        if (task.assigneeId && uid && task.assigneeId === uid) return true;
        
        // Check by assignee name (case-insensitive)
        if (task.assignee && displayName && task.assignee.toLowerCase() === displayName) return true;
        if (task.assignee && email && task.assignee.toLowerCase() === email) return true;
        
        // Check if assignee contains the display name or email
        if (task.assignee && displayName && task.assignee.toLowerCase().includes(displayName)) return true;
        
        return false;
    });
    
    document.getElementById('myTasksCount').textContent = myTasks.length;
    
    // Count upcoming events (within next 30 days)
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcomingEvents = appState.events.filter(event => {
        const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
        return eventDate >= now && eventDate <= thirtyDaysFromNow;
    });
    document.getElementById('upcomingEventsCount').textContent = upcomingEvents.length;
    
    // Count team members
    document.getElementById('teamMembersCount').textContent = appState.teammates?.length || 0;
}

function updateOverviewTasks() {
    const container = document.getElementById('overviewTasksList');
    if (!container) return;
    
    // Get tasks assigned to current user (not done)
    const uid = currentAuthUser?.uid;
    const displayName = currentAuthUser?.displayName?.toLowerCase();
    const email = currentAuthUser?.email?.toLowerCase();
    
    const myTasks = appState.tasks.filter(task => {
        if (task.status === 'done') return false;
        
        // Check by assigneeId (UID)
        if (task.assigneeId && uid && task.assigneeId === uid) return true;
        
        // Check by assignee name (case-insensitive)
        if (task.assignee && displayName && task.assignee.toLowerCase() === displayName) return true;
        if (task.assignee && email && task.assignee.toLowerCase() === email) return true;
        
        // Check if assignee contains the display name or email
        if (task.assignee && displayName && task.assignee.toLowerCase().includes(displayName)) return true;
        
        return false;
    });
    
    if (myTasks.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No tasks assigned to you</p>';
        return;
    }
    
    // Sort by priority and due date
    const sortedTasks = myTasks.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
    }).slice(0, 5); // Show max 5 tasks
    
    container.innerHTML = '';
    sortedTasks.forEach(task => {
        const taskEl = document.createElement('div');
        taskEl.className = `overview-task-item priority-${task.priority}`;
        taskEl.onclick = (e) => {
            if (!e.target.closest('.overview-task-checkbox')) {
                viewTaskDetails && viewTaskDetails(task.id);
            }
        };
        
        // Priority chip text
        const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
        
        taskEl.innerHTML = `
            <div class="overview-task-checkbox" onclick="event.stopPropagation(); toggleTaskFromOverview('${escapeHtml(task.id)}')">
                ${task.status === 'done' ? '<i class="fas fa-check"></i>' : ''}
            </div>
            <div class="overview-task-content">
                <div class="overview-task-title">${escapeHtml(task.title)}</div>
                <div class="overview-task-meta">
                    <span class="priority-chip ${task.priority}">${priorityLabel}</span>
                    ${task.dueDate ? `<span class="due-chip">${formatDueDate(task.dueDate)}</span>` : ''}
                </div>
            </div>
        `;
        container.appendChild(taskEl);
    });
}

function updateOverviewEvents() {
    const container = document.getElementById('overviewEventsList');
    if (!container) return;
    
    // Get upcoming events (next 30 days)
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const upcomingEvents = appState.events.filter(event => {
        // Handle both Date objects and timestamps/strings
        const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
        return eventDate >= now && eventDate <= thirtyDaysFromNow;
    }).sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateA - dateB;
    }).slice(0, 5); // Show max 5 events
    
    if (upcomingEvents.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No upcoming events</p>';
        return;
    }
    
    container.innerHTML = '';
    upcomingEvents.forEach(event => {
        const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
        const timeStr = formatTime24(eventDate.getHours(), eventDate.getMinutes());
        const eventEl = document.createElement('div');
        eventEl.className = 'overview-event-item';
        eventEl.onclick = () => viewEventDetails(event.id);
        eventEl.innerHTML = `
            <div class="overview-event-date">
                <div class="overview-event-day">${eventDate.getDate()}</div>
                <div class="overview-event-month">${eventDate.toLocaleString('en-US', { month: 'short' }).toUpperCase()}</div>
            </div>
            <div class="overview-event-content">
                <div class="overview-event-title">${escapeHtml(event.title)}</div>
                <div class="overview-event-time">${timeStr}</div>
            </div>
        `;
        container.appendChild(eventEl);
    });
}

function formatDueDate(dateStr) {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Overdue';
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return `in ${diffDays} days`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

window.toggleTaskFromOverview = async function(taskId) {
    // Find the task and toggle it
    const task = appState.tasks.find(t => t.id === taskId);
    if (task) {
        const newStatus = task.status === 'done' ? 'todo' : 'done';
        await updateTaskStatus(taskId, newStatus);
        updateOverview();
    }
};

// ===================================
// METRICS COMPUTATION & RENDERING
// ===================================

/**
 * CUSTOMIZABLE METRICS SYSTEM
 * ===========================
 * 
 * Users can add, remove, and reorder custom business metrics.
 * The configuration is stored in team.settings.enabledMetrics.
 * 
 * PERMISSIONS:
 * - Only owners can edit which metrics are shown (add/remove/reorder)
 * - canEditMetrics() checks for owner role before any modification
 * - Visibility of the entire Metrics tab still respects metricsVisibility setting
 * 
 * DATA STRUCTURE:
 * team.settings.enabledMetrics = ['customers', 'revenue', 'leads', ...]
 * Each string references a metric ID from CUSTOM_METRICS_CATALOG
 * 
 * SECURITY NOTES:
 * 1. Edit button only shown to users where canEditMetrics() returns true (owner)
 * 2. All modification functions (add, remove, reorder) check canEditMetrics() first
 * 3. Firestore rules allow owners to update any settings field
 * 4. Custom metrics use placeholder data - no actual user data is exposed
 * 5. Custom metrics section respects same visibility as rest of Metrics tab
 * 6. No member names or private data are included in custom metric displays
 */

/**
 * Catalog of available custom metrics that can be added to the dashboard
 * Each metric has:
 * - id: unique identifier (stored in enabledMetrics array)
 * - name: display name
 * - description: shown in the add modal
 * - icon: FontAwesome icon class
 * - color: CSS color class (success, warning, danger, or empty for default)
 * - getValue: function that returns { value, subtitle, tooltip } with real data
 * - hasChart: whether to show a mini trend chart
 */
const CUSTOM_METRICS_CATALOG = {
    totalRevenue: {
        id: 'totalRevenue',
        name: 'Total Revenue',
        description: 'Track all-time income from transactions',
        icon: 'fa-dollar-sign',
        color: 'success',
        getValue: () => {
            const financeData = getFinanceMetricsData();
            return {
                value: formatCurrency(financeData.totalIncome),
                subtitle: `YTD: ${formatCurrency(financeData.ytdIncome)}`,
                tooltip: 'Total revenue from all recorded transactions'
            };
        },
        hasChart: true,
        chartData: () => generateFinanceTrendData('income')
    },
    totalExpenses: {
        id: 'totalExpenses',
        name: 'Total Expenses',
        description: 'Track all-time expenses',
        icon: 'fa-receipt',
        color: 'danger',
        getValue: () => {
            const financeData = getFinanceMetricsData();
            return {
                value: formatCurrency(financeData.totalExpenses),
                subtitle: `YTD: ${formatCurrency(financeData.ytdExpenses)}`,
                tooltip: 'Total expenses from all recorded transactions'
            };
        },
        hasChart: true,
        chartData: () => generateFinanceTrendData('expense')
    },
    netProfit: {
        id: 'netProfit',
        name: 'Net Profit',
        description: 'Revenue minus expenses',
        icon: 'fa-chart-line',
        color: '',
        getValue: () => {
            const financeData = getFinanceMetricsData();
            const isPositive = financeData.netBalance >= 0;
            return {
                value: formatCurrency(financeData.netBalance),
                subtitle: isPositive ? 'Profitable' : 'In deficit',
                tooltip: 'Net balance: Total income minus total expenses'
            };
        },
        hasChart: false
    },
    mrr: {
        id: 'mrr',
        name: 'Monthly Recurring Revenue',
        description: 'Track recurring monthly income',
        icon: 'fa-sync-alt',
        color: 'success',
        getValue: () => {
            const financeData = getFinanceMetricsData();
            return {
                value: formatCurrency(financeData.mrr),
                subtitle: `ARR: ${formatCurrency(financeData.mrr * 12)}`,
                tooltip: 'Monthly recurring revenue from subscriptions'
            };
        },
        hasChart: false
    },
    topCustomer: {
        id: 'topCustomer',
        name: 'Top Customer',
        description: 'Your highest-revenue customer',
        icon: 'fa-crown',
        color: 'warning',
        getValue: () => {
            const financeData = getFinanceMetricsData();
            return {
                value: financeData.mainCustomer || 'N/A',
                subtitle: financeData.mainCustomer ? formatCurrency(financeData.mainCustomerTotal) : 'No customers yet',
                tooltip: 'Customer with highest total revenue'
            };
        },
        hasChart: false
    },
    customers: {
        id: 'customers',
        name: 'Number of Customers',
        description: 'Track unique customer count from transactions',
        icon: 'fa-users',
        color: '',
        getValue: () => {
            const uniqueCustomers = getUniqueCustomerCount();
            return {
                value: uniqueCustomers.toLocaleString(),
                subtitle: uniqueCustomers === 1 ? '1 customer' : `${uniqueCustomers} customers`,
                tooltip: 'Unique customers from revenue transactions'
            };
        },
        hasChart: false
    },
    leads: {
        id: 'leads',
        name: 'Leads Generated',
        description: 'Track new leads and prospects',
        icon: 'fa-user-plus',
        color: '',
        getValue: () => {
            // Always pull from Leads sheets
            const allLeads = getAllLeadsFromTables();
            const leadCount = allLeads.length;
            return {
                value: leadCount.toLocaleString(),
                subtitle: leadCount === 0 ? 'No leads yet' : `${leadCount} in pipeline`,
                tooltip: 'Total leads from Leads sheets'
            };
        },
        hasChart: false
    },
    conversion: {
        id: 'conversion',
        name: 'Conversion Rate',
        description: 'Track lead to customer conversion',
        icon: 'fa-percentage',
        color: 'success',
        getValue: () => {
            const allLeads = getAllLeadsFromTables();
            const leadCount = allLeads.length;
            const customerCount = getUniqueCustomerCount();
            
            // Handle edge cases logically
            if (leadCount === 0 && customerCount === 0) {
                return {
                    value: '—',
                    subtitle: 'No leads or customers yet',
                    tooltip: 'Add leads to track conversion'
                };
            }
            
            if (leadCount === 0 && customerCount > 0) {
                return {
                    value: '—',
                    subtitle: `${customerCount} customers (no leads tracked)`,
                    tooltip: 'Add leads to calculate conversion rate'
                };
            }
            
            const rate = ((customerCount / leadCount) * 100).toFixed(1);
            return {
                value: rate + '%',
                subtitle: `${customerCount} customers from ${leadCount} leads`,
                tooltip: 'Percentage of leads converted to customers'
            };
        },
        hasChart: false
    },
    support_tickets: {
        id: 'support_tickets',
        name: 'Support Tickets',
        description: 'Track open support requests',
        icon: 'fa-ticket-alt',
        color: 'warning',
        getValue: () => {
            // Placeholder - could be connected to support system
            return {
                value: '—',
                subtitle: 'Not connected',
                tooltip: 'Connect a support system to track tickets'
            };
        },
        hasChart: false
    },
    nps_score: {
        id: 'nps_score',
        name: 'NPS Score',
        description: 'Net Promoter Score from surveys',
        icon: 'fa-smile',
        color: 'success',
        getValue: () => {
            // Placeholder - could be connected to survey system
            return {
                value: '—',
                subtitle: 'Not connected',
                tooltip: 'Connect a survey system to track NPS'
            };
        },
        hasChart: false
    }
};

/**
 * Get unique customer count from transactions
 */
function getUniqueCustomerCount() {
    if (!appState.transactions) return 0;
    const customers = new Set();
    appState.transactions.forEach(t => {
        if (t.type === 'income' && t.party) {
            customers.add(t.party.toLowerCase().trim());
        }
    });
    return customers.size;
}

/**
 * Generate trend data from actual finance transactions
 */
function generateFinanceTrendData(type = 'income') {
    if (!appState.transactions || appState.transactions.length === 0) {
        return generatePlaceholderTrendData(7, 0, 0);
    }
    
    const now = new Date();
    const data = [];
    
    // Get last 7 days of data
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dayStart = new Date(date.setHours(0, 0, 0, 0));
        const dayEnd = new Date(date.setHours(23, 59, 59, 999));
        
        let dayTotal = 0;
        appState.transactions.forEach(t => {
            if (t.type === type) {
                const transDate = t.date?.toDate?.() || new Date(t.date);
                if (transDate >= dayStart && transDate <= dayEnd) {
                    dayTotal += t.amount || 0;
                }
            }
        });
        
        data.push({
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            value: dayTotal
        });
    }
    
    return data;
}

/**
 * Generate placeholder trend data for charts
 * @param {number} days - Number of days
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 */
function generatePlaceholderTrendData(days, min, max) {
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        data.push({
            date: date,
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            count: Math.floor(Math.random() * (max - min)) + min
        });
    }
    return data;
}

/**
 * State for metrics edit mode
 */
let metricsEditMode = false;

/**
 * Get the enabled custom metrics for the current team
 * @returns {string[]} Array of metric IDs
 */
function getEnabledCustomMetrics() {
    return appState.currentTeamData?.settings?.enabledMetrics || [];
}

/**
 * Check if user can edit metrics (owner only)
 * @returns {boolean}
 */
function canEditMetrics() {
    const userRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    return userRole === 'owner';
}

/**
 * Toggle metrics edit mode
 */
function toggleMetricsEditMode() {
    if (!canEditMetrics()) {
        showToast('Only the team owner can edit metrics', 'error');
        return;
    }
    metricsEditMode = !metricsEditMode;
    renderMetrics();
}

// Expose to global scope
window.toggleMetricsEditMode = toggleMetricsEditMode;

// ===================================
// METRICS CHART CONFIG SYSTEM
// Per-graph customization (Y-axis, colors, data source, etc.)
// ===================================

/**
 * Available colors for chart customization
 * Apple-inspired palette
 */
const CHART_COLOR_OPTIONS = [
    { id: 'accent', label: 'Blue', value: 'var(--accent)', preview: '#007AFF' },
    { id: 'green', label: 'Green', value: '#34C759', preview: '#34C759' },
    { id: 'orange', label: 'Orange', value: '#FF9F0A', preview: '#FF9F0A' },
    { id: 'purple', label: 'Purple', value: '#AF52DE', preview: '#AF52DE' },
    { id: 'red', label: 'Red', value: '#FF3B30', preview: '#FF3B30' },
    { id: 'teal', label: 'Teal', value: '#5AC8FA', preview: '#5AC8FA' },
    { id: 'pink', label: 'Pink', value: '#FF2D55', preview: '#FF2D55' },
    { id: 'indigo', label: 'Indigo', value: '#5856D6', preview: '#5856D6' }
];

/**
 * Pie chart palette themes
 * Each theme provides an ordered list of colors for pie segments
 */
const PIE_PALETTE_OPTIONS = [
    { 
        id: 'default', 
        label: 'Default', 
        colors: ['var(--accent)', '#34C759', '#FF9F0A', '#AF52DE', '#FF3B30', '#5AC8FA', '#FF2D55', '#64D2FF']
    },
    { 
        id: 'ocean', 
        label: 'Ocean', 
        colors: ['#007AFF', '#5AC8FA', '#64D2FF', '#00C7BE', '#30D158', '#34C759', '#A2845E', '#8E8E93']
    },
    { 
        id: 'sunset', 
        label: 'Sunset', 
        colors: ['#FF9F0A', '#FF3B30', '#FF2D55', '#AF52DE', '#BF5AF2', '#FF6482', '#FFD60A', '#FF9500']
    },
    { 
        id: 'forest', 
        label: 'Forest', 
        colors: ['#34C759', '#30D158', '#00C7BE', '#32ADE6', '#007AFF', '#5856D6', '#AF52DE', '#A2845E']
    },
    {
        id: 'monochrome',
        label: 'Monochrome',
        colors: ['var(--accent)', 'var(--accent-hover)', '#5AC8FA', '#64D2FF', '#8E8E93', '#AEAEB2', '#C7C7CC', '#D1D1D6']
    }
];

/**
 * Tick density presets
 * Maps to number of Y-axis ticks
 */
const TICK_DENSITY_OPTIONS = [
    { id: 'compact', label: 'Compact', ticks: 3 },
    { id: 'normal', label: 'Normal', ticks: 4 },
    { id: 'detailed', label: 'Detailed', ticks: 6 }
];

/**
 * Available data sources for metrics
 * These define what data a chart can display
 */
const DATA_SOURCE_OPTIONS = [
    { id: 'personal-tasks', label: 'My Task Completions', sourceType: 'tasks', metricKey: 'personal' },
    { id: 'team-tasks', label: 'Team Task Completions', sourceType: 'tasks', metricKey: 'team' },
    { id: 'task-status', label: 'Task Status Distribution', sourceType: 'tasks', metricKey: 'status' },
    { id: 'events-week', label: 'Events This Week', sourceType: 'events', metricKey: 'weekly' },
    { id: 'messages-week', label: 'Messages This Week', sourceType: 'messages', metricKey: 'weekly' },
    { id: 'custom', label: 'Custom Data', sourceType: 'custom', metricKey: null }
];

/**
 * Default chart configuration
 */
const DEFAULT_CHART_CONFIG = {
    type: 'bar',
    yAxis: {
        mode: 'auto', // 'auto' | 'custom'
        min: 0,
        max: null, // null = auto
        step: null, // null = auto
        tickDensity: 'normal' // 'compact' | 'normal' | 'detailed'
    },
    colors: {
        primary: 'var(--accent)',
        secondary: '#34C759',
        palette: 'default' // For pie charts
    },
    source: {
        type: 'tasks',
        id: null,
        metricKey: null
    }
};

/**
 * Debounce timer for saving chart config
 */
let chartConfigSaveTimer = null;

/**
 * Load metrics chart configuration from team settings
 * @param {string} teamId - Team ID
 */
function loadMetricsChartConfig(teamId) {
    const config = appState.currentTeamData?.settings?.metricsChartConfig || {};
    appState.metricsChartConfig = config;
    
    // Also load saved graph types from config
    Object.keys(config).forEach(chartId => {
        if (config[chartId].type) {
            appState.graphTypes[chartId] = config[chartId].type;
        }
    });
}

/**
 * Get chart configuration for a specific chart
 * Falls back to defaults if not configured
 * Handles backward compatibility with old flat config structure
 * @param {string} chartId - Unique chart identifier
 * @returns {Object} Chart configuration (flat for rendering, nested for storage)
 */
function getChartConfig(chartId) {
    const savedConfig = appState.metricsChartConfig[chartId] || {};
    const chartType = appState.graphTypes[chartId] || savedConfig.type || 'bar';
    
    // Handle backward compatibility: convert old flat structure to new nested
    // Old format: { yAxisMin, yAxisMax, yAxisStep, primaryColor, secondaryColor }
    // New format: { type, yAxis: {...}, colors: {...}, source: {...} }
    
    let yAxis, colors, source;
    
    // Check if it's new format (has yAxis object) or old format
    if (savedConfig.yAxis) {
        yAxis = { ...DEFAULT_CHART_CONFIG.yAxis, ...savedConfig.yAxis };
    } else {
        // Old format - convert
        yAxis = {
            mode: (savedConfig.yAxisMax !== null && savedConfig.yAxisMax !== undefined) ? 'custom' : 'auto',
            min: savedConfig.yAxisMin ?? DEFAULT_CHART_CONFIG.yAxis.min,
            max: savedConfig.yAxisMax ?? DEFAULT_CHART_CONFIG.yAxis.max,
            step: savedConfig.yAxisStep ?? DEFAULT_CHART_CONFIG.yAxis.step,
            tickDensity: savedConfig.tickDensity || DEFAULT_CHART_CONFIG.yAxis.tickDensity
        };
    }
    
    if (savedConfig.colors) {
        colors = { ...DEFAULT_CHART_CONFIG.colors, ...savedConfig.colors };
    } else {
        // Old format - convert
        colors = {
            primary: savedConfig.primaryColor || DEFAULT_CHART_CONFIG.colors.primary,
            secondary: savedConfig.secondaryColor || DEFAULT_CHART_CONFIG.colors.secondary,
            palette: savedConfig.palette || DEFAULT_CHART_CONFIG.colors.palette
        };
    }
    
    source = savedConfig.source ? { ...DEFAULT_CHART_CONFIG.source, ...savedConfig.source } : { ...DEFAULT_CHART_CONFIG.source };
    
    // Return flat format for easy use in rendering functions
    return {
        type: chartType,
        // Flat Y-axis props for backward compat with rendering
        yAxisMin: yAxis.min,
        yAxisMax: yAxis.mode === 'auto' ? null : yAxis.max,
        yAxisStep: yAxis.step,
        yAxisMode: yAxis.mode,
        tickDensity: yAxis.tickDensity,
        // Flat color props for backward compat
        primaryColor: colors.primary,
        secondaryColor: colors.secondary,
        palette: colors.palette,
        // Source info
        sourceType: source.type,
        sourceId: source.id,
        metricKey: source.metricKey,
        // Also include nested structure for settings panel
        _nested: {
            type: chartType,
            yAxis,
            colors,
            source
        }
    };
}

/**
 * Update chart configuration (local state + debounced save)
 * @param {string} chartId - Unique chart identifier
 * @param {Object} updates - Config properties to update (can be flat or nested)
 */
function updateChartConfig(chartId, updates) {
    if (!canEditMetrics()) return;
    
    // Initialize config for this chart if needed
    if (!appState.metricsChartConfig[chartId]) {
        appState.metricsChartConfig[chartId] = {
            type: 'bar',
            yAxis: { ...DEFAULT_CHART_CONFIG.yAxis },
            colors: { ...DEFAULT_CHART_CONFIG.colors },
            source: { ...DEFAULT_CHART_CONFIG.source }
        };
    }
    
    const config = appState.metricsChartConfig[chartId];
    
    // Handle flat updates by mapping to nested structure
    if ('type' in updates) {
        config.type = updates.type;
        appState.graphTypes[chartId] = updates.type;
    }
    
    // Y-axis updates
    if ('yAxisMin' in updates) {
        if (!config.yAxis) config.yAxis = { ...DEFAULT_CHART_CONFIG.yAxis };
        config.yAxis.min = updates.yAxisMin;
    }
    if ('yAxisMax' in updates) {
        if (!config.yAxis) config.yAxis = { ...DEFAULT_CHART_CONFIG.yAxis };
        config.yAxis.max = updates.yAxisMax;
        config.yAxis.mode = updates.yAxisMax !== null ? 'custom' : 'auto';
    }
    if ('yAxisStep' in updates) {
        if (!config.yAxis) config.yAxis = { ...DEFAULT_CHART_CONFIG.yAxis };
        config.yAxis.step = updates.yAxisStep;
    }
    if ('yAxisMode' in updates) {
        if (!config.yAxis) config.yAxis = { ...DEFAULT_CHART_CONFIG.yAxis };
        config.yAxis.mode = updates.yAxisMode;
        if (updates.yAxisMode === 'auto') {
            config.yAxis.max = null;
        }
    }
    if ('tickDensity' in updates) {
        if (!config.yAxis) config.yAxis = { ...DEFAULT_CHART_CONFIG.yAxis };
        config.yAxis.tickDensity = updates.tickDensity;
    }
    
    // Color updates
    if ('primaryColor' in updates) {
        if (!config.colors) config.colors = { ...DEFAULT_CHART_CONFIG.colors };
        config.colors.primary = updates.primaryColor;
    }
    if ('secondaryColor' in updates) {
        if (!config.colors) config.colors = { ...DEFAULT_CHART_CONFIG.colors };
        config.colors.secondary = updates.secondaryColor;
    }
    if ('palette' in updates) {
        if (!config.colors) config.colors = { ...DEFAULT_CHART_CONFIG.colors };
        config.colors.palette = updates.palette;
    }
    
    // Source updates
    if ('sourceType' in updates) {
        if (!config.source) config.source = { ...DEFAULT_CHART_CONFIG.source };
        config.source.type = updates.sourceType;
    }
    if ('sourceId' in updates) {
        if (!config.source) config.source = { ...DEFAULT_CHART_CONFIG.source };
        config.source.id = updates.sourceId;
    }
    if ('metricKey' in updates) {
        if (!config.source) config.source = { ...DEFAULT_CHART_CONFIG.source };
        config.source.metricKey = updates.metricKey;
    }
    
    // Re-render the specific chart
    rerenderSingleChart(chartId);
    
    // Debounced save to Firestore
    if (chartConfigSaveTimer) {
        clearTimeout(chartConfigSaveTimer);
    }
    chartConfigSaveTimer = setTimeout(() => {
        saveMetricsChartConfigToFirestore();
    }, 600);
}

/**
 * Save all chart config to Firestore
 */
async function saveMetricsChartConfigToFirestore() {
    if (!canEditMetrics() || !appState.currentTeamId) return;
    
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        await updateDoc(teamRef, {
            'settings.metricsChartConfig': appState.metricsChartConfig
        });
        
        // Update local team data
        if (!appState.currentTeamData.settings) {
            appState.currentTeamData.settings = {};
        }
        appState.currentTeamData.settings.metricsChartConfig = appState.metricsChartConfig;
        
        debugLog('✅ Chart config saved to Firestore');
    } catch (error) {
        console.error('Error saving chart config:', error);
        showToast('Failed to save chart settings', 'error');
    }
}

/**
 * Reset chart configuration to defaults
 * @param {string} chartId - Unique chart identifier
 */
function resetChartConfig(chartId) {
    if (!canEditMetrics()) return;
    
    // Remove the custom config
    delete appState.metricsChartConfig[chartId];
    
    // Reset graph type to default
    delete appState.graphTypes[chartId];
    
    // Re-render the chart
    rerenderSingleChart(chartId);
    
    // Save to Firestore
    if (chartConfigSaveTimer) {
        clearTimeout(chartConfigSaveTimer);
    }
    chartConfigSaveTimer = setTimeout(() => {
        saveMetricsChartConfigToFirestore();
    }, 300);
    
    // Close the settings panel
    closeGraphSettings(chartId);
    
    showToast('Chart reset to defaults', 'success');
}

/**
 * Re-render a single chart without re-rendering the entire metrics page
 * @param {string} chartId - Unique chart identifier
 */
function rerenderSingleChart(chartId) {
    const container = document.querySelector(`[data-graph-id="${chartId}"] .graph-content`);
    if (!container) return;
    
    const card = container.closest('.metrics-card');
    const dataAttr = card?.dataset.graphData;
    const dataType = card?.dataset.graphDataType || 'trend';
    
    if (!dataAttr) return;
    
    try {
        const data = JSON.parse(dataAttr);
        const config = getChartConfig(chartId);
        const type = config.type || getGraphType(chartId);
        
        // Animate transition
        container.style.opacity = '0';
        container.style.transform = 'scale(0.98)';
        
        setTimeout(() => {
            container.innerHTML = renderGraphByTypeWithConfig(data, type, dataType, config);
            container.style.opacity = '1';
            container.style.transform = 'scale(1)';
        }, 150);
    } catch (e) {
        console.error('Error re-rendering chart:', e);
    }
}

/**
 * Toggle graph settings panel visibility
 * @param {string} chartId - Unique chart identifier
 */
function toggleGraphSettings(chartId) {
    const panel = document.querySelector(`[data-settings-chart="${chartId}"]`);
    if (!panel) return;
    
    const isOpen = panel.classList.contains('open');
    
    // Close all other panels first
    document.querySelectorAll('.graph-settings-panel.open').forEach(p => {
        if (p.dataset.settingsChart !== chartId) {
            p.classList.remove('open');
        }
    });
    
    // Toggle this panel
    panel.classList.toggle('open', !isOpen);
}

/**
 * Close graph settings panel
 * @param {string} chartId - Unique chart identifier
 */
function closeGraphSettings(chartId) {
    const panel = document.querySelector(`[data-settings-chart="${chartId}"]`);
    if (panel) {
        panel.classList.remove('open');
    }
}

/**
 * Handle chart config input change
 * @param {string} chartId - Chart identifier
 * @param {string} field - Config field name
 * @param {any} value - New value
 */
function handleChartConfigChange(chartId, field, value) {
    // Validate and convert value based on field
    let processedValue = value;
    
    if (field === 'yAxisMin' || field === 'yAxisMax' || field === 'yAxisStep') {
        // Convert to number or null
        if (value === '' || value === null) {
            processedValue = null;
        } else {
            processedValue = parseFloat(value);
            if (isNaN(processedValue)) processedValue = null;
        }
        
        // Validation
        if (field === 'yAxisMin' && processedValue !== null && processedValue < 0) {
            processedValue = 0; // Count metrics should not go below 0
        }
        if (field === 'yAxisStep' && processedValue !== null && processedValue <= 0) {
            processedValue = null; // Step must be positive
        }
    }
    
    updateChartConfig(chartId, { [field]: processedValue });
}

// Expose functions to window for onclick handlers
window.toggleGraphSettings = toggleGraphSettings;
window.closeGraphSettings = closeGraphSettings;
window.handleChartConfigChange = handleChartConfigChange;
window.resetChartConfig = resetChartConfig;
window.updateChartConfig = updateChartConfig;

/**
 * Open the Add Metric modal
 */
function openAddMetricModal() {
    if (!canEditMetrics()) return;
    
    const enabledMetrics = getEnabledCustomMetrics();
    const availableMetrics = Object.values(CUSTOM_METRICS_CATALOG)
        .filter(m => !enabledMetrics.includes(m.id));
    
    if (availableMetrics.length === 0) {
        showToast('All available metrics have been added', 'info');
        return;
    }
    
    // Build modal HTML
    let metricsListHTML = availableMetrics.map(m => `
        <div class="add-metric-option" data-metric-id="${m.id}" onclick="addCustomMetric('${m.id}')">
            <div class="add-metric-option-icon">
                <i class="fas ${m.icon}"></i>
            </div>
            <div class="add-metric-option-content">
                <div class="add-metric-option-name">${m.name}</div>
                <div class="add-metric-option-desc">${m.description}</div>
            </div>
            <div class="add-metric-option-action">
                <i class="fas fa-plus"></i>
            </div>
        </div>
    `).join('');
    
    const modalHTML = `
        <div class="modal active" id="addMetricModal">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2>Add Metric</h2>
                    <button class="modal-close" onclick="closeModal('addMetricModal')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 16px 24px; max-height: 400px; overflow-y: auto;">
                    <p style="color: var(--text-muted); margin-bottom: 16px;">
                        Select a metric to add to your dashboard. These are placeholder metrics that will connect to real data in the future.
                    </p>
                    <div class="add-metric-list">
                        ${metricsListHTML}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existing = document.getElementById('addMetricModal');
    if (existing) existing.remove();
    
    // Add modal to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.openAddMetricModal = openAddMetricModal;

/**
 * Add a custom metric to the enabled list
 * @param {string} metricId - The metric ID to add
 */
async function addCustomMetric(metricId) {
    if (!canEditMetrics()) return;
    if (!CUSTOM_METRICS_CATALOG[metricId]) return;
    
    const enabledMetrics = [...getEnabledCustomMetrics()];
    if (enabledMetrics.includes(metricId)) {
        showToast('This metric is already added', 'info');
        return;
    }
    
    enabledMetrics.push(metricId);
    
    try {
        await saveEnabledMetrics(enabledMetrics);
        closeModal('addMetricModal');
        showToast(`Added "${CUSTOM_METRICS_CATALOG[metricId].name}"`, 'success');
        renderMetrics();
    } catch (error) {
        console.error('Error adding metric:', error);
        showToast('Failed to add metric. Please try again.', 'error');
    }
}

window.addCustomMetric = addCustomMetric;

/**
 * Remove a custom metric from the enabled list
 * @param {string} metricId - The metric ID to remove
 */
async function removeCustomMetric(metricId) {
    if (!canEditMetrics()) return;
    
    const enabledMetrics = getEnabledCustomMetrics().filter(id => id !== metricId);
    
    try {
        await saveEnabledMetrics(enabledMetrics);
        showToast(`Removed metric`, 'success');
        renderMetrics();
    } catch (error) {
        console.error('Error removing metric:', error);
        showToast('Failed to remove metric. Please try again.', 'error');
    }
}

window.removeCustomMetric = removeCustomMetric;

/**
 * Move a metric up or down in the order
 * @param {string} metricId - The metric ID to move
 * @param {string} direction - 'up' or 'down'
 */
async function reorderCustomMetric(metricId, direction) {
    if (!canEditMetrics()) return;
    
    const enabledMetrics = [...getEnabledCustomMetrics()];
    const currentIndex = enabledMetrics.indexOf(metricId);
    
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0 || newIndex >= enabledMetrics.length) return;
    
    // Swap positions
    [enabledMetrics[currentIndex], enabledMetrics[newIndex]] = 
        [enabledMetrics[newIndex], enabledMetrics[currentIndex]];
    
    try {
        await saveEnabledMetrics(enabledMetrics);
        renderMetrics();
    } catch (error) {
        console.error('Error reordering metrics:', error);
        showToast('Failed to reorder metrics. Please try again.', 'error');
    }
}

window.reorderCustomMetric = reorderCustomMetric;

/**
 * Save enabled metrics to Firestore
 * @param {string[]} enabledMetrics - Array of metric IDs
 */
async function saveEnabledMetrics(enabledMetrics) {
    if (!db || !appState.currentTeamId) {
        throw new Error('Database not available');
    }
    
    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
    const teamRef = doc(db, 'teams', appState.currentTeamId);
    
    await updateDoc(teamRef, {
        'settings.enabledMetrics': enabledMetrics
    });
    
    // Update local state
    if (!appState.currentTeamData.settings) {
        appState.currentTeamData.settings = {};
    }
    appState.currentTeamData.settings.enabledMetrics = enabledMetrics;
}

/**
 * Render a custom metric card
 * @param {Object} metric - The metric config from CUSTOM_METRICS_CATALOG
 * @param {number} index - The index in the enabled list
 * @param {number} total - Total number of enabled metrics
 * @returns {string} HTML string
 */
function renderCustomMetricCard(metric, index, total) {
    const data = metric.getValue();
    const editControls = metricsEditMode ? `
        <div class="metric-edit-overlay">
            <div class="metric-edit-actions">
                <button class="metric-edit-btn" onclick="reorderCustomMetric('${metric.id}', 'up')" 
                        ${index === 0 ? 'disabled' : ''} title="Move up">
                    <i class="fas fa-chevron-up"></i>
                </button>
                <button class="metric-edit-btn" onclick="reorderCustomMetric('${metric.id}', 'down')" 
                        ${index === total - 1 ? 'disabled' : ''} title="Move down">
                    <i class="fas fa-chevron-down"></i>
                </button>
                <button class="metric-edit-btn danger" onclick="removeCustomMetric('${metric.id}')" title="Remove">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    ` : '';
    
    const tooltipAttr = data.tooltip ? `data-tooltip="${data.tooltip}"` : '';
    
    return `
        <div class="metrics-stat-card custom-metric-card ${metric.color} ${metricsEditMode ? 'edit-mode' : ''}" ${tooltipAttr}>
            ${editControls}
            <div class="metrics-stat-icon">
                <i class="fas ${metric.icon}"></i>
            </div>
            <div class="metrics-stat-content">
                <div class="metrics-stat-value">${data.value}</div>
                <div class="metrics-stat-label">${metric.name}</div>
                ${data.subtitle ? `<div class="metrics-stat-subtitle">${data.subtitle}</div>` : ''}
            </div>
        </div>
    `;
}

/**
 * METRICS TIME FILTER STATE
 * Tracks the currently selected time range for metrics display.
 * Options: '7days' (Last 7 days), '30days' (Last 30 days), 'all' (All time)
 * This affects the trend charts and some stat card values.
 */
let metricsTimeFilter = '7days';

/**
 * Get time boundaries based on the current filter setting
 * @returns {Object} { start: Date, end: Date, label: string }
 */
function getMetricsTimeBoundaries() {
    const now = new Date();
    const end = now;
    let start;
    let label;
    
    switch (metricsTimeFilter) {
        case '30days':
            start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            label = 'Last 30 Days';
            break;
        case 'all':
            start = new Date(0); // Beginning of time
            label = 'All Time';
            break;
        case '7days':
        default:
            start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            label = 'Last 7 Days';
            break;
    }
    
    return { start, end, label };
}

/**
 * Handle time filter change from the dropdown
 * @param {Event} event - The change event
 */
function handleMetricsTimeFilterChange(event) {
    metricsTimeFilter = event.target.value;
    renderMetrics();
}

/**
 * Helper to parse Firestore timestamp or date string to Date object
 */
function parseMetricsDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
        return dateValue.toDate();
    }
    if (dateValue.seconds) {
        return new Date(dateValue.seconds * 1000);
    }
    return new Date(dateValue);
}

/**
 * Check if a task is assigned to the given user ID
 */
function isTaskAssignedToUser(task, userId) {
    if (!userId) return false;
    
    // Check by assigneeId (UID) - primary method
    if (task.assigneeId && task.assigneeId === userId) return true;
    
    // Also check by createdBy for tasks without explicit assignee
    if (!task.assigneeId && !task.assignee && task.createdBy === userId) return true;
    
    return false;
}

/**
 * Compute personal metrics for the current user
 * @param {Object} state - The appState object
 * @param {string} userId - The current user's UID
 * @returns {Object} Personal metrics
 */
function computePersonalMetrics(state, userId) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Task metrics
    const myTasks = state.tasks.filter(t => isTaskAssignedToUser(t, userId) || t.createdBy === userId);
    const myCompletedTasks = myTasks.filter(t => t.status === 'done');
    
    const completedLast7Days = myCompletedTasks.filter(t => {
        const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
        return completedAt && completedAt >= sevenDaysAgo;
    });
    
    const completedLast30Days = myCompletedTasks.filter(t => {
        const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
        return completedAt && completedAt >= thirtyDaysAgo;
    });
    
    const myOpenTasks = myTasks.filter(t => t.status !== 'done');
    const completionRate = myTasks.length > 0 
        ? Math.round((myCompletedTasks.length / myTasks.length) * 100) 
        : 0;
    
    // Event metrics
    const myEvents = state.events.filter(e => e.createdBy === userId);
    const upcomingEvents = myEvents.filter(e => {
        const eventDate = parseMetricsDate(e.date);
        return eventDate && eventDate >= now;
    });
    const eventsCreatedLast30Days = myEvents.filter(e => {
        const createdAt = parseMetricsDate(e.createdAt);
        return createdAt && createdAt >= thirtyDaysAgo;
    });
    
    // Chat metrics
    const myMessages = state.messages.filter(m => m.userId === userId);
    const messagesLast7Days = myMessages.filter(m => {
        const createdAt = parseMetricsDate(m.createdAt);
        return createdAt && createdAt >= sevenDaysAgo;
    });
    
    // Activity metrics
    const myActivities = state.activities.filter(a => a.userId === userId);
    const activitiesLast7Days = myActivities.filter(a => {
        const timestamp = a.timestamp instanceof Date ? a.timestamp : parseMetricsDate(a.createdAt);
        return timestamp && timestamp >= sevenDaysAgo;
    });
    
    // Daily breakdown based on time filter (for trend chart)
    const timeBounds = getMetricsTimeBoundaries();
    const daysToShow = metricsTimeFilter === '7days' ? 7 : (metricsTimeFilter === '30days' ? 30 : 14);
    
    const dailyCompletions = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        const count = myCompletedTasks.filter(t => {
            const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
            return completedAt && completedAt >= dayStart && completedAt <= dayEnd;
        }).length;
        
        // Use shorter label format for 30 days
        const labelFormat = daysToShow > 7 
            ? { month: 'numeric', day: 'numeric' } 
            : { weekday: 'short' };
        
        dailyCompletions.push({
            date: dayStart,
            label: dayStart.toLocaleDateString('en-US', labelFormat),
            count
        });
    }
    
    return {
        tasks: {
            total: myTasks.length,
            completed: myCompletedTasks.length,
            open: myOpenTasks.length,
            completedLast7Days: completedLast7Days.length,
            completedLast30Days: completedLast30Days.length,
            completionRate
        },
        events: {
            total: myEvents.length,
            upcoming: upcomingEvents.length,
            createdLast30Days: eventsCreatedLast30Days.length
        },
        messages: {
            total: myMessages.length,
            last7Days: messagesLast7Days.length
        },
        activities: {
            total: myActivities.length,
            last7Days: activitiesLast7Days.length
        },
        trends: {
            dailyCompletions
        }
    };
}

/**
 * Compute team-wide metrics
 * @param {Object} state - The appState object
 * @returns {Object} Team metrics
 */
function computeTeamMetrics(state) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    // Task metrics
    const allTasks = state.tasks;
    const completedTasks = allTasks.filter(t => t.status === 'done');
    const openTasks = allTasks.filter(t => t.status !== 'done');
    
    const completedLast7Days = completedTasks.filter(t => {
        const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
        return completedAt && completedAt >= sevenDaysAgo;
    });
    
    const completedLast30Days = completedTasks.filter(t => {
        const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
        return completedAt && completedAt >= thirtyDaysAgo;
    });
    
    const teamCompletionRate = allTasks.length > 0
        ? Math.round((completedTasks.length / allTasks.length) * 100)
        : 0;
    
    // Per-member task breakdown
    const memberTaskBreakdown = {};
    state.teammates.forEach(member => {
        const memberTasks = allTasks.filter(t => isTaskAssignedToUser(t, member.id) || t.createdBy === member.id);
        const memberCompleted = memberTasks.filter(t => t.status === 'done');
        memberTaskBreakdown[member.id] = {
            name: member.name,
            total: memberTasks.length,
            completed: memberCompleted.length,
            completionRate: memberTasks.length > 0 
                ? Math.round((memberCompleted.length / memberTasks.length) * 100) 
                : 0
        };
    });
    
    // Event metrics
    const upcomingEventsThisWeek = state.events.filter(e => {
        const eventDate = parseMetricsDate(e.date);
        return eventDate && eventDate >= now && eventDate <= weekFromNow;
    });
    
    // Chat metrics
    const messagesLast7Days = state.messages.filter(m => {
        const createdAt = parseMetricsDate(m.createdAt);
        return createdAt && createdAt >= sevenDaysAgo;
    });
    
    // Daily breakdown for team based on time filter
    const daysToShow = metricsTimeFilter === '7days' ? 7 : (metricsTimeFilter === '30days' ? 30 : 14);
    
    const dailyCompletions = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        const count = completedTasks.filter(t => {
            const completedAt = parseMetricsDate(t.completedAt || t.updatedAt);
            return completedAt && completedAt >= dayStart && completedAt <= dayEnd;
        }).length;
        
        // Use shorter label format for 30 days
        const labelFormat = daysToShow > 7 
            ? { month: 'numeric', day: 'numeric' } 
            : { weekday: 'short' };
        
        dailyCompletions.push({
            date: dayStart,
            label: dayStart.toLocaleDateString('en-US', labelFormat),
            count
        });
    }
    
    return {
        tasks: {
            total: allTasks.length,
            completed: completedTasks.length,
            open: openTasks.length,
            completedLast7Days: completedLast7Days.length,
            completedLast30Days: completedLast30Days.length,
            completionRate: teamCompletionRate
        },
        memberBreakdown: memberTaskBreakdown,
        events: {
            total: state.events.length,
            upcomingThisWeek: upcomingEventsThisWeek.length
        },
        messages: {
            total: state.messages.length,
            last7Days: messagesLast7Days.length
        },
        memberCount: state.teammates.length,
        trends: {
            dailyCompletions
        }
    };
}

// ===================================
// LEADS AGGREGATION
// Collects leads from all 'leads' type spreadsheets
// ===================================

/**
 * Get all leads from leads-type spreadsheets
 * @returns {Array} Array of all leads from all leads tables
 */
function getAllLeadsFromTables() {
    if (!appState.spreadsheets || !appState.tasks) return [];
    
    // Find all leads-type spreadsheets
    const leadsSpreadsheets = appState.spreadsheets.filter(s => s.type === 'leads');
    if (leadsSpreadsheets.length === 0) return [];
    
    const leadsSpreadsheetIds = new Set(leadsSpreadsheets.map(s => s.id));
    
    // Get all tasks (which may include leads) that belong to leads spreadsheets
    const allLeads = appState.tasks.filter(task => 
        task.spreadsheetId && leadsSpreadsheetIds.has(task.spreadsheetId)
    );
    
    return allLeads;
}

/**
 * Deduplicate leads by leadName or contact field
 * @param {Array} leads - Array of lead objects
 * @returns {Array} Deduplicated leads (keeping the most recent version)
 */
function deduplicateLeads(leads) {
    if (!leads || leads.length === 0) return [];
    
    const seenLeads = new Map();
    
    // Sort by createdAt descending (newest first) to keep most recent on conflict
    const sortedLeads = [...leads].sort((a, b) => {
        const dateA = a.createdAt || a.updatedAt || 0;
        const dateB = b.createdAt || b.updatedAt || 0;
        return dateB - dateA;
    });
    
    for (const lead of sortedLeads) {
        // Create a unique key from leadName + contact (normalized)
        const name = (lead.leadName || lead.title || '').trim().toLowerCase();
        const contact = (lead.contact || '').trim().toLowerCase();
        const key = `${name}|${contact}`;
        
        // Only add if not seen or if both name and contact are empty (allow duplicates with no identifiers)
        if (key === '|' || !seenLeads.has(key)) {
            seenLeads.set(key, lead);
        }
    }
    
    return Array.from(seenLeads.values());
}

/**
 * Compute leads metrics for display
 * @returns {Object} Leads metrics including counts, value totals, and breakdowns
 */
function computeLeadsMetrics() {
    const allLeads = getAllLeadsFromTables();
    const leads = deduplicateLeads(allLeads);
    
    // Store in appState for access elsewhere
    appState.leads = leads;
    
    if (leads.length === 0) {
        return {
            total: 0,
            totalValue: 0,
            byStatus: {},
            bySource: {},
            recentLeads: [],
            trends: []
        };
    }
    
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Count by status
    const byStatus = {};
    leads.forEach(lead => {
        const status = lead.status || 'New';
        byStatus[status] = (byStatus[status] || 0) + 1;
    });
    
    // Count by source
    const bySource = {};
    leads.forEach(lead => {
        const source = lead.source || 'Unknown';
        bySource[source] = (bySource[source] || 0) + 1;
    });
    
    // Total value
    const totalValue = leads.reduce((sum, lead) => sum + (parseFloat(lead.value) || 0), 0);
    
    // Recent leads (last 7 days)
    const recentLeads = leads.filter(lead => {
        const createdAt = lead.createdAt ? new Date(lead.createdAt) : null;
        return createdAt && createdAt >= sevenDaysAgo;
    });
    
    // Leads created in last 30 days
    const leadsLast30Days = leads.filter(lead => {
        const createdAt = lead.createdAt ? new Date(lead.createdAt) : null;
        return createdAt && createdAt >= thirtyDaysAgo;
    });
    
    // Daily breakdown for trends
    const daysToShow = metricsTimeFilter === '7days' ? 7 : (metricsTimeFilter === '30days' ? 30 : 14);
    const dailyLeads = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        const count = leads.filter(lead => {
            const createdAt = lead.createdAt ? new Date(lead.createdAt) : null;
            return createdAt && createdAt >= dayStart && createdAt <= dayEnd;
        }).length;
        
        const labelFormat = daysToShow > 7 
            ? { month: 'numeric', day: 'numeric' } 
            : { weekday: 'short' };
        
        dailyLeads.push({
            date: dayStart,
            label: dayStart.toLocaleDateString('en-US', labelFormat),
            count
        });
    }
    
    return {
        total: leads.length,
        totalRaw: allLeads.length, // Before deduplication
        duplicatesRemoved: allLeads.length - leads.length,
        totalValue: totalValue,
        byStatus: byStatus,
        bySource: bySource,
        recentCount: recentLeads.length,
        last30DaysCount: leadsLast30Days.length,
        trends: dailyLeads
    };
}

// Make leads functions accessible globally
window.getAllLeadsFromTables = getAllLeadsFromTables;
window.deduplicateLeads = deduplicateLeads;
window.computeLeadsMetrics = computeLeadsMetrics;

/**
 * Render a progress ring (circular progress indicator)
 * Apple-inspired thin stroke with smooth animation
 */
function createProgressRing(percent, size = 72, strokeWidth = 4, color = 'var(--accent)') {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (percent / 100) * circumference;
    
    // Subtle gradient ID for uniqueness
    const gradientId = `ring-gradient-${Math.random().toString(36).substr(2, 9)}`;
    
    return `
        <svg class="progress-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <defs>
                <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${color};stop-opacity:0.7" />
                </linearGradient>
            </defs>
            <circle
                class="progress-ring-bg"
                stroke="var(--border-subtle)"
                stroke-width="${strokeWidth}"
                fill="transparent"
                r="${radius}"
                cx="${size / 2}"
                cy="${size / 2}"
                opacity="0.4"
            />
            <circle
                class="progress-ring-progress"
                stroke="url(#${gradientId})"
                stroke-width="${strokeWidth}"
                stroke-linecap="round"
                fill="transparent"
                r="${radius}"
                cx="${size / 2}"
                cy="${size / 2}"
                style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);"
            />
        </svg>
        <div class="progress-ring-text">${percent}<span class="progress-ring-unit">%</span></div>
    `;
}

/**
 * Render a horizontal bar chart
 * Clean, minimal design - solid colors, no gradients, no hover animations
 * Bars with value 0 are NOT shown (no visible bar segment)
 * Values are displayed clearly next to each bar
 */
function createBarChart(data, maxValue = null, options = {}) {
    // Handle empty data with styled empty state
    if (!data || data.length === 0) {
        return createChartEmptyState('No data available');
    }
    
    // Show chart even if all values are 0 - this lets users see categories
    const {
        primaryColor = 'var(--accent)',
        secondaryColor = '#34C759'
    } = options;
    
    const max = maxValue || Math.max(...data.map(d => d.value), 1);
    
    let html = '<div class="bar-chart-clean">';
    
    data.forEach((item, index) => {
        const value = item.value || 0;
        // For value 0: width is exactly 0 (no bar shown)
        // For value > 0: calculate percentage, minimum 2% for very small values
        const percentage = value === 0 ? 0 : Math.max((value / max) * 100, 2);
        const barColor = item.color || primaryColor;
        const hasBar = value > 0;
        
        html += `
            <div class="bar-row-clean">
                <div class="bar-label-clean" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
                <div class="bar-track-clean">
                    ${hasBar ? `<div class="bar-fill-clean" style="width: ${percentage}%; background-color: ${barColor};"></div>` : ''}
                </div>
                <div class="bar-value-clean">${formatAxisValue(value)}</div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

/**
 * Create a styled empty state for charts
 * Uses a progress ring style circle with message
 */
function createChartEmptyState(message = 'No data available') {
    return `
        <div class="chart-empty-state">
            <div class="chart-empty-ring">
                <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle 
                        cx="40" cy="40" r="34" 
                        fill="none" 
                        stroke="var(--border-subtle)" 
                        stroke-width="3"
                        stroke-dasharray="8 4"
                        opacity="0.5"
                    />
                    <circle 
                        cx="40" cy="40" r="24" 
                        fill="var(--bg-body)" 
                    />
                </svg>
                <div class="chart-empty-icon">
                    <i class="fas fa-chart-line"></i>
                </div>
            </div>
            <span class="chart-empty-text">${escapeHtml(message)}</span>
        </div>
    `;
}

/**
 * Format axis value - avoid float clutter
 */
function formatAxisValue(value) {
    if (Number.isInteger(value)) return value.toString();
    if (value >= 1000) return Math.round(value).toString();
    if (value >= 100) return Math.round(value).toString();
    // Max 1 decimal place
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

/**
 * Render a vertical trend bar chart (sparkline-style)
 * Robust for any dataset size (1 to many)
 * Supports custom Y-axis config via options
 */
function createTrendChart(data, options = {}) {
    // Handle empty data
    if (!data || data.length === 0) {
        return createChartEmptyState('No trend data');
    }
    
    // Don't show "Data coming soon" for zero values - show the graph with zeros
    // This allows users to see the timeline even when no activity occurred
    
    const {
        showSecondaryAxis = false,
        secondaryData = null,
        primaryColor = 'var(--accent)',
        secondaryColor = '#34C759',
        yAxisMin = 0,
        yAxisMax = null,
        yAxisStep = null,
        tickCount = 3 // Default tick count, can be overridden by tickDensity
    } = options;
    
    const dataMax = Math.max(...data.map(d => d.count), 1);
    const dataMin = Math.min(...data.map(d => d.count), 0);
    const secondaryMax = secondaryData ? Math.max(...secondaryData.map(d => d.count), 1) : dataMax;
    
    // Use custom Y-axis config if provided
    const effectiveMin = Math.max(yAxisMin ?? 0, 0); // Never go below 0
    const effectiveMax = yAxisMax ?? dataMax;
    
    // Generate Y-axis ticks based on config
    let yTicks;
    if (yAxisStep && yAxisStep > 0) {
        // Custom step: generate ticks from max down to min
        yTicks = [];
        for (let v = effectiveMax; v >= effectiveMin; v -= yAxisStep) {
            yTicks.push(Math.round(v * 100) / 100);
        }
        if (yTicks[yTicks.length - 1] !== effectiveMin) {
            yTicks.push(effectiveMin);
        }
    } else {
        // Auto ticks - use tickCount from options
        yTicks = generateCleanAxisTicks(effectiveMax, tickCount);
    }
    
    const displayMax = yTicks[0]; // Use the nice max for scaling
    const displayMin = yTicks[yTicks.length - 1];
    const displayRange = displayMax - displayMin;
    
    // Calculate bar width based on data length
    const barCount = data.length;
    const minBarWidth = 8;
    const maxBarWidth = 40;
    const calculatedWidth = Math.floor(100 / barCount) - 2;
    const barWidth = Math.min(maxBarWidth, Math.max(minBarWidth, calculatedWidth));
    
    // Determine which X-labels to show (avoid overlap)
    const xLabelIndices = getXLabelIndices(data.length);
    
    let html = `<div class="metrics-trend-chart-v2" data-bar-count="${barCount}">`;
    
    // Y-axis with clean scale markers
    html += `
        <div class="trend-y-axis">
            ${yTicks.map(tick => `<span class="y-axis-label">${formatAxisValue(tick)}</span>`).join('')}
        </div>
    `;
    
    // Secondary Y-axis if enabled
    if (showSecondaryAxis && secondaryData) {
        const secYTicks = generateCleanAxisTicks(secondaryMax, 3);
        html += `
            <div class="trend-y-axis-secondary">
                ${secYTicks.map(tick => `<span class="y-axis-label">${formatAxisValue(tick)}</span>`).join('')}
            </div>
        `;
    }
    
    html += '<div class="trend-chart-area">';
    
    // Grid lines (match Y tick count)
    html += `
        <div class="trend-grid-lines">
            ${yTicks.map(() => '<div class="grid-line"></div>').join('')}
        </div>
    `;
    
    html += '<div class="trend-bars-container">';
    
    data.forEach((item, index) => {
        // Calculate height using the effective range (supports custom Y-axis)
        const clampedValue = Math.max(displayMin, Math.min(displayMax, item.count));
        const height = displayRange > 0 ? Math.max(((clampedValue - displayMin) / displayRange) * 100, 3) : 3;
        const delay = index * 0.04;
        const showLabel = xLabelIndices.has(index);
        
        let secondaryBarHtml = '';
        if (showSecondaryAxis && secondaryData && secondaryData[index]) {
            const secDisplayMax = generateCleanAxisTicks(secondaryMax, 3)[0];
            const secHeight = secDisplayMax > 0 ? Math.max((secondaryData[index].count / secDisplayMax) * 100, 3) : 3;
            secondaryBarHtml = `<div class="trend-bar-secondary" style="height: ${secHeight}%; background: ${secondaryColor}; transition-delay: ${delay + 0.05}s"></div>`;
        }
        
        html += `
            <div class="trend-bar-group" style="--bar-width: ${barWidth}px">
                <div class="trend-bar-wrapper" data-tooltip="${escapeHtml(item.label)}: ${item.count}">
                    <div class="trend-bar-primary" style="height: ${height}%; background: linear-gradient(180deg, ${primaryColor} 0%, ${primaryColor}88 100%); transition-delay: ${delay}s"></div>
                    ${secondaryBarHtml}
                </div>
                <span class="trend-bar-label ${showLabel ? '' : 'hidden'}">${escapeHtml(item.label)}</span>
            </div>
        `;
    });
    
    html += '</div></div></div>';
    return html;
}

/**
 * Render a stat card with optional tooltip
 * Apple-inspired glassmorphism card with subtle icon
 * @param {string} icon - FontAwesome icon class (e.g., 'fa-check-circle')
 * @param {number|string} value - Main value to display
 * @param {string} label - Label text
 * @param {string} subtitle - Subtitle text (optional)
 * @param {string} colorClass - CSS color class (optional: 'success', 'warning', 'danger')
 * @param {string} tooltip - Tooltip text on hover (optional)
 */
function createStatCard(icon, value, label, subtitle = '', colorClass = '', tooltip = '') {
    const tooltipAttr = tooltip ? `data-tooltip="${tooltip}"` : '';
    const colorStyle = colorClass ? `metrics-stat-card-${colorClass}` : '';
    return `
        <div class="metrics-stat-card ${colorStyle}" ${tooltipAttr}>
            <div class="metrics-stat-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="metrics-stat-content">
                <div class="metrics-stat-value">${value}</div>
                <div class="metrics-stat-label">${label}</div>
                ${subtitle ? `<div class="metrics-stat-subtitle">${subtitle}</div>` : ''}
            </div>
        </div>
    `;
}

// ===================================
// GRAPH TYPE SWITCHING SYSTEM
// ===================================

/**
 * Get the current graph type for a specific graph
 * @param {string} graphId - Unique identifier for the graph
 * @returns {string} - 'bar' | 'line' | 'pie'
 */
function getGraphType(graphId) {
    return appState.graphTypes[graphId] || 'bar';
}

/**
 * Set the graph type for a specific graph
 * @param {string} graphId - Unique identifier for the graph
 * @param {string} type - 'bar' | 'line' | 'pie'
 */
function setGraphType(graphId, type) {
    appState.graphTypes[graphId] = type;
}

/**
 * Toggle graph menu visibility
 * @param {Event} event - Click event
 * @param {string} graphId - Unique identifier for the graph
 */
function toggleGraphMenu(event, graphId) {
    event.stopPropagation();
    
    // Close all other open menus
    document.querySelectorAll('.graph-menu-dropdown.active').forEach(menu => {
        if (menu.dataset.graphId !== graphId) {
            menu.classList.remove('active');
        }
    });
    
    const menu = document.querySelector(`.graph-menu-dropdown[data-graph-id="${graphId}"]`);
    if (menu) {
        menu.classList.toggle('active');
    }
}

/**
 * Close all graph menus
 */
function closeAllGraphMenus() {
    document.querySelectorAll('.graph-menu-dropdown.active').forEach(menu => {
        menu.classList.remove('active');
    });
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.graph-menu-container')) {
        closeAllGraphMenus();
    }
});

/**
 * Switch graph type and re-render
 * @param {string} graphId - Unique identifier for the graph
 * @param {string} type - 'bar' | 'line' | 'pie'
 */
function switchGraphType(graphId, type) {
    setGraphType(graphId, type);
    closeAllGraphMenus();
    
    // Also update the chart config if user can edit
    if (canEditMetrics()) {
        updateChartConfig(graphId, { type: type });
        // The updateChartConfig will handle re-rendering
        return;
    }
    
    // Find the graph container and re-render (for non-editors)
    const container = document.querySelector(`[data-graph-id="${graphId}"] .graph-content`);
    if (container) {
        // Get stored data
        const dataAttr = container.closest('.metrics-card')?.dataset.graphData;
        const dataType = container.closest('.metrics-card')?.dataset.graphDataType;
        
        if (dataAttr) {
            try {
                const data = JSON.parse(dataAttr);
                const config = getChartConfig(graphId);
                // Add fade-out animation
                container.style.opacity = '0';
                container.style.transform = 'scale(0.98)';
                
                setTimeout(() => {
                    container.innerHTML = renderGraphByTypeWithConfig(data, type, dataType, config);
                    // Fade in
                    requestAnimationFrame(() => {
                        container.style.opacity = '1';
                        container.style.transform = 'scale(1)';
                    });
                }, 150);
            } catch (e) {
                console.error('Error parsing graph data:', e);
            }
        }
    }
    
    // Update the menu button icon to reflect current type
    updateGraphMenuIcon(graphId, type);
}

/**
 * Update the graph menu icon to show current type
 */
function updateGraphMenuIcon(graphId, type) {
    const iconMap = {
        'bar': 'fa-chart-bar',
        'line': 'fa-chart-line',
        'pie': 'fa-chart-pie'
    };
    
    // Update the button icon to reflect current type
    const menuBtn = document.querySelector(`.metrics-card[data-graph-id="${graphId}"] .graph-menu-btn`);
    if (menuBtn) {
        const icon = menuBtn.querySelector('i');
        if (icon) {
            // Remove all chart icons
            icon.classList.remove('fa-chart-bar', 'fa-chart-line', 'fa-chart-pie');
            // Add the current type icon
            icon.classList.add(iconMap[type] || 'fa-chart-bar');
        }
        menuBtn.dataset.currentType = type;
    }
    
    // Update the active state in dropdown
    const dropdown = document.querySelector(`.graph-menu-dropdown[data-graph-id="${graphId}"]`);
    if (dropdown) {
        dropdown.querySelectorAll('.graph-menu-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.type === type);
        });
    }
}

// Expose graph functions globally
window.toggleGraphMenu = toggleGraphMenu;
window.switchGraphType = switchGraphType;

/**
 * Render graph based on type
 * @param {Array} data - Graph data
 * @param {string} type - 'bar' | 'line' | 'pie'
 * @param {string} dataType - 'trend' | 'breakdown' to determine data structure
 */
function renderGraphByType(data, type, dataType = 'trend') {
    if (!data || data.length === 0) {
        return createChartEmptyState('No data available');
    }
    
    switch (type) {
        case 'line':
            return dataType === 'breakdown' 
                ? createLineChartFromBreakdown(data)
                : createLineChart(data);
        case 'pie':
            return dataType === 'breakdown'
                ? createPieChart(data)
                : createPieChartFromTrend(data);
        case 'bar':
        default:
            return dataType === 'breakdown'
                ? createBarChart(data)
                : createTrendChart(data);
    }
}

/**
 * Render graph based on type WITH custom configuration
 * @param {Array} data - Graph data
 * @param {string} type - 'bar' | 'line' | 'pie'
 * @param {string} dataType - 'trend' | 'breakdown' to determine data structure
 * @param {Object} config - Chart configuration (yAxisMin, yAxisMax, colors, tickDensity, palette, etc.)
 */
function renderGraphByTypeWithConfig(data, type, dataType = 'trend', config = {}) {
    if (!data || data.length === 0) {
        return createChartEmptyState('No data available');
    }
    
    // Get tick count from density setting
    const tickDensity = config.tickDensity || 'normal';
    const tickDensityConfig = TICK_DENSITY_OPTIONS.find(t => t.id === tickDensity) || TICK_DENSITY_OPTIONS[1];
    const tickCount = tickDensityConfig.ticks;
    
    // Build options from config
    const options = {
        primaryColor: config.primaryColor || 'var(--accent)',
        secondaryColor: config.secondaryColor || '#34C759',
        showSecondaryAxis: config.showSecondaryAxis || false,
        yAxisMin: config.yAxisMode === 'auto' ? 0 : (config.yAxisMin ?? 0),
        yAxisMax: config.yAxisMode === 'auto' ? null : (config.yAxisMax ?? null),
        yAxisStep: config.yAxisMode === 'auto' ? null : (config.yAxisStep ?? null),
        tickCount: tickCount,
        palette: config.palette || 'default'
    };
    
    switch (type) {
        case 'line':
            return dataType === 'breakdown' 
                ? createLineChartFromBreakdown(data, options)
                : createLineChart(data, options);
        case 'pie':
            return dataType === 'breakdown'
                ? createPieChart(data, options)
                : createPieChartFromTrend(data, options);
        case 'bar':
        default:
            return dataType === 'breakdown'
                ? createBarChart(data, null, options)
                : createTrendChart(data, options);
    }
}

/**
 * Generate clean, unique axis tick values
 * Always starts from 0, no duplicates, nice round numbers
 */
function generateCleanAxisTicks(max, steps = 4) {
    // Handle edge cases
    if (max <= 0) return [0];
    if (max === 1) return [1, 0];
    
    // For very small values, use simpler logic
    if (max <= steps) {
        const ticks = [];
        for (let i = max; i >= 0; i--) {
            ticks.push(i);
        }
        return ticks;
    }
    
    // Find a nice round step size
    const roughStep = max / steps;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    
    let niceStep;
    if (residual <= 1.5) niceStep = magnitude;
    else if (residual <= 3) niceStep = 2 * magnitude;
    else if (residual <= 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;
    
    // Calculate nice max (round up to nearest step)
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    
    // Generate ticks from niceMax down to 0
    const ticks = [];
    for (let v = niceMax; v >= 0; v -= niceStep) {
        // Round to avoid floating point issues
        const rounded = Math.round(v * 1000) / 1000;
        ticks.push(rounded);
    }
    
    // Ensure 0 is included at the end
    if (ticks[ticks.length - 1] !== 0) {
        ticks.push(0);
    }
    
    return ticks;
}

/**
 * Generate nice axis scale values (legacy function - wraps generateCleanAxisTicks)
 */
function generateAxisScale(max, steps = 4) {
    return generateCleanAxisTicks(max, steps);
}

/**
 * Determine which X-axis labels to show based on data count
 * Returns a Set of indices to display
 */
function getXLabelIndices(dataLength) {
    const indices = new Set();
    
    if (dataLength <= 0) return indices;
    
    // Always show first and last
    indices.add(0);
    indices.add(dataLength - 1);
    
    if (dataLength <= 5) {
        // Show all for small datasets
        for (let i = 0; i < dataLength; i++) indices.add(i);
    } else if (dataLength <= 10) {
        // Show every other
        for (let i = 0; i < dataLength; i += 2) indices.add(i);
    } else {
        // Show ~5 evenly spaced labels
        const step = Math.ceil(dataLength / 5);
        for (let i = 0; i < dataLength; i += step) indices.add(i);
    }
    
    return indices;
}

/**
 * Create smooth bezier curve path for line chart
 * Uses monotone cubic interpolation to prevent overshoot below 0
 * @param {Array} points - Array of {x, y, value} objects
 * @param {number} yMax - Maximum Y coordinate (top of chart area)
 * @param {number} yMin - Minimum Y coordinate (bottom of chart area, where y=0)
 */
function createSmoothPath(points, yMax = null, yMin = null) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
    }
    
    // Use monotone cubic interpolation to prevent overshoot
    // This ensures the curve never goes above local maxima or below local minima
    const n = points.length;
    
    // Calculate slopes
    const slopes = [];
    for (let i = 0; i < n - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        slopes.push(dx !== 0 ? dy / dx : 0);
    }
    
    // Calculate tangents using monotone method
    const tangents = [slopes[0]];
    for (let i = 1; i < n - 1; i++) {
        // If slopes have different signs or either is zero, tangent is 0
        if (slopes[i - 1] * slopes[i] <= 0) {
            tangents.push(0);
        } else {
            // Use harmonic mean of slopes for monotonicity
            tangents.push(2 / (1 / slopes[i - 1] + 1 / slopes[i]));
        }
    }
    tangents.push(slopes[n - 2]);
    
    // Build path with cubic bezier segments
    let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    
    for (let i = 0; i < n - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const dx = (p1.x - p0.x) / 3;
        
        // Control points
        let cp1x = p0.x + dx;
        let cp1y = p0.y + tangents[i] * dx;
        let cp2x = p1.x - dx;
        let cp2y = p1.y - tangents[i + 1] * dx;
        
        // Clamp control points to prevent overshoot beyond data bounds
        if (yMax !== null && yMin !== null) {
            // Clamp to chart boundaries (remember: y increases downward in SVG)
            cp1y = Math.max(yMax, Math.min(yMin, cp1y));
            cp2y = Math.max(yMax, Math.min(yMin, cp2y));
        }
        
        // Additional clamping: control points shouldn't create overshoot beyond the segment's y-range
        const segMinY = Math.min(p0.y, p1.y);
        const segMaxY = Math.max(p0.y, p1.y);
        // Allow some tolerance but prevent extreme overshoot
        const tolerance = (segMaxY - segMinY) * 0.1;
        cp1y = Math.max(segMinY - tolerance, Math.min(segMaxY + tolerance, cp1y));
        cp2y = Math.max(segMinY - tolerance, Math.min(segMaxY + tolerance, cp2y));
        
        path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
    }
    
    return path;
}

/**
 * Create a modern line chart with dual-axis support
 * Clean, minimal Apple-style design
 * Clamps Y-axis to always start at 0 (no negative values)
 * Supports custom Y-axis config via options
 * @param {Array} data - Array of { label, count } objects
 * @param {Object} options - Chart options
 */
function createLineChart(data, options = {}) {
    // Handle empty or invalid data
    if (!data || data.length === 0) {
        return createChartEmptyState('No data available');
    }
    
    // Show the chart even if all values are 0 - flat line at bottom
    const {
        showSecondaryAxis = false,
        secondaryData = null,
        primaryColor = 'var(--accent)',
        secondaryColor = '#34C759',
        primaryLabel = '',
        secondaryLabel = '',
        height = 140,
        showDots = true,
        showArea = true,
        smoothCurve = true,
        yAxisMin = 0,
        yAxisMax = null,
        yAxisStep = null,
        tickCount = 4 // Default tick count, can be overridden by tickDensity
    } = options;
    
    // Chart dimensions
    const width = 400;
    const chartHeight = height;
    const padding = { top: 16, right: showSecondaryAxis ? 45 : 16, bottom: 32, left: 40 };
    const drawWidth = width - padding.left - padding.right;
    const drawHeight = chartHeight - padding.top - padding.bottom;
    
    // Calculate scales - using custom Y-axis config if provided
    const dataMax = Math.max(...data.map(d => Math.max(0, d.count || 0)), 1);
    const effectiveMin = Math.max(yAxisMin ?? 0, 0); // Never below 0
    const effectiveMax = yAxisMax ?? dataMax;
    
    // Generate Y-axis ticks based on config
    let primaryTicks;
    if (yAxisStep && yAxisStep > 0) {
        primaryTicks = [];
        for (let v = effectiveMax; v >= effectiveMin; v -= yAxisStep) {
            primaryTicks.push(Math.round(v * 100) / 100);
        }
        if (primaryTicks[primaryTicks.length - 1] !== effectiveMin) {
            primaryTicks.push(effectiveMin);
        }
    } else {
        // Use tickCount from options
        primaryTicks = generateCleanAxisTicks(effectiveMax, tickCount);
    }
    
    const primaryMax = primaryTicks[0];
    const primaryMin = primaryTicks[primaryTicks.length - 1];
    const primaryRange = primaryMax - primaryMin;
    
    let secondaryTicks = [];
    let secondaryMax = primaryMax;
    let secondaryMin = primaryMin;
    if (secondaryData && secondaryData.length > 0) {
        const secMaxValue = Math.max(...secondaryData.map(d => Math.max(0, d.count || 0)), 1);
        secondaryTicks = generateCleanAxisTicks(secMaxValue, 4);
        secondaryMax = secondaryTicks[0];
        secondaryMin = secondaryTicks[secondaryTicks.length - 1];
    }
    
    // Generate points - using the effective range for Y positioning
    const getX = (index, len) => padding.left + (len === 1 ? drawWidth / 2 : (index / (len - 1)) * drawWidth);
    const getY = (value, maxVal, minVal = 0) => {
        const range = maxVal - minVal;
        const clampedValue = Math.max(minVal, Math.min(maxVal, value));
        return padding.top + drawHeight - ((clampedValue - minVal) / (range || 1)) * drawHeight;
    };
    
    const primaryPoints = data.map((item, i) => ({
        x: getX(i, data.length),
        y: getY(item.count, primaryMax, primaryMin),
        value: Math.max(0, item.count),
        label: item.label
    }));
    
    const secondaryPoints = secondaryData ? secondaryData.map((item, i) => ({
        x: getX(i, secondaryData.length),
        y: getY(item.count, secondaryMax, secondaryMin),
        value: Math.max(0, item.count),
        label: item.label
    })) : [];
    
    // Generate paths - pass Y-axis bounds to prevent overshoot
    const yTopBound = padding.top; // Top of chart area (minimum Y in SVG coords)
    const yBottomBound = padding.top + drawHeight; // Bottom of chart area (maximum Y in SVG coords = y=0 line)
    
    const primaryPath = smoothCurve && primaryPoints.length > 2
        ? createSmoothPath(primaryPoints, yTopBound, yBottomBound)
        : primaryPoints.length > 1
            ? `M ${primaryPoints.map(p => `${p.x},${p.y}`).join(' L ')}`
            : '';
    
    const secondaryPath = secondaryPoints.length > 1
        ? (smoothCurve && secondaryPoints.length > 2
            ? createSmoothPath(secondaryPoints, yTopBound, yBottomBound)
            : `M ${secondaryPoints.map(p => `${p.x},${p.y}`).join(' L ')}`)
        : '';
    
    // Area path for primary
    const areaPath = showArea && primaryPoints.length > 1
        ? `${primaryPath} L ${primaryPoints[primaryPoints.length - 1].x},${padding.top + drawHeight} L ${primaryPoints[0].x},${padding.top + drawHeight} Z`
        : '';
    
    const gradientId = `line-grad-${Math.random().toString(36).substr(2, 9)}`;
    const gradientId2 = `line-grad2-${Math.random().toString(36).substr(2, 9)}`;
    
    // Determine label display using the helper function
    const labelIndices = getXLabelIndices(data.length);
    
    return `
        <div class="line-chart-v2">
            <svg viewBox="0 0 ${width} ${chartHeight}" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.25" />
                        <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0.02" />
                    </linearGradient>
                    <linearGradient id="${gradientId2}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${secondaryColor}" stop-opacity="0.2" />
                        <stop offset="100%" stop-color="${secondaryColor}" stop-opacity="0.02" />
                    </linearGradient>
                </defs>
                
                <!-- Grid lines -->
                <g class="line-chart-grid">
                    ${primaryTicks.map((val, i) => {
                        const y = padding.top + (i / Math.max(primaryTicks.length - 1, 1)) * drawHeight;
                        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
                    }).join('')}
                </g>
                
                <!-- Primary Y-axis labels -->
                <g class="line-chart-y-labels">
                    ${primaryTicks.map((val, i) => {
                        const y = padding.top + (i / Math.max(primaryTicks.length - 1, 1)) * drawHeight;
                        return `<text x="${padding.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${formatAxisValue(val)}</text>`;
                    }).join('')}
                </g>
                
                <!-- Secondary Y-axis labels -->
                ${showSecondaryAxis && secondaryTicks.length > 0 ? `
                    <g class="line-chart-y-labels secondary">
                        ${secondaryTicks.map((val, i) => {
                            const y = padding.top + (i / Math.max(secondaryTicks.length - 1, 1)) * drawHeight;
                            return `<text x="${width - padding.right + 8}" y="${y}" text-anchor="start" dominant-baseline="middle">${formatAxisValue(val)}</text>`;
                        }).join('')}
                    </g>
                ` : ''}
                
                <!-- Area fill -->
                ${showArea && areaPath ? `<path class="line-chart-area-v2" d="${areaPath}" fill="url(#${gradientId})" />` : ''}
                
                <!-- Secondary line -->
                ${secondaryPath ? `
                    <path class="line-chart-stroke secondary" d="${secondaryPath}" stroke="${secondaryColor}" />
                ` : ''}
                
                <!-- Primary line -->
                ${primaryPath ? `<path class="line-chart-stroke primary" d="${primaryPath}" stroke="${primaryColor}" />` : ''}
                
                <!-- Dots -->
                ${showDots ? `
                    <g class="line-chart-dots">
                        ${primaryPoints.map((p, i) => `
                            <circle 
                                cx="${p.x}" cy="${p.y}" r="4" 
                                fill="var(--bg-surface)" 
                                stroke="${primaryColor}" 
                                stroke-width="2"
                                class="line-dot"
                                data-tooltip="${escapeHtml(p.label)}: ${formatAxisValue(p.value)}"
                            />
                        `).join('')}
                        ${secondaryPoints.map((p, i) => `
                            <circle 
                                cx="${p.x}" cy="${p.y}" r="3.5" 
                                fill="var(--bg-surface)" 
                                stroke="${secondaryColor}" 
                                stroke-width="2"
                                class="line-dot secondary"
                                data-tooltip="${escapeHtml(p.label)}: ${formatAxisValue(p.value)}"
                            />
                        `).join('')}
                    </g>
                ` : ''}
                
                <!-- X-axis labels -->
                <g class="line-chart-x-labels">
                    ${data.map((item, i) => {
                        if (!labelIndices.has(i)) return '';
                        const x = getX(i, data.length);
                        return `<text x="${x}" y="${chartHeight - 8}" text-anchor="middle">${escapeHtml(item.label)}</text>`;
                    }).join('')}
                </g>
            </svg>
            
            ${primaryLabel || secondaryLabel ? `
                <div class="line-chart-legend">
                    ${primaryLabel ? `<span class="legend-item"><span class="legend-dot" style="background: ${primaryColor}"></span>${escapeHtml(primaryLabel)}</span>` : ''}
                    ${secondaryLabel ? `<span class="legend-item"><span class="legend-dot" style="background: ${secondaryColor}"></span>${escapeHtml(secondaryLabel)}</span>` : ''}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Create a line chart from breakdown data
 */
function createLineChartFromBreakdown(data, options = {}) {
    const trendData = data.map(item => ({
        label: item.label,
        count: item.value
    }));
    return createLineChart(trendData, options);
}

/**
 * Create a pie chart (SVG-based donut style)
 * Apple-inspired minimal design
 * @param {Array} data - Array of { label, value|count, color } objects
 * @param {Object} options - Optional chart options (primaryColor, palette, etc.)
 */
function createPieChart(data, options = {}) {
    // Handle empty data
    if (!data || data.length === 0) {
        return createChartEmptyState('No data available');
    }
    
    // Normalize data: support both 'value' and 'count' properties
    const normalizedData = data.map(item => ({
        label: item.label || 'Unknown',
        value: item.value ?? item.count ?? 0,
        color: item.color
    })).filter(item => item.value > 0); // Filter out zero/negative values
    
    if (normalizedData.length === 0) {
        return createChartEmptyState('Data coming soon');
    }
    
    const total = normalizedData.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
        return createChartEmptyState('Data coming soon');
    }
    
    const size = 120;
    const center = size / 2;
    const radius = 45;
    const innerRadius = 28; // Donut style
    
    let currentAngle = -90; // Start from top
    
    // Get colors from palette if specified, or generate distinct colors per member
    const paletteId = options.palette || 'default';
    const paletteConfig = PIE_PALETTE_OPTIONS.find(p => p.id === paletteId) || PIE_PALETTE_OPTIONS[0];
    let defaultColors = paletteConfig.colors;
    
    // For member-based data, generate stable distinct colors
    if (options.colorByMember && normalizedData.length > defaultColors.length) {
        // Extend palette with hashed colors
        const extendedColors = [...defaultColors];
        for (let i = defaultColors.length; i < normalizedData.length; i++) {
            const hue = (i * 137.5) % 360; // Golden angle for distinct hues
            extendedColors.push(`hsl(${hue}, 65%, 55%)`);
        }
        defaultColors = extendedColors;
    }
    
    // Handle single segment edge case (full circle)
    if (normalizedData.length === 1) {
        const item = normalizedData[0];
        const color = item.color || defaultColors[0];
        return `
            <div class="metrics-pie-chart">
                <svg viewBox="0 0 ${size} ${size}">
                    <circle cx="${center}" cy="${center}" r="${radius}" fill="${color}" />
                    <circle cx="${center}" cy="${center}" r="${innerRadius}" fill="var(--bg-surface)" />
                    <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" class="pie-total">${formatAxisValue(total)}</text>
                </svg>
                <div class="pie-legend">
                    <div class="pie-legend-item">
                        <span class="pie-legend-color" style="background: ${color}"></span>
                        <span class="pie-legend-label">${escapeHtml(item.label)}</span>
                        <span class="pie-legend-value">${formatAxisValue(item.value)} (100%)</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    const segments = normalizedData.map((item, index) => {
        const percentage = (item.value / total) * 100;
        const angle = (percentage / 100) * 360;
        
        // Handle very small angles that could cause rendering issues
        if (angle < 0.5) {
            return null; // Skip tiny segments
        }
        
        const startAngle = currentAngle;
        const endAngle = currentAngle + angle;
        
        // Calculate path
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        
        const x1 = center + radius * Math.cos(startRad);
        const y1 = center + radius * Math.sin(startRad);
        const x2 = center + radius * Math.cos(endRad);
        const y2 = center + radius * Math.sin(endRad);
        
        const x3 = center + innerRadius * Math.cos(endRad);
        const y3 = center + innerRadius * Math.sin(endRad);
        const x4 = center + innerRadius * Math.cos(startRad);
        const y4 = center + innerRadius * Math.sin(startRad);
        
        const largeArc = angle > 180 ? 1 : 0;
        // Use assigned color or default based on index (ensures distinct colors)
        const color = item.color || defaultColors[index % defaultColors.length];
        
        currentAngle = endAngle;
        
        const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
        
        return { path, color, label: item.label, value: item.value, percentage: percentage.toFixed(1) };
    }).filter(seg => seg !== null); // Remove skipped segments
    
    if (segments.length === 0) {
        return createChartEmptyState('Data coming soon');
    }
    
    return `
        <div class="metrics-pie-chart">
            <svg viewBox="0 0 ${size} ${size}">
                ${segments.map((seg, i) => `
                    <path 
                        class="pie-segment" 
                        d="${seg.path}" 
                        fill="${seg.color}"
                        data-tooltip="${escapeHtml(seg.label)}: ${formatAxisValue(seg.value)} (${seg.percentage}%)"
                        style="animation-delay: ${i * 0.05}s"
                    />
                `).join('')}
                <circle cx="${center}" cy="${center}" r="${innerRadius - 2}" fill="var(--bg-surface)" />
                <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="middle" class="pie-total">${formatAxisValue(total)}</text>
            </svg>
            <div class="pie-legend">
                ${segments.slice(0, 5).map(seg => `
                    <div class="pie-legend-item">
                        <span class="pie-legend-color" style="background: ${seg.color}"></span>
                        <span class="pie-legend-label">${escapeHtml(seg.label)}</span>
                        <span class="pie-legend-value">${formatAxisValue(seg.value)}</span>
                    </div>
                `).join('')}
                ${segments.length > 5 ? `<div class="pie-legend-more">+${segments.length - 5} more</div>` : ''}
            </div>
        </div>
    `;
}

/**
 * Create a pie chart from trend data
 * @param {Array} data - Trend data with { label, count }
 * @param {Object} options - Chart options (palette, etc.)
 */
function createPieChartFromTrend(data, options = {}) {
    // Aggregate trend data into segments
    const pieData = data
        .filter(item => item.count > 0)
        .slice(0, 8)
        .map(item => ({
            label: item.label,
            value: item.count
        }));
    
    if (pieData.length === 0) {
        return createChartEmptyState('No trend data');
    }
    
    return createPieChart(pieData, options);
}

/**
 * Create a metrics card with switchable graph types
 * Includes inline settings panel when in edit mode
 * @param {string} graphId - Unique identifier for this graph
 * @param {string} title - Card title
 * @param {string} icon - FontAwesome icon class
 * @param {Array} data - Graph data
 * @param {string} dataType - 'trend' | 'breakdown'
 */
function createSwitchableGraphCard(graphId, title, icon, data, dataType = 'trend') {
    const config = getChartConfig(graphId);
    const currentType = config.type || getGraphType(graphId);
    const graphContent = renderGraphByTypeWithConfig(data, currentType, dataType, config);
    
    // Store data as JSON for re-rendering on type switch
    const dataJson = JSON.stringify(data).replace(/"/g, '&quot;');
    
    // Build settings panel HTML (only if in edit mode and user can edit)
    const showSettings = metricsEditMode && canEditMetrics();
    const settingsPanel = showSettings ? createGraphSettingsPanel(graphId, config, currentType) : '';
    const settingsToggleBtn = showSettings ? `
        <button class="graph-settings-toggle" onclick="toggleGraphSettings('${graphId}')" title="Graph Settings">
            <i class="fas fa-sliders-h"></i>
        </button>
    ` : '';
    
    // Get the icon for the current graph type
    const graphTypeIcons = {
        'bar': 'fa-chart-bar',
        'line': 'fa-chart-line',
        'pie': 'fa-chart-pie'
    };
    const currentTypeIcon = graphTypeIcons[currentType] || 'fa-chart-bar';
    
    return `
        <div class="metrics-card ${showSettings ? 'edit-mode' : ''}" data-graph-id="${graphId}" data-graph-data="${dataJson}" data-graph-data-type="${dataType}">
            <div class="metrics-card-header">
                <h3><i class="fas ${icon}"></i> ${title}</h3>
                <div class="graph-header-actions">
                    ${settingsToggleBtn}
                    <div class="graph-menu-container">
                        <button class="graph-menu-btn" onclick="toggleGraphMenu(event, '${graphId}')" aria-label="Change graph type" data-current-type="${currentType}">
                            <i class="fas ${currentTypeIcon}"></i>
                        </button>
                        <div class="graph-menu-dropdown" data-graph-id="${graphId}">
                            <div class="graph-menu-title">Graph Type</div>
                            <button class="graph-menu-option ${currentType === 'bar' ? 'active' : ''}" data-type="bar" onclick="switchGraphType('${graphId}', 'bar')">
                                <i class="fas fa-chart-bar"></i>
                                <span>Bar Graph</span>
                            </button>
                            <button class="graph-menu-option ${currentType === 'line' ? 'active' : ''}" data-type="line" onclick="switchGraphType('${graphId}', 'line')">
                                <i class="fas fa-chart-line"></i>
                                <span>Line Graph</span>
                            </button>
                            <button class="graph-menu-option ${currentType === 'pie' ? 'active' : ''}" data-type="pie" onclick="switchGraphType('${graphId}', 'pie')">
                                <i class="fas fa-chart-pie"></i>
                                <span>Pie Graph</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="metrics-card-body">
                <div class="graph-content" style="transition: opacity 0.15s ease, transform 0.15s ease;">
                    ${graphContent}
                </div>
                ${settingsPanel}
            </div>
        </div>
    `;
}

/**
 * Create the inline graph settings panel
 * Comprehensive configuration: Y-axis, tick density, colors, graph type, data source
 * @param {string} graphId - Unique chart identifier
 * @param {Object} config - Current chart configuration
 * @param {string} currentType - Current chart type
 */
function createGraphSettingsPanel(graphId, config, currentType) {
    const yAxisMin = config.yAxisMin ?? 0;
    const yAxisMax = config.yAxisMax ?? '';
    const yAxisStep = config.yAxisStep ?? '';
    const yAxisMode = config.yAxisMode || 'auto';
    const tickDensity = config.tickDensity || 'normal';
    const primaryColor = config.primaryColor || 'var(--accent)';
    const secondaryColor = config.secondaryColor || '#34C759';
    const palette = config.palette || 'default';
    const sourceType = config.sourceType || 'tasks';
    const metricKey = config.metricKey || '';
    
    // Build color options
    const primaryColorOptions = CHART_COLOR_OPTIONS.map(c => `
        <button class="color-option ${primaryColor === c.value ? 'active' : ''}" 
                style="background: ${c.preview}" 
                onclick="handleChartConfigChange('${graphId}', 'primaryColor', '${c.value}')"
                title="${c.label}">
        </button>
    `).join('');
    
    const secondaryColorOptions = CHART_COLOR_OPTIONS.map(c => `
        <button class="color-option ${secondaryColor === c.value ? 'active' : ''}" 
                style="background: ${c.preview}" 
                onclick="handleChartConfigChange('${graphId}', 'secondaryColor', '${c.value}')"
                title="${c.label}">
        </button>
    `).join('');
    
    // Build tick density options
    const tickDensityOptions = TICK_DENSITY_OPTIONS.map(t => `
        <button class="density-option ${tickDensity === t.id ? 'active' : ''}"
                onclick="handleChartConfigChange('${graphId}', 'tickDensity', '${t.id}')"
                title="${t.label} (${t.ticks} ticks)">
            ${t.label}
        </button>
    `).join('');
    
    // Build pie palette options
    const paletteOptions = PIE_PALETTE_OPTIONS.map(p => `
        <button class="palette-option ${palette === p.id ? 'active' : ''}"
                onclick="handleChartConfigChange('${graphId}', 'palette', '${p.id}')"
                title="${p.label}">
            <span class="palette-preview">
                ${p.colors.slice(0, 4).map(c => `<span class="palette-dot" style="background: ${c}"></span>`).join('')}
            </span>
            <span class="palette-label">${p.label}</span>
        </button>
    `).join('');
    
    // Build graph type options
    const graphTypeOptions = `
        <div class="graph-type-options">
            <button class="graph-type-option ${currentType === 'bar' ? 'active' : ''}"
                    onclick="handleChartConfigChange('${graphId}', 'type', 'bar')"
                    title="Bar Chart">
                <i class="fas fa-chart-bar"></i>
                <span>Bar</span>
            </button>
            <button class="graph-type-option ${currentType === 'line' ? 'active' : ''}"
                    onclick="handleChartConfigChange('${graphId}', 'type', 'line')"
                    title="Line Chart">
                <i class="fas fa-chart-line"></i>
                <span>Line</span>
            </button>
            <button class="graph-type-option ${currentType === 'pie' ? 'active' : ''}"
                    onclick="handleChartConfigChange('${graphId}', 'type', 'pie')"
                    title="Pie Chart">
                <i class="fas fa-chart-pie"></i>
                <span>Pie</span>
            </button>
        </div>
    `;
    
    // Build data source dropdown
    const dataSourceOptions = DATA_SOURCE_OPTIONS.map(s => 
        `<option value="${s.id}" ${(sourceType + '-' + metricKey) === s.id ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    
    // Only show Y-axis settings for line and bar charts
    const showYAxisSettings = currentType === 'line' || currentType === 'bar';
    const showPieSettings = currentType === 'pie';
    
    return `
        <div class="graph-settings-panel" data-settings-chart="${graphId}">
            <div class="graph-settings-header">
                <span class="graph-settings-title">
                    <i class="fas fa-sliders-h"></i>
                    Chart Settings
                </span>
                <button class="graph-settings-close" onclick="closeGraphSettings('${graphId}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="graph-settings-content">
                <!-- Graph Type Section -->
                <div class="settings-section">
                    <div class="settings-section-title">Graph Type</div>
                    ${graphTypeOptions}
                </div>
                
                <!-- Y-Axis Section (for line/bar only) -->
                ${showYAxisSettings ? `
                <div class="settings-section">
                    <div class="settings-section-title">
                        Scale
                        <div class="settings-toggle-group">
                            <button class="settings-toggle ${yAxisMode === 'auto' ? 'active' : ''}"
                                    onclick="handleChartConfigChange('${graphId}', 'yAxisMode', 'auto')">
                                Auto
                            </button>
                            <button class="settings-toggle ${yAxisMode === 'custom' ? 'active' : ''}"
                                    onclick="handleChartConfigChange('${graphId}', 'yAxisMode', 'custom')">
                                Custom
                            </button>
                        </div>
                    </div>
                    
                    <div class="settings-row y-axis-inputs ${yAxisMode === 'auto' ? 'disabled' : ''}">
                        <div class="settings-field">
                            <label>Min</label>
                            <input type="number" 
                                   class="settings-input" 
                                   value="${yAxisMin}" 
                                   min="0"
                                   placeholder="0"
                                   ${yAxisMode === 'auto' ? 'disabled' : ''}
                                   onchange="handleChartConfigChange('${graphId}', 'yAxisMin', this.value)">
                        </div>
                        <div class="settings-field">
                            <label>Max</label>
                            <input type="number" 
                                   class="settings-input" 
                                   value="${yAxisMax}" 
                                   placeholder="Auto"
                                   ${yAxisMode === 'auto' ? 'disabled' : ''}
                                   onchange="handleChartConfigChange('${graphId}', 'yAxisMax', this.value)">
                        </div>
                        <div class="settings-field">
                            <label>Step</label>
                            <input type="number" 
                                   class="settings-input" 
                                   value="${yAxisStep}" 
                                   min="1"
                                   placeholder="Auto"
                                   ${yAxisMode === 'auto' ? 'disabled' : ''}
                                   onchange="handleChartConfigChange('${graphId}', 'yAxisStep', this.value)">
                        </div>
                    </div>
                    
                    <div class="settings-subsection">
                        <label class="settings-label-small">Tick Density</label>
                        <div class="density-options">
                            ${tickDensityOptions}
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <!-- Appearance Section -->
                <div class="settings-section">
                    <div class="settings-section-title">Appearance</div>
                    
                    ${!showPieSettings ? `
                    <div class="settings-subsection">
                        <label class="settings-label-small">Primary Color</label>
                        <div class="color-options">
                            ${primaryColorOptions}
                        </div>
                    </div>
                    
                    <div class="settings-subsection">
                        <label class="settings-label-small">Secondary Color</label>
                        <div class="color-options">
                            ${secondaryColorOptions}
                        </div>
                    </div>
                    ` : `
                    <div class="settings-subsection">
                        <label class="settings-label-small">Color Palette</label>
                        <div class="palette-options">
                            ${paletteOptions}
                        </div>
                    </div>
                    `}
                </div>
                
                <!-- Data Source Section -->
                <div class="settings-section">
                    <div class="settings-section-title">Data Source</div>
                    <div class="settings-subsection">
                        <select class="settings-select" onchange="handleDataSourceChange('${graphId}', this.value)">
                            ${dataSourceOptions}
                        </select>
                        <p class="settings-hint">Connect this chart to a different data source. More options coming soon.</p>
                    </div>
                </div>
            </div>
            
            <div class="graph-settings-footer">
                <button class="settings-reset-btn" onclick="resetChartConfig('${graphId}')">
                    <i class="fas fa-undo"></i>
                    Reset to Defaults
                </button>
            </div>
        </div>
    `;
}

/**
 * Handle data source change from the settings dropdown
 * @param {string} graphId - Chart identifier
 * @param {string} sourceId - Selected source ID
 */
function handleDataSourceChange(graphId, sourceId) {
    const source = DATA_SOURCE_OPTIONS.find(s => s.id === sourceId);
    if (source) {
        updateChartConfig(graphId, {
            sourceType: source.sourceType,
            metricKey: source.metricKey
        });
    }
}

// Expose to window
window.handleDataSourceChange = handleDataSourceChange;

/**
 * METRICS RENDERING FUNCTIONS
 * ===========================
 * 
 * TESTING SCENARIOS:
 * ------------------
 * Use these scenarios to verify correct behavior across all role/setting combinations:
 * 
 * 1. OWNER with any visibility setting:
 *    - Nav item visible ✓
 *    - Personal stats shown ✓
 *    - Team stats shown ✓
 *    - Member breakdown visible ✓
 *    - Settings card visible ✓
 * 
 * 2. ADMIN with 'owner-only' setting:
 *    - Nav item hidden ✓
 *    - Cannot access metrics ✓
 * 
 * 3. ADMIN with 'admin-owner' or 'everyone' setting:
 *    - Nav item visible ✓
 *    - Personal + Team stats shown ✓
 *    - Member breakdown visible ✓
 *    - Settings card hidden ✓
 * 
 * 4. MEMBER with 'owner-only' or 'admin-owner' setting:
 *    - Nav item hidden ✓
 *    - Cannot access metrics ✓
 * 
 * 5. MEMBER with 'members-own' setting:
 *    - Nav item visible ✓
 *    - Personal stats shown ✓
 *    - Team section NOT shown (no member names, no team completion rate) ✓
 *    - Settings card hidden ✓
 * 
 * 6. MEMBER with 'everyone' setting:
 *    - Nav item visible ✓
 *    - Personal + Team stats shown ✓
 *    - Member breakdown visible (can see other members' completion counts) ✓
 *    - Settings card hidden ✓
 * 
 * 7. EMPTY STATES:
 *    - New user with no tasks: "No Activity Yet" message ✓
 *    - User with tasks but none completed: "No Completed Tasks Yet" message ✓
 *    - Team with no assigned tasks: "No Assigned Tasks Yet" for member breakdown ✓
 * 
 * 8. TIME FILTER:
 *    - Dropdown changes trend chart period (7/30/14 days) ✓
 *    - Chart labels adapt (weekday names vs MM/DD format) ✓
 */

/**
 * Show loading state for metrics (displayed while data is loading)
 */
function renderMetricsLoading() {
    const container = document.getElementById('metricsContent');
    if (!container) return;
    
    container.innerHTML = `
        <div class="metrics-loading">
            <div class="metrics-loading-spinner"></div>
            <div class="metrics-loading-text">Loading metrics...</div>
        </div>
    `;
}

/**
 * Create an empty state message
 * @param {string} icon - FontAwesome icon class
 * @param {string} title - Title text
 * @param {string} description - Description text
 */
function createMetricsEmptyState(icon, title, description) {
    return `
        <div class="metrics-empty-state">
            <div class="metrics-empty-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="metrics-empty-title">${title}</div>
            <div class="metrics-empty-desc">${description}</div>
        </div>
    `;
}

/**
 * Create the time filter controls HTML with optional Edit button
 */
function createMetricsTimeFilter() {
    const showEditButton = canEditMetrics();
    const editButtonHTML = showEditButton ? `
        <button class="metrics-edit-btn-header ${metricsEditMode ? 'active' : ''}" onclick="toggleMetricsEditMode()">
            <i class="fas ${metricsEditMode ? 'fa-check' : 'fa-cog'}"></i>
            <span>${metricsEditMode ? 'Done' : 'Edit Metrics'}</span>
        </button>
    ` : '';
    
    // Get display text for current filter
    const filterLabels = {
        '7days': 'Last 7 Days',
        '30days': 'Last 30 Days',
        'all': 'All Time'
    };
    const currentLabel = filterLabels[metricsTimeFilter] || 'Last 7 Days';
    
    return `
        <div class="metrics-controls">
            <div class="metrics-time-filter">
                <span class="metrics-time-filter-label">Time Range:</span>
                <div class="metrics-time-dropdown" id="metricsTimeDropdown">
                    <button class="metrics-time-dropdown-trigger" id="metricsTimeDropdownTrigger">
                        <span class="metrics-time-dropdown-value">${currentLabel}</span>
                        <i class="fas fa-chevron-down metrics-time-dropdown-arrow"></i>
                    </button>
                    <div class="metrics-time-dropdown-menu" id="metricsTimeDropdownMenu">
                        <div class="metrics-time-dropdown-option ${metricsTimeFilter === '7days' ? 'selected' : ''}" data-value="7days">
                            <i class="fas fa-check"></i>
                            <span>Last 7 Days</span>
                        </div>
                        <div class="metrics-time-dropdown-option ${metricsTimeFilter === '30days' ? 'selected' : ''}" data-value="30days">
                            <i class="fas fa-check"></i>
                            <span>Last 30 Days</span>
                        </div>
                        <div class="metrics-time-dropdown-option ${metricsTimeFilter === 'all' ? 'selected' : ''}" data-value="all">
                            <i class="fas fa-check"></i>
                            <span>All Time</span>
                        </div>
                    </div>
                </div>
            </div>
            ${editButtonHTML}
        </div>
    `;
}

/**
 * Initialize the metrics time filter dropdown event handlers
 */
function initMetricsTimeDropdown() {
    const trigger = document.getElementById('metricsTimeDropdownTrigger');
    const menu = document.getElementById('metricsTimeDropdownMenu');
    const dropdown = document.getElementById('metricsTimeDropdown');
    
    if (!trigger || !menu || !dropdown) return;
    
    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });
    
    // Handle option selection
    menu.querySelectorAll('.metrics-time-dropdown-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = option.dataset.value;
            
            // Update selection state
            menu.querySelectorAll('.metrics-time-dropdown-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Update trigger text
            trigger.querySelector('.metrics-time-dropdown-value').textContent = option.querySelector('span').textContent;
            
            // Close dropdown
            dropdown.classList.remove('open');
            
            // Trigger filter change
            handleMetricsTimeFilterChange({ target: { value } });
        });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
}

// Expose time filter handler globally
window.handleMetricsTimeFilterChange = handleMetricsTimeFilterChange;

/**
 * Main render function for metrics
 * Supports loading states, empty states, time filtering, and tooltips
 */
function renderMetrics() {
    const container = document.getElementById('metricsContent');
    if (!container) return;
    
    const access = appState.metricsAccess;
    const userId = currentAuthUser?.uid;
    
    // Handle no access
    if (!access?.canAccess || access.mode === 'none') {
        container.innerHTML = `
            <div class="metrics-no-access">
                <div class="metrics-no-access-icon">
                    <i class="fas fa-lock"></i>
                </div>
                <h3>Metrics Not Available</h3>
                <p>You don't have access to metrics. Ask the team owner to enable metrics visibility for your role.</p>
            </div>
        `;
        return;
    }
    
    // Check if data is still loading (no tasks array means data hasn't loaded yet)
    if (!appState.tasks) {
        renderMetricsLoading();
        return;
    }
    
    // Compute metrics
    const personalMetrics = computePersonalMetrics(appState, userId);
    const teamMetrics = access.mode === 'team' ? computeTeamMetrics(appState) : null;
    
    // Get time boundary label for display
    const timeBounds = getMetricsTimeBoundaries();
    
    let html = '';
    
    // Time filter controls
    html += createMetricsTimeFilter();
    
    // === Personal Stats Section ===
    html += `
        <div class="metrics-section-title">
            <i class="fas fa-user"></i> My Performance
        </div>
    `;
    
    // Check if user has any personal tasks
    const hasPersonalTasks = personalMetrics.tasks.total > 0;
    const hasPersonalActivity = hasPersonalTasks || personalMetrics.events.total > 0 || personalMetrics.messages.total > 0;
    
    if (!hasPersonalActivity) {
        // Empty state for personal metrics
        html += createMetricsEmptyState(
            'fa-chart-line',
            'No Activity Yet',
            'Start completing tasks, creating events, or sending messages to see your performance metrics here.'
        );
    } else {
        // Top row: Stat cards with tooltips
        html += '<div class="metrics-stats-row">';
        
        // Completion rate with progress ring (no tooltip on this one - self-explanatory)
        html += `
            <div class="metrics-stat-card metrics-stat-card-large" data-tooltip="${personalMetrics.tasks.completed} completed, ${personalMetrics.tasks.open} remaining">
                <div class="metrics-progress-ring-container">
                    ${createProgressRing(personalMetrics.tasks.completionRate)}
                </div>
                <div class="metrics-stat-content">
                    <div class="metrics-stat-label">Task Completion Rate</div>
                    <div class="metrics-stat-subtitle">${personalMetrics.tasks.completed} of ${personalMetrics.tasks.total} tasks</div>
                </div>
            </div>
        `;
        
        // Stat cards with tooltips
        const tasksTooltip = `Completed: ${personalMetrics.tasks.completedLast7Days} this week, ${personalMetrics.tasks.completedLast30Days} this month`;
        html += createStatCard(
            'fa-check-circle', 
            personalMetrics.tasks.completedLast7Days, 
            'Completed This Week', 
            `${personalMetrics.tasks.open} open`, 
            'success',
            tasksTooltip
        );
        
        const eventsTooltip = `${personalMetrics.events.total} total events created by you`;
        html += createStatCard(
            'fa-calendar-check', 
            personalMetrics.events.upcoming, 
            'Upcoming Events', 
            `${personalMetrics.events.createdLast30Days} created this month`,
            '',
            eventsTooltip
        );
        
        const messagesTotal = personalMetrics.messages.total;
        const messagesWeek = personalMetrics.messages.last7Days;
        const messagesAvg = messagesTotal > 0 && messagesWeek > 0 
            ? Math.round(messagesWeek / 7 * 10) / 10 
            : 0;
        const messagesDesc = messagesAvg > 0 ? `~${messagesAvg} per day` : 'Keep chatting!';
        html += createStatCard(
            'fa-comment', 
            personalMetrics.messages.last7Days, 
            'Messages This Week', 
            `${personalMetrics.messages.total} total`,
            '',
            messagesDesc
        );
        
        html += '</div>';
        
        // Personal trend chart (or empty state if no completed tasks)
        if (personalMetrics.tasks.completed === 0) {
            html += createMetricsEmptyState(
                'fa-tasks',
                'No Completed Tasks Yet',
                'Complete your first task to see your progress trend!'
            );
        } else {
            // Ensure dailyCompletions has proper structure for chart rendering
            const trendData = personalMetrics.trends.dailyCompletions.map(d => ({
                label: d.label,
                value: d.count,
                count: d.count
            }));
            html += createSwitchableGraphCard(
                'personal-trend',
                `My Task Completions (${timeBounds.label})`,
                'fa-chart-line',
                trendData,
                'trend'
            );
        }
    }
    
    // === Team Stats Section (only in team mode) ===
    if (access.mode === 'team' && teamMetrics) {
        html += `
            <div class="metrics-section-title metrics-section-title-team">
                <i class="fas fa-users"></i> Team Performance
            </div>
        `;
        
        const hasTeamTasks = teamMetrics.tasks.total > 0;
        const hasTeamActivity = hasTeamTasks || teamMetrics.events.total > 0 || teamMetrics.memberCount > 0;
        
        if (!hasTeamActivity) {
            // Empty state for team metrics
            html += createMetricsEmptyState(
                'fa-users',
                'No Team Activity Yet',
                'Create tasks, events, and invite team members to see team performance metrics.'
            );
        } else {
            // Team stat cards with tooltips
            html += '<div class="metrics-stats-row">';
            
            const teamCompletionTooltip = `${teamMetrics.tasks.completed} tasks done, ${teamMetrics.tasks.open} in progress or pending`;
            html += `
                <div class="metrics-stat-card metrics-stat-card-large" data-tooltip="${teamCompletionTooltip}">
                    <div class="metrics-progress-ring-container">
                        ${createProgressRing(teamMetrics.tasks.completionRate, 80, 8, 'var(--success)')}
                    </div>
                    <div class="metrics-stat-content">
                        <div class="metrics-stat-label">Team Completion Rate</div>
                        <div class="metrics-stat-subtitle">${teamMetrics.tasks.completed} of ${teamMetrics.tasks.total} tasks</div>
                    </div>
                </div>
            `;
            
            const openTasksTooltip = `${teamMetrics.tasks.completedLast30Days} completed this month`;
            html += createStatCard(
                'fa-tasks', 
                teamMetrics.tasks.open, 
                'Open Tasks', 
                `${teamMetrics.tasks.completedLast7Days} completed this week`, 
                'warning',
                openTasksTooltip
            );
            
            const eventsThisWeekTooltip = `${teamMetrics.events.total} events in total`;
            html += createStatCard(
                'fa-calendar-week', 
                teamMetrics.events.upcomingThisWeek, 
                'Events This Week', 
                `${teamMetrics.events.total} total events`,
                '',
                eventsThisWeekTooltip
            );
            
            const membersTooltip = `Team has ${teamMetrics.memberCount} ${teamMetrics.memberCount === 1 ? 'member' : 'members'}`;
            html += createStatCard(
                'fa-users', 
                teamMetrics.memberCount, 
                'Team Members', 
                `${teamMetrics.messages.last7Days} messages this week`,
                '',
                membersTooltip
            );
            
            html += '</div>';
            
            // Team trend chart (or empty state)
            if (teamMetrics.tasks.completed === 0) {
                html += createMetricsEmptyState(
                    'fa-chart-bar',
                    'No Completed Tasks Yet',
                    'Team members haven\'t completed any tasks yet. Metrics will appear once tasks are done!'
                );
            } else {
                // Ensure proper data structure for trend chart
                const teamTrendData = teamMetrics.trends.dailyCompletions.map(d => ({
                    label: d.label,
                    value: d.count,
                    count: d.count
                }));
                html += createSwitchableGraphCard(
                    'team-trend',
                    `Team Task Completions (${timeBounds.label})`,
                    'fa-chart-bar',
                    teamTrendData,
                    'trend'
                );
            }
            
            // Member breakdown bar chart (only show if there are members with tasks)
            const memberData = Object.values(teamMetrics.memberBreakdown)
                .filter(m => m.total > 0)
                .sort((a, b) => b.completed - a.completed)
                .slice(0, 10) // Top 10 members
                .map((m, index) => ({
                    label: m.name,
                    value: m.completed,
                    count: m.completed,
                    // Don't assign color here - let pie chart auto-assign distinct colors
                    color: undefined
                }));
            
            if (memberData.length > 0) {
                html += createSwitchableGraphCard(
                    'member-breakdown',
                    'Tasks Completed by Member',
                    'fa-trophy',
                    memberData,
                    'breakdown',
                    { colorByMember: true }
                );
            } else if (teamMetrics.memberCount > 0) {
                html += createMetricsEmptyState(
                    'fa-trophy',
                    'No Assigned Tasks Yet',
                    'Assign tasks to team members to see individual performance breakdown.'
                );
            }
        }
    }
    
    // === Custom Business Metrics Section ===
    const enabledMetrics = getEnabledCustomMetrics();
    const showCustomSection = enabledMetrics.length > 0 || metricsEditMode;
    
    if (showCustomSection) {
        html += `
            <div class="metrics-section-title metrics-section-title-custom">
                <i class="fas fa-chart-pie"></i> Business Metrics
                ${metricsEditMode ? '<span class="metrics-edit-badge">Editing</span>' : ''}
            </div>
        `;
        
        if (enabledMetrics.length > 0) {
            html += '<div class="metrics-stats-row custom-metrics-row">';
            
            enabledMetrics.forEach((metricId, index) => {
                const metric = CUSTOM_METRICS_CATALOG[metricId];
                if (metric) {
                    html += renderCustomMetricCard(metric, index, enabledMetrics.length);
                }
            });
            
            html += '</div>';
            
            // Show charts for metrics that have them (only if not in edit mode for cleaner UI)
            if (!metricsEditMode) {
                const metricsWithCharts = enabledMetrics
                    .map(id => CUSTOM_METRICS_CATALOG[id])
                    .filter(m => m && m.hasChart);
                
                if (metricsWithCharts.length > 0) {
                    const firstChartMetric = metricsWithCharts[0];
                    const chartData = firstChartMetric.chartData();
                    html += createSwitchableGraphCard(
                        `custom-${firstChartMetric.id || 'metric'}`,
                        `${firstChartMetric.name} Trend`,
                        firstChartMetric.icon,
                        chartData,
                        'trend'
                    );
                }
            }
        } else if (metricsEditMode) {
            // Show empty state with add button when in edit mode
            html += `
                <div class="metrics-empty-state custom-metrics-empty">
                    <div class="metrics-empty-icon">
                        <i class="fas fa-plus-circle"></i>
                    </div>
                    <div class="metrics-empty-title">No Custom Metrics Added</div>
                    <div class="metrics-empty-desc">Add business metrics to track customers, revenue, and more.</div>
                </div>
            `;
        }
        
        // Add metric button (only in edit mode)
        if (metricsEditMode) {
            const availableCount = Object.keys(CUSTOM_METRICS_CATALOG).length - enabledMetrics.length;
            if (availableCount > 0) {
                html += `
                    <button class="metrics-add-metric-btn" onclick="openAddMetricModal()">
                        <i class="fas fa-plus"></i>
                        <span>Add Metric (${availableCount} available)</span>
                    </button>
                `;
            }
        }
    }
    
    container.innerHTML = html;
    
    // Initialize custom dropdown after rendering
    initMetricsTimeDropdown();
}

// Make renderMetrics available globally for data listener updates
window.renderMetrics = renderMetrics;

/**
 * Update metrics if the metrics tab is currently active.
 * Call this from data listeners to keep metrics fresh.
 */
function updateMetricsIfActive() {
    if (appState.currentSection === 'metrics' && appState.metricsAccess?.canAccess) {
        renderMetrics();
    }
}

// ===================================
// NOTIFICATIONS SYSTEM
// ===================================

// Parse activity description to extract context for preference filtering
function parseActivityContext(activity) {
    const description = (activity.description || '').toLowerCase();
    const context = {};
    
    if (activity.type === 'task') {
        // Check for assignment-related keywords
        if (description.includes('assigned') || description.includes('assign')) {
            context.isAssignment = true;
        }
        // Check for completion-related keywords
        if (description.includes('completed') || description.includes('done') || description.includes('finished')) {
            context.isCompletion = true;
        }
    } else if (activity.type === 'message') {
        // Check for mention-related keywords
        if (description.includes('@') || description.includes('mentioned')) {
            context.isMention = true;
        }
        // Check for reply-related keywords
        if (description.includes('replied') || description.includes('reply')) {
            context.isReply = true;
        }
    } else if (activity.type === 'team') {
        // Check for new member keywords
        if (description.includes('joined') || description.includes('added') || description.includes('welcomed')) {
            context.isNewMember = true;
        }
        // Check for settings change keywords
        if (description.includes('settings') || description.includes('promoted') || 
            description.includes('demoted') || description.includes('role') ||
            description.includes('updated') || description.includes('changed')) {
            context.isSettingsChange = true;
        }
    }
    
    return context;
}

// Filter notifications based on user preferences
function filterNotificationsByPreferences(notifications) {
    return notifications.filter(notification => {
        const context = parseActivityContext(notification);
        return shouldShowNotification(notification.type, context);
    });
}

async function updateNotifications(activities) {
    if (!currentAuthUser) return;
    
    // Filter activities that are not from the current user and are recent (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let notifications = activities.filter(activity => {
        return activity.userId !== currentAuthUser.uid && 
               activity.timestamp > oneDayAgo;
    });
    
    // Apply user preference filtering
    notifications = filterNotificationsByPreferences(notifications);
    
    // Get unread notifications from Firestore
    const readNotifications = await getReadNotificationsFromFirestore();
    const unreadNotifications = notifications.filter(n => !readNotifications.includes(n.id));
    
    // Update badge
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (unreadNotifications.length > 0) {
            badge.textContent = unreadNotifications.length > 9 ? '9+' : unreadNotifications.length;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
    
    // Display notifications
    displayNotifications(notifications, readNotifications, currentNotificationFilter);
}

function displayNotifications(notifications, readNotifications, filterMode = 'unread') {
    const notificationsList = document.getElementById('notificationsList');
    if (!notificationsList) return;
    
    // Filter based on mode
    let filteredNotifications = notifications;
    if (filterMode === 'unread') {
        filteredNotifications = notifications.filter(n => !readNotifications.includes(n.id));
    }
    
    if (filteredNotifications.length === 0) {
        const message = filterMode === 'unread' ? 'No unread notifications' : 'No notifications';
        notificationsList.innerHTML = `<div class="no-notifications">${message}</div>`;
        return;
    }
    
    notificationsList.innerHTML = '';
    
    filteredNotifications.forEach(notification => {
        const isRead = readNotifications.includes(notification.id);
        const iconClass = notification.type === 'task' ? 'task-icon' : 
                         notification.type === 'message' ? 'message-icon' : 
                         notification.type === 'team' ? 'team-icon' : 'calendar-icon';
        const icon = notification.type === 'task' ? 'fa-check-circle' : 
                    notification.type === 'message' ? 'fa-comment' : 
                    notification.type === 'team' ? 'fa-user-plus' : 'fa-calendar';
        
        const notificationEl = document.createElement('div');
        notificationEl.className = `notification-item ${!isRead ? 'unread' : ''}`;
        notificationEl.style.cursor = 'pointer';
        notificationEl.innerHTML = `
            <div class="notification-icon ${iconClass}">
                <i class="fas ${icon}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-text">
                    <strong>${escapeHtml(notification.userName)}</strong> ${escapeHtml(notification.description)}
                </div>
                <div class="notification-time">${notification.timeAgo}</div>
            </div>
        `;
        
        notificationEl.addEventListener('click', () => {
            markNotificationAsRead(notification.id);
            navigateToNotificationSource(notification);
            // Close notifications dropdown
            const dropdown = document.getElementById('notificationsDropdown');
            if (dropdown) {
                dropdown.classList.remove('active');
            }
        });
        
        notificationsList.appendChild(notificationEl);
    });
}

window.markAllNotificationsRead = async function() {
    if (!appState.activities) return;
    
    const notificationIds = appState.activities
        .filter(a => a.userId !== currentAuthUser.uid)
        .map(a => a.id);
    
    await saveReadNotificationsToFirestore(notificationIds);
    
    // Update display
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        badge.style.display = 'none';
    }
    
    // Refresh notifications display
    displayNotifications(appState.activities.filter(a => a.userId !== currentAuthUser.uid), notificationIds, currentNotificationFilter);
}

async function markNotificationAsRead(notificationId) {
    const readNotifications = await getReadNotificationsFromFirestore();
    if (!readNotifications.includes(notificationId)) {
        readNotifications.push(notificationId);
        await saveReadNotificationsToFirestore(readNotifications);
        
        // Update badge
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            const currentCount = parseInt(badge.textContent) || 0;
            const newCount = Math.max(0, currentCount - 1);
            if (newCount > 0) {
                badge.textContent = newCount > 9 ? '9+' : newCount;
            } else {
                badge.style.display = 'none';
            }
        }
        
        // Refresh display
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const notifications = appState.activities.filter(a => 
            a.userId !== currentAuthUser.uid && a.timestamp > oneDayAgo
        );
        displayNotifications(notifications, readNotifications, currentNotificationFilter);
    }
}

async function markAllUnreadNotificationsAsRead() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const notifications = appState.activities.filter(a => 
        a.userId !== currentAuthUser.uid && a.timestamp > oneDayAgo
    );
    
    const readNotifications = await getReadNotificationsFromFirestore();
    let marked = false;
    
    notifications.forEach(notification => {
        if (!readNotifications.includes(notification.id)) {
            readNotifications.push(notification.id);
            marked = true;
        }
    });
    
    if (marked) {
        await saveReadNotificationsToFirestore(readNotifications);
        
        // Hide badge
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            badge.style.display = 'none';
        }
        
        // Refresh display
        displayNotifications(notifications, readNotifications, currentNotificationFilter);
    }
}

// ===================================
// FIRESTORE NOTIFICATION HELPERS
// ===================================

async function getReadNotificationsFromFirestore() {
    if (!db || !currentAuthUser) return [];
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            return userSnap.data().readNotifications || [];
        }
        
        return [];
    } catch (error) {
        console.error('Error loading read notifications:', error);
        return [];
    }
}

async function saveReadNotificationsToFirestore(readNotifications) {
    if (!db || !currentAuthUser) return;
    
    try {
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const userRef = doc(db, 'users', currentAuthUser.uid);
        
        // Update only the readNotifications field
        await setDoc(userRef, {
            readNotifications: readNotifications
        }, { merge: true });
        
        debugLog('✅ Read notifications saved to Firestore');
    } catch (error) {
        console.error('Error saving read notifications:', error);
    }
}

function navigateToNotificationSource(notification) {
    // Map notification types to sections
    const sectionMap = {
        'task': 'tasks',
        'message': 'chat',
        'calendar': 'calendar',
        'team': 'team'
    };
    
    const targetSection = sectionMap[notification.type] || 'activity';
    
    // Get all nav items and sections
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');
    
    // Update active nav item
    navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.section === targetSection) {
            nav.classList.add('active');
        }
    });
    
    // Update active section
    sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `${targetSection}-section`) {
            section.classList.add('active');
        }
    });
    
    // Update app state
    appState.currentSection = targetSection;
    
    // Scroll to top of the section
    const targetSectionEl = document.getElementById(`${targetSection}-section`);
    if (targetSectionEl) {
        targetSectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Toggle notification filter
let currentNotificationFilter = 'unread';

window.toggleNotificationFilter = function(filter) {
    currentNotificationFilter = filter;
    
    // Update button states
    const unreadBtn = document.getElementById('showUnreadBtn');
    const allBtn = document.getElementById('showAllBtn');
    
    if (unreadBtn && allBtn) {
        if (filter === 'unread') {
            unreadBtn.classList.add('active');
            allBtn.classList.remove('active');
        } else {
            unreadBtn.classList.remove('active');
            allBtn.classList.add('active');
        }
    }
    
    // Re-display notifications with the new filter
    if (!currentAuthUser) return;
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const notifications = appState.activities.filter(activity => {
        return activity.userId !== currentAuthUser.uid && 
               activity.timestamp > oneDayAgo;
    });
    
    const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');
    displayNotifications(notifications, readNotifications, filter);
}

// Refresh "time ago" text periodically (every minute)
function startActivityRefreshTimer() {
    setInterval(() => {
        if (appState.activities && appState.activities.length > 0) {
            // Update time ago for each activity
            appState.activities.forEach(activity => {
                activity.timeAgo = getTimeAgo(activity.timestamp);
            });
            
            // Refresh displays
            displayActivities();
            
            // Update notifications
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const notifications = appState.activities.filter(a => 
                a.userId !== currentAuthUser?.uid && a.timestamp > oneDayAgo
            );
            const readNotifications = JSON.parse(localStorage.getItem('readNotifications') || '[]');
            displayNotifications(notifications, readNotifications, currentNotificationFilter);
        }
    }, 60000); // Update every minute
}

// ===================================
// MODAL MANAGEMENT
// ===================================
// MODAL MANAGEMENT
// ===================================
function initModals() {
    // Notifications Dropdown
    const notificationsBtn = document.getElementById('notificationsBtn');
    const notificationsDropdown = document.getElementById('notificationsDropdown');
    
    if (notificationsBtn && notificationsDropdown) {
        // Toggle function for notifications dropdown
        const toggleNotificationsDropdown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = notificationsDropdown.style.display === 'block';
            
            // Toggle dropdown visibility
            notificationsDropdown.style.display = isVisible ? 'none' : 'block';
            
            // Close settings dropdown if open
            if (document.getElementById('settingsDropdown')) {
                document.getElementById('settingsDropdown').style.display = 'none';
            }
        };
        
        // Add both click and touchend for mobile compatibility
        notificationsBtn.addEventListener('click', toggleNotificationsDropdown);
        notificationsBtn.addEventListener('touchend', toggleNotificationsDropdown);
        
        // Prevent dropdown from closing when clicking/touching inside it
        notificationsDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        notificationsDropdown.addEventListener('touchend', (e) => {
            e.stopPropagation();
        });
    }
    
    // Settings Dropdown in Top Bar
    const topBarSettingsBtn = document.getElementById('topBarSettingsBtn');
    const settingsDropdown = document.getElementById('settingsDropdown');
    
    if (topBarSettingsBtn && settingsDropdown) {
        // Toggle function for settings dropdown
        const toggleSettingsDropdown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = settingsDropdown.style.display === 'block';
            settingsDropdown.style.display = isVisible ? 'none' : 'block';
            
            // Close notifications dropdown if open
            if (notificationsDropdown) {
                notificationsDropdown.style.display = 'none';
            }
        };
        
        // Add both click and touchend for mobile compatibility
        topBarSettingsBtn.addEventListener('click', toggleSettingsDropdown);
        topBarSettingsBtn.addEventListener('touchend', toggleSettingsDropdown);
        
        // Close dropdown when clicking/touching outside
        document.addEventListener('click', () => {
            settingsDropdown.style.display = 'none';
            if (notificationsDropdown) {
                notificationsDropdown.style.display = 'none';
            }
        });
        document.addEventListener('touchend', (e) => {
            // Only close if not touching the settings or notifications buttons
            if (!topBarSettingsBtn.contains(e.target) && !settingsDropdown.contains(e.target) &&
                (!notificationsBtn || !notificationsBtn.contains(e.target)) &&
                (!notificationsDropdown || !notificationsDropdown.contains(e.target))) {
                settingsDropdown.style.display = 'none';
                if (notificationsDropdown) {
                    notificationsDropdown.style.display = 'none';
                }
            }
        });
        
        // Prevent dropdown from closing when clicking/touching inside it
        settingsDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        settingsDropdown.addEventListener('touchend', (e) => {
            e.stopPropagation();
        });
    }
    
    // Event Modal
    const eventModal = document.getElementById('eventModal');
    const eventForm = document.getElementById('eventForm');
    const closeEventModal = document.getElementById('closeEventModal');
    const cancelEventBtn = document.getElementById('cancelEventBtn');
    
    // Helper to reset event modal to initial state
    function resetEventModal() {
        eventForm.reset();
        delete eventForm.dataset.editingEventId;
        const titleEl = document.querySelector('#eventModal .unified-modal-title h2');
        const submitBtn = document.querySelector('#eventModal .unified-btn-primary');
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-calendar-plus"></i> New Event';
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Add Event';
        // Reset textarea height
        const descTextarea = document.getElementById('eventDescription');
        if (descTextarea) {
            descTextarea.style.height = 'auto';
            descTextarea.style.overflowY = 'hidden';
        }
        closeModal('eventModal');
    }

    closeEventModal.addEventListener('click', resetEventModal);
    cancelEventBtn.addEventListener('click', resetEventModal);
    
    // Auto-expanding textarea for event description
    const eventDescriptionTextarea = document.getElementById('eventDescription');
    if (eventDescriptionTextarea) {
        function autoExpandTextarea() {
            // Reset height to auto to get the correct scrollHeight
            eventDescriptionTextarea.style.height = 'auto';
            // Set to scrollHeight but respect max-height from CSS
            const maxHeight = 200;
            const newHeight = Math.min(eventDescriptionTextarea.scrollHeight, maxHeight);
            eventDescriptionTextarea.style.height = newHeight + 'px';
            // Show scrollbar if content exceeds max height
            eventDescriptionTextarea.style.overflowY = eventDescriptionTextarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
        }
        
        eventDescriptionTextarea.addEventListener('input', autoExpandTextarea);
        eventDescriptionTextarea.addEventListener('focus', autoExpandTextarea);
    }
    
    // Real-time duration calculation and validation for 24-hour format
    const startHourInput = document.getElementById('eventHour');
    const startMinuteInput = document.getElementById('eventMinute');
    const endHourInput = document.getElementById('eventEndHour');
    const endMinuteInput = document.getElementById('eventEndMinute');
    const durationDisplay = document.getElementById('eventDuration');
    const durationText = document.getElementById('durationText');
    const eventColorInput = document.getElementById('eventColor');
    
    // Event color option buttons - updated for unified color picker
    const eventColorOptions = document.querySelectorAll('#eventModal .unified-color-option');
    eventColorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const color = option.getAttribute('data-color');
            eventColorInput.value = color;
            
            // Update selected state
            eventColorOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
        });
    });
    
    // Event visibility option buttons
    const visibilityOptions = document.querySelectorAll('#eventModal .visibility-option');
    visibilityOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Update selected state
            visibilityOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            
            // Check the corresponding radio
            const radio = option.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });
    
    // Event repeat option buttons
    const repeatOptions = document.querySelectorAll('#eventModal .repeat-option');
    const repeatHelper = document.getElementById('repeatHelper');
    const repeatHelperText = document.getElementById('repeatHelperText');
    
    function updateRepeatHelper() {
        const selectedRepeat = document.querySelector('input[name="eventRepeat"]:checked')?.value || 'none';
        const dateInput = document.getElementById('eventDate');
        const dateStr = dateInput?.value;
        
        if (selectedRepeat === 'none' || !dateStr) {
            if (repeatHelper) repeatHelper.style.display = 'none';
            return;
        }
        
        const startDate = new Date(dateStr + 'T00:00:00');
        const dayName = startDate.toLocaleDateString('en-US', { weekday: 'long' });
        const dayOfMonth = startDate.getDate();
        const monthName = startDate.toLocaleDateString('en-US', { month: 'long' });
        
        let helperText = '';
        switch (selectedRepeat) {
            case 'daily':
                helperText = `This will repeat every day starting from ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                break;
            case 'weekly':
                helperText = `This will repeat every ${dayName} starting from ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                break;
            case 'monthly':
                helperText = `This will repeat on the ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of every month`;
                break;
            case 'yearly':
                helperText = `This will repeat every ${monthName} ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)}`;
                break;
        }
        
        if (repeatHelper && repeatHelperText) {
            repeatHelperText.textContent = helperText;
            repeatHelper.style.display = 'flex';
        }
    }
    
    repeatOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Update selected state
            repeatOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            
            // Check the corresponding radio
            const radio = option.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
            
            updateRepeatHelper();
        });
    });
    
    // Update repeat helper when date changes
    const eventDateInput = document.getElementById('eventDate');
    if (eventDateInput) {
        eventDateInput.addEventListener('change', updateRepeatHelper);
    }
    
    // Helper function to convert to total minutes from midnight
    function toMinutes(hour, minute) {
        const h = parseInt(hour);
        const m = parseInt(minute);
        
        if (isNaN(h) || isNaN(m)) return null;
        
        // Ensure hour is in range 0-23
        if (h < 0 || h > 23) return null;
        
        return h * 60 + m;
    }
    
    function updateDuration() {
        const startMinutes = toMinutes(startHourInput.value, startMinuteInput.value);
        const endMinutes = toMinutes(endHourInput.value, endMinuteInput.value);
        
        if (startMinutes !== null && endMinutes !== null) {
            let diffMinutes = endMinutes - startMinutes;
            
            // Handle case where end time is next day
            if (diffMinutes < 0) {
                diffMinutes += 24 * 60;
            }
            
            durationDisplay.style.display = 'flex';
            
            if (diffMinutes === 0) {
                durationDisplay.classList.add('error');
                durationText.textContent = 'End time must be different from start time';
            } else {
                durationDisplay.classList.remove('error');
                
                const hours = Math.floor(diffMinutes / 60);
                const minutes = diffMinutes % 60;
                
                if (hours > 0) {
                    durationText.textContent = `${hours} hour${hours > 1 ? 's' : ''} ${minutes > 0 ? minutes + ' min' : ''}`;
                } else {
                    durationText.textContent = `${minutes} minute${minutes > 1 ? 's' : ''}`;
                }
            }
        } else {
            durationDisplay.style.display = 'none';
        }
    }
    
    startHourInput.addEventListener('input', updateDuration);
    startMinuteInput.addEventListener('input', updateDuration);
    endHourInput.addEventListener('input', updateDuration);
    endMinuteInput.addEventListener('input', updateDuration);
    
    // Auto-format and validate time inputs for 24-hour format
    function validateTimeInput(input, min, max) {
        let value = parseInt(input.value);
        if (isNaN(value) || value < min) {
            input.value = '';
        } else if (value > max) {
            input.value = max;
        }
        // Pad with leading zero
        if (input.value && input.value.length === 1) {
            input.value = '0' + input.value;
        }
    }
    
    startHourInput.addEventListener('blur', () => validateTimeInput(startHourInput, 0, 23));
    startMinuteInput.addEventListener('blur', () => validateTimeInput(startMinuteInput, 0, 59));
    endHourInput.addEventListener('blur', () => validateTimeInput(endHourInput, 0, 23));
    endMinuteInput.addEventListener('blur', () => validateTimeInput(endMinuteInput, 0, 59));

    eventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Event form submitted');
        
        const dateStr = document.getElementById('eventDate').value;
        
        // Use 24-hour format directly
        const startHour = parseInt(startHourInput.value);
        const startMinute = parseInt(startMinuteInput.value) || 0;
        const endHour = parseInt(endHourInput.value);
        const endMinute = parseInt(endMinuteInput.value) || 0;
        
        const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
        const endTimeStr = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
        
        // Get visibility setting
        const visibilityRadio = document.querySelector('input[name="eventVisibility"]:checked');
        const visibility = visibilityRadio ? visibilityRadio.value : 'team';
        
        // Get repeat setting
        const repeatRadio = document.querySelector('input[name="eventRepeat"]:checked');
        const repeat = repeatRadio ? repeatRadio.value : 'none';
        
        if (DEBUG) console.log('Form values:', { dateStr, startTimeStr, endTimeStr, visibility, repeat });
        
        // Create full datetime objects
        const startDate = new Date(dateStr + 'T' + startTimeStr);
        const endDate = new Date(dateStr + 'T' + endTimeStr);
        
        // Handle case where end time is before start time (assume next day)
        if (endDate <= startDate) {
            endDate.setDate(endDate.getDate() + 1);
        }
        
        // Check if we're editing or creating
        const editingEventId = eventForm.dataset.editingEventId;
        const isEditing = !!editingEventId;
        
        const event = {
            id: isEditing ? editingEventId : Date.now().toString(),
            title: document.getElementById('eventTitle').value,
            date: startDate,
            endDate: endDate,
            time: startTimeStr,
            endTime: endTimeStr,
            description: document.getElementById('eventDescription').value,
            color: eventColorInput.value,
            visibility: visibility,
            repeat: repeat,
            repeatStart: repeat !== 'none' ? startDate : null,
            teamId: appState.currentTeamId
        };
        
        console.log('📅 Event being saved:', {
            repeat: event.repeat,
            repeatStart: event.repeatStart,
            date: event.date
        });

        if (DEBUG) console.log(`${isEditing ? 'Updating' : 'Creating'} event:`, event);

        try {
            if (isEditing) {
                // Update existing event
                await updateEventInFirestore(event);
                
                // Add to activity feed
                addActivity({
                    type: 'calendar',
                    description: `updated event "${event.title}"`
                });
                
                debugLog('✅ Event updated successfully');
            } else {
                // Create new event
                await saveEventToFirestore(event);
                
                // Add to activity feed
                addActivity({
                    type: 'calendar',
                    description: `created event "${event.title}"`
                });
                
                debugLog('✅ Event created successfully');
            }
            
            // Reset form and modal state
            eventForm.reset();
            delete eventForm.dataset.editingEventId;
            const titleEl = document.querySelector('#eventModal .unified-modal-title h2');
            const submitBtn = document.querySelector('#eventModal .unified-btn-primary');
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-calendar-plus"></i> New Event';
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Add Event';
            
            // Reset visibility and repeat to default
            resetEventVisibility();
            resetEventRepeat();
            
            closeModal('eventModal');
        } catch (error) {
            console.error('Error in event submission:', error);
            showToast(`Error ${isEditing ? 'updating' : 'creating'} event: ` + error.message, 'error', 5000, 'Event Error');
        }
    });

    // Task Modal
    const taskModal = document.getElementById('taskModal');
    // Teammate Modal
    const teammateForm = document.getElementById('teammateForm');
    const closeTeammateModal = document.getElementById('closeTeammateModal');
    const cancelTeammateBtn = document.getElementById('cancelTeammateBtn');

    if (closeTeammateModal) closeTeammateModal.addEventListener('click', () => closeModal('teammateModal'));
    if (cancelTeammateBtn) cancelTeammateBtn.addEventListener('click', () => closeModal('teammateModal'));

    if (teammateForm) {
        teammateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const invitedEmail = document.getElementById('teammateEmail').value.trim();
            const invitedName = document.getElementById('teammateName').value.trim();
            const occupation = document.getElementById('teammateOccupation').value.trim();

            if (!invitedEmail) {
                showToast('Please enter an email address', 'error', 4000, 'Validation Error');
                return;
            }

            try {
                // This will check rate limits and create the invitation
                await sendTeamInvitation(invitedEmail, invitedName, occupation);
                
                // Form will be cleared and modal closed by showInviteLink
                teammateForm.reset();
                
            } catch (error) {
                console.error('Error sending invitation:', error);
                // Show user-friendly error message
                showToast(error.message || 'Failed to send invitation. Please try again.', 'error', 6000, 'Invitation Failed');
            }
        });
    }

    const taskForm = document.getElementById('taskForm');
    const closeTaskModal = document.getElementById('closeTaskModal');
    const cancelTaskBtn = document.getElementById('cancelTaskBtn');
    const taskDueDateInput = document.getElementById('taskDueDate');
    const dueDateHelper = document.getElementById('dueDateHelper');

    // Show helper text when due date is selected
    if (taskDueDateInput && dueDateHelper) {
        taskDueDateInput.addEventListener('change', () => {
            if (taskDueDateInput.value) {
                dueDateHelper.style.display = 'block';
            } else {
                dueDateHelper.style.display = 'none';
            }
        });
    }

    closeTaskModal.addEventListener('click', () => {
        taskForm.reset();
        if (dueDateHelper) dueDateHelper.style.display = 'none';
        closeModal('taskModal');
    });
    
    cancelTaskBtn.addEventListener('click', () => {
        taskForm.reset();
        if (dueDateHelper) dueDateHelper.style.display = 'none';
        closeModal('taskModal');
    });

    // ===================================
    // CUSTOM DROPDOWN INITIALIZATION
    // Initialize the Apple-like dropdowns for task modal
    // ===================================
    initTaskModalDropdowns();
    initTaskTitleWordLimit();
    initTaskModalProgressSlider();

    taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const assigneeId = document.getElementById('taskAssignee').value;
        const editingTaskId = taskForm.dataset.editingTaskId;
        const isEditing = !!editingTaskId;
        
        // Validate assignee is a team member
        if (!assigneeId) {
            showToast('Please select a team member to assign this task to.', 'error');
            return;
        }
        
        // Get assignee name
        let assigneeName = '';
        if (currentAuthUser && assigneeId === currentAuthUser.uid) {
            assigneeName = currentAuthUser.displayName || currentAuthUser.email;
        } else {
            const assignee = appState.teammates.find(t => t.id === assigneeId);
            if (!assignee) {
                showToast('Invalid assignee. Please select a valid team member.', 'error');
                return;
            }
            assigneeName = assignee.name;
        }
        
        // Get due date if provided
        const dueDateInput = document.getElementById('taskDueDate').value;
        let dueDate = null;
        if (dueDateInput) {
            dueDate = new Date(dueDateInput).getTime();
        }

        // Get new fields
        const budgetInput = document.getElementById('taskBudget');
        const estimatedTimeInput = document.getElementById('taskEstimatedTime');
        const progressSlider = document.getElementById('taskProgress');
        const spreadsheetSelect = document.getElementById('taskSpreadsheet');
        const showOnCalendarCheckbox = document.getElementById('taskShowOnCalendar');
        
        // Validate title - 20 word limit
        let taskTitle = document.getElementById('taskTitle').value.trim();
        const wordCount = taskTitle.split(/\s+/).filter(word => word.length > 0).length;
        if (wordCount > 20) {
            // Truncate to 20 words
            taskTitle = taskTitle.split(/\s+/).slice(0, 20).join(' ');
            showToast('Task title limited to 20 words', 'warning');
        }
        
        const task = {
            title: taskTitle,
            description: document.getElementById('taskDescription').value,
            assigneeId: assigneeId,  // Store user ID
            assignee: assigneeName,   // Store name for display
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value || 'todo',
            dueDate: dueDate,  // Store due date timestamp (null if not set)
            budget: budgetInput ? parseFloat(budgetInput.value) || null : null,
            estimatedTime: estimatedTimeInput ? parseFloat(estimatedTimeInput.value) || null : null,
            progress: progressSlider ? parseInt(progressSlider.value) || 0 : 0,
            spreadsheetId: spreadsheetSelect ? spreadsheetSelect.value : 'default',
            showOnCalendar: showOnCalendarCheckbox ? showOnCalendarCheckbox.checked : true,
            createdBy: currentAuthUser ? currentAuthUser.uid : null,
            createdAt: Date.now()
        };

        if (isEditing) {
            // Update existing task
            const existingTaskIndex = appState.tasks.findIndex(t => String(t.id) === String(editingTaskId));
            if (existingTaskIndex !== -1) {
                task.id = editingTaskId;
                task.createdAt = appState.tasks[existingTaskIndex].createdAt;
                task.createdBy = appState.tasks[existingTaskIndex].createdBy;
                appState.tasks[existingTaskIndex] = task;
                
                // Update in Firestore
                if (db && currentAuthUser && appState.currentTeamId) {
                    await updateTaskInFirestore(task);
                }
                
                showToast('Task updated successfully', 'success');
                
                // Add to activity feed only if NOT a private spreadsheet task
                const spreadsheet = appState.spreadsheets.find(s => s.id === task.spreadsheetId);
                const isPrivateSpreadsheet = spreadsheet && spreadsheet.visibility === 'private';
                
                if (!isPrivateSpreadsheet) {
                    addActivity({
                        type: 'task',
                        description: `updated task "${task.title}"`
                    });
                }
            }
        } else {
            // Save to Firestore first to get the real ID
            if (db && currentAuthUser && appState.currentTeamId) {
                const firestoreId = await saveTaskToFirestore(task);
                if (firestoreId) {
                    task.id = firestoreId; // Use Firestore's document ID
                } else {
                    task.id = Date.now(); // Fallback to timestamp if Firestore fails
                }
            } else {
                task.id = Date.now(); // Fallback for offline mode
            }

            appState.tasks.push(task);
            
            // Add to activity feed only if NOT a private spreadsheet task
            const spreadsheet = appState.spreadsheets.find(s => s.id === task.spreadsheetId);
            const isPrivateSpreadsheet = spreadsheet && spreadsheet.visibility === 'private';
            
            if (!isPrivateSpreadsheet) {
                addActivity({
                    type: 'task',
                    description: `created task "${task.title}" assigned to ${assigneeName}`
                });
            }
        }
        
        saveToLocalStorage('tasks', appState.tasks);
        
        // Update display
        if (window.displayTasks) {
            window.displayTasks();
        }

        taskForm.reset();
        delete taskForm.dataset.editingTaskId;
        
        // Reset modal title and button
        const titleEl = document.querySelector('#taskModal .unified-modal-title h2');
        const submitBtn = document.querySelector('#taskModal .unified-btn-primary');
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-plus-circle"></i> New Task';
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Task';
        
        // Reset status dropdown to default
        const taskStatus = document.getElementById('taskStatus');
        if (taskStatus) taskStatus.value = 'todo';

        // Reset progress bar (range slider + number input + fill + badge)
        const resetProgressInput = document.getElementById('taskProgress');
        const resetProgressSlider = document.getElementById('taskProgressSlider');
        const resetProgressFill = document.getElementById('taskProgressFill');
        const resetProgressBadge = document.getElementById('taskProgressBadge');
        if (resetProgressInput) {
            resetProgressInput.value = 0;
            if (resetProgressSlider) {
                resetProgressSlider.value = 0;
            }
            if (resetProgressFill) {
                resetProgressFill.style.width = '0%';
            }
            if (resetProgressBadge) {
                resetProgressBadge.textContent = '0%';
            }
        }
        
        // Hide due date helper
        const dueDateHelper = document.getElementById('dueDateHelper');
        if (dueDateHelper) dueDateHelper.style.display = 'none';
        
        closeModal('taskModal');
    });

    // ===================================
    // ADD LEAD MODAL LOGIC
    // ===================================
    const leadForm = document.getElementById('leadForm');
    const closeLeadModal = document.getElementById('closeLeadModal');
    const cancelLeadBtn = document.getElementById('cancelLeadBtn');
    
    if (closeLeadModal) {
        closeLeadModal.addEventListener('click', () => closeModal('leadModal'));
    }
    if (cancelLeadBtn) {
        cancelLeadBtn.addEventListener('click', () => closeModal('leadModal'));
    }
    
    // Initialize lead modal dropdowns
    initLeadModalDropdowns();
    
    if (leadForm) {
        leadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const leadNameInput = document.getElementById('leadName');
            const leadName = leadNameInput?.value?.trim();
            
            if (!leadName) {
                showToast('Lead name is required', 'error');
                return;
            }
            
            const spreadsheetId = document.getElementById('leadSpreadsheet')?.value;
            if (!spreadsheetId) {
                showToast('Please select a spreadsheet', 'error');
                return;
            }
            
            const lead = {
                leadName: leadName,
                status: document.getElementById('leadStatus')?.value || 'New',
                source: document.getElementById('leadSource')?.value || 'Website',
                value: parseFloat(document.getElementById('leadValue')?.value) || null,
                contact: document.getElementById('leadContact')?.value?.trim() || null,
                notes: document.getElementById('leadNotes')?.value?.trim() || null,
                spreadsheetId: spreadsheetId,
                createdBy: currentAuthUser?.uid || null,
                createdAt: Date.now()
            };
            
            // Save to Firestore first to get the real ID
            if (db && currentAuthUser && appState.currentTeamId) {
                const firestoreId = await saveTaskToFirestore(lead);
                if (firestoreId) {
                    lead.id = firestoreId;
                } else {
                    lead.id = Date.now();
                }
            } else {
                lead.id = Date.now();
            }
            
            appState.tasks.push(lead);
            saveToLocalStorage('tasks', appState.tasks);
            
            // Update display
            if (window.displayTasks) {
                window.displayTasks();
            }
            
            // Add to activity feed
            const spreadsheet = appState.spreadsheets.find(s => s.id === spreadsheetId);
            const isPrivateSpreadsheet = spreadsheet && spreadsheet.visibility === 'private';
            
            if (!isPrivateSpreadsheet) {
                addActivity({
                    type: 'lead',
                    description: `added new lead "${leadName}"`
                });
            }
            
            leadForm.reset();
            resetLeadModalDropdowns();
            closeModal('leadModal');
            showToast(`Lead "${leadName}" created!`, 'success');
        });
    }

    // Event Details Modal
    const closeEventDetailsModal = document.getElementById('closeEventDetailsModal');
    closeEventDetailsModal.addEventListener('click', () => closeModal('eventDetailsModal'));

    // Logout All Devices Modal
    const closeLogoutAllModal = document.getElementById('closeLogoutAllModal');
    const cancelLogoutAll = document.getElementById('cancelLogoutAll');
    const confirmLogoutAll = document.getElementById('confirmLogoutAll');
    
    if (closeLogoutAllModal) {
        closeLogoutAllModal.addEventListener('click', () => closeModal('logoutAllModal'));
    }
    if (cancelLogoutAll) {
        cancelLogoutAll.addEventListener('click', () => closeModal('logoutAllModal'));
    }
    if (confirmLogoutAll) {
        confirmLogoutAll.addEventListener('click', () => {
            closeModal('logoutAllModal');
            forceLogoutEverywhere();
        });
    }

    // Delete Chat History Modal
    const closeDeleteChatHistoryModal = document.getElementById('closeDeleteChatHistoryModal');
    const cancelDeleteChatHistory = document.getElementById('cancelDeleteChatHistory');
    const confirmDeleteChatHistory = document.getElementById('confirmDeleteChatHistory');
    
    if (closeDeleteChatHistoryModal) {
        closeDeleteChatHistoryModal.addEventListener('click', () => closeModal('deleteChatHistoryModal'));
    }
    if (cancelDeleteChatHistory) {
        cancelDeleteChatHistory.addEventListener('click', () => closeModal('deleteChatHistoryModal'));
    }
    if (confirmDeleteChatHistory) {
        confirmDeleteChatHistory.addEventListener('click', () => {
            clearAllMessages();
        });
    }

    // Role management pending variables (make them global so window functions can access)
    window.pendingPromoteUserId = null;
    window.pendingPromoteUserName = null;
    window.pendingDemoteUserId = null;
    window.pendingDemoteUserName = null;
    window.pendingKickUserId = null;
    window.pendingKickUserName = null;

    // Promote Modal
    const confirmPromote = document.getElementById('confirmPromote');
    if (confirmPromote) {
        console.log('Confirm promote button found, adding event listener');
        confirmPromote.addEventListener('click', () => {
            console.log('Confirm promote button clicked!');
            console.log('pendingPromoteUserId:', window.pendingPromoteUserId);
            console.log('pendingPromoteUserName:', window.pendingPromoteUserName);
            if (window.pendingPromoteUserId && window.pendingPromoteUserName) {
                console.log('Calling closePromoteModal and promoteToAdmin');
                // Save values before closing (which clears them)
                const userId = window.pendingPromoteUserId;
                const userName = window.pendingPromoteUserName;
                closePromoteModal();
                promoteToAdmin(userId, userName);
            } else {
                console.error('Missing userId or userName!');
            }
        });
    } else {
        console.error('confirmPromote button not found!');
    }

    // Demote Modal
    const confirmDemote = document.getElementById('confirmDemote');
    if (confirmDemote) {
        confirmDemote.addEventListener('click', () => {
            if (window.pendingDemoteUserId && window.pendingDemoteUserName) {
                // Save values before closing
                const userId = window.pendingDemoteUserId;
                const userName = window.pendingDemoteUserName;
                closeDemoteModal();
                demoteToMember(userId, userName);
            }
        });
    }

    // Kick Modal
    const confirmKick = document.getElementById('confirmKick');
    if (confirmKick) {
        confirmKick.addEventListener('click', () => {
            if (window.pendingKickUserId && window.pendingKickUserName) {
                // Save values before closing
                const userId = window.pendingKickUserId;
                const userName = window.pendingKickUserName;
                closeKickModal();
                removeMember(userId, userName);
            }
        });
    }

    // Close modal on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
    
    // Also handle unified modals (new system)
    document.querySelectorAll('.unified-modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('active');
    
    // Bug fix 2: Reset event form duration display when opening event modal
    if (modalId === 'eventModal') {
        const eventForm = document.getElementById('eventForm');
        
        // Only reset if not editing an event
        if (!eventForm.dataset.editingEventId) {
            const durationDisplay = document.getElementById('eventDuration');
            if (durationDisplay) {
                durationDisplay.style.display = 'block';
            }
            const durationText = document.getElementById('durationText');
            if (durationText) {
                durationText.textContent = '0 minutes';
            }
            
            // Reset modal title and button text for unified modal
            const titleEl = document.querySelector('#eventModal .unified-modal-title h2');
            if (titleEl) {
                titleEl.innerHTML = '<i class="fas fa-calendar-plus"></i> New Event';
            }
            const btnEl = document.querySelector('#eventModal .unified-btn-primary');
            if (btnEl) {
                btnEl.innerHTML = '<i class="fas fa-check"></i> Add Event';
            }
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('active');
}

// Reset event visibility selector to default
function resetEventVisibility() {
    document.querySelectorAll('.visibility-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.visibility === 'team') {
            opt.classList.add('selected');
            opt.querySelector('input[type="radio"]').checked = true;
        } else {
            opt.querySelector('input[type="radio"]').checked = false;
        }
    });
}

// Reset event repeat selector to default
function resetEventRepeat() {
    document.querySelectorAll('.repeat-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.repeat === 'none') {
            opt.classList.add('selected');
            const radio = opt.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        } else {
            const radio = opt.querySelector('input[type="radio"]');
            if (radio) radio.checked = false;
        }
    });
    const repeatHelper = document.getElementById('repeatHelper');
    if (repeatHelper) repeatHelper.style.display = 'none';
}

// Set event repeat selector to specific value
function setEventRepeat(repeat) {
    document.querySelectorAll('.repeat-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.repeat === repeat) {
            opt.classList.add('selected');
            const radio = opt.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        } else {
            const radio = opt.querySelector('input[type="radio"]');
            if (radio) radio.checked = false;
        }
    });
}

// Set event visibility selector to specific value
function setEventVisibility(visibility) {
    document.querySelectorAll('.visibility-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.visibility === visibility) {
            opt.classList.add('selected');
            opt.querySelector('input[type="radio"]').checked = true;
        } else {
            opt.querySelector('input[type="radio"]').checked = false;
        }
    });
}

// Open edit event modal with existing event data
function openEditEventModal(event) {
    console.log('openEditEventModal called with:', event);
    
    // Populate the form with existing event data
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description || '';
    
    // Set date
    const eventDate = new Date(event.date);
    const dateStr = eventDate.toISOString().split('T')[0];
    document.getElementById('eventDate').value = dateStr;
    
    // Set start time
    document.getElementById('eventHour').value = String(eventDate.getHours()).padStart(2, '0');
    document.getElementById('eventMinute').value = String(eventDate.getMinutes()).padStart(2, '0');
    
    // Set end time
    const endDate = event.endDate ? new Date(event.endDate) : new Date(eventDate.getTime() + 60*60*1000);
    document.getElementById('eventEndHour').value = String(endDate.getHours()).padStart(2, '0');
    document.getElementById('eventEndMinute').value = String(endDate.getMinutes()).padStart(2, '0');
    
    // Set color
    const colorInput = document.getElementById('eventColor');
    colorInput.value = event.color || '#007AFF';
    
    // Update event color option selection (unified style)
    document.querySelectorAll('.unified-color-option').forEach(btn => {
        if (btn.dataset.color === colorInput.value) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    // Set visibility
    setEventVisibility(event.visibility || 'team');
    
    // Set repeat option
    setEventRepeat(event.repeat || 'none');
    
    // Update repeat helper text if needed
    if (event.repeat && event.repeat !== 'none') {
        const repeatHelper = document.getElementById('repeatHelper');
        const repeatHelperText = document.getElementById('repeatHelperText');
        if (repeatHelper && repeatHelperText) {
            const startDate = new Date(event.date);
            const dayName = startDate.toLocaleDateString('en-US', { weekday: 'long' });
            const dayOfMonth = startDate.getDate();
            const monthName = startDate.toLocaleDateString('en-US', { month: 'long' });
            
            let helperText = '';
            switch (event.repeat) {
                case 'daily':
                    helperText = `This event repeats every day`;
                    break;
                case 'weekly':
                    helperText = `This event repeats every ${dayName}`;
                    break;
                case 'monthly':
                    helperText = `This event repeats on the ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of every month`;
                    break;
                case 'yearly':
                    helperText = `This event repeats every ${monthName} ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)}`;
                    break;
            }
            repeatHelperText.textContent = helperText;
            repeatHelper.style.display = 'flex';
        }
    }
    
    // Change modal title and button text (unified style)
    const titleEl = document.querySelector('#eventModal .unified-modal-title h2');
    if (titleEl) {
        titleEl.innerHTML = '<i class="fas fa-calendar-plus"></i> Edit Event';
    }
    const btnEl = document.querySelector('#eventModal .unified-btn-primary');
    if (btnEl) {
        btnEl.innerHTML = '<i class="fas fa-check"></i> Update Event';
    }
    
    // Store event ID for update
    document.getElementById('eventForm').dataset.editingEventId = event.id;
    
    // Trigger duration calculation by dispatching input event
    const startHourInput = document.getElementById('eventHour');
    if (startHourInput) {
        startHourInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    openModal('eventModal');
}

// View event details
async function viewEventDetails(eventId, occurrenceDateStr = '') {
    if (DEBUG) console.log('🔍 viewEventDetails called with:', eventId, 'occurrence:', occurrenceDateStr);
    
    try {
        const event = appState.events.find(e => e.id === eventId);
        if (!event) {
            console.error('❌ Event not found');
            debugError('Event ID:', eventId);
            return;
        }
        
        if (DEBUG) console.log('✅ Event found:', event);
        
        // Get team info to check permissions
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamSnap = await getDoc(teamRef);
        
        const teamData = teamSnap.exists() ? teamSnap.data() : null;
        const members = teamData?.members || {};
        const isTeamMember = currentAuthUser.uid in members;
        const isOwner = teamData?.owner === currentAuthUser.uid;
        const userRole = getCurrentUserRole(teamData);
        const isAdmin = userRole === 'admin' || userRole === 'owner';
        
        if (DEBUG) {
            console.log('👥 Team member:', isTeamMember, 'Owner:', isOwner, 'Admin:', isAdmin);
        }
    
    // Populate modal - new modern design
    // Use occurrence date if provided, otherwise use event date
    let eventDate;
    if (occurrenceDateStr && event.repeat && event.repeat !== 'none') {
        eventDate = new Date(occurrenceDateStr);
        // Preserve the original time
        const originalDate = new Date(event.date);
        eventDate.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);
    } else {
        eventDate = new Date(event.date);
    }
    
    // Calculate end date based on original event duration
    const originalStart = new Date(event.date);
    const originalEnd = event.endDate ? new Date(event.endDate) : new Date(originalStart.getTime() + 60*60*1000);
    const durationMs = originalEnd.getTime() - originalStart.getTime();
    const endDate = new Date(eventDate.getTime() + durationMs);
    
    const eventColor = event.color || '#007AFF';
    
    // Title and subtitle
    document.getElementById('eventDetailsTitle').textContent = event.title;
    document.getElementById('eventSubtitle').textContent = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
    
    // Date
    document.getElementById('detailDate').textContent = eventDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    
    // Time - use 24h format
    const startTime24 = formatTime24(eventDate.getHours(), eventDate.getMinutes());
    const endTime24 = formatTime24(endDate.getHours(), endDate.getMinutes());
    document.getElementById('detailTime').textContent = `${startTime24} – ${endTime24}`;
    
    // Duration
    const diffMs = endDate - eventDate;
    const diffMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    let durationText = '';
    if (hours > 0) {
        durationText = `${hours}h ${minutes > 0 ? minutes + 'm' : ''}`;
    } else {
        durationText = `${minutes} min`;
    }
    document.getElementById('detailDuration').textContent = durationText;
    
    // Get the creator's username from team members
    let creatorName = event.createdByName || 'Unknown';
    if (teamData && teamData.members && event.createdBy) {
        const creatorMember = teamData.members[event.createdBy];
        if (creatorMember && creatorMember.name) {
            creatorName = creatorMember.name;
        }
    }
    document.getElementById('detailCreatedBy').textContent = creatorName;
    
    // Visibility (if set)
    const visibilityCard = document.getElementById('visibilityCard');
    const visibilityBadge = document.getElementById('detailVisibility');
    if (event.visibility && event.visibility !== 'team') {
        visibilityCard.style.display = 'flex';
        visibilityBadge.className = 'event-info-value visibility-badge ' + event.visibility;
        if (event.visibility === 'private') {
            visibilityBadge.innerHTML = '<i class="fas fa-lock"></i> Only Me';
        } else if (event.visibility === 'admins') {
            visibilityBadge.innerHTML = '<i class="fas fa-shield-alt"></i> Admins Only';
        }
    } else {
        visibilityCard.style.display = 'none';
    }
    
    // Recurrence info
    const repeatCard = document.getElementById('repeatCard');
    const repeatBadge = document.getElementById('detailRepeat');
    if (event.repeat && event.repeat !== 'none') {
        if (!repeatCard) {
            // Create the repeat card if it doesn't exist (for backwards compatibility)
            const infoGrid = document.querySelector('#eventDetailsModal .event-info-grid');
            if (infoGrid) {
                const newCard = document.createElement('div');
                newCard.className = 'event-info-card';
                newCard.id = 'repeatCard';
                newCard.innerHTML = `
                    <div class="event-info-icon"><i class="fas fa-redo"></i></div>
                    <div class="event-info-content">
                        <div class="event-info-label">Repeats</div>
                        <div class="event-info-value" id="detailRepeat"></div>
                    </div>
                `;
                infoGrid.appendChild(newCard);
            }
        }
        const repeatCardEl = document.getElementById('repeatCard');
        const repeatBadgeEl = document.getElementById('detailRepeat');
        if (repeatCardEl && repeatBadgeEl) {
            repeatCardEl.style.display = 'flex';
            const repeatLabels = {
                'daily': 'Every day',
                'weekly': 'Every week',
                'monthly': 'Every month',
                'yearly': 'Every year'
            };
            repeatBadgeEl.textContent = repeatLabels[event.repeat] || event.repeat;
        }
    } else if (repeatCard) {
        repeatCard.style.display = 'none';
    }
    
    // Description
    const descriptionEl = document.getElementById('detailDescription');
    const descriptionSection = document.getElementById('descriptionSection');
    if (event.description && event.description.trim()) {
        descriptionEl.textContent = event.description;
        descriptionSection.style.display = 'block';
    } else {
        descriptionEl.textContent = '';
        descriptionSection.style.display = 'none';
    }
    
    // Add editing notice for recurring events
    const editNotice = document.getElementById('repeatEditNotice');
    if (event.repeat && event.repeat !== 'none') {
        if (!editNotice) {
            const descSection = document.getElementById('descriptionSection');
            if (descSection) {
                const notice = document.createElement('div');
                notice.id = 'repeatEditNotice';
                notice.className = 'repeat-edit-notice';
                notice.innerHTML = '<i class="fas fa-info-circle"></i> Editing this event updates all repeats.';
                descSection.parentNode.insertBefore(notice, descSection);
            }
        } else {
            editNotice.style.display = 'flex';
        }
    } else if (editNotice) {
        editNotice.style.display = 'none';
    }
    
    // Hidden color field for backward compatibility
    document.getElementById('detailColor').style.backgroundColor = eventColor;
    
    // Check if user is a team member (anyone in team can edit)
    const actionsDiv = document.getElementById('eventDetailsActions');
    const editBtnHeader = document.getElementById('editEventBtnHeader');
    const deleteBtn = document.getElementById('deleteEventBtn');
    
    if (isTeamMember) {
        // All team members can edit
        editBtnHeader.style.display = 'flex';
        
        // Set up edit button in header
        editBtnHeader.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Edit button clicked, event:', event);
            closeModal('eventDetailsModal');
            setTimeout(() => {
                openEditEventModal(event);
            }, 100);
        };
        
        // Admin or owner can delete
        if (isAdmin) {
            deleteBtn.style.display = 'flex';
            deleteBtn.onclick = async () => {
                if (confirm(`Are you sure you want to delete "${event.title}"?`)) {
                    await deleteEvent(eventId);
                    closeModal('eventDetailsModal');
                }
            };
        } else {
            deleteBtn.style.display = 'none';
        }
    } else {
        editBtnHeader.style.display = 'none';
        deleteBtn.style.display = 'none';
    }
    
    console.log('📂 Opening event details modal...');
    openModal('eventDetailsModal');
    
    } catch (error) {
        console.error('❌ Error in viewEventDetails:', error);
        alert('Error loading event details: ' + error.message);
    }
}

// Delete event
async function deleteEvent(eventId) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        alert('Error: Cannot delete event');
        return;
    }
    
    // Check permissions: admin/owner can delete any event, members can only delete their own
    try {
        const { doc, getDoc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        const teamData = teamDoc.data();
        
        const userRole = getCurrentUserRole(teamData);
        const isAdminOrOwner = userRole === 'admin' || userRole === 'owner';
        
        // Get the event to check creator
        const event = appState.events.find(e => e.id === eventId);
        const isCreator = event && event.createdBy === currentAuthUser.uid;
        
        if (!isAdminOrOwner && !isCreator) {
            alert('You can only delete events you created. Admins and owners can delete any event.');
            return;
        }
        
        const eventRef = doc(db, 'teams', appState.currentTeamId, 'events', eventId);
        await deleteDoc(eventRef);
        
        debugLog('✅ Event deleted');
        
        // Add activity
        addActivity({
            type: 'calendar',
            user: currentAuthUser.displayName || currentAuthUser.email,
            description: 'deleted an event'
        });
        
    } catch (error) {
        console.error('Error deleting event:', error.code || error.message);
        debugError('Full error:', error);
        showToast('Error deleting event: ' + error.message, 'error', 5000, 'Delete Failed');
    }
}

// Make viewEventDetails globally accessible
window.viewEventDetails = viewEventDetails;

// ===================================
// TEAM MANAGEMENT
// ===================================

// Initialize or get user's team
async function initializeUserTeam() {
    if (!currentAuthUser || !db) {
        console.error('❌ Cannot initialize team: User not authenticated or DB not ready');
        return;
    }

    try {
        debugLog('🔄 Checking if user has a team...');
        
        const { collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp, onSnapshot, updateDoc, deleteField } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        const userRef = doc(db, 'users', currentAuthUser.uid);
        
        // Check if user document exists
        let userDoc = await getDoc(userRef);
        let userTeams = [];
        
        if (userDoc.exists()) {
            userTeams = userDoc.data().teams || [];
            debugLog('📋 User has teams:', userTeams);
        } else {
            // Create user document if it doesn't exist
            debugLog('📝 Creating user document...');
            try {
                await setDoc(userRef, {
                    email: currentAuthUser.email,
                    displayName: currentAuthUser.displayName || currentAuthUser.email.split('@')[0],
                    teams: [],
                    createdAt: serverTimestamp()
                });
                debugLog('✅ User document created');
            } catch (createError) {
                console.warn('Could not create user document:', createError.code || createError.message);
                // Continue anyway - user can still be in team.members
            }
        }

        // Set up real-time listener on user's document to detect team changes
        onSnapshot(userRef, async (userDocSnapshot) => {
            if (userDocSnapshot.exists()) {
                const userData = userDocSnapshot.data();
                const newTeams = userData.teams || [];
                
                // Check if team has changed
                if (newTeams.length > 0 && newTeams[0] !== appState.currentTeamId) {
                    debugLog('🔄 Team changed detected! Reloading team data...');
                    appState.currentTeamId = newTeams[0];
                    appState.userTeams = newTeams;
                    await loadTeamData();
                }
            }
        }, (error) => {
            // Handle Firestore listener errors (permission-denied, network issues, etc.)
            if (error.code === 'permission-denied') {
                debugLog('⚠️ User document listener: permission denied (normal if logged out)');
            } else if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ User document listener temporarily unavailable, will auto-retry');
            } else {
                console.error('Error in user document listener:', error.code || error.message);
            }
        });

        // CLEANUP: Verify user is actually a member of their listed team(s)
        if (userTeams.length > 0) {
            const validTeams = [];
            
            for (const teamId of userTeams) {
                try {
                    const teamRef = doc(db, 'teams', teamId);
                    const teamDoc = await getDoc(teamRef);
                    
                    if (teamDoc.exists()) {
                        const teamData = teamDoc.data();
                        const members = teamData.members || {};
                        
                        // Check if user is actually a member of this team
                        if (members[currentAuthUser.uid]) {
                            validTeams.push(teamId);
                            debugLog(`✅ Verified membership in team: ${teamId}`);
                        } else {
                            console.warn(`⚠️ User listed in team ${teamId} but not a member! Removing...`);
                        }
                    } else {
                        console.warn(`⚠️ Team ${teamId} doesn't exist! Removing...`);
                    }
                } catch (error) {
                    console.warn('Error checking team:', error);
                }
            }
            
            // Update user's teams to only valid teams
            if (validTeams.length !== userTeams.length) {
                await updateDoc(userRef, {
                    teams: validTeams
                });
                userTeams = validTeams;
                console.log('✅ Updated user teams to valid teams only:', validTeams);
            }
        }

        // CLEANUP: If user has multiple teams, keep the most active one (most members) and remove from others
        if (userTeams.length > 1) {
            console.warn('⚠️ User is in multiple teams! Selecting primary team...');
            
            // Find the team with the most members (likely the real/active team)
            let primaryTeam = userTeams[0];
            let maxMembers = 0;
            
            for (const teamId of userTeams) {
                try {
                    const teamRef = doc(db, 'teams', teamId);
                    const teamDoc = await getDoc(teamRef);
                    if (teamDoc.exists()) {
                        const teamData = teamDoc.data();
                        const memberCount = Object.keys(teamData.members || {}).length;
                        debugLog(`  Team ${teamId}: ${memberCount} members`);
                        
                        if (memberCount > maxMembers) {
                            maxMembers = memberCount;
                            primaryTeam = teamId;
                        }
                    }
                } catch (error) {
                    console.warn('Error checking team size:', error);
                }
            }
            
            debugLog(`✅ Selected primary team: ${primaryTeam} (${maxMembers} members)`);
            
            // Just use the primary team, don't automatically remove from others
            // User should explicitly leave teams or join new ones
            appState.currentTeamId = primaryTeam;
            appState.userTeams = userTeams;
            await loadTeamData();
            return;
        }

        // If user has teams, load the first one
        if (userTeams.length > 0) {
            appState.currentTeamId = userTeams[0];
            appState.userTeams = userTeams;
            debugLog('✅ Loaded existing team:', appState.currentTeamId);
            
            // Load team data
            await loadTeamData();
            return;
        }

        // No teams in user document - but check if user is a member of any team
        // This handles the case where user was approved but their teams array wasn't updated
        debugLog('🔍 No teams in user doc - scanning for team membership...');
        
        const teamsRef = collection(db, 'teams');
        const teamsSnapshot = await getDocs(teamsRef);
        
        for (const teamDoc of teamsSnapshot.docs) {
            const teamData = teamDoc.data();
            const members = teamData.members || {};
            
            if (members[currentAuthUser.uid]) {
                debugLog(`✅ Found team membership: ${teamDoc.id}`);
                
                // Update user's teams array
                await setDoc(userRef, {
                    teams: [teamDoc.id]
                }, { merge: true });
                
                appState.currentTeamId = teamDoc.id;
                appState.userTeams = [teamDoc.id];
                
                // Load team data
                await loadTeamData();
                return;
            }
        }

        // No teams found - don't auto-create, just log and return
        debugLog('ℹ️ User has no teams. Waiting for user to create or join a team...');
        appState.currentTeamId = null;
        appState.userTeams = [];
        
        // Show the "no team" modal or UI
        const createBtn = document.getElementById('createTeamBtn');
        if (createBtn) {
            createBtn.style.display = 'block';
        }

    } catch (error) {
        console.error('❌ Error initializing team:', error.code || error.message);
        
        // Show user-friendly error with retry option
        showTeamCreationError();
    }
}

// NEW: Separate function to actually CREATE a team (only called when user clicks Create Team button)
async function createTeamNow() {
    if (!currentAuthUser || !db) {
        console.error('❌ Cannot create team: User not authenticated or DB not ready');
        alert('Please sign in and try again.');
        return;
    }

    try {
        debugLog('🆕 Creating new team...');
        
        const { collection, doc, addDoc, setDoc, serverTimestamp, getDoc, updateDoc, deleteField } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        const teamCode = generateTeamCode();
        const teamName = `${currentAuthUser.displayName || currentAuthUser.email.split('@')[0]}'s Team`;
        
        const teamData = {
            name: teamName,
            teamCode: teamCode,
            createdBy: currentAuthUser.uid,
            createdAt: serverTimestamp(),
            members: {
                [currentAuthUser.uid]: {
                    role: 'owner',
                    name: currentAuthUser.displayName || currentAuthUser.email,
                    email: currentAuthUser.email,
                    joinedAt: serverTimestamp()
                }
            },
            pendingRequests: {}
        };

        // Create team document
        const teamRef = await addDoc(collection(db, 'teams'), teamData);
        appState.currentTeamId = teamRef.id;
        appState.userTeams = [teamRef.id];

        debugLog('✅ Created new team:', teamRef.id);
        
        // Create public teamJoinInfo document for join-by-code flow
        // This allows non-members to look up team by code without exposing full team data
        await setDoc(doc(db, 'teamJoinInfo', teamCode), {
            teamId: teamRef.id,
            teamName: teamName,
            memberCount: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        debugLog('✅ Created teamJoinInfo for code:', teamCode);

        // Check if user has old teams and remove them (single team policy)
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const oldTeams = userData.teams || [];
            
            // Remove user from old teams first
            for (const oldTeamId of oldTeams) {
                try {
                    const oldTeamRef = doc(db, 'teams', oldTeamId);
                    await updateDoc(oldTeamRef, {
                        [`members.${currentAuthUser.uid}`]: deleteField()
                    });
                    debugLog(`✅ Left old team: ${oldTeamId}`);
                } catch (error) {
                    console.warn('Could not leave old team:', error);
                }
            }
        }
        
        // Update user document with new team reference
        await setDoc(userRef, {
            email: currentAuthUser.email,
            displayName: currentAuthUser.displayName || currentAuthUser.email,
            teams: [teamRef.id],
            createdAt: serverTimestamp()
        }, { merge: true });

        debugLog('✅ Team created successfully!');
        
        // Hide create team button since team now exists
        const createBtn = document.getElementById('createTeamBtn');
        if (createBtn) {
            createBtn.style.display = 'none';
        }
        
        // Show success message to user
        showTeamCreatedMessage(teamCode);
        
        // Load team data
        await loadTeamData();
        
        return teamRef.id;
        
    } catch (error) {
        console.error('❌ Error creating team:', error);
        showToast('Failed to create team. Please try again.', 'error', 5000, 'Team Creation Failed');
        throw error;
    }
}

// Show success message with team code
function showTeamCreatedMessage(teamCode) {
    // Bug fix 4: Prevent duplicate modals
    const existingModal = document.getElementById('teamCreatedModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modalHtml = `
        <div class="modal-overlay" id="teamCreatedModal">
            <div class="modal-content" style="max-width: 500px;">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>
                    <h2 style="color: #0078D4; margin-bottom: 10px;">Team Created Successfully!</h2>
                    <p style="color: #666; margin-bottom: 20px;">Your team has been set up and is ready to use.</p>
                    
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin-bottom: 10px; color: #333; font-weight: 600;">Your Team Code:</p>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                            <code style="font-size: 24px; font-weight: bold; color: #0078D4; letter-spacing: 2px;">${escapeHtml(teamCode)}</code>
                            <button onclick="copyTeamCodeToClipboard('${escapeHtml(teamCode)}')" style="padding: 8px 15px; background-color: #0078D4; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                📋 Copy
                            </button>
                        </div>
                        <p style="margin-top: 10px; font-size: 12px; color: #666;">Share this code with others to invite them to your team</p>
                    </div>
                    
                    <button onclick="closeTeamCreatedModal()" style="padding: 12px 30px; background-color: #0078D4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                        Got it!
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Also show a toast notification
    showToast('Your team has been created successfully!', 'success', 5000, 'Team Created 🎉');
}

// Close team created modal
function closeTeamCreatedModal() {
    const modal = document.getElementById('teamCreatedModal');
    if (modal) {
        modal.remove();
    }
}

// Copy team code to clipboard
function copyTeamCodeToClipboard(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast('Team code copied to clipboard!', 'success', 3000, 'Copied');
    }).catch(error => {
        console.error('Failed to copy code:', error);
        showToast('Failed to copy code', 'error', 3000, 'Copy Failed');
    });
}

// Show team creation error with retry option
function showTeamCreationError() {
    const modalHtml = `
        <div class="modal-overlay" id="teamErrorModal">
            <div class="modal-content" style="max-width: 500px;">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                    <h2 style="color: #d13438; margin-bottom: 10px;">Team Creation Failed</h2>
                    <p style="color: #666; margin-bottom: 20px;">We couldn't create your team automatically. This might be due to a connection issue or database permissions.</p>
                    
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button onclick="retryTeamCreation()" style="padding: 12px 24px; background-color: #0078D4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                            🔄 Retry
                        </button>
                        <button onclick="closeTeamErrorModal()" style="padding: 12px 24px; background-color: #f5f5f5; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                            Close
                        </button>
                    </div>
                    
                    <p style="margin-top: 20px; font-size: 12px; color: #999;">If the problem persists, try refreshing the page or contact support.</p>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Close team error modal
function closeTeamErrorModal() {
    const modal = document.getElementById('teamErrorModal');
    if (modal) {
        modal.remove();
    }
}

// Retry team creation
async function retryTeamCreation() {
    closeTeamErrorModal();
    await initializeUserTeam();
}

// Manual team creation (can be triggered from button)
async function createNewTeamNow() {
    if (!currentAuthUser) {
        alert('Please sign in first');
        return;
    }
    
    if (!db) {
        alert('Database not initialized. Please refresh the page.');
        return;
    }
    
    // Show loading state on button
    const createBtn = document.getElementById('createTeamBtn');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Creating Team...</span>';
    }
    
    debugLog('🚀 Manual team creation triggered');
    
    try {
        await createTeamNow(); // Call the new dedicated function
    } catch (error) {
        console.error('Failed to create team:', error.code || error.message);
        debugError('Full error:', error);
    } finally {
        // Restore button state
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = '<i class="fas fa-plus-circle"></i> <span>Create New Team</span>';
        }
    }
}

// Load all team data (tasks, messages, events, members)
async function loadTeamData() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;

    // Reset reply state when loading new team data
    if (typeof resetReplyState === 'function') {
        resetReplyState();
    }

    try {
        // Verify membership server-side - prevents manually switching currentTeamId via DevTools
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const teamRef = doc(db, "teams", appState.currentTeamId);
        const teamSnap = await getDoc(teamRef);
        
        if (!teamSnap.exists()) {
            showToast("Team does not exist or you do not have permission.", 'error', 5000, 'Access Denied');
            console.error('Team does not exist');
            debugError('Team ID:', appState.currentTeamId);
            return;
        }
        
        const teamData = teamSnap.data();
        if (!teamData.members || !teamData.members[currentAuthUser.uid]) {
            showToast("You are not a member of this team.", 'error', 5000, 'Access Denied');
            console.error('User is not a member of team');
            debugError('Team ID:', appState.currentTeamId);
            return;
        }
        
        // Store team data for later use and compute metrics access
        appState.currentTeamData = teamData;
        appState.metricsVisibility = getMetricsVisibilitySetting(teamData);
        appState.metricsAccess = userCanViewMetrics(teamData, currentAuthUser.uid);
        debugLog('📊 Metrics visibility:', appState.metricsVisibility);
        debugLog('📊 Metrics access:', appState.metricsAccess);
        
        // Compute finances access
        appState.financesEnabled = getFinancesEnabledSetting(teamData);
        appState.financesVisibility = getFinancesVisibilitySetting(teamData);
        appState.financesAccess = userCanViewFinances(teamData, currentAuthUser.uid);
        debugLog('💰 Finances enabled:', appState.financesEnabled);
        debugLog('💰 Finances visibility:', appState.financesVisibility);
        debugLog('💰 Finances access:', appState.financesAccess);
        
        // Load metrics chart configuration from team settings
        loadMetricsChartConfig(appState.currentTeamId);
        
        // Update nav visibility for metrics
        updateNavVisibilityForMetrics();
        
        // Update nav visibility for finances
        updateNavVisibilityForFinances();
        
        debugLog('✅ Membership verified for team:', appState.currentTeamId);
    } catch (error) {
        console.error('Error verifying team membership:', error.code || error.message);
        debugError('Full error:', error);
        showToast("Failed to verify team access.", 'error', 5000, 'Verification Failed');
        return;
    }

    // Clear previous team's data to prevent cross-contamination between users/teams
    appState.messages = [];
    appState.tasks = [];
    appState.events = [];
    appState.activities = [];
    appState.teammates = [];
    appState.spreadsheets = [];
    
    // Stop previous team's listeners
    stopTeamMembersListener();
    
    // Clear chat display immediately
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.innerHTML = '';

    try {
        // Load teammates
        await loadTeammatesFromFirestore();
        
        // Start real-time listener for team member updates
        await startTeamMembersListener();
        
        // Populate task assignee dropdown with team members
        populateTaskAssigneeDropdown();
        
        // Clean up old tasks from localStorage
        await cleanupOldTasks();
        
        // Load tasks
        await loadTasksFromFirestore();
        
        // Load spreadsheets
        if (window.loadSpreadsheetsFromFirestore) {
            await window.loadSpreadsheetsFromFirestore();
        }
        
        // Load messages
        await loadMessagesFromFirestore();
        
        // Load events
        await loadEventsFromFirestore();
        
        // Load activities
        await loadActivities();
        
        // Subscribe to Link Lobby groups
        await subscribeLinkLobbyGroups();
        
        // Ensure teamJoinInfo exists for join-by-code (for admins/owners)
        await ensureTeamJoinInfoExists();
        
        // Initialize team section display
        await initTeamSection();

        debugLog('Team data loaded successfully');
    } catch (error) {
        console.error('Error loading team data:', error.code || error.message);
        debugError('Full error:', error);
    }
}

/**
 * Ensure teamJoinInfo document exists for the current team
 * This is needed for the join-by-code flow to work with the new security model
 * Only admins/owners can create/update this document
 */
async function ensureTeamJoinInfoExists() {
    if (!db || !currentAuthUser || !appState.currentTeamId || !appState.currentTeamData) return;
    
    // Only admins/owners should ensure this exists
    const teamData = appState.currentTeamData;
    const userRole = teamData.members?.[currentAuthUser.uid]?.role;
    if (!userRole || !['owner', 'admin'].includes(userRole)) return;
    
    const teamCode = teamData.teamCode;
    if (!teamCode) return;
    
    try {
        const { doc, getDoc, setDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const joinInfoRef = doc(db, 'teamJoinInfo', teamCode);
        const joinInfoDoc = await getDoc(joinInfoRef);
        
        if (!joinInfoDoc.exists()) {
            // Create the teamJoinInfo document
            const memberCount = Object.keys(teamData.members || {}).length;
            await setDoc(joinInfoRef, {
                teamId: appState.currentTeamId,
                teamName: teamData.name || 'Team',
                memberCount: memberCount,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            debugLog('✅ Created teamJoinInfo for code:', teamCode);
        } else {
            // Update member count if needed
            const joinInfo = joinInfoDoc.data();
            const currentMemberCount = Object.keys(teamData.members || {}).length;
            if (joinInfo.memberCount !== currentMemberCount || joinInfo.teamName !== teamData.name) {
                await setDoc(joinInfoRef, {
                    teamId: appState.currentTeamId,
                    teamName: teamData.name || 'Team',
                    memberCount: currentMemberCount,
                    updatedAt: serverTimestamp()
                }, { merge: true });
                debugLog('✅ Updated teamJoinInfo for code:', teamCode);
            }
        }
    } catch (error) {
        // Non-critical - just log
        debugLog('Could not sync teamJoinInfo:', error.message);
    }
}

function initTeam() {
    // Load teammates from storage
    loadTeammates();
    
    // Update pending requests badge periodically
    updatePendingRequestsBadge();
    setInterval(updatePendingRequestsBadge, 30000); // Update every 30 seconds
}

// Update pending requests badge
async function updatePendingRequestsBadge() {
    const count = await getPendingRequestsCount();
    const badge = document.getElementById('pendingRequestsBadge');
    
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

async function loadTeammates() {
    // Clear any old placeholder data
    localStorage.removeItem('teammates');
    
    // Only load real teammates from Firestore
    if (db && currentAuthUser && appState.currentTeamId) {
        await loadTeammatesFromFirestore();
    } else {
        // No team or not authenticated - show empty state
        appState.teammates = [];
        displayTeammates();
    }
}

function displayTeammates() {
    const teamList = document.getElementById('teamList');
    if (!teamList) return;
    
    teamList.innerHTML = '';
    
    if (!appState.teammates || appState.teammates.length === 0) {
        teamList.innerHTML = '<p style="text-align: center; color: var(--gray); font-size: 0.85rem; padding: var(--spacing-md);">No team members yet. Add your first teammate!</p>';
        return;
    }
    
    appState.teammates.forEach(teammate => {
        const teammateCard = createTeammateCard(teammate);
        teamList.appendChild(teammateCard);
    });
}

function createTeammateCard(teammate) {
    const card = document.createElement('div');
    card.className = 'teammate-card';
    card.title = `${teammate.name} - ${teammate.email}`;
    
    // Create avatar element
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'teammate-avatar';
    avatarDiv.textContent = teammate.avatar; // Use textContent for avatar initials
    
    // Create info container
    const infoDiv = document.createElement('div');
    infoDiv.className = 'teammate-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'teammate-name';
    nameDiv.textContent = teammate.name; // Use textContent for name
    
    // Create occupation and role container
    const occupationDiv = document.createElement('div');
    occupationDiv.className = 'teammate-occupation';
    
    // Add occupation text if available, otherwise just show role
    if (teammate.occupation && teammate.occupation !== 'member' && teammate.occupation !== 'admin' && teammate.occupation !== 'owner') {
        const occupationText = document.createTextNode(teammate.occupation);
        occupationDiv.appendChild(occupationText);
        occupationDiv.appendChild(document.createTextNode(' • '));
    }
    
    // Add role badge
    const role = teammate.role || 'member';
    const roleBadge = document.createElement('span');
    roleBadge.className = `role-badge ${role}`;
    roleBadge.textContent = role.toUpperCase(); // Use textContent for role
    occupationDiv.appendChild(roleBadge);
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(occupationDiv);
    
    card.appendChild(avatarDiv);
    card.appendChild(infoDiv);
    
    // Optional: Add click event to show teammate details
    card.addEventListener('click', () => {
        if (DEBUG) console.log('Teammate details logged');
        // Could open a modal with full teammate info
    });
    
    return card;
}

function generateAvatar(name) {
    if (!name) return '??';
    
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else {
        return name.substring(0, 2).toUpperCase();
    }
}

/**
 * Generate unique team code with high entropy
 * 
 * SECURITY: Team codes are used for the join flow and should be hard to guess.
 * We use 12 characters from a 54-character alphabet (mixed case + digits, minus confusing chars)
 * This provides approximately 70 bits of entropy (54^12 ≈ 2^70)
 * 
 * NOTE: Rate limiting for brute-force protection requires Cloud Functions or App Check.
 * Firestore rules cannot enforce rate limits on teamJoinInfo reads.
 * 
 * @returns {string} Team code in format "TM-XXXXXXXXXXXX" (12 random chars)
 */
function generateTeamCode() {
    // Mixed case alphanumeric, removed confusing chars: 0, O, o, I, l, 1
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = 'TM-';
    
    // Use crypto.getRandomValues for better randomness
    const randomValues = new Uint8Array(12);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < 12; i++) {
        code += chars.charAt(randomValues[i] % chars.length);
    }
    return code;
}

// Show team code to owner
async function showTeamCode() {
    if (!currentAuthUser) {
        alert('Please sign in first.');
        return;
    }

    if (!db || !appState.currentTeamId) {
        // Team not initialized, show options
        showNoTeamModal();
        return;
    }

    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (!teamDoc.exists()) {
            console.error('Team document not found');
            debugError('Team ID:', appState.currentTeamId);
            showNoTeamModal();
            return;
        }
        
        const teamData = teamDoc.data();
        const teamCode = teamData.teamCode;
        
        // Create modal
        const existingModal = document.getElementById('teamCodeModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = 'teamCodeModal';
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2><i class="fas fa-key"></i> Your Team Code</h2>
                    <span class="modal-close" onclick="closeTeamCodeModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 15px; color: #495057;">Share this code with people you want to join your team:</p>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
                        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0078D4; font-family: monospace;">
                            ${escapeHtml(teamCode)}
                        </div>
                        <button onclick="copyTeamCode('${escapeHtml(teamCode)}')" class="btn btn-primary" style="margin-top: 15px;">
                            <i class="fas fa-copy"></i> Copy Code
                        </button>
                    </div>
                    <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; border-left: 4px solid #0078D4;">
                        <p style="margin: 0; color: #004085; font-size: 0.9rem;">
                            <strong>💡 How it works:</strong><br>
                            1. Share this code with someone<br>
                            2. They click "Join Team" and enter the code<br>
                            3. You approve their request<br>
                            4. They join your team!
                        </p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeTeamCodeModal()">Done</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Error showing team code:', error.code || error.message);
        debugError('Full error:', error);
        alert('Failed to load team code.');
    }
}

// Show modal when no team exists
function showNoTeamModal() {
    const modalHtml = `
        <div class="modal-overlay" id="noTeamModal">
            <div class="modal-content" style="max-width: 500px;">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🚀</div>
                    <h2 style="color: #0078D4; margin-bottom: 10px;">No Team Found</h2>
                    <p style="color: #666; margin-bottom: 30px;">You don't have a team yet. Would you like to create one or join an existing team?</p>
                    
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button onclick="createNewTeamFromModal()" style="padding: 15px 30px; background-color: #0078D4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 600;">
                            ✨ Create a New Team
                        </button>
                        <button onclick="joinTeamFromModal()" style="padding: 15px 30px; background-color: #f5f5f5; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 600;">
                            ➡️ Join an Existing Team
                        </button>
                        <button onclick="closeNoTeamModal()" style="padding: 10px 20px; background-color: transparent; color: #666; border: none; cursor: pointer; font-size: 14px;">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Close no team modal
function closeNoTeamModal() {
    const modal = document.getElementById('noTeamModal');
    if (modal) {
        modal.remove();
    }
}

// Create team from modal
async function createNewTeamFromModal() {
    closeNoTeamModal();
    await createNewTeamNow();
}

// Join team from modal
function joinTeamFromModal() {
    closeNoTeamModal();
    joinTeamWithCode();
}

// Copy team code
window.copyTeamCode = function(code) {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        const btn = event.target.closest('button');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.background = '#28a745';
        
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
        }, 2000);
    } catch (err) {
        alert('Code: ' + code);
    }
    
    document.body.removeChild(textarea);
}

// Close team code modal
window.closeTeamCodeModal = function() {
    const modal = document.getElementById('teamCodeModal');
    if (modal) {
        modal.remove();
    }
}

// Join team with code
async function joinTeamWithCode() {
    // Create modal
    const existingModal = document.getElementById('joinTeamModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'joinTeamModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h2><i class="fas fa-sign-in-alt"></i> Join a Team</h2>
                <span class="modal-close" onclick="closeJoinTeamModal()">&times;</span>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 15px; color: #495057;">Enter the team code you received:</p>
                <form id="joinTeamForm">
                    <div class="form-group">
                        <label for="teamCodeInput">Team Code</label>
                        <input 
                            type="text" 
                            id="teamCodeInput" 
                            placeholder="TEAM-XXXXXX"
                            style="text-transform: uppercase; letter-spacing: 2px; font-family: monospace; font-size: 18px;"
                            required
                        >
                    </div>
                    <div style="background: #fff3cd; padding: 12px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #ffc107;">
                        <p style="margin: 0; color: #856404; font-size: 0.85rem;">
                            <i class="fas fa-info-circle"></i> The team owner will need to approve your request before you can join.
                        </p>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeJoinTeamModal()">Cancel</button>
                <button class="btn btn-primary" onclick="submitJoinRequest()">
                    <i class="fas fa-paper-plane"></i> Send Join Request
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus input
    setTimeout(() => {
        document.getElementById('teamCodeInput').focus();
    }, 100);
}

// Close join team modal
window.closeJoinTeamModal = function() {
    const modal = document.getElementById('joinTeamModal');
    if (modal) {
        modal.remove();
    }
}

// Generate shareable join link
window.generateJoinLink = function() {
    if (!appState.currentTeamData?.teamCode) {
        showToast('No team code available', 'error');
        return;
    }
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const joinUrl = `${baseUrl}/index.html?join=${appState.currentTeamData.teamCode}`;
    
    navigator.clipboard.writeText(joinUrl).then(() => {
        showToast('Join link copied to clipboard!', 'success');
    }).catch(() => {
        // Fallback - show the link
        prompt('Copy this join link:', joinUrl);
    });
}

// Process join code from URL
async function processJoinCode(teamCode) {
    if (!currentAuthUser) {
        showToast('Please sign in first', 'error');
        return;
    }
    
    showToast('Processing join request...', 'info');
    
    try {
        const { doc, getDoc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Look up team by code via teamJoinInfo (public collection)
        const normalizedCode = teamCode.toUpperCase().trim();
        const joinInfoRef = doc(db, 'teamJoinInfo', normalizedCode);
        const joinInfoDoc = await getDoc(joinInfoRef);

        if (!joinInfoDoc.exists()) {
            showToast('Invalid join link. Team not found.', 'error');
            return;
        }

        const joinInfo = joinInfoDoc.data();
        const teamId = joinInfo.teamId;
        const teamName = joinInfo.teamName;

        // Show confirmation dialog (we don't read team doc - use joinInfo instead)
        const confirmJoin = confirm(
            `You've been invited to join "${teamName}"!\n\n` +
            `Click OK to send a join request to the team owner.`
        );
        
        if (!confirmJoin) return;

        // Add join request to subcollection (prevents DoS via map growth)
        // Uses /teams/{teamId}/joinRequests/{userId} instead of deprecated pendingRequests map
        const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const joinRequestRef = doc(db, 'teams', teamId, 'joinRequests', currentAuthUser.uid);
        await setDoc(joinRequestRef, {
            userId: currentAuthUser.uid,
            name: currentAuthUser.displayName || currentAuthUser.email.split('@')[0],
            email: currentAuthUser.email,
            photoURL: currentAuthUser.photoURL || null,
            requestedAt: serverTimestamp(),
            status: 'pending'
        });
        
        showToast(`Join request sent to "${teamName}"! The owner will review it.`, 'success');

    } catch (error) {
        console.error('Error processing join code:', error);
        if (error.code === 'permission-denied') {
            showToast('Unable to send join request. You may already be a member or have a pending request.', 'error');
        } else {
            showToast('Failed to process join link. Please try again.', 'error');
        }
    }
}

// Submit join request
window.submitJoinRequest = async function() {
    if (!currentAuthUser) {
        alert('Please sign in first.');
        return;
    }

    // Check if user is already in a team
    if (appState.currentTeamId && appState.userTeams && appState.userTeams.length > 0) {
        const confirmLeave = confirm(
            'You are already in a team. Joining a new team will remove you from your current team.\n\n' +
            'Do you want to continue?'
        );
        if (!confirmLeave) {
            closeJoinTeamModal();
            return;
        }
    }

    const teamCodeInput = document.getElementById('teamCodeInput');
    const teamCode = teamCodeInput.value.trim().toUpperCase();
    
    if (!teamCode) {
        alert('Please enter a team code.');
        return;
    }

    const submitBtn = event.target.closest('button');
    const originalHTML = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
        const { doc, getDoc, setDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Look up team by code via teamJoinInfo (public collection)
        const joinInfoRef = doc(db, 'teamJoinInfo', teamCode);
        const joinInfoDoc = await getDoc(joinInfoRef);

        if (!joinInfoDoc.exists()) {
            showToast('Team code not found. Please check and try again.', 'error', 5000, 'Invalid Code');
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
            return;
        }

        const joinInfo = joinInfoDoc.data();
        const teamId = joinInfo.teamId;
        const teamName = joinInfo.teamName;

        // Add join request to subcollection (prevents DoS via map growth)
        // Uses /teams/{teamId}/joinRequests/{userId} instead of deprecated pendingRequests map
        const joinRequestRef = doc(db, 'teams', teamId, 'joinRequests', currentAuthUser.uid);
        await setDoc(joinRequestRef, {
            userId: currentAuthUser.uid,
            name: currentAuthUser.displayName || currentAuthUser.email.split('@')[0],
            email: currentAuthUser.email,
            photoURL: currentAuthUser.photoURL || null,
            requestedAt: serverTimestamp(),
            status: 'pending'
        });

        debugLog('✅ Join request sent');
        
        closeJoinTeamModal();
        
        // Show success message
        showToast(`Join request sent to "${teamName}". The team owner will review your request.`, 'success', 5000, 'Request Sent');

    } catch (error) {
        console.error('Error sending join request:', error.code || error.message);
        debugError('Full error:', error);
        
        if (error.code === 'permission-denied') {
            // This might happen if they're already a member or have a pending request
            showToast('Unable to send request. You may already be a member or have a pending request.', 'error', 5000, 'Request Failed');
        } else {
            showToast('Failed to send join request. Please try again.', 'error', 5000, 'Request Failed');
        }
        
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHTML;
    }
}

// Show pending join requests (for team owner)
async function showPendingRequests() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        alert('Team not initialized.');
        return;
    }

    try {
        const { collection, getDocs, query, where } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Read from joinRequests subcollection instead of deprecated pendingRequests map
        const joinRequestsRef = collection(db, 'teams', appState.currentTeamId, 'joinRequests');
        const pendingQuery = query(joinRequestsRef, where('status', '==', 'pending'));
        const snapshot = await getDocs(pendingQuery);
        
        const requestsList = [];
        snapshot.forEach(doc => {
            requestsList.push({ id: doc.id, ...doc.data() });
        });

        if (requestsList.length === 0) {
            alert('No pending join requests.');
            return;
        }

        // Create modal
        const existingModal = document.getElementById('pendingRequestsModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = 'pendingRequestsModal';
        modal.className = 'modal active';
        
        let requestsHTML = '';
        requestsList.forEach((request) => {
            const userId = request.id;
            requestsHTML += `
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
                            <i class="fas fa-user"></i> ${escapeHtml(request.name)}
                        </div>
                        <div style="font-size: 0.85rem; color: #666;">
                            <i class="fas fa-envelope"></i> ${escapeHtml(request.email)}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="approveJoinRequest('${escapeHtml(userId)}')" class="btn btn-primary" style="padding: 8px 16px;">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button onclick="rejectJoinRequest('${escapeHtml(userId)}')" class="btn btn-secondary" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                </div>
            `;
        });
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h2><i class="fas fa-user-clock"></i> Pending Join Requests</h2>
                    <span class="modal-close" onclick="closePendingRequestsModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 15px; color: #495057;">
                        ${requestsList.length} ${requestsList.length === 1 ? 'person wants' : 'people want'} to join your team:
                    </p>
                    ${requestsHTML}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closePendingRequestsModal()">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Error loading pending requests:', error.code || error.message);
        debugError('Full error:', error);
        alert('Failed to load pending requests.');
    }
}

// Close pending requests modal
window.closePendingRequestsModal = function() {
    const modal = document.getElementById('pendingRequestsModal');
    if (modal) {
        modal.remove();
    }
}

// Show approve join modal
window.showApproveJoinModal = function(userId, userName, userEmail) {
    const nameEl = document.getElementById('approveJoinName');
    const emailEl = document.getElementById('approveJoinEmail');
    const confirmBtn = document.getElementById('confirmApproveJoin');
    
    if (nameEl) nameEl.textContent = userName || 'this user';
    if (emailEl) emailEl.textContent = userEmail || '';
    
    // Store the userId for the confirm action
    if (confirmBtn) {
        confirmBtn.onclick = () => executeApproveJoinRequest(userId);
    }
    
    document.getElementById('approveJoinModal')?.classList.add('active');
};

window.closeApproveJoinModal = function() {
    document.getElementById('approveJoinModal')?.classList.remove('active');
};

// Approve join request (admin/owner only) - shows modal
window.approveJoinRequest = async function(userId) {
    try {
        const { doc, getDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Check if user has admin permissions
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        const teamData = teamDoc.data();
        
        if (!isAdmin(teamData)) {
            showToast('Only admins and owners can approve join requests.', 'error');
            return;
        }
        
        // Read from joinRequests subcollection
        const joinRequestRef = doc(db, 'teams', appState.currentTeamId, 'joinRequests', userId);
        const requestDoc = await getDoc(joinRequestRef);
        
        if (!requestDoc.exists()) {
            showToast('Join request not found.', 'error');
            return;
        }
        
        const request = requestDoc.data();
        
        // Show the approval modal
        showApproveJoinModal(userId, request.name, request.email);
        
    } catch (error) {
        console.error('Error checking join request:', error);
        showToast('Failed to load request details.', 'error');
    }
};

// Execute the actual approval after modal confirmation
async function executeApproveJoinRequest(userId) {
    try {
        const { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        const teamData = teamDoc.data();

        // Read from joinRequests subcollection
        const joinRequestRef = doc(db, 'teams', appState.currentTeamId, 'joinRequests', userId);
        const requestDoc = await getDoc(joinRequestRef);
        
        if (!requestDoc.exists()) {
            showToast('Join request not found.', 'error');
            closeApproveJoinModal();
            return;
        }
        
        const request = requestDoc.data();

        // Check for duplicate usernames and generate unique name if needed
        let finalName = request.name;
        const existingMembers = teamData.members || {};
        const existingNames = Object.values(existingMembers).map(m => (m.name || '').trim().toLowerCase());
        
        // If name already exists, append (1), (2), etc.
        if (existingNames.includes(finalName.trim().toLowerCase())) {
            let counter = 1;
            let newName = `${request.name} (${counter})`;
            while (existingNames.includes(newName.trim().toLowerCase())) {
                counter++;
                newName = `${request.name} (${counter})`;
            }
            finalName = newName;
            debugLog(`📝 Duplicate name detected - renamed "${request.name}" to "${finalName}"`);
        }

        // Add user to members
        await updateDoc(teamRef, {
            [`members.${userId}`]: {
                role: 'member',
                name: finalName,
                email: request.email,
                photoURL: request.photoURL || null,
                occupation: 'Team Member',
                joinedAt: serverTimestamp()
            }
        });
        
        // Delete the join request from subcollection
        await deleteDoc(joinRequestRef);

        // NOTE: User's teams array will be updated automatically when they log in
        // via the team membership scan in initializeUserTeam()
        // We can't update their user document from here due to security rules

        debugLog('✅ Approved join request - user added to team members');
        
        // Add activity log for approval
        await addActivity({
            type: 'team',
            description: `approved ${finalName} to join the team`
        });
        
        // Reload team data
        await loadTeammatesFromFirestore();
        await initTeamSection();
        
        // Close modals
        closeApproveJoinModal();
        closePendingRequestsModal();
        
        // Show success message - mention if name was changed
        if (finalName !== request.name) {
            showToast(`${finalName} has been added to your team! (Name adjusted to avoid duplicate)`, 'success', 5000, 'Member Added');
        } else {
            showToast(`${finalName} has been added to your team!`, 'success', 4000, 'Member Added');
        }

    } catch (error) {
        console.error('Error approving request:', error.code || error.message);
        debugError('Full error:', error);
        closeApproveJoinModal();
        showToast('Failed to approve request. Please try again.', 'error', 5000, 'Approval Failed');
    }
}

// Show reject join modal
window.showRejectJoinModal = function(userId, userName, userEmail) {
    const nameEl = document.getElementById('rejectJoinName');
    const emailEl = document.getElementById('rejectJoinEmail');
    const confirmBtn = document.getElementById('confirmRejectJoin');
    
    if (nameEl) nameEl.textContent = userName || 'this user';
    if (emailEl) emailEl.textContent = userEmail || '';
    
    // Store the userId for the confirm action
    if (confirmBtn) {
        confirmBtn.onclick = () => executeRejectJoinRequest(userId);
    }
    
    document.getElementById('rejectJoinModal')?.classList.add('active');
};

window.closeRejectJoinModal = function() {
    document.getElementById('rejectJoinModal')?.classList.remove('active');
};

// Reject join request (shows modal)
window.rejectJoinRequest = async function(userId) {
    try {
        const { doc, getDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Read from joinRequests subcollection
        const joinRequestRef = doc(db, 'teams', appState.currentTeamId, 'joinRequests', userId);
        const requestDoc = await getDoc(joinRequestRef);
        
        if (!requestDoc.exists()) {
            showToast('Join request not found.', 'error');
            return;
        }
        
        const request = requestDoc.data();
        
        // Show the reject modal
        showRejectJoinModal(userId, request.name, request.email);
        
    } catch (error) {
        console.error('Error checking join request:', error);
        showToast('Failed to load request details.', 'error');
    }
};

// Execute the actual rejection after modal confirmation
async function executeRejectJoinRequest(userId) {
    try {
        const { doc, getDoc, deleteDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Read and delete from joinRequests subcollection
        const joinRequestRef = doc(db, 'teams', appState.currentTeamId, 'joinRequests', userId);
        const requestDoc = await getDoc(joinRequestRef);
        const request = requestDoc.exists() ? requestDoc.data() : null;
        
        await deleteDoc(joinRequestRef);

        debugLog('❌ Rejected join request');
        
        // Add activity log for rejection
        await addActivity({
            type: 'team',
            description: `rejected join request from ${request?.name || 'a user'}`
        });
        
        // Close modals
        closeRejectJoinModal();
        closePendingRequestsModal();
        showToast('Join request rejected.', 'info');

    } catch (error) {
        console.error('Error rejecting request:', error.code || error.message);
        debugError('Full error:', error);
        closeRejectJoinModal();
        showToast('Failed to reject request. Please try again.', 'error');
    }
}

// Check for pending requests count
async function getPendingRequestsCount() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return 0;

    try {
        const { collection, getDocs, query, where } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Read from joinRequests subcollection
        const joinRequestsRef = collection(db, 'teams', appState.currentTeamId, 'joinRequests');
        const pendingQuery = query(joinRequestsRef, where('status', '==', 'pending'));
        const snapshot = await getDocs(pendingQuery);
        
        return snapshot.size;
    } catch (error) {
        console.error('Error getting pending requests count:', error.code || error.message);
        debugError('Full error:', error);
        return 0;
    }
}

// Firestore integration for teammates
async function sendTeamInvitation(invitedEmail, invitedName, occupation) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        throw new Error('Please sign in to invite team members');
    }

    try {
        const { collection, addDoc, doc, getDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        // Get team info to check permissions
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (!teamDoc.exists()) {
            throw new Error('Team not found');
        }
        
        const teamData = teamDoc.data();
        
        // Check if user has admin permissions
        if (!isAdmin(teamData)) {
            throw new Error('Only admins and owners can send invitations');
        }

        // Check rate limits AFTER permission check
        await checkInvitationRateLimits(invitedEmail);

        // Generate unique invitation token
        const invitationToken = generateInvitationToken();

        // Create invitation document
        const invitationRef = await addDoc(collection(db, 'teamInvitations'), {
            teamId: appState.currentTeamId,
            teamName: teamData.name,
            invitedEmail: invitedEmail.toLowerCase(),
            invitedName: invitedName || '',
            occupation: occupation || '',
            invitedBy: currentAuthUser.uid,
            invitedByName: currentAuthUser.displayName || currentAuthUser.email,
            invitedByEmail: currentAuthUser.email,
            status: 'pending',
            token: invitationToken,
            createdAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        debugLog('✅ Invitation created successfully:', invitationRef.id);

        // Generate invite link
        const inviteLink = `${window.location.origin}/accept-invitation.html?token=${invitationToken}&id=${invitationRef.id}`;
        
        // Show the invite link to the user
        showInviteLink(inviteLink, invitedEmail, invitedName);

        return invitationRef.id;
    } catch (error) {
        console.error('❌ Error creating invitation:', error.code || error.message);
        debugError('Full error:', error);
        throw error;
    }
}

// Generate cryptographically secure invitation token
// Uses crypto.getRandomValues() for high entropy (256 bits)
function generateInvitationToken() {
    // Generate 32 random bytes (256 bits of entropy)
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    
    // Convert to hex string (64 characters)
    const hex = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    // Return with prefix for easy identification (total = 68 chars, well above 32 minimum)
    return `inv_${hex}`;
}

// Generic secure token generator for any security-sensitive use
function generateSecureToken(bytes = 32) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sync public profile data for teammate visibility
 * This creates/updates the publicProfiles/{userId} document with limited fields
 * that other authenticated users can read (for teammate displays, assignees, etc.)
 * 
 * SECURITY: Email is NOT stored in publicProfiles to prevent cross-team scraping.
 * Email is available via team members map for users in the same team.
 * 
 * @param {Object} profileData - Profile data to sync
 * @param {string} profileData.displayName - User's display name
 * @param {string|null} profileData.photoURL - User's avatar URL
 * @param {string|null} profileData.occupation - User's job title/occupation
 */
async function syncPublicProfile(profileData) {
    if (!db || !currentAuthUser) {
        debugLog('Cannot sync public profile: not authenticated');
        return;
    }
    
    const path = `publicProfiles/${currentAuthUser.uid}`;
    
    try {
        const { doc, setDoc, updateDoc, getDoc, serverTimestamp, deleteField } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const publicProfileRef = doc(db, 'publicProfiles', currentAuthUser.uid);
        
        // SECURITY: Only include allowed fields (NO email - prevents cross-team scraping)
        // Ensure displayName is a string and within length limit
        let displayName = profileData.displayName || currentAuthUser.displayName || 'Unknown';
        if (typeof displayName !== 'string') displayName = String(displayName);
        if (displayName.length > 100) displayName = displayName.substring(0, 100);
        
        // Check if doc exists FIRST to handle legacy null fields
        const docSnap = await getDoc(publicProfileRef);
        const existingData = docSnap.exists() ? docSnap.data() : null;
        
        // Build publicData for CREATE or UPDATE
        const publicData = {
            displayName: displayName,
            updatedAt: serverTimestamp()
        };
        
        // Add optional fields only if they exist and are valid strings
        if (profileData.photoURL && typeof profileData.photoURL === 'string') {
            publicData.photoURL = profileData.photoURL;
        }
        if (profileData.occupation && typeof profileData.occupation === 'string') {
            // Clamp occupation length to 200 chars (matches rule)
            publicData.occupation = profileData.occupation.substring(0, 200);
        }
        
        // FIX FOR LEGACY NULL FIELDS:
        // If existing doc has photoURL or occupation that is NOT a string (commonly null),
        // we must delete those fields to pass the rule check:
        //   (!('photoURL' in request.resource.data) || request.resource.data.photoURL is string)
        // updateDoc merges, so we use deleteField() to explicitly remove bad fields
        if (existingData) {
            // If existing photoURL is not a valid string and we're not setting a new one, delete it
            if (('photoURL' in existingData) && typeof existingData.photoURL !== 'string' && !publicData.photoURL) {
                publicData.photoURL = deleteField();
            }
            // If existing occupation is not a valid string and we're not setting a new one, delete it
            if (('occupation' in existingData) && typeof existingData.occupation !== 'string' && !publicData.occupation) {
                publicData.occupation = deleteField();
            }
        }
        
        // DEBUG_PERMS logging
        if (DEBUG_PERMS) {
            console.log('[DEBUG_PERMS] syncPublicProfile:', {
                path: path,
                operation: existingData ? 'UPDATE' : 'CREATE',
                keys: Object.keys(publicData),
                uid: currentAuthUser.uid,
                existingKeys: existingData ? Object.keys(existingData) : 'N/A',
                existingPhotoURL: existingData?.photoURL === null ? 'null (LEGACY)' : typeof existingData?.photoURL,
                existingOccupation: existingData?.occupation === null ? 'null (LEGACY)' : typeof existingData?.occupation
            });
        }
        
        if (existingData) {
            // UPDATE: Only send mutable fields
            await updateDoc(publicProfileRef, publicData);
        } else {
            // CREATE: Full doc
            await setDoc(publicProfileRef, publicData);
        }
        debugLog('✅ Public profile synced successfully');
        
    } catch (error) {
        // Log detailed error info for permission-denied
        logFirestoreError('syncPublicProfile', path, { displayName: profileData.displayName }, {
            uid: currentAuthUser.uid,
            hasPhotoURL: !!profileData.photoURL,
            hasOccupation: !!profileData.occupation
        }, error);
        // Non-critical error - log but don't throw
        console.warn('Failed to sync public profile:', error.code || error.message);
    }
}

// Check invitation rate limits to prevent spam
/**
 * ⚠️ SECURITY LIMITATION: CLIENT-SIDE RATE LIMITING ⚠️
 * 
 * These rate limits are enforced CLIENT-SIDE only and can be bypassed by:
 * - Directly calling the Firestore API
 * - Modifying this JavaScript code
 * - Using multiple browser sessions/devices
 * 
 * The limits ARE enforced in Firestore rules for:
 * - Token length (min 32 chars)
 * - Schema validation (required fields)
 * - Permission checks (admin/owner only)
 * 
 * For TRUE server-side rate limiting, you need:
 * - Cloud Functions with rate limiting logic
 * - Firebase App Check to verify legitimate clients
 * - IP-based rate limiting at the infrastructure level
 * 
 * RECOMMENDATION: Implement Cloud Functions for invitation creation
 * to enforce rate limits server-side before production launch.
 * 
 * Current client-side limits (easily bypassed):
 * - 20 invitations per hour per user
 * - 100 invitations per day per user
 * - 15-minute cooldown per email address
 */
async function checkInvitationRateLimits(invitedEmail) {
    if (!db || !currentAuthUser) {
        throw new Error('Not authenticated');
    }

    try {
        const { collection, query, where, getDocs, Timestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');

        const now = new Date();
        const oneHourAgo = Timestamp.fromDate(new Date(now.getTime() - 60 * 60 * 1000));
        const oneDayAgo = Timestamp.fromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const fifteenMinutesAgo = Timestamp.fromDate(new Date(now.getTime() - 15 * 60 * 1000));

        const invitationsRef = collection(db, 'teamInvitations');

        // LIMIT 1: Check per-user hourly limit (max 20 invites per hour)
        // WARNING: This is client-side only - see comment above
        const hourlyQuery = query(
            invitationsRef,
            where('invitedBy', '==', currentAuthUser.uid),
            where('createdAt', '>=', oneHourAgo)
        );
        const hourlySnapshot = await getDocs(hourlyQuery);
        
        if (hourlySnapshot.size >= 20) {
            throw new Error('HOURLY_LIMIT_REACHED');
        }

        // LIMIT 2: Check per-user daily limit (max 100 invites per 24 hours)
        const dailyQuery = query(
            invitationsRef,
            where('invitedBy', '==', currentAuthUser.uid),
            where('createdAt', '>=', oneDayAgo)
        );
        const dailySnapshot = await getDocs(dailyQuery);
        
        if (dailySnapshot.size >= 100) {
            throw new Error('DAILY_LIMIT_REACHED');
        }

        // LIMIT 3: Check per-email rate limit (no duplicate pending invites within 15 minutes)
        const emailQuery = query(
            invitationsRef,
            where('invitedEmail', '==', invitedEmail.toLowerCase()),
            where('createdAt', '>=', fifteenMinutesAgo),
            where('status', '==', 'pending')
        );
        const emailSnapshot = await getDocs(emailQuery);
        
        if (!emailSnapshot.empty) {
            throw new Error('EMAIL_RECENTLY_INVITED');
        }

        console.log('✅ Rate limit checks passed');
        return true;

    } catch (error) {
        if (error.message === 'HOURLY_LIMIT_REACHED') {
            throw new Error('Invite limit reached. You can send up to 20 invitations per hour. Please wait before sending more invitations.');
        }
        if (error.message === 'DAILY_LIMIT_REACHED') {
            throw new Error('Daily invite limit reached. You can send up to 100 invitations per day. Please try again tomorrow.');
        }
        if (error.message === 'EMAIL_RECENTLY_INVITED') {
            throw new Error('This email already has a recent pending invitation. Please wait at least 15 minutes before sending another one.');
        }
        throw error;
    }
}

// Show invite link modal
function showInviteLink(inviteLink, invitedEmail, invitedName) {
    // Close the add teammate modal
    closeModal('teammateModal');
    
    // Create and show invite link modal
    const existingModal = document.getElementById('inviteLinkModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'inviteLinkModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h2><i class="fas fa-link"></i> Invitation Link Created</h2>
                <span class="modal-close" onclick="closeInviteLinkModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <p style="margin-bottom: 15px; color: #495057;">
                        <strong>Invited:</strong> ${escapeHtml(invitedName || invitedEmail)}
                        <br>
                        <strong>Email:</strong> ${escapeHtml(invitedEmail)}
                    </p>
                    <p style="margin-bottom: 10px; color: #6c757d; font-size: 0.9rem;">
                        <i class="fas fa-info-circle"></i> Copy this link and send it to ${escapeHtml(invitedName || invitedEmail)}:
                    </p>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input 
                            type="text" 
                            id="inviteLinkInput" 
                            value="${escapeHtml(inviteLink)}" 
                            readonly
                            style="flex: 1; padding: 12px; border: 2px solid #0078D4; border-radius: 6px; font-family: monospace; font-size: 0.85rem;"
                        >
                        <button 
                            onclick="copyInviteLink()" 
                            class="btn btn-primary"
                            style="white-space: nowrap; padding: 12px 20px;"
                        >
                            <i class="fas fa-copy"></i> Copy
                        </button>
                    </div>
                    <p style="margin-top: 10px; color: #6c757d; font-size: 0.85rem;">
                        <i class="fas fa-clock"></i> This link expires in 7 days
                    </p>
                </div>
                <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; border-left: 4px solid #0078D4;">
                    <p style="margin: 0; color: #004085; font-size: 0.9rem;">
                        <strong>💡 Tip:</strong> You can share this link via email, Slack, Teams, or any messaging app!
                    </p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeInviteLinkModal()">Done</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Copy invite link to clipboard
window.copyInviteLink = function() {
    const input = document.getElementById('inviteLinkInput');
    input.select();
    input.setSelectionRange(0, 99999); // For mobile devices
    
    try {
        document.execCommand('copy');
        const btn = event.target.closest('button');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.background = '#28a745';
        
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
        }, 2000);
    } catch (err) {
        alert('Please manually copy the link: ' + input.value);
    }
}

// Close invite link modal
window.closeInviteLinkModal = function() {
    const modal = document.getElementById('inviteLinkModal');
    if (modal) {
        modal.remove();
    }
}

// Send invitation email (using EmailJS or similar service)
async function sendInvitationEmail(invitationData) {
    // For now, we'll use a simple approach
    // You can integrate with EmailJS, SendGrid, or other email service
    
    const invitationLink = `${window.location.origin}/accept-invitation.html?token=${invitationData.invitationToken}&id=${invitationData.invitationId}`;
    
    debugLog('📧 Invitation created for team:', invitationData.teamId);
    debugLog('Invitation link (debug only):', invitationLink);
    
    // Store invitation link in memory for current session only (not persisted)
    window.lastInvitationLink = invitationLink;
    
    // TODO: Integrate with actual email service
    // Example with EmailJS (you'll need to set up an account):
    /*
    emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', {
        to_email: invitationData.invitedEmail,
        to_name: invitationData.invitedName,
        team_name: invitationData.teamName,
        inviter_name: invitationData.inviterName,
        invitation_link: invitationLink
    });
    */
    
    return true;
}

async function loadTeammatesFromFirestore() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Get team document
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (teamDoc.exists()) {
            const teamData = teamDoc.data();
            const members = teamData.members || {};
            
            debugLog('📥 Loading teammates from Firestore...', Object.keys(members).length, 'members');
            
            // Convert members object to array and fetch latest user data for each
            const teammatePromises = Object.keys(members).map(async userId => {
                const member = members[userId];
                
                // Fetch public profile data (or own private profile if it's the current user)
                let userData = null;
                try {
                    if (userId === currentAuthUser.uid) {
                        // Current user can read their own private profile
                        const userRef = doc(db, 'users', userId);
                        const userDoc = await getDoc(userRef);
                        if (userDoc.exists()) {
                            userData = userDoc.data();
                        }
                    } else {
                        // For other users, read from publicProfiles collection
                        const publicProfileRef = doc(db, 'publicProfiles', userId);
                        const publicProfileDoc = await getDoc(publicProfileRef);
                        if (publicProfileDoc.exists()) {
                            const publicData = publicProfileDoc.data();
                            userData = {
                                displayName: publicData.displayName,
                                jobTitle: publicData.occupation,
                                photoURL: publicData.photoURL
                            };
                        }
                    }
                } catch (error) {
                    // Expected for users who haven't synced their public profile yet
                    debugLog('Could not fetch profile for:', userId);
                }
                
                // Merge team member data with latest user profile data
                // User profile data takes priority for display settings
                const teammate = {
                    id: userId,
                    name: userData?.displayName || member.name || member.email.split('@')[0],
                    email: member.email,
                    occupation: userData?.jobTitle || member.occupation || member.role,
                    avatar: generateAvatar(userData?.displayName || member.name || member.email),
                    avatarColor: userData?.avatarColor || member.avatarColor || '#0078D4',
                    photoURL: member.photoURL,
                    role: member.role,
                    joinedAt: member.joinedAt
                };
                
                // Log current user's data
                if (userId === currentAuthUser.uid) {
                    debugLog('👤 Current user data:', teammate);
                }
                
                return teammate;
            });
            
            // Wait for all teammate data to be fetched
            appState.teammates = await Promise.all(teammatePromises);
            
            displayTeammates();
            debugLog('✅ Loaded teammates from Firestore:', appState.teammates.length);
        }
    } catch (error) {
        console.error('Error loading teammates from Firestore:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// ===================================
// SEARCH FUNCTIONALITY
// ===================================

/**
 * SEARCH_INDEX - Central search index for navigable app sections
 * 
 * Structure:
 * - id: Unique identifier for the search target
 * - label: Display name shown in search results
 * - description: Brief description of what the target does
 * - route: The section name used by switchTab() function
 * - sectionId: The DOM element ID of the section
 * - icon: FontAwesome icon class for visual identification
 * - keywords: Array of searchable terms including common misspellings
 * 
 * The keywords array should include:
 * - Primary terms and synonyms
 * - Common typos and misspellings
 * - Related concepts users might search for
 */
/**
 * SEARCH_INDEX - Command Palette / Global Search Index
 * 
 * Each entry has a `type` field:
 *   - 'navigation': Goes to a page/section (switches tabs, scrolls to elements)
 *   - 'command': Triggers an action (opens modals, runs functions, etc.)
 * 
 * To add new entries:
 *   - Navigation: Add route, sectionId, and optional category for breadcrumb
 *   - Command: Add action (function name to call) and any needed parameters
 * 
 * Keywords support fuzzy matching with common typos included.
 */
const SEARCH_INDEX = [
    // ==================== NAVIGATION ENTRIES ====================
    // Main tabs/sections
    {
        id: 'overview-main',
        type: 'navigation',
        label: 'Overview',
        description: 'Dashboard with activity feed and quick stats',
        route: 'activity',
        sectionId: 'activity-section',
        icon: 'fa-th-large',
        keywords: ['overview', 'overveiw', 'ovrview', 'dashboard', 'dashbord', 'home', 'main', 'activity', 'activty', 'feed', 'summary']
    },
    {
        id: 'team-main',
        type: 'navigation',
        label: 'Team',
        description: 'View and manage team members',
        route: 'team',
        sectionId: 'team-section',
        icon: 'fa-users',
        keywords: ['team', 'teem', 'tem', 'members', 'membrs', 'people', 'peple', 'users', 'usrs', 'colleagues', 'coworkers', 'staff']
    },
    {
        id: 'chat-main',
        type: 'navigation',
        label: 'Chat',
        description: 'Team chat and messages',
        route: 'chat',
        sectionId: 'chat-section',
        icon: 'fa-comments',
        keywords: ['chat', 'chatt', 'cht', 'messages', 'mesages', 'messges', 'dm', 'direct', 'talk', 'conversation', 'messaging']
    },
    {
        id: 'calendar-main',
        type: 'navigation',
        label: 'Calendar',
        description: 'View and manage events and schedule',
        route: 'calendar',
        sectionId: 'calendar-section',
        icon: 'fa-calendar-alt',
        keywords: ['calendar', 'calender', 'calandar', 'calander', 'events', 'evnts', 'schedule', 'shedule', 'dates', 'appointments', 'meetings']
    },
    {
        id: 'tasks-main',
        type: 'navigation',
        label: 'Sheets',
        description: 'View and manage spreadsheets and tables',
        route: 'tasks',
        sectionId: 'tasks-section',
        icon: 'fa-table-list',
        keywords: ['sheets', 'sheet', 'tasks', 'taks', 'task', 'tsks', 'todo', 'to-do', 'todos', 'checklist', 'work', 'items', 'assignments', 'spreadsheet', 'table', 'leads']
    },
    {
        id: 'metrics-main',
        type: 'navigation',
        label: 'Metrics',
        description: 'Track performance across tasks, events and teamwork',
        route: 'metrics',
        sectionId: 'metrics-section',
        icon: 'fa-chart-line',
        keywords: ['metrics', 'metrcs', 'stats', 'statistics', 'analytics', 'anlytics', 'performance', 'performace', 'reports', 'reporting', 'insights', 'data', 'charts', 'graphs', 'productivity', 'kpi', 'kpis']
    },
    {
        id: 'settings-main',
        type: 'navigation',
        label: 'Settings',
        description: 'App settings and preferences',
        route: 'settings',
        sectionId: 'settings-section',
        icon: 'fa-cog',
        keywords: ['settings', 'settyngs', 'setings', 'setngs', 'preferences', 'preferances', 'prefs', 'config', 'configuration', 'options']
    },
    // Settings subsections
    {
        id: 'settings-notifications',
        type: 'navigation',
        label: 'Notification Preferences',
        description: 'Configure which notifications you receive',
        route: 'settings',
        sectionId: 'settings-notifications-section',
        category: 'Settings',
        icon: 'fa-bell',
        keywords: ['notifications', 'notifcations', 'notifs', 'alerts', 'alrts', 'bell', 'notify', 'notification preferences', 'notification settings']
    },
    {
        id: 'settings-appearance',
        type: 'navigation',
        label: 'Dark Mode',
        description: 'Switch between light and dark themes',
        route: 'settings',
        sectionId: 'settings-appearance-section',
        category: 'Settings',
        icon: 'fa-moon',
        keywords: ['appearance', 'appearence', 'theme', 'theem', 'dark mode', 'darkmode', 'dark', 'light mode', 'lightmode', 'light', 'colors', 'visual', 'night mode']
    },
    {
        id: 'settings-security',
        type: 'navigation',
        label: 'Security',
        description: 'Password, sessions, and logout options',
        route: 'settings',
        sectionId: 'settings-security-section',
        category: 'Settings',
        icon: 'fa-shield-halved',
        keywords: ['security', 'securty', 'password', 'pasword', 'change password', 'sessions', 'account security']
    },
    {
        id: 'settings-profile',
        type: 'navigation',
        label: 'Profile',
        description: 'Edit your name, avatar, and account info',
        route: 'settings',
        sectionId: 'settings-profile-section',
        category: 'Settings',
        icon: 'fa-user',
        keywords: ['profile', 'profle', 'avatar', 'avtar', 'photo', 'picture', 'name', 'display name', 'displayname', 'account', 'my account', 'job title']
    },
    {
        id: 'settings-chat-appearance',
        type: 'navigation',
        label: 'Chat Appearance',
        description: 'Customize chat bubble style and layout',
        route: 'settings',
        sectionId: 'settings-chat-appearance-section',
        category: 'Settings',
        icon: 'fa-comments',
        keywords: ['chat appearance', 'chat style', 'bubble', 'bubbles', 'compact', 'timestamps', 'avatars in chat', 'message style']
    },
    
    // ==================== COMMAND ENTRIES ====================
    // Commands trigger actions like opening modals or running functions
    {
        id: 'cmd-add-task',
        type: 'command',
        label: 'Add task',
        description: 'Open the New Task dialog',
        icon: 'fa-plus-circle',
        keywords: ['add task', 'new task', 'create task', 'add taks', 'new taks', 'creat task', 'task']
    },
    {
        id: 'cmd-add-event',
        type: 'command',
        label: 'Add event',
        description: 'Open the New Event dialog',
        icon: 'fa-calendar-plus',
        keywords: ['add event', 'new event', 'create event', 'add evnt', 'new evnt', 'calendar event', 'schedule event']
    },
    {
        id: 'cmd-create-spreadsheet',
        type: 'command',
        label: 'Create spreadsheet',
        description: 'Create a new tasks spreadsheet',
        icon: 'fa-table',
        keywords: ['create spreadsheet', 'new spreadsheet', 'add spreadsheet', 'creat spreadsheet', 'table', 'tasks table', 'spreadsheet']
    },
    {
        id: 'cmd-delete-messages',
        type: 'command',
        label: 'Delete messages',
        description: 'Go to chat to manage or delete messages',
        icon: 'fa-trash-alt',
        keywords: ['delete messages', 'remove messages', 'clear chat', 'delet messages', 'delete mesages', 'chat delete']
    },
    {
        id: 'cmd-logout',
        type: 'command',
        label: 'Log out',
        description: 'Sign out from Teamster',
        icon: 'fa-sign-out-alt',
        keywords: ['log out', 'logout', 'sign out', 'signout', 'logg out', 'log off', 'exit']
    },
    {
        id: 'cmd-change-password',
        type: 'command',
        label: 'Change password',
        description: 'Open password / security settings',
        icon: 'fa-key',
        keywords: ['change password', 'password', 'chang password', 'reset password', 'update password', 'new password']
    },
    {
        id: 'cmd-invite-member',
        type: 'command',
        label: 'Invite team member',
        description: 'Send an invitation to join your team',
        icon: 'fa-user-plus',
        keywords: ['invite', 'invit', 'add member', 'new member', 'invite member', 'team invite', 'add teammate']
    }
];

/**
 * Compute Levenshtein distance between two strings
 * Used for fuzzy matching - finds "edit distance" (insertions, deletions, substitutions)
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Number of edits needed to transform a into b
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    // Create matrix
    const matrix = [];
    
    // Initialize first column
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    
    // Initialize first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[b.length][a.length];
}

/**
 * Search the app for navigable sections/targets
 * 
 * Scoring system:
 * - 100: Exact match on label
 * - 80: Label starts with query
 * - 60: Exact match on keyword
 * - 50: Keyword starts with query
 * - 40: Query is substring of label or keyword
 * - 30: Fuzzy match (Levenshtein distance <= 2)
 * - 20: Fuzzy match (Levenshtein distance <= 3, only for longer words)
 * 
 * @param {string} query - The search query
 * @param {number} limit - Maximum number of results to return (default: 7)
 * @returns {Array} - Array of matching results with scores
 */
function searchApp(query, limit = 7) {
    // Normalize query
    const normalizedQuery = (query || '').toLowerCase().trim();
    
    // Return empty array for empty queries
    if (!normalizedQuery) {
        return [];
    }
    
    const results = [];
    const minScoreThreshold = 15; // Minimum score to include in results
    
    for (const entry of SEARCH_INDEX) {
        let maxScore = 0;
        
        // Check label
        const labelLower = entry.label.toLowerCase();
        
        if (labelLower === normalizedQuery) {
            // Exact match on label - highest score
            maxScore = 100;
        } else if (labelLower.startsWith(normalizedQuery)) {
            // Label starts with query
            maxScore = Math.max(maxScore, 80);
        } else if (labelLower.includes(normalizedQuery)) {
            // Query is substring of label
            maxScore = Math.max(maxScore, 40);
        } else {
            // Try fuzzy match on label
            const labelDistance = levenshteinDistance(normalizedQuery, labelLower);
            if (labelDistance <= 2) {
                maxScore = Math.max(maxScore, 30);
            } else if (labelDistance <= 3 && normalizedQuery.length >= 4) {
                maxScore = Math.max(maxScore, 20);
            }
        }
        
        // Check keywords
        for (const keyword of entry.keywords) {
            const keywordLower = keyword.toLowerCase();
            
            if (keywordLower === normalizedQuery) {
                // Exact match on keyword
                maxScore = Math.max(maxScore, 60);
            } else if (keywordLower.startsWith(normalizedQuery)) {
                // Keyword starts with query
                maxScore = Math.max(maxScore, 50);
            } else if (keywordLower.includes(normalizedQuery)) {
                // Query is substring of keyword
                maxScore = Math.max(maxScore, 40);
            } else {
                // Try fuzzy match on keyword
                // Only for queries and keywords of reasonable length
                if (normalizedQuery.length >= 3 && keywordLower.length >= 3) {
                    const distance = levenshteinDistance(normalizedQuery, keywordLower);
                    
                    // Allow distance proportional to word length
                    // Shorter words need closer matches
                    const maxAllowedDistance = Math.min(2, Math.floor(keywordLower.length / 3));
                    
                    if (distance <= maxAllowedDistance) {
                        maxScore = Math.max(maxScore, 30 - (distance * 5));
                    } else if (distance <= 3 && normalizedQuery.length >= 5) {
                        // More lenient for longer queries
                        maxScore = Math.max(maxScore, 20);
                    }
                }
            }
            
            // Early exit if we already have max keyword score
            if (maxScore >= 60) break;
        }
        
        // Only include results above threshold
        if (maxScore >= minScoreThreshold) {
            results.push({
                id: entry.id,
                type: entry.type || 'navigation', // Include type field
                label: entry.label,
                description: entry.description,
                route: entry.route,
                sectionId: entry.sectionId,
                icon: entry.icon,
                category: entry.category, // Include category for breadcrumb
                score: maxScore
            });
        }
    }
    
    // Sort by score (descending), then by label (ascending) as tie-breaker
    results.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.label.localeCompare(b.label);
    });
    
    // Return limited results
    return results.slice(0, limit);
}

// ===================================
// SEARCH UI - DROPDOWN & KEYBOARD NAV
// ===================================

// Track the currently highlighted search result index
let searchActiveIndex = -1;

/**
 * Initialize the global search functionality
 * - Input handling with debounce
 * - Keyboard navigation (up/down/enter/escape)
 * - Click outside to close
 */
function initSearch() {
    const searchInput = document.getElementById('globalSearchInput');
    const searchClear = document.getElementById('searchClear');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout;

    if (!searchInput) {
        console.warn('Search input not found');
        return;
    }

    // Handle input changes with debounce
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Show/hide clear button
        if (searchClear) {
            searchClear.style.display = query ? 'flex' : 'none';
        }

        clearTimeout(searchTimeout);
        
        if (query) {
            searchTimeout = setTimeout(() => {
                performSearch(query);
            }, 150); // Faster response for command palette feel
        } else {
            hideSearchDropdown();
        }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const searchResults = document.getElementById('searchResults');
        if (!searchResults || !searchResults.classList.contains('visible')) {
            // If dropdown isn't visible and user presses down, trigger search
            if (e.key === 'ArrowDown' && searchInput.value.trim()) {
                performSearch(searchInput.value.trim());
                e.preventDefault();
            }
            return;
        }

        const items = searchResults.querySelectorAll('.search-result-item');
        if (items.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                searchActiveIndex = Math.min(searchActiveIndex + 1, items.length - 1);
                updateSearchActiveItem(items);
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                searchActiveIndex = Math.max(searchActiveIndex - 1, 0);
                updateSearchActiveItem(items);
                break;
                
            case 'Enter':
                e.preventDefault();
                if (searchActiveIndex >= 0 && items[searchActiveIndex]) {
                    items[searchActiveIndex].click();
                } else if (items.length > 0) {
                    // If nothing selected, activate first result
                    items[0].click();
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                hideSearchDropdown();
                searchInput.blur();
                break;
                
            case 'Tab':
                // Allow tab to close dropdown and move focus
                hideSearchDropdown();
                break;
        }
    });

    // Focus handling - show dropdown if there's a query
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        if (query) {
            performSearch(query);
        }
    });

    // Clear button
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            hideSearchDropdown();
            searchInput.focus();
        });
    }

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            hideSearchDropdown();
        }
    });
}

/**
 * Update the active/highlighted search result item
 */
function updateSearchActiveItem(items) {
    items.forEach((item, index) => {
        if (index === searchActiveIndex) {
            item.classList.add('active');
            // Scroll into view if needed
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

/**
 * Show the search dropdown with animation
 */
function showSearchDropdown() {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
        searchResults.style.display = 'block';
        // Trigger reflow for animation
        searchResults.offsetHeight;
        searchResults.classList.add('visible');
    }
}

/**
 * Hide the search dropdown with animation
 */
function hideSearchDropdown() {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
        searchResults.classList.remove('visible');
        // Reset active index
        searchActiveIndex = -1;
        // Hide after animation
        setTimeout(() => {
            if (!searchResults.classList.contains('visible')) {
                searchResults.style.display = 'none';
            }
        }, 150);
    }
}

/**
 * Navigate to a search result and close the dropdown
 */
/**
 * Execute a search result - handles both navigation and command types
 * @param {string} resultId - The ID of the search result entry
 * @param {string} type - 'navigation' or 'command'
 * @param {string} route - For navigation: the tab to switch to
 * @param {string} sectionId - For navigation: the element to scroll to
 */
function executeSearchResult(resultId, type, route, sectionId) {
    // Clear search input and close dropdown first
    clearSearchUI();
    
    if (type === 'command') {
        executeSearchCommand(resultId);
    } else {
        // Default: navigation
        navigateToSection(route, sectionId);
    }
}

/**
 * Execute a command from the search/command palette
 * @param {string} commandId - The command ID from SEARCH_INDEX
 */
function executeSearchCommand(commandId) {
    switch (commandId) {
        case 'cmd-add-task':
            // Open the Add Task modal (same as clicking Add Task button)
            openAddTaskModal();
            break;

        case 'cmd-add-event':
            // Navigate to Calendar and open Add Event modal
            switchTab('calendar');
            setTimeout(() => {
                openModal('eventModal');
            }, 100);
            break;

        case 'cmd-create-spreadsheet':
            // Navigate to Sheets and open Create Spreadsheet modal
            switchTab('tasks');
            setTimeout(() => {
                openModal('spreadsheetModal');
            }, 100);
            break;

        case 'cmd-delete-messages':
            // Navigate to Chat and show hint about deleting
            switchTab('chat');
            setTimeout(() => {
                showToast('Hover over your messages to see delete options', 'info');
            }, 200);
            break;

        case 'cmd-logout':
            // Call the existing logout function
            if (typeof signOutUser === 'function') {
                signOutUser();
            } else if (typeof window.signOutUser === 'function') {
                window.signOutUser();
            }
            break;

        case 'cmd-change-password':
            // Navigate to Settings → Security section
            navigateToSection('settings', 'settings-security-section');
            break;

        case 'cmd-invite-member':
            // Navigate to Team and open invite modal
            switchTab('team');
            setTimeout(() => {
                // Try to open the teammate modal (which is the invite form)
                if (document.getElementById('teammateModal')) {
                    openModal('teammateModal');
                }
            }, 100);
            break;

        default:
            console.warn('Unknown command:', commandId);
    }
}

/**
 * Helper: Open the Add Task modal in create mode
 */
function openAddTaskModal() {
    // Reset form for new task
    const taskForm = document.getElementById('taskForm');
    if (taskForm) {
        taskForm.reset();
    }
    
    // Clear any editing state
    const taskIdInput = document.getElementById('editingTaskId');
    if (taskIdInput) {
        taskIdInput.value = '';
    }
    
    // Set modal title for create mode
    const modalHeader = document.querySelector('#taskModal .unified-modal-title h2');
    const submitBtn = document.querySelector('#taskModal .unified-btn-primary');
    if (modalHeader) modalHeader.innerHTML = '<i class="fas fa-plus-circle"></i> New Task';
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Task';
    
    // Set default due date to today
    const dueDateInput = document.getElementById('taskDueDate');
    if (dueDateInput) {
        dueDateInput.value = new Date().toISOString().split('T')[0];
    }
    
    // Reset show on calendar toggle to checked (default)
    const showOnCalendarCheckbox = document.getElementById('taskShowOnCalendar');
    if (showOnCalendarCheckbox) {
        showOnCalendarCheckbox.checked = true;
    }
    
    // Open the modal
    openModal('taskModal');
}

/**
 * Helper: Open the Add Lead modal in create mode
 */
function openAddLeadModal() {
    // Reset form for new lead
    const leadForm = document.getElementById('leadForm');
    if (leadForm) {
        leadForm.reset();
    }
    
    // Reset dropdowns to default
    resetLeadModalDropdowns();
    
    // Pre-select current spreadsheet if it's a leads type
    if (appState.currentSpreadsheet?.type === 'leads') {
        const leadSpreadsheetInput = document.getElementById('leadSpreadsheet');
        const leadSpreadsheetLabel = document.getElementById('leadSpreadsheetLabel');
        if (leadSpreadsheetInput) {
            leadSpreadsheetInput.value = appState.currentSpreadsheet.id;
        }
        if (leadSpreadsheetLabel) {
            leadSpreadsheetLabel.textContent = appState.currentSpreadsheet.name;
        }
    }
    
    // Populate spreadsheet dropdown with leads-type spreadsheets
    populateLeadSpreadsheetDropdown();
    
    // Open the modal
    openModal('leadModal');
}

/**
 * Smart modal opener - opens correct modal based on current spreadsheet type
 */
function openAddItemModal() {
    if (appState.currentSpreadsheet?.type === 'leads') {
        openAddLeadModal();
    } else {
        // For tasks or default, click the existing add task button
        const addTaskBtn = document.getElementById('addTaskPanelBtn');
        if (addTaskBtn) {
            addTaskBtn.click();
        } else {
            openAddTaskModal();
        }
    }
}

// Make it globally accessible
window.openAddItemModal = openAddItemModal;
window.openAddLeadModal = openAddLeadModal;
window.openAddTaskModal = openAddTaskModal;

/**
 * Initialize Lead Modal Dropdowns
 */
function initLeadModalDropdowns() {
    // Status dropdown
    const statusTrigger = document.getElementById('leadStatusTrigger');
    const statusMenu = document.getElementById('leadStatusMenu');
    const statusInput = document.getElementById('leadStatus');
    
    if (statusTrigger && statusMenu && statusInput) {
        statusTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            statusMenu.classList.toggle('visible');
        });
        
        statusMenu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const value = opt.dataset.value;
                const color = opt.dataset.color || '#007AFF';
                statusInput.value = value;
                const statusContent = statusTrigger.querySelector('.dropdown-trigger-content') || statusTrigger.querySelector('.unified-dropdown-value');
                if (statusContent) {
                    statusContent.innerHTML = `
                        <span class="status-dot" style="background: ${color};"></span>
                        <span>${value}</span>
                    `;
                }
                statusMenu.querySelectorAll('.dropdown-menu-option').forEach(o => {
                    o.classList.remove('active');
                    o.querySelector('.fa-check')?.remove();
                });
                opt.classList.add('active');
                if (!opt.querySelector('.fa-check')) {
                    opt.insertAdjacentHTML('beforeend', '<i class="fas fa-check"></i>');
                }
                statusMenu.classList.remove('visible');
            });
        });
    }
    
    // Source dropdown
    const sourceTrigger = document.getElementById('leadSourceTrigger');
    const sourceMenu = document.getElementById('leadSourceMenu');
    const sourceInput = document.getElementById('leadSource');
    
    if (sourceTrigger && sourceMenu && sourceInput) {
        sourceTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            sourceMenu.classList.toggle('visible');
        });
        
        sourceMenu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const value = opt.dataset.value;
                const color = opt.dataset.color || '#007AFF';
                sourceInput.value = value;
                const sourceContent = sourceTrigger.querySelector('.dropdown-trigger-content') || sourceTrigger.querySelector('.unified-dropdown-value');
                if (sourceContent) {
                    sourceContent.innerHTML = `
                        <span class="source-dot" style="background: ${color};"></span>
                        <span>${value}</span>
                    `;
                }
                sourceMenu.querySelectorAll('.dropdown-menu-option').forEach(o => {
                    o.classList.remove('active');
                    o.querySelector('.fa-check')?.remove();
                });
                opt.classList.add('active');
                if (!opt.querySelector('.fa-check')) {
                    opt.insertAdjacentHTML('beforeend', '<i class="fas fa-check"></i>');
                }
                sourceMenu.classList.remove('visible');
            });
        });
    }
    
    // Spreadsheet dropdown
    const spreadsheetTrigger = document.getElementById('leadSpreadsheetTrigger');
    const spreadsheetMenu = document.getElementById('leadSpreadsheetMenu');
    const spreadsheetInput = document.getElementById('leadSpreadsheet');
    
    if (spreadsheetTrigger && spreadsheetMenu && spreadsheetInput) {
        spreadsheetTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            spreadsheetMenu.classList.toggle('visible');
        });
    }
    
    // Close dropdowns on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('#leadModal .custom-dropdown-menu').forEach(m => {
            m.classList.remove('visible');
        });
    });
}

/**
 * Populate Lead Spreadsheet Dropdown with leads-type spreadsheets
 */
function populateLeadSpreadsheetDropdown() {
    const menu = document.getElementById('leadSpreadsheetMenu');
    const input = document.getElementById('leadSpreadsheet');
    const label = document.getElementById('leadSpreadsheetLabel');
    
    if (!menu || !input) return;
    
    // Filter to only leads-type spreadsheets
    const leadsSpreadsheets = (appState.spreadsheets || []).filter(s => s.type === 'leads');
    
    if (leadsSpreadsheets.length === 0) {
        menu.innerHTML = '<div class="dropdown-no-options">No leads spreadsheets available</div>';
        return;
    }
    
    menu.innerHTML = leadsSpreadsheets.map(s => `
        <div class="dropdown-menu-option" data-value="${s.id}">
            <i class="fas ${s.icon || 'fa-table'}" style="color: ${s.color || '#007AFF'}"></i>
            <span>${escapeHtml(s.name)}</span>
        </div>
    `).join('');
    
    // Pre-select current spreadsheet if it's a leads type
    if (appState.currentSpreadsheet?.type === 'leads') {
        input.value = appState.currentSpreadsheet.id;
        if (label) label.textContent = appState.currentSpreadsheet.name;
    } else if (leadsSpreadsheets.length > 0) {
        input.value = leadsSpreadsheets[0].id;
        if (label) label.textContent = leadsSpreadsheets[0].name;
    }
    
    // Add click handlers
    menu.querySelectorAll('.dropdown-menu-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const spreadsheet = leadsSpreadsheets.find(s => s.id === opt.dataset.value);
            if (spreadsheet) {
                input.value = spreadsheet.id;
                if (label) label.textContent = spreadsheet.name;
            }
            menu.classList.remove('visible');
        });
    });
}

/**
 * Reset Lead Modal Dropdowns to default values
 */
function resetLeadModalDropdowns() {
    // Reset status
    const statusInput = document.getElementById('leadStatus');
    const statusTrigger = document.getElementById('leadStatusTrigger');
    if (statusInput) statusInput.value = 'New';
    if (statusTrigger) {
        const statusContent = statusTrigger.querySelector('.dropdown-trigger-content') || statusTrigger.querySelector('.unified-dropdown-value');
        if (statusContent) {
            statusContent.innerHTML = `
                <span class="status-dot" style="background: #007AFF;"></span>
                <span>New</span>
            `;
        }
    }
    
    // Reset source
    const sourceInput = document.getElementById('leadSource');
    const sourceTrigger = document.getElementById('leadSourceTrigger');
    if (sourceInput) sourceInput.value = 'Website';
    if (sourceTrigger) {
        const sourceContent = sourceTrigger.querySelector('.dropdown-trigger-content') || sourceTrigger.querySelector('.unified-dropdown-value');
        if (sourceContent) {
            sourceContent.innerHTML = `
                <span class="source-dot" style="background: #007AFF;"></span>
                <span>Website</span>
            `;
        }
    }
    
    // Reset spreadsheet label
    const spreadsheetLabel = document.getElementById('leadSpreadsheetLabel');
    if (spreadsheetLabel) spreadsheetLabel.textContent = 'Select spreadsheet';
}

/**
 * Navigate to a section/tab with optional scroll to element
 * @param {string} route - The tab to switch to
 * @param {string} sectionId - Optional element ID to scroll to
 */
function navigateToSection(route, sectionId) {
    // Use the existing switchTab function
    switchTab(route);
    
    // Scroll to specific subsection if provided
    if (sectionId && sectionId !== `${route}-section`) {
        // Wait for tab content to render
        requestAnimationFrame(() => {
            setTimeout(() => {
                scrollToElement(sectionId);
            }, 50);
        });
    }
}

/**
 * Navigate to the Team tab and highlight a specific teammate
 * @param {string} memberId - The user ID of the teammate to highlight
 */
function navigateToTeammate(memberId) {
    // Switch to team tab
    switchTab('team');
    
    // Wait for team section to render, then find and highlight the member card
    requestAnimationFrame(() => {
        setTimeout(() => {
            const memberCard = document.querySelector(`.team-member-card[data-member-id="${memberId}"]`);
            if (memberCard) {
                // Scroll the card into view
                memberCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Add highlight effect
                memberCard.style.transition = 'box-shadow 0.3s ease, transform 0.3s ease';
                memberCard.style.boxShadow = '0 0 0 3px var(--accent), 0 8px 24px rgba(0, 122, 255, 0.25)';
                memberCard.style.transform = 'scale(1.02)';
                
                // Remove highlight after delay
                setTimeout(() => {
                    memberCard.style.boxShadow = '';
                    memberCard.style.transform = '';
                }, 2000);
            }
        }, 150);
    });
}

/**
 * Scroll to an element with header offset and highlight effect
 * @param {string} elementId - The ID of the element to scroll to
 */
function scrollToElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        // Get the scrollable container (main content area)
        const contentArea = document.querySelector('.content-area');
        const headerOffset = 100; // Account for sticky header
        
        if (contentArea) {
            const elementTop = element.offsetTop;
            contentArea.scrollTo({
                top: elementTop - headerOffset,
                behavior: 'smooth'
            });
        } else {
            // Fallback: use scrollIntoView
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Brief highlight effect
        element.classList.add('search-highlight');
        setTimeout(() => element.classList.remove('search-highlight'), 1500);
    }
}

/**
 * Clear search UI state (input, dropdown, selection)
 */
function clearSearchUI() {
    const searchInput = document.getElementById('globalSearchInput');
    const searchClear = document.getElementById('searchClear');
    
    if (searchInput) {
        searchInput.value = '';
    }
    if (searchClear) {
        searchClear.style.display = 'none';
    }
    
    // Hide dropdown and reset selection
    hideSearchDropdown();
    searchActiveIndex = -1;
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use executeSearchResult instead
 */
function navigateToSearchResult(route, sectionId) {
    clearSearchUI();
    navigateToSection(route, sectionId);
}

// Expose search functions globally for onclick handlers
window.executeSearchResult = executeSearchResult;
window.executeSearchCommand = executeSearchCommand;
window.navigateToSearchResult = navigateToSearchResult;
window.navigateToSection = navigateToSection;

/**
 * Perform the search and render results
 */
function performSearch(query) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;

    const lowerQuery = query.toLowerCase();
    
    // Reset active index for new search
    searchActiveIndex = -1;

    // Search for app sections/navigation targets (fuzzy search)
    const sectionResults = searchApp(query, 5);

    // Search through messages, tasks, events, and teammates
    const results = {
        sections: sectionResults,
        messages: (appState.messages || []).filter(m => 
            m.text && m.text.toLowerCase().includes(lowerQuery)
        ).slice(0, 3),
        tasks: (appState.tasks || []).filter(t => 
            (t.title && t.title.toLowerCase().includes(lowerQuery)) || 
            (t.description && t.description.toLowerCase().includes(lowerQuery))
        ).slice(0, 3),
        events: (appState.events || []).filter(e => 
            (e.title && e.title.toLowerCase().includes(lowerQuery)) || 
            (e.description && e.description.toLowerCase().includes(lowerQuery))
        ).slice(0, 3),
        teammates: (appState.teammates || []).filter(tm => 
            (tm.displayName && tm.displayName.toLowerCase().includes(lowerQuery)) || 
            (tm.email && tm.email.toLowerCase().includes(lowerQuery))
        ).slice(0, 3)
    };

    // Build results HTML
    let html = '';
    let resultIndex = 0;

    // Separate commands and navigation from section results
    const commands = results.sections.filter(s => s.type === 'command');
    const navigation = results.sections.filter(s => s.type !== 'command');

    // Show commands first when query strongly matches a command
    if (commands.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-bolt"></i> Commands</div>';
        commands.forEach(cmd => {
            html += `
                <div class="search-result-item search-result-command" data-index="${resultIndex}" data-id="${cmd.id}" data-type="command" onclick="executeSearchResult('${cmd.id}', 'command')">
                    <div class="search-result-icon command-icon"><i class="fas ${cmd.icon}"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${escapeHtml(cmd.label)}</div>
                        <div class="search-result-description"><span class="search-result-tag">Command</span> ${escapeHtml(cmd.description)}</div>
                    </div>
                    <div class="search-result-hint">↵</div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    // Show navigation results
    if (navigation.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-compass"></i> Go to</div>';
        navigation.forEach(section => {
            const breadcrumb = section.category ? `<span class="search-result-breadcrumb">${escapeHtml(section.category)} › </span>` : '';
            html += `
                <div class="search-result-item" data-index="${resultIndex}" data-id="${section.id}" data-type="navigation" onclick="executeSearchResult('${section.id}', 'navigation', '${section.route}', '${section.sectionId}')">
                    <div class="search-result-icon"><i class="fas ${section.icon}"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${breadcrumb}${escapeHtml(section.label)}</div>
                        <div class="search-result-description">${escapeHtml(section.description)}</div>
                    </div>
                    <div class="search-result-hint">↵</div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    if (results.messages.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-comment"></i> Messages</div>';
        results.messages.forEach(msg => {
            html += `
                <div class="search-result-item" data-index="${resultIndex}" data-type="navigation" onclick="executeSearchResult(null, 'navigation', 'chat', 'chat-section')">
                    <div class="search-result-icon"><i class="fas fa-comment"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${escapeHtml(msg.username || 'Unknown')}</div>
                        <div class="search-result-description">${escapeHtml(msg.text)}</div>
                    </div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    if (results.tasks.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-table-list"></i> Sheets</div>';
        results.tasks.forEach(task => {
            html += `
                <div class="search-result-item" data-index="${resultIndex}" data-type="navigation" onclick="executeSearchResult(null, 'navigation', 'tasks', 'tasks-section')">
                    <div class="search-result-icon"><i class="fas fa-check-circle"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${escapeHtml(task.title)}</div>
                        <div class="search-result-description">${escapeHtml(task.description || 'No description')}</div>
                    </div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    if (results.events.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-calendar"></i> Events</div>';
        results.events.forEach(event => {
            html += `
                <div class="search-result-item" data-index="${resultIndex}" data-type="navigation" onclick="executeSearchResult(null, 'navigation', 'calendar', 'calendar-section')">
                    <div class="search-result-icon"><i class="fas fa-calendar-day"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${escapeHtml(event.title)}</div>
                        <div class="search-result-description">${escapeHtml(event.description || (event.date ? new Date(event.date).toLocaleDateString() : ''))}</div>
                    </div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    if (results.teammates.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-section-title"><i class="fas fa-users"></i> Team Members</div>';
        results.teammates.forEach(member => {
            html += `
                <div class="search-result-item" data-index="${resultIndex}" data-type="navigation" onclick="executeSearchResult(null, 'navigation', 'team', 'team-section')">
                    <div class="search-result-icon"><i class="fas fa-user"></i></div>
                    <div class="search-result-content">
                        <div class="search-result-title">${escapeHtml(member.displayName)}</div>
                        <div class="search-result-description">${escapeHtml(member.email)}</div>
                    </div>
                </div>
            `;
            resultIndex++;
        });
        html += '</div>';
    }

    // No results message
    if (html === '') {
        html = `
            <div class="search-no-results">
                <i class="fas fa-search" style="font-size: 28px; opacity: 0.3; margin-bottom: 12px;"></i>
                <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">No results found</div>
                <div style="font-size: 12px; opacity: 0.7;">Try a different search term</div>
            </div>
        `;
    }

    searchResults.innerHTML = html;
    showSearchDropdown();
    
    // Add hover listeners to sync with keyboard navigation
    const items = searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        item.addEventListener('mouseenter', () => {
            searchActiveIndex = index;
            updateSearchActiveItem(items);
        });
    });
}

// ===================================
// SETTINGS & USER MENU
// ===================================
function initSettings() {
    // Initialize account settings form
    loadAccountSettings();
    
    // Setup color picker
    setupAvatarColorPicker();
    
    // Setup form submission
    const settingsForm = document.getElementById('accountSettingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', saveAccountSettings);
    }
    
    // Initialize chat appearance settings
    initChatAppearanceForm();
    
    // Initialize animation settings
    initAnimationsForm();
    
    // Initialize notification settings
    initNotificationForm();
    
    // Initialize appearance settings (dark mode)
    initAppearanceForm();
    
    // Initialize accent color settings
    initAccentColorPicker();
    
    // Initialize inline avatar upload button (UX Polish: moved from separate card)
    initInlineAvatarUpload();
}

// Initialize inline avatar upload (below color picker)
function initInlineAvatarUpload() {
    const uploadBtn = document.getElementById('uploadAvatarBtnInline');
    const fileInput = document.getElementById('avatarFileInputInline');
    
    if (!uploadBtn || !fileInput) return;
    
    // Trigger file input when button clicked
    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Handle file selection
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            showToast('Image must be under 2MB', 'error');
            fileInput.value = '';
            return;
        }
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file', 'error');
            fileInput.value = '';
            return;
        }
        
        // Show loading state
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        uploadBtn.disabled = true;
        
        try {
            // For now, show a placeholder message since Firebase Storage may not be set up
            // In production, this would call uploadUserAvatar(file)
            showToast('Avatar upload feature requires Firebase Storage setup', 'info');
            
            // Reset button
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        } catch (error) {
            console.error('Avatar upload error:', error);
            showToast('Failed to upload avatar', 'error');
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        }
    });
}

// Load current account settings
async function loadAccountSettings() {
    if (!currentAuthUser) {
        debugLog('No authenticated user');
        return;
    }
    
    try {
        // Get user data from Firestore
        let userData = {
            displayName: currentAuthUser.displayName || currentAuthUser.email.split('@')[0],
            email: currentAuthUser.email,
            jobTitle: '',
            avatarColor: '#0078D4'
        };
        
        if (db && appState.currentTeamId) {
            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            
            // Get user settings from users collection
            const userRef = doc(db, 'users', currentAuthUser.uid);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
                const data = userDoc.data();
                userData.jobTitle = data.jobTitle || '';
                userData.avatarColor = data.avatarColor || '#0078D4';
                userData.displayName = data.displayName || userData.displayName;
            }
        }
        
        // Update form fields
        document.getElementById('settingsDisplayName').value = userData.displayName;
        document.getElementById('settingsEmail').value = userData.email;
        document.getElementById('settingsJobTitle').value = userData.jobTitle;
        document.getElementById('settingsAvatarColor').value = userData.avatarColor;
        
        // Update preview
        updateProfilePreview(userData);
        
        // Update sidebar profile to match settings
        updateSidebarProfile(userData.displayName, userData.avatarColor);
        
        // Select the color option
        selectColorOption(userData.avatarColor);
        
    } catch (error) {
        console.error('Error loading account settings:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// Update profile preview
function updateProfilePreview(userData) {
    const previewName = document.getElementById('profilePreviewName');
    const previewEmail = document.getElementById('profilePreviewEmail');
    const avatarPreview = document.getElementById('profileAvatarPreview');
    const avatarText = document.getElementById('profileAvatarText');
    
    if (previewName) previewName.textContent = userData.displayName;
    if (previewEmail) previewEmail.textContent = userData.email;
    
    // Update avatar
    const initials = generateAvatar(userData.displayName);
    if (avatarText) avatarText.textContent = initials;
    
    // Get lighter color for gradient
    const darkerColor = shadeColor(userData.avatarColor, -20);
    if (avatarPreview) {
        avatarPreview.style.background = `linear-gradient(135deg, ${userData.avatarColor} 0%, ${darkerColor} 100%)`;
    }
}

// Setup avatar color picker - supports both old (.color-option) and new (.color-circle) styles
function setupAvatarColorPicker() {
    const colorOptions = document.querySelectorAll('.color-option, .color-circle');
    
    colorOptions.forEach(option => {
        option.addEventListener('click', function() {
            // Remove selected class from all
            colorOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selected class to clicked option
            this.classList.add('selected');
            
            // Update hidden input
            const color = this.getAttribute('data-color');
            document.getElementById('settingsAvatarColor').value = color;
            
            // Update preview
            const userData = {
                displayName: document.getElementById('settingsDisplayName').value,
                email: document.getElementById('settingsEmail').value,
                avatarColor: color
            };
            updateProfilePreview(userData);
        });
    });
}

// Select color option - supports both old (.color-option) and new (.color-circle) styles
function selectColorOption(color) {
    const colorOptions = document.querySelectorAll('.color-option, .color-circle');
    colorOptions.forEach(option => {
        if (option.getAttribute('data-color') === color) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}

// Shade color (darken or lighten)
function shadeColor(color, percent) {
    const num = parseInt(color.replace("#",""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 +
        (G<255?G<1?0:G:255)*0x100 +
        (B<255?B<1?0:B:255))
        .toString(16).slice(1);
}

// Save account settings
async function saveAccountSettings(e) {
    e.preventDefault();
    
    if (!currentAuthUser || !db) {
        alert('Cannot save settings. Please sign in again.');
        return;
    }
    
    if (DEBUG) console.log('💾 Saving account settings for user');
    
    const displayName = document.getElementById('settingsDisplayName').value.trim();
    const jobTitle = document.getElementById('settingsJobTitle').value.trim();
    const avatarColor = document.getElementById('settingsAvatarColor').value;
    
    if (!displayName) {
        alert('Display name is required');
        return;
    }
    
    debugLog('📝 Settings to save:', { displayName, jobTitle, avatarColor });
    
    try {
        const { doc, setDoc, updateDoc, getDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        debugLog('🔥 Updating user document...');
        debugLog('📍 Document path: users/' + currentAuthUser.uid);
        
        // Check if user document exists first
        const userRef = doc(db, 'users', currentAuthUser.uid);
        debugLog('📄 UserRef:', userRef);
        
        // Try to read first to verify permissions
        try {
            const userDoc = await getDoc(userRef);
            debugLog('📖 User document exists:', userDoc.exists());
            if (userDoc.exists()) {
                debugLog('📋 Current user data:', userDoc.data());
            }
        } catch (readError) {
            console.error('❌ Error reading user document:', readError.code || readError.message);
            debugError('Full error:', readError);
        }
        
        const userData = {
            displayName: displayName,
            email: currentAuthUser.email,
            jobTitle: jobTitle,
            avatarColor: avatarColor,
            updatedAt: serverTimestamp()
        };
        
        debugLog('📤 Writing to Firestore:', userData);
        await setDoc(userRef, userData, { merge: true });
        
        debugLog('✅ User document updated successfully');
        
        // Sync public profile for teammate visibility
        await syncPublicProfile({
            displayName: displayName,
            email: currentAuthUser.email,
            photoURL: currentAuthUser.photoURL || null,
            occupation: jobTitle || null
        });
        
        // Note: Team member display names will update automatically when loadTeammatesFromFirestore()
        // fetches user documents - no need to update team document directly
        
        // Update sidebar display
        updateSidebarProfile(displayName, avatarColor);
        
        debugLog('🔄 Reloading team members and section...');
        
        // Reload team members display
        await loadTeammatesFromFirestore();
        await initTeamSection();
        
        debugLog('✅ Team section refreshed with updated profile');
        
        // Show success message
        showSuccessMessage('Settings saved successfully!');
        // ===============================
        // Avatar Settings UI Logic
        // ===============================
        function initAvatarSettings() {
            const previewEl = document.getElementById('avatarSettingsPreview');
            const uploadBtn = document.getElementById('uploadAvatarBtn');
            const fileInput = document.getElementById('avatarFileInput');
            if (!previewEl || !uploadBtn || !fileInput) return;

            // Render current avatar (image or initials)
            function renderAvatarPreview() {
                previewEl.innerHTML = '';
                const user = appState.currentUser;
                if (user && user.avatarUrl) {
                    const img = document.createElement('img');
                    img.src = user.avatarUrl;
                    img.alt = `Avatar of ${user.displayName || user.email || 'user'}`;
                    img.style.width = '72px';
                    img.style.height = '72px';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.onerror = function() {
                        img.style.display = 'none';
                        renderInitialsAvatar();
                    };
                    previewEl.appendChild(img);
                } else {
                    renderInitialsAvatar();
                }
            }
            function renderInitialsAvatar() {
                const user = appState.currentUser;
                const initials = generateAvatar(user.displayName || user.email || 'U');
                const avatarDiv = document.createElement('div');
                avatarDiv.textContent = initials;
                avatarDiv.style.width = '72px';
                avatarDiv.style.height = '72px';
                avatarDiv.style.borderRadius = '50%';
                avatarDiv.style.background = `linear-gradient(135deg, ${user.avatarColor || '#0078D4'} 0%, ${shadeColor(user.avatarColor || '#0078D4', -20)} 100%)`;
                avatarDiv.style.color = 'white';
                avatarDiv.style.display = 'flex';
                avatarDiv.style.alignItems = 'center';
                avatarDiv.style.justifyContent = 'center';
                avatarDiv.style.fontSize = '2rem';
                avatarDiv.style.fontWeight = '700';
                previewEl.appendChild(avatarDiv);
            }
            renderAvatarPreview();

            // Button triggers file input
            uploadBtn.onclick = () => fileInput.click();

            // Handle file selection and upload
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                uploadBtn.disabled = true;
                uploadBtn.textContent = 'Uploading…';
                try {
                    const url = await uploadUserAvatar(file);
                    renderAvatarPreview();
                    showToast('Avatar updated.', 'success');
                } catch (err) {
                    showToast(err.message || 'Failed to upload avatar.', 'error');
                }
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload new avatar';
                fileInput.value = '';
            };
        }
        
        console.log('✅ Account settings saved');
        
    } catch (error) {
        console.error('❌ Error saving account settings:', error.code || error.message);
        showToast('Error saving settings. Please try again.', 'error', 5000, 'Save Failed');
    }
}

// Update sidebar profile
function updateSidebarProfile(displayName, avatarColor) {
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    
    if (sidebarName) {
        sidebarName.textContent = displayName;
    }
    
    if (sidebarAvatar) {
        const initials = generateAvatar(displayName);
        const darkerColor = shadeColor(avatarColor, -20);
        
        // Clear any existing content (like default icon)
        sidebarAvatar.innerHTML = '';
        
        // Apply styles
        sidebarAvatar.style.background = `linear-gradient(135deg, ${avatarColor} 0%, ${darkerColor} 100%)`;
        sidebarAvatar.style.color = 'white';
        sidebarAvatar.style.display = 'flex';
        sidebarAvatar.style.alignItems = 'center';
        sidebarAvatar.style.justifyContent = 'center';
        sidebarAvatar.style.fontSize = '16px';
        sidebarAvatar.style.fontWeight = '700';
        
        // Set the initials
        sidebarAvatar.textContent = initials;
    }
}

// Show success message
function showSuccessMessage(message) {
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
    `;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add animations to CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Cancel settings (reload original values)
window.cancelSettings = function() {
    loadAccountSettings();
    showSuccessMessage('Changes cancelled');
};

// Open settings from profile click
window.openSettings = function() {
    // Switch to settings section
    const settingsNav = document.querySelector('[data-section="settings"]');
    if (settingsNav) {
        settingsNav.click();
    }
};

// ===================================
// CHAT APPEARANCE SETTINGS
// ===================================

// Default chat preferences
const defaultChatPreferences = {
    showAvatars: true,
    compactMode: false,
    timestampsStyle: 'inline',
    bubbleStyle: 'filled'
};

// Load chat appearance settings
async function loadChatAppearanceSettings() {
    if (!currentAuthUser || !db) {
        return defaultChatPreferences;
    }
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            const chatPrefs = data.preferences?.chat || {};
            
            // Merge with defaults
            return {
                showAvatars: chatPrefs.showAvatars !== undefined ? chatPrefs.showAvatars : defaultChatPreferences.showAvatars,
                compactMode: chatPrefs.compactMode !== undefined ? chatPrefs.compactMode : defaultChatPreferences.compactMode,
                timestampsStyle: chatPrefs.timestampsStyle || defaultChatPreferences.timestampsStyle,
                bubbleStyle: chatPrefs.bubbleStyle || defaultChatPreferences.bubbleStyle
            };
        }
    } catch (error) {
        console.error('Error loading chat preferences:', error);
    }
    
    return defaultChatPreferences;
}

// Apply chat appearance settings to UI
function applyChatAppearance(preferences) {
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) return;
    
    console.log('Applying chat preferences:', preferences);
    
    // Show/hide avatars
    if (preferences.showAvatars) {
        chatContainer.classList.remove('chat-hide-avatars');
    } else {
        chatContainer.classList.add('chat-hide-avatars');
    }
    
    // Compact mode
    if (preferences.compactMode) {
        chatContainer.classList.add('chat-compact');
    } else {
        chatContainer.classList.remove('chat-compact');
    }
    
    // Timestamp style
    chatContainer.classList.remove('timestamp-inline', 'timestamp-subtle');
    chatContainer.classList.add(`timestamp-${preferences.timestampsStyle}`);
    
    // Bubble style
    if (preferences.bubbleStyle === 'minimal') {
        chatContainer.classList.add('bubble-style-minimal');
    } else {
        chatContainer.classList.remove('bubble-style-minimal');
    }
}

// Initialize chat appearance form
function initChatAppearanceForm() {
    const form = document.getElementById('chatAppearanceForm');
    if (!form) return;
    
    // Load and apply current preferences
    loadChatAppearanceSettings().then(preferences => {
        // Set form values
        document.getElementById('chatShowAvatars').checked = preferences.showAvatars;
        document.getElementById('chatCompactMode').checked = preferences.compactMode;
        
        const timestampRadios = document.querySelectorAll('input[name="timestampStyle"]');
        timestampRadios.forEach(radio => {
            if (radio.value === preferences.timestampsStyle) {
                radio.checked = true;
            }
        });
        
        const bubbleRadios = document.querySelectorAll('input[name="bubbleStyle"]');
        bubbleRadios.forEach(radio => {
            if (radio.value === preferences.bubbleStyle) {
                radio.checked = true;
            }
        });
        
        // Apply to chat UI
        applyChatAppearance(preferences);
    });
    
    // Auto-save on toggle changes
    document.getElementById('chatShowAvatars').addEventListener('change', () => saveChatAppearanceSettings());
    document.getElementById('chatCompactMode').addEventListener('change', () => saveChatAppearanceSettings());
    
    // Auto-save on radio changes
    const timestampRadios = document.querySelectorAll('input[name="timestampStyle"]');
    timestampRadios.forEach(radio => {
        radio.addEventListener('change', () => saveChatAppearanceSettings());
    });
    
    const bubbleRadios = document.querySelectorAll('input[name="bubbleStyle"]');
    bubbleRadios.forEach(radio => {
        radio.addEventListener('change', () => saveChatAppearanceSettings());
    });
}

// Save chat appearance settings
async function saveChatAppearanceSettings() {
    if (!currentAuthUser || !db) {
        alert('Cannot save preferences. Please sign in again.');
        return;
    }
    
    const preferences = {
        showAvatars: document.getElementById('chatShowAvatars').checked,
        compactMode: document.getElementById('chatCompactMode').checked,
        timestampsStyle: document.querySelector('input[name="timestampStyle"]:checked')?.value || 'inline',
        bubbleStyle: document.querySelector('input[name="bubbleStyle"]:checked')?.value || 'filled'
    };
    
    console.log('Saving chat preferences:', preferences);
    
    try {
        await updateUserPreferences({ chat: preferences });
        
        // Apply to UI immediately
        applyChatAppearance(preferences);
    } catch (error) {
        console.error('Error saving chat preferences:', error);
        showToast('Error saving preferences. Please try again.', 'error', 5000, 'Save Failed');
    }
}

// Update user preferences helper function
async function updateUserPreferences(preferences) {
    if (!currentAuthUser || !db) {
        throw new Error('Not authenticated');
    }
    
    const { doc, setDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
    const userRef = doc(db, 'users', currentAuthUser.uid);
    
    // Get existing preferences
    const userDoc = await getDoc(userRef);
    const existingPrefs = userDoc.exists() ? (userDoc.data().preferences || {}) : {};
    
    // Merge with new preferences
    const updatedPrefs = {
        ...existingPrefs,
        ...preferences
    };
    
    // Update document
    await setDoc(userRef, { preferences: updatedPrefs }, { merge: true });
}

// Reset chat appearance to defaults
window.resetChatAppearance = function() {
    if (confirm('Reset chat appearance to defaults?')) {
        document.getElementById('chatShowAvatars').checked = defaultChatPreferences.showAvatars;
        document.getElementById('chatCompactMode').checked = defaultChatPreferences.compactMode;
        
        const timestampRadios = document.querySelectorAll('input[name="timestampStyle"]');
        timestampRadios.forEach(radio => {
            if (radio.value === defaultChatPreferences.timestampsStyle) {
                radio.checked = true;
            }
        });
        
        const bubbleRadios = document.querySelectorAll('input[name="bubbleStyle"]');
        bubbleRadios.forEach(radio => {
            if (radio.value === defaultChatPreferences.bubbleStyle) {
                radio.checked = true;
            }
        });
        
        applyChatAppearance(defaultChatPreferences);
        showSuccessMessage('Reset to defaults');
    }
};

// ===================================
// APPEARANCE SETTINGS (DARK MODE)
// ===================================

// Initialize appearance form
function initAppearanceForm() {
    const form = document.getElementById('appearanceForm');
    if (!form) return;
    
    // Load dark mode from localStorage first
    let localDark = localStorage.getItem('darkMode');
    if (localDark !== null) {
        localDark = localDark === 'true';
        document.getElementById('darkModeToggle').checked = localDark;
        applyDarkMode(localDark);
    }
    // Then load from Firestore and override if set
    loadDarkModePreference().then(isDark => {
        document.getElementById('darkModeToggle').checked = isDark;
        applyDarkMode(isDark);
        localStorage.setItem('darkMode', isDark ? 'true' : 'false');
    });

    // Auto-save on toggle change
    document.getElementById('darkModeToggle').addEventListener('change', async (e) => {
        applyDarkMode(e.target.checked);
        localStorage.setItem('darkMode', e.target.checked ? 'true' : 'false');
        await saveDarkModePreference();
    });
}

// Load dark mode preference
async function loadDarkModePreference() {
    if (!currentAuthUser || !db) {
        return false;
    }
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            return userDoc.data().preferences?.appearance?.darkMode || false;
        }
        
        return false;
    } catch (error) {
        console.error('Error loading dark mode preference:', error);
        return false;
    }
}

// Apply dark mode
function applyDarkMode(isDark) {
    if (isDark) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    // Also update settings cards immediately
    document.querySelectorAll('.settings-card').forEach(card => {
        if (isDark) {
            card.classList.add('dark-mode');
        } else {
            card.classList.remove('dark-mode');
        }
    });
}

// Save dark mode preference
async function saveDarkModePreference() {
    if (!currentAuthUser || !db) {
        alert('Cannot save preferences. Please sign in again.');
        return;
    }
    
    const isDark = document.getElementById('darkModeToggle').checked;
    
    try {
        await updateUserPreferences({ 
            appearance: { 
                darkMode: isDark 
            } 
        });
        
        applyDarkMode(isDark);
    } catch (error) {
        console.error('Error saving dark mode preference:', error);
        showToast('Error saving preferences. Please try again.', 'error', 5000, 'Save Failed');
    }
}

// ===================================
// ACCENT COLOR SETTINGS
// ===================================

// Apply accent color theme
function applyAccentColor(accentName, colorData) {
    const isDark = document.body.classList.contains('dark-mode');
    const root = document.documentElement;
    
    // Apply the appropriate colors based on light/dark mode
    if (isDark) {
        root.style.setProperty('--accent', colorData.dark);
        root.style.setProperty('--accent-hover', colorData.darkHover);
        root.style.setProperty('--accent-soft', colorData.darkSoft);
    } else {
        root.style.setProperty('--accent', colorData.color);
        root.style.setProperty('--accent-hover', colorData.hover);
        root.style.setProperty('--accent-soft', colorData.soft);
    }
    
    // Also update the primary-blue alias for backward compatibility
    root.style.setProperty('--primary-blue', isDark ? colorData.dark : colorData.color);
    root.style.setProperty('--primary-dark', isDark ? colorData.darkHover : colorData.hover);
}

// Initialize accent color picker
function initAccentColorPicker() {
    const picker = document.getElementById('accentColorPicker');
    if (!picker) return;
    
    // Load saved accent from localStorage first for instant load
    const savedAccent = localStorage.getItem('accentColor') || 'blue';
    
    // Select the saved option and apply colors
    picker.querySelectorAll('.accent-color-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.dataset.accent === savedAccent) {
            opt.classList.add('selected');
            applyAccentColor(savedAccent, {
                color: opt.dataset.color,
                hover: opt.dataset.hover,
                soft: opt.dataset.soft,
                dark: opt.dataset.dark,
                darkHover: opt.dataset.darkHover,
                darkSoft: opt.dataset.darkSoft
            });
        }
    });
    
    // Load from Firestore and override if set
    loadAccentColorPreference().then(accentData => {
        if (accentData && accentData.name) {
            const option = picker.querySelector(`[data-accent="${accentData.name}"]`);
            if (option) {
                picker.querySelectorAll('.accent-color-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                applyAccentColor(accentData.name, accentData);
                localStorage.setItem('accentColor', accentData.name);
            }
        }
    });
    
    // Add click handlers for each color option
    picker.querySelectorAll('.accent-color-option').forEach(option => {
        option.addEventListener('click', async () => {
            // Update selected state
            picker.querySelectorAll('.accent-color-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            // Get color data from data attributes
            const accentName = option.dataset.accent;
            const colorData = {
                name: accentName,
                color: option.dataset.color,
                hover: option.dataset.hover,
                soft: option.dataset.soft,
                dark: option.dataset.dark,
                darkHover: option.dataset.darkHover,
                darkSoft: option.dataset.darkSoft
            };
            
            // Apply instantly
            applyAccentColor(accentName, colorData);
            
            // Save to localStorage for instant load next time
            localStorage.setItem('accentColor', accentName);
            
            // Save to Firestore
            await saveAccentColorPreference(colorData);
            
            showToast('Accent color updated', 'success');
        });
    });
    
    // Listen for dark mode changes to re-apply accent with correct dark/light variant
    const darkModeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                const selectedOption = picker.querySelector('.accent-color-option.selected');
                if (selectedOption) {
                    applyAccentColor(selectedOption.dataset.accent, {
                        color: selectedOption.dataset.color,
                        hover: selectedOption.dataset.hover,
                        soft: selectedOption.dataset.soft,
                        dark: selectedOption.dataset.dark,
                        darkHover: selectedOption.dataset.darkHover,
                        darkSoft: selectedOption.dataset.darkSoft
                    });
                }
            }
        });
    });
    darkModeObserver.observe(document.body, { attributes: true });
}

// Load accent color preference from Firestore
async function loadAccentColorPreference() {
    if (!currentAuthUser || !db) {
        return null;
    }
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            return userDoc.data().preferences?.style?.accentColor || null;
        }
        
        return null;
    } catch (error) {
        console.error('Error loading accent color preference:', error);
        return null;
    }
}

// Save accent color preference to Firestore
async function saveAccentColorPreference(colorData) {
    if (!currentAuthUser || !db) {
        console.warn('Cannot save accent preference - not logged in');
        return;
    }
    
    try {
        await updateUserPreferences({ 
            style: { 
                accentColor: colorData 
            } 
        });
    } catch (error) {
        console.error('Error saving accent color preference:', error);
    }
}

// Apply accent color early (before page fully loads) from localStorage
function applyAccentColorEarly() {
    const savedAccent = localStorage.getItem('accentColor');
    if (!savedAccent || savedAccent === 'blue') return; // Default blue, no need to change
    
    const accentPresets = {
        blue: { color: '#0070F3', hover: '#0051CC', soft: 'rgba(0, 112, 243, 0.12)', dark: '#0A84FF', darkHover: '#0070F3', darkSoft: 'rgba(10, 132, 255, 0.15)' },
        purple: { color: '#AF52DE', hover: '#9340C7', soft: 'rgba(175, 82, 222, 0.12)', dark: '#BF5AF2', darkHover: '#AF52DE', darkSoft: 'rgba(191, 90, 242, 0.15)' },
        green: { color: '#34C759', hover: '#2DB04E', soft: 'rgba(52, 199, 89, 0.12)', dark: '#32D74B', darkHover: '#34C759', darkSoft: 'rgba(50, 215, 75, 0.15)' },
        orange: { color: '#FF9500', hover: '#E68600', soft: 'rgba(255, 149, 0, 0.12)', dark: '#FF9F0A', darkHover: '#FF9500', darkSoft: 'rgba(255, 159, 10, 0.15)' },
        pink: { color: '#FF2D55', hover: '#E6264D', soft: 'rgba(255, 45, 85, 0.12)', dark: '#FF375F', darkHover: '#FF2D55', darkSoft: 'rgba(255, 55, 95, 0.15)' },
        teal: { color: '#00C7BE', hover: '#00ADA6', soft: 'rgba(0, 199, 190, 0.12)', dark: '#64D2FF', darkHover: '#00C7BE', darkSoft: 'rgba(100, 210, 255, 0.15)' }
    };
    
    const preset = accentPresets[savedAccent];
    if (preset) {
        const isDark = localStorage.getItem('darkMode') === 'true';
        const root = document.documentElement;
        
        if (isDark) {
            root.style.setProperty('--accent', preset.dark);
            root.style.setProperty('--accent-hover', preset.darkHover);
            root.style.setProperty('--accent-soft', preset.darkSoft);
        } else {
            root.style.setProperty('--accent', preset.color);
            root.style.setProperty('--accent-hover', preset.hover);
            root.style.setProperty('--accent-soft', preset.soft);
        }
        root.style.setProperty('--primary-blue', isDark ? preset.dark : preset.color);
        root.style.setProperty('--primary-dark', isDark ? preset.darkHover : preset.hover);
    }
}

// Call early application
applyAccentColorEarly();

// ===================================
// ANIMATION SETTINGS
// ===================================

// Default animation preference
const defaultAnimationsEnabled = true;

// Load animation preference
async function loadAnimationPreference() {
    if (!currentAuthUser || !db) {
        // Check system preference as fallback
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return !prefersReducedMotion;
    }
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            const animationsEnabled = data.preferences?.ui?.animationsEnabled;
            
            // If user hasn't set preference, check system preference
            if (animationsEnabled === undefined) {
                const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                return !prefersReducedMotion;
            }
            
            return animationsEnabled;
        }
    } catch (error) {
        console.error('Error loading animation preference:', error);
    }
    
    // Default to enabled
    return defaultAnimationsEnabled;
}

// Apply animation preference to DOM
function applyAnimationPreference(enabled) {
    console.log('Applying animation preference:', enabled);
    
    if (enabled) {
        document.body.classList.remove('no-animations');
    } else {
        document.body.classList.add('no-animations');
    }
}

// Initialize animations form
function initAnimationsForm() {
    const form = document.getElementById('animationsForm');
    if (!form) return;
    
    // Load and apply current preference
    loadAnimationPreference().then(enabled => {
        document.getElementById('enableAnimations').checked = enabled;
        applyAnimationPreference(enabled);
    });
    
    // Auto-save when toggle changes
    const toggle = document.getElementById('enableAnimations');
    if (toggle) {
        toggle.addEventListener('change', async () => {
            applyAnimationPreference(toggle.checked);
            await saveAnimationPreference();
        });
    }
}

// Save animation preference
async function saveAnimationPreference() {
    if (!currentAuthUser || !db) {
        alert('Cannot save preferences. Please sign in again.');
        return;
    }
    
    const enabled = document.getElementById('enableAnimations').checked;
    
    console.log('Saving animation preference:', enabled);
    
    try {
        await updateUserPreferences({ ui: { animationsEnabled: enabled } });
        
        // Apply to UI immediately
        applyAnimationPreference(enabled);
    } catch (error) {
        console.error('Error saving animation preference:', error);
        showToast('Error saving preferences. Please try again.', 'error', 5000, 'Save Failed');
    }
}

// ===================================
// NOTIFICATION PREFERENCES
// ===================================

// Default notification preferences structure
// Used for new users and as fallback
const defaultNotificationPreferences = {
    tasks: {
        assignedToMe: true,
        taskUpdated: true,
        taskCompleted: false
    },
    chat: {
        mentions: true,
        replies: true
    },
    team: {
        newMembers: true,
        teamChanges: false
    }
};

// Cache for current user's notification preferences
let cachedNotificationPreferences = null;

// Update settings visibility based on user role
function updateSettingsVisibility() {
    const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    const hasTeam = !!appState.currentTeamId;
    
    // Owner-only settings
    const deleteChatHistorySection = document.getElementById('deleteChatHistorySection');
    if (deleteChatHistorySection) {
        deleteChatHistorySection.style.display = (currentUserRole === 'owner' && hasTeam) ? 'block' : 'none';
    }
    
    // Metrics settings (owner only)
    const metricsSettingsCard = document.getElementById('metricsSettingsCard');
    if (metricsSettingsCard) {
        metricsSettingsCard.style.display = (currentUserRole === 'owner' && hasTeam) ? 'block' : 'none';
        // Initialize the form with current value
        if (currentUserRole === 'owner' && hasTeam) {
            initMetricsVisibilityForm();
        }
    }
    
    // Finances settings (owner only)
    const financesSettingsCard = document.getElementById('financesSettingsCard');
    if (financesSettingsCard) {
        financesSettingsCard.style.display = (currentUserRole === 'owner' && hasTeam) ? 'block' : 'none';
        // Initialize the form with current value
        if (currentUserRole === 'owner' && hasTeam) {
            initFinancesVisibilityForm();
        }
    }
    
    // Admin/Owner settings
    const advancedSettingsCard = document.getElementById('settings-chat-appearance-section');
    const animationsSettingsCard = document.getElementById('animationsSettingsCard');
    const isAdminOrOwner = (currentUserRole === 'admin' || currentUserRole === 'owner') && hasTeam;
    
    if (advancedSettingsCard) {
        advancedSettingsCard.style.display = isAdminOrOwner ? 'block' : 'none';
    }
    if (animationsSettingsCard) {
        animationsSettingsCard.style.display = isAdminOrOwner ? 'block' : 'none';
    }
}

// ===================================
// METRICS VISIBILITY SETTINGS
// ===================================

/**
 * Initialize the metrics visibility form with current setting
 */
function initMetricsVisibilityForm() {
    const form = document.getElementById('metricsVisibilityForm');
    if (!form) return;
    
    // Get current setting from appState
    const currentSetting = appState.metricsVisibility || 'owner-only';
    
    // Select the correct radio button
    const radio = form.querySelector(`input[name="metricsVisibility"][value="${currentSetting}"]`);
    if (radio) {
        radio.checked = true;
    }
    
    // Remove existing listener and add new one
    form.removeEventListener('submit', handleMetricsVisibilitySave);
    form.addEventListener('submit', handleMetricsVisibilitySave);
}

/**
 * Handle metrics visibility form submission
 */
async function handleMetricsVisibilitySave(event) {
    event.preventDefault();
    
    const form = event.target;
    const selectedValue = form.querySelector('input[name="metricsVisibility"]:checked')?.value;
    
    if (!selectedValue) {
        showToast('Please select a visibility option', 'error');
        return;
    }
    
    // Check if user is owner
    const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    if (currentUserRole !== 'owner') {
        showToast('Only the team owner can change metrics visibility', 'error');
        return;
    }
    
    if (!db || !appState.currentTeamId) {
        showToast('Unable to save settings. Please try again.', 'error');
        return;
    }
    
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        
        await updateDoc(teamRef, {
            'settings.metricsVisibility': selectedValue
        });
        
        // Update local state
        appState.metricsVisibility = selectedValue;
        
        // Update team data cache
        if (appState.currentTeamData) {
            if (!appState.currentTeamData.settings) {
                appState.currentTeamData.settings = {};
            }
            appState.currentTeamData.settings.metricsVisibility = selectedValue;
        }
        
        // Recompute access for all users (affects current user's view)
        const newAccess = userCanViewMetrics(appState.currentTeamData, currentAuthUser?.uid);
        const oldAccess = appState.metricsAccess;
        appState.metricsAccess = newAccess;
        
        // Update nav visibility
        updateNavVisibilityForMetrics();
        
        // If metrics tab is currently active, refresh it
        if (appState.currentSection === 'metrics') {
            if (newAccess.canAccess) {
                renderMetrics();
            } else {
                // This shouldn't happen for owner, but just in case
                showToast("Access to metrics has changed.", 'info', 3000);
                window.switchTab('activity');
            }
        }
        
        showToast('Metrics visibility settings saved', 'success');
        debugLog('📊 Metrics visibility updated to:', selectedValue);
        
    } catch (error) {
        console.error('Error saving metrics visibility:', error);
        showToast('Failed to save metrics settings', 'error');
    }
}

/**
 * Refresh metrics access and nav visibility after team data changes.
 * Call this after loading team data or when settings change.
 */
function refreshMetricsAccess() {
    if (!appState.currentTeamData || !currentAuthUser) {
        appState.metricsAccess = { canAccess: false, mode: 'none' };
        appState.metricsVisibility = 'owner-only';
    } else {
        appState.metricsVisibility = getMetricsVisibilitySetting(appState.currentTeamData);
        appState.metricsAccess = userCanViewMetrics(appState.currentTeamData, currentAuthUser.uid);
    }
    
    // Update nav visibility
    updateNavVisibilityForMetrics();
    
    // If user lost access while on metrics tab, redirect them
    if (appState.currentSection === 'metrics' && !appState.metricsAccess.canAccess) {
        showToast("Your access to metrics has been changed.", 'info', 3000);
        window.switchTab('activity');
    }
}

// ===================================
// FINANCES TAB VISIBILITY SETTINGS
// ===================================

/**
 * Initialize the finances visibility form with current settings
 */
function initFinancesVisibilityForm() {
    const form = document.getElementById('financesVisibilityForm');
    if (!form) return;
    
    // Get current settings from appState
    const isEnabled = appState.financesEnabled || false;
    const currentVisibility = appState.financesVisibility || 'owner-only';
    
    // Set the enabled toggle
    const enabledToggle = document.getElementById('financesEnabledToggle');
    if (enabledToggle) {
        enabledToggle.checked = isEnabled;
    }
    
    // Select the correct radio button
    const radio = form.querySelector(`input[name="financesVisibility"][value="${currentVisibility}"]`);
    if (radio) {
        radio.checked = true;
    }
    
    // Show/hide visibility options based on enabled state
    const visibilityOptions = document.getElementById('financesVisibilityOptions');
    if (visibilityOptions) {
        visibilityOptions.style.display = isEnabled ? 'block' : 'none';
    }
    
    // Add toggle change listener
    if (enabledToggle) {
        enabledToggle.removeEventListener('change', handleFinancesEnabledChange);
        enabledToggle.addEventListener('change', handleFinancesEnabledChange);
    }
    
    // Remove existing listener and add new one
    form.removeEventListener('submit', handleFinancesVisibilitySave);
    form.addEventListener('submit', handleFinancesVisibilitySave);
}

/**
 * Handle finances enabled toggle change
 */
function handleFinancesEnabledChange(event) {
    const visibilityOptions = document.getElementById('financesVisibilityOptions');
    if (visibilityOptions) {
        visibilityOptions.style.display = event.target.checked ? 'block' : 'none';
    }
}

/**
 * Handle finances visibility form submission
 */
async function handleFinancesVisibilitySave(event) {
    event.preventDefault();
    
    const form = event.target;
    const enabledToggle = document.getElementById('financesEnabledToggle');
    const isEnabled = enabledToggle?.checked || false;
    const selectedVisibility = form.querySelector('input[name="financesVisibility"]:checked')?.value || 'owner-only';
    
    // Check if user is owner
    const currentUserRole = appState.teammates?.find(t => t.id === currentAuthUser?.uid)?.role;
    if (currentUserRole !== 'owner') {
        showToast('Only the team owner can change finances settings', 'error');
        return;
    }
    
    if (!db || !appState.currentTeamId) {
        showToast('Unable to save settings. Please try again.', 'error');
        return;
    }
    
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        
        await updateDoc(teamRef, {
            'settings.financesEnabled': isEnabled,
            'settings.financesVisibility': selectedVisibility
        });
        
        // Update local state
        appState.financesEnabled = isEnabled;
        appState.financesVisibility = selectedVisibility;
        
        // Update team data cache
        if (appState.currentTeamData) {
            if (!appState.currentTeamData.settings) {
                appState.currentTeamData.settings = {};
            }
            appState.currentTeamData.settings.financesEnabled = isEnabled;
            appState.currentTeamData.settings.financesVisibility = selectedVisibility;
        }
        
        // Recompute access
        const newAccess = userCanViewFinances(appState.currentTeamData, currentAuthUser?.uid);
        appState.financesAccess = newAccess;
        
        // Update nav visibility
        updateNavVisibilityForFinances();
        
        // If finances tab is currently active, handle the change
        if (appState.currentSection === 'finances') {
            if (newAccess.canAccess) {
                renderFinances();
            } else {
                showToast("Access to finances has changed.", 'info', 3000);
                window.switchTab('activity');
            }
        }
        
        showToast('Finances settings saved', 'success');
        debugLog('💰 Finances settings updated:', { isEnabled, selectedVisibility });
        
    } catch (error) {
        console.error('Error saving finances settings:', error);
        showToast('Failed to save finances settings', 'error');
    }
}

/**
 * Refresh finances access and nav visibility after team data changes.
 * Call this after loading team data or when settings change.
 */
function refreshFinancesAccess() {
    if (!appState.currentTeamData || !currentAuthUser) {
        appState.financesAccess = { canAccess: false, mode: 'none' };
        appState.financesEnabled = false;
        appState.financesVisibility = 'owner-only';
    } else {
        appState.financesEnabled = getFinancesEnabledSetting(appState.currentTeamData);
        appState.financesVisibility = getFinancesVisibilitySetting(appState.currentTeamData);
        appState.financesAccess = userCanViewFinances(appState.currentTeamData, currentAuthUser.uid);
    }
    
    // Update nav visibility
    updateNavVisibilityForFinances();
    
    // If user lost access while on finances tab, redirect them
    if (appState.currentSection === 'finances' && !appState.financesAccess.canAccess) {
        showToast("Your access to finances has been changed.", 'info', 3000);
        window.switchTab('activity');
    }
}

// Load notification preferences from Firestore
// Returns merged preferences (defaults + user overrides)
async function loadNotificationPreferences() {
    if (!currentAuthUser || !db) {
        return { ...defaultNotificationPreferences };
    }
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const userRef = doc(db, 'users', currentAuthUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const data = userDoc.data();
            const savedPrefs = data.preferences?.notificationPreferences || {};
            
            // Deep merge: defaults + saved preferences
            // This ensures new preference keys are added for existing users
            cachedNotificationPreferences = {
                tasks: { ...defaultNotificationPreferences.tasks, ...savedPrefs.tasks },
                chat: { ...defaultNotificationPreferences.chat, ...savedPrefs.chat },
                team: { ...defaultNotificationPreferences.team, ...savedPrefs.team }
            };
            
            return cachedNotificationPreferences;
        }
        
        cachedNotificationPreferences = { ...defaultNotificationPreferences };
        return cachedNotificationPreferences;
    } catch (error) {
        console.error('Error loading notification preferences:', error);
        return { ...defaultNotificationPreferences };
    }
}

// Get cached notification preferences (synchronous)
// Falls back to defaults if cache is empty
function getNotificationPreferences() {
    return cachedNotificationPreferences || { ...defaultNotificationPreferences };
}

// Initialize notification preferences form
// Sets up toggles and event listeners
async function initNotificationForm() {
    const form = document.getElementById('notificationsForm');
    if (!form) return;
    
    const preferences = await loadNotificationPreferences();
    
    // Map of toggle IDs to preference paths
    const toggleMap = {
        'notifTaskAssigned': { category: 'tasks', key: 'assignedToMe' },
        'notifTaskUpdated': { category: 'tasks', key: 'taskUpdated' },
        'notifTaskCompleted': { category: 'tasks', key: 'taskCompleted' },
        'notifChatMentions': { category: 'chat', key: 'mentions' },
        'notifChatReplies': { category: 'chat', key: 'replies' },
        'notifTeamMembers': { category: 'team', key: 'newMembers' },
        'notifTeamChanges': { category: 'team', key: 'teamChanges' }
    };
    
    // Initialize each toggle with saved value and add change listener
    Object.entries(toggleMap).forEach(([toggleId, { category, key }]) => {
        const toggle = document.getElementById(toggleId);
        if (toggle) {
            // Set initial state from preferences
            toggle.checked = preferences[category]?.[key] ?? defaultNotificationPreferences[category][key];
            
            // Add change listener for instant save
            toggle.addEventListener('change', async () => {
                await saveNotificationPreference(category, key, toggle.checked);
            });
        }
    });
}

// Save a single notification preference
// Updates Firestore and local cache
async function saveNotificationPreference(category, key, value) {
    if (!currentAuthUser || !db) {
        showToast('Cannot save preferences. Please sign in again.', 'error');
        return;
    }
    
    try {
        // Update local cache first for responsive UI
        if (!cachedNotificationPreferences) {
            cachedNotificationPreferences = { ...defaultNotificationPreferences };
        }
        if (!cachedNotificationPreferences[category]) {
            cachedNotificationPreferences[category] = {};
        }
        cachedNotificationPreferences[category][key] = value;
        
        // Save to Firestore
        await updateUserPreferences({ 
            notificationPreferences: cachedNotificationPreferences 
        });
        
        debugLog(`✅ Notification preference saved: ${category}.${key} = ${value}`);
    } catch (error) {
        console.error('Error saving notification preference:', error);
        showToast('Error saving preference. Please try again.', 'error');
    }
}

// Check if a notification should be shown based on user preferences
// activityType: 'task', 'message', 'team', 'calendar'
// activityContext: additional context like 'assigned', 'completed', 'mention', etc.
function shouldShowNotification(activityType, activityContext = {}) {
    const prefs = getNotificationPreferences();
    
    switch (activityType) {
        case 'task':
            // Check specific task notification types
            if (activityContext.isAssignment) {
                return prefs.tasks?.assignedToMe !== false;
            }
            if (activityContext.isCompletion) {
                return prefs.tasks?.taskCompleted !== false;
            }
            // Default: task updates
            return prefs.tasks?.taskUpdated !== false;
            
        case 'message':
            // Check specific chat notification types
            if (activityContext.isMention) {
                return prefs.chat?.mentions !== false;
            }
            if (activityContext.isReply) {
                return prefs.chat?.replies !== false;
            }
            // Default: show all chat (can be extended later)
            return true;
            
        case 'team':
            // Check specific team notification types
            if (activityContext.isNewMember) {
                return prefs.team?.newMembers !== false;
            }
            if (activityContext.isSettingsChange) {
                return prefs.team?.teamChanges !== false;
            }
            // Default: show team activity
            return true;
            
        case 'calendar':
            // Calendar notifications always shown (could add preferences later)
            return true;
            
        default:
            return true;
    }
}

// ===================================
// TEAM MEMBERS REAL-TIME LISTENER
// ===================================

let teamMembersUnsubscribe = null;
let userProfileUnsubscribes = []; // Array of unsubscribe functions for user profile listeners

// Start listening for team member changes (name updates, role changes, etc.)
async function startTeamMembersListener() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        return;
    }
    
    // Clean up existing listeners
    stopTeamMembersListener();
    
    try {
        const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        
        // Listen for changes to team document (includes member list and member info)
        teamMembersUnsubscribe = onSnapshot(teamRef, async (docSnapshot) => {
            if (!docSnapshot.exists()) return;
            
            const teamData = docSnapshot.data();
            const members = teamData.members || {};
            
            // Update team data in appState
            appState.currentTeamData = teamData;
            
            // Set up listeners for each team member's user profile
            setupUserProfileListeners(Object.keys(members));
            
            // Reload teammates with latest data from user profiles
            await loadTeammatesFromFirestore();
            
            // Update UI elements that show team member info
            populateTaskAssigneeDropdown();
            
            debugLog('🔄 Team members updated in real-time');
        }, (error) => {
            // Handle Firestore listener errors (permission-denied, network issues, etc.)
            if (error.code === 'permission-denied') {
                debugLog('⚠️ Team members listener: permission denied');
            } else if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ Team members listener temporarily unavailable, will auto-retry');
            } else {
                console.error('Error in team members listener:', error.code || error.message);
            }
        });
        
        debugLog('👥 Team members listener started');
    } catch (error) {
        console.error('Error setting up team members listener:', error);
    }
}

// Set up listeners for individual user profile changes
async function setupUserProfileListeners(memberUserIds) {
    if (!db || !memberUserIds || memberUserIds.length === 0) return;
    
    try {
        const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Clear old user profile listeners
        userProfileUnsubscribes.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        userProfileUnsubscribes = [];
        
        // Set up listener for each team member's user profile
        memberUserIds.forEach(userId => {
            const userRef = doc(db, 'users', userId);
            
            const unsubscribe = onSnapshot(userRef, async (userDocSnapshot) => {
                if (!userDocSnapshot.exists()) return;
                
                // User profile changed - reload teammates to get updated names
                await loadTeammatesFromFirestore();
                
                // Update UI elements that show team member info
                populateTaskAssigneeDropdown();
                
                debugLog(`🔄 User profile updated for ${userId}`);
            }, (error) => {
                // Handle Firestore listener errors (permission-denied, network issues, etc.)
                if (error.code === 'permission-denied') {
                    debugLog(`⚠️ User profile listener for ${userId}: permission denied`);
                } else if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                    debugLog(`⚠️ User profile listener for ${userId} temporarily unavailable`);
                } else {
                    console.error(`Error in user profile listener for ${userId}:`, error.code || error.message);
                }
            });
            
            userProfileUnsubscribes.push(unsubscribe);
        });
        
        debugLog(`👤 User profile listeners set up for ${memberUserIds.length} members`);
    } catch (error) {
        console.error('Error setting up user profile listeners:', error);
    }
}

// Stop team members listener
function stopTeamMembersListener() {
    if (teamMembersUnsubscribe) {
        teamMembersUnsubscribe();
        teamMembersUnsubscribe = null;
    }
    
    // Clean up user profile listeners
    userProfileUnsubscribes.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
    });
    userProfileUnsubscribes = [];
    
    debugLog('👥 Team members listeners stopped');
}

// ===================================
// SECURITY SETTINGS - FORCE LOGOUT
// ===================================

let forceLogoutUnsubscribe = null;

// Show logout all devices modal
window.showLogoutAllModal = function() {
    openModal('logoutAllModal');
};

// Send password reset email from settings
window.sendPasswordResetFromSettings = async function() {
    if (!currentAuthUser) {
        showToast('Please sign in to change your password.', 'error', 5000, 'Authentication Required');
        return;
    }
    
    const email = currentAuthUser.email;
    
    if (!email) {
        showToast('No email address associated with this account.', 'error', 5000, 'Error');
        return;
    }
    
    try {
        const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
        
        await sendPasswordResetEmail(auth, email);
        
        showToast(
            `Password reset link sent to ${email}. Check your inbox and spam folder.`,
            'success',
            7000,
            'Email Sent'
        );
        
    } catch (error) {
        console.error('Error sending password reset email:', error);
        
        let errorMessage = 'Failed to send reset email. Please try again.';
        
        if (error.code === 'auth/too-many-requests') {
            errorMessage = 'Too many requests. Please wait a few minutes and try again.';
        } else if (error.code === 'auth/user-not-found') {
            errorMessage = 'No account found with this email address.';
        }
        
        showToast(errorMessage, 'error', 5000, 'Reset Failed');
    }
};

// Force logout from all devices
async function forceLogoutEverywhere() {
    if (!currentAuthUser || !db) {
        alert('Cannot perform this action. Please sign in again.');
        return;
    }
    
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Update the forceLogoutAt timestamp in user document
        const userRef = doc(db, 'users', currentAuthUser.uid);
        await updateDoc(userRef, {
            'preferences.security.forceLogoutAt': Date.now()
        });
        
        console.log('Force logout timestamp set - signing out');
        
        // Sign out current session
        await signOutUser();
        
    } catch (error) {
        console.error('Error forcing logout:', error);
        showToast('Error logging out of all devices. Please try again.', 'error', 5000, 'Logout Failed');
    }
}

// Start listening for force logout events
function startForceLogoutListener() {
    if (!currentAuthUser || !db || forceLogoutUnsubscribe) {
        return; // Already listening or not ready
    }
    
    (async () => {
        try {
            const { doc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            
            const userRef = doc(db, 'users', currentAuthUser.uid);
            
            // Listen for changes to user document
            forceLogoutUnsubscribe = onSnapshot(userRef, (docSnapshot) => {
                if (!docSnapshot.exists()) return;
                
                const data = docSnapshot.data();
                const forceLogoutAt = data.preferences?.security?.forceLogoutAt;
                
                // Check if force logout timestamp exists and is valid
                if (forceLogoutAt && typeof forceLogoutAt === 'number') {
                    const sessionLoginAt = parseInt(localStorage.getItem('sessionLoginAt')) || 0;
                    
                    // If force logout timestamp is newer than session start, sign out
                    if (forceLogoutAt > sessionLoginAt) {
                        console.log('Force logout detected - session invalidated');
                        
                        // Unsubscribe to prevent multiple triggers
                        if (forceLogoutUnsubscribe) {
                            forceLogoutUnsubscribe();
                            forceLogoutUnsubscribe = null;
                        }
                        
                        // Show message and sign out
                        showToast('You have been signed out from all devices.', 'info', 5000, 'Session Ended');
                        
                        setTimeout(() => {
                            signOutUser();
                        }, 1000);
                    }
                }
            }, (error) => {
                console.error('Error listening for force logout:', error);
            });
            
        } catch (error) {
            console.error('Error setting up force logout listener:', error);
        }
    })();
}

// Clean up listener on sign out (called in signOutUser)
function stopForceLogoutListener() {
    if (forceLogoutUnsubscribe) {
        forceLogoutUnsubscribe();
        forceLogoutUnsubscribe = null;
    }
}

// ===================================
// UTILITY FUNCTIONS
// ===================================
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const past = new Date(timestamp);
    const diffInSeconds = Math.floor((now - past) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
    return past.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving to localStorage:', error.code || error.message);
        debugError('Full error:', error);
    }
}

function loadFromLocalStorage(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Error loading from localStorage:', error.code || error.message);
        debugError('Full error:', error);
        return null;
    }
}

// Clean up old tasks that don't exist in Firestore
async function cleanupOldTasks() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        debugLog('🧹 Cleaning up old tasks from localStorage...');
        
        const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Get all tasks from Firestore
        const tasksRef = collection(db, 'teams', appState.currentTeamId, 'tasks');
        const querySnapshot = await getDocs(tasksRef);
        const firestoreTaskIds = new Set();
        
        querySnapshot.forEach((doc) => {
            firestoreTaskIds.add(doc.id);
        });
        
        // Filter local tasks to only keep those that exist in Firestore
        const localTasks = loadFromLocalStorage('tasks') || [];
        const validTasks = localTasks.filter(task => firestoreTaskIds.has(String(task.id)));
        
        if (validTasks.length < localTasks.length) {
            debugLog(`🗑️ Removed ${localTasks.length - validTasks.length} old tasks from localStorage`);
            saveToLocalStorage('tasks', validTasks);
            appState.tasks = validTasks;
        } else {
            debugLog('✅ No old tasks to clean up');
        }
    } catch (error) {
        console.error('Error cleaning up old tasks:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// ===================================
// TEAM SECTION MANAGEMENT
// ===================================

// Initialize and display team section
async function initTeamSection() {
    if (!currentAuthUser || !db) {
        debugLog('Cannot init team section: no auth or db');
        return;
    }
    
    const hasTeam = appState.currentTeamId && appState.teammates.length > 0;
    const memberCount = appState.teammates.length;
    
    const teamOverviewCard = document.getElementById('teamOverviewCard');
    const noTeamCard = document.getElementById('noTeamCard');
    const joinTeamHeaderBtn = document.getElementById('joinTeamHeaderBtn');
    const leaveTeamHeaderBtn = document.getElementById('leaveTeamHeaderBtn');
    
    // Button visibility logic
    if (!hasTeam || memberCount === 1) {
        // Show "Join Team" button if no team or alone in team
        if (joinTeamHeaderBtn) joinTeamHeaderBtn.style.display = 'inline-flex';
        if (leaveTeamHeaderBtn) leaveTeamHeaderBtn.style.display = 'none';
    } else if (memberCount >= 2) {
        // Show "Leave Team" button if 2+ members
        if (joinTeamHeaderBtn) joinTeamHeaderBtn.style.display = 'none';
        if (leaveTeamHeaderBtn) leaveTeamHeaderBtn.style.display = 'inline-flex';
    }
    
    if (hasTeam) {
        // Show team overview
        if (teamOverviewCard) teamOverviewCard.style.display = 'block';
        if (noTeamCard) noTeamCard.style.display = 'none';
        
        await displayTeamSection();
    } else {
        // Show no team state
        if (teamOverviewCard) teamOverviewCard.style.display = 'none';
        if (noTeamCard) noTeamCard.style.display = 'block';
    }
}

// Display comprehensive team section
async function displayTeamSection() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (!teamDoc.exists()) {
            console.error('Team not found');
            debugError('Team ID:', appState.currentTeamId);
            return;
        }
        
        const teamData = teamDoc.data();
        
        // Update team name and code
        const teamNameDisplay = document.getElementById('teamNameDisplay');
        const teamCodeDisplay = document.getElementById('teamCodeDisplay');
        const teamMemberCount = document.getElementById('teamMemberCount');
        
        if (teamNameDisplay) teamNameDisplay.textContent = teamData.name || 'My Team';
        if (teamCodeDisplay) teamCodeDisplay.textContent = teamData.teamCode || '------';
        if (teamMemberCount) teamMemberCount.textContent = appState.teammates.length;
        
        // Show/hide leave button - everyone can leave the team now
        const leaveTeamBtn = document.getElementById('leaveTeamBtn');
        if (leaveTeamBtn) {
            leaveTeamBtn.style.display = 'inline-flex';
        }
        
        // Display current user's role
        const currentUserRole = getCurrentUserRole(teamData);
        const roleDisplay = document.getElementById('currentUserRoleDisplay');
        const roleBadge = document.getElementById('currentUserRoleBadge');
        if (roleDisplay && roleBadge) {
            roleDisplay.style.display = 'block';
            roleBadge.className = `member-role-badge ${currentUserRole}`;
            roleBadge.textContent = currentUserRole === 'owner' ? 'OWNER' : 
                                   currentUserRole === 'admin' ? 'ADMIN' : 'MEMBER';
        }
        
        // Show role info section
        const roleInfoSection = document.getElementById('roleInfoSection');
        if (roleInfoSection) {
            roleInfoSection.style.display = 'block';
        }
        
        // Show/hide team name edit button (owner-only)
        const editTeamNameBtn = document.getElementById('editTeamNameBtn');
        if (editTeamNameBtn) {
            editTeamNameBtn.style.display = isOwner(teamData) ? 'inline-flex' : 'none';
        }
        
        // Initialize team name editing (owner-only)
        initTeamNameEditing(teamData);
        
        // Display team members
        displayTeamMembers(teamData);
        
        // Display join requests (only for admin/owner)
        if (isAdmin(teamData)) {
            await displayJoinRequests();
        } else {
            // Hide join requests section for non-admins
            const joinRequestsSection = document.getElementById('joinRequestsSection');
            if (joinRequestsSection) {
                joinRequestsSection.style.display = 'none';
            }
        }
        
    } catch (error) {
        console.error('Error displaying team section:', error.code || error.message);
        debugError('Full error:', error);
    }
}

/**
 * Initialize team name editing functionality (Owner-only)
 * Allows owner to click edit button, modify name, and save to Firestore
 */
function initTeamNameEditing(teamData) {
    const editBtn = document.getElementById('editTeamNameBtn');
    const saveBtn = document.getElementById('saveTeamNameBtn');
    const cancelBtn = document.getElementById('cancelTeamNameBtn');
    const nameDisplay = document.getElementById('teamNameDisplay');
    const nameWrapper = document.querySelector('.team-name-wrapper');
    const editWrapper = document.getElementById('teamNameEditWrapper');
    const nameInput = document.getElementById('teamNameInput');
    
    if (!editBtn || !saveBtn || !cancelBtn || !nameDisplay || !nameWrapper || !editWrapper || !nameInput) return;
    
    // Only allow editing for owners
    if (!isOwner(teamData)) return;
    
    // Remove old event listeners by cloning elements
    const newEditBtn = editBtn.cloneNode(true);
    const newSaveBtn = saveBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    // Enter edit mode
    newEditBtn.addEventListener('click', () => {
        nameInput.value = nameDisplay.textContent;
        nameWrapper.style.display = 'none';
        editWrapper.style.display = 'flex';
        nameInput.focus();
        nameInput.select();
    });
    
    // Cancel editing
    newCancelBtn.addEventListener('click', () => {
        editWrapper.style.display = 'none';
        nameWrapper.style.display = 'flex';
    });
    
    // Save team name
    newSaveBtn.addEventListener('click', () => saveTeamName());
    
    // Save on Enter key
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveTeamName();
        } else if (e.key === 'Escape') {
            editWrapper.style.display = 'none';
            nameWrapper.style.display = 'flex';
        }
    });
    
    async function saveTeamName() {
        const newName = nameInput.value.trim();
        
        if (!newName) {
            showToast('Team name cannot be empty', 'error');
            return;
        }
        
        if (newName === nameDisplay.textContent) {
            // No change, just close
            editWrapper.style.display = 'none';
            nameWrapper.style.display = 'flex';
            return;
        }
        
        try {
            const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
            
            // Update Firestore
            const teamRef = doc(db, 'teams', appState.currentTeamId);
            await updateDoc(teamRef, { 
                name: newName,
                updatedAt: serverTimestamp()
            });
            
            // Update UI immediately
            nameDisplay.textContent = newName;
            editWrapper.style.display = 'none';
            nameWrapper.style.display = 'flex';
            
            showToast('Team name updated', 'success');
            
        } catch (error) {
            console.error('Error updating team name:', error);
            if (error.code === 'permission-denied') {
                showToast('Only team owners can rename the team', 'error');
            } else {
                showToast('Failed to update team name', 'error');
            }
        }
    }
}

// Display team members in grid
function displayTeamMembers(teamData) {
    const grid = document.getElementById('teamMembersGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (!appState.teammates || appState.teammates.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: var(--gray); grid-column: 1/-1;">No team members yet.</p>';
        return;
    }
    
    appState.teammates.forEach(teammate => {
        const card = createTeamMemberCard(teammate, teamData);
        grid.appendChild(card);
    });
    
    // Load pending leave requests for admins
    loadAndDisplayPendingLeaveRequests(teamData);
}

// Load and display pending leave requests (admin only)
async function loadAndDisplayPendingLeaveRequests(teamData) {
    const section = document.getElementById('pendingLeaveRequestsSection');
    const list = document.getElementById('pendingLeaveRequestsList');
    
    if (!section || !list) return;
    
    // Check if current user is admin/owner
    const currentUserRole = teamData?.members?.[currentAuthUser?.uid]?.role;
    if (currentUserRole !== 'admin' && currentUserRole !== 'owner') {
        section.style.display = 'none';
        return;
    }
    
    try {
        const requests = await loadPendingLeaveRequests();
        
        if (!requests || requests.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        list.innerHTML = '';
        
        requests.forEach(request => {
            const requestEl = document.createElement('div');
            requestEl.className = 'leave-request-item';
            
            const timeAgo = request.requestedAt?.toDate ? 
                formatTimeAgo(request.requestedAt.toDate()) : 'Recently';
            
            requestEl.innerHTML = `
                <div class="leave-request-info">
                    <span class="leave-request-name">${escapeHtml(request.userName || request.userEmail)}</span>
                    <span class="leave-request-time">Requested ${timeAgo}</span>
                </div>
                <div class="leave-request-actions">
                    <button class="btn-approve-leave" onclick="approveLeaveRequest('${request.id}', '${request.userId}', '${escapeHtml(request.userName || 'User')}')">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button class="btn-deny-leave" onclick="denyLeaveRequest('${request.id}', '${escapeHtml(request.userName || 'User')}')">
                        <i class="fas fa-times"></i> Deny
                    </button>
                </div>
            `;
            
            list.appendChild(requestEl);
        });
        
    } catch (error) {
        console.error('Error loading leave requests:', error);
        section.style.display = 'none';
    }
}

// Create enhanced team member card
function createTeamMemberCard(member, teamData) {
    const card = document.createElement('div');
    card.className = 'team-member-card';
    card.dataset.memberId = member.id; // Store member ID for navigation
    
    // Determine role display
    const role = member.role || 'member';
    const roleBadge = role;
    const roleDisplay = role === 'owner' ? 'OWNER' : role === 'admin' ? 'ADMIN' : 'MEMBER';
    const jobPosition = member.occupation || 'No position set';
    
    // Get avatar initials and color
    const initials = member.avatar || generateAvatar(member.name);
    const avatarColor = member.avatarColor || '#0078D4';
    const darkerColor = shadeColor(avatarColor, -20);
    
    // Create member header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'member-header';
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'member-avatar';
    avatarDiv.style.background = `linear-gradient(135deg, ${avatarColor} 0%, ${darkerColor} 100%)`;
    avatarDiv.textContent = initials; // Use textContent for initials
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'member-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'member-name';
    nameDiv.textContent = member.name; // Use textContent for name
    
    const emailDiv = document.createElement('div');
    emailDiv.className = 'member-email';
    emailDiv.textContent = member.email; // Use textContent for email
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(emailDiv);
    headerDiv.appendChild(avatarDiv);
    headerDiv.appendChild(infoDiv);
    
    // Create member details
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'member-details';
    
    // Job position row
    const jobRow = document.createElement('div');
    jobRow.className = 'member-detail-row';
    const briefcaseIcon = document.createElement('i');
    briefcaseIcon.className = 'fas fa-briefcase';
    const jobSpan = document.createElement('span');
    jobSpan.textContent = jobPosition; // Use textContent for job position
    jobRow.appendChild(briefcaseIcon);
    jobRow.appendChild(jobSpan);
    
    // Role row
    const roleRow = document.createElement('div');
    roleRow.className = 'member-detail-row';
    const shieldIcon = document.createElement('i');
    shieldIcon.className = 'fas fa-shield-alt';
    const roleSpan = document.createElement('span');
    roleSpan.className = `member-role-badge ${roleBadge}`;
    roleSpan.textContent = roleDisplay; // Use textContent for role
    roleRow.appendChild(shieldIcon);
    roleRow.appendChild(roleSpan);
    
    detailsDiv.appendChild(jobRow);
    detailsDiv.appendChild(roleRow);
    
    // Joined date row (optional)
    if (member.joinedAt) {
        const joinRow = document.createElement('div');
        joinRow.className = 'member-detail-row';
        const calendarIcon = document.createElement('i');
        calendarIcon.className = 'fas fa-calendar-plus';
        const joinSpan = document.createElement('span');
        joinSpan.textContent = 'Joined ' + formatDate(member.joinedAt); // Use textContent for date
        joinRow.appendChild(calendarIcon);
        joinRow.appendChild(joinSpan);
        detailsDiv.appendChild(joinRow);
    }
    
    card.appendChild(headerDiv);
    card.appendChild(detailsDiv);
    
    // Add role management actions (only for owners)
    const currentUserRole = getCurrentUserRole(teamData);
    const isCurrentUser = currentAuthUser && member.id === currentAuthUser.uid;
    
    if (currentUserRole === 'owner' && !isCurrentUser && role !== 'owner') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'member-actions';
        
        // Promote/Demote buttons
        if (role === 'member') {
            const promoteBtn = document.createElement('button');
            promoteBtn.className = 'btn-role-action promote';
            promoteBtn.innerHTML = '<i class="fas fa-arrow-up"></i> Promote';
            promoteBtn.onclick = () => {
                console.log('Promote button clicked for:', member.id, member.name);
                console.log('showPromoteModal function exists:', typeof window.showPromoteModal);
                if (window.showPromoteModal) {
                    window.showPromoteModal(member.id, member.name);
                } else {
                    console.error('showPromoteModal is not defined!');
                }
            };
            actionsDiv.appendChild(promoteBtn);
        } else if (role === 'admin') {
            const demoteBtn = document.createElement('button');
            demoteBtn.className = 'btn-role-action demote';
            demoteBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Demote';
            demoteBtn.onclick = () => {
                console.log('Demote button clicked for:', member.id, member.name);
                console.log('showDemoteModal function exists:', typeof window.showDemoteModal);
                if (window.showDemoteModal) {
                    window.showDemoteModal(member.id, member.name);
                } else {
                    console.error('showDemoteModal is not defined!');
                }
            };
            actionsDiv.appendChild(demoteBtn);
        }
        
        // Kick button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-role-action remove';
        removeBtn.innerHTML = '<i class="fas fa-user-times"></i> Kick';
        removeBtn.onclick = () => {
            console.log('Kick button clicked for:', member.id, member.name);
            console.log('showKickModal function exists:', typeof window.showKickModal);
            if (window.showKickModal) {
                window.showKickModal(member.id, member.name);
            } else {
                console.error('showKickModal is not defined!');
            }
        };
        actionsDiv.appendChild(removeBtn);
        
        card.appendChild(actionsDiv);
    }
    
    return card;
}

// Format timestamp to readable date
function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    
    let date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
        date = timestamp;
    } else {
        date = new Date(timestamp);
    }
    
    // Return formatted date: e.g., "Oct 25, 2025"
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric'
    });
}

// ===================================
// ROLE MANAGEMENT FUNCTIONS
// ===================================
// Modal functions for promote, demote, and kick
// (Variables declared at top of file before event listeners)

window.showPromoteModal = function(userId, userName) {
    console.log('showPromoteModal called with:', userId, userName);
    window.pendingPromoteUserId = userId;
    window.pendingPromoteUserName = userName;
    console.log('pendingPromoteUserId set to:', window.pendingPromoteUserId);
    
    const modalElement = document.getElementById('promoteModal');
    const nameElement = document.getElementById('promoteMemberName');
    
    console.log('Modal element:', modalElement);
    console.log('Name element:', nameElement);
    
    if (nameElement) {
        nameElement.textContent = userName;
    }
    if (modalElement) {
        modalElement.classList.add('active');
        console.log('Modal should now be visible');
    } else {
        console.error('promoteModal element not found!');
    }
};

window.closePromoteModal = function() {
    document.getElementById('promoteModal').classList.remove('active');
    window.pendingPromoteUserId = null;
    window.pendingPromoteUserName = null;
};

window.showDemoteModal = function(userId, userName) {
    window.pendingDemoteUserId = userId;
    window.pendingDemoteUserName = userName;
    document.getElementById('demoteMemberName').textContent = userName;
    document.getElementById('demoteModal').classList.add('active');
};

window.closeDemoteModal = function() {
    document.getElementById('demoteModal').classList.remove('active');
    window.pendingDemoteUserId = null;
    window.pendingDemoteUserName = null;
};

window.showKickModal = function(userId, userName) {
    window.pendingKickUserId = userId;
    window.pendingKickUserName = userName;
    document.getElementById('kickMemberName').textContent = userName;
    document.getElementById('kickModal').classList.add('active');
};

window.closeKickModal = function() {
    document.getElementById('kickModal').classList.remove('active');
    window.pendingKickUserId = null;
    window.pendingKickUserName = null;
};

// Make clearAllMessages globally accessible
window.clearAllMessages = clearAllMessages;

async function promoteToAdmin(userId, userName) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        showToast('Error: Cannot promote user', 'error');
        return;
    }
    
    // Check current user's role
    const currentUserRole = appState.teammates.find(t => t.id === currentAuthUser.uid)?.role;
    console.log('Current user role:', currentUserRole);
    console.log('Attempting to promote user:', userId, 'to admin');
    
    // Check permission client-side
    if (currentUserRole !== 'owner') {
        showToast('Only owners can promote users', 'error');
        return;
    }
    
    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        await updateDoc(teamRef, {
            [`members.${userId}.role`]: 'admin'
        });
        
        debugLog('✅ Promoted user to admin:', userId);
        
        // Add activity
        addActivity({
            type: 'team',
            description: `promoted ${userName} to Admin`
        });
        
        showToast(`${userName} has been promoted to Admin`, 'success', 3000);
        
        // Reload team members to show updated role
        console.log('🔄 Reloading team members after promotion...');
        const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        await loadTeammatesFromFirestore();
        
        // Refresh the team section display with updated data
        const updatedTeamData = (await getDoc(teamRef)).data();
        console.log('📊 Updated team data:', updatedTeamData);
        if (updatedTeamData) {
            displayTeamMembers(updatedTeamData);
            console.log('✅ Team members display refreshed');
        }
        
    } catch (error) {
        console.error('Error promoting user:', error.code || error.message);
        console.error('Full error object:', error);
        showToast('Failed to promote user. Make sure Firestore rules are deployed.', 'error');
    }
}

async function demoteToMember(userId, userName) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        showToast('Error: Cannot demote user', 'error');
        return;
    }
    
    try {
        const { doc, updateDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        await updateDoc(teamRef, {
            [`members.${userId}.role`]: 'member'
        });
        
        debugLog('✅ Demoted user to member:', userId);
        
        // Add activity
        addActivity({
            type: 'team',
            description: `demoted ${userName} to Member`
        });
        
        showToast(`${userName} has been demoted to Member`, 'success', 3000);
        
        // Reload team members to show updated role
        console.log('🔄 Reloading team members after demotion...');
        await loadTeammatesFromFirestore();
        
        // Refresh the team section display with updated data
        const updatedTeamData = (await getDoc(teamRef)).data();
        console.log('📊 Updated team data:', updatedTeamData);
        if (updatedTeamData) {
            displayTeamMembers(updatedTeamData);
            console.log('✅ Team members display refreshed');
        }
        
    } catch (error) {
        console.error('Error demoting user:', error.code || error.message);
        debugError('Full error:', error);
        showToast('Failed to demote user. Please try again.', 'error');
    }
}

async function removeMember(userId, userName) {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        showToast('Error: Cannot remove user', 'error');
        return;
    }
    
    try {
        const { doc, updateDoc, deleteField, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Remove from team members
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        await updateDoc(teamRef, {
            [`members.${userId}`]: deleteField()
        });
        
        // NOTE: User will update their own teams list when they next log in
        // We only update the team document's members map, which we have permission for
        debugLog('✅ Removed user from team:', userId);
        
        // Add activity
        addActivity({
            type: 'team',
            description: `kicked ${userName} from the team`
        });
        
        showToast(`${userName} has been kicked from the team`, 'success', 3000);
        
        // Reload team members to show user removed
        console.log('🔄 Reloading team members after kick...');
        await loadTeammatesFromFirestore();
        
        // Refresh the team section display with updated data
        const updatedTeamData = (await getDoc(teamRef)).data();
        console.log('📊 Updated team data:', updatedTeamData);
        if (updatedTeamData) {
            displayTeamMembers(updatedTeamData);
            console.log('✅ Team members display refreshed');
        }
        
    } catch (error) {
        console.error('Error removing user:', error.code || error.message);
        debugError('Full error:', error);
        showToast('Failed to remove user. Please try again.', 'error');
    }
}

// Display join requests
async function displayJoinRequests() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        const { collection, getDocs, query, where } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Read from joinRequests subcollection instead of deprecated pendingRequests map
        const joinRequestsRef = collection(db, 'teams', appState.currentTeamId, 'joinRequests');
        const pendingQuery = query(joinRequestsRef, where('status', '==', 'pending'));
        const snapshot = await getDocs(pendingQuery);
        
        const requestsList = [];
        snapshot.forEach(doc => {
            requestsList.push({ id: doc.id, ...doc.data() });
        });
        
        const joinRequestsSection = document.getElementById('joinRequestsSection');
        const joinRequestsList = document.getElementById('joinRequestsList');
        const requestCountBadge = document.getElementById('requestCountBadge');
        
        if (requestsList.length === 0) {
            if (joinRequestsSection) joinRequestsSection.style.display = 'none';
            return;
        }
        
        // Show section
        if (joinRequestsSection) joinRequestsSection.style.display = 'block';
        if (requestCountBadge) requestCountBadge.textContent = requestsList.length;
        
        // Display requests
        if (joinRequestsList) {
            joinRequestsList.innerHTML = '';
            
            requestsList.forEach(request => {
                const userId = request.id;
                const requestItem = createJoinRequestItem(userId, request);
                joinRequestsList.appendChild(requestItem);
            });
        }
        
    } catch (error) {
        console.error('Error loading join requests:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// Create join request item
function createJoinRequestItem(userId, request) {
    const item = document.createElement('div');
    item.className = 'join-request-item';
    item.id = `request-${userId}`;
    
    const avatar = generateAvatar(request.name || request.displayName || request.email);
    
    item.innerHTML = `
        <div class="join-request-info">
            <div class="join-request-avatar">${escapeHtml(avatar)}</div>
            <div class="join-request-details">
                <div class="name">${escapeHtml(request.name || request.displayName || request.email.split('@')[0])}</div>
                <div class="email">${escapeHtml(request.email)}</div>
            </div>
        </div>
        <div class="join-request-actions">
            <button class="btn-accept" onclick="approveJoinRequest('${escapeHtml(userId)}')">
                <i class="fas fa-check"></i> Accept
            </button>
            <button class="btn-reject" onclick="rejectJoinRequest('${escapeHtml(userId)}')">
                <i class="fas fa-times"></i> Reject
            </button>
        </div>
    `;
    
    return item;
}

// Copy team code
window.copyTeamCode = async function() {
    if (!db || !appState.currentTeamId) return;
    
    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (teamDoc.exists()) {
            const teamCode = teamDoc.data().teamCode;
            
            navigator.clipboard.writeText(teamCode).then(() => {
                alert(`Team code copied: ${teamCode}`);
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = teamCode;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                alert(`Team code copied: ${teamCode}`);
            });
        }
    } catch (error) {
        console.error('Error copying team code:', error.code || error.message);
        debugError('Full error:', error);
    }
};

// Generate shareable join link
window.generateJoinLink = function() {
    if (!appState.currentTeamData?.teamCode) {
        showToast('No team code available', 'error');
        return;
    }
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const joinUrl = `${baseUrl}/index.html?join=${appState.currentTeamData.teamCode}`;
    
    navigator.clipboard.writeText(joinUrl).then(() => {
        showToast('Join link copied to clipboard!', 'success');
    }).catch(() => {
        // Fallback - show the link
        prompt('Copy this join link:', joinUrl);
    });
};

// Join team with code input (from no-team card)
window.joinTeamWithCodeInput = function() {
    const input = document.getElementById('joinTeamCodeInput');
    if (!input) return;
    
    const code = input.value.trim().toUpperCase();
    if (!code) {
        alert('Please enter a team code');
        return;
    }
    
    joinTeamByCode(code);
};

// Open join team modal (from header button)
window.openJoinTeamModal = function() {
    const modal = document.getElementById('joinTeamModal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('joinTeamCodeModalInput').focus();
    }
};

// Close join team modal
function closeJoinTeamModal() {
    const modal = document.getElementById('joinTeamModal');
    if (modal) {
        modal.classList.remove('active');
        document.getElementById('joinTeamModalForm').reset();
    }
}

// Initialize join team modal handlers
function initJoinTeamModal() {
    const modal = document.getElementById('joinTeamModal');
    const closeBtn = document.getElementById('closeJoinTeamModal');
    const cancelBtn = document.getElementById('cancelJoinTeamBtn');
    const form = document.getElementById('joinTeamModalForm');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeJoinTeamModal);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeJoinTeamModal);
    }
    
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('joinTeamCodeModalInput');
            const code = input.value.trim().toUpperCase();
            
            if (!code) {
                alert('Please enter a team code');
                return;
            }
            
            closeJoinTeamModal();
            joinTeamByCode(code);
        });
    }
    
    // Close modal when clicking outside
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeJoinTeamModal();
            }
        });
    }
}

// Rate limiting helper for join team attempts
function canAttemptJoinTeam() {
    const now = Date.now();
    const raw = localStorage.getItem('joinTeamAttempts') || '[]';
    let attempts = [];

    try {
        attempts = JSON.parse(raw);
    } catch {
        attempts = [];
    }

    // Remove attempts older than 1 hour
    const oneHourAgo = now - 60 * 60 * 1000;
    attempts = attempts.filter(ts => ts > oneHourAgo);

    if (attempts.length >= 20) {
        return { allowed: false, attempts };
    }

    // Add this attempt and persist
    attempts.push(now);
    localStorage.setItem('joinTeamAttempts', JSON.stringify(attempts));

    return { allowed: true, attempts };
}

// Join team by code - creates a join request
async function joinTeamByCode(teamCode) {
    if (!db || !currentAuthUser) {
        alert('Please sign in to join a team');
        return;
    }
    
    // Rate limit check
    const rateResult = canAttemptJoinTeam();
    if (!rateResult.allowed) {
        showToast('You have tried to join too many teams recently. Please wait before trying again.', 'warning', 6000, 'Rate Limit');
        return;
    }
    
    try {
        const { doc, getDoc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Normalize the team code - add TEAM- prefix if not present
        let normalizedCode = teamCode.trim().toUpperCase();
        if (!normalizedCode.startsWith('TEAM-')) {
            normalizedCode = 'TEAM-' + normalizedCode;
        }
        
        if (DEBUG) console.log('🔍 Searching for team with code');
        
        // Look up team by code via teamJoinInfo (public collection)
        const joinInfoRef = doc(db, 'teamJoinInfo', normalizedCode);
        const joinInfoDoc = await getDoc(joinInfoRef);
        
        if (!joinInfoDoc.exists()) {
            debugLog('❌ No team found for code');
            showToast('No team found with this code. Please check the code and try again.', 'error', 5000, 'Invalid Code');
            return;
        }
        
        const joinInfo = joinInfoDoc.data();
        const teamId = joinInfo.teamId;
        const teamName = joinInfo.teamName;
        
        debugLog('✅ Found team:', teamName);
        
        // Create join request in subcollection (prevents DoS via map growth)
        // Uses /teams/{teamId}/joinRequests/{userId} instead of deprecated pendingRequests map
        const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const joinRequestRef = doc(db, 'teams', teamId, 'joinRequests', currentAuthUser.uid);
        await setDoc(joinRequestRef, {
            userId: currentAuthUser.uid,
            name: currentAuthUser.displayName || currentAuthUser.email,
            email: currentAuthUser.email,
            requestedAt: serverTimestamp(),
            status: 'pending'
        });
        
        debugLog('✅ Join request sent successfully');
        
        showToast(`Join request sent to "${teamName}"! Wait for a team member to approve your request.`, 'success', 5000, 'Request Sent');
        closeJoinTeamModal();
        
    } catch (error) {
        console.error('Error joining team:', error.code || error.message);
        if (error.code === 'permission-denied') {
            showToast('Unable to send request. You may already be a member or have a pending request.', 'error', 5000, 'Request Failed');
        } else {
            showToast('Error sending join request. Please try again.', 'error', 5000, 'Request Failed');
        }
    }
}

// Leave team - SECURITY FIX: Use pendingLeaveRequests for non-owners
// Regular members submit a leave request; admins/owners can leave directly or approve requests
window.leaveTeam = async function() {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        const { doc, getDoc, updateDoc, setDoc, collection, addDoc, serverTimestamp, deleteField } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamDoc = await getDoc(teamRef);
        
        if (!teamDoc.exists()) {
            showToast('Team not found', 'error');
            return;
        }
        
        const teamData = teamDoc.data();
        const members = teamData.members || {};
        const memberCount = Object.keys(members).length;
        const userRole = members[currentAuthUser.uid]?.role || 'member';
        
        // Case 1: Owner trying to leave
        if (userRole === 'owner') {
            if (memberCount > 1) {
                // Owner cannot leave without transferring ownership
                showToast('You must transfer ownership before leaving the team', 'warning', 5000, 'Cannot Leave');
                return;
            } else {
                // Owner is the last member - confirm and delete team
                if (!confirm('You are the only member. Leaving will delete this team permanently. Continue?')) {
                    return;
                }
                // For now, just remove themselves (team will be orphaned but rules prevent access)
                // TODO: Consider full team deletion
            }
        }
        
        // Case 2: Admin can leave directly
        if (userRole === 'admin' || userRole === 'owner') {
            if (!confirm('Are you sure you want to leave this team? This action cannot be undone.')) {
                return;
            }
            await performLeaveTeam(currentAuthUser.uid, appState.currentTeamId);
            return;
        }
        
        // Case 3: Regular member - submit leave request for admin approval
        if (!confirm('Submit a request to leave this team? An admin will need to approve it.')) {
            return;
        }
        
        // Create leave request
        const leaveRequestsRef = collection(db, 'teams', appState.currentTeamId, 'pendingLeaveRequests');
        await addDoc(leaveRequestsRef, {
            userId: currentAuthUser.uid,
            userName: currentAuthUser.displayName || currentAuthUser.email,
            userEmail: currentAuthUser.email,
            requestedAt: serverTimestamp(),
            status: 'pending'
        });
        
        showToast('Leave request submitted. An admin will review it.', 'success', 5000, 'Request Sent');
        
    } catch (error) {
        console.error('Error leaving team:', error.code || error.message);
        debugError('Full error:', error);
        
        // If permission denied, it might be a rules issue - guide the user
        if (error.code === 'permission-denied') {
            showToast('You do not have permission to leave directly. Contact an admin.', 'error', 5000, 'Permission Denied');
        } else {
            showToast('Error leaving team. Please try again.', 'error', 5000, 'Error');
        }
    }
};

// Actually perform the leave team operation (used by admins and for approved requests)
async function performLeaveTeam(userId, teamId) {
    if (!db) return;
    
    try {
        const { doc, getDoc, updateDoc, setDoc, deleteField } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const teamRef = doc(db, 'teams', teamId);
        const teamDoc = await getDoc(teamRef);
        
        if (!teamDoc.exists()) return;
        
        const members = teamDoc.data().members || {};
        
        // Use deleteField to remove the user from members map
        const updates = {};
        updates[`members.${userId}`] = deleteField();
        await updateDoc(teamRef, updates);
        
        // Update user's teams list
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const userTeams = (userData.teams || []).filter(t => t !== teamId);
            await setDoc(userRef, { teams: userTeams }, { merge: true });
        }
        
        // If this is the current user, clear local state
        if (userId === currentAuthUser?.uid) {
            appState.currentTeamId = null;
            appState.userTeams = [];
            appState.teammates = [];
            
            showToast('You have left the team successfully.', 'success');
            await initTeamSection();
        }
        
    } catch (error) {
        console.error('Error performing leave team:', error);
        throw error;
    }
}

// Approve a leave request (admin/owner only)
window.approveLeaveRequest = async function(requestId, userId, userName) {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    if (!confirm(`Approve ${userName}'s request to leave the team?`)) {
        return;
    }
    
    try {
        const { doc, deleteDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Perform the leave operation
        await performLeaveTeam(userId, appState.currentTeamId);
        
        // Delete the request
        const requestRef = doc(db, 'teams', appState.currentTeamId, 'pendingLeaveRequests', requestId);
        await deleteDoc(requestRef);
        
        showToast(`${userName} has been removed from the team.`, 'success');
        
        // Refresh the members list
        if (window.loadPendingLeaveRequests) {
            await loadPendingLeaveRequests();
        }
        
    } catch (error) {
        console.error('Error approving leave request:', error);
        showToast('Error approving request. Please try again.', 'error');
    }
};

// Deny a leave request (admin/owner only)
window.denyLeaveRequest = async function(requestId, userName) {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    if (!confirm(`Deny ${userName}'s request to leave?`)) {
        return;
    }
    
    try {
        const { doc, deleteDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const requestRef = doc(db, 'teams', appState.currentTeamId, 'pendingLeaveRequests', requestId);
        await deleteDoc(requestRef);
        
        showToast(`Leave request denied.`, 'info');
        
        if (window.loadPendingLeaveRequests) {
            await loadPendingLeaveRequests();
        }
        
    } catch (error) {
        console.error('Error denying leave request:', error);
        showToast('Error denying request. Please try again.', 'error');
    }
};

// Load pending leave requests (admin/owner only)
window.loadPendingLeaveRequests = async function() {
    if (!db || !appState.currentTeamId) return [];
    
    try {
        const { collection, query, orderBy, getDocs } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const requestsRef = collection(db, 'teams', appState.currentTeamId, 'pendingLeaveRequests');
        const q = query(requestsRef, orderBy('requestedAt', 'desc'));
        const snapshot = await getDocs(q);
        
        const requests = [];
        snapshot.forEach(doc => {
            requests.push({ id: doc.id, ...doc.data() });
        });
        
        return requests;
        
    } catch (error) {
        console.error('Error loading leave requests:', error);
        return [];
    }
};

// ===================================
// FIREBASE FUNCTIONS (PLACEHOLDER)
// ===================================
// These functions will be used when Firebase is properly configured

// Team-scoped Firestore functions - with real-time listener
async function loadTasksFromFirestore() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        console.log('Cannot load tasks: missing requirements');
        return;
    }
    
    try {
        const { collection, query, onSnapshot, orderBy } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const tasksRef = collection(db, 'teams', appState.currentTeamId, 'tasks');
        const q = query(tasksRef, orderBy('createdAt', 'desc'));
        
        // Real-time listener for tasks
        onSnapshot(q, (querySnapshot) => {
            const tasks = [];
            querySnapshot.forEach((doc) => {
                tasks.push({ id: doc.id, ...doc.data() });
            });
            
            appState.tasks = tasks;
            saveToLocalStorage('tasks', appState.tasks);
            
            if (window.displayTasks) {
                window.displayTasks();
            }
            
            // Update overview when tasks change
            updateOverview();
            
            // Update metrics if active
            updateMetricsIfActive();
            
            debugLog(`✅ Loaded ${tasks.length} tasks`);
        }, (error) => {
            // Handle Firestore listener errors (network issues, timeouts, etc.)
            if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ Tasks listener temporarily unavailable, will auto-retry');
            } else {
                console.error('❌ Error in tasks snapshot listener:', error.code || error.message);
                debugError('Full error:', error);
            }
        });
        
    } catch (error) {
        console.error('Error setting up tasks listener:', error.code || error.message);
        debugError('Full error:', error);
    }
}

async function saveTaskToFirestore(task) {
    if (!db || !currentAuthUser || !appState.currentTeamId) return null;
    
    const path = `teams/${appState.currentTeamId}/tasks/<new>`;
    
    try {
        const { collection, addDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const tasksRef = collection(db, 'teams', appState.currentTeamId, 'tasks');
        
        // SECURITY: Only include fields allowed by rules whitelist
        // Allowed: createdBy, teamId, title, description, status, assignee, assigneeId, priority, dueAt, dueDate,
        //          createdAt, updatedAt, tags, completed, completedAt, completedBy, progress, estimatedTime
        // NOTE: createdByName is NOT allowed - removed to fix permission-denied
        const allowedFields = ['title', 'description', 'status', 'assignee', 'assigneeId', 'priority', 
                               'dueAt', 'dueDate', 'tags', 'completed', 'completedAt', 'completedBy', 
                               'progress', 'estimatedTime'];
        const taskData = {
            teamId: appState.currentTeamId,  // Required by rules
            createdBy: currentAuthUser.uid,
            createdAt: serverTimestamp()
        };
        for (const key of allowedFields) {
            if (key in task && task[key] !== undefined) {
                taskData[key] = task[key];
            }
        }
        // Ensure title is set (required by rules)
        if (!taskData.title) {
            taskData.title = task.name || 'Untitled Task';
        }
        
        const docRef = await addDoc(tasksRef, taskData);
        
        debugLog('Task saved to team collection with ID:', docRef.id);
        return docRef.id; // Return the Firestore document ID
    } catch (error) {
        logFirestoreError('saveTaskToFirestore', path, task, {
            uid: currentAuthUser?.uid,
            teamId: appState.currentTeamId,
            userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
        }, error);
        return null;
    }
}

async function updateTaskInFirestore(task) {
    if (!db || !currentAuthUser || !appState.currentTeamId || !task.id) return false;
    
    const path = `teams/${appState.currentTeamId}/tasks/${task.id}`;
    
    try {
        const { doc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const taskRef = doc(db, 'teams', appState.currentTeamId, 'tasks', task.id);
        
        // Remove id from the update data (Firestore doc ID shouldn't be a field)
        const { id, ...taskData } = task;
        
        // SECURITY: Only include fields allowed by rules whitelist (UPDATE - mutable fields only)
        // Allowed on UPDATE: title, description, status, assignee, assigneeId, priority, dueAt, dueDate,
        //          updatedAt, tags, completed, completedAt, completedBy, progress, estimatedTime
        // NOTE: updatedBy is NOT allowed - removed to fix permission-denied
        // NOTE: createdBy, teamId, createdAt are immutable - don't send on UPDATE
        const allowedFields = ['title', 'description', 'status', 'assignee', 'assigneeId', 'priority', 
                               'dueAt', 'dueDate', 'tags', 'completed', 'completedAt', 'completedBy', 
                               'progress', 'estimatedTime'];
        const filteredData = {};
        for (const key of allowedFields) {
            if (key in taskData) {
                filteredData[key] = taskData[key];
            }
        }
        
        await updateDoc(taskRef, {
            ...filteredData,
            updatedAt: serverTimestamp()
        });
        
        debugLog('Task updated in Firestore:', task.id);
        return true;
    } catch (error) {
        logFirestoreError('updateTaskInFirestore', path, filteredData, {
            uid: currentAuthUser?.uid,
            teamId: appState.currentTeamId,
            taskId: task.id,
            taskCreatedBy: task.createdBy,
            userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
        }, error);
        return false;
    }
}

async function loadMessagesFromFirestore() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        // Clear messages if no team
        appState.messages = [];
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) chatMessages.innerHTML = '';
        return;
    }
    
    try {
        const { collection, query, onSnapshot, orderBy } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const messagesRef = collection(db, 'teams', appState.currentTeamId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));
        
        // Track if this is the initial load
        let isInitialLoad = true;
        
        // Real-time listener for messages
        onSnapshot(q, async (querySnapshot) => {
            const encryptedMessages = [];
            querySnapshot.forEach((doc) => {
                // Spread doc.data() first, then override with doc.id to ensure Firestore doc ID wins
                encryptedMessages.push({ ...doc.data(), id: doc.id });
            });
            
            // Decrypt all messages and format time
            const messages = await Promise.all(
                encryptedMessages.map(async (msg) => {
                    let decryptedMsg = msg;
                    
                    // CRITICAL: Map Firestore 'message' field to UI 'text' field
                    // Firestore rules require 'message', but UI expects 'text'
                    if (msg.message && !msg.text) {
                        decryptedMsg = { ...msg, text: msg.message };
                    }
                    
                    // CRITICAL: All messages are ALWAYS encrypted (no 'encrypted' flag stored in Firestore)
                    // The encryption happens in sendMessage() before saving
                    // So we ALWAYS attempt to decrypt (with error handling)
                    if (decryptedMsg.text) {
                        try {
                            const decryptedText = await decryptMessage(decryptedMsg.text, appState.currentTeamId);
                            decryptedMsg = { ...decryptedMsg, text: decryptedText };
                        } catch (error) {
                            // If decryption fails, message might be plaintext (legacy) or corrupted
                            console.warn('Failed to decrypt message, showing as-is:', error.message);
                            // Keep original text
                        }
                    }
                    
                    // Add formatted time field if timestamp exists
                    if (decryptedMsg.timestamp) {
                        const date = decryptedMsg.timestamp.seconds 
                            ? new Date(decryptedMsg.timestamp.seconds * 1000) 
                            : new Date(decryptedMsg.timestamp);
                        decryptedMsg.time = formatTime(date);
                    }
                    
                    return decryptedMsg;
                })
            );
            
            // Check for new messages from other users (skip on initial load)
            const previousMessageCount = appState.messages.length;
            const hasNewMessages = messages.length > previousMessageCount;
            
            // Get last seen timestamp from localStorage
            const lastSeenKey = `chatLastSeen_${appState.currentTeamId}`;
            const lastSeenTimestamp = parseInt(localStorage.getItem(lastSeenKey) || '0');
            
            // Only show badge if NOT initial load and there are new messages
            if (!isInitialLoad && hasNewMessages && messages.length > 0) {
                const latestMessage = messages[messages.length - 1];
                const isFromOtherUser = latestMessage.userId && latestMessage.userId !== currentAuthUser?.uid;
                const isNotOnChatSection = appState.currentSection !== 'chat';
                
                // Check if message timestamp is after last seen
                const messageTimestamp = latestMessage.timestamp?.toMillis?.() || Date.now();
                const isNewSinceLastSeen = messageTimestamp > lastSeenTimestamp;
                
                // Show badge if new message from other user, not viewing chat, and after last seen
                if (isFromOtherUser && isNotOnChatSection && isNewSinceLastSeen) {
                    const chatBadge = document.getElementById('chatNotificationBadge');
                    if (chatBadge) {
                        chatBadge.style.display = 'flex';
                        const unreadCount = parseInt(chatBadge.textContent || '0') + 1;
                        chatBadge.textContent = unreadCount.toString();
                    }
                }
            }
            
            // Mark initial load as complete
            if (isInitialLoad) {
                isInitialLoad = false;
            }
            
            // Always update state, even if empty (clears old team's messages)
            appState.messages = messages;
            displayMessages();
            
            // Update metrics if active
            updateMetricsIfActive();
            
            if (hasNewMessages && messages.length > 0) {
                debugLog(`✅ Messages updated: ${messages.length} total`);
            }
        }, (error) => {
            // Handle Firestore listener errors (network issues, timeouts, etc.)
            if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ Messages listener temporarily unavailable, will auto-retry');
            } else {
                console.error('Error in messages snapshot listener:', error.code || error.message);
                debugError('Full error:', error);
            }
        });
        
    } catch (error) {
        console.error('Error loading messages from Firestore:', error.code || error.message);
        debugError('Full error:', error);
    }
}

// ===================================
// ENCRYPTION UTILITIES
// ===================================
/**
 * ⚠️ SECURITY WARNING: ENCRYPTION THEATER - NOT TRUE E2EE ⚠️
 * 
 * The encryption implemented here provides OBFUSCATION ONLY, not true security.
 * 
 * WHY THIS IS NOT SECURE:
 * - The encryption key is derived from: teamId + hardcoded salt
 * - Both values are known/accessible to anyone with Firestore access
 * - If Firestore is compromised, messages can be trivially decrypted
 * - Server-side (Firebase) can always decrypt messages
 * 
 * WHAT THIS PROTECTS AGAINST:
 * - Casual viewing of raw database exports
 * - Accidental data exposure in logs
 * 
 * WHAT THIS DOES NOT PROTECT AGAINST:
 * - Determined attackers with database access
 * - Firebase/Google employees
 * - Legal/government data requests
 * - Any breach of Firestore security rules
 * 
 * FOR TRUE END-TO-END ENCRYPTION (E2EE), YOU NEED:
 * - User-generated secrets (passwords or passphrase)
 * - Client-side key derivation that never touches the server
 * - Key exchange protocols (e.g., Signal Protocol, ECDH)
 * - Per-user or per-conversation keys
 * 
 * DO NOT claim "end-to-end encryption" or "E2EE" in any UI or documentation.
 * This is transport-layer obfuscation, not cryptographic security.
 */
async function getTeamEncryptionKey(teamId) {
    // WARNING: This key is derived from publicly-accessible teamId + hardcoded salt
    // This provides obfuscation, NOT cryptographic security
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(teamId + '_encryption_key_v1');
    
    // Import the key material
    const key = await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );
    
    // Derive an AES-GCM key from the key material
    // WARNING: The salt is hardcoded, reducing security further
    const salt = encoder.encode('teamhub_salt_v1');
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        key,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptMessage(text, teamId) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const key = await getTeamEncryptionKey(teamId);
        
        // Generate a random initialization vector
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Encrypt the data
        const encryptedData = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        
        // Combine IV and encrypted data, then convert to base64
        const combined = new Uint8Array(iv.length + encryptedData.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encryptedData), iv.length);
        
        return btoa(String.fromCharCode(...combined));
    } catch (error) {
        console.error('Encryption error:', error.code || error.message);
        debugError('Full error:', error);
        throw new Error('ENCRYPTION_FAILED');
    }
}

async function decryptMessage(encryptedText, teamId) {
    try {
        // Convert from base64
        const combined = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
        
        // Extract IV and encrypted data
        const iv = combined.slice(0, 12);
        const encryptedData = combined.slice(12);
        
        const key = await getTeamEncryptionKey(teamId);
        
        // Decrypt the data
        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encryptedData
        );
        
        // Convert back to text
        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    } catch (error) {
        console.error('Decryption error:', error.code || error.message);
        debugError('Full error:', error);
        return '[Encrypted message - unable to decrypt]';
    }
}

async function saveMessageToFirestore(message) {
    if (!db || !currentAuthUser || !appState.currentTeamId) return;
    
    try {
        const { collection, addDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const messagesRef = collection(db, 'teams', appState.currentTeamId, 'messages');
        
        // SECURITY: Schema must match rules exactly
        // Allowed fields: userId, userName, message, timestamp, createdAt, edited, editedAt, teamId, userEmail, photoURL
        // SECURITY: userEmail must match request.auth.token.email if provided
        const messageDoc = {
            userId: currentAuthUser.uid,
            userName: message.author || currentAuthUser.displayName || currentAuthUser.email,
            message: message.text, // Already encrypted text from sendMessage
            userEmail: currentAuthUser.email, // Must match auth token
            photoURL: currentAuthUser.photoURL || null,
            teamId: appState.currentTeamId,
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp()
        };
        
        // NOTE: repliedTo, mentions, avatarColor, encrypted flag are NOT stored in Firestore
        // They are either derived client-side or stored in separate subcollections if needed
        // The message text is pre-encrypted before reaching this function
        
        // Use addDoc to let Firestore generate the document ID
        const docRef = await addDoc(messagesRef, messageDoc);
        
        debugLog('✅ Message saved to Firestore:', { 
            messageId: docRef.id, 
            docPath: `teams/${appState.currentTeamId}/messages/${docRef.id}`
        });
    } catch (error) {
        console.error('Error saving message to Firestore:', error);
        throw error; // Re-throw so sendMessage can handle it
    }
}

async function loadEventsFromFirestore() {
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        console.log('Cannot load events: missing db, auth, or teamId');
        return;
    }
    
    try {
        const { collection, query, onSnapshot, orderBy, doc, getDoc, Timestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const eventsRef = collection(db, 'teams', appState.currentTeamId, 'events');
        const q = query(eventsRef, orderBy('startTime', 'asc'));
        
        // Get user role for visibility filtering
        const teamRef = doc(db, 'teams', appState.currentTeamId);
        const teamSnap = await getDoc(teamRef);
        const teamData = teamSnap.exists() ? teamSnap.data() : null;
        const userRole = getCurrentUserRole(teamData);
        const isAdmin = userRole === 'admin' || userRole === 'owner';
        
        // Real-time listener
        onSnapshot(q, (querySnapshot) => {
            const events = [];
            querySnapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                
                // Check visibility permissions
                const visibility = data.visibility || 'team';
                const isCreator = data.createdBy === currentAuthUser.uid;
                
                // Filter based on visibility
                let canSee = false;
                if (visibility === 'team') {
                    canSee = true; // Everyone can see team events
                } else if (visibility === 'admins') {
                    canSee = isAdmin || isCreator; // Only admins or creator can see
                } else if (visibility === 'private') {
                    canSee = isCreator; // Only creator can see
                }
                
                if (canSee) {
                    events.push({
                        id: docSnapshot.id,
                        title: data.title,
                        description: data.description,
                        date: data.startTime?.toDate ? data.startTime.toDate() : new Date(data.startTime),
                        endDate: data.endTimeStamp?.toDate ? data.endTimeStamp.toDate() : new Date(data.endTimeStamp),
                        time: data.startTimeStr || '',
                        endTime: data.endTimeStr || '',
                        color: data.color || '#0078d4',
                        visibility: visibility,
                        teamId: data.teamId,
                        createdBy: data.createdBy,
                        createdByName: data.createdByName
                    });
                }
            });
            
            appState.events = events;
            debugLog(`✅ Loaded ${events.length} events (filtered by visibility)`);
            debugLog('Events:', events);
            
            // Update calendar display if on calendar section
            if (typeof renderCalendar === 'function') {
                debugLog('Calling renderCalendar to update display...');
                renderCalendar();
            } else {
                debugLog('renderCalendar function not yet defined');
            }
            
            // Update overview when events change
            updateOverview();
            
            // Update metrics if active
            updateMetricsIfActive();
        }, (error) => {
            // Handle Firestore listener errors (network issues, timeouts, etc.)
            if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
                debugLog('⚠️ Events listener temporarily unavailable, will auto-retry');
            } else {
                console.error('Error in events snapshot listener:', error.code || error.message);
                debugError('Full error:', error);
            }
        });
        
    } catch (error) {
        console.error('Error loading events from Firestore:', error.code || error.message);
        debugError('Full error:', error);
    }
}

async function saveEventToFirestore(event) {
    debugLog('saveEventToFirestore called with:', event);
    debugLog('db:', !!db, 'auth:', !!currentAuthUser, 'teamId:', appState.currentTeamId);
    
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        console.error('❌ Cannot save event: missing db, auth, or teamId');
        alert('Error: Please make sure you are logged in and part of a team');
        return;
    }
    
    try {
        const { collection, addDoc, serverTimestamp, Timestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const eventsRef = collection(db, 'teams', appState.currentTeamId, 'events');
        debugLog('Events collection path:', `teams/${appState.currentTeamId}/events`);
        
        // Convert Date objects to Firestore Timestamps
        const eventData = {
            title: event.title,
            description: event.description || '',
            startTime: Timestamp.fromDate(event.date),
            endTimeStamp: event.endDate ? Timestamp.fromDate(event.endDate) : Timestamp.fromDate(new Date(event.date.getTime() + 60*60*1000)),
            startTimeStr: event.time,
            endTimeStr: event.endTime || '',
            color: event.color || '#0078d4',
            visibility: event.visibility || 'team',
            teamId: appState.currentTeamId,
            createdBy: currentAuthUser.uid,
            createdByName: currentAuthUser.displayName || currentAuthUser.email,
            createdAt: serverTimestamp()
        };
        
        console.log('Saving event to Firestore for team:', event.teamId);
        const docRef = await addDoc(eventsRef, eventData);
        console.log('✅ Event saved to Firestore with ID:', docRef.id);
        
    } catch (error) {
        console.error('❌ Error saving event to Firestore:', error.code || error.message);
        showToast('Error saving event: ' + error.message, 'error', 5000, 'Save Failed');
    }
}

async function updateEventInFirestore(event) {
    debugLog('updateEventInFirestore called with:', event);
    debugLog('db:', !!db, 'auth:', !!currentAuthUser, 'teamId:', appState.currentTeamId);
    
    if (!db || !currentAuthUser || !appState.currentTeamId) {
        console.error('❌ Cannot update event: missing db, auth, or teamId');
        alert('Error: Please make sure you are logged in and part of a team');
        return;
    }
    
    try {
        const { doc, updateDoc, Timestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const eventRef = doc(db, 'teams', appState.currentTeamId, 'events', event.id);
        debugLog('Event document path:', `teams/${appState.currentTeamId}/events/${event.id}`);
        
        // Convert Date objects to Firestore Timestamps
        const eventData = {
            title: event.title,
            description: event.description || '',
            startTime: Timestamp.fromDate(event.date),
            endTimeStamp: event.endDate ? Timestamp.fromDate(event.endDate) : Timestamp.fromDate(new Date(event.date.getTime() + 60*60*1000)),
            startTimeStr: event.time,
            endTimeStr: event.endTime || '',
            color: event.color || '#007AFF',
            visibility: event.visibility || 'team',
            updatedAt: new Date()  // Required by rules - helps with tracking changes
        };
        
        console.log('Updating event in Firestore:', event.id);
        await updateDoc(eventRef, eventData);
        console.log('✅ Event updated in Firestore');
        
    } catch (error) {
        console.error('❌ Error updating event in Firestore:', error.code || error.message);
        showToast('Error updating event: ' + error.message, 'error', 5000, 'Update Failed');
    }
}

// ===================================
// LINK LOBBY SYSTEM
// ===================================
let linkLobbyGroups = [];
let linkLobbyUnsubscribe = null;
let linkGroupMenuOpen = null;

// Initialize Link Lobby
function initLinkLobby() {
    // Add button event listener
    const addGroupBtn = document.getElementById('addLinkGroupBtn');
    if (addGroupBtn) {
        addGroupBtn.addEventListener('click', openAddGroupModal);
    }
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.link-group-menu')) {
            closeAllGroupMenus();
        }
    });
    
    // URL input preview listener
    const linkUrlInput = document.getElementById('linkUrl');
    if (linkUrlInput) {
        linkUrlInput.addEventListener('input', debounce(updateLinkPreview, 300));
    }
}

// Subscribe to Link Lobby groups
// Security: Uses split queries to avoid permission errors on private groups
async function subscribeLinkLobbyGroups() {
    if (!db || !appState.currentTeamId || !currentAuthUser) return;
    
    // Unsubscribe from previous listeners
    if (linkLobbyUnsubscribe) {
        if (typeof linkLobbyUnsubscribe === 'function') {
            linkLobbyUnsubscribe();
        } else if (Array.isArray(linkLobbyUnsubscribe)) {
            linkLobbyUnsubscribe.forEach(unsub => unsub && unsub());
        }
    }
    
    try {
        const { collection, query, where, orderBy, onSnapshot, getDocs } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const groupsRef = collection(db, 'teams', appState.currentTeamId, 'linkLobbyGroups');
        const currentUserId = currentAuthUser.uid;
        
        // SECURITY FIX: Split into two queries to avoid permission errors
        // Query 1: Public/team groups (visibility == 'team')
        // Try with orderBy first, fall back to client-side sort if indexes not ready
        let teamGroupsQuery = query(groupsRef, where('visibility', '==', 'team'), orderBy('sortOrder', 'asc'));
        let teamGroupsQueryFallback = query(groupsRef, where('visibility', '==', 'team'));
        
        // Query 2: Private groups created by current user
        let privateGroupsQuery = query(groupsRef, where('visibility', '==', 'private'), where('createdBy', '==', currentUserId), orderBy('sortOrder', 'asc'));
        let privateGroupsQueryFallback = query(groupsRef, where('visibility', '==', 'private'), where('createdBy', '==', currentUserId));
        
        // Query 3: Legacy groups without visibility field (treated as team-visible)
        const legacyGroupsQuery = query(groupsRef);
        
        // Track results from both queries
        let teamGroups = [];
        let privateGroups = [];
        let legacyGroups = [];
        let unsubscribers = [];
        
        // Helper to process group documents
        const processGroupDocs = async (snapshot) => {
            const groups = [];
            for (const docSnapshot of snapshot.docs) {
                const groupData = { id: docSnapshot.id, ...docSnapshot.data(), links: [], domainGroups: {} };
                
                // Fetch links for this group
                try {
                    const linksRef = collection(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', docSnapshot.id, 'links');
                    const linksQuery = query(linksRef, orderBy('createdAt', 'desc'));
                    const linksSnapshot = await getDocs(linksQuery);
                    
                    linksSnapshot.forEach(linkDoc => {
                        const linkData = { id: linkDoc.id, ...linkDoc.data() };
                        
                        // CRITICAL: Map Firestore field names to UI field names for backward compat
                        // Firestore rules require 'title' and 'favicon', but UI expects 'label' and 'iconUrl'
                        if (linkData.title && !linkData.label) {
                            linkData.label = linkData.title;
                        }
                        if (linkData.favicon && !linkData.iconUrl) {
                            linkData.iconUrl = linkData.favicon;
                        }
                        
                        if (groupData.autoGroupDomain && linkData.domain) {
                            if (!groupData.domainGroups[linkData.domain]) {
                                groupData.domainGroups[linkData.domain] = [];
                            }
                            groupData.domainGroups[linkData.domain].push(linkData);
                        } else {
                            groupData.links.push(linkData);
                        }
                    });
                } catch (linkError) {
                    debugLog('Could not fetch links for group:', docSnapshot.id, linkError.message);
                }
                
                // Sort links: favorites first, then by createdAt
                groupData.links.sort((a, b) => {
                    if (a.favorite && !b.favorite) return -1;
                    if (!a.favorite && b.favorite) return 1;
                    return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
                });
                
                Object.keys(groupData.domainGroups).forEach(domain => {
                    groupData.domainGroups[domain].sort((a, b) => {
                        if (a.favorite && !b.favorite) return -1;
                        if (!a.favorite && b.favorite) return 1;
                        return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
                    });
                });
                
                groups.push(groupData);
            }
            return groups;
        };
        
        // Merge and deduplicate groups from all queries
        const mergeAndRender = () => {
            // Combine all groups, filtering legacy groups to exclude those with explicit visibility
            const filteredLegacy = legacyGroups.filter(g => !('visibility' in g) || g.visibility === undefined);
            const allGroups = [...teamGroups, ...privateGroups, ...filteredLegacy];
            
            // Deduplicate by ID first, then by normalized title
            const seenIds = new Set();
            const seenTitles = new Map();
            linkLobbyGroups = [];
            
            // Sort by sortOrder before deduplication
            allGroups.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
            
            for (const group of allGroups) {
                // Skip if already seen this exact document
                if (seenIds.has(group.id)) continue;
                seenIds.add(group.id);
                
                const normalizedTitle = normalizeGroupTitle(group.title);
                
                if (!seenTitles.has(normalizedTitle)) {
                    seenTitles.set(normalizedTitle, group);
                    linkLobbyGroups.push(group);
                } else {
                    const existing = seenTitles.get(normalizedTitle);
                    if ((group.sortOrder ?? Infinity) < (existing.sortOrder ?? Infinity)) {
                        const idx = linkLobbyGroups.indexOf(existing);
                        if (idx !== -1) {
                            linkLobbyGroups[idx] = group;
                            seenTitles.set(normalizedTitle, group);
                        }
                    }
                }
            }
            
            // Re-sort after deduplication
            linkLobbyGroups.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
            
            renderLinkLobby();
        };
        
        // Subscribe to team groups (visibility == 'team')
        let teamGroupsUnsub;
        const subscribeTeamGroups = (useOrderBy = true) => {
            const queryToUse = useOrderBy ? teamGroupsQuery : teamGroupsQueryFallback;
            teamGroupsUnsub = onSnapshot(queryToUse, async (snapshot) => {
                teamGroups = await processGroupDocs(snapshot);
                mergeAndRender();
            }, (error) => {
                // If failed-precondition, indexes not ready - retry without orderBy
                if (error.code === 'failed-precondition' && useOrderBy) {
                    console.log('%c⚠️ Indexes not ready, using fallback query without orderBy', 'color: #ff8800; font-weight: bold');
                    if (teamGroupsUnsub) teamGroupsUnsub();
                    subscribeTeamGroups(false);
                } else {
        let privateGroupsUnsub;
        const subscribePrivateGroups = (useOrderBy = true) => {
            const queryToUse = useOrderBy ? privateGroupsQuery : privateGroupsQueryFallback;
            privateGroupsUnsub = onSnapshot(queryToUse, async (snapshot) => {
                privateGroups = await processGroupDocs(snapshot);
                mergeAndRender();
            }, (error) => {
                // If failed-precondition, indexes not ready - retry without orderBy
                if (error.code === 'failed-precondition' && useOrderBy) {
                    console.log('%c⚠️ Indexes not ready, using fallback query without orderBy', 'color: #ff8800; font-weight: bold');
                    if (privateGroupsUnsub) privateGroupsUnsub();
                    subscribePrivateGroups(false);
                } else {
                    debugLog('Private groups query error:', error.code);
                    privateGroups = [];
                    mergeAndRender();
                }
            });
            unsubscribers.push(privateGroupsUnsub);
        };
        subscribePrivateGroups(true);
        
        // Subscribe to legacy groups (no visibility field) - filter client-side
        // This handles backward compatibility with groups created before visibility was added
        const unsub3 = onSnapshot(legacyGroupsQuery, async (snapshot) => {
            // Filter to only include groups without visibility OR where user is creator of private
            const filteredDocs = {
                docs: snapshot.docs.filter(doc => {
                    const data = doc.data();
                    // Include if no visibility field
                    if (!('visibility' in data)) return true;
                    // Already handled by other queries
                    return false;
                })
            };
            legacyGroups = await processGroupDocs(filteredDocs);
            mergeAndRender();
        }, (error) => {
            // If permission-denied, it means the rules are working correctly
            // and we shouldn't have access to some groups in this query
            if (error.code === 'permission-denied') {
                debugLog('Legacy query permission denied - using split queries only');
                legacyGroups = [];
                mergeAndRender();
            } else {
                console.error('Legacy groups query error:', error);
            }
        });
        unsubscribers.push(unsub3);
        
        // Store all unsubscribers
        linkLobbyUnsubscribe = unsubscribers;
        
    } catch (error) {
        console.error('Error setting up link lobby subscription:', error);
    }
}

// Render Link Lobby
function renderLinkLobby() {
    const container = document.getElementById('linkLobbyContainer');
    const emptyState = document.getElementById('linkLobbyEmpty');
    
    if (!container) return;
    
    // NOTE: Visibility filtering is now done at query level in subscribeLinkLobbyGroups()
    // The linkLobbyGroups array only contains groups the user has permission to see
    const visibleGroups = linkLobbyGroups;
    
    if (visibleGroups.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        // Remove any rendered groups
        container.querySelectorAll('.link-group').forEach(el => el.remove());
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    // Clear existing groups
    container.querySelectorAll('.link-group').forEach(el => el.remove());
    
    // Render each visible group
    visibleGroups.forEach((group, index) => {
        const groupEl = createGroupElement(group, index);
        container.appendChild(groupEl);
    });
    
    // Initialize drag and drop
    initGroupDragAndDrop();
}

// Create group element
function createGroupElement(group, index) {
    const totalLinks = group.links.length + Object.values(group.domainGroups).reduce((sum, arr) => sum + arr.length, 0);
    const isPrivate = group.visibility === 'private';
    const isCreator = group.createdBy === currentAuthUser?.uid;
    
    const groupEl = document.createElement('div');
    groupEl.className = 'link-group';
    groupEl.dataset.groupId = group.id;
    groupEl.dataset.sortOrder = group.sortOrder;
    
    // Build badges HTML
    let badgesHtml = `<span class="group-count">${totalLinks}</span>`;
    if (isPrivate) {
        badgesHtml += '<span class="group-private-badge"><i class="fas fa-lock"></i> Private</span>';
    }
    if (group.autoGroupDomain) {
        badgesHtml += '<span class="auto-domain-badge">Auto-group</span>';
    }
    
    // Only show visibility toggle to creator
    const visibilityMenuItem = isCreator ? `
        <button class="link-group-menu-item" onclick="toggleGroupVisibility('${group.id}', '${isPrivate ? 'team' : 'private'}')">
            <i class="fas fa-${isPrivate ? 'users' : 'lock'}"></i> 
            ${isPrivate ? 'Make public to team' : 'Make private'}
        </button>
    ` : '';
    
    groupEl.innerHTML = `
        <div class="link-group-header">
            <div class="link-group-drag-handle" draggable="true">
                <i class="fas fa-grip-vertical"></i>
            </div>
            <div class="link-group-title">
                ${escapeHtml(group.title)}
                ${badgesHtml}
            </div>
            <div class="link-group-actions">
                <button class="link-group-btn add-link-btn" onclick="openAddLinkModal('${group.id}')" title="Add link">
                    <i class="fas fa-plus"></i>
                </button>
                <div class="link-group-menu">
                    <button class="link-group-btn" onclick="toggleGroupMenu('${group.id}')" title="More options">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="link-group-menu-dropdown" id="groupMenu-${group.id}">
                        <button class="link-group-menu-item" onclick="openEditGroupModal('${group.id}')">
                            <i class="fas fa-edit"></i> Rename group
                        </button>
                        ${visibilityMenuItem}
                        <button class="link-group-menu-item" onclick="toggleAutoDomain('${group.id}', ${!group.autoGroupDomain})">
                            <i class="fas fa-${group.autoGroupDomain ? 'times-circle' : 'magic'}"></i> 
                            ${group.autoGroupDomain ? 'Disable' : 'Enable'} auto-grouping
                        </button>
                        <div class="link-group-menu-divider"></div>
                        <button class="link-group-menu-item danger" onclick="openDeleteGroupModal('${group.id}', '${escapeHtml(group.title)}')">
                            <i class="fas fa-trash"></i> Delete group
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="link-group-content">
            ${renderGroupContent(group)}
        </div>
    `;
    
    return groupEl;
}

// Render group content (links and domain subgroups)
function renderGroupContent(group) {
    const hasDomainGroups = Object.keys(group.domainGroups).length > 0;
    const hasLinks = group.links.length > 0;
    
    if (!hasDomainGroups && !hasLinks) {
        return '<div class="link-group-empty"><i class="fas fa-link"></i> No links yet. Click + to add one.</div>';
    }
    
    let html = '';
    
    // Render domain subgroups first
    if (hasDomainGroups) {
        Object.entries(group.domainGroups).forEach(([domain, links]) => {
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
            html += `
                <div class="domain-subgroup" data-domain="${escapeHtml(domain)}">
                    <div class="domain-subgroup-header" onclick="toggleDomainSubgroup(this.parentElement)">
                        <img class="domain-subgroup-icon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">
                        <span class="domain-subgroup-title">${escapeHtml(domain)}</span>
                        <span class="domain-subgroup-count">${links.length}</span>
                        <i class="fas fa-chevron-down domain-subgroup-toggle"></i>
                    </div>
                    <div class="domain-subgroup-content">
                        <div class="links-list">
                            ${links.map(link => renderLinkItem(link, group.id)).join('')}
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    // Render ungrouped links
    if (hasLinks) {
        html += `<div class="links-list">${group.links.map(link => renderLinkItem(link, group.id)).join('')}</div>`;
    }
    
    return html;
}

// Render individual link item - Collapsible tile: small state shows name + star, click opens link; arrow expands details
function renderLinkItem(link, groupId) {
    const faviconUrl = link.iconUrl || `https://www.google.com/s2/favicons?domain=${link.domain}&sz=32`;
    
    return `
        <div class="link-item ${link.favorite ? 'favorite' : ''}" data-link-id="${link.id}" data-group-id="${groupId}" data-url="${escapeHtml(link.url)}">
            <div class="link-item-collapsed" onclick="openLink('${escapeHtml(link.url)}')">
                <img class="link-favicon" src="${faviconUrl}" alt="" onerror="this.outerHTML='<div class=\\'link-favicon-fallback\\'><i class=\\'fas fa-link\\'></i></div>'">
                <span class="link-name">${escapeHtml(link.label)}</span>
            </div>
            <button class="link-collapsed-star ${link.favorite ? 'active' : ''}" onclick="event.stopPropagation(); toggleLinkFavorite('${groupId}', '${link.id}', ${!link.favorite})" title="${link.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                <i class="fas fa-star"></i>
            </button>
            <button class="link-expand-btn" onclick="toggleLinkExpanded(event, this)" title="Show details">
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="link-item-expanded">
                <div class="link-expanded-content">
                    <div class="link-expanded-info">
                        <span class="link-label" data-link-id="${link.id}" data-group-id="${groupId}" onclick="startEditLinkName(event, '${groupId}', '${link.id}')">${escapeHtml(link.label)}</span>
                        <span class="link-domain">${escapeHtml(link.domain || '')}</span>
                    </div>
                    <div class="link-actions">
                        <button class="link-star-btn ${link.favorite ? 'active' : ''}" onclick="toggleLinkFavorite('${groupId}', '${link.id}', ${!link.favorite})" title="${link.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                            <i class="fas fa-star"></i>
                        </button>
                        <button class="link-open-btn" onclick="openLink('${escapeHtml(link.url)}')" title="Open link">
                            Open <i class="fas fa-external-link-alt"></i>
                        </button>
                        <button class="link-delete-btn" onclick="deleteLink('${groupId}', '${link.id}')" title="Delete link">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Toggle link item expanded/collapsed state
function toggleLinkExpanded(event, btn) {
    event.stopPropagation();
    const linkItem = btn.closest('.link-item');
    if (!linkItem) return;
    linkItem.classList.toggle('expanded');
}

// Start inline editing of link name
function startEditLinkName(event, groupId, linkId) {
    event.stopPropagation();
    
    const labelEl = event.target;
    if (labelEl.classList.contains('link-label-input')) return; // Already editing
    
    const currentName = labelEl.textContent;
    const originalHTML = labelEl.outerHTML;
    
    // Create inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'link-label-input';
    input.value = currentName;
    input.dataset.groupId = groupId;
    input.dataset.linkId = linkId;
    input.dataset.originalName = currentName;
    
    // Replace label with input
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    
    // Handle blur - save changes
    input.addEventListener('blur', () => saveLinkName(input));
    
    // Handle keyboard
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEditLinkName(input);
        }
    });
    
    // Prevent row click when clicking input
    input.addEventListener('click', (e) => e.stopPropagation());
}

// Save edited link name to Firestore
async function saveLinkName(input) {
    const groupId = input.dataset.groupId;
    const linkId = input.dataset.linkId;
    const originalName = input.dataset.originalName;
    const newName = input.value.trim();
    
    // If empty or unchanged, revert
    if (!newName || newName === originalName) {
        revertLinkName(input, originalName);
        return;
    }
    
    // Create new label span
    const newLabel = document.createElement('span');
    newLabel.className = 'link-label';
    newLabel.dataset.linkId = linkId;
    newLabel.dataset.groupId = groupId;
    newLabel.textContent = newName;
    newLabel.onclick = (e) => startEditLinkName(e, groupId, linkId);
    
    // Replace input with label
    input.replaceWith(newLabel);
    
    // Save to Firestore
    if (!db || !appState.currentTeamId) return;
    
    try {
        const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const linkRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links', linkId);
        // SECURITY: Rules use 'title' not 'label' for link names
        await updateDoc(linkRef, { title: newName, updatedAt: serverTimestamp() });
        showToast('Link renamed!', 'success');
    } catch (error) {
        console.error('Error renaming link:', error);
        showToast('Error renaming link', 'error');
        // Revert on error
        newLabel.textContent = originalName;
    }
}

// Cancel editing and revert to original name
function cancelEditLinkName(input) {
    revertLinkName(input, input.dataset.originalName);
}

// Revert link name input back to span
function revertLinkName(input, name) {
    const groupId = input.dataset.groupId;
    const linkId = input.dataset.linkId;
    
    const newLabel = document.createElement('span');
    newLabel.className = 'link-label';
    newLabel.dataset.linkId = linkId;
    newLabel.dataset.groupId = groupId;
    newLabel.textContent = name;
    newLabel.onclick = (e) => startEditLinkName(e, groupId, linkId);
    
    input.replaceWith(newLabel);
}

// Toggle domain subgroup collapse
function toggleDomainSubgroup(el) {
    el.classList.toggle('collapsed');
}

// Open link in new tab
function openLink(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
}

// Toggle group menu
function toggleGroupMenu(groupId) {
    const menu = document.getElementById(`groupMenu-${groupId}`);
    if (!menu) return;
    
    const isOpen = menu.classList.contains('active');
    closeAllGroupMenus();
    
    if (!isOpen) {
        menu.classList.add('active');
        linkGroupMenuOpen = groupId;
    }
}

// Close all group menus
function closeAllGroupMenus() {
    document.querySelectorAll('.link-group-menu-dropdown.active').forEach(menu => {
        menu.classList.remove('active');
    });
    linkGroupMenuOpen = null;
}

// ===================================
// LINK LOBBY - Group CRUD Operations
// ===================================

// Open add group modal
function openAddGroupModal() {
    document.getElementById('linkGroupModalTitle').innerHTML = '<i class="fas fa-folder-plus"></i> Create Group';
    document.getElementById('linkGroupId').value = '';
    document.getElementById('linkGroupName').value = '';
    document.getElementById('linkGroupAutoDomain').checked = false;
    document.getElementById('linkGroupSubmitBtn').innerHTML = '<i class="fas fa-plus"></i> Create Group';
    document.getElementById('linkGroupModal').classList.add('active');
}

// Open edit group modal
function openEditGroupModal(groupId) {
    closeAllGroupMenus();
    const group = linkLobbyGroups.find(g => g.id === groupId);
    if (!group) return;
    
    document.getElementById('linkGroupModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Group';
    document.getElementById('linkGroupId').value = groupId;
    document.getElementById('linkGroupName').value = group.title;
    document.getElementById('linkGroupAutoDomain').checked = group.autoGroupDomain || false;
    document.getElementById('linkGroupSubmitBtn').innerHTML = '<i class="fas fa-check"></i> Save Changes';
    document.getElementById('linkGroupModal').classList.add('active');
}

// Close group modal
function closeLinkGroupModal() {
    document.getElementById('linkGroupModal').classList.remove('active');
}

// Normalize group title for comparison (lowercase, trim whitespace)
function normalizeGroupTitle(title) {
    return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Check if a group with the same title already exists
function groupTitleExists(title, excludeGroupId = null) {
    const normalizedTitle = normalizeGroupTitle(title);
    return linkLobbyGroups.some(g => 
        normalizeGroupTitle(g.title) === normalizedTitle && g.id !== excludeGroupId
    );
}

// Save group (create or update)
async function saveLinkGroup(event) {
    event.preventDefault();
    
    console.log('%c🔵 saveLinkGroup CALLED', 'color: #0088ff; font-weight: bold; font-size: 14px');
    
    const groupId = document.getElementById('linkGroupId').value;
    const title = document.getElementById('linkGroupName').value.trim();
    const autoGroupDomain = document.getElementById('linkGroupAutoDomain').checked;
    
    console.log('%c📝 Form Values:', 'color: #00aaff; font-weight: bold', { groupId, title, autoGroupDomain });
    
    if (!title) {
        console.log('%c❌ Validation Failed: Empty title', 'color: #ff0000; font-weight: bold');
        showToast('Please enter a group name', 'error');
        return;
    }
    
    // Check for duplicate group name
    if (groupTitleExists(title, groupId || null)) {
        console.log('%c❌ Validation Failed: Duplicate title', 'color: #ff0000; font-weight: bold');
        showToast('A group with this name already exists', 'warning');
        return;
    }
    
    if (!db || !appState.currentTeamId) {
        console.log('%c❌ Validation Failed: No db or teamId', 'color: #ff0000; font-weight: bold', { db: !!db, teamId: appState.currentTeamId });
        showToast('Not connected to team', 'error');
        return;
    }
    
    console.log('%c✅ Validation Passed - Proceeding to Firestore', 'color: #00ff00; font-weight: bold');
    
    try {
        const { collection, doc, addDoc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        if (groupId) {
            console.log('%c🔄 UPDATE Mode', 'color: #ffaa00; font-weight: bold');
            // Update existing group - only mutable fields
            const groupRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId);
            const updateData = { title, autoGroupDomain, updatedAt: serverTimestamp() };
            
            // DEBUG_PERMS logging
            if (DEBUG_PERMS) {
                console.log('[DEBUG_PERMS] UPDATE linkLobbyGroup:', {
                    path: `teams/${appState.currentTeamId}/linkLobbyGroups/${groupId}`,
                    keys: Object.keys(updateData),
                    uid: currentAuthUser.uid
                });
            }
            
            console.log('%c📤 Sending UPDATE to Firestore...', 'color: #ffaa00; font-weight: bold', updateData);
            await updateDoc(groupRef, updateData);
            console.log('%c✅ UPDATE Succeeded!', 'color: #00ff00; font-weight: bold');
            showToast('Group updated!', 'success');
        } else {
            console.log('%c➕ CREATE Mode', 'color: #00ff00; font-weight: bold');
            // Create new group - full schema with immutable fields
            const groupsRef = collection(db, 'teams', appState.currentTeamId, 'linkLobbyGroups');
            const sortOrder = linkLobbyGroups.length;
            const createData = {
                title,
                autoGroupDomain,
                sortOrder,
                teamId: appState.currentTeamId,  // IMMUTABLE: set only on create
                visibility: 'team',  // Explicit visibility for query compatibility
                createdAt: serverTimestamp(),    // IMMUTABLE: set only on create
                updatedAt: serverTimestamp(),
                createdBy: currentAuthUser.uid   // IMMUTABLE: set only on create
            };
            
            // DEBUG_PERMS logging
            if (DEBUG_PERMS) {
                console.log('[DEBUG_PERMS] CREATE linkLobbyGroup:', {
                    path: `teams/${appState.currentTeamId}/linkLobbyGroups/<new>`,
                    keys: Object.keys(createData),
                    uid: currentAuthUser.uid
                });
            }
            
            console.log('%c📤 Sending CREATE to Firestore...', 'color: #00ff00; font-weight: bold', createData);
            const docRef = await addDoc(groupsRef, createData);
            console.log('%c✅ CREATE Succeeded! New Doc ID:', 'color: #00ff00; font-weight: bold; font-size: 14px', docRef.id);
            showToast('Group created!', 'success');
        }
        
        console.log('%c🚪 Closing modal...', 'color: #00aaff; font-weight: bold');
        closeLinkGroupModal();
        console.log('%c✅ saveLinkGroup COMPLETE', 'color: #00ff00; font-weight: bold; font-size: 14px');
        
    } catch (error) {
        console.log('%c❌ ERROR CAUGHT IN CATCH BLOCK', 'color: #ff0000; font-weight: bold; font-size: 14px', error);
        const path = groupId 
            ? `teams/${appState.currentTeamId}/linkLobbyGroups/${groupId}`
            : `teams/${appState.currentTeamId}/linkLobbyGroups/<new>`;
        await logFirestoreError('saveLinkLobbyGroup', path, { title, autoGroupDomain }, {
            uid: currentAuthUser?.uid,
            teamId: appState.currentTeamId,
            isUpdate: !!groupId,
            userRole: appState.currentTeamData?.members?.[currentAuthUser?.uid]?.role
        }, error);
        showToast('Error saving group: ' + error.message, 'error');
    }
}

// Toggle auto-domain grouping
async function toggleAutoDomain(groupId, enabled) {
    closeAllGroupMenus();
    
    if (!db || !appState.currentTeamId) return;
    
    try {
        const { doc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const groupRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId);
        await updateDoc(groupRef, { 
            autoGroupDomain: enabled,
            updatedAt: serverTimestamp()
        });
        showToast(enabled ? 'Auto-grouping enabled!' : 'Auto-grouping disabled!', 'success');
        
    } catch (error) {
        console.error('Error toggling auto-domain:', error);
        showToast('Error updating group', 'error');
    }
}

// Toggle group visibility (private/team)
window.toggleGroupVisibility = async function(groupId, visibility) {
    closeAllGroupMenus();
    
    if (!db || !appState.currentTeamId) return;
    
    try {
        const { doc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const groupRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId);
        await updateDoc(groupRef, { 
            visibility: visibility,
            updatedAt: serverTimestamp()
        });
        
        const msg = visibility === 'private' ? 'Group is now private' : 'Group is now visible to team';
        showToast(msg, 'success');
        
    } catch (error) {
        console.error('Error toggling group visibility:', error);
        showToast('Error updating group visibility', 'error');
    }
};

// Open delete group modal
function openDeleteGroupModal(groupId, groupTitle) {
    closeAllGroupMenus();
    document.getElementById('deleteGroupId').value = groupId;
    document.getElementById('deleteGroupName').textContent = groupTitle;
    document.getElementById('deleteLinkGroupModal').classList.add('active');
}

// Close delete group modal
function closeDeleteLinkGroupModal() {
    document.getElementById('deleteLinkGroupModal').classList.remove('active');
}

// Confirm delete group
async function confirmDeleteLinkGroup() {
    const groupId = document.getElementById('deleteGroupId').value;
    
    if (!db || !appState.currentTeamId || !groupId) return;
    
    try {
        const { doc, deleteDoc, collection, getDocs } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        // Delete all links in the group first
        const linksRef = collection(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links');
        const linksSnapshot = await getDocs(linksRef);
        
        const deletePromises = linksSnapshot.docs.map(linkDoc => 
            deleteDoc(doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links', linkDoc.id))
        );
        await Promise.all(deletePromises);
        
        // Delete the group
        const groupRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId);
        await deleteDoc(groupRef);
        
        showToast('Group deleted!', 'success');
        closeDeleteLinkGroupModal();
        
    } catch (error) {
        console.error('Error deleting group:', error);
        showToast('Error deleting group: ' + error.message, 'error');
    }
}

// ===================================
// LINK LOBBY - Link CRUD Operations
// ===================================

// Open add link modal
function openAddLinkModal(groupId) {
    document.getElementById('linkModalTitle').innerHTML = '<i class="fas fa-link"></i> Add Link';
    document.getElementById('linkId').value = '';
    document.getElementById('linkGroupIdForLink').value = groupId;
    document.getElementById('linkUrl').value = '';
    document.getElementById('linkLabel').value = '';
    document.getElementById('linkPreview').style.display = 'none';
    document.getElementById('linkSubmitBtn').innerHTML = '<i class="fas fa-plus"></i> Add Link';
    document.getElementById('linkModal').classList.add('active');
    
    // Focus the URL input
    setTimeout(() => document.getElementById('linkUrl').focus(), 100);
}

// Close link modal
function closeLinkModal() {
    document.getElementById('linkModal').classList.remove('active');
}

// Update link preview based on URL
function updateLinkPreview() {
    const urlInput = document.getElementById('linkUrl');
    const previewEl = document.getElementById('linkPreview');
    const faviconEl = document.getElementById('linkFaviconPreview');
    const domainEl = document.getElementById('linkDomainPreview');
    
    try {
        const url = new URL(urlInput.value);
        const domain = url.hostname;
        
        faviconEl.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        domainEl.textContent = domain;
        previewEl.style.display = 'flex';
    } catch (e) {
        previewEl.style.display = 'none';
    }
}

// Save link
async function saveLink(event) {
    event.preventDefault();
    
    const groupId = document.getElementById('linkGroupIdForLink').value;
    const urlValue = document.getElementById('linkUrl').value.trim();
    const label = document.getElementById('linkLabel').value.trim();
    
    if (!urlValue || !label) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    // Validate URL
    let url, domain;
    try {
        url = new URL(urlValue);
        domain = url.hostname;
    } catch (e) {
        showToast('Please enter a valid URL', 'error');
        return;
    }
    
    if (!db || !appState.currentTeamId || !groupId) {
        showToast('Not connected to team', 'error');
        return;
    }
    
    try {
        const { collection, addDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const linksRef = collection(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links');
        
        // SECURITY: Only include fields allowed by Firestore rules
        // Allowed: createdBy, url, title, description, domain, favicon, favorite, createdAt, updatedAt
        const newLinkData = {
            url: url.href,
            title: label,  // Rules use 'title', not 'label'
            domain,
            favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,  // Rules use 'favicon', not 'iconUrl'
            favorite: false,
            createdAt: serverTimestamp(),
            createdBy: currentAuthUser.uid
        };
        
        const docRef = await addDoc(linksRef, newLinkData);
        
        // Immediately add the new link to local state and re-render
        const newLink = {
            id: docRef.id,
            ...newLinkData,
            label: label,  // Keep label for backward compat in UI rendering
            iconUrl: newLinkData.favicon,  // Keep iconUrl for backward compat in UI rendering
            createdAt: { toMillis: () => Date.now() } // Fake timestamp for sorting
        };
        
        // Find the group and add the link
        const group = linkLobbyGroups.find(g => g.id === groupId);
        if (group) {
            if (group.autoGroupDomain && domain) {
                if (!group.domainGroups[domain]) {
                    group.domainGroups[domain] = [];
                }
                group.domainGroups[domain].unshift(newLink);
            } else {
                group.links.unshift(newLink);
            }
            renderLinkLobby();
        }
        
        showToast('Link added!', 'success');
        closeLinkModal();
        
    } catch (error) {
        console.error('Error saving link:', error);
        showToast('Error saving link: ' + error.message, 'error');
    }
}

// Toggle link favorite - with instant UI feedback
async function toggleLinkFavorite(groupId, linkId, favorite) {
    if (!db || !appState.currentTeamId) return;
    
    // Immediately update UI for instant feedback
    const linkItem = document.querySelector(`.link-item[data-link-id="${linkId}"][data-group-id="${groupId}"]`);
    if (linkItem) {
        if (favorite) {
            linkItem.classList.add('favorite');
        } else {
            linkItem.classList.remove('favorite');
        }
        
        // Update collapsed state star button
        const collapsedStar = linkItem.querySelector('.link-collapsed-star');
        if (collapsedStar) {
            collapsedStar.classList.toggle('active', favorite);
            collapsedStar.setAttribute('onclick', `event.stopPropagation(); toggleLinkFavorite('${groupId}', '${linkId}', ${!favorite})`);
            collapsedStar.title = favorite ? 'Remove from favorites' : 'Add to favorites';
        }
        
        // Update expanded state star button
        const starBtn = linkItem.querySelector('.link-star-btn');
        if (starBtn) {
            starBtn.classList.toggle('active', favorite);
            starBtn.setAttribute('onclick', `toggleLinkFavorite('${groupId}', '${linkId}', ${!favorite})`);
            starBtn.title = favorite ? 'Remove from favorites' : 'Add to favorites';
        }
    }
    
    // Update local state
    const group = linkLobbyGroups.find(g => g.id === groupId);
    if (group) {
        // Check in regular links
        let link = group.links.find(l => l.id === linkId);
        if (link) {
            link.favorite = favorite;
        } else {
            // Check in domain groups
            for (const domain of Object.keys(group.domainGroups)) {
                link = group.domainGroups[domain].find(l => l.id === linkId);
                if (link) {
                    link.favorite = favorite;
                    break;
                }
            }
        }
    }
    
    try {
        const { doc, updateDoc, serverTimestamp } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const linkRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links', linkId);
        await updateDoc(linkRef, { 
            favorite,
            updatedAt: serverTimestamp()
        });
        
    } catch (error) {
        console.error('Error toggling favorite:', error);
        showToast('Error updating favorite', 'error');
        // Revert UI on error
        renderLinkLobby();
    }
}

// Delete link
async function deleteLink(groupId, linkId) {
    if (!confirm('Delete this link?')) return;
    
    if (!db || !appState.currentTeamId) return;
    
    try {
        const { doc, deleteDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const linkRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId, 'links', linkId);
        await deleteDoc(linkRef);
        
        showToast('Link deleted!', 'success');
        
    } catch (error) {
        console.error('Error deleting link:', error);
        showToast('Error deleting link', 'error');
    }
}

// ===================================
// LINK LOBBY - Drag and Drop
// ===================================

function initGroupDragAndDrop() {
    const container = document.getElementById('linkLobbyContainer');
    if (!container) return;
    
    const groups = container.querySelectorAll('.link-group');
    let draggedGroup = null;
    
    groups.forEach(group => {
        const handle = group.querySelector('.link-group-drag-handle');
        if (!handle) return;
        
        handle.addEventListener('dragstart', (e) => {
            draggedGroup = group;
            group.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', group.dataset.groupId);
        });
        
        handle.addEventListener('dragend', () => {
            draggedGroup = null;
            group.classList.remove('dragging');
            document.querySelectorAll('.link-group.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        
        group.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedGroup && draggedGroup !== group) {
                group.classList.add('drag-over');
            }
        });
        
        group.addEventListener('dragleave', () => {
            group.classList.remove('drag-over');
        });
        
        group.addEventListener('drop', async (e) => {
            e.preventDefault();
            group.classList.remove('drag-over');
            
            if (!draggedGroup || draggedGroup === group) return;
            
            // Reorder in DOM
            const allGroups = [...container.querySelectorAll('.link-group')];
            const draggedIndex = allGroups.indexOf(draggedGroup);
            const dropIndex = allGroups.indexOf(group);
            
            if (draggedIndex < dropIndex) {
                group.after(draggedGroup);
            } else {
                group.before(draggedGroup);
            }
            
            // Update sort orders in Firestore
            await updateGroupSortOrders();
        });
    });
}

// Update sort orders in Firestore
async function updateGroupSortOrders() {
    const container = document.getElementById('linkLobbyContainer');
    if (!container || !db || !appState.currentTeamId) return;
    
    try {
        const { doc, updateDoc } = 
            await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        const groups = container.querySelectorAll('.link-group');
        const updates = [];
        
        groups.forEach((group, index) => {
            const groupId = group.dataset.groupId;
            if (groupId) {
                const groupRef = doc(db, 'teams', appState.currentTeamId, 'linkLobbyGroups', groupId);
                updates.push(updateDoc(groupRef, { sortOrder: index }));
            }
        });
        
        await Promise.all(updates);
        console.log('Group sort orders updated');
        
    } catch (error) {
        console.error('Error updating sort orders:', error);
    }
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Make functions globally accessible
window.openAddGroupModal = openAddGroupModal;
window.openEditGroupModal = openEditGroupModal;
window.closeLinkGroupModal = closeLinkGroupModal;
window.saveLinkGroup = saveLinkGroup;
window.toggleAutoDomain = toggleAutoDomain;
window.openDeleteGroupModal = openDeleteGroupModal;
window.closeDeleteLinkGroupModal = closeDeleteLinkGroupModal;
window.confirmDeleteLinkGroup = confirmDeleteLinkGroup;
window.openAddLinkModal = openAddLinkModal;
window.closeLinkModal = closeLinkModal;
window.saveLink = saveLink;
window.toggleLinkFavorite = toggleLinkFavorite;
window.deleteLink = deleteLink;
window.openLink = openLink;
window.toggleGroupMenu = toggleGroupMenu;
window.toggleDomainSubgroup = toggleDomainSubgroup;
window.toggleLinkExpanded = toggleLinkExpanded;
window.startEditLinkName = startEditLinkName;

// ===================================
// FINANCES TAB FUNCTIONALITY
// ===================================

/**
 * Transaction data model:
 * {
 *   id: string,
 *   type: 'income' | 'expense',
 *   amount: number,
 *   date: timestamp,
 *   description: string,
 *   category: string,
 *   party: string (customer/vendor name),
 *   isRecurring: boolean,
 *   frequency: 'monthly' | 'quarterly' | 'yearly' (if recurring),
 *   notes: string,
 *   createdBy: string (userId),
 *   createdAt: timestamp,
 *   updatedAt: timestamp
 * }
 */

// Category definitions
const FINANCE_CATEGORIES = {
    income: [
        { value: 'sales', label: 'Sales' },
        { value: 'services', label: 'Services' },
        { value: 'subscriptions', label: 'Subscriptions' },
        { value: 'consulting', label: 'Consulting' },
        { value: 'other-income', label: 'Other Income' }
    ],
    expense: [
        { value: 'payroll', label: 'Payroll' },
        { value: 'software', label: 'Software & Tools' },
        { value: 'marketing', label: 'Marketing' },
        { value: 'office', label: 'Office & Equipment' },
        { value: 'travel', label: 'Travel' },
        { value: 'utilities', label: 'Utilities' },
        { value: 'other-expense', label: 'Other Expense' }
    ]
};

/**
 * Initialize finances tab event listeners
 */
function initFinances() {
    // Revenue column buttons
    const addRevenueBtn = document.getElementById('addRevenueBtn');
    const addFirstRevenueBtn = document.getElementById('addFirstRevenueBtn');
    
    if (addRevenueBtn) {
        addRevenueBtn.addEventListener('click', () => openTransactionModal(null, 'income'));
    }
    if (addFirstRevenueBtn) {
        addFirstRevenueBtn.addEventListener('click', () => openTransactionModal(null, 'income'));
    }
    
    // Expense column buttons
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    const addFirstExpenseBtn = document.getElementById('addFirstExpenseBtn');
    
    if (addExpenseBtn) {
        addExpenseBtn.addEventListener('click', () => openTransactionModal(null, 'expense'));
    }
    if (addFirstExpenseBtn) {
        addFirstExpenseBtn.addEventListener('click', () => openTransactionModal(null, 'expense'));
    }
    
    // Placeholder buttons (when no transactions at all)
    const addFirstTransactionBtnRevenue = document.getElementById('addFirstTransactionBtnRevenue');
    const addFirstTransactionBtnExpense = document.getElementById('addFirstTransactionBtnExpense');
    
    if (addFirstTransactionBtnRevenue) {
        addFirstTransactionBtnRevenue.addEventListener('click', () => openTransactionModal(null, 'income'));
    }
    if (addFirstTransactionBtnExpense) {
        addFirstTransactionBtnExpense.addEventListener('click', () => openTransactionModal(null, 'expense'));
    }
    
    // Modal controls
    const closeTransactionModal = document.getElementById('closeTransactionModal');
    const cancelTransactionBtn = document.getElementById('cancelTransactionBtn');
    
    if (closeTransactionModal) {
        closeTransactionModal.addEventListener('click', closeTransactionModalFn);
    }
    if (cancelTransactionBtn) {
        cancelTransactionBtn.addEventListener('click', closeTransactionModalFn);
    }
    
    // Transaction form
    const transactionForm = document.getElementById('transactionForm');
    if (transactionForm) {
        transactionForm.addEventListener('submit', handleTransactionSave);
    }
    
    // Type toggle buttons
    const typeButtons = document.querySelectorAll('.transaction-type-toggle .type-btn');
    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            typeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('transactionType').value = btn.dataset.type;
            
            // Update party label
            const partyLabel = document.getElementById('transactionPartyLabel');
            if (partyLabel) {
                partyLabel.innerHTML = btn.dataset.type === 'income' 
                    ? '<i class="fas fa-user"></i> Customer'
                    : '<i class="fas fa-building"></i> Vendor';
            }
        });
    });
    
    // Recurring toggle
    const recurringToggle = document.getElementById('transactionRecurring');
    if (recurringToggle) {
        recurringToggle.addEventListener('change', (e) => {
            const frequencyField = document.getElementById('recurringFrequencyField');
            if (frequencyField) {
                frequencyField.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }
    
    // Delete confirmation modal
    const closeDeleteTransactionModal = document.getElementById('closeDeleteTransactionModal');
    const cancelDeleteTransaction = document.getElementById('cancelDeleteTransaction');
    const confirmDeleteTransaction = document.getElementById('confirmDeleteTransaction');
    
    if (closeDeleteTransactionModal) {
        closeDeleteTransactionModal.addEventListener('click', closeDeleteTransactionModalFn);
    }
    if (cancelDeleteTransaction) {
        cancelDeleteTransaction.addEventListener('click', closeDeleteTransactionModalFn);
    }
    if (confirmDeleteTransaction) {
        confirmDeleteTransaction.addEventListener('click', handleDeleteTransaction);
    }
    
    // Close modal on background click
    const transactionModal = document.getElementById('transactionModal');
    if (transactionModal) {
        transactionModal.addEventListener('click', (e) => {
            if (e.target === transactionModal) {
                closeTransactionModalFn();
            }
        });
    }
}

/**
 * Open transaction modal for adding or editing
 * @param {Object|null} transaction - Transaction to edit, or null for new
 * @param {string} defaultType - Default transaction type ('income' or 'expense')
 */
function openTransactionModal(transaction = null, defaultType = 'income') {
    const modal = document.getElementById('transactionModal');
    const form = document.getElementById('transactionForm');
    const title = document.getElementById('transactionModalTitle');
    const subtitle = document.getElementById('transactionModalSubtitle');
    
    if (!modal || !form) return;
    
    // Reset form
    form.reset();
    document.getElementById('transactionId').value = '';
    document.getElementById('transactionType').value = defaultType;
    
    // Reset type buttons
    const typeButtons = document.querySelectorAll('.transaction-type-toggle .type-btn');
    typeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === defaultType);
    });
    
    // Reset recurring field
    const frequencyField = document.getElementById('recurringFrequencyField');
    if (frequencyField) {
        frequencyField.style.display = 'none';
    }
    
    // Set default date to today
    const dateInput = document.getElementById('transactionDate');
    if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
    
    // Update party label based on default type
    const partyLabel = document.getElementById('transactionPartyLabel');
    if (partyLabel) {
        partyLabel.innerHTML = defaultType === 'income'
            ? '<i class="fas fa-user"></i> Customer'
            : '<i class="fas fa-building"></i> Vendor';
    }
    
    if (transaction) {
        // Edit mode
        title.innerHTML = '<i class="fas fa-edit"></i> Edit Transaction';
        subtitle.textContent = 'Update transaction details';
        
        // Fill form with transaction data
        document.getElementById('transactionId').value = transaction.id;
        document.getElementById('transactionType').value = transaction.type;
        document.getElementById('transactionAmount').value = transaction.amount;
        document.getElementById('transactionDate').value = transaction.date?.toDate?.()?.toISOString().split('T')[0] || transaction.date;
        document.getElementById('transactionDescription').value = transaction.description || '';
        document.getElementById('transactionCategory').value = transaction.category || '';
        document.getElementById('transactionParty').value = transaction.party || '';
        document.getElementById('transactionRecurring').checked = transaction.isRecurring || false;
        document.getElementById('transactionFrequency').value = transaction.frequency || 'monthly';
        document.getElementById('transactionNotes').value = transaction.notes || '';
        
        // Update type buttons
        typeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === transaction.type);
        });
        
        // Show frequency field if recurring
        if (transaction.isRecurring && frequencyField) {
            frequencyField.style.display = 'block';
        }
        
        // Update party label
        if (partyLabel) {
            partyLabel.innerHTML = transaction.type === 'income'
                ? '<i class="fas fa-user"></i> Customer'
                : '<i class="fas fa-building"></i> Vendor';
        }
    } else {
        // Add mode - customize title based on type
        const typeLabel = defaultType === 'income' ? 'Revenue' : 'Expense';
        title.innerHTML = `<i class="fas fa-plus-circle"></i> New ${typeLabel}`;
        subtitle.textContent = `Record a new ${typeLabel.toLowerCase()} transaction`;
    }
    
    modal.classList.add('active');
}

/**
 * Close transaction modal
 */
function closeTransactionModalFn() {
    const modal = document.getElementById('transactionModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Handle transaction form submission
 */
async function handleTransactionSave(event) {
    event.preventDefault();
    
    if (!db || !appState.currentTeamId || !currentAuthUser) {
        showToast('Unable to save transaction. Please try again.', 'error');
        return;
    }
    
    const transactionId = document.getElementById('transactionId').value;
    const isEdit = !!transactionId;
    
    // Get form values
    const transactionData = {
        type: document.getElementById('transactionType').value,
        amount: parseFloat(document.getElementById('transactionAmount').value) || 0,
        date: new Date(document.getElementById('transactionDate').value),
        description: document.getElementById('transactionDescription').value.trim(),
        category: document.getElementById('transactionCategory').value,
        party: document.getElementById('transactionParty').value.trim(),
        isRecurring: document.getElementById('transactionRecurring').checked,
        frequency: document.getElementById('transactionFrequency').value,
        notes: document.getElementById('transactionNotes').value.trim(),
        updatedAt: new Date()
    };
    
    // Validate
    if (!transactionData.description) {
        showToast('Please enter a description', 'error');
        return;
    }
    if (transactionData.amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    
    try {
        const { doc, collection, addDoc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        
        if (isEdit) {
            // Update existing transaction
            const transactionRef = doc(db, 'teams', appState.currentTeamId, 'transactions', transactionId);
            await updateDoc(transactionRef, {
                ...transactionData,
                updatedAt: serverTimestamp()
            });
            showToast('Transaction updated successfully', 'success');
        } else {
            // Add new transaction
            const transactionsRef = collection(db, 'teams', appState.currentTeamId, 'transactions');
            await addDoc(transactionsRef, {
                ...transactionData,
                createdBy: currentAuthUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            showToast('Transaction added successfully', 'success');
        }
        
        closeTransactionModalFn();
        loadTransactions(); // Refresh the list
        
    } catch (error) {
        console.error('Error saving transaction:', error);
        showToast('Failed to save transaction', 'error');
    }
}

/**
 * Open delete transaction confirmation modal
 */
function openDeleteTransactionModal(transactionId) {
    const modal = document.getElementById('deleteTransactionModal');
    const idInput = document.getElementById('deleteTransactionId');
    
    if (modal && idInput) {
        idInput.value = transactionId;
        modal.classList.add('active');
    }
}

/**
 * Close delete transaction modal
 */
function closeDeleteTransactionModalFn() {
    const modal = document.getElementById('deleteTransactionModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Handle transaction deletion
 */
async function handleDeleteTransaction() {
    const transactionId = document.getElementById('deleteTransactionId').value;
    
    if (!db || !appState.currentTeamId || !transactionId) {
        showToast('Unable to delete transaction', 'error');
        return;
    }
    
    try {
        const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const transactionRef = doc(db, 'teams', appState.currentTeamId, 'transactions', transactionId);
        await deleteDoc(transactionRef);
        
        showToast('Transaction deleted', 'success');
        closeDeleteTransactionModalFn();
        loadTransactions();
        
    } catch (error) {
        console.error('Error deleting transaction:', error);
        showToast('Failed to delete transaction', 'error');
    }
}

/**
 * Load transactions from Firestore
 */
async function loadTransactions() {
    if (!db || !appState.currentTeamId) {
        appState.transactions = [];
        return;
    }
    
    try {
        const { collection, query, orderBy, getDocs } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js');
        const transactionsRef = collection(db, 'teams', appState.currentTeamId, 'transactions');
        const q = query(transactionsRef, orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        
        appState.transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        debugLog('💰 Loaded transactions:', appState.transactions.length);
        renderFinances();
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        appState.transactions = [];
    }
}

/**
 * Apply filters and render finances
 */
function applyFinancesFilters() {
    const typeFilter = document.getElementById('financesTypeFilter')?.value || 'all';
    const categoryFilter = document.getElementById('financesCategoryFilter')?.value || 'all';
    const dateFilter = document.getElementById('financesDateFilter')?.value || 'all';
    const searchFilter = document.getElementById('financesSearchInput')?.value?.toLowerCase() || '';
    
    appState.financesFilters = { type: typeFilter, category: categoryFilter, date: dateFilter, search: searchFilter };
    renderFinances();
}

/**
 * Filter transactions based on current filters
 */
function getFilteredTransactions() {
    const { type, category, date, search } = appState.financesFilters;
    const now = new Date();
    
    return appState.transactions.filter(t => {
        // Type filter
        if (type !== 'all' && t.type !== type) return false;
        
        // Category filter
        if (category !== 'all' && t.category !== category) return false;
        
        // Date filter
        const transactionDate = t.date?.toDate?.() || new Date(t.date);
        if (date !== 'all') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
            const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            
            switch (date) {
                case 'thisMonth':
                    if (transactionDate < startOfMonth) return false;
                    break;
                case 'lastMonth':
                    if (transactionDate < startOfLastMonth || transactionDate > endOfLastMonth) return false;
                    break;
                case 'thisQuarter':
                    if (transactionDate < startOfQuarter) return false;
                    break;
                case 'thisYear':
                case 'ytd':
                    if (transactionDate < startOfYear) return false;
                    break;
            }
        }
        
        // Search filter
        if (search) {
            const searchableText = `${t.description} ${t.party} ${t.category} ${t.notes}`.toLowerCase();
            if (!searchableText.includes(search)) return false;
        }
        
        return true;
    });
}

/**
 * Calculate finance metrics from transactions
 */
function calculateFinanceMetrics(transactions = appState.transactions) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    
    let totalIncome = 0;
    let totalExpenses = 0;
    let mrr = 0;
    let ytdIncome = 0;
    let ytdExpenses = 0;
    const customerTotals = {};
    
    transactions.forEach(t => {
        const amount = t.amount || 0;
        const transactionDate = t.date?.toDate?.() || new Date(t.date);
        
        if (t.type === 'income') {
            totalIncome += amount;
            
            // Track customer totals
            if (t.party) {
                customerTotals[t.party] = (customerTotals[t.party] || 0) + amount;
            }
            
            // YTD income
            if (transactionDate >= startOfYear) {
                ytdIncome += amount;
            }
            
            // MRR calculation - recurring monthly income
            if (t.isRecurring) {
                switch (t.frequency) {
                    case 'monthly':
                        mrr += amount;
                        break;
                    case 'quarterly':
                        mrr += amount / 3;
                        break;
                    case 'yearly':
                        mrr += amount / 12;
                        break;
                }
            }
        } else {
            totalExpenses += amount;
            
            // YTD expenses
            if (transactionDate >= startOfYear) {
                ytdExpenses += amount;
            }
        }
    });
    
    // Find main customer (highest total)
    let mainCustomer = null;
    let maxTotal = 0;
    for (const [customer, total] of Object.entries(customerTotals)) {
        if (total > maxTotal) {
            maxTotal = total;
            mainCustomer = customer;
        }
    }
    
    return {
        totalIncome,
        totalExpenses,
        netBalance: totalIncome - totalExpenses,
        mrr,
        ytdIncome,
        ytdExpenses,
        ytdNet: ytdIncome - ytdExpenses,
        mainCustomer,
        mainCustomerTotal: maxTotal
    };
}

/**
 * Format currency amount
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(amount || 0);
}

/**
 * Get category label from value
 */
function getCategoryLabel(value) {
    const allCategories = [...FINANCE_CATEGORIES.income, ...FINANCE_CATEGORIES.expense];
    const cat = allCategories.find(c => c.value === value);
    return cat?.label || value || 'Uncategorized';
}

/**
 * Render the finances section with two-column layout
 */
function renderFinances() {
    const metrics = calculateFinanceMetrics(appState.transactions);
    
    // Separate transactions by type
    const revenueTransactions = appState.transactions.filter(t => t.type === 'income');
    const expenseTransactions = appState.transactions.filter(t => t.type === 'expense');
    
    // Sort by date descending
    revenueTransactions.sort((a, b) => {
        const dateA = a.date?.toDate?.() || new Date(a.date);
        const dateB = b.date?.toDate?.() || new Date(b.date);
        return dateB - dateA;
    });
    expenseTransactions.sort((a, b) => {
        const dateA = a.date?.toDate?.() || new Date(a.date);
        const dateB = b.date?.toDate?.() || new Date(b.date);
        return dateB - dateA;
    });
    
    // Update metrics cards
    const mrrEl = document.getElementById('mrrValue');
    const ytdIncomeEl = document.getElementById('ytdIncomeValue');
    const netBalanceEl = document.getElementById('netBalanceValue');
    const mainCustomerEl = document.getElementById('mainCustomerValue');
    const mainCustomerTotalEl = document.getElementById('mainCustomerTotal');
    
    if (mrrEl) mrrEl.textContent = formatCurrency(metrics.mrr);
    if (ytdIncomeEl) ytdIncomeEl.textContent = formatCurrency(metrics.ytdIncome);
    if (netBalanceEl) {
        netBalanceEl.textContent = formatCurrency(metrics.netBalance);
        netBalanceEl.className = 'metric-value ' + (metrics.netBalance >= 0 ? 'positive' : 'negative');
    }
    if (mainCustomerEl) {
        mainCustomerEl.textContent = metrics.mainCustomer || 'N/A';
    }
    if (mainCustomerTotalEl) {
        mainCustomerTotalEl.textContent = metrics.mainCustomer ? formatCurrency(metrics.mainCustomerTotal) : '';
    }
    
    // Update column totals
    const revenueTotalEl = document.getElementById('revenueTotalBadge');
    const expensesTotalEl = document.getElementById('expensesTotalBadge');
    
    if (revenueTotalEl) revenueTotalEl.textContent = formatCurrency(metrics.totalIncome);
    if (expensesTotalEl) expensesTotalEl.textContent = formatCurrency(metrics.totalExpenses);
    
    // Check user permissions for add buttons
    const canEditFinances = hasPermission('editFinances');
    
    // Hide/show add buttons based on permissions
    const addRevenueBtn = document.getElementById('addRevenueBtn');
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    if (addRevenueBtn) addRevenueBtn.style.display = canEditFinances ? 'inline-flex' : 'none';
    if (addExpenseBtn) addExpenseBtn.style.display = canEditFinances ? 'inline-flex' : 'none';
    
    // Check if there are any transactions at all
    const hasAnyTransactions = appState.transactions.length > 0;
    const financesContent = document.getElementById('financesContent');
    const financesPlaceholder = document.getElementById('financesPlaceholder');
    
    if (!hasAnyTransactions) {
        // Show the full-page placeholder
        if (financesContent) financesContent.style.display = 'none';
        if (financesPlaceholder) {
            financesPlaceholder.style.display = 'flex';
            // Show/hide buttons based on permissions
            const placeholderBtns = financesPlaceholder.querySelectorAll('button');
            placeholderBtns.forEach(btn => {
                btn.style.display = canEditFinances ? 'inline-flex' : 'none';
            });
        }
        return;
    }
    
    // Show the two-column layout
    if (financesContent) financesContent.style.display = 'flex';
    if (financesPlaceholder) financesPlaceholder.style.display = 'none';
    
    // Render revenue column
    const revenueList = document.getElementById('revenueList');
    const revenueEmptyState = document.getElementById('revenueEmptyState');
    
    if (revenueList) {
        if (revenueTransactions.length === 0) {
            revenueList.innerHTML = '';
            if (revenueEmptyState) {
                revenueEmptyState.style.display = 'flex';
                const addBtn = revenueEmptyState.querySelector('button');
                if (addBtn) addBtn.style.display = canEditFinances ? 'inline-flex' : 'none';
            }
        } else {
            if (revenueEmptyState) revenueEmptyState.style.display = 'none';
            revenueList.innerHTML = revenueTransactions.map(t => renderTransactionRow(t, canEditFinances)).join('');
        }
    }
    
    // Render expenses column
    const expensesList = document.getElementById('expensesList');
    const expensesEmptyState = document.getElementById('expensesEmptyState');
    
    if (expensesList) {
        if (expenseTransactions.length === 0) {
            expensesList.innerHTML = '';
            if (expensesEmptyState) {
                expensesEmptyState.style.display = 'flex';
                const addBtn = expensesEmptyState.querySelector('button');
                if (addBtn) addBtn.style.display = canEditFinances ? 'inline-flex' : 'none';
            }
        } else {
            if (expensesEmptyState) expensesEmptyState.style.display = 'none';
            expensesList.innerHTML = expenseTransactions.map(t => renderTransactionRow(t, canEditFinances)).join('');
        }
    }
    
    // Attach click handlers for expandable rows
    document.querySelectorAll('.transaction-row-main').forEach(row => {
        row.addEventListener('click', (e) => {
            // Don't expand if clicking on action buttons
            if (e.target.closest('.transaction-actions')) return;
            const parentRow = row.closest('.transaction-row');
            if (parentRow) {
                parentRow.classList.toggle('expanded');
            }
        });
    });
}

/**
 * Render a single transaction row with expandable details
 * Collapsed view: Amount (left) | From → To (middle) | Short date (right)
 * Expanded view: Full details including notes, created-by, timestamps
 */
function renderTransactionRow(transaction, canEdit = true) {
    const t = transaction;
    const transactionDate = t.date?.toDate?.() || new Date(t.date);
    // Short date format: Dec 13
    const shortDateStr = transactionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    // Full date for expanded view
    const fullDateStr = transactionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isIncome = t.type === 'income';
    
    // Get creator name from team members
    let addedBy = 'Unknown';
    if (t.createdBy && appState.teamMembers) {
        const creator = appState.teamMembers.find(m => m.id === t.createdBy);
        if (creator) {
            addedBy = creator.displayName || creator.email || 'Unknown';
        }
    }
    
    const createdAtDate = t.createdAt?.toDate?.() || (t.createdAt ? new Date(t.createdAt) : null);
    const createdAtStr = createdAtDate 
        ? createdAtDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
    
    // Build from/to display for collapsed view
    // For income: party is "from" (customer paying)
    // For expense: party is "to" (vendor being paid)
    const fromToDisplay = t.party 
        ? (isIncome ? `from ${escapeHtml(t.party)}` : `to ${escapeHtml(t.party)}`)
        : escapeHtml(t.description);
    
    return `
        <div class="transaction-row" data-id="${t.id}">
            <div class="transaction-row-main">
                <div class="transaction-col-amount">
                    <span class="transaction-amount ${t.type}">${isIncome ? '+' : '-'}${formatCurrency(t.amount)}</span>
                    ${t.isRecurring ? `<span class="transaction-recurring-indicator" title="Recurring ${t.frequency}"><i class="fas fa-sync-alt"></i></span>` : ''}
                </div>
                <div class="transaction-col-from-to">
                    <span class="transaction-from-to">${fromToDisplay}</span>
                    ${t.party && t.description ? `<span class="transaction-desc-sub">${escapeHtml(t.description)}</span>` : ''}
                </div>
                <div class="transaction-col-date">
                    <span class="transaction-date-short">${shortDateStr}</span>
                </div>
                <div class="transaction-col-actions">
                    ${canEdit ? `
                    <div class="transaction-actions">
                        <button class="transaction-action-btn edit" onclick="event.stopPropagation(); editTransaction('${t.id}')" title="Edit">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="transaction-action-btn delete" onclick="event.stopPropagation(); openDeleteTransactionModal('${t.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    ` : ''}
                    <span class="expand-icon"><i class="fas fa-chevron-down"></i></span>
                </div>
            </div>
            <div class="transaction-row-details">
                <div class="transaction-detail-grid">
                    <div class="transaction-detail-item">
                        <span class="detail-label">Date</span>
                        <span class="detail-value">${fullDateStr}</span>
                    </div>
                    ${t.description ? `
                    <div class="transaction-detail-item">
                        <span class="detail-label">Description</span>
                        <span class="detail-value">${escapeHtml(t.description)}</span>
                    </div>
                    ` : ''}
                    ${t.category ? `
                    <div class="transaction-detail-item">
                        <span class="detail-label">Category</span>
                        <span class="detail-value">${getCategoryLabel(t.category)}</span>
                    </div>
                    ` : ''}
                    ${t.party ? `
                    <div class="transaction-detail-item">
                        <span class="detail-label">${isIncome ? 'Customer' : 'Vendor'}</span>
                        <span class="detail-value">${escapeHtml(t.party)}</span>
                    </div>
                    ` : ''}
                    ${t.isRecurring ? `
                    <div class="transaction-detail-item">
                        <span class="detail-label">Recurring</span>
                        <span class="detail-value">${t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1)}</span>
                    </div>
                    ` : ''}
                    ${t.notes ? `
                    <div class="transaction-detail-item full-width">
                        <span class="detail-label">Notes</span>
                        <span class="detail-value">${escapeHtml(t.notes)}</span>
                    </div>
                    ` : ''}
                    <div class="transaction-detail-item">
                        <span class="detail-label">Added By</span>
                        <span class="detail-value">${escapeHtml(addedBy)}</span>
                    </div>
                    ${createdAtStr ? `
                    <div class="transaction-detail-item">
                        <span class="detail-label">Added On</span>
                        <span class="detail-value">${createdAtStr}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Update category filter options based on transaction types
 */
function updateCategoryFilterOptions() {
    const categoryFilter = document.getElementById('financesCategoryFilter');
    if (!categoryFilter) return;
    
    const typeFilter = document.getElementById('financesTypeFilter')?.value || 'all';
    const currentValue = categoryFilter.value;
    
    categoryFilter.innerHTML = '<option value="all">All Categories</option>';
    
    if (typeFilter === 'all' || typeFilter === 'income') {
        const incomeGroup = document.createElement('optgroup');
        incomeGroup.label = 'Income';
        FINANCE_CATEGORIES.income.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.value;
            option.textContent = cat.label;
            incomeGroup.appendChild(option);
        });
        categoryFilter.appendChild(incomeGroup);
    }
    
    if (typeFilter === 'all' || typeFilter === 'expense') {
        const expenseGroup = document.createElement('optgroup');
        expenseGroup.label = 'Expense';
        FINANCE_CATEGORIES.expense.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.value;
            option.textContent = cat.label;
            expenseGroup.appendChild(option);
        });
        categoryFilter.appendChild(expenseGroup);
    }
    
    // Restore previous selection if still valid
    if (currentValue && categoryFilter.querySelector(`option[value="${currentValue}"]`)) {
        categoryFilter.value = currentValue;
    }
}

/**
 * Edit transaction
 */
function editTransaction(transactionId) {
    const transaction = appState.transactions.find(t => t.id === transactionId);
    if (transaction) {
        openTransactionModal(transaction);
    }
}

/**
 * Get finance data for metrics integration
 */
function getFinanceMetricsData() {
    return calculateFinanceMetrics(appState.transactions);
}

// Expose functions to window for inline onclick handlers
window.editTransaction = editTransaction;
window.openDeleteTransactionModal = openDeleteTransactionModal;

// ===================================
// INITIALIZATION
// ===================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('TeamHub App Initializing...');
    
    // Check for join code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join');
    if (joinCode) {
        // Store the join code to process after auth
        sessionStorage.setItem('pendingJoinCode', joinCode.toUpperCase());
        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Initialize Firebase Authentication first
    // Note: initializeUserTeam() is now called inside onAuthStateChanged
    await initializeFirebaseAuth();
    
    // Initialize all modules
    initNavigation();
    initChat();
    initCalendar();
    initTasks();
    initTeam();
    initActivityFeed();
    initModals();
    initSearch();
    initSettings();
    initJoinTeamModal(); // Initialize join team modal
    initLinkLobby(); // Initialize Link Lobby
    initFinances(); // Initialize Finances tab
    startActivityRefreshTimer(); // Start periodic refresh of activity times
    
    console.log('TeamHub App Ready!');
    
    // Show welcome message
    setTimeout(() => {
        console.log('%c Welcome to TeamHub! ', 'background: #0078D4; color: white; font-size: 16px; padding: 10px;');
        console.log('User authenticated. All features are ready to use.');
    }, 500);
});

// ===================================
// EXPORT FOR TESTING (if needed)
// ===================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        appState,
        formatTime,
        getTimeAgo,
        escapeHtml
    };
}
