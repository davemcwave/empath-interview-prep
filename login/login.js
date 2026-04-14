/**
 * Login Page — Magic Link Flow
 *
 * Handles:
 * 1. Sending the magic link email
 * 2. Completing sign-in when user returns from the link
 * 3. Redirecting to /portal/ or /admin/ based on role
 */
(function () {
  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('email');
  var sendBtn = document.getElementById('sendBtn');
  var linkSentEl = document.getElementById('linkSent');
  var sentEmailEl = document.getElementById('sentEmail');
  var signingInEl = document.getElementById('signingIn');
  var loginErrorEl = document.getElementById('loginError');
  var errorTextEl = document.getElementById('errorText');
  var retryBtn = document.getElementById('retryBtn');
  var errorRetryBtn = document.getElementById('errorRetryBtn');

  var STORAGE_KEY = 'empathSignInEmail';

  var actionCodeSettings = {
    url: window.location.origin + '/login/',
    handleCodeInApp: true
  };

  // ------------------------------------------------------------------
  // Check if user is already signed in
  // ------------------------------------------------------------------
  auth.onAuthStateChanged(function (user) {
    if (user && !firebase.auth().isSignInWithEmailLink(window.location.href)) {
      redirectUser(user);
    }
  });

  // ------------------------------------------------------------------
  // Check if we're returning from a magic link
  // ------------------------------------------------------------------
  if (firebase.auth().isSignInWithEmailLink(window.location.href)) {
    completeSignIn();
  }

  // ------------------------------------------------------------------
  // Send magic link
  // ------------------------------------------------------------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    if (!email) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    auth.sendSignInLinkToEmail(email, actionCodeSettings)
      .then(function () {
        localStorage.setItem(STORAGE_KEY, email);
        showStep('linkSent');
        sentEmailEl.textContent = email;
      })
      .catch(function (err) {
        console.error('Send link error:', err);
        showError(friendlyError(err));
      })
      .finally(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Sign-In Link';
      });
  });

  // ------------------------------------------------------------------
  // Complete sign-in from magic link
  // ------------------------------------------------------------------
  function completeSignIn() {
    showStep('signingIn');

    var email = localStorage.getItem(STORAGE_KEY);

    if (!email) {
      // User opened the link on a different device/browser
      email = prompt('Please enter your email to confirm sign-in:');
      if (!email) {
        showError('Sign-in cancelled. Please try again.');
        return;
      }
    }

    auth.signInWithEmailLink(email, window.location.href)
      .then(function (result) {
        localStorage.removeItem(STORAGE_KEY);
        // Clean the URL (remove magic link params)
        window.history.replaceState(null, '', '/login/');
        redirectUser(result.user);
      })
      .catch(function (err) {
        console.error('Sign-in error:', err);
        showError(friendlyError(err));
      });
  }

  // ------------------------------------------------------------------
  // Redirect based on role
  // ------------------------------------------------------------------
  function redirectUser(user) {
    db.collection('users').doc(user.uid).get()
      .then(function (snap) {
        if (snap.exists && snap.data().role === 'admin') {
          window.location.replace('/admin/');
        } else {
          window.location.replace('/portal/');
        }
      })
      .catch(function () {
        // If we can't read the doc yet (first-time user), auth-guard handles it
        window.location.replace('/portal/');
      });
  }

  // ------------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------------
  function showStep(stepId) {
    form.hidden = true;
    linkSentEl.hidden = true;
    signingInEl.hidden = true;
    loginErrorEl.hidden = true;
    document.getElementById(stepId).hidden = false;
  }

  function showError(message) {
    errorTextEl.textContent = message;
    showStep('loginError');
  }

  function resetToForm() {
    showStep(null); // hide all
    form.hidden = false;
    linkSentEl.hidden = true;
    signingInEl.hidden = true;
    loginErrorEl.hidden = true;
  }

  function friendlyError(err) {
    switch (err.code) {
      case 'auth/invalid-action-code':
        return 'This sign-in link has expired or was already used. Please request a new one.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a few minutes and try again.';
      default:
        return err.message || 'An unexpected error occurred. Please try again.';
    }
  }

  // Retry buttons
  retryBtn.addEventListener('click', resetToForm);
  errorRetryBtn.addEventListener('click', resetToForm);

  // Show form by default (unless completeSignIn already switched the view)
  function showStep(id) {
    form.hidden = true;
    linkSentEl.hidden = true;
    signingInEl.hidden = true;
    loginErrorEl.hidden = true;
    if (id) document.getElementById(id).hidden = false;
  }
})();
