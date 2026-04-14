/**
 * Admin — Session Notes CRUD
 */
(function () {
  var uid = new URLSearchParams(window.location.search).get('uid');
  if (!uid) { window.location.replace('/admin/'); return; }

  var collectionPath = 'users/' + uid + '/sessions';
  var sessionList = document.getElementById('sessionList');
  var emptyState = document.getElementById('emptyState');
  var formCard = document.getElementById('sessionFormCard');
  var sessionForm = document.getElementById('sessionForm');
  var editingIdInput = document.getElementById('editingId');
  var formTitle = document.getElementById('formTitle');
  var actionItemsContainer = document.getElementById('actionItemsContainer');
  var toast = document.getElementById('toast');

  document.addEventListener('empathAuthReady', init);

  async function init() {
    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', function () {
      auth.signOut().then(function () { window.location.replace('/login/'); });
    });

    // Load client name
    var client = await Empath.db.getDoc('users/' + uid);
    if (client) {
      document.getElementById('clientNameSidebar').textContent = client.displayName;
      document.getElementById('clientSubtitle').textContent = 'for ' + client.displayName;
      document.title = 'Sessions - ' + client.displayName + ' - Empath Admin';
    }

    // Setup sidebar links
    document.getElementById('linkSessions').href = '/admin/sessions/?uid=' + uid;
    document.getElementById('linkJobAnalysis').href = '/admin/job-analysis/?uid=' + uid;
    document.getElementById('linkResume').href = '/admin/resume-feedback/?uid=' + uid;
    document.getElementById('linkProgress').href = '/admin/progress/?uid=' + uid;
    document.getElementById('backToClientBtn').href = '/admin/clients/?uid=' + uid;

    // Bind events
    document.getElementById('addSessionBtn').addEventListener('click', showNewForm);
    document.getElementById('cancelSessionBtn').addEventListener('click', hideForm);
    document.getElementById('addActionItemBtn').addEventListener('click', function () {
      addActionItemField('', false);
    });
    sessionForm.addEventListener('submit', handleSave);

    loadSessions();
  }

  // ------------------------------------------------------------------
  // Load & render sessions
  // ------------------------------------------------------------------
  async function loadSessions() {
    try {
      var sessions = await Empath.db.getCollection(collectionPath, 'date', 'desc');
      renderSessions(sessions);
    } catch (err) {
      console.error('Load sessions error:', err);
    }
  }

  function renderSessions(sessions) {
    if (sessions.length === 0) {
      sessionList.innerHTML = '';
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    sessionList.innerHTML = sessions.map(function (s) {
      var date = s.date ? formatDate(s.date) : '—';
      var typeLabel = formatType(s.type);
      var actionHtml = '';
      if (s.actionItems && s.actionItems.length > 0) {
        actionHtml = '<ul class="action-items">' +
          s.actionItems.map(function (ai) {
            var cls = ai.completed ? ' action-item--completed' : '';
            var checked = ai.completed ? ' checked' : '';
            return '<li class="action-item' + cls + '">' +
              '<input type="checkbox"' + checked + ' disabled />' +
              '<span>' + esc(ai.text) + '</span></li>';
          }).join('') +
          '</ul>';
      }

      return '<div class="app-card" data-id="' + s.id + '">' +
        '<div class="app-card__header">' +
          '<span class="app-card__title">' + esc(s.title) + '</span>' +
          '<span class="app-card__meta">' + date + ' &middot; ' + typeLabel +
            (s.duration ? ' &middot; ' + s.duration + ' min' : '') + '</span>' +
        '</div>' +
        '<div class="app-card__body">' +
          '<p style="white-space:pre-wrap;">' + esc(s.notes) + '</p>' +
          actionHtml +
        '</div>' +
        '<div style="margin-top:var(--space-md); display:flex; gap:var(--space-sm);">' +
          '<button class="btn btn--outline btn--sm edit-btn" data-id="' + s.id + '">Edit</button>' +
          '<button class="btn btn--outline btn--sm delete-btn" data-id="' + s.id + '" style="color:#C0392B;border-color:#C0392B;">Delete</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // Bind edit/delete buttons
    sessionList.querySelectorAll('.edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { editSession(btn.dataset.id, sessions); });
    });
    sessionList.querySelectorAll('.delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteSession(btn.dataset.id); });
    });
  }

  // ------------------------------------------------------------------
  // Form: New / Edit
  // ------------------------------------------------------------------
  function showNewForm() {
    editingIdInput.value = '';
    formTitle.textContent = 'New Session';
    sessionForm.reset();
    document.getElementById('sessionDate').value = new Date().toISOString().split('T')[0];
    actionItemsContainer.innerHTML = '';
    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  function editSession(id, sessions) {
    var s = sessions.find(function (x) { return x.id === id; });
    if (!s) return;

    editingIdInput.value = id;
    formTitle.textContent = 'Edit Session';
    document.getElementById('sessionDate').value = s.date ? toInputDate(s.date) : '';
    document.getElementById('sessionType').value = s.type || '';
    document.getElementById('sessionTitle').value = s.title || '';
    document.getElementById('sessionDuration').value = s.duration || '';
    document.getElementById('sessionNotes').value = s.notes || '';

    actionItemsContainer.innerHTML = '';
    if (s.actionItems) {
      s.actionItems.forEach(function (ai) {
        addActionItemField(ai.text, ai.completed);
      });
    }

    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  function hideForm() {
    formCard.hidden = true;
  }

  // ------------------------------------------------------------------
  // Save
  // ------------------------------------------------------------------
  async function handleSave(e) {
    e.preventDefault();
    var editingId = editingIdInput.value;
    var dateStr = document.getElementById('sessionDate').value;

    var data = {
      date: dateStr ? firebase.firestore.Timestamp.fromDate(new Date(dateStr + 'T12:00:00')) : null,
      type: document.getElementById('sessionType').value,
      title: document.getElementById('sessionTitle').value.trim(),
      notes: document.getElementById('sessionNotes').value.trim(),
      duration: parseInt(document.getElementById('sessionDuration').value) || null,
      actionItems: getActionItems()
    };

    try {
      if (editingId) {
        await Empath.db.updateDoc(collectionPath + '/' + editingId, data);
        showToast('Session updated');
      } else {
        await Empath.db.addDoc(collectionPath, data);
        showToast('Session added');
      }
      hideForm();
      loadSessions();
    } catch (err) {
      console.error('Save error:', err);
      showToast('Error: ' + err.message);
    }
  }

  // ------------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------------
  async function deleteSession(id) {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    try {
      await Empath.db.deleteDoc(collectionPath + '/' + id);
      showToast('Session deleted');
      loadSessions();
    } catch (err) {
      console.error('Delete error:', err);
      showToast('Error: ' + err.message);
    }
  }

  // ------------------------------------------------------------------
  // Action items dynamic fields
  // ------------------------------------------------------------------
  function addActionItemField(text, completed) {
    var row = document.createElement('div');
    row.className = 'dynamic-field';
    row.innerHTML =
      '<input type="checkbox" class="ai-completed"' + (completed ? ' checked' : '') + ' />' +
      '<input type="text" class="form-input ai-text" value="' + escAttr(text) + '" placeholder="Action item..." />' +
      '<button type="button" class="dynamic-field__remove">&times;</button>';
    row.querySelector('.dynamic-field__remove').addEventListener('click', function () {
      row.remove();
    });
    actionItemsContainer.appendChild(row);
  }

  function getActionItems() {
    var items = [];
    actionItemsContainer.querySelectorAll('.dynamic-field').forEach(function (row) {
      var text = row.querySelector('.ai-text').value.trim();
      if (text) {
        items.push({
          text: text,
          completed: row.querySelector('.ai-completed').checked
        });
      }
    });
    return items;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function formatDate(ts) {
    if (!ts || !ts.toDate) return '—';
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toInputDate(ts) {
    if (!ts || !ts.toDate) return '';
    var d = ts.toDate();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatType(type) {
    var map = {
      'check-in': 'Check-In',
      'mock-behavioral': 'Mock Behavioral',
      'mock-technical': 'Mock Technical',
      'mock-full': 'Full Mock Interview',
      'live-coding': 'Live Coding',
      'strategy': 'Strategy',
      'negotiation': 'Negotiation',
      'offer-coaching': 'Offer Coaching',
      'resume-review': 'Resume Review',
      'other': 'Other'
    };
    return map[type] || type || '—';
  }

  function esc(str) {
    var el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 3000);
  }
})();
