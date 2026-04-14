/**
 * Login Page
 * Default: email → send magic link
 * Alt: "I have a password" → email + password form
 * Alt: Google sign-in button
 */
(function () {
  var VIEWS = ['viewEmail', 'viewPassword', 'viewLinkSent', 'viewSigningIn', 'viewError'];
  var STORAGE_KEY = 'empathSignInEmail';

  var actionCodeSettings = {
    url: window.location.origin + '/login/',
    handleCodeInApp: true
  };

  // Check if redirected here after being rejected
  if (window.location.search.includes('error=not-authorized')) {
    showError('Your account hasn\'t been set up yet. Please contact empathinterviews@gmail.com to get access.');
    window.history.replaceState(null, '', '/login/');
  }

  // Already signed in? Redirect.
  auth.onAuthStateChanged(function (user) {
    if (user && !firebase.auth().isSignInWithEmailLink(window.location.href)) {
      redirectUser(user);
    }
  });

  // Returning from a magic link?
  if (firebase.auth().isSignInWithEmailLink(window.location.href)) {
    showView('viewSigningIn');
    var email = localStorage.getItem(STORAGE_KEY);
    if (!email) {
      email = prompt('Please enter your email to confirm sign-in:');
      if (!email) { showError('Sign-in cancelled.'); return; }
    }
    auth.signInWithEmailLink(email, window.location.href)
      .then(function (result) {
        localStorage.removeItem(STORAGE_KEY);
        window.history.replaceState(null, '', '/login/');
        redirectUser(result.user);
      })
      .catch(function (err) { showError(friendlyError(err)); });
  }

  // ------------------------------------------------------------------
  // Send magic link
  // ------------------------------------------------------------------
  document.getElementById('emailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var btn = document.getElementById('sendLinkBtn');

    btn.disabled = true;
    btn.textContent = 'Sending...';

    auth.sendSignInLinkToEmail(email, actionCodeSettings)
      .then(function () {
        localStorage.setItem(STORAGE_KEY, email);
        showView('viewLinkSent');
        document.getElementById('sentEmail').textContent = email;
      })
      .catch(function (err) { showError(friendlyError(err)); })
      .finally(function () { btn.disabled = false; btn.textContent = 'Send Sign-In Link'; });
  });

  // ------------------------------------------------------------------
  // Email + password
  // ------------------------------------------------------------------
  document.getElementById('passwordForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('pwEmail').value.trim();
    var password = document.getElementById('password').value;
    var btn = document.getElementById('passwordBtn');

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    auth.signInWithEmailAndPassword(email, password)
      .then(function (result) { redirectUser(result.user); })
      .catch(function (err) { showError(friendlyError(err)); })
      .finally(function () { btn.disabled = false; btn.textContent = 'Sign In'; });
  });

  // ------------------------------------------------------------------
  // Google
  // ------------------------------------------------------------------
  document.getElementById('googleBtn').addEventListener('click', function () {
    auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .then(function (result) { redirectUser(result.user); })
      .catch(function (err) {
        if (err.code !== 'auth/popup-closed-by-user') showError(friendlyError(err));
      });
  });

  // ------------------------------------------------------------------
  // View switching
  // ------------------------------------------------------------------
  document.getElementById('showPasswordBtn').addEventListener('click', function () { showView('viewPassword'); });
  document.getElementById('backToEmail').addEventListener('click', function () { showView('viewEmail'); });
  document.getElementById('retryBtn').addEventListener('click', function () { showView('viewEmail'); });
  document.getElementById('errorRetryBtn').addEventListener('click', function () { showView('viewEmail'); });

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function showView(id) {
    VIEWS.forEach(function (v) { document.getElementById(v).hidden = (v !== id); });
  }

  function showError(msg) {
    document.getElementById('errorText').textContent = msg;
    showView('viewError');
  }

  function redirectUser(user) {
    db.collection('users').doc(user.uid).get()
      .then(function (snap) {
        if (snap.exists && snap.data().role === 'admin') {
          window.location.replace('/admin/');
        } else {
          window.location.replace('/portal/');
        }
      })
      .catch(function () { window.location.replace('/portal/'); });
  }

  function friendlyError(err) {
    switch (err.code) {
      case 'auth/invalid-action-code': return 'This sign-in link has expired or was already used.';
      case 'auth/invalid-email': return 'Please enter a valid email address.';
      case 'auth/wrong-password': return 'Incorrect password. Please try again.';
      case 'auth/user-not-found': return 'No account found with this email. Contact empathinterviews@gmail.com to get set up.';
      case 'auth/invalid-credential': return 'Incorrect email or password. Please try again.';
      case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes.';
      default: return err.message || 'An unexpected error occurred.';
    }
  }
})();
