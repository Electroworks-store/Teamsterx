/* ===================================
   TEAMSTERX LOADER CONTROLLER
   Controls showing/hiding the loader
   =================================== */

/**
 * Initialize the loader - call this early in your app
 */
function initLoader() {
    // Loader HTML is already in index.html
    // This function sets up the hide mechanism
}

/**
 * Show the loader
 */
function showLoader() {
    const loader = document.getElementById('teamsterxLoader');
    if (loader) {
        const isDark = (typeof window !== 'undefined' && window.__isDarkPreferred !== undefined)
            ? window.__isDarkPreferred
            : !!(document.body && document.body.classList.contains('dark-mode'));
        loader.classList.remove('lock-light', 'lock-dark');
        loader.classList.add(isDark ? 'lock-dark' : 'lock-light');
        loader.classList.remove('hidden');
    }
}

/**
 * Hide the loader with a smooth fade out
 * @param {number} delay - Optional delay in ms before hiding (default: 0)
 */
function hideLoader(delay = 0) {
    setTimeout(() => {
        const loader = document.getElementById('teamsterxLoader');
        if (loader) {
            loader.classList.remove('lock-light', 'lock-dark');
            loader.classList.add('hidden');
        }
    }, delay);
}

/**
 * Force hide loader immediately (for error states)
 */
function forceHideLoader() {
    const loader = document.getElementById('teamsterxLoader');
    if (loader) {
        loader.classList.remove('lock-light', 'lock-dark');
        loader.style.display = 'none';
    }
}

// Auto-hide loader after max timeout (failsafe)
// Prevents infinite loading if something goes wrong
const LOADER_MAX_TIMEOUT = 10000; // 10 seconds max

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        hideLoader();
    }, LOADER_MAX_TIMEOUT);
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { showLoader, hideLoader, forceHideLoader };
}
