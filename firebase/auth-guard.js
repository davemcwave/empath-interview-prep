/**
 * Auth Guard
 *
 * Include on every portal and admin page. Checks auth state
 * and redirects unauthenticated users to /login/.
 * For admin pages, also verifies the user has role "admin".
 *
 * Exposes window.empathAuth = { user, userDoc, isAdmin }
 * and dispatches a 'empathAuthReady' event on document when ready.
 */
(function () {
  const isAdminPage = window.location.pathname.startsWith('/admin');

  // Show a loading state while checking auth
  document.documentElement.classList.add('auth-loading');

  auth.onAuthStateChanged(async function (user) {
    if (!user) {
      window.location.replace('/login/');
      return;
    }

    try {
      const userDocRef = db.collection('users').doc(user.uid);
      const userSnap = await userDocRef.get();

      if (!userSnap.exists) {
        // First-time sign-in: check for pending invite
        const inviteQuery = await db.collection('pendingInvites')
          .where('email', '==', user.email)
          .limit(1)
          .get();

        const inviteData = inviteQuery.empty ? {} : inviteQuery.docs[0].data();

        await userDocRef.set({
          email: user.email,
          displayName: inviteData.displayName || user.email.split('@')[0],
          role: 'client',
          status: 'active',
          plan: inviteData.plan || '',
          startDate: firebase.firestore.FieldValue.serverTimestamp(),
          notes: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Delete the invite if it existed
        if (!inviteQuery.empty) {
          await inviteQuery.docs[0].ref.delete();
        }

        // Re-fetch the doc we just created
        const freshSnap = await userDocRef.get();
        setupAuth(user, freshSnap.data());
      } else {
        setupAuth(user, userSnap.data());
      }
    } catch (err) {
      console.error('Auth guard error:', err);
      document.documentElement.classList.remove('auth-loading');
    }
  });

  function setupAuth(user, userDoc) {
    const isAdmin = userDoc.role === 'admin';

    // Redirect client away from admin pages
    if (isAdminPage && !isAdmin) {
      window.location.replace('/portal/');
      return;
    }

    window.empathAuth = { user: user, userDoc: userDoc, isAdmin: isAdmin };

    document.documentElement.classList.remove('auth-loading');
    document.dispatchEvent(new CustomEvent('empathAuthReady'));
  }
})();
