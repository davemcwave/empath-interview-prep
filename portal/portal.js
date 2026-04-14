/**
 * Client Portal — Dashboard
 */
(function () {
  document.addEventListener('empathAuthReady', init);

  function init() {
    var user = window.empathAuth.user;
    var userDoc = window.empathAuth.userDoc;
    var uid = user.uid;

    // Welcome heading
    var name = (userDoc.displayName || '').split(' ')[0] || 'there';
    document.getElementById('welcomeHeading').textContent = 'Welcome back, ' + name + '.';

    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', function () {
      auth.signOut().then(function () { window.location.replace('/login/'); });
    });

    // Hamburger menu (mobile)
    var hamburger = document.getElementById('hamburger');
    var navLinks = document.getElementById('navLinks');
    if (hamburger) {
      hamburger.addEventListener('click', function () {
        var open = navLinks.classList.toggle('is-open');
        hamburger.setAttribute('aria-expanded', open);
      });
    }

    loadDashboard(uid);
  }

  async function loadDashboard(uid) {
    try {
      // Load all data in parallel
      var results = await Promise.all([
        Empath.db.getCollection('users/' + uid + '/sessions', 'date', 'desc'),
        Empath.db.getCollection('users/' + uid + '/jobAnalyses', 'createdAt', 'desc'),
        Empath.db.getCollection('users/' + uid + '/resumeReviews', 'createdAt', 'desc'),
        Empath.db.getDoc('users/' + uid + '/progress/current')
      ]);

      var sessions = results[0];
      var analyses = results[1];
      var reviews = results[2];
      var progress = results[3];

      // Stats
      document.getElementById('statSessions').textContent = sessions.length;
      document.getElementById('statAnalyses').textContent = analyses.length;
      document.getElementById('statReviews').textContent = reviews.length;
      document.getElementById('statPipeline').textContent = progress && progress.pipeline ? progress.pipeline.length : 0;

      // Recent sessions (last 3)
      renderRecentSessions(sessions.slice(0, 3));

      // Recent analyses (last 2)
      renderRecentAnalyses(analyses.slice(0, 2));
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  function renderRecentSessions(sessions) {
    var container = document.getElementById('recentSessions');
    if (sessions.length === 0) return;

    container.innerHTML = sessions.map(function (s) {
      var date = s.date && s.date.toDate ? s.date.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return '<div class="app-card">' +
        '<div class="app-card__header">' +
          '<span class="app-card__title">' + esc(s.title) + '</span>' +
          '<span class="app-card__meta">' + date + '</span>' +
        '</div>' +
        '<div class="app-card__body">' +
          '<p style="white-space:pre-wrap;">' + esc(truncate(s.notes, 200)) + '</p>' +
        '</div>' +
        '</div>';
    }).join('') +
    '<p style="margin-top:var(--space-md);"><a href="/portal/sessions/" style="color:var(--color-accent); font-weight:500;">View all sessions &rarr;</a></p>';
  }

  function renderRecentAnalyses(analyses) {
    var container = document.getElementById('recentAnalyses');
    if (analyses.length === 0) return;

    container.innerHTML = analyses.map(function (a) {
      return '<div class="app-card">' +
        '<div class="app-card__header">' +
          '<span class="app-card__title">' + esc(a.companyName) + ' — ' + esc(a.roleTitle) + '</span>' +
          (a.overallFit ? '<span class="badge badge--' + esc(a.overallFit) + '">' + esc(a.overallFit) + ' fit</span>' : '') +
        '</div>' +
        '<div class="app-card__body">' +
          '<p>' + esc(truncate(a.notes, 150)) + '</p>' +
        '</div>' +
        '</div>';
    }).join('') +
    '<p style="margin-top:var(--space-md);"><a href="/portal/job-analysis/" style="color:var(--color-accent); font-weight:500;">View all analyses &rarr;</a></p>';
  }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }
})();
