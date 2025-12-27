
#  **Nginx Lite Panel**

A lightweight and self-hosted **Nginx management panel** built for developers and sysadmins who want *full control* without the bloat of heavy dashboards.
Focused on **safe config editing, versioning, logs, templates, backups, and role-based access**.


---

## ✨ **Features**

### 🔧 **Safe Config Editing**

* Edit any vhost inside `sites-available`
* Automatic version snapshots
* Auto-rollback on failed `nginx -t`
* Compare & load previous versions

### 🖥️ **Site Management**

* Create new sites using templates
* Enable / Disable sites (symlinks)
* Reload Nginx safely (admin only)

### 📜 **Logs Viewer**

* Tail `access.log` or `error.log`
* Adjustable line count
* Auto-refresh mode

### 💾 **Backups**

* Full backup (`nginx` configs + panel data)
* Downloadable tar.gz archives

### 👥 **User Roles**

* `admin`: full access
* `operator`: edit + test (no reload)
* `viewer`: read-only

### 📦 **Templates**

* Custom templates stored in `data/templates.json`
* Insert variables like `{{domain}}` automatically

---

# 📁 **Project Structure**

```
nginx-lite-panel/
│ app.js
│ package.json
│ .env.example
│ README.md
│ LICENSE
│
├── static/
│    ├── app.js
│    └── app.css
│
└── data/   ← ignored (users, backups, history)
```

---

# 🚀 **Installation & Setup (Ubuntu Recommended)**

## 1) Clone the repository

```bash
git clone https://github.com/amirzarei-pro/NginxLitePanel.git
cd NginxLitePanel
```

## 2) Install dependencies

```bash
npm install
```

## 3) Create required folders

```bash
mkdir -p data/history
mkdir -p data/backups
```

## 4) Create `.env`

```bash
cp .env.example .env
nano .env
```

### Set your values, e.g.:

```
PORT=5005
NGINX_PATH=/usr/sbin/nginx
USE_SYSTEMCTL=true
SESSION_SECRET=STRONG_RANDOM_STRING_HERE
PANEL_USERNAME=admin
PANEL_PASSWORD_HASH=PUT_HASH_HERE
```

## 5) Generate password hash

```bash
node -e "const bcrypt=require('bcryptjs'); \
bcrypt.hash(process.argv[1],10).then(h=>console.log(h));" "YOUR_PASSWORD"
```

Copy output → paste into `.env` under `PANEL_PASSWORD_HASH`.

---

## 6) Run in development

```bash
node app.js
```

Panel will run at:
👉 `http://127.0.0.1:5005`

Now reverse proxy using Nginx (recommended).

---

# 🔧 **Production Setup with systemd**

Create:

```bash
sudo nano /etc/systemd/system/nginx-panel.service
```

Content:

```ini
[Unit]
Description=Nginx Management Panel
After=network.target

[Service]
WorkingDirectory=/opt/nginx-panel
ExecStart=/usr/bin/node /opt/nginx-panel/app.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/opt/nginx-panel/.env

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nginx-panel
sudo systemctl start nginx-panel
sudo systemctl status nginx-panel
```

---

# 🔐 **Security Recommendations**

* Expose panel only behind HTTPS
* Restrict access by IP or private VPN
* Use strong admin password
* Treat admin panel like root access
  (because reload/enable/disable can break Nginx)

---

# 📜 **License**

MIT License — free for commercial and personal use.

---



---

# **پنل مدیریت Nginx – نسخه سبک و سریع**

یک پنل سبک، امن و کاملاً Self-Hosted برای مدیریت **سایت‌های Nginx**.
تمرکز این پروژه روی ابزارهای مهم و حرفه‌ای است.

---

# ✨ امکانات

### 🔧 ویرایش امن کانفیگ

* ویرایش هر فایل در `sites-available`
* نسخه‌گذاری اتوماتیک
* بازگردانی خودکار اگر `nginx -t` خطا بدهد
* مشاهده و بارگذاری نسخه‌های قبلی

### 🌐 مدیریت سایت‌ها

* ساخت سایت جدید با قالب (Template)
* فعال/غیرفعال کردن سایت (symlink)
* ری‌لود امن Nginx (فقط admin)

### 📜 مشاهده زنده لاگ‌ها

* `access.log` یا `error.log`
* تعداد خطوط قابل تنظیم
* حالت Auto-Refresh

### 💾 بکاپ‌گیری

* بکاپ کامل از:

  * تنظیمات nginx
  * داده‌های پنل
* خروجی tar.gz قابل دانلود

### 👥 نقش‌های کاربری

* نقش‌ها:

  * `admin`: همه‌چیز
  * `operator`: فقط ادیت و تست
  * `viewer`: فقط مشاهده

### 📦 قالب‌ها (Templates)

* قرارگیری در `data/templates.json`
* قابلیت جایگزینی خودکار `{{domain}}`

---

# 🧱 ساختار پروژه

```
nginx-lite-panel/
│ app.js
│ package.json
│ .env.example
│ README.md
│ LICENSE
│
├── static/
│    ├── app.js
│    └── app.css
│
└── data/   ← غیرفعال در گیت (users, history, backups)
```

---

# 🚀 راه‌اندازی (Ubuntu توصیه می‌شود)

## ۱) کلون کردن پروژه

```bash
git clone https://github.com/amirzarei-pro/NginxLitePanel.git
cd NginxLitePanel
```

## ۲) نصب وابستگی‌ها

```bash
npm install
```

## ۳) ساخت پوشه‌های لازم

```bash
mkdir -p data/history
mkdir -p data/backups
```

## ۴) ساخت فایل `.env`

```bash
cp .env.example .env
nano .env
```

مقادیر مهم:

```
PORT=5005
NGINX_PATH=/usr/sbin/nginx
USE_SYSTEMCTL=true
SESSION_SECRET=رندوم قوی
PANEL_USERNAME=admin
PANEL_PASSWORD_HASH=هش پسورد
```

## ۵) ساخت هش پسورد

```bash
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.argv[1],10).then(h=>console.log(h));" "پسورد"
```

خروجی را در `.env` قرار بده.

---

# 🧪 اجرای محلی (Development)

```bash
node app.js
```

پنل بالا می‌آید روی:
👉 `http://127.0.0.1:5005`

و می‌توانی با nginx پروکسی‌اش کنی.

---

# 🏭 اجرای Production با systemd

فایل سرویس:

```bash
sudo nano /etc/systemd/system/nginx-panel.service
```

محتوا:

```ini
[Unit]
Description=Nginx Management Panel
After=network.target

[Service]
WorkingDirectory=/opt/nginx-panel
ExecStart=/usr/bin/node /opt/nginx-panel/app.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/opt/nginx-panel/.env

[Install]
WantedBy=multi-user.target
```

فعال‌سازی:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nginx-panel
sudo systemctl start nginx-panel
```

---

# 🔐 توصیه‌های امنیتی

* حتماً با HTTPS پشت Reverse Proxy اجرا کن
* ترجیحاً با IP محدود کن
* پسورد قوی و نقش‌ها را جدی بگیر
* پنل = دسترسی در حد root → مراقب باش

---

# 📜 لایسنس

MIT – قابل استفاده تجاری/شخصی.
