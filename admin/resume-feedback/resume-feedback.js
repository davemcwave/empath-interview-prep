/**
 * Admin - Resume Review (Upload + Manage)
 */
(function () {
  var uid = new URLSearchParams(window.location.search).get('uid');
  if (!uid) { window.location.replace('/admin/'); return; }

  var collectionPath = 'users/' + uid + '/resumeReviews';
  var storage = firebase.storage();
  var formCard = document.getElementById('formCard');
  var reviewForm = document.getElementById('reviewForm');
  var editingIdInput = document.getElementById('editingId');
  var formTitle = document.getElementById('formTitle');
  var fileGroup = document.getElementById('fileGroup');
  var reviewList = document.getElementById('reviewList');
  var emptyState = document.getElementById('emptyState');
  var saveBtn = document.getElementById('saveBtn');
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

    document.getElementById('linkSessions').href = '/admin/sessions/?uid=' + uid;
    document.getElementById('linkJobAnalysis').href = '/admin/job-analysis/?uid=' + uid;
    document.getElementById('linkResume').href = '/admin/resume-feedback/?uid=' + uid;
    document.getElementById('linkProgress').href = '/admin/progress/?uid=' + uid;
    document.getElementById('backToClientBtn').href = '/admin/clients/?uid=' + uid;

    document.getElementById('addReviewBtn').addEventListener('click', showNewForm);
    document.getElementById('cancelBtn').addEventListener('click', function () { formCard.hidden = true; });
    reviewForm.addEventListener('submit', handleSave);

    loadReviews();
  }

  async function loadReviews() {
    try {
      var items = await Empath.db.getCollection(collectionPath, 'createdAt', 'desc');
      renderList(items);
    } catch (err) {
      console.error('Load error:', err);
    }
  }

  function renderList(items) {
    if (items.length === 0) {
      reviewList.innerHTML = '';
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    reviewList.innerHTML = items.map(function (r) {
      var date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return '<div class="app-card">' +
        '<div class="app-card__header">' +
          '<span class="app-card__title">' + esc(r.title) + '</span>' +
          '<span class="app-card__meta">v' + (r.version || 1) + ' &middot; ' + date + '</span>' +
        '</div>' +
        '<div class="app-card__body">' +
          (r.summary ? '<p style="white-space:pre-wrap;">' + esc(r.summary) + '</p>' : '') +
          (r.pdfUrl ? '<p style="margin-top:var(--space-md);"><a href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener" class="btn btn--outline btn--sm">View PDF</a></p>' : '') +
        '</div>' +
        '<div style="margin-top:var(--space-md); display:flex; gap:var(--space-sm);">' +
          '<button class="btn btn--outline btn--sm delete-btn" data-id="' + r.id + '" data-storage="' + escAttr(r.pdfStoragePath || '') + '" style="color:#C0392B;border-color:#C0392B;">Delete</button>' +
        '</div>' +
        '<div class="comment-container" data-path="' + collectionPath + '/' + r.id + '"></div>' +
        '</div>';
    }).join('');

    reviewList.querySelectorAll('.delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteReview(btn.dataset.id, btn.dataset.storage); });
    });

    document.querySelectorAll('.comment-container').forEach(function (el) {
      Empath.renderCommentThread(el, el.dataset.path, 'admin', 'David');
    });
  }

  function showNewForm() {
    editingIdInput.value = '';
    formTitle.textContent = 'Upload Resume Review';
    reviewForm.reset();
    document.getElementById('reviewVersion').value = '1';
    fileGroup.style.display = '';
    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleSave(e) {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Uploading...';

    try {
      var file = document.getElementById('reviewFile').files[0];
      if (!file) {
        showToast('Please select a PDF file.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Review';
        return;
      }

      // Upload to Firebase Storage
      var docId = db.collection(collectionPath).doc().id;
      var storagePath = 'resumes/' + uid + '/' + docId + '/' + file.name;
      var ref = storage.ref(storagePath);
      await ref.put(file);
      var pdfUrl = await ref.getDownloadURL();

      // Save Firestore doc
      await Empath.db.setDoc(collectionPath + '/' + docId, {
        title: document.getElementById('reviewTitle').value.trim(),
        summary: document.getElementById('reviewSummary').value.trim(),
        pdfUrl: pdfUrl,
        pdfStoragePath: storagePath,
        version: parseInt(document.getElementById('reviewVersion').value) || 1,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      showToast('Review uploaded');
      formCard.hidden = true;
      loadReviews();
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Error: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Review';
    }
  }

  async function deleteReview(id, storagePath) {
    if (!confirm('Delete this review? This cannot be undone.')) return;
    try {
      // Delete from Storage
      if (storagePath) {
        try { await storage.ref(storagePath).delete(); } catch (e) { /* file may already be gone */ }
      }
      // Delete Firestore doc
      await Empath.db.deleteDoc(collectionPath + '/' + id);
      showToast('Review deleted');
      loadReviews();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  function esc(str) { var el = document.createElement('span'); el.textContent = str || ''; return el.innerHTML; }
  function escAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 3000);
  }
})();
