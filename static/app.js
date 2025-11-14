let currentSite = null;
let currentSiteEnabled = false;
let currentUser = null;
let logsIntervalId = null;
let currentVersionContent = '';
let currentSection = 'sites';

async function api(path, options) {
  const res = await fetch(path, options || {});
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    // not JSON
  }
  return { res, text, json };
}

function setStatus(msg) {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = msg;
}

function setBackupStatus(msg) {
  const el = document.getElementById('backup-status');
  if (el) el.textContent = msg;
}

function setLogsOutput(text) {
  const el = document.getElementById('logs-output');
  if (el) {
    el.value = text;
    el.scrollTop = el.scrollHeight;
  }
}

function navigateTo(section) {
  currentSection = section;

  // sections
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(sec => {
    if (sec.id === `section-${section}`) {
      sec.classList.add('content-section-active');
    } else {
      sec.classList.remove('content-section-active');
    }
  });

  // nav items
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(btn => {
    const sec = btn.getAttribute('data-section');
    if (sec === section) {
      btn.classList.add('nav-item-active');
    } else {
      btn.classList.remove('nav-item-active');
    }
  });

  // section-specific init
  if (section === 'logs') {
    loadLogs();
  } else if (section === 'backups') {
    loadBackups();
  } else if (section === 'templates') {
    loadTemplatesList();
  }
}

// ===== Sites =====

async function loadSites() {
  const { res, json } = await api('/api/sites');
  const listEl = document.getElementById('sites-list');
  if (!listEl) return;
  if (!res.ok || !json) {
    listEl.textContent = 'Error loading sites.';
    return;
  }
  listEl.innerHTML = '';
  json.forEach(s => {
    const div = document.createElement('div');
    div.className = 'site-item' + (s.enabled ? '' : ' site-item-disabled');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = s.name;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = s.enabled ? 'enabled' : 'disabled';

    div.appendChild(nameSpan);
    div.appendChild(badge);

    div.addEventListener('click', () => loadSite(s.name));

    listEl.appendChild(div);
  });

  if (!currentSite && json.length > 0) {
    loadSite(json[0].name);
  }
}

async function loadSite(name) {
  const { res, text } = await api('/api/sites/' + encodeURIComponent(name));
  if (!res.ok) {
    setStatus('Error loading file: ' + text);
    return;
  }
  currentSite = name;
  const metaRes = await api('/api/sites/' + encodeURIComponent(name) + '/meta');
  if (metaRes.res.ok && metaRes.json) {
    currentSiteEnabled = !!metaRes.json.enabled;
  } else {
    currentSiteEnabled = false;
  }
  const filenameEl = document.getElementById('filename');
  const textarea = document.getElementById('content-textarea');
  if (filenameEl) {
    filenameEl.textContent = name + (currentSiteEnabled ? ' (enabled)' : ' (disabled)');
  }
  if (textarea) {
    textarea.value = text;
  }
  setStatus('Loaded ' + name);
}

async function saveSite() {
  if (!currentSite) {
    setStatus('No site selected.');
    return;
  }
  const textarea = document.getElementById('content-textarea');
  if (!textarea) return;
  const content = textarea.value;
  const { res, text } = await api('/api/sites/' + encodeURIComponent(currentSite), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content
  });
  setStatus(text);
}

async function testConfig() {
  const { res, text } = await api('/api/nginx/test', { method: 'POST' });
  setStatus(text);
}

async function reloadNginx() {
  const { res, text } = await api('/api/nginx/reload', { method: 'POST' });
  setStatus(text);
}

async function toggleEnable() {
  if (!currentSite) {
    setStatus('No site selected.');
    return;
  }
  const action = currentSiteEnabled ? 'disable' : 'enable';
  const { res, text } = await api('/api/sites/' + encodeURIComponent(currentSite) + '/' + action, {
    method: 'POST'
  });
  setStatus(text);
  await loadSites();
  await loadSite(currentSite);
}

async function createSite() {
  const input = document.getElementById('new-site-name');
  const templateSelect = document.getElementById('new-site-template');
  if (!input || !templateSelect) return;
  const name = input.value.trim();
  const templateId = templateSelect.value || null;
  if (!name) {
    setStatus('Enter a valid site name.');
    return;
  }
  const body = templateId ? { name, templateId } : { name };
  const { res, text } = await api('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  setStatus(text);
  if (res.ok) {
    input.value = '';
    await loadSites();
  }
}

// ===== Versions =====

async function openVersionsModal() {
  if (!currentSite) {
    setStatus('No site selected.');
    return;
  }
  const modal = document.getElementById('versions-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const { res, json, text } = await api('/api/sites/' + encodeURIComponent(currentSite) + '/versions');
  const listEl = document.getElementById('versions-list');
  const previewEl = document.getElementById('versions-preview');
  if (listEl) listEl.innerHTML = '';
  if (previewEl) previewEl.value = '';

  if (!res.ok || !json) {
    if (listEl) {
      listEl.innerHTML = '<li>Error loading versions: ' + text + '</li>';
    }
    return;
  }

  if (json.length === 0) {
    if (listEl) {
      listEl.innerHTML = '<li>No versions yet.</li>';
    }
    return;
  }

  json.forEach(v => {
    const li = document.createElement('li');
    li.textContent = `${v.id} — ${v.user || 'unknown'} — ${v.ip || ''}`;
    li.addEventListener('click', () => loadVersionContent(v.id));
    listEl.appendChild(li);
  });
}

async function loadVersionContent(versionId) {
  if (!currentSite) return;
  const { res, text } = await api('/api/sites/' + encodeURIComponent(currentSite) + '/versions/' + encodeURIComponent(versionId));
  if (!res.ok) {
    setStatus('Error loading version: ' + text);
    return;
  }
  currentVersionContent = text;
  const previewEl = document.getElementById('versions-preview');
  if (previewEl) previewEl.value = text;
}

function loadVersionIntoEditor() {
  if (!currentVersionContent || !currentSite) return;
  const textarea = document.getElementById('content-textarea');
  if (!textarea) return;
  textarea.value = currentVersionContent;
  setStatus('Version loaded into editor. Don\'t forget to Save.');
}

// ===== Logs =====

async function loadLogs() {
  const typeEl = document.getElementById('logs-type');
  const linesEl = document.getElementById('logs-lines');
  if (!typeEl || !linesEl) return;

  const type = typeEl.value === 'error' ? 'error' : 'access';
  const lines = parseInt(linesEl.value || '200', 10) || 200;

  const { res, text } = await api(`/api/logs?type=${encodeURIComponent(type)}&lines=${lines}`);
  if (!res.ok) {
    setLogsOutput('Error loading logs:\n' + text);
    return;
  }
  setLogsOutput(text);
}

function handleLogsAutoRefreshChange() {
  const checkbox = document.getElementById('logs-autorefresh');
  if (!checkbox) return;
  if (logsIntervalId) {
    clearInterval(logsIntervalId);
    logsIntervalId = null;
  }
  if (checkbox.checked) {
    logsIntervalId = setInterval(loadLogs, 5000);
  }
}

// ===== Backups =====

async function createBackup() {
  setBackupStatus('Creating backup...');
  const { res, json, text } = await api('/api/backup', { method: 'POST' });
  if (!res.ok) {
    setBackupStatus('Backup failed:\n' + text);
    return;
  }
  setBackupStatus('Backup created: ' + (json?.file || ''));
  await loadBackups();
}

async function loadBackups() {
  const { res, json, text } = await api('/api/backup');
  const listEl = document.getElementById('backup-list');
  if (!listEl) return;
  if (!res.ok || !json) {
    listEl.innerHTML = '<li>Error loading backups: ' + text + '</li>';
    return;
  }
  listEl.innerHTML = '';
  if (json.length === 0) {
    listEl.innerHTML = '<li>No backups yet.</li>';
    return;
  }
  json.forEach(name => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '/api/backup/' + encodeURIComponent(name);
    a.textContent = name;
    a.target = '_blank';
    li.appendChild(a);
    listEl.appendChild(li);
  });
}

// ===== Templates =====

let loadedTemplates = [];

async function loadTemplatesList() {
  const { res, json, text } = await api('/api/templates');
  const listEl = document.getElementById('templates-list');
  const selectEl = document.getElementById('new-site-template');
  if (!listEl || !selectEl) return;

  if (!res.ok || !json) {
    listEl.textContent = 'Error loading templates: ' + text;
    return;
  }

  loadedTemplates = json;

  // fill sidebar select
  selectEl.innerHTML = '<option value="">(empty)</option>';
  json.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    selectEl.appendChild(opt);
  });

  // cards
  listEl.innerHTML = '';
  json.forEach(t => {
    const card = document.createElement('div');
    card.className = 'template-card';

    const title = document.createElement('div');
    title.className = 'template-card-title';
    title.textContent = t.name;

    const desc = document.createElement('div');
    desc.className = 'template-card-desc';
    desc.textContent = t.description || '';

    card.appendChild(title);
    card.appendChild(desc);

    listEl.appendChild(card);
  });
}

// ===== User / Roles =====

async function loadCurrentUser() {
  const { res, json, text } = await api('/api/me');
  if (!res.ok || !json) {
    console.warn('Failed to load /api/me', text);
    return;
  }
  currentUser = json;
  const userEl = document.getElementById('current-user');
  if (userEl) {
    userEl.textContent = `${json.username} (${json.role})`;
  }

  // role-based UI: hide admin-only stuff
  if (json.role !== 'admin') {
    const adminEls = document.querySelectorAll('.admin-only');
    adminEls.forEach(el => {
      el.classList.add('hidden');
    });
  }
}

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', () => {
  // nav
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.getAttribute('data-section');
      if (sec) navigateTo(sec);
    });
  });

  // sites actions
  const btnSave = document.getElementById('btn-save');
  const btnTest = document.getElementById('btn-test');
  const btnReload = document.getElementById('btn-reload');
  const btnToggle = document.getElementById('btn-toggle');
  const btnCreate = document.getElementById('btn-create');
  const btnVersions = document.getElementById('btn-versions');

  if (btnSave) btnSave.addEventListener('click', saveSite);
  if (btnTest) btnTest.addEventListener('click', testConfig);
  if (btnReload) btnReload.addEventListener('click', reloadNginx);
  if (btnToggle) btnToggle.addEventListener('click', toggleEnable);
  if (btnCreate) btnCreate.addEventListener('click', createSite);
  if (btnVersions) btnVersions.addEventListener('click', openVersionsModal);

  // modal versions
  const modal = document.getElementById('versions-modal');
  const closeBtn = document.getElementById('versions-close');
  const backdrop = modal ? modal.querySelector('.modal-backdrop') : null;
  const btnLoadVersion = document.getElementById('versions-load-into-editor');

  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (backdrop) backdrop.addEventListener('click', () => modal.classList.add('hidden'));
  if (btnLoadVersion) btnLoadVersion.addEventListener('click', loadVersionIntoEditor);

  // logs
  const logsRefreshBtn = document.getElementById('logs-refresh');
  const logsAutoCheckbox = document.getElementById('logs-autorefresh');
  const logsTypeEl = document.getElementById('logs-type');
  const logsLinesEl = document.getElementById('logs-lines');

  if (logsRefreshBtn) logsRefreshBtn.addEventListener('click', loadLogs);
  if (logsAutoCheckbox) logsAutoCheckbox.addEventListener('change', handleLogsAutoRefreshChange);
  if (logsTypeEl) logsTypeEl.addEventListener('change', () => {
    loadLogs();
  });
  if (logsLinesEl) logsLinesEl.addEventListener('change', () => {
    loadLogs();
  });

  // backups
  const backupCreateBtn = document.getElementById('backup-create');
  if (backupCreateBtn) backupCreateBtn.addEventListener('click', createBackup);

  // initial load
  loadCurrentUser()
    .then(() => Promise.all([
      loadSites(),
      loadTemplatesList()
    ]))
    .catch(err => console.error(err));

  navigateTo('sites');
});
