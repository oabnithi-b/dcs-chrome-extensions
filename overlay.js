// =============================================================================
// overlay.js — injects a Floating Action Button + iframe panel into the page
// Runs as a content script on /main/case/detail/* pages.
// =============================================================================
(function () {
  'use strict';

  const PANEL_W    = 432;   // slightly wider than popup body (420px) + scrollbar room
  const PANEL_H    = 610;
  const PANEL_H_MIN = 300;
  const PANEL_H_MAX = Math.round(window.innerHeight * 0.92);
  const STORE_KEY  = 'dc_overlay_open';
  const STORE_H    = 'dc_overlay_height';

  const SVG_CHAT  = `<span style="font-size:11px;font-weight:700;color:white;font-family:'Segoe UI',sans-serif;letter-spacing:0.3px;line-height:1;text-align:center;pointer-events:none;">D<br>tool</span>`;
  const SVG_CLOSE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

  // Don't inject twice (e.g. if script re-runs)
  if (document.getElementById('dc-overlay-root')) return;

  // ── Keyframes & resize-handle style ───────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes dc-pulse {
      0%,100% { transform: scale(1);   opacity: 0.55; }
      50%      { transform: scale(1.5); opacity: 0;    }
    }
    #dc-overlay-fab:hover { transform: scale(1.08); }
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
  `;
  document.head.appendChild(style);

  // ── Root wrapper (positions everything) ───────────────────────────────────
  const root = document.createElement('div');
  root.id = 'dc-overlay-root';
  Object.assign(root.style, {
    position:      'fixed',
    bottom:        '24px',
    right:         '24px',
    zIndex:        '2147483647',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'flex-end',
    gap:           '10px',
  });

  // ── Panel (resize handle + iframe wrapper) ────────────────────────────────
  const savedH = parseInt(localStorage.getItem(STORE_H) || PANEL_H, 10);
  const initH  = Math.max(PANEL_H_MIN, Math.min(PANEL_H_MAX, savedH));

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width:         PANEL_W + 'px',
    height:        initH + 'px',
    borderRadius:  '12px',
    overflow:      'hidden',
    boxShadow:     '0 12px 40px rgba(0,0,0,0.22), 0 3px 10px rgba(0,0,0,0.12)',
    border:        '1px solid rgba(0,0,0,0.10)',
    background:    '#1a237e',   // shows as top strip behind resize handle
    display:       'none',
    flexDirection: 'column',
  });
  panel.style.display = 'none'; // keep hidden until opened

  // Resize handle (top edge — drag upward to grow, downward to shrink)
  const resizeHandle = document.createElement('div');
  resizeHandle.id = 'dc-resize-handle';
  panel.appendChild(resizeHandle);

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  Object.assign(iframe.style, {
    width:   '100%',
    flex:    '1',
    border:  'none',
    display: 'block',
    minHeight: '0',
  });
  panel.appendChild(iframe);

  // ── Resize logic ────────────────────────────────────────────────────────────
  let resizing = false, rStartY = 0, rStartH = 0;

  resizeHandle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    resizing = true;
    rStartY  = e.clientY;
    rStartH  = panel.getBoundingClientRect().height;
    startCapture('ns-resize');
    e.preventDefault();
    e.stopPropagation(); // don't trigger FAB drag
  });

  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    // dragging UP (dy < 0) increases height; DOWN (dy > 0) decreases height
    const dy   = e.clientY - rStartY;
    const newH = Math.max(PANEL_H_MIN, Math.min(PANEL_H_MAX, rStartH - dy));
    panel.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    stopCapture();
    localStorage.setItem(STORE_H, parseInt(panel.style.height, 10));
  });

  // ── FAB button ─────────────────────────────────────────────────────────────
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
    transition:     'background 0.15s, transform 0.15s',
    padding:        '0',
    outline:        'none',
    flexShrink:     '0',
    position:       'relative',
  });
  fab.innerHTML = SVG_CHAT;

  // Pulse ring (only visible when panel is closed)
  const pulse = document.createElement('span');
  Object.assign(pulse.style, {
    position:     'absolute',
    inset:        '-6px',
    borderRadius: '50%',
    border:       '2px solid rgba(26,35,126,0.45)',
    animation:    'dc-pulse 2.2s ease-out infinite',
    pointerEvents:'none',
  });
  fab.appendChild(pulse);

  // ── Toggle logic ───────────────────────────────────────────────────────────
  let isOpen = false;

  function setOpen(open) {
    isOpen = open;
    panel.style.display    = open ? 'flex' : 'none';
    fab.style.background   = open ? '#c62828' : '#1a237e';
    fab.style.boxShadow    = open
      ? '0 3px 14px rgba(198,40,40,0.45)'
      : '0 3px 14px rgba(26,35,126,0.45)';
    // Keep only the icon inside fab, preserve pulse ring
    const pulseCopy = fab.querySelector('span');
    fab.innerHTML = open ? SVG_CLOSE : SVG_CHAT;
    if (!open && pulseCopy) fab.appendChild(pulseCopy);
    pulse.style.display = open ? 'none' : 'block';
    localStorage.setItem(STORE_KEY, open ? '1' : '0');
  }

  // ── Transparent mouse-capture layer ──────────────────────────────────────
  // Prevents the iframe from stealing mousemove/mouseup during drag/resize.
  const capture = document.createElement('div');
  Object.assign(capture.style, {
    position:   'fixed',
    inset:      '0',
    zIndex:     '2147483646',
    display:    'none',
    userSelect: 'none',
  });
  document.body.appendChild(capture);

  function startCapture(cursor) {
    capture.style.cursor  = cursor;
    capture.style.display = 'block';
  }
  function stopCapture() { capture.style.display = 'none'; }

  // ── Drag-to-reposition (dragging FAB moves entire overlay) ────────────────
  let tracking = false;
  let dragMoved = false;
  let dStartX = 0, dStartY = 0, dOrigRight = 24, dOrigBottom = 24;

  fab.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    tracking  = true;
    dragMoved = false;
    dStartX   = e.clientX;
    dStartY   = e.clientY;
    const rect   = root.getBoundingClientRect();
    dOrigRight   = window.innerWidth  - rect.right;
    dOrigBottom  = window.innerHeight - rect.bottom;
    startCapture('grabbing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!tracking) return;
    const dx = e.clientX - dStartX;
    const dy = e.clientY - dStartY;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) dragMoved = true;
    if (dragMoved) {
      // right: drag LEFT (+dx) → right increases; drag RIGHT (-dx) → right decreases
      // bottom: drag UP (-dy)   → bottom increases; drag DOWN (+dy) → bottom decreases
      root.style.right  = Math.max(8, dOrigRight  - dx) + 'px';
      root.style.bottom = Math.max(8, dOrigBottom - dy) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!tracking) return;
    tracking = false;
    stopCapture();
    if (!dragMoved) setOpen(!isOpen); // short tap = toggle
  });

  // ── Assemble & restore state ───────────────────────────────────────────────
  root.appendChild(panel);
  root.appendChild(fab);
  document.body.appendChild(root);

  const saved = localStorage.getItem(STORE_KEY);
  if (saved === '1') setOpen(true);

})();
