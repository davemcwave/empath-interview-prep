/**
 * Admin Dashboard — Client List & Invite Flow
 */
(function () {
  var clientTableBody = document.getElementById('clientTableBody');
  var emptyState = document.getElementById('emptyState');
  var clientList = document.getElementById('clientList');
  var searchInput = document.getElementById('searchInput');
  var inviteModal = document.getElementById('inviteModal');
  var inviteForm = document.getElementById('inviteForm');
  var sendInviteBtn = document.getElementById('sendInviteBtn');
  var toast = document.getElementById('toast');
  var signOutBtn = document.getElementById('signOutBtn');

  var allClients = [];

  // Wait for auth
  document.addEventListener('empathAuthReady', init);

  function init() {
    loadClients();
    bindEvents();
  }

  // ------------------------------------------------------------------
  // Load clients
  // ------------------------------------------------------------------
  async function loadClients() {
    try {
      allClients = await Empath.db.getClients();
      renderClients(allClients);
    } catch (err) {
      console.error('Error loading clients:', err);
    }
  }

  function renderClients(clients) {
    if (clients.length === 0) {
      clientList.hidden = true;
      emptyState.hidden = false;
      return;
    }

    clientList.hidden = false;
    emptyState.hidden = true;

    clientTableBody.innerHTML = clients.map(function (c) {
      var startDate = c.startDate ? formatDate(c.startDate) : '—';
      return '<tr>' +
        '<td><a class="client-table__name" href="/admin/clients/?uid=' + c.id + '">' + esc(c.displayName) + '</a></td>' +
        '<td>' + esc(c.email) + '</td>' +
        '<td><span class="badge badge--' + esc(c.status || 'active') + '">' + esc(c.status || 'active') + '</span></td>' +
        '<td>' + esc(c.plan || '—') + '</td>' +
        '<td>' + startDate + '</td>' +
        '</tr>';
    }).join('');
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  searchInput.addEventListener('input', function () {
    var q = this.value.toLowerCase().trim();
    if (!q) {
      renderClients(allClients);
      return;
    }
    var filtered = allClients.filter(function (c) {
      return (c.displayName || '').toLowerCase().includes(q) ||
             (c.email || '').toLowerCase().includes(q) ||
             (c.plan || '').toLowerCase().includes(q);
    });
    renderClients(filtered);
  });

  // ------------------------------------------------------------------
  // Invite flow
  // ------------------------------------------------------------------
  function bindEvents() {
    document.getElementById('inviteBtn').addEventListener('click', openInviteModal);
    document.getElementById('emptyInviteBtn').addEventListener('click', openInviteModal);
    document.getElementById('cancelInvite').addEventListener('click', closeInviteModal);
    inviteModal.addEventListener('click', function (e) {
      if (e.target === inviteModal) closeInviteModal();
    });
    inviteForm.addEventListener('submit', handleInvite);
    signOutBtn.addEventListener('click', function () {
      auth.signOut().then(function () {
        window.location.replace('/login/');
      });
    });
  }

  function openInviteModal() {
    inviteForm.reset();
    inviteModal.hidden = false;
  }

  function closeInviteModal() {
    inviteModal.hidden = true;
  }

  async function handleInvite(e) {
    e.preventDefault();
    var name = document.getElementById('inviteName').value.trim();
    var email = document.getElementById('inviteEmail').value.trim();
    var plan = document.getElementById('invitePlan').value.trim();

    sendInviteBtn.disabled = true;
    sendInviteBtn.textContent = 'Sending...';

    try {
      // Create pending invite
      await db.collection('pendingInvites').add({
        email: email,
        displayName: name,
        plan: plan,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Send magic link to client
      await auth.sendSignInLinkToEmail(email, {
        url: window.location.origin + '/login/',
        handleCodeInApp: true
      });

      closeInviteModal();
      showToast('Invite sent to ' + email);
      loadClients(); // refresh list
    } catch (err) {
      console.error('Invite error:', err);
      showToast('Error: ' + err.message);
    } finally {
      sendInviteBtn.disabled = false;
      sendInviteBtn.textContent = 'Send Invite';
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function formatDate(ts) {
    if (!ts || !ts.toDate) return '—';
    var d = ts.toDate();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 3000);
  }
})();
