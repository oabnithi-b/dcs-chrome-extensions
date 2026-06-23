// =============================================================================
// overlay.js — injects a Floating Action Button + iframe panel into the page
// Runs as a content script on /main/case/detail/* pages.
// FAB is anchored top-right; panel extends downward below the FAB.
// =============================================================================
(function () {
  'use strict';

  const PANEL_W_DEF = 432;   // default width (slightly wider than popup body 420px + scrollbar)
  const PANEL_W_MIN = 320;
  const PANEL_W_MAX = Math.round(window.innerWidth * 0.85);
  const PANEL_H     = 620;
  const PANEL_H_MIN = 300;
  const PANEL_H_MAX = Math.round(window.innerHeight * 0.92);
  const STORE_KEY   = 'dc_overlay_open';
  const STORE_H     = 'dc_overlay_height';
  const STORE_W     = 'dc_overlay_width';

  const ICON_OPEN  = `<span style="font-size:11px;font-weight:700;color:white;font-family:'Segoe UI',sans-serif;letter-spacing:0.3px;line-height:1.2;text-align:center;pointer-events:none;">D<br>tool</span>`;
  const ICON_CLOSE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

  if (document.getElementById('dc-overlay-root')) return;

  // ── CSS ────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes dc-pulse {
      0%,100% { opacity: 0.5; }
      50%      { opacity: 0;   }
    }
    #dc-overlay-fab:hover { box-shadow: 0 5px 20px rgba(26,35,126,0.65); }
    #dc-resize-handle {
      width: 100%; height: 8px; cursor: ns-resize;
      background: transparent; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    #dc-resize-handle::after {
      content: ''; display: block;
      width: 32px; height: 3px; border-radius: 2px;
      background: rgba(255,255,255,0.45);
    }
    #dc-resize-handle:hover::after { background: rgba(255,255,255,0.75); }
    #dc-resize-left {
      position: absolute; left: 0; top: 0; bottom: 12px;
      width: 6px; cursor: ew-resize; z-index: 1;
      background: transparent;
    }
    #dc-resize-left:hover { background: rgba(255,255,255,0.12); }
    #dc-resize-corner {
      position: absolute; left: 0; bottom: 0;
      width: 14px; height: 14px; cursor: sw-resize; z-index: 2;
      background: transparent;
    }
    #dc-resize-corner:hover { background: rgba(255,255,255,0.18); border-radius: 0 0 0 12px; }
    #dc-panel-titlebar {
      display: flex; align-items: center; justify-content: flex-end;
      background: #1a237e;
      padding: 3px 6px 3px 10px;
      cursor: grab; flex-shrink: 0; user-select: none;
    }
    #dc-panel-titlebar:active { cursor: grabbing; }
    #dc-panel-close {
      background: transparent; border: none; cursor: pointer;
      color: rgba(255,255,255,0.65); font-size: 18px; line-height: 1;
      padding: 0 2px; border-radius: 4px;
      transition: color 0.12s, background 0.12s;
    }
    #dc-panel-close:hover { color: #fff; background: rgba(255,255,255,0.18); }
  `;
  document.head.appendChild(style);

  // ── Root wrapper — anchored TOP-RIGHT ──────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'dc-overlay-root';
  Object.assign(root.style, {
    position:      'fixed',
    top:           '24px',
    right:         '24px',
    zIndex:        '2147483647',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'flex-end',
    gap:           '10px',
    willChange:    'transform',
    transform:     'translateZ(0)',
  });

  // ── FAB button (first child → sits at top) ─────────────────────────────────
  const fab = document.createElement('button');
  fab.id    = 'dc-overlay-fab';
  fab.title = 'DC Collection Tool';
  Object.assign(fab.style, {
    width:          '50px',
    height:         '50px',
    borderRadius:   '50%',
    background:     '#1a237e',
    border:         'none',
    cursor:         'pointer',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    boxShadow:      '0 3px 14px rgba(26,35,126,0.45)',
    transition:     'background 0.15s, box-shadow 0.15s',
    padding:        '0',
    outline:        'none',
    flexShrink:     '0',
    position:       'relative',
  });
  fab.innerHTML = ICON_OPEN;

  // Pulse ring (visible only when panel is closed)
  const pulse = document.createElement('span');
  Object.assign(pulse.style, {
    position:      'absolute',
    inset:         '-6px',
    borderRadius:  '50%',
    border:        '2px solid rgba(26,35,126,0.45)',
    animation:     'dc-pulse 2.2s ease-out infinite',
    pointerEvents: 'none',
  });
  fab.appendChild(pulse);

  // ── Panel (second child → extends downward below FAB) ─────────────────────
  const savedH = parseInt(localStorage.getItem(STORE_H) || PANEL_H, 10);
  const initH  = Math.max(PANEL_H_MIN, Math.min(PANEL_H_MAX, savedH));
  const savedW = parseInt(localStorage.getItem(STORE_W) || PANEL_W_DEF, 10);
  const initW  = Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, savedW));

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width:         initW + 'px',
    height:        initH + 'px',
    position:      'relative',
    borderRadius:  '12px',
    overflow:      'hidden',
    boxShadow:     '0 12px 40px rgba(0,0,0,0.22), 0 3px 10px rgba(0,0,0,0.12)',
    border:        '1px solid rgba(0,0,0,0.10)',
    background:    '#1a237e',
    display:       'none',
    flexDirection: 'column',
  });

  // Thin titlebar at the top of the panel — drag to move, X to close
  const titlebar = document.createElement('div');
  titlebar.id = 'dc-panel-titlebar';
  const closeBtn = document.createElement('button');
  closeBtn.id        = 'dc-panel-close';
  closeBtn.innerHTML = '✕';
  closeBtn.title     = 'ปิด D Tool';
  closeBtn.addEventListener('click', e => { e.stopPropagation(); setOpen(false); });
  titlebar.appendChild(closeBtn);
  panel.appendChild(titlebar);

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  Object.assign(iframe.style, {
    width:     '100%',
    flex:      '1',
    border:    'none',
    display:   'block',
    minHeight: '0',
  });
  panel.appendChild(iframe);

  // Resize handle — bottom edge (drag DOWN = taller, UP = shorter)
  const resizeHandle = document.createElement('div');
  resizeHandle.id = 'dc-resize-handle';
  panel.appendChild(resizeHandle);

  // Left-edge resize handle (drag LEFT = wider, drag RIGHT = narrower)
  const resizeLeft = document.createElement('div');
  resizeLeft.id = 'dc-resize-left';
  panel.appendChild(resizeLeft);

  // Bottom-left corner resize handle (drag: both width + height simultaneously)
  const resizeCorner = document.createElement('div');
  resizeCorner.id = 'dc-resize-corner';
  panel.appendChild(resizeCorner);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  let isOpen = false;

  const POPUP_URL = chrome.runtime.getURL('popup.html');

  function setOpen(open) {
    isOpen = open;
    panel.style.display = open ? 'flex' : 'none';
    // Hide FAB while panel is open; show it only when panel is closed
    fab.style.display   = open ? 'none' : 'flex';
    localStorage.setItem(STORE_KEY, open ? '1' : '0');

    // Reload iframe every time the panel is opened so data is always fresh.
    if (open) {
      iframe.src = POPUP_URL;
    }
  }

  // ── Mouse-capture overlay (prevents iframe stealing drag events) ───────────
  const capture = document.createElement('div');
  Object.assign(capture.style, {
    position:   'fixed',
    inset:      '0',
    zIndex:     '2147483646',
    display:    'none',
    userSelect: 'none',
  });
  document.body.appendChild(capture);

  function startCapture(cur) { capture.style.cursor = cur; capture.style.display = 'block'; }
  function stopCapture()     { capture.style.display = 'none'; }

  // ── Drag-to-reposition (FAB when panel closed; titlebar when panel open) ──
  let tracking = false, dragMoved = false;
  let dStartX = 0, dStartY = 0, dOrigRight = 24, dOrigTop = 24;

  function beginDrag(e) {
    if (e.button !== 0) return;
    tracking  = true;
    dragMoved = false;
    dStartX   = e.clientX;
    dStartY   = e.clientY;
    const rect = root.getBoundingClientRect();
    dOrigRight = window.innerWidth - rect.right;
    dOrigTop   = rect.top;
    startCapture('grabbing');
    e.preventDefault();
  }

  fab.addEventListener('mousedown', beginDrag);
  titlebar.addEventListener('mousedown', e => {
    // Don't drag when clicking the close button
    if (e.target === closeBtn) return;
    beginDrag(e);
  });

  document.addEventListener('mousemove', e => {
    if (!tracking) return;
    const dx = e.clientX - dStartX;
    const dy = e.clientY - dStartY;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) dragMoved = true;
    if (dragMoved) {
      root.style.right = Math.max(8, dOrigRight - dx) + 'px';
      root.style.top   = Math.max(8, dOrigTop   + dy) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!tracking) return;
    tracking = false;
    stopCapture();
    // FAB click (no drag) → open panel
    if (!dragMoved && !isOpen) setOpen(true);
  });

  // ── Resize state: 'none' | 'height' | 'width' | 'both' ───────────────────
  let resizeMode = 'none';
  let rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0;

  function beginResize(mode, e) {
    resizeMode = mode;
    rStartX    = e.clientX;
    rStartY    = e.clientY;
    const rect = panel.getBoundingClientRect();
    rStartW    = rect.width;
    rStartH    = rect.height;
    const cur  = mode === 'height' ? 'ns-resize'
               : mode === 'width'  ? 'ew-resize'
               :                    'sw-resize';
    startCapture(cur);
    e.preventDefault();
    e.stopPropagation();
  }

  // Bottom edge — height only
  resizeHandle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    beginResize('height', e);
  });

  // Left edge — width only
  resizeLeft.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    beginResize('width', e);
  });

  // Bottom-left corner — both
  resizeCorner.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    beginResize('both', e);
  });

  document.addEventListener('mousemove', e => {
    if (resizeMode === 'none') return;
    const dx = e.clientX - rStartX;
    const dy = e.clientY - rStartY;

    if (resizeMode === 'height' || resizeMode === 'both') {
      // drag DOWN (dy>0) = taller, drag UP (dy<0) = shorter
      const newH = Math.max(PANEL_H_MIN, Math.min(PANEL_H_MAX, rStartH + dy));
      panel.style.height = newH + 'px';
    }

    if (resizeMode === 'width' || resizeMode === 'both') {
      // drag LEFT (dx<0) = wider, drag RIGHT (dx>0) = narrower
      // Panel is right-aligned so expanding leftward keeps right edge fixed
      const newW = Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, rStartW - dx));
      panel.style.width = newW + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (resizeMode === 'none') return;
    resizeMode = 'none';
    stopCapture();
    localStorage.setItem(STORE_H, parseInt(panel.style.height, 10));
    localStorage.setItem(STORE_W, parseInt(panel.style.width,  10));
  });

  // ── Assemble & restore ─────────────────────────────────────────────────────
  root.appendChild(fab);    // FAB on top
  root.appendChild(panel);  // panel extends downward
  document.body.appendChild(root);

  if (localStorage.getItem(STORE_KEY) === '1') setOpen(true);

  // ── Listen for messages from toolbar popup ───────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'OPEN_OVERLAY') {
      setOpen(true);
      sendResponse({ ok: true });
    } else if (msg.type === 'CLOSE_OVERLAY') {
      setOpen(false);
      sendResponse({ ok: true });
    }
  });

})();
