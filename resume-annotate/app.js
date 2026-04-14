pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = {
  pdfDoc: null,
  pdfBytes: null,
  pdfName: '',
  fabricCanvases: [],   // indexed by pageNum - 1
  historyStacks: [],    // undo stacks per page
  currentTool: 'select',
  currentColor: '#FFEB3B',
};

// DOM refs
const pdfUpload    = document.getElementById('pdfUpload');
const pdfUpload2   = document.getElementById('pdfUpload2');
const dropZone     = document.getElementById('dropZone');
const pagesContainer = document.getElementById('pagesContainer');
const toolsSection = document.getElementById('toolsSection');
const colorSection = document.getElementById('colorSection');
const actionsSection = document.getElementById('actionsSection');
const pageSection  = document.getElementById('pageSection');
const docInfo      = document.getElementById('docInfo');
const saveBtn      = document.getElementById('saveBtn');
const exportBtn    = document.getElementById('exportBtn');
const undoBtn      = document.getElementById('undoBtn');
const toast        = document.getElementById('toast');

// ── File handling ─────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file || file.type !== 'application/pdf') {
    showToast('Please upload a PDF file.', 'error');
    return;
  }
  state.pdfName = file.name.replace(/\.pdf$/i, '');
  const reader = new FileReader();
  reader.onload = (e) => {
    // Clone before passing to pdf.js - pdf.js detaches the original ArrayBuffer
    state.pdfBytes = e.target.result.slice(0);
    loadPDF(e.target.result);
  };
  reader.readAsArrayBuffer(file);
}

pdfUpload.addEventListener('change',  (e) => handleFile(e.target.files[0]));
pdfUpload2.addEventListener('change', (e) => handleFile(e.target.files[0]));

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

// ── Load PDF ──────────────────────────────────────────────────────────────────

async function loadPDF(arrayBuffer) {
  showToast('Loading PDF…');
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.pdfDoc = pdf;
    state.fabricCanvases = [];
    state.historyStacks = [];
    pagesContainer.innerHTML = '';

    dropZone.style.display = 'none';
    pagesContainer.style.display = 'flex';
    toolsSection.classList.add('visible');
    colorSection.classList.add('visible');
    actionsSection.classList.add('visible');
    pageSection.classList.add('visible');

    docInfo.textContent = `${state.pdfName} · ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}`;

    const saved = localStorage.getItem(`annotations_${state.pdfName}`);
    const savedAnnotations = saved ? JSON.parse(saved) : {};

    for (let i = 1; i <= pdf.numPages; i++) {
      await renderPage(pdf, i, savedAnnotations[i] || null);
    }
    showToast('Ready to annotate.');
  } catch (err) {
    showToast('Failed to load PDF.', 'error');
    console.error(err);
  }
}

// ── Render a single page ──────────────────────────────────────────────────────

async function renderPage(pdf, pageNum, savedAnnotations) {
  const page = await pdf.getPage(pageNum);
  const scale = 1.5;
  const viewport = page.getViewport({ scale });
  const W = viewport.width;
  const H = viewport.height;

  // Outer wrapper
  const pageWrapper = document.createElement('div');
  pageWrapper.className = 'page-wrapper';
  pageWrapper.dataset.page = pageNum;

  const label = document.createElement('div');
  label.className = 'page-label';
  label.textContent = `Page ${pageNum}`;
  pageWrapper.appendChild(label);

  // Canvas stack container
  const stack = document.createElement('div');
  stack.className = 'canvas-stack';
  stack.style.width  = W + 'px';
  stack.style.height = H + 'px';

  // PDF background canvas
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-canvas';
  pdfCanvas.width  = W;
  pdfCanvas.height = H;
  stack.appendChild(pdfCanvas);

  // Fabric overlay wrapper (so fabric's own wrapper div is contained)
  const fabWrap = document.createElement('div');
  fabWrap.className = 'fabric-wrap';
  const fabEl = document.createElement('canvas');
  fabEl.width  = W;
  fabEl.height = H;
  fabWrap.appendChild(fabEl);
  stack.appendChild(fabWrap);

  pageWrapper.appendChild(stack);
  pagesContainer.appendChild(pageWrapper);

  // Render PDF page
  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

  // Init Fabric canvas
  const fc = new fabric.Canvas(fabEl, {
    selection: true,
    backgroundColor: null,
    enableRetinaScaling: false,
  });
  fc.setDimensions({ width: W, height: H });

  // Restore saved annotations
  if (savedAnnotations) {
    await new Promise(resolve => fc.loadFromJSON(savedAnnotations, () => { fc.renderAll(); resolve(); }));
  }

  state.fabricCanvases[pageNum - 1] = fc;
  state.historyStacks[pageNum - 1] = [];

  setupPageInteraction(fc, pageNum - 1);
  applyToolToCanvas(fc);
}

// ── Per-canvas interaction ────────────────────────────────────────────────────

function setupPageInteraction(fc, idx) {
  let isDown = false;
  let startX, startY;
  let activeShape = null;

  // Save state to undo stack before adding something
  function pushHistory() {
    state.historyStacks[idx].push(fc.toJSON());
  }

  fc.on('mouse:down', (opt) => {
    const tool = state.currentTool;
    if (tool === 'select') return;
    if (tool === 'draw') return;
    if (tool === 'delete') {
      const target = fc.findTarget(opt.e);
      if (target) { pushHistory(); fc.remove(target); fc.renderAll(); }
      return;
    }
    if (tool === 'text') {
      const p = fc.getPointer(opt.e);
      pushHistory();
      const txt = new fabric.Textbox('Add comment', {
        left: p.x,
        top: p.y,
        width: 200,
        fontSize: 15,
        fill: state.currentColor,
        fontFamily: 'DM Sans, sans-serif',
        backgroundColor: 'rgba(255,255,255,0.85)',
        padding: 6,
        borderColor: state.currentColor,
        cornerColor: state.currentColor,
        splitByGrapheme: false,
      });
      fc.add(txt);
      fc.setActiveObject(txt);
      txt.enterEditing();
      txt.selectAll();
      return;
    }

    // Highlight or circle - drag to draw
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
    }
    fc.renderAll();
  });

  fc.on('mouse:up', () => {
    if (isDown && activeShape) {
      pushHistory();
    }
    isDown = false;
    activeShape = null;
  });

  // Push history before modifying an existing object
  fc.on('object:modified', () => pushHistory());

  // Free draw: push history when path added
  fc.on('path:created', () => pushHistory());
}

// ── Tool switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.currentTool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.fabricCanvases.forEach(fc => fc && applyToolToCanvas(fc));
  });
});

function applyToolToCanvas(fc) {
  const tool = state.currentTool;

  if (tool === 'draw') {
    fc.isDrawingMode = true;
    fc.freeDrawingBrush.color = state.currentColor;
    fc.freeDrawingBrush.width = 3;
    fc.selection = false;
  } else {
    fc.isDrawingMode = false;
    fc.selection = tool === 'select';
    fc.forEachObject(o => { o.selectable = tool === 'select'; });
    if (tool !== 'select') fc.discardActiveObject();
    fc.renderAll();
  }
}

// ── Color swatches ────────────────────────────────────────────────────────────

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
  let undone = false;
  for (let i = state.historyStacks.length - 1; i >= 0; i--) {
    const stack = state.historyStacks[i];
    if (stack && stack.length > 0) {
      const prev = stack.pop();
      const fc = state.fabricCanvases[i];
      fc.loadFromJSON(prev, () => { fc.renderAll(); });
      undone = true;
      break;
    }
  }
  if (!undone) showToast('Nothing to undo.');
}

undoBtn.addEventListener('click', performUndo);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    performUndo();
  }
});

// ── Save ──────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  saveAnnotations();
  showToast('Saved.');
});

function saveAnnotations() {
  const annotations = {};
  state.fabricCanvases.forEach((fc, i) => {
    if (fc) annotations[i + 1] = fc.toJSON();
  });
  localStorage.setItem(`annotations_${state.pdfName}`, JSON.stringify(annotations));
}

// ── Export for client ─────────────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  if (!state.pdfBytes) return;
  exportBtn.disabled = true;
  showToastPersist('Exporting PDF…');

  try {
    saveAnnotations();

    // Load original PDF into pdf-lib
    const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes);
    const pages  = pdfDoc.getPages();

    for (let i = 0; i < state.fabricCanvases.length; i++) {
      const fc = state.fabricCanvases[i];
      if (!fc) continue;

      // Skip pages with no annotations
      const objects = fc.getObjects();
      if (objects.length === 0) continue;

      // Render fabric canvas to PNG
      const pngDataUrl = fc.toDataURL({ format: 'png', multiplier: 1 });
      const pngBytes   = dataUrlToBytes(pngDataUrl);
      const pngImage   = await pdfDoc.embedPng(pngBytes);

      const page = pages[i];
      const { width, height } = page.getSize();

      // Draw annotation image over the full page
      page.drawImage(pngImage, { x: 0, y: 0, width, height });
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${state.pdfName}-review.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Exported! Share the PDF with your client.');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Export failed. Check the console for details.', 'error');
  } finally {
    exportBtn.disabled = false;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Build viewer HTML (unused - kept for reference) ───────────────────────────

function buildViewerHTML(pdfBase64, annotationsJson, name) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escHtml(name)} - Resume Review · Empath Interview Prep</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0ece4;font-family:'DM Sans',sans-serif;color:#1a1a1a}
.header{background:#fff;border-bottom:1px solid #e8e0d5;padding:1rem 2rem;display:flex;align-items:center;gap:1.5rem}
.header__brand{font-weight:700;font-size:0.9rem;color:#1a1a1a;white-space:nowrap}
.header__mark{color:#c96a2e;margin-right:0.35rem}
.header__divider{width:1px;height:1.25rem;background:#e8e0d5}
.header__name{font-size:0.875rem;color:#666}
.header__note{margin-left:auto;font-size:0.8rem;color:#999}
.pages{display:flex;flex-direction:column;align-items:center;padding:2rem;gap:2rem}
.page-wrapper{background:#fff;box-shadow:0 2px 16px rgba(0,0,0,0.1);border-radius:2px;overflow:hidden}
.page-label{font-size:0.75rem;color:#999;padding:0.4rem 0.75rem;background:#f9f7f4;border-bottom:1px solid #e8e0d5}
.canvas-stack{position:relative}
.canvas-stack canvas{position:absolute;top:0;left:0}
.canvas-stack canvas:first-child{position:relative}
</style>
</head>
<body>
<div class="header">
  <div class="header__brand"><span class="header__mark">✦</span>Empath Interview Prep</div>
  <div class="header__divider"></div>
  <div class="header__name">Resume Review - ${escHtml(name)}</div>
  <div class="header__note">Annotated by David Dalisay</div>
</div>
<div class="pages" id="pages"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"><\/script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const annotations=${annotationsJson};
const b64='${pdfBase64}';
const bin=atob(b64);
const bytes=new Uint8Array(bin.length);
for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
(async()=>{
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  const container=document.getElementById('pages');
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const vp=page.getViewport({scale:1.5});
    const W=vp.width,H=vp.height;
    const wrapper=document.createElement('div');
    wrapper.className='page-wrapper';
    const lbl=document.createElement('div');
    lbl.className='page-label';
    lbl.textContent='Page '+i;
    wrapper.appendChild(lbl);
    const stack=document.createElement('div');
    stack.className='canvas-stack';
    stack.style.width=W+'px';
    stack.style.height=H+'px';
    const pdfC=document.createElement('canvas');
    pdfC.width=W;pdfC.height=H;
    stack.appendChild(pdfC);
    const fabEl=document.createElement('canvas');
    fabEl.width=W;fabEl.height=H;
    fabEl.style.cssText='position:absolute;top:0;left:0;pointer-events:none;';
    stack.appendChild(fabEl);
    wrapper.appendChild(stack);
    container.appendChild(wrapper);
    await page.render({canvasContext:pdfC.getContext('2d'),viewport:vp}).promise;
    if(annotations[i]){
      const fc=new fabric.StaticCanvas(fabEl,{enableRetinaScaling:false});
      fc.setDimensions({width:W,height:H});
      fc.loadFromJSON(annotations[i],()=>fc.renderAll());
    }
  }
})();
<\/script>
</body>
</html>`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

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
