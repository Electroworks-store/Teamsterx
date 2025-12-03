// ===================================
// FIREBASE AUTHENTICATION HANDLER
// ===================================

// Wait for Firebase to be initialized
let auth, googleProvider;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Firebase initialization
    await waitForFirebase();
    
    auth = window.firebaseAuth;
    googleProvider = window.googleProvider;
    
    // Initialize all event listeners
    initializeFormListeners();
    
    // Check if user is already logged in
    checkAuthState();
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
    // Toggle between forms
    document.getElementById('showSignUpBtn').addEventListener('click', (e) => {
        e.preventDefault();
        showSignUpForm();
    });

    document.getElementById('showSignInBtn').addEventListener('click', (e) => {
        e.preventDefault();
        showSignInForm();
    });

    document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
        e.preventDefault();
        showResetForm();
    });

    document.getElementById('backToSignInBtn').addEventListener('click', (e) => {
        e.preventDefault();
        showSignInForm();
    });

    // Sign In Form
    document.getElementById('emailSignInForm').addEventListener('submit', handleEmailSignIn);

    // Sign Up Form
    document.getElementById('emailSignUpForm').addEventListener('submit', handleEmailSignUp);

    // Password Reset Form
    document.getElementById('emailResetForm').addEventListener('submit', handlePasswordReset);

    // Google Sign In
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('googleSignUpBtn').addEventListener('click', handleGoogleSignIn);

    // Alert close button
    document.getElementById('alertClose').addEventListener('click', hideAlert);
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

    showLoading(true);

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

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);

    } catch (error) {
        console.error('Sign in error:', error);
        showAlert(getErrorMessage(error.code), 'error');
    } finally {
        showLoading(false);
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
        showAlert('Passwords do not match', 'error');
        return;
    }

    if (password.length < 6) {
        showAlert('Password must be at least 6 characters', 'error');
        return;
    }

    if (!agreeTerms) {
        showAlert('Please agree to the Terms & Conditions', 'error');
        return;
    }

    showLoading(true);

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

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);

    } catch (error) {
        console.error('Sign up error:', error);
        showAlert(getErrorMessage(error.code), 'error');
    } finally {
        showLoading(false);
    }
}

// Google Sign In
async function handleGoogleSignIn() {
    showLoading(true);

    try {
        // Import Firebase Auth functions
        const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');

        // Sign in with Google popup
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        showAlert('Sign in successful! Redirecting...', 'success');

        // Save user info to localStorage
        saveUserToStorage(user);

        // Redirect to main app after short delay
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);

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
        showLoading(false);
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

    showLoading(true);

    try {
        // Import Firebase Auth functions
        const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js');

        await sendPasswordResetEmail(auth, email);

        showAlert('Password reset email sent! Check your inbox.', 'success');

        // Clear form and go back to sign in after delay
        setTimeout(() => {
            document.getElementById('resetEmail').value = '';
            showSignInForm();
        }, 3000);

    } catch (error) {
        console.error('Password reset error:', error);
        showAlert(getErrorMessage(error.code), 'error');
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
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

// Show Alert Message
function showAlert(message, type = 'info') {
    const alertBox = document.getElementById('alertBox');
    const alertMessage = document.getElementById('alertMessage');
    const alertIcon = alertBox.querySelector('i');

    // Set message
    alertMessage.textContent = message;

    // Set icon based on type
    alertIcon.className = 'fas';
    switch (type) {
        case 'success':
            alertIcon.classList.add('fa-check-circle');
            alertBox.className = 'alert alert-success';
            break;
        case 'error':
            alertIcon.classList.add('fa-exclamation-circle');
            alertBox.className = 'alert alert-error';
            break;
        case 'warning':
            alertIcon.classList.add('fa-exclamation-triangle');
            alertBox.className = 'alert alert-warning';
            break;
        default:
            alertIcon.classList.add('fa-info-circle');
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
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-credential': 'Invalid email or password. Please try again.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/popup-closed-by-user': 'Sign-in cancelled.',
        'auth/cancelled-popup-request': 'Sign-in cancelled.',
        'auth/popup-blocked': 'Popup blocked. Please allow popups for this site.'
    };

    return errorMessages[errorCode] || 'An error occurred. Please try again.';
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
