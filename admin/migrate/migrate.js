/**
 * Admin - Migrate Client Data
 *
 * Moves all subcollections (sessions, jobAnalyses, resumeReviews, progress)
 * and their nested comments from one user doc to another.
 */
(function () {
  var sourceSelect = document.getElementById('sourceClient');
  var targetSelect = document.getElementById('targetClient');
  var previewBtn = document.getElementById('previewBtn');
  var previewCard = document.getElementById('previewCard');
  var previewBody = document.getElementById('previewBody');
  var confirmCard = document.getElementById('confirmCard');
  var migrateBtn = document.getElementById('migrateBtn');
  var cancelBtn = document.getElementById('cancelBtn');
  var deleteSourceCheckbox = document.getElementById('deleteSource');
  var progressCard = document.getElementById('progressCard');
  var progressTitle = document.getElementById('progressTitle');
  var progressText = document.getElementById('progressText');
  var signOutBtn = document.getElementById('signOutBtn');
  var toast = document.getElementById('toast');

  var allClients = [];
  var previewData = null;

  var SUBCOLLECTIONS = ['sessions', 'jobAnalyses', 'resumeReviews', 'progress'];

  document.addEventListener('empathAuthReady', init);

  function init() {
    loadClients();
    bindEvents();
  }

  // ------------------------------------------------------------------
  // Load clients into both dropdowns
  // ------------------------------------------------------------------
  async function loadClients() {
    try {
      allClients = await Empath.db.getClients();
      var options = allClients.map(function (c) {
        var label = c.displayName + ' (' + c.email + ')';
        if (c.isPending) label += ' [pending]';
        return '<option value="' + c.id + '">' + esc(label) + '</option>';
      }).join('');

      sourceSelect.innerHTML = '<option value="">-- Select source client --</option>' + options;
      targetSelect.innerHTML = '<option value="">-- Select target client --</option>' + options;
    } catch (err) {
      console.error('Error loading clients:', err);
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function bindEvents() {
    sourceSelect.addEventListener('change', validateSelections);
    targetSelect.addEventListener('change', validateSelections);
    previewBtn.addEventListener('click', runPreview);
    migrateBtn.addEventListener('click', runMigration);
    cancelBtn.addEventListener('click', resetAll);
    signOutBtn.addEventListener('click', function () {
      auth.signOut().then(function () {
        window.location.replace('/login/');
      });
    });
  }

  function validateSelections() {
    var sourceId = sourceSelect.value;
    var targetId = targetSelect.value;
    previewBtn.disabled = !sourceId || !targetId || sourceId === targetId;

    // Reset preview if selections change
    previewCard.hidden = true;
    confirmCard.hidden = true;
    progressCard.hidden = true;
  }

  // ------------------------------------------------------------------
  // Preview: count items in each subcollection
  // ------------------------------------------------------------------
  async function runPreview() {
    var sourceId = sourceSelect.value;
    var targetId = targetSelect.value;

    if (sourceId === targetId) {
      showToast('Source and target must be different');
      return;
    }

    previewBtn.disabled = true;
    previewBtn.textContent = 'Loading preview...';

    try {
      var sourceClient = allClients.find(function (c) { return c.id === sourceId; });
      var targetClient = allClients.find(function (c) { return c.id === targetId; });

      previewData = { sourceId: sourceId, targetId: targetId, collections: {} };
      var totalItems = 0;
      var totalComments = 0;

      for (var i = 0; i < SUBCOLLECTIONS.length; i++) {
        var subName = SUBCOLLECTIONS[i];
        var docs = await db.collection('users/' + sourceId + '/' + subName).get();
        var commentCount = 0;

        // Count comments for each doc (except progress which may not have comments)
        if (subName !== 'progress') {
          for (var j = 0; j < docs.docs.length; j++) {
            var comments = await docs.docs[j].ref.collection('comments').get();
            commentCount += comments.size;
          }
        }

        previewData.collections[subName] = {
          count: docs.size,
          comments: commentCount
        };
        totalItems += docs.size;
        totalComments += commentCount;
      }

      // Render preview
      var html = '<div style="margin-bottom:var(--space-lg);">' +
        '<p><strong>From:</strong> ' + esc(sourceClient.displayName) + ' (' + esc(sourceClient.email) + ')</p>' +
        '<p><strong>To:</strong> ' + esc(targetClient.displayName) + ' (' + esc(targetClient.email) + ')</p>' +
        '</div>' +
        '<table class="client-table" style="margin-bottom:0;">' +
        '<thead><tr><th>Collection</th><th>Documents</th><th>Comments</th></tr></thead>' +
        '<tbody>';

      var labels = { sessions: 'Sessions', jobAnalyses: 'Job Analyses', resumeReviews: 'Resume Reviews', progress: 'Progress' };

      for (var k = 0; k < SUBCOLLECTIONS.length; k++) {
        var name = SUBCOLLECTIONS[k];
        var info = previewData.collections[name];
        html += '<tr><td>' + labels[name] + '</td><td>' + info.count + '</td><td>' + info.comments + '</td></tr>';
      }

      html += '<tr style="font-weight:600; border-top:2px solid var(--color-border);">' +
        '<td>Total</td><td>' + totalItems + '</td><td>' + totalComments + '</td></tr>';
      html += '</tbody></table>';

      if (totalItems === 0) {
        html += '<p style="margin-top:var(--space-md); color:var(--color-text-muted); font-style:italic;">No data to migrate from this source.</p>';
      }

      previewBody.innerHTML = html;
      previewCard.hidden = false;
      confirmCard.hidden = totalItems === 0;

    } catch (err) {
      console.error('Preview error:', err);
      showToast('Error loading preview: ' + err.message);
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview Migration';
    }
  }

  // ------------------------------------------------------------------
  // Migration: copy all docs + comments, then optionally delete source
  // ------------------------------------------------------------------
  async function runMigration() {
    if (!previewData) return;

    var sourceId = previewData.sourceId;
    var targetId = previewData.targetId;
    var shouldDeleteSource = deleteSourceCheckbox.checked;

    // Disable UI
    migrateBtn.disabled = true;
    migrateBtn.textContent = 'Migrating...';
    sourceSelect.disabled = true;
    targetSelect.disabled = true;
    confirmCard.hidden = true;
    progressCard.hidden = false;

    var log = [];

    function updateProgress(msg) {
      log.push(msg);
      progressText.innerHTML = log.map(function (l) { return '<div>' + l + '</div>'; }).join('');
    }

    try {
      var sourceRef = db.collection('users').doc(sourceId);
      var targetRef = db.collection('users').doc(targetId);

      for (var i = 0; i < SUBCOLLECTIONS.length; i++) {
        var subName = SUBCOLLECTIONS[i];
        var sourceDocs = await sourceRef.collection(subName).get();

        if (sourceDocs.empty) {
          updateProgress('&#10003; ' + subName + ' &mdash; nothing to migrate');
          continue;
        }

        var docCount = 0;
        var commentCount = 0;

        for (var j = 0; j < sourceDocs.docs.length; j++) {
          var docSnap = sourceDocs.docs[j];

          // Copy the document to the target
          await targetRef.collection(subName).doc(docSnap.id).set(docSnap.data());

          // Copy comments subcollection if applicable
          if (subName !== 'progress') {
            var comments = await docSnap.ref.collection('comments').get();
            for (var k = 0; k < comments.docs.length; k++) {
              var commentSnap = comments.docs[k];
              await targetRef.collection(subName).doc(docSnap.id)
                .collection('comments').doc(commentSnap.id).set(commentSnap.data());

              // Delete source comment
              await commentSnap.ref.delete();
              commentCount++;
            }
          }

          // Delete the source document
          await docSnap.ref.delete();
          docCount++;
        }

        var msg = '&#10003; ' + subName + ' &mdash; moved ' + docCount + ' doc' + (docCount !== 1 ? 's' : '');
        if (commentCount > 0) msg += ' + ' + commentCount + ' comment' + (commentCount !== 1 ? 's' : '');
        updateProgress(msg);
      }

      // Optionally delete the source user doc
      if (shouldDeleteSource) {
        await sourceRef.delete();
        updateProgress('&#10003; Deleted source client record');
      }

      progressTitle.textContent = 'Migration Complete';
      updateProgress('');
      updateProgress('<strong>All data has been migrated successfully.</strong>');
      showToast('Migration complete!');

    } catch (err) {
      console.error('Migration error:', err);
      progressTitle.textContent = 'Migration Error';
      updateProgress('<span style="color:#C62828;">&#10007; Error: ' + esc(err.message) + '</span>');
      updateProgress('Some data may have already been moved. Check both client records.');
      showToast('Migration failed — see details above');
    } finally {
      migrateBtn.disabled = false;
      migrateBtn.textContent = 'Migrate Data';
      sourceSelect.disabled = false;
      targetSelect.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------------
  function resetAll() {
    previewCard.hidden = true;
    confirmCard.hidden = true;
    progressCard.hidden = true;
    previewData = null;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
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
