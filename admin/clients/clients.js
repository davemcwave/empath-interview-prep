/**
 * Admin — Client Detail Page
 */
(function () {
  var uid = new URLSearchParams(window.location.search).get('uid');
  if (!uid) {
    window.location.replace('/admin/');
    return;
  }

  var clientData = null;
  var profileView = document.getElementById('profileView');
  var profileForm = document.getElementById('profileForm');
  var editProfileBtn = document.getElementById('editProfileBtn');
  var cancelEditBtn = document.getElementById('cancelEditBtn');
  var toast = document.getElementById('toast');

  document.addEventListener('empathAuthReady', init);

  async function init() {
    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', function () {
      auth.signOut().then(function () { window.location.replace('/login/'); });
    });

    await loadClient();
    setupSidebarLinks();
    setupProfileEdit();
    loadCounts();
  }

  // ------------------------------------------------------------------
  // Load client
  // ------------------------------------------------------------------
  async function loadClient() {
    clientData = await Empath.db.getDoc('users/' + uid);
    if (!clientData) {
      document.getElementById('clientName').textContent = 'Client not found';
      return;
    }

    document.getElementById('clientName').textContent = clientData.displayName;
    document.getElementById('clientEmail').textContent = clientData.email;
    document.getElementById('clientNameSidebar').textContent = clientData.displayName;
    document.title = clientData.displayName + ' - Empath Admin';

    renderProfile();
  }

  function renderProfile() {
    var startDate = clientData.startDate ? formatDate(clientData.startDate) : '—';
    profileView.innerHTML =
      '<p><strong>Status:</strong> <span class="badge badge--' + esc(clientData.status || 'active') + '">' + esc(clientData.status || 'active') + '</span></p>' +
      '<p style="margin-top:var(--space-sm)"><strong>Plan:</strong> ' + esc(clientData.plan || '—') + '</p>' +
      '<p style="margin-top:var(--space-sm)"><strong>Start Date:</strong> ' + startDate + '</p>' +
      (clientData.notes ? '<p style="margin-top:var(--space-sm)"><strong>Notes:</strong> ' + esc(clientData.notes) + '</p>' : '');
  }

  // ------------------------------------------------------------------
  // Profile edit
  // ------------------------------------------------------------------
  function setupProfileEdit() {
    editProfileBtn.addEventListener('click', function () {
      document.getElementById('editName').value = clientData.displayName || '';
      document.getElementById('editStatus').value = clientData.status || 'active';
      document.getElementById('editPlan').value = clientData.plan || '';
      document.getElementById('editNotes').value = clientData.notes || '';
      profileView.hidden = true;
      profileForm.hidden = false;
      editProfileBtn.hidden = true;
    });

    cancelEditBtn.addEventListener('click', function () {
      profileView.hidden = false;
      profileForm.hidden = true;
      editProfileBtn.hidden = false;
    });

    profileForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await Empath.db.updateDoc('users/' + uid, {
          displayName: document.getElementById('editName').value.trim(),
          status: document.getElementById('editStatus').value,
          plan: document.getElementById('editPlan').value.trim(),
          notes: document.getElementById('editNotes').value.trim()
        });
        clientData.displayName = document.getElementById('editName').value.trim();
        clientData.status = document.getElementById('editStatus').value;
        clientData.plan = document.getElementById('editPlan').value.trim();
        clientData.notes = document.getElementById('editNotes').value.trim();

        document.getElementById('clientName').textContent = clientData.displayName;
        document.getElementById('clientNameSidebar').textContent = clientData.displayName;
        renderProfile();

        profileView.hidden = false;
        profileForm.hidden = true;
        editProfileBtn.hidden = false;
        showToast('Profile updated');
      } catch (err) {
        console.error('Update error:', err);
        showToast('Error: ' + err.message);
      }
    });
  }

  // ------------------------------------------------------------------
  // Sidebar + card links
  // ------------------------------------------------------------------
  function setupSidebarLinks() {
    var sessionsUrl = '/admin/sessions/?uid=' + uid;
    var analysisUrl = '/admin/job-analysis/?uid=' + uid;
    var resumeUrl = '/admin/resume-feedback/?uid=' + uid;
    var progressUrl = '/admin/progress/?uid=' + uid;

    document.getElementById('linkSessions').href = sessionsUrl;
    document.getElementById('linkJobAnalysis').href = analysisUrl;
    document.getElementById('linkResume').href = resumeUrl;
    document.getElementById('linkProgress').href = progressUrl;

    document.getElementById('cardSessions').href = sessionsUrl;
    document.getElementById('cardJobAnalysis').href = analysisUrl;
    document.getElementById('cardResume').href = resumeUrl;
    document.getElementById('cardProgress').href = progressUrl;
  }

  // ------------------------------------------------------------------
  // Load content counts
  // ------------------------------------------------------------------
  async function loadCounts() {
    try {
      var sessions = await Empath.db.getCollection('users/' + uid + '/sessions');
      document.getElementById('sessionCount').textContent = sessions.length + ' session' + (sessions.length !== 1 ? 's' : '');

      var analyses = await Empath.db.getCollection('users/' + uid + '/jobAnalyses');
      document.getElementById('analysisCount').textContent = analyses.length + ' analys' + (analyses.length !== 1 ? 'es' : 'is');

      var reviews = await Empath.db.getCollection('users/' + uid + '/resumeReviews');
      document.getElementById('resumeCount').textContent = reviews.length + ' review' + (reviews.length !== 1 ? 's' : '');
    } catch (err) {
      console.error('Count error:', err);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function formatDate(ts) {
    if (!ts || !ts.toDate) return '—';
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 3000);
  }
})();
