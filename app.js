require('dotenv').config();

const express = require('express');
const session = require('express-session');
// const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ===== env =====
const PANEL_USERNAME = process.env.PANEL_USERNAME || 'admin';
const PANEL_PASSWORD_HASH = process.env.PANEL_PASSWORD_HASH || '';
const NGINX_AVAILABLE_DIR = process.env.NGINX_AVAILABLE_DIR || '/etc/nginx/sites-available';
const NGINX_ENABLED_DIR = process.env.NGINX_ENABLED_DIR || '/etc/nginx/sites-enabled';
const NGINX_PATH = process.env.NGINX_PATH || '/usr/sbin/nginx';
const USE_SYSTEMCTL = (process.env.USE_SYSTEMCTL || 'false').toLowerCase() === 'true';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';
const PORT = parseInt(process.env.PORT || '5005', 10);

// ===== check =====
if (!PANEL_PASSWORD_HASH) {
    console.error('ERROR: PANEL_PASSWORD_HASH is not set in .env');
    process.exit(1);
}

// ===== helpers =====
function isValidSiteName(name) {
    return /^[a-zA-Z0-9._-]+$/.test(name);
}

function getAvailablePath(name) {
    if (!isValidSiteName(name)) return null;
    return path.join(NGINX_AVAILABLE_DIR, name);
}

function getEnabledPath(name) {
    if (!isValidSiteName(name)) return null;
    return path.join(NGINX_ENABLED_DIR, name);
}

function runCommand(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
            const exitCode = error && typeof error.code === 'number' ? error.code : 0;
            resolve({
                exitCode,
                stdout: stdout.toString(),
                stderr: stderr.toString()
            });
        });
    });
}

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket.remoteAddress ||
        'unknown';
}

function saveVersion(siteName, oldContent, user, ip) {
    if (!oldContent) return;

    const siteHistoryDir = path.join(HISTORY_DIR, siteName);
    ensureDir(siteHistoryDir);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const versionId = ts;
    const versionFile = path.join(siteHistoryDir, `${versionId}.conf`);
    fs.writeFileSync(versionFile, oldContent, 'utf8');

    const indexFile = path.join(siteHistoryDir, 'index.json');
    let index = [];
    if (fs.existsSync(indexFile)) {
        try {
            index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        } catch (_) { }
    }
    index.unshift({
        id: versionId,
        createdAt: ts,
        user: user || 'unknown',
        ip: ip || 'unknown'
    });
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');
}

function createBackup() {
    ensureDir(BACKUP_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${ts}_nginx-backup.tar.gz`;
    const fullPath = path.join(BACKUP_DIR, fileName);

    return new Promise((resolve, reject) => {
        // tar از nginx config و data panel
        const args = [
            '-czf',
            fullPath,
            '/etc/nginx',
            DATA_DIR
        ];
        execFile('tar', args, (error, stdout, stderr) => {
            if (error) {
                console.error('Backup error:', error, stderr.toString());
                return reject(stderr.toString());
            }
            resolve({ fileName, fullPath });
        });
    });
}

function loadTemplates() {
    if (!fs.existsSync(TEMPLATES_FILE)) return [];
    try {
        const raw = fs.readFileSync(TEMPLATES_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return [];
    }
}

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    try {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('Failed to read users.json', e);
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function findUser(username) {
    const users = loadUsers();
    return users.find(u => u.username === username);
}


// ===== app =====
const app = express();

// if needed, enable helmet with custom CSP
// app.use(helmet());

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// static CSS/JS
app.use('/static', express.static(path.join(__dirname, 'static')));

app.use(session({
    name: 'nginxpanel.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false // if behind HTTPS proxy, set to true
    }
}));

// ===== auth middleware =====
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated === true) {
        return next();
    }
    res.redirect('/login');
}
function requireRole(requiredRole) {
    return function (req, res, next) {
        if (!req.session || !req.session.authenticated) {
            return res.redirect('/login');
        }
        const role = req.session.role;
        const levels = { viewer: 1, operator: 2, admin: 3 };
        const need = levels[requiredRole] || 99;
        const have = levels[role] || 0;
        if (have < need) {
            return res.status(403).send('Forbidden: insufficient permissions.');
        }
        next();
    };
}


// ===== pages =====

// login
app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.redirect('/');
    }

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Nginx Panel Login</title>
  <link rel="stylesheet" href="/static/app.css">
</head>
<body class="login-body">
  <div class="login-box">
    <h1 class="login-title">Nginx Panel</h1>
    <form method="post" action="/login" class="login-form">
      <label class="login-label">Username
        <input class="login-input" type="text" name="username" autocomplete="username" />
      </label>
      <label class="login-label">Password
        <input class="login-input" type="password" name="password" autocomplete="current-password" />
      </label>
      <button class="login-button" type="submit">Login</button>
      ${req.query.error ? '<div class="login-error">Invalid credentials</div>' : ''}
    </form>
  </div>
</body>
</html>
`;
    res.send(html);
});

// login
app.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.redirect('/login?error=1');
    }

    let users = loadUsers();

    // اگر هیچ یوزری نیست، از .env یه admin بساز (bootstrap)
    if (users.length === 0 && PANEL_USERNAME && PANEL_PASSWORD_HASH) {
        users = [
            {
                username: PANEL_USERNAME,
                passwordHash: PANEL_PASSWORD_HASH,
                role: 'admin'
            }
        ];
        saveUsers(users);
    }

    const user = users.find(u => u.username === username);
    if (!user) {
        return res.redirect('/login?error=1');
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
        return res.redirect('/login?error=1');
    }

    req.session.authenticated = true;
    req.session.username = user.username;
    req.session.role = user.role;

    res.redirect('/');
});


// logout
app.post('/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// main page
app.get('/', requireAuth, (req, res) => {
    const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Nginx Panel</title>
    <link rel="stylesheet" href="/static/app.css">
  </head>
  <body class="app-body">
    <header class="app-header">
      <div class="app-header-left">
        <h1 class="app-title">Nginx Panel</h1>
        <span id="current-user" class="app-user-info"></span>
      </div>
      <form method="post" action="/logout">
        <button class="btn btn-logout" type="submit">Logout</button>
      </form>
    </header>
  
    <main class="app-main">
      <!-- Sidebar navigation -->
      <aside id="sidebar">
        <nav class="sidebar-nav">
          <button data-section="sites" class="nav-item nav-item-active">Sites</button>
          <button data-section="logs" class="nav-item">Logs</button>
          <button data-section="backups" class="nav-item admin-only">Backups</button>
          <button data-section="templates" class="nav-item">Templates</button>
        </nav>
  
        <section class="sidebar-block" id="sidebar-sites-extra">
          <div class="sidebar-header">
            <strong>Sites</strong>
          </div>
          <div id="sites-list">Loading...</div>
          <hr class="sidebar-divider" />
          <div id="new-site-form">
            <label class="field-label">New site name (e.g. <code>example.com</code>):</label>
            <input type="text" id="new-site-name" class="text-input" placeholder="site-name.conf or domain" />
            <label class="field-label">Template:</label>
            <select id="new-site-template" class="text-input">
              <option value="">(empty)</option>
            </select>
            <button id="btn-create" class="btn btn-primary btn-full admin-only" type="button">Create</button>
          </div>
        </section>
      </aside>
  
      <!-- Content area -->
      <section id="content">
        <!-- Section: Sites -->
        <section id="section-sites" class="content-section content-section-active">
          <div id="editor-header">
            <div id="filename">(no file selected)</div>
            <div id="editor-actions">
              <button id="btn-versions" class="btn btn-sm btn-secondary" type="button">Versions</button>
              <button id="btn-save" class="btn btn-sm btn-primary" type="button">Save</button>
              <button id="btn-test" class="btn btn-sm btn-secondary" type="button">nginx -t</button>
              <button id="btn-reload" class="btn btn-sm btn-secondary admin-only" type="button">Reload nginx</button>
              <button id="btn-toggle" class="btn btn-sm btn-secondary admin-only" type="button">Enable/Disable</button>
            </div>
          </div>
          <div id="editor-container">
            <textarea id="content-textarea" spellcheck="false"></textarea>
            <div id="status-bar">Ready.</div>
          </div>
        </section>
  
        <!-- Section: Logs -->
        <section id="section-logs" class="content-section">
          <div class="section-header">
            <h2>Logs</h2>
            <div class="logs-controls">
              <label>
                Type:
                <select id="logs-type" class="text-input">
                  <option value="access">Access</option>
                  <option value="error">Error</option>
                </select>
              </label>
              <label>
                Lines:
                <input id="logs-lines" class="text-input" type="number" value="200" min="10" max="5000" />
              </label>
              <label class="logs-autorefresh-label">
                <input id="logs-autorefresh" type="checkbox" />
                Auto refresh
              </label>
              <button id="logs-refresh" class="btn btn-sm btn-secondary" type="button">Refresh</button>
            </div>
          </div>
          <textarea id="logs-output" class="logs-output" readonly></textarea>
        </section>
  
        <!-- Section: Backups -->
        <section id="section-backups" class="content-section">
          <div class="section-header">
            <h2>Backups</h2>
            <button id="backup-create" class="btn btn-primary admin-only" type="button">Create backup</button>
          </div>
          <div id="backup-status" class="section-status"></div>
          <ul id="backup-list" class="backup-list"></ul>
        </section>
  
        <!-- Section: Templates -->
        <section id="section-templates" class="content-section">
          <div class="section-header">
            <h2>Templates</h2>
          </div>
          <div id="templates-list" class="templates-list">
            Loading templates...
          </div>
        </section>
      </section>
    </main>
  
    <!-- Version modal -->
    <div id="versions-modal" class="modal hidden">
      <div class="modal-backdrop"></div>
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Versions</h3>
          <button id="versions-close" class="btn btn-sm btn-secondary" type="button">Close</button>
        </div>
        <div class="modal-body">
          <div class="versions-layout">
            <div class="versions-list-container">
              <h4>History</h4>
              <ul id="versions-list" class="versions-list"></ul>
            </div>
            <div class="versions-preview-container">
              <h4>Preview</h4>
              <textarea id="versions-preview" class="versions-preview" readonly></textarea>
              <button id="versions-load-into-editor" class="btn btn-sm btn-primary" type="button">Load into editor</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  
    <script src="/static/app.js" defer></script>
  </body>
  </html>
  `;
    res.send(html);
});


// ===== API =====

// site list
app.get('/api/sites', requireAuth, (req, res) => {
    fs.readdir(NGINX_AVAILABLE_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read directory.' });
        }
        const result = files
            .filter(f => isValidSiteName(f))
            .map(name => {
                const availablePath = getAvailablePath(name);
                const enabledPath = getEnabledPath(name);
                let enabled = false;
                try {
                    const st = fs.lstatSync(enabledPath);
                    if (st.isSymbolicLink()) enabled = true;
                } catch (_) { }
                return { name, enabled, path: availablePath };
            });
        res.json(result);
    });
});

// content
app.get('/api/sites/:name', requireAuth, (req, res) => {
    const name = req.params.name;
    const filePath = getAvailablePath(name);
    if (!filePath) return res.status(400).send('Invalid name');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('File not found');
        res.type('text/plain').send(data);
    });
});

// meta (enabled/disabled)
app.get('/api/sites/:name/meta', requireAuth, (req, res) => {
    const name = req.params.name;
    if (!isValidSiteName(name)) return res.status(400).json({ error: 'Invalid name' });
    const enabledPath = getEnabledPath(name);
    let enabled = false;
    try {
        const st = fs.lstatSync(enabledPath);
        if (st.isSymbolicLink()) enabled = true;
    } catch (_) { }
    res.json({ name, enabled });
});

// save
app.put('/api/sites/:name', requireRole('operator'), async (req, res) => {
    const name = req.params.name;
    const filePath = getAvailablePath(name);
    if (!filePath) return res.status(400).send('Invalid name');

    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        let oldContent = '';
        try {
            if (fs.existsSync(filePath)) {
                oldContent = fs.readFileSync(filePath, 'utf8');
            }
        } catch (_) { }

        // نسخه قبلی رو ذخیره کن
        saveVersion(
            name,
            oldContent,
            req.session?.username || PANEL_USERNAME,
            getClientIp(req)
        );

        // فایل جدید رو بنویس
        try {
            fs.writeFileSync(filePath, body, 'utf8');
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to write file.');
        }

        // حالا nginx -t
        const testResult = await runCommand(NGINX_PATH, ['-t']);
        if (testResult.exitCode !== 0) {
            // اگر تست fail شد، rollback کن
            try {
                fs.writeFileSync(filePath, oldContent || '', 'utf8');
            } catch (e) {
                console.error('Rollback failed:', e);
            }
            return res
                .status(400)
                .type('text/plain')
                .send(
                    'nginx -t failed. Changes reverted.\n\n' +
                    `STDOUT:\n${testResult.stdout}\n\nSTDERR:\n${testResult.stderr}`
                );
        }

        // OK
        res.send('Saved and nginx -t OK.');
    });
});



// create new site
app.post('/api/sites', requireAuth, (req, res) => {
    const { name, templateId } = req.body || {};
    if (typeof name !== 'string' || !isValidSiteName(name)) {
        return res.status(400).send('Invalid site name.');
    }
    const filePath = getAvailablePath(name);
    if (fs.existsSync(filePath)) {
        return res.status(400).send('File already exists.');
    }

    const templates = loadTemplates();
    let content = '';
    if (templateId) {
        const tpl = templates.find(t => t.id === templateId);
        if (tpl) {
            content = tpl.content.replace(/{{domain}}/g, name);
        }
    }
    if (!content) {
        content = `server {
      listen 80;
      server_name ${name};
  
      root /var/www/${name};
      index index.html;
  
      location / {
          try_files $uri $uri/ =404;
      }
  }
  `;
    }

    fs.writeFile(filePath, content, 'utf8', err => {
        if (err) return res.status(500).send('Failed to create file.');
        res.send('Site created: ' + name);
    });
});


// enable
app.post('/api/sites/:name/enable', requireRole('admin'), (req, res) => {
    const name = req.params.name;
    const src = getAvailablePath(name);
    const dest = getEnabledPath(name);
    if (!src || !dest) return res.status(400).send('Invalid name');

    if (!fs.existsSync(src)) return res.status(404).send('Source file not found.');

    try {
        if (fs.existsSync(dest)) {
            return res.status(400).send('Site already enabled.');
        }
        fs.symlinkSync(src, dest);
        res.send('Site enabled.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to enable site.');
    }
});

// disable
app.post('/api/sites/:name/disable', requireRole('admin'), (req, res) => {
    const name = req.params.name;
    const dest = getEnabledPath(name);
    if (!dest) return res.status(400).send('Invalid name');
    try {
        if (!fs.existsSync(dest)) {
            return res.status(400).send('Site not enabled.');
        }
        fs.unlinkSync(dest);
        res.send('Site disabled.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to disable site.');
    }
});

// test nginx
app.post('/api/nginx/test', requireAuth, async (req, res) => {
    const result = await runCommand(NGINX_PATH, ['-t']);
    res.type('text/plain').send(`ExitCode: ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
});

// reload nginx
app.post('/api/nginx/reload', requireRole('admin'), async (req, res) => {
    let result;
    if (USE_SYSTEMCTL) {
        result = await runCommand('/bin/systemctl', ['reload', 'nginx']);
    } else {
        result = await runCommand(NGINX_PATH, ['-s', 'reload']);
    }
    res.type('text/plain').send(`ExitCode: ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
});

// لیست نسخه‌های یک سایت
app.get('/api/sites/:name/versions', requireAuth, (req, res) => {
    const name = req.params.name;
    if (!isValidSiteName(name)) return res.status(400).send('Invalid name');

    const siteHistoryDir = path.join(HISTORY_DIR, name);
    const indexFile = path.join(siteHistoryDir, 'index.json');
    if (!fs.existsSync(indexFile)) {
        return res.json([]);
    }
    try {
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        res.json(index);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to read history.');
    }
});

// دریافت محتوای یک نسخه خاص
app.get('/api/sites/:name/versions/:versionId', requireAuth, (req, res) => {
    const name = req.params.name;
    const versionId = req.params.versionId;
    if (!isValidSiteName(name)) return res.status(400).send('Invalid name');

    const siteHistoryDir = path.join(HISTORY_DIR, name);
    const versionFile = path.join(siteHistoryDir, `${versionId}.conf`);
    if (!fs.existsSync(versionFile)) {
        return res.status(404).send('Version not found');
    }
    const content = fs.readFileSync(versionFile, 'utf8');
    res.type('text/plain').send(content);
});

// ساخت بکاپ
app.post('/api/backup', requireRole('admin'), async (req, res) => {
    // بعداً با Roles می‌گیم فقط admin
    try {
        const result = await createBackup();
        res.json({ ok: true, file: result.fileName });
    } catch (err) {
        res.status(500).type('text/plain').send('Backup failed:\n' + err);
    }
});

// لیست بکاپ‌ها
app.get('/api/backup', requireRole('admin'), (req, res) => {
    ensureDir(BACKUP_DIR);
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.tar.gz'))
        .sort()
        .reverse();
    res.json(files);
});

// دانلود بکاپ
app.get('/api/backup/:name', requireRole('admin'), (req, res) => {
    const name = req.params.name;
    if (!/^[\w\-.]+\.tar\.gz$/.test(name)) {
        return res.status(400).send('Invalid backup name.');
    }
    const fullPath = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Not found.');
    }
    res.download(fullPath);
});


app.get('/api/templates', requireAuth, (req, res) => {
    res.json(loadTemplates());
});

function getLogPath(type) {
    if (type === 'error') return '/var/log/nginx/error.log';
    return '/var/log/nginx/access.log';
}

app.get('/api/logs', requireAuth, (req, res) => {
    const type = req.query.type === 'error' ? 'error' : 'access';
    const lines = parseInt(req.query.lines || '200', 10);
    const file = getLogPath(type);

    if (!fs.existsSync(file)) {
        return res.status(404).send('Log file not found.');
    }

    execFile('tail', ['-n', String(lines), file], (err, stdout, stderr) => {
        if (err) {
            console.error(err, stderr.toString());
            return res.status(500).send('Failed to read logs.');
        }
        res.type('text/plain').send(stdout.toString());
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({
        username: req.session.username,
        role: req.session.role
    });
});



// ===== start =====
app.listen(PORT, () => {
    console.log(`Nginx Panel listening on port ${PORT}`);
});
