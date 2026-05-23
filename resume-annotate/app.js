pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Custom Fabric Arrow class ────────────────────────────────────────────────

fabric.Arrow = fabric.util.createClass(fabric.Line, {
  type: 'arrow',
  initialize: function (points, options) {
    options = options || {};
    this.callSuper('initialize', points, options);
  },
  _render: function (ctx) {
    this.callSuper('_render', ctx);
    const xDiff = this.x2 - this.x1;
    const yDiff = this.y2 - this.y1;
    const len = Math.hypot(xDiff, yDiff);
    if (len < 1) return;
    const ux = xDiff / len;
    const uy = yDiff / len;
    // line center is (0,0) in object space; tip is at (xDiff/2, yDiff/2)
    const tipX = xDiff / 2;
    const tipY = yDiff / 2;
    const headLen = 16;
    const headHalfWidth = 7;
    ctx.save();
    ctx.fillStyle = this.stroke;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * ux + headHalfWidth * uy, tipY - headLen * uy - headHalfWidth * ux);
    ctx.lineTo(tipX - headLen * ux - headHalfWidth * uy, tipY - headLen * uy + headHalfWidth * ux);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
});
fabric.Arrow.fromObject = function (object, callback) {
  const arrow = new fabric.Arrow([object.x1, object.y1, object.x2, object.y2], object);
  if (callback) callback(arrow);
  return arrow;
};

const state = {
  pdfDoc: null,
  pdfBytes: null,
  pdfName: '',
  inputType: 'pdf',        // 'pdf' or 'image'
  imageBitmap: null,       // for image input: original image element
  imageMime: 'image/png',
  pageDims: [],            // [{ width, height }] per page in render-space
  fabricCanvases: [],
  histories:   [],    // per-canvas stack of pre-change JSON snapshots (strings)
  snapshots:   [],    // per-canvas current baseline snapshot (string)
  suppressHistory: false,
  currentTool: 'select',
  currentColor: '#FFEB3B',
};

const pdfUpload      = document.getElementById('pdfUpload');
const pdfUpload2     = document.getElementById('pdfUpload2');
const dropZone       = document.getElementById('dropZone');
const recentSection  = document.getElementById('recentSection');
const recentList     = document.getElementById('recentList');
const pagesContainer = document.getElementById('pagesContainer');
const toolsSection   = document.getElementById('toolsSection');
const colorSection   = document.getElementById('colorSection');
const actionsSection = document.getElementById('actionsSection');
const pageSection    = document.getElementById('pageSection');
const docInfo        = document.getElementById('docInfo');
const saveBtn        = document.getElementById('saveBtn');
const exportBtn      = document.getElementById('exportBtn');
const undoBtn        = document.getElementById('undoBtn');
const toast          = document.getElementById('toast');

// ── Resume cache (IndexedDB) ─────────────────────────────────────────────────

const DB_NAME = 'empath-annotator';
const DB_VERSION = 1;
const STORE = 'resumes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function cacheSave(record) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('cacheSave failed:', err);
  }
}

async function cacheList() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch (err) {
    console.warn('cacheList failed:', err);
    return [];
  }
}

async function cacheGet(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function cacheDelete(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

function formatAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function renderRecents() {
  const items = (await cacheList()).sort((a, b) => b.addedAt - a.addedAt);
  if (!items.length) {
    recentSection.hidden = true;
    recentList.innerHTML = '';
    return;
  }
  recentSection.hidden = false;
  recentList.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'recent__item';
    li.title = `Open ${item.name}`;
    li.innerHTML = `
      <span class="recent__item-icon">${item.fileType === 'image' ? '🖼' : '📄'}</span>
      <div class="recent__item-body">
        <div class="recent__item-name"></div>
        <div class="recent__item-meta"></div>
      </div>
      <button class="recent__item-delete" title="Remove from cache">×</button>
    `;
    li.querySelector('.recent__item-name').textContent = item.name;
    li.querySelector('.recent__item-meta').textContent = formatAgo(item.addedAt);
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('recent__item-delete')) return;
      openFromCache(item.name);
    });
    li.querySelector('.recent__item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await cacheDelete(item.name);
      localStorage.removeItem(`annotations_${item.name}`);
      renderRecents();
    });
    recentList.appendChild(li);
  });
}

async function openFromCache(name) {
  const rec = await cacheGet(name);
  if (!rec) { showToast('Cached file missing.', 'error'); renderRecents(); return; }
  state.pdfName = name;
  if (rec.fileType === 'pdf') {
    state.inputType = 'pdf';
    const buf = await rec.blob.arrayBuffer();
    state.pdfBytes = buf.slice(0);
    loadPDF(buf);
  } else {
    state.inputType = 'image';
    state.imageMime = rec.blob.type || 'image/png';
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(rec.blob);
    });
    loadImage(dataUrl);
  }
}

// ── File handling ────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file) return;
  const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!isPdf && !isImage) {
    showToast('Upload a PDF or image (PNG/JPG/WebP).', 'error');
    return;
  }
  state.pdfName = file.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '');
  // Cache the original file blob for later re-opening.
  cacheSave({
    name:     state.pdfName,
    fileType: isPdf ? 'pdf' : 'image',
    blob:     file,
    addedAt:  Date.now(),
  });
  const reader = new FileReader();
  reader.onload = (e) => {
    if (isPdf) {
      state.inputType = 'pdf';
      state.pdfBytes  = e.target.result.slice(0);
      loadPDF(e.target.result);
    } else {
      state.inputType = 'image';
      state.imageMime = file.type || 'image/png';
      loadImage(e.target.result);
    }
  };
  if (isPdf) reader.readAsArrayBuffer(file);
  else       reader.readAsDataURL(file);
}

// Render the recent list on first load.
renderRecents();

pdfUpload .addEventListener('change', (e) => handleFile(e.target.files[0]));
pdfUpload2.addEventListener('change', (e) => handleFile(e.target.files[0]));

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

// ── Load PDF ─────────────────────────────────────────────────────────────────

async function loadPDF(arrayBuffer) {
  showToast('Loading PDF…');
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.pdfDoc = pdf;
    resetCanvases();
    revealUI(`${state.pdfName} · ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}`);

    const savedAnnotations = loadSaved();
    for (let i = 1; i <= pdf.numPages; i++) {
      await renderPdfPage(pdf, i, savedAnnotations[i] || null);
    }
    showToast('Ready to annotate.');
  } catch (err) {
    showToast('Failed to load PDF.', 'error');
    console.error(err);
  }
}

// ── Load Image ───────────────────────────────────────────────────────────────

async function loadImage(dataUrl) {
  showToast('Loading image…');
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = reject;
      img.src     = dataUrl;
    });
    state.imageBitmap = img;
    resetCanvases();
    revealUI(`${state.pdfName} · image`);

    const savedAnnotations = loadSaved();
    await renderImagePage(img, savedAnnotations[1] || null);
    showToast('Ready to annotate.');
  } catch (err) {
    showToast('Failed to load image.', 'error');
    console.error(err);
  }
}

function resetCanvases() {
  state.fabricCanvases = [];
  state.histories      = [];
  state.snapshots      = [];
  state.pageDims       = [];
  pagesContainer.innerHTML = '';
}

// ── History (undo) ───────────────────────────────────────────────────────────

const PERSIST_KEYS = ['selectable', '_isNote', '_noteText'];

function snapshotOf(fc) {
  return JSON.stringify(fc.toJSON(PERSIST_KEYS));
}

function recordChange(idx) {
  if (state.suppressHistory) return;
  const fc = state.fabricCanvases[idx];
  if (!fc) return;
  const cur = snapshotOf(fc);
  if (cur === state.snapshots[idx]) return;  // dedup: nothing actually changed
  state.histories[idx].push(state.snapshots[idx]);
  state.snapshots[idx] = cur;
  if (state.histories[idx].length > 200) state.histories[idx].shift();
}

function attachEditingHandlers(idx, obj) {
  if (!obj || !obj.isType) return;
  if (!obj.isType('textbox') && !obj.isType('i-text') && !obj.isType('text')) return;
  if (obj._editHandlersAttached) return;
  obj._editHandlersAttached = true;
  obj.on('editing:exited', () => recordChange(idx));
}

function revealUI(info) {
  dropZone.style.display = 'none';
  pagesContainer.style.display = 'flex';
  toolsSection .classList.add('visible');
  colorSection .classList.add('visible');
  actionsSection.classList.add('visible');
  pageSection  .classList.add('visible');
  docInfo.textContent = info;
}

function loadSaved() {
  const saved = localStorage.getItem(`annotations_${state.pdfName}`);
  return saved ? JSON.parse(saved) : {};
}

// ── Render a PDF page ────────────────────────────────────────────────────────

async function renderPdfPage(pdf, pageNum, savedAnnotations) {
  const page = await pdf.getPage(pageNum);
  const scale = 1.5;
  const viewport = page.getViewport({ scale });
  const W = viewport.width;
  const H = viewport.height;

  const { fc, pdfCanvas } = buildPageDOM(pageNum, W, H);
  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;
  await finishPageInit(fc, pageNum, savedAnnotations);
}

// ── Render an image as a single page ─────────────────────────────────────────

async function renderImagePage(img, savedAnnotations) {
  // Scale image to a reasonable display width
  const MAX_W = 1100;
  const ratio = img.naturalWidth > MAX_W ? MAX_W / img.naturalWidth : 1;
  const W = Math.round(img.naturalWidth  * ratio);
  const H = Math.round(img.naturalHeight * ratio);

  const { fc, pdfCanvas } = buildPageDOM(1, W, H);
  pdfCanvas.getContext('2d').drawImage(img, 0, 0, W, H);
  await finishPageInit(fc, 1, savedAnnotations);
}

function buildPageDOM(pageNum, W, H) {
  const pageWrapper = document.createElement('div');
  pageWrapper.className = 'page-wrapper';
  pageWrapper.dataset.page = pageNum;

  const label = document.createElement('div');
  label.className = 'page-label';
  label.textContent = state.inputType === 'image' ? state.pdfName : `Page ${pageNum}`;
  pageWrapper.appendChild(label);

  const stack = document.createElement('div');
  stack.className = 'canvas-stack';
  stack.style.width  = W + 'px';
  stack.style.height = H + 'px';

  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-canvas';
  pdfCanvas.width  = W;
  pdfCanvas.height = H;
  stack.appendChild(pdfCanvas);

  const fabWrap = document.createElement('div');
  fabWrap.className = 'fabric-wrap';
  const fabEl = document.createElement('canvas');
  fabEl.width  = W;
  fabEl.height = H;
  fabWrap.appendChild(fabEl);
  stack.appendChild(fabWrap);

  pageWrapper.appendChild(stack);
  pagesContainer.appendChild(pageWrapper);

  state.pageDims[pageNum - 1] = { width: W, height: H };

  const fc = new fabric.Canvas(fabEl, {
    selection: true,
    backgroundColor: null,
    enableRetinaScaling: false,
  });
  fc.setDimensions({ width: W, height: H });

  return { fc, pdfCanvas };
}

async function finishPageInit(fc, pageNum, savedAnnotations) {
  const idx = pageNum - 1;
  state.fabricCanvases[idx] = fc;
  state.histories[idx]      = [];
  if (savedAnnotations) {
    state.suppressHistory = true;
    await new Promise(resolve => fc.loadFromJSON(savedAnnotations, () => { fc.renderAll(); resolve(); }));
    state.suppressHistory = false;
    fixupNotesAfterLoad(fc, savedAnnotations);
    fc.forEachObject(o => { o.selectable = true; attachEditingHandlers(idx, o); });
  }
  state.snapshots[idx] = snapshotOf(fc);
  setupPageInteraction(fc, idx);
  applyToolToCanvas(fc);
}

// ── Per-canvas interaction ───────────────────────────────────────────────────

function setupPageInteraction(fc, idx) {
  let isDown = false;
  let startX, startY;
  let activeShape = null;

  fc.on('mouse:down', (opt) => {
    const tool = state.currentTool;
    if (tool === 'select' || tool === 'draw') return;
    // If user clicked an existing object, let Fabric handle selection.
    if (fc.findTarget(opt.e, false)) return;

    if (tool === 'delete') {
      const target = fc.findTarget(opt.e);
      if (target) { fc.remove(target); recordChange(idx); fc.renderAll(); }
      return;
    }
    if (tool === 'text') {
      const p = fc.getPointer(opt.e);
      const txt = new fabric.Textbox('', {
        left: p.x, top: p.y,
        width: 220, fontSize: 15,
        fill: state.currentColor,
        fontFamily: 'DM Sans, sans-serif',
        backgroundColor: 'rgba(255,255,255,0.85)',
        padding: 6,
        borderColor: state.currentColor,
        cornerColor: state.currentColor,
        selectable: true,
      });
      fc.add(txt);
      fc.setActiveObject(txt);
      txt.enterEditing();
      txt.on('editing:exited', () => {
        if (!txt.text || !txt.text.trim()) fc.remove(txt);
        recordChange(idx);
        fc.renderAll();
      });
      attachEditingHandlers(idx, txt);
      return;
    }
    if (tool === 'note') {
      const p = fc.getPointer(opt.e);
      const note = createNoteMarker(p.x - 14, p.y - 14);
      fc.add(note);
      fc.setActiveObject(note);
      recordChange(idx);
      openNoteEditor(idx, note);
      fc.renderAll();
      return;
    }

    isDown = true;
    const p = fc.getPointer(opt.e);
    startX = p.x;
    startY = p.y;

    if (tool === 'highlight') {
      activeShape = new fabric.Rect({
        left: startX, top: startY,
        width: 1, height: 1,
        fill: state.currentColor,
        opacity: 0.35,
        strokeWidth: 0,
        selectable: true,
      });
    } else if (tool === 'circle') {
      activeShape = new fabric.Ellipse({
        left: startX, top: startY,
        rx: 1, ry: 1,
        fill: 'transparent',
        stroke: state.currentColor,
        strokeWidth: 3,
        strokeUniform: true,
        selectable: true,
      });
    } else if (tool === 'arrow') {
      activeShape = new fabric.Arrow([startX, startY, startX, startY], {
        stroke: state.currentColor,
        strokeWidth: 3,
        strokeUniform: true,
        selectable: true,
      });
    } else if (tool === 'line') {
      activeShape = new fabric.Line([startX, startY, startX, startY], {
        stroke: state.currentColor,
        strokeWidth: 3,
        strokeUniform: true,
        selectable: true,
      });
    }

    if (activeShape) fc.add(activeShape);
  });

  fc.on('mouse:move', (opt) => {
    if (!isDown || !activeShape) return;
    const p = fc.getPointer(opt.e);
    const tool = state.currentTool;

    if (tool === 'highlight') {
      const w = p.x - startX;
      const h = p.y - startY;
      activeShape.set({
        width:  Math.abs(w),
        height: Math.abs(h),
        left:   w < 0 ? p.x : startX,
        top:    h < 0 ? p.y : startY,
      });
    } else if (tool === 'circle') {
      const rx = Math.abs(p.x - startX) / 2;
      const ry = Math.abs(p.y - startY) / 2;
      activeShape.set({
        rx, ry,
        left: Math.min(startX, p.x),
        top:  Math.min(startY, p.y),
      });
    } else if (tool === 'arrow' || tool === 'line') {
      activeShape.set({ x2: p.x, y2: p.y });
      activeShape.setCoords();
    }
    fc.renderAll();
  });

  fc.on('mouse:up', () => {
    if (!isDown || !activeShape) {
      isDown = false;
      activeShape = null;
      return;
    }
    // Discard tiny accidental drags
    const tool = state.currentTool;
    let tooSmall = false;
    if (tool === 'highlight' && activeShape.width < 4 && activeShape.height < 4) tooSmall = true;
    if (tool === 'circle'    && activeShape.rx    < 3 && activeShape.ry     < 3) tooSmall = true;
    if (tool === 'arrow' || tool === 'line') {
      const dx = activeShape.x2 - activeShape.x1;
      const dy = activeShape.y2 - activeShape.y1;
      if (Math.hypot(dx, dy) < 6) tooSmall = true;
    }
    if (tooSmall) {
      fc.remove(activeShape);
      isDown = false;
      activeShape = null;
      return;
    }
    activeShape.setCoords();
    recordChange(idx);
    isDown = false;
    activeShape = null;
    fc.renderAll();
  });

  fc.on('object:modified', () => recordChange(idx));
  fc.on('path:created',    () => recordChange(idx));

  // Notes: open the editor when a single note marker is selected.
  fc.on('selection:created', () => maybeShowNoteEditor(fc, idx));
  fc.on('selection:updated', () => maybeShowNoteEditor(fc, idx));
  fc.on('selection:cleared', () => closeNoteEditor(true));
}

function maybeShowNoteEditor(fc, idx) {
  const obj = fc.getActiveObject();
  if (obj && obj._isNote) openNoteEditor(idx, obj);
  else closeNoteEditor(true);
}

// ── Sticky note marker ───────────────────────────────────────────────────────

function createNoteMarker(left, top, noteText = '') {
  const SIZE = 28;
  const bg = new fabric.Rect({
    width: SIZE, height: SIZE, rx: 4, ry: 4,
    fill: '#fff176', stroke: '#f0c000', strokeWidth: 1,
    originX: 'center', originY: 'center',
  });
  const glyph = new fabric.Text('💬', {
    fontSize: 16, originX: 'center', originY: 'center',
  });
  const note = new fabric.Group([bg, glyph], {
    left, top,
    hasControls: false,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    selectable: true,
    hoverCursor: 'pointer',
    _isNote: true,
    _noteText: noteText,
  });
  return note;
}

// After load, Fabric reconstructs groups but custom keys may need re-setting.
function fixupNotesAfterLoad(fc, raw) {
  // Walk raw JSON objects to find which restored groups are notes; map by index.
  const groups = fc.getObjects();
  if (!raw || !raw.objects) return;
  raw.objects.forEach((obj, i) => {
    if (obj && obj._isNote && groups[i]) {
      groups[i]._isNote   = true;
      groups[i]._noteText = obj._noteText || '';
      groups[i].hasControls = false;
      groups[i].lockScalingX = true;
      groups[i].lockScalingY = true;
      groups[i].lockRotation = true;
      groups[i].hoverCursor = 'pointer';
    }
  });
}

// ── Floating note editor ─────────────────────────────────────────────────────

const noteEditor       = document.getElementById('noteEditor');
const noteEditorText   = document.getElementById('noteEditorText');
const noteEditorDone   = document.getElementById('noteEditorDone');
const noteEditorDelete = document.getElementById('noteEditorDelete');

let activeNote = null;  // { idx, obj }
let originalNoteText = '';

function openNoteEditor(idx, noteObj) {
  if (activeNote && activeNote.obj === noteObj) {
    // already open for this note — just reposition
    positionNoteEditor(idx, noteObj);
    return;
  }
  // If editor was open for a different note, commit first.
  closeNoteEditor(true);
  activeNote = { idx, obj: noteObj };
  originalNoteText = noteObj._noteText || '';
  noteEditorText.value = originalNoteText;
  noteEditor.hidden = false;
  positionNoteEditor(idx, noteObj);
  // Focus the textarea after the editor is visible.
  setTimeout(() => noteEditorText.focus(), 0);
}

function positionNoteEditor(idx, noteObj) {
  const fc = state.fabricCanvases[idx];
  if (!fc) return;
  const canvasEl = fc.lowerCanvasEl;
  const canvasRect = canvasEl.getBoundingClientRect();
  const bounds = noteObj.getBoundingRect(true);
  const editorW = 260;
  const editorH = 140;
  const gap = 8;
  let left = canvasRect.left + bounds.left + bounds.width + gap;
  let top  = canvasRect.top  + bounds.top;
  if (left + editorW > window.innerWidth - 8) {
    left = canvasRect.left + bounds.left - editorW - gap;
  }
  if (left < 8) {
    left = canvasRect.left + bounds.left;
    top  = canvasRect.top + bounds.top + bounds.height + gap;
  }
  if (top + editorH > window.innerHeight - 8) {
    top = window.innerHeight - editorH - 8;
  }
  if (top < 8) top = 8;
  noteEditor.style.left = left + 'px';
  noteEditor.style.top  = top  + 'px';
}

function closeNoteEditor(commit) {
  if (!activeNote) return;
  const { idx, obj } = activeNote;
  if (commit) {
    const newText = noteEditorText.value;
    if (newText !== originalNoteText) {
      obj._noteText = newText;
      recordChange(idx);
    }
  }
  noteEditor.hidden = true;
  activeNote = null;
  originalNoteText = '';
}

noteEditorDone.addEventListener('click', () => {
  closeNoteEditor(true);
  state.fabricCanvases.forEach(c => c && c.discardActiveObject().renderAll());
});

noteEditorDelete.addEventListener('click', () => {
  if (!activeNote) return;
  const { idx, obj } = activeNote;
  const fc = state.fabricCanvases[idx];
  noteEditor.hidden = true;
  activeNote = null;
  fc.remove(obj);
  fc.discardActiveObject();
  fc.renderAll();
  recordChange(idx);
});

// Commit on Esc / Cmd+Enter; discard on outside scroll.
noteEditorText.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
    e.preventDefault();
    closeNoteEditor(true);
    state.fabricCanvases.forEach(c => c && c.discardActiveObject().renderAll());
  }
});

document.addEventListener('scroll', () => closeNoteEditor(true), true);
window.addEventListener('resize',  () => { if (activeNote) positionNoteEditor(activeNote.idx, activeNote.obj); });

// ── Tool switching ───────────────────────────────────────────────────────────

function setActiveTool(toolName) {
  state.currentTool = toolName;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === toolName);
  });
  state.fabricCanvases.forEach(fc => fc && applyToolToCanvas(fc));
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
});

function applyToolToCanvas(fc) {
  const tool = state.currentTool;

  if (tool === 'draw') {
    fc.isDrawingMode = true;
    fc.freeDrawingBrush.color = state.currentColor;
    fc.freeDrawingBrush.width = 3;
    fc.selection = false;
    fc.defaultCursor = 'crosshair';
    fc.hoverCursor   = 'crosshair';
  } else {
    fc.isDrawingMode = false;
    const isSelect = tool === 'select';
    fc.selection = isSelect;
    // Keep all shapes selectable so user can grab them at any time;
    // but when a drawing tool is active, mouse:down on empty space starts a new draw.
    fc.forEachObject(o => { o.selectable = true; o.evented = true; });
    if (isSelect) {
      fc.defaultCursor = 'default';
      fc.hoverCursor   = 'move';
    } else if (tool === 'delete') {
      fc.defaultCursor = 'not-allowed';
      fc.hoverCursor   = 'not-allowed';
    } else {
      fc.defaultCursor = 'crosshair';
      fc.hoverCursor   = 'move';
    }
    fc.renderAll();
  }
}

// ── Color swatches ───────────────────────────────────────────────────────────

document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    state.currentColor = swatch.dataset.color;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    state.fabricCanvases.forEach(fc => {
      if (fc && fc.isDrawingMode) fc.freeDrawingBrush.color = state.currentColor;
    });
  });
});

// ── Undo ─────────────────────────────────────────────────────────────────────

function performUndo() {
  // Pick the most-recently-changed canvas to undo on.
  let target = -1;
  for (let i = state.histories.length - 1; i >= 0; i--) {
    if (state.histories[i] && state.histories[i].length > 0) { target = i; break; }
  }
  if (target < 0) { showToast('Nothing to undo.'); return; }
  const fc   = state.fabricCanvases[target];
  const prev = state.histories[target].pop();
  state.suppressHistory = true;
  // Exit any active editing so we don't load on top of an open editor.
  const ao = fc.getActiveObject();
  if (ao && ao.isEditing) ao.exitEditing();
  fc.discardActiveObject();
  fc.loadFromJSON(prev, () => {
    fixupNotesAfterLoad(fc, typeof prev === 'string' ? JSON.parse(prev) : prev);
    fc.forEachObject(o => { o.selectable = true; attachEditingHandlers(target, o); });
    fc.renderAll();
    state.snapshots[target] = prev;
    state.suppressHistory = false;
  });
}

undoBtn.addEventListener('click', performUndo);

document.addEventListener('keydown', (e) => {
  // Delete/Backspace removes selected (but not while editing a textbox)
  const ae = document.activeElement;
  const editingTextbox = state.fabricCanvases.some(fc => {
    const obj = fc && fc.getActiveObject();
    return obj && obj.isEditing;
  });
  if ((e.key === 'Delete' || e.key === 'Backspace') && !editingTextbox) {
    let removed = false;
    state.fabricCanvases.forEach((fc, i) => {
      const obj = fc && fc.getActiveObject();
      if (obj) {
        fc.remove(obj);
        fc.discardActiveObject();
        fc.renderAll();
        recordChange(i);
        removed = true;
      }
    });
    if (removed) e.preventDefault();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    performUndo();
  }
});

// ── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  saveAnnotations();
  await touchCache();
  showToast('Saved.');
});

async function touchCache() {
  if (!state.pdfName) return;
  const rec = await cacheGet(state.pdfName);
  if (rec) { rec.addedAt = Date.now(); await cacheSave(rec); }
}

function saveAnnotations() {
  const annotations = {};
  state.fabricCanvases.forEach((fc, i) => {
    if (fc) annotations[i + 1] = fc.toJSON(PERSIST_KEYS);
  });
  localStorage.setItem(`annotations_${state.pdfName}`, JSON.stringify(annotations));
}

// ── Export ───────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  showToastPersist('Exporting…');
  try {
    saveAnnotations();
    if (state.inputType === 'image') {
      await exportImage();
    } else {
      await exportPdf();
    }
    showToast('Exported! Share the file with your client.');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Export failed. Check the console for details.', 'error');
  } finally {
    exportBtn.disabled = false;
  }
});

function renderOverlayWithoutNotes(fc) {
  const notes = fc.getObjects().filter(o => o._isNote);
  notes.forEach(n => n.set('visible', false));
  fc.requestRenderAll();
  const url = fc.toDataURL({ format: 'png', multiplier: 1 });
  notes.forEach(n => n.set('visible', true));
  fc.requestRenderAll();
  return { url, notes };
}

function attachStickyNote(pdfDoc, page, xPdf, yPdf, text) {
  const { PDFName, PDFHexString } = PDFLib;
  const annot = pdfDoc.context.obj({
    Type:     'Annot',
    Subtype:  'Text',
    Rect:     [xPdf - 12, yPdf - 12, xPdf + 12, yPdf + 12],
    Contents: PDFHexString.fromText(text || ''),
    T:        PDFHexString.fromText('David Dalisay'),
    Open:     false,
    Name:     'Comment',
    C:        [1.0, 0.85, 0.2],
    F:        4,  // print flag
  });
  const ref = pdfDoc.context.register(annot);
  const annotsKey = PDFName.of('Annots');
  let annots = page.node.get(annotsKey);
  if (!annots) {
    annots = pdfDoc.context.obj([]);
    page.node.set(annotsKey, annots);
  }
  annots.push(ref);
}

async function exportPdf() {
  if (!state.pdfBytes) return;
  const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes);
  const pages  = pdfDoc.getPages();

  for (let i = 0; i < state.fabricCanvases.length; i++) {
    const fc = state.fabricCanvases[i];
    if (!fc) continue;
    const objects = fc.getObjects();
    if (objects.length === 0) continue;

    const page = pages[i];
    const { width: pdfW, height: pdfH } = page.getSize();
    const dims = state.pageDims[i];

    // Rasterize everything EXCEPT note markers.
    const { url, notes } = renderOverlayWithoutNotes(fc);
    const nonNotesPresent = objects.length > notes.length;
    if (nonNotesPresent) {
      const overlayImg = await pdfDoc.embedPng(dataUrlToBytes(url));
      page.drawImage(overlayImg, { x: 0, y: 0, width: pdfW, height: pdfH });
    }

    // Attach each note as a real PDF Text annotation.
    const rx = pdfW / dims.width;
    const ry = pdfH / dims.height;
    notes.forEach(n => {
      const b  = n.getBoundingRect(true);
      const cx = b.left + b.width  / 2;
      const cy = b.top  + b.height / 2;
      const xPdf = cx * rx;
      const yPdf = pdfH - cy * ry;
      attachStickyNote(pdfDoc, page, xPdf, yPdf, n._noteText || '');
    });
  }
  const pdfBytes = await pdfDoc.save();
  triggerDownload(new Blob([pdfBytes], { type: 'application/pdf' }), `${state.pdfName}-review.pdf`);
}

async function exportImage() {
  const fc = state.fabricCanvases[0];
  if (!fc) return;
  const hasNotes = fc.getObjects().some(o => o._isNote);
  if (hasNotes) {
    await exportImageAsPdf();
    return;
  }
  // Pure image, no notes: flat PNG export.
  const img = state.imageBitmap;
  const dims = state.pageDims[0];
  const out = document.createElement('canvas');
  out.width  = dims.width;
  out.height = dims.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(img, 0, 0, dims.width, dims.height);
  const overlayUrl = fc.toDataURL({ format: 'png', multiplier: 1 });
  const overlayImg = new Image();
  await new Promise((res, rej) => {
    overlayImg.onload  = res;
    overlayImg.onerror = rej;
    overlayImg.src     = overlayUrl;
  });
  ctx.drawImage(overlayImg, 0, 0);
  const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
  triggerDownload(blob, `${state.pdfName}-review.png`);
}

async function exportImageAsPdf() {
  const img  = state.imageBitmap;
  const fc   = state.fabricCanvases[0];
  const dims = state.pageDims[0];
  if (!img || !fc) return;
  const pdfDoc = await PDFLib.PDFDocument.create();

  // Re-encode the image as PNG via canvas. Handles WebP and avoids
  // pdf-lib choking on uncommon formats.
  const tmp = document.createElement('canvas');
  tmp.width  = dims.width;
  tmp.height = dims.height;
  tmp.getContext('2d').drawImage(img, 0, 0, dims.width, dims.height);
  const pdfImg = await pdfDoc.embedPng(dataUrlToBytes(tmp.toDataURL('image/png')));
  const page = pdfDoc.addPage([dims.width, dims.height]);
  page.drawImage(pdfImg, { x: 0, y: 0, width: dims.width, height: dims.height });

  // Overlay (without notes)
  const { url, notes } = renderOverlayWithoutNotes(fc);
  const objects = fc.getObjects();
  if (objects.length > notes.length) {
    const overlayImg = await pdfDoc.embedPng(dataUrlToBytes(url));
    page.drawImage(overlayImg, { x: 0, y: 0, width: dims.width, height: dims.height });
  }

  // Notes as annotations (PDF coords: origin bottom-left)
  notes.forEach(n => {
    const b  = n.getBoundingRect(true);
    const cx = b.left + b.width  / 2;
    const cy = b.top  + b.height / 2;
    attachStickyNote(pdfDoc, page, cx, dims.height - cy, n._noteText || '');
  });

  const pdfBytes = await pdfDoc.save();
  triggerDownload(new Blob([pdfBytes], { type: 'application/pdf' }), `${state.pdfName}-review.pdf`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;

function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = 'toast toast--visible' + (type === 'error' ? ' toast--error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}

function showToastPersist(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast toast--visible';
}
