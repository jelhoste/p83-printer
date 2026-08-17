/**
 * P83 Thermal Printer PWA
 * Impression de PDF via Web Bluetooth (ESC/POS)
 */

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

// ========== State ==========
const state = {
  device: null,
  server: null,
  characteristic: null,
  connected: false,
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  currentSource: 'local',
  currentFolderPath: [],
  documentsTree: null,
  selectedFile: null, // { name, url or ArrayBuffer }
};

// Common BLE service / characteristic UUIDs used by many Chinese thermal printers
const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  btnConnect: $('#btn-connect'),
  statusBadge: $('#connection-status'),
  fileInput: $('#file-input'),
  localFilename: $('#local-filename'),
  folderList: $('#folder-list'),
  breadcrumb: $('#breadcrumb'),
  previewSection: $('#preview-section'),
  previewCanvas: $('#preview-canvas'),
  pageInfo: $('#page-info'),
  btnPrev: $('#btn-prev-page'),
  btnNext: $('#btn-next-page'),
  btnPrint: $('#btn-print'),
  btnPrintAll: $('#btn-print-all'),
  density: $('#print-density'),
  paperWidth: $('#paper-width'),
  log: $('#log'),
};

// ========== Utils ==========
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `entry ${type}`;
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  el.log.prepend(entry);
  // keep last 50
  while (el.log.children.length > 50) el.log.lastChild.remove();
}

function setConnected(connected) {
  state.connected = connected;
  el.statusBadge.textContent = connected ? 'Connecté' : 'Déconnecté';
  el.statusBadge.className = `status-badge ${connected ? 'online' : 'offline'}`;
  el.btnConnect.innerHTML = connected
    ? '<span class="icon">🔌</span><span class="btn-text">Déconnecter</span>'
    : '<span class="icon">🔌</span><span class="btn-text">Connecter</span>';
  updatePrintButtons();
}

function updatePrintButtons() {
  const hasPdf = !!state.pdfDoc;
  el.btnPrint.disabled = !hasPdf || !state.connected;
  el.btnPrintAll.disabled = !hasPdf || !state.connected;
}

// ========== Bluetooth ==========
async function connectPrinter() {
  if (state.connected) {
    await disconnectPrinter();
    return;
  }

  if (!navigator.bluetooth) {
    log('Web Bluetooth non supporté sur ce navigateur. Utilisez Chrome sur Android.', 'error');
    alert('Web Bluetooth n’est pas supporté.\nOuvrez cette page dans Chrome sur Android.');
    return;
  }

  try {
    log('Recherche de l’imprimante…');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICE_UUIDS,
    });

    log(`Appareil sélectionné : ${device.name || 'Inconnu'}`);
    device.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await device.gatt.connect();
    log('GATT connecté, recherche du service…');

    let characteristic = null;

    // Try known services first
    for (const uuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(uuid);
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            characteristic = c;
            log(`Caractéristique trouvée (${uuid})`);
            break;
          }
        }
        if (characteristic) break;
      } catch (e) {
        // service not present
      }
    }

    // Fallback: explore all services
    if (!characteristic) {
      log('Recherche élargie des services…');
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            characteristic = c;
            log(`Caractéristique générique trouvée`);
            break;
          }
        }
        if (characteristic) break;
      }
    }

    if (!characteristic) {
      throw new Error('Aucune caractéristique d’écriture trouvée. L’imprimante n’est peut-être pas compatible Web Bluetooth (BLE).');
    }

    state.device = device;
    state.server = server;
    state.characteristic = characteristic;
    setConnected(true);
    log('Imprimante prête !', 'success');
  } catch (err) {
    log(`Erreur connexion : ${err.message}`, 'error');
    console.error(err);
  }
}

async function disconnectPrinter() {
  try {
    if (state.device?.gatt?.connected) {
      state.device.gatt.disconnect();
    }
  } catch (e) {}
  state.device = null;
  state.server = null;
  state.characteristic = null;
  setConnected(false);
  log('Déconnecté');
}

function onDisconnected() {
  log('Imprimante déconnectée', 'error');
  state.characteristic = null;
  state.server = null;
  setConnected(false);
}

async function sendBytes(data) {
  if (!state.characteristic) throw new Error('Pas de connexion');

  const chunkSize = 512; // safe for most BLE
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (state.characteristic.properties.writeWithoutResponse) {
      await state.characteristic.writeValueWithoutResponse(chunk);
    } else {
      await state.characteristic.writeValue(chunk);
    }
    // small delay to avoid overwhelming the printer
    await new Promise(r => setTimeout(r, 20));
  }
}

// ========== ESC/POS helpers ==========
function escposInit() {
  return new Uint8Array([0x1B, 0x40]); // ESC @
}

function escposFeed(lines = 3) {
  return new Uint8Array([0x1B, 0x64, lines]); // ESC d n
}

function escposCut() {
  // Partial cut if supported, otherwise just feed
  return new Uint8Array([0x1D, 0x56, 0x00]); // GS V 0
}

/**
 * Convert canvas to ESC/POS raster (GS v 0)
 * width must be multiple of 8
 */
function canvasToEscPosRaster(canvas, density = 2) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // bytes per line
  const widthBytes = Math.ceil(width / 8);
  const raster = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // threshold (adjustable with density)
      const threshold = density === 1 ? 180 : density === 3 ? 100 : 140;
      if (lum < threshold) {
        const byteIndex = y * widthBytes + (x >> 3);
        raster[byteIndex] |= (0x80 >> (x & 7));
      }
    }
  }

  // GS v 0 m xL xH yL yH d1...dk
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00, // GS v 0
    xL, xH, yL, yH
  ]);

  const result = new Uint8Array(header.length + raster.length);
  result.set(header, 0);
  result.set(raster, header.length);
  return result;
}

// ========== PDF handling ==========
async function loadPdfFromArrayBuffer(buffer, name = 'document.pdf') {
  try {
    log(`Chargement de ${name}…`);
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    state.pdfDoc = await loadingTask.promise;
    state.totalPages = state.pdfDoc.numPages;
    state.currentPage = 1;
    state.selectedFile = { name };
    el.previewSection.style.display = 'block';
    await renderPage(1);
    updatePrintButtons();
    log(`PDF chargé : ${state.totalPages} page(s)`, 'success');
  } catch (err) {
    log(`Erreur PDF : ${err.message}`, 'error');
    console.error(err);
  }
}

async function renderPage(pageNum) {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(pageNum);
  const paperMm = parseInt(el.paperWidth.value, 10);
  // 203 DPI → dots per mm ≈ 8
  const targetWidthPx = Math.floor(paperMm * 8); // ~1728 for 216 mm

  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidthPx / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  const canvas = el.previewCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = Math.floor(scaledViewport.width);
  canvas.height = Math.floor(scaledViewport.height);

  // white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport,
  }).promise;

  state.currentPage = pageNum;
  el.pageInfo.textContent = `Page ${pageNum} / ${state.totalPages}`;
  el.btnPrev.disabled = pageNum <= 1;
  el.btnNext.disabled = pageNum >= state.totalPages;
}

async function printCurrentPage() {
  if (!state.pdfDoc || !state.connected) return;

  try {
    el.btnPrint.disabled = true;
    log(`Impression page ${state.currentPage}…`);

    const density = parseInt(el.density.value, 10);
    const raster = canvasToEscPosRaster(el.previewCanvas, density);

    await sendBytes(escposInit());
    await sendBytes(raster);
    await sendBytes(escposFeed(4));

    log(`Page ${state.currentPage} envoyée`, 'success');
  } catch (err) {
    log(`Erreur impression : ${err.message}`, 'error');
    console.error(err);
  } finally {
    updatePrintButtons();
  }
}

async function printAllPages() {
  if (!state.pdfDoc || !state.connected) return;

  try {
    el.btnPrintAll.disabled = true;
    el.btnPrint.disabled = true;
    log(`Impression de tout le document (${state.totalPages} pages)…`);

    for (let i = 1; i <= state.totalPages; i++) {
      await renderPage(i);
      // small pause so UI updates
      await new Promise(r => setTimeout(r, 100));
      const density = parseInt(el.density.value, 10);
      const raster = canvasToEscPosRaster(el.previewCanvas, density);
      await sendBytes(escposInit());
      await sendBytes(raster);
      await sendBytes(escposFeed(5));
      log(`Page ${i}/${state.totalPages} envoyée`);
    }
    log('Document entièrement imprimé', 'success');
  } catch (err) {
    log(`Erreur : ${err.message}`, 'error');
  } finally {
    updatePrintButtons();
  }
}

// ========== Hosted documents ==========
async function loadDocumentsTree() {
  try {
    const res = await fetch('./documents/documents.json?t=' + Date.now());
    if (!res.ok) throw new Error('Impossible de charger documents.json');
    state.documentsTree = await res.json();
    renderFolderView();
  } catch (err) {
    el.folderList.innerHTML = `<p class="empty">Impossible de charger la liste des documents.<br><small>${err.message}</small></p>`;
    log(`Documents hébergés : ${err.message}`, 'error');
  }
}

function getNodeByPath(pathArray) {
  let node = state.documentsTree;
  for (const segment of pathArray) {
    if (!node?.children) return null;
    node = node.children.find(c => c.path === segment || c.name === segment);
    if (!node) return null;
  }
  return node;
}

function renderFolderView() {
  const node = getNodeByPath(state.currentFolderPath) || state.documentsTree;
  const children = node?.children || [];

  // Breadcrumb
  el.breadcrumb.innerHTML = '';
  const rootBtn = document.createElement('button');
  rootBtn.className = 'crumb';
  rootBtn.textContent = 'Documents';
  rootBtn.dataset.path = '';
  rootBtn.addEventListener('click', () => {
    state.currentFolderPath = [];
    renderFolderView();
  });
  el.breadcrumb.appendChild(rootBtn);

  let cumulative = [];
  state.currentFolderPath.forEach((seg, idx) => {
    cumulative.push(seg);
    const btn = document.createElement('button');
    btn.className = 'crumb';
    btn.textContent = seg;
    const pathCopy = [...cumulative];
    btn.addEventListener('click', () => {
      state.currentFolderPath = pathCopy;
      renderFolderView();
    });
    el.breadcrumb.appendChild(btn);
  });

  // List
  if (children.length === 0) {
    el.folderList.innerHTML = '<p class="empty">Dossier vide</p>';
    return;
  }

  el.folderList.innerHTML = '';
  children.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'folder-item';
    if (item.type === 'folder') {
      btn.innerHTML = `<span class="icon">📁</span><span>${item.name}</span>`;
      btn.addEventListener('click', () => {
        state.currentFolderPath.push(item.path || item.name);
        renderFolderView();
      });
    } else {
      btn.innerHTML = `<span class="icon">📄</span><span>${item.name}</span><span class="meta">${item.size || ''}</span>`;
      btn.addEventListener('click', () => openHostedPdf(item));
    }
    el.folderList.appendChild(btn);
  });
}

async function openHostedPdf(item) {
  try {
    log(`Téléchargement de ${item.name}…`);
    const url = `./documents/${item.path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    await loadPdfFromArrayBuffer(buffer, item.name);
  } catch (err) {
    log(`Impossible d’ouvrir le fichier : ${err.message}`, 'error');
  }
}

// ========== Events ==========
el.btnConnect.addEventListener('click', connectPrinter);

el.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  el.localFilename.textContent = file.name;
  const buffer = await file.arrayBuffer();
  await loadPdfFromArrayBuffer(buffer, file.name);
});

// Drag & drop
const dropZone = document.querySelector('.file-drop');
['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });
});
dropZone.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file && file.type === 'application/pdf') {
    el.localFilename.textContent = file.name;
    const buffer = await file.arrayBuffer();
    await loadPdfFromArrayBuffer(buffer, file.name);
  }
});

// Tabs
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const source = tab.dataset.source;
    state.currentSource = source;
    $$('.panel').forEach(p => p.classList.remove('active'));
    $(`#panel-${source}`).classList.add('active');
    if (source === 'hosted' && !state.documentsTree) {
      loadDocumentsTree();
    }
  });
});

el.btnPrev.addEventListener('click', () => {
  if (state.currentPage > 1) renderPage(state.currentPage - 1);
});
el.btnNext.addEventListener('click', () => {
  if (state.currentPage < state.totalPages) renderPage(state.currentPage + 1);
});

el.btnPrint.addEventListener('click', printCurrentPage);
el.btnPrintAll.addEventListener('click', printAllPages);

el.paperWidth.addEventListener('change', () => {
  if (state.pdfDoc) renderPage(state.currentPage);
});

// ========== Service Worker registration ==========
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => log('Mode hors-ligne activé', 'success'))
      .catch(err => log('SW non enregistré : ' + err.message));
  });
}

// Init
log('Application prête. Connectez votre P83 puis choisissez un PDF.');
