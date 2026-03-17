# 🛡 DOM Locator Guard — Demo

## Apa yang terjadi di demo ini?

### Situasinya

Kamu punya halaman login yang sudah punya automation test.
Test-nya menggunakan locator seperti `#loginbtn`, `#username`, `[data-testid="login-submit-btn"]`.

```html
<!-- login.baseline.html — kondisi awal, stabil -->
<input id="username" data-testid="login-username-input" ... />
<button id="loginbtn" class="btn-login" data-testid="login-submit-btn">Sign In</button>
```

### Lalu developer refactor CSS

Developer sedang migrasi ke design system baru.
Dia rename class `btn-login` → `btn-primary`, dan sambil jalan
tidak sengaja juga ubah beberapa id dan data-testid:

```html
<!-- login.current.html — setelah developer refactor -->
<input id="usernameField" data-testid="login-username-input" ... />  ← id berubah!
<button id="loginBtn"  class="btn-primary" data-testid="submit-btn"> ← 3 locator berubah!
```

### Akibatnya

Fitur login **masih jalan normal** di browser.
Tapi 4 automation test akan **langsung gagal** karena locator tidak ditemukan.

```
❌ page.locator('#loginbtn')          → Element not found
❌ page.locator('#username')          → Element not found
❌ page.locator('[data-testid="login-submit-btn"]')  → Element not found
```

### Yang dilakukan DOM Locator Guard

Tools ini **mendeteksi perubahan ini sebelum test dijalankan**.
Ia tahu bahwa elemen masih "sama" karena:
- Posisi DOM identik ✓
- Text content sama ("Sign In") ✓
- Tag dan type sama (button/submit) ✓
- ARIA label sama ✓

Lalu melaporkan: "Locator berubah, tapi fitur masih functional — confidence 93%"

---

## Cara menjalankan demo

### Langkah 1 — Build core (sekali saja)

```bash
cd packages/core
npm install
npm run build
cd ../..
```

### Langkah 2 — Jalankan demo

```bash
node demo/run-demo.js
```

**Output yang diharapkan di console:**

```
🛡  DOM Locator Guard — Demo
──────────────────────────────────────────────────
📄 Baseline : demo/pages/login.baseline.html
📄 Current  : demo/pages/login.current.html

⚙️  Running diff engine...

╔══════════════════════════════════════════════════════════╗
║  DOM LOCATOR GUARD — CHANGE REPORT                       ║
╠══════════════════════════════════════════════════════════╣
║  Feature   : Login Page                                  ║
║  Status    : ✗ Error                                     ║
║  Changes   : 2 locator(s)  +0 added  -0 removed          ║
╠══════════════════════════════════════════════════════════╣
║
║  ELEMENT: <input#username>
║  Confidence : 93%
║  [HIGH] id: username → usernameField
║
║  ELEMENT: <button> "Sign In"
║  Confidence : 93%
║  [HIGH]     id: loginbtn → loginBtn
║  [CRITICAL] data-testid: login-submit-btn → submit-btn
║  [MEDIUM]   class: btn-login → btn-primary
╚══════════════════════════════════════════════════════════╝
```

### Langkah 3 — Lihat HTML report

```bash
# Buka langsung di browser
start demo/reports/login-page-report.html   # Windows
open  demo/reports/login-page-report.html   # Mac
```

### Langkah 4 — Lihat di Dashboard

```bash
# Jalankan dashboard dengan REPORTS_DIR mengarah ke demo/reports
cd dashboard
REPORTS_DIR=../demo/reports node server.js

# Windows (Command Prompt):
set REPORTS_DIR=..\demo\reports && node server.js

# Windows (PowerShell):
$env:REPORTS_DIR="../demo/reports"; node server.js
```

Buka: **http://localhost:3333**

---

## Struktur file demo

```
demo/
├── pages/
│   ├── login.baseline.html   ← Versi stabil (snapshot awal)
│   └── login.current.html    ← Versi setelah developer refactor
├── reports/                  ← Dibuat otomatis saat run-demo.js
│   ├── login-page-report.html
│   └── login-page-report.json
└── run-demo.js               ← Script utama demo
```

---

## Perubahan yang dideteksi

| Elemen | Attribute | Sebelum | Sesudah | Severity |
|--------|-----------|---------|---------|----------|
| `<input>` username | `id` | `username` | `usernameField` | HIGH |
| `<button>` Sign In | `id` | `loginbtn` | `loginBtn` | HIGH |
| `<button>` Sign In | `data-testid` | `login-submit-btn` | `submit-btn` | CRITICAL |
| `<button>` Sign In | `class` | `btn-login` | `btn-primary` | MEDIUM |

---

## Cara integrasi ke automation test kamu

### Playwright

```typescript
// Tambah satu baris ini di test login kamu
await locatorGuard.check('Login Page');

// Test tetap jalan normal — guard hanya kasih WARNING
await page.locator('#loginBtn').click();  // test ini tetap jalan
```

### Cypress

```javascript
cy.guardSnapshot('Login Page');   // satu baris ini cukup
cy.get('#loginBtn').click();       // test tetap jalan
```

### CLI (tanpa framework)

```bash
# Simpan baseline
locator-guard save-baseline --input login.html --feature "Login Page"

# Setiap kali ada PR yang ubah HTML, jalankan:
locator-guard diff --feature "Login Page" --current login-new.html
```
