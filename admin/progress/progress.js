/**
 * Admin - Progress & Pipeline Management
 */
(function () {
  var uid = new URLSearchParams(window.location.search).get('uid');
  if (!uid) { window.location.replace('/admin/'); return; }

  var docPath = 'users/' + uid + '/progress/current';
  var pipelineContainer = document.getElementById('pipelineContainer');
  var goalsContainer = document.getElementById('goalsContainer');
  var toast = document.getElementById('toast');

  var STAGES = ['applied', 'phone-screen', 'technical', 'onsite', 'offer', 'rejected', 'withdrawn'];

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

    document.getElementById('addPipelineBtn').addEventListener('click', function () {
      addPipelineRow('', '', 'applied', '');
    });
    document.getElementById('addGoalBtn').addEventListener('click', function () {
      addGoalRow('', false);
    });
    document.getElementById('statsForm').addEventListener('submit', saveStats);
    document.getElementById('savePipelineBtn').addEventListener('click', savePipeline);
    document.getElementById('saveGoalsBtn').addEventListener('click', saveGoals);

    loadProgress();
  }

  async function loadProgress() {
    try {
      var data = await Empath.db.getDoc(docPath);
      if (data) {
        document.getElementById('statApps').value = data.applicationsSubmitted || 0;
        document.getElementById('statPhoneScreens').value = data.phoneScreens || 0;
        document.getElementById('statTechnical').value = data.technicalInterviews || 0;
        document.getElementById('statOnsite').value = data.onsiteInterviews || 0;
        document.getElementById('statOffers').value = data.offers || 0;

        pipelineContainer.innerHTML = '';
        (data.pipeline || []).forEach(function (p) {
          addPipelineRow(p.company, p.role, p.stage, p.notes);
        });

        goalsContainer.innerHTML = '';
        (data.weeklyGoals || []).forEach(function (g) {
          addGoalRow(g.text, g.completed);
        });
      }
    } catch (err) {
      console.error('Load error:', err);
    }
  }

  async function saveStats(e) {
    e.preventDefault();
    try {
      await Empath.db.setDoc(docPath, {
        applicationsSubmitted: parseInt(document.getElementById('statApps').value) || 0,
        phoneScreens: parseInt(document.getElementById('statPhoneScreens').value) || 0,
        technicalInterviews: parseInt(document.getElementById('statTechnical').value) || 0,
        onsiteInterviews: parseInt(document.getElementById('statOnsite').value) || 0,
        offers: parseInt(document.getElementById('statOffers').value) || 0
      }, true);
      showToast('Stats saved');
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function savePipeline() {
    var items = [];
    pipelineContainer.querySelectorAll('.pipeline-row').forEach(function (row) {
      var company = row.querySelector('.pl-company').value.trim();
      if (company) {
        items.push({
          company: company,
          role: row.querySelector('.pl-role').value.trim(),
          stage: row.querySelector('.pl-stage').value,
          notes: row.querySelector('.pl-notes').value.trim(),
          lastUpdated: firebase.firestore.Timestamp.now()
        });
      }
    });
    try {
      await Empath.db.setDoc(docPath, { pipeline: items }, true);
      showToast('Pipeline saved');
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  async function saveGoals() {
    var items = [];
    goalsContainer.querySelectorAll('.goal-row').forEach(function (row) {
      var text = row.querySelector('.goal-text').value.trim();
      if (text) {
        items.push({
          text: text,
          completed: row.querySelector('.goal-check').checked
        });
      }
    });
    try {
      await Empath.db.setDoc(docPath, { weeklyGoals: items }, true);
      showToast('Goals saved');
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }

  function addPipelineRow(company, role, stage, notes) {
    var row = document.createElement('div');
    row.className = 'dynamic-field pipeline-row';
    row.style.flexWrap = 'wrap';
    var stageOptions = STAGES.map(function (s) {
      return '<option value="' + s + '"' + (s === stage ? ' selected' : '') + '>' + formatStage(s) + '</option>';
    }).join('');
    row.innerHTML =
      '<input type="text" class="form-input pl-company" value="' + escAttr(company) + '" placeholder="Company" style="flex:2;min-width:120px;" />' +
      '<input type="text" class="form-input pl-role" value="' + escAttr(role) + '" placeholder="Role" style="flex:2;min-width:120px;" />' +
      '<select class="form-input pl-stage" style="flex:1;min-width:110px;">' + stageOptions + '</select>' +
      '<input type="text" class="form-input pl-notes" value="' + escAttr(notes) + '" placeholder="Notes" style="flex:2;min-width:120px;" />' +
      '<button type="button" class="dynamic-field__remove">&times;</button>';
    row.querySelector('.dynamic-field__remove').addEventListener('click', function () { row.remove(); });
    pipelineContainer.appendChild(row);
  }

  function addGoalRow(text, completed) {
    var row = document.createElement('div');
    row.className = 'dynamic-field goal-row';
    row.innerHTML =
      '<input type="checkbox" class="goal-check"' + (completed ? ' checked' : '') + ' />' +
      '<input type="text" class="form-input goal-text" value="' + escAttr(text) + '" placeholder="Weekly goal..." />' +
      '<button type="button" class="dynamic-field__remove">&times;</button>';
    row.querySelector('.dynamic-field__remove').addEventListener('click', function () { row.remove(); });
    goalsContainer.appendChild(row);
  }

  function formatStage(s) {
    var map = { 'applied': 'Applied', 'phone-screen': 'Phone Screen', 'technical': 'Technical', 'onsite': 'Onsite', 'offer': 'Offer', 'rejected': 'Rejected', 'withdrawn': 'Withdrawn' };
    return map[s] || s;
  }

  function escAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 3000);
  }
})();
