// ===================================
// FIREBASE AUTHENTICATION HANDLER
// ===================================

// Wait for Firebase to be initialized
let auth, googleProvider;

/**
 * Get the correct app URL for redirects
 * Uses hash routing for static hosts (GitHub Pages)
 */
function getAppUrl() {
    // Hash route keeps SPA working on static hosts like GitHub Pages
    return '/#/app';
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Firebase initialization
    await waitForFirebase();
    
    auth = window.firebaseAuth;
    googleProvider = window.googleProvider;
    
    // Check for Firebase Auth redirect (password reset, email verification, etc.)
    const handled = await handleAuthRedirect();
    
    // Initialize all event listeners
    initializeFormListeners();
    
    // If we handled a redirect, don't check auth state (user is resetting password)
    if (!handled) {
        // Check if user is already logged in
        checkAuthState();
    }
});

// Wait for Firebase to initialize
function waitForFirebase() {
    return new Promise((resolve) => {
        const checkFirebase = setInterval(() => {
            if (window.firebaseAuth) {
                clearInterval(checkFirebase);
                resolve();
            }
        }, 100);
    });
}

// ===================================
// FIREBASE AUTH REDIRECT HANDLER
// Handles password reset, email verification links
// ===================================

/**
 * Handle Firebase Auth redirects (password reset, email verification, etc.)
 * Called when the page loads to check for action codes in URL
 * @returns {boolean} True if a redirect was handled
 */
async function handleAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const actionCode = params.get('oobCode');
    
    // If no mode or actionCode, nothing to handle
    if (!mode || !actionCode) {
        return false;
    }
    
    console.log('[Auth] Detected auth redirect:', mode);
    
    // Handle password reset
    if (mode === 'resetPassword') {
        await handlePasswordResetRedirect(actionCode);
        return true;
    }
    
    // Handle email verification (optional - can be expanded later)
    if (mode === 'verifyEmail') {
        await handleEmailVerificationRedirect(actionCode);
        return true;
    }
    
    // Handle email recovery (optional - can be expanded later)
    if (mode === 'recoverEmail') {
        console.log('[Auth] Email recovery detected - not yet implemented');
        return false;
    }
    
    return false;
}

/**
 * Handle password reset redirect
 * Shows the "Set New Password" form and handles submission
 * @param {string} actionCode - The oobCode from the URL
 */
async function handlePasswordResetRedirect(actionCode) {
    try {
        const { verifyPasswordResetCode, confirmPasswordReset } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
        
        // Verify the action code is valid
        const email = await verifyPasswordResetCode(auth, actionCode);
        console.log('[Auth] Password reset code verified for:', email);
        
        // Hide all forms and show the new password form
        hideAllForms();
        const setNewPasswordForm = document.getElementById('setNewPasswordForm');
        if (setNewPasswordForm) {
            setNewPasswordForm.classList.add('active');
        }
        
        // Setup the form submit handler
        const newPasswordForm = document.getElementById('newPasswordForm');
        if (newPasswordForm) {
            newPasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const newPassword = document.getElementById('newPassword').value;
                const confirmPassword = document.getElementById('confirmNewPassword').value;
                
                // Validate passwords match
                if (newPassword !== confirmPassword) {
                    showAlert('Passwords do not match. Please try again.', 'error');
                    return;
                }
                
                // Validate password strength
                if (newPassword.length < 6) {
                    showAlert('Password must be at least 6 characters.', 'error');
                    return;
                }
                
                // Check password complexity
                const strength = checkPasswordStrength(newPassword);
                if (strength < 3) {
                    showAlert('Password needs more complexity: use uppercase, lowercase, numbers, or special characters.', 'error');
                    return;
                }
                
                showLoading(true);
                
                try {
                    // Confirm the password reset with Firebase
                    await confirmPasswordReset(auth, actionCode, newPassword);
                    
                    showAlert('Password changed successfully! Please sign in with your new password.', 'success');
                    
                    // Clear URL params and redirect to sign in
                    setTimeout(() => {
                        // Remove query params from URL
                        window.history.replaceState({}, document.title, window.location.pathname);
                        showSignInForm();
                    }, 2000);
                    
                } catch (error) {
                    console.error('[Auth] Password reset confirmation failed:', error);
                    
                    if (error.code === 'auth/expired-action-code') {
                        showAlert('This reset link has expired. Please request a new one.', 'error');
                    } else if (error.code === 'auth/invalid-action-code') {
                        showAlert('This reset link is invalid or has already been used.', 'error');
                    } else if (error.code === 'auth/weak-password') {
                        showAlert('Password is too weak. Please use a stronger password.', 'error');
                    } else {
                        showAlert('Failed to reset password. Please try again.', 'error');
                    }
                } finally {
                    showLoading(false);
                }
            });
        }
        
        // Setup back to sign in link
        const backToSignInFromReset = document.getElementById('backToSignInFromReset');
        if (backToSignInFromReset) {
            backToSignInFromReset.addEventListener('click', (e) => {
                e.preventDefault();
                // Clear URL params
                window.history.replaceState({}, document.title, window.location.pathname);
                showSignInForm();
            });
        }
        
    } catch (error) {
        console.error('[Auth] Password reset code verification failed:', error);
        
        if (error.code === 'auth/expired-action-code') {
            showAlert('This reset link has expired. Please request a new one.', 'error');
        } else if (error.code === 'auth/invalid-action-code') {
            showAlert('This reset link is invalid or has already been used.', 'error');
        } else {
            showAlert('Invalid reset link. Please request a new password reset.', 'error');
        }
        
        // Show the reset password form so user can request a new link
        showResetForm();
    }
}

/**
 * Handle email verification redirect
 * @param {string} actionCode - The oobCode from the URL
 */
async function handleEmailVerificationRedirect(actionCode) {
    try {
        const { applyActionCode } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
        
        // Apply the email verification code
        await applyActionCode(auth, actionCode);
        
        showAlert('Email verified successfully! You can now sign in.', 'success');
        
        // Clear URL params and show sign in
        setTimeout(() => {
            window.history.replaceState({}, document.title, window.location.pathname);
            showSignInForm();
        }, 2000);
        
    } catch (error) {
        console.error('[Auth] Email verification failed:', error);
        
        if (error.code === 'auth/expired-action-code') {
            showAlert('This verification link has expired.', 'error');
        } else if (error.code === 'auth/invalid-action-code') {
            showAlert('This verification link is invalid or has already been used.', 'error');
        } else {
            showAlert('Email verification failed. Please try again.', 'error');
        }
        
        showSignInForm();
    }
}

// ===================================
// FORM TOGGLE FUNCTIONS
// ===================================
function showSignUpForm() {
    hideAllForms();
    document.getElementById('signUpForm').classList.add('active');
}

function showSignInForm() {
    hideAllForms();
    document.getElementById('signInForm').classList.add('active');
}

function showResetForm() {
    hideAllForms();
    document.getElementById('resetPasswordForm').classList.add('active');
}

function hideAllForms() {
    document.querySelectorAll('.auth-form').forEach(form => {
        form.classList.remove('active');
    });
}

// ===================================
// EVENT LISTENERS
// ===================================
function initializeFormListeners() {
    // Toggle between forms - use optional chaining to avoid null errors
    document.getElementById('showSignUpBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignUpForm();
    });

    document.getElementById('showSignInBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignInForm();
    });

    document.getElementById('forgotPasswordLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        showResetForm();
    });

    document.getElementById('backToSignInBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignInForm();
    });

    // Sign In Form
    document.getElementById('emailSignInForm')?.addEventListener('submit', handleEmailSignIn);

    // Sign Up Form
    document.getElementById('emailSignUpForm')?.addEventListener('submit', handleEmailSignUp);

    // Password Reset Form
    document.getElementById('emailResetForm')?.addEventListener('submit', handlePasswordReset);

    // Google Sign In
    document.getElementById('googleSignInBtn')?.addEventListener('click', handleGoogleSignIn);
    document.getElementById('googleSignUpBtn')?.addEventListener('click', handleGoogleSignIn);

    // Alert close button
    document.getElementById('alertClose')?.addEventListener('click', hideAlert);
}

// ===================================
// AUTHENTICATION HANDLERS
// ===================================

// Email/Password Sign In
async function handleEmailSignIn(e) {
    e.preventDefault();
    
    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    if (!email || !password) {
        showAlert('Please fill in all fields', 'error');
        return;
    }

    let keepLoader = false;

    try {
        // Import Firebase Auth functions
        const { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');
        
        // Set persistence based on remember me checkbox
        const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistence);

        // Sign in
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        showAlert('Sign in successful! Redirecting...', 'success');
        
        // Save user info to localStorage
        saveUserToStorage(user);

        // Show loader only after successful sign-in
        showLoading(true);
        // Keep loader visible through redirect to app
        keepLoader = true;

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = getAppUrl();
        }, 500);

    } catch (error) {
        console.error('Sign in error:', error);
        keepLoader = false;
        showLoading(false);
        const passwordField = document.getElementById('signInPassword');
        if (passwordField) {
            passwordField.value = '';
            passwordField.focus();
        }
        const errorCode = error?.code || '';
        const message = getErrorMessage(errorCode) || 'Sign-in failed. Please check your details and try again.';
        showAlert(message, 'error');
    } finally {
        if (!keepLoader) {
            showLoading(false);
        }
    }
}

// Email/Password Sign Up
async function handleEmailSignUp(e) {
    e.preventDefault();

    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const confirmPassword = document.getElementById('signUpPasswordConfirm').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;

    // Validation
    if (!name || !email || !password || !confirmPassword) {
        showAlert('Please fill in all fields', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showAlert('Passwords do not match. Please re-enter them.', 'error');
        return;
    }

    // Password strength validation - minimum 8 characters with complexity
    if (password.length < 8) {
        showAlert('Password must be at least 8 characters', 'error');
        return;
    }
    
    // Check password complexity (at least 3 of: lowercase, uppercase, number, special char)
    const strength = checkPasswordStrength(password);
    if (strength < 3) {
        showAlert('Password needs more complexity: use uppercase, lowercase, numbers, or special characters', 'error');
        return;
    }

    if (!agreeTerms) {
        showAlert('Please accept the Terms of Service to continue.', 'error');
        return;
    }

    showLoading(true);
    let keepLoader = false;

    try {
        // Import Firebase Auth functions
        const { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');

        // Create user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update profile with display name
        await updateProfile(user, {
            displayName: name
        });

        // Send verification email (optional)
        // await sendEmailVerification(user);

        showAlert('Account created successfully! Redirecting...', 'success');

        // Save user info to localStorage
        saveUserToStorage(user);

        // Keep loader visible through redirect to app
        keepLoader = true;

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = getAppUrl();
        }, 500);

    } catch (error) {
        console.error('Sign up error:', error);
        const errorCode = error?.code || '';
        if (errorCode === 'auth/email-already-in-use') {
            showAlert('An account with this email already exists. Please sign in instead.', 'error');
        } else {
            const message = getErrorMessage(errorCode) || 'Sign up failed. Please try again.';
            showAlert(message, 'error');
        }
    } finally {
        if (!keepLoader) {
            showLoading(false);
        }
    }
}

// Google Sign In
async function handleGoogleSignIn() {
    showLoading(true);
    let keepLoader = false;

    try {
        // Import Firebase Auth functions
        const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');

        // Sign in with Google popup
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        showAlert('Sign in successful! Redirecting...', 'success');

        // Save user info to localStorage
        saveUserToStorage(user);

        // Keep loader visible through redirect to app
        keepLoader = true;

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = getAppUrl();
        }, 500);

    } catch (error) {
        console.error('Google sign in error:', error);
        
        // Handle specific Google sign-in errors
        if (error.code === 'auth/popup-closed-by-user') {
            showAlert('Sign in cancelled', 'info');
        } else if (error.code === 'auth/popup-blocked') {
            showAlert('Popup was blocked. Please allow popups for this site', 'error');
        } else {
            showAlert(getErrorMessage(error.code), 'error');
        }
    } finally {
        if (!keepLoader) {
            showLoading(false);
        }
    }
}

// Password Reset
async function handlePasswordReset(e) {
    e.preventDefault();

    const email = document.getElementById('resetEmail').value.trim();

    if (!email) {
        showAlert('Please enter your email address', 'error');
        return;
    }

    if (!isValidEmail(email)) {
        showAlert('Please enter a valid email address', 'error');
        return;
    }

    showLoading(true);

    try {
        // Import Firebase Auth functions
        const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');

        // Send password reset email
        await sendPasswordResetEmail(auth, email, {
            url: window.location.origin + '/account.html',
            handleCodeInApp: true
        });

        console.log('Password reset email sent successfully to:', email);
        showAlert('Password reset email sent! Please check your inbox and spam folder.', 'success');

        // Clear form and go back to sign in after delay
        setTimeout(() => {
            document.getElementById('resetEmail').value = '';
            showSignInForm();
        }, 3000);

    } catch (error) {
        console.error('Password reset error:', error);
        
        // Handle specific errors
        if (error.code === 'auth/user-not-found') {
            showAlert('No account found with this email address.', 'error');
        } else if (error.code === 'auth/invalid-email') {
            showAlert('Please enter a valid email address.', 'error');
        } else if (error.code === 'auth/too-many-requests') {
            showAlert('Too many reset attempts. Please try again later.', 'error');
        } else {
            const message = getErrorMessage(error.code) || 'Failed to send reset email. Please try again.';
            showAlert(message, 'error');
        }
    } finally {
        showLoading(false);
    }
}

// ===================================
// AUTH STATE MANAGEMENT
// ===================================
function checkAuthState() {
    // Import onAuthStateChanged
    import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js')
        .then(({ onAuthStateChanged }) => {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    // User is signed in, redirect to main app
                    console.log('User already signed in');
                    // Uncomment to auto-redirect
                    // window.location.href = 'index.html';
                } else {
                    // User is signed out
                    console.log('No user signed in');
                }
            });
        });
}

// Save user info to localStorage
function saveUserToStorage(user) {
    const userInfo = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null,
        emailVerified: user.emailVerified
    };

    localStorage.setItem('teamhub_user', JSON.stringify(userInfo));
    localStorage.setItem('teamhub_auth_time', Date.now().toString());
}

// ===================================
// UI HELPER FUNCTIONS
// ===================================

// Show/Hide Loading Overlay
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    const loaderEl = document.getElementById('teamsterxLoader');
    const hasLoaderAPI = typeof window !== 'undefined' && (window.showLoader || window.hideLoader);
    if (show) {
        if (hasLoaderAPI && window.showLoader) {
            window.showLoader();
        } else if (loaderEl) {
            loaderEl.classList.remove('hidden');
        }
        if (overlay) overlay.classList.add('active');
    } else {
        if (hasLoaderAPI && window.hideLoader) {
            window.hideLoader();
        } else if (loaderEl) {
            loaderEl.classList.add('hidden');
        }
        if (overlay) overlay.classList.remove('active');
    }
}

// Show Alert Message
function showAlert(message, type = 'info') {
    const alertBox = document.getElementById('alertBox');
    const alertMessage = document.getElementById('alertMessage');
    
    if (!alertBox || !alertMessage) {
        // Fallback: log to console and use browser alert
        console.error('Auth error:', message);
        alert(message);
        return;
    }
    
    const alertIcon = alertBox.querySelector('i');

    // Set message
    alertMessage.textContent = message;

    // Set icon based on type
    if (alertIcon) {
        alertIcon.className = 'fas';
        switch (type) {
            case 'success':
                alertIcon.classList.add('fa-check-circle');
                break;
            case 'error':
                alertIcon.classList.add('fa-exclamation-circle');
                break;
            case 'warning':
                alertIcon.classList.add('fa-exclamation-triangle');
                break;
            default:
                alertIcon.classList.add('fa-info-circle');
        }
    }
    
    // Set alert box class based on type
    switch (type) {
        case 'success':
            alertBox.className = 'alert alert-success';
            break;
        case 'error':
            alertBox.className = 'alert alert-error';
            break;
        case 'warning':
            alertBox.className = 'alert alert-warning';
            break;
        default:
            alertBox.className = 'alert alert-info';
    }

    // Show alert
    alertBox.classList.add('active');

    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideAlert();
    }, 5000);
}

// Hide Alert
function hideAlert() {
    const alertBox = document.getElementById('alertBox');
    alertBox.classList.remove('active');
}

// Get user-friendly error messages
function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/operation-not-allowed': 'This sign-in method is not enabled.',
        'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/user-not-found': 'Invalid email or password. Please try again.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-credential': 'Invalid email or password. Please try again.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/popup-closed-by-user': 'Sign-in cancelled.',
        'auth/cancelled-popup-request': 'Sign-in cancelled.',
        'auth/popup-blocked': 'Popup blocked. Please allow popups for this site.'
    };

    return errorMessages[errorCode] || '';
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

// Email validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Password strength indicator (optional enhancement)
function checkPasswordStrength(password) {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]+/)) strength++;
    if (password.match(/[A-Z]+/)) strength++;
    if (password.match(/[0-9]+/)) strength++;
    if (password.match(/[$@#&!]+/)) strength++;

    return strength;
}