/**
 * Auth Guard
 *
 * Include on every portal and admin page. Checks auth state
 * and redirects unauthenticated users to /login/.
 * For admin pages, also verifies the user has role "admin".
 *
 * IMPORTANT: Only users with a pendingInvite or existing user doc
 * are allowed in. Anyone else is signed out and rejected.
 *
 * On first sign-in, migrates any content from the placeholder user doc
 * (created by admin before client signed in) to the real UID.
 *
 * Exposes window.empathAuth = { user, userDoc, isAdmin }
 * and dispatches a 'empathAuthReady' event on document when ready.
 */
(function () {
  const isAdminPage = window.location.pathname.startsWith('/admin');

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

        // No invite = not authorized
        if (inviteQuery.empty) {
          await auth.signOut();
          window.location.replace('/login/?error=not-authorized');
          return;
        }

        const inviteData = inviteQuery.docs[0].data();
        const placeholderUid = inviteData.placeholderUid;

        // If admin pre-created content under a placeholder doc, migrate it
        if (placeholderUid) {
          const placeholderRef = db.collection('users').doc(placeholderUid);
          const placeholderSnap = await placeholderRef.get();

          if (placeholderSnap.exists) {
            // Copy the user profile to the real UID
            const profileData = placeholderSnap.data();
            delete profileData.isPending;
            profileData.email = user.email;
            await userDocRef.set(profileData);

            // Migrate all subcollections: sessions, jobAnalyses, resumeReviews, progress
            var subcollections = ['sessions', 'jobAnalyses', 'resumeReviews', 'progress'];
            for (var i = 0; i < subcollections.length; i++) {
              var subName = subcollections[i];
              var oldDocs = await placeholderRef.collection(subName).get();
              for (var j = 0; j < oldDocs.docs.length; j++) {
                var docSnap = oldDocs.docs[j];
                await userDocRef.collection(subName).doc(docSnap.id).set(docSnap.data());
                await docSnap.ref.delete();
              }
            }

            // Delete the placeholder user doc
            await placeholderRef.delete();
          }
        } else {
          // No placeholder — create a fresh user doc
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
        }

        // Delete the invite
        await inviteQuery.docs[0].ref.delete();

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

    if (isAdminPage && !isAdmin) {
      window.location.replace('/portal/');
      return;
    }

    window.empathAuth = { user: user, userDoc: userDoc, isAdmin: isAdmin };

    document.documentElement.classList.remove('auth-loading');
    document.dispatchEvent(new CustomEvent('empathAuthReady'));
  }
})();
