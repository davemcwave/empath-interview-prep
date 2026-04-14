/**
 * Admin - Job Posting Analysis CRUD
 */
(function () {
  var uid = new URLSearchParams(window.location.search).get('uid');
  if (!uid) { window.location.replace('/admin/'); return; }

  var collectionPath = 'users/' + uid + '/jobAnalyses';
  var formCard = document.getElementById('formCard');
  var analysisForm = document.getElementById('analysisForm');
  var editingIdInput = document.getElementById('editingId');
  var formTitle = document.getElementById('formTitle');
  var themesContainer = document.getElementById('themesContainer');
  var gapsContainer = document.getElementById('gapsContainer');
  var analysisList = document.getElementById('analysisList');
  var emptyState = document.getElementById('emptyState');
  var toast = document.getElementById('toast');

  document.addEventListener('empathAuthReady', init);

  async function init() {
    document.getElementById('signOutBtn').addEventListener('click', function () {
      auth.signOut().then(function () { window.location.replace('/login/'); });
    });

    var client = await Empath.db.getDoc('users/' + uid);
    if (client) {
      document.getElementById('clientNameSidebar').textContent = client.displayName;
      document.getElementById('clientSubtitle').textContent = 'for ' + client.displayName;
    }

    // Sidebar links
    document.getElementById('linkSessions').href = '/admin/sessions/?uid=' + uid;
    document.getElementById('linkJobAnalysis').href = '/admin/job-analysis/?uid=' + uid;
    document.getElementById('linkResume').href = '/admin/resume-feedback/?uid=' + uid;
    document.getElementById('linkProgress').href = '/admin/progress/?uid=' + uid;
    document.getElementById('backToClientBtn').href = '/admin/clients/?uid=' + uid;

    document.getElementById('addAnalysisBtn').addEventListener('click', showNewForm);
    document.getElementById('cancelBtn').addEventListener('click', function () { formCard.hidden = true; });
    document.getElementById('addThemeBtn').addEventListener('click', function () { addThemeField('', '', ''); });
    document.getElementById('addGapBtn').addEventListener('click', function () { addGapField('', 'medium', ''); });
    analysisForm.addEventListener('submit', handleSave);

    loadAnalyses();
  }

  async function loadAnalyses() {
    try {
      var items = await Empath.db.getCollection(collectionPath, 'createdAt', 'desc');
      renderList(items);
    } catch (err) {
      console.error('Load error:', err);
    }
  }

  function renderList(items) {
    if (items.length === 0) {
      analysisList.innerHTML = '';
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    analysisList.innerHTML = items.map(function (a) {
      var themesHtml = (a.themes || []).map(function (t) {
        return '<li><strong>' + esc(t.name) + '</strong>' +
          (t.frequency ? ' <span style="color:var(--color-text-muted);">(' + esc(t.frequency) + ')</span>' : '') +
          (t.details ? ' - ' + esc(t.details) : '') + '</li>';
      }).join('');

      var gapsHtml = (a.gaps || []).map(function (g) {
        return '<li><span class="badge badge--' + esc(g.severity) + '">' + esc(g.severity) + '</span> ' +
          '<strong>' + esc(g.area) + '</strong>' +
          (g.recommendation ? ' - ' + esc(g.recommendation) : '') + '</li>';
      }).join('');

      var submittedBadge = a.submittedBy === 'client' ? '<span class="badge badge--submitted" style="margin-left:var(--space-sm);">Client submitted</span>' : '';

      return '<div class="app-card" data-id="' + a.id + '">' +
        '<div class="app-card__header">' +
          '<span class="app-card__title">' + esc(a.companyName) + ' - ' + esc(a.roleTitle) + '</span>' +
          submittedBadge +
          (a.overallFit ? '<span class="badge badge--' + esc(a.overallFit) + '">' + esc(a.overallFit) + ' fit</span>' : '') +
        '</div>' +
        '<div class="app-card__body">' +
          (a.postingUrl ? '<p style="margin-bottom:var(--space-sm);"><a href="' + esc(a.postingUrl) + '" target="_blank" rel="noopener" style="color:var(--color-accent);">View Posting</a></p>' : '') +
          (themesHtml ? '<p style="font-weight:600; margin-top:var(--space-md);">Themes</p><ul style="list-style:none; margin:var(--space-sm) 0;">' + themesHtml + '</ul>' : '') +
          (gapsHtml ? '<p style="font-weight:600; margin-top:var(--space-md);">Gaps</p><ul style="list-style:none; margin:var(--space-sm) 0;">' + gapsHtml + '</ul>' : '') +
          (a.notes ? '<p style="white-space:pre-wrap; margin-top:var(--space-md);">' + esc(a.notes) + '</p>' : '') +
        '</div>' +
        '<div style="margin-top:var(--space-md); display:flex; gap:var(--space-sm);">' +
          '<button class="btn btn--outline btn--sm edit-btn" data-id="' + a.id + '">Edit</button>' +
          '<button class="btn btn--outline btn--sm delete-btn" data-id="' + a.id + '" style="color:#C0392B;border-color:#C0392B;">Delete</button>' +
        '</div>' +
        '<div class="comment-container" data-path="' + collectionPath + '/' + a.id + '"></div>' +
        '</div>';
    }).join('');

    analysisList.querySelectorAll('.edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { editItem(btn.dataset.id, items); });
    });
    analysisList.querySelectorAll('.delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteItem(btn.dataset.id); });
    });

    document.querySelectorAll('.comment-container').forEach(function (el) {
      Empath.renderCommentThread(el, el.dataset.path, 'admin', 'David');
    });
  }

  // -- Form --
  function showNewForm() {
    editingIdInput.value = '';
    formTitle.textContent = 'New Analysis';
    analysisForm.reset();
    themesContainer.innerHTML = '';
    gapsContainer.innerHTML = '';
    addThemeField('', '', '');
    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  function editItem(id, items) {
    var a = items.find(function (x) { return x.id === id; });
    if (!a) return;
    editingIdInput.value = id;
    formTitle.textContent = 'Edit Analysis';
    document.getElementById('companyName').value = a.companyName || '';
    document.getElementById('roleTitle').value = a.roleTitle || '';
    document.getElementById('postingUrl').value = a.postingUrl || '';
    document.getElementById('overallFit').value = a.overallFit || '';
    document.getElementById('analysisNotes').value = a.notes || '';

    themesContainer.innerHTML = '';
    (a.themes || []).forEach(function (t) { addThemeField(t.name, t.frequency, t.details); });

    gapsContainer.innerHTML = '';
    (a.gaps || []).forEach(function (g) { addGapField(g.area, g.severity, g.recommendation); });

    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleSave(e) {
    e.preventDefault();
    var editingId = editingIdInput.value;
    var data = {
      companyName: document.getElementById('companyName').value.trim(),
      roleTitle: document.getElementById('roleTitle').value.trim(),
      postingUrl: document.getElementById('postingUrl').value.trim(),
      overallFit: document.getElementById('overallFit').value,
      notes: document.getElementById('analysisNotes').value.trim(),
      themes: getThemes(),
      gaps: getGaps()
    };

    try {
      if (editingId) {
        await Empath.db.updateDoc(collectionPath + '/' + editingId, data);
        showToast('Analysis updated');
      } else {
        await Empath.db.addDoc(collectionPath, data);
        showToast('Analysis added');
      }
      formCard.hidden = true;
      loadAnalyses();
    } catch (err) {
      console.error('Save error:', err);
      showToast('Error: ' + err.message);
    }
  }

  async function deleteItem(id) {
    if (!confirm('Delete this analysis?')) return;
    try {
      await Empath.db.deleteDoc(collectionPath + '/' + id);
      showToast('Analysis deleted');
      loadAnalyses();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  // -- Theme fields --
  function addThemeField(name, frequency, details) {
    var row = document.createElement('div');
    row.className = 'dynamic-field';
    row.style.flexWrap = 'wrap';
    row.innerHTML =
      '<input type="text" class="form-input theme-name" value="' + escAttr(name) + '" placeholder="Theme name" style="flex:2;min-width:140px;" />' +
      '<input type="text" class="form-input theme-freq" value="' + escAttr(frequency) + '" placeholder="Frequency (e.g. 4 mentions)" style="flex:1;min-width:100px;" />' +
      '<input type="text" class="form-input theme-details" value="' + escAttr(details) + '" placeholder="Details" style="flex:3;min-width:200px;" />' +
      '<button type="button" class="dynamic-field__remove">&times;</button>';
    row.querySelector('.dynamic-field__remove').addEventListener('click', function () { row.remove(); });
    themesContainer.appendChild(row);
  }

  function getThemes() {
    var items = [];
    themesContainer.querySelectorAll('.dynamic-field').forEach(function (row) {
      var name = row.querySelector('.theme-name').value.trim();
      if (name) {
        items.push({
          name: name,
          frequency: row.querySelector('.theme-freq').value.trim(),
          details: row.querySelector('.theme-details').value.trim()
        });
      }
    });
    return items;
  }

  // -- Gap fields --
  function addGapField(area, severity, recommendation) {
    var row = document.createElement('div');
    row.className = 'dynamic-field';
    row.style.flexWrap = 'wrap';
    row.innerHTML =
      '<input type="text" class="form-input gap-area" value="' + escAttr(area) + '" placeholder="Gap area" style="flex:2;min-width:140px;" />' +
      '<select class="form-input gap-severity" style="flex:1;min-width:100px;">' +
        '<option value="low"' + (severity === 'low' ? ' selected' : '') + '>Low</option>' +
        '<option value="medium"' + (severity === 'medium' ? ' selected' : '') + '>Medium</option>' +
        '<option value="high"' + (severity === 'high' ? ' selected' : '') + '>High</option>' +
      '</select>' +
      '<input type="text" class="form-input gap-rec" value="' + escAttr(recommendation) + '" placeholder="Recommendation" style="flex:3;min-width:200px;" />' +
      '<button type="button" class="dynamic-field__remove">&times;</button>';
    row.querySelector('.dynamic-field__remove').addEventListener('click', function () { row.remove(); });
    gapsContainer.appendChild(row);
  }

  function getGaps() {
    var items = [];
    gapsContainer.querySelectorAll('.dynamic-field').forEach(function (row) {
      var area = row.querySelector('.gap-area').value.trim();
      if (area) {
        items.push({
          area: area,
          severity: row.querySelector('.gap-severity').value,
          recommendation: row.querySelector('.gap-rec').value.trim()
        });
      }
    });
    return items;
  }

  function esc(str) { var el = document.createElement('span'); el.textContent = str || ''; return el.innerHTML; }
  function escAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 3000);
  }
})();
