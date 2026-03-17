# 🛡 DOM Locator Guard

Detect unintended locator changes in frontend HTML before they break your automation tests.

## The problem

```html
<!-- Baseline — test menggunakan #loginbtn -->
<button id="loginbtn">Login</button>

<!-- Developer refactor — id berubah tanpa sadar -->
<button id="loginBtn">Login</button>
```

Test automation gagal. Padahal fitur login masih berjalan normal.  
**DOM Locator Guard** mendeteksi perubahan ini lebih awal — sebelum test CI/CD merah.

---

## Cara kerja

1. **Capture baseline** — snapshot DOM saat aplikasi dalam kondisi stabil
2. **Capture current** — snapshot DOM setelah ada perubahan kode
3. **Diff engine** — bandingkan dua snapshot menggunakan similarity scoring
4. **Report** — jika locator berubah tapi elemen masih sama secara fungsional, generate warning

Sistem ini **tidak memblokir test** — hanya memberi early warning ke QA.

---

## Instalasi

```bash
# Core engine saja
npm install @dom-locator-guard/core

# Dengan Playwright integration
npm install @dom-locator-guard/playwright

# Dengan Cypress integration
npm install @dom-locator-guard/cypress

# CLI untuk offline usage
npm install -g @dom-locator-guard/cli
```

---

## Penggunaan

### Playwright

```typescript
// tests/fixtures.ts
import { createGuardFixture } from '@dom-locator-guard/playwright';

export const test = createGuardFixture({
  config: {
    baselineDir: './locator-guard-baselines',
    outputDir:   './locator-guard-reports',
    outputFormats: ['console', 'html'],
  }
});

export { expect } from '@playwright/test';
```

```typescript
// tests/login.spec.ts
import { test, expect } from './fixtures';

test('login feature', async ({ page, locatorGuard }) => {
  await page.goto('/login');

  // Satu baris ini melakukan: capture → compare → report
  // Test TETAP berjalan meski ada locator changes
  await locatorGuard.check('login-page');

  // Test biasa
  await page.locator('#loginBtn').click();
  await expect(page).toHaveURL('/dashboard');
});
```

### Cypress

```javascript
// cypress.config.ts
import { defineConfig } from 'cypress';
import { locatorGuardPlugin } from '@dom-locator-guard/cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      locatorGuardPlugin(on, config);
      return config;
    }
  }
});
```

```javascript
// cypress/support/e2e.ts
import { registerCypressCommands } from '@dom-locator-guard/cypress';
registerCypressCommands();
```

```javascript
// cypress/e2e/login.cy.ts
it('login feature', () => {
  cy.visit('/login');
  cy.guardSnapshot('login-page');  // capture + compare + report

  cy.get('#loginBtn').click();
  cy.url().should('include', '/dashboard');
});
```

### CLI (offline comparison)

```bash
# Simpan HTML sebagai baseline
locator-guard save-baseline \
  --input ./login.html \
  --feature "Login Page"

# Compare HTML baru terhadap baseline
locator-guard diff \
  --feature "Login Page" \
  --current ./login-updated.html \
  --format console,html

# Bandingkan dua HTML file secara langsung
locator-guard compare \
  --baseline ./login-v1.html \
  --current  ./login-v2.html \
  --feature  "Login"

# List semua baselines
locator-guard list
```

---

## Report yang dihasilkan

```
╔══════════════════════════════════════════════════════════╗
║           DOM LOCATOR GUARD — CHANGE REPORT              ║
╠══════════════════════════════════════════════════════════╣
║  Feature    : Login Page                                 ║
║  Status     : ⚠ Warning — 1 locator change              ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ELEMENT: <button> "Login"                               ║
║  ──────────────────────────────────────────────────────  ║
║  [HIGH] Attribute: id                                    ║
║    Previous : loginbtn                                   ║
║    Current  : loginBtn                                   ║
║                                                          ║
║  CONFIDENCE: 92%                                         ║
║    ✓ Same DOM position                                   ║
║    ✓ Identical text content                              ║
║    ✓ Same element type                                   ║
║                                                          ║
║  SUGGESTED LOCATOR:                                      ║
║    [data-testid="login-button"]                          ║
║    (data-testid is the most stable locator)              ║
╚══════════════════════════════════════════════════════════╝
```

---

## Konfigurasi

```typescript
import { DEFAULT_CONFIG } from '@dom-locator-guard/core';

const config = {
  // Threshold similarity (0-1). Elemen dianggap sama jika di atas threshold
  similarityThreshold: 0.75,

  // Attributes yang di-track
  trackedAttributes: [
    'id', 'name', 'dataTestId', 'dataCy',
    'dataAutomationId', 'ariaLabel', 'role', 'type', 'class'
  ],

  // Selector yang di-ignore (misal: komponen dynamic, ads)
  ignoreSelectors: ['.ad-banner', '#dynamic-timestamp'],

  // Self-healing: auto-update test files (experimental)
  autoHeal: false,

  // Format output
  outputFormats: ['console', 'html'],

  // Direktori untuk reports dan baselines
  outputDir: './locator-guard-reports',
  baselineDir: './locator-guard-baselines',
};
```

---

## Integrasi GitHub Actions

Copy file `ci-integrations/github-actions/locator-guard.yml` ke `.github/workflows/`.

Workflow ini akan:
- Berjalan setiap ada PR yang mengubah file HTML/template
- Post comment ke PR dengan summary locator changes
- Upload HTML report sebagai artifact
- **Tidak memblokir merge** (hanya warning)

---

## Algoritma similarity scoring

Setiap element di-score berdasarkan 5 sinyal:

| Signal | Weight | Keterangan |
|--------|--------|------------|
| DOM path | 30% | Posisi dalam tree HTML |
| Text content | 25% | innerText elemen |
| Tag + type | 20% | tagName + attribute type |
| Visual position | 15% | Koordinat pixel di viewport |
| ARIA role | 10% | role attribute |

Jika total score ≥ threshold (default 0.75), dianggap elemen yang sama.  
Locator changes kemudian dideteksi dari perbedaan attribute `id`, `class`, `data-testid`, dll.

---

## Struktur proyek

```
dom-locator-guard/
├── packages/
│   ├── core/          # Engine utama (TypeScript)
│   ├── playwright/    # Playwright fixture
│   ├── cypress/       # Cypress plugin + commands
│   ├── selenium/      # Selenium listener (Python)
│   └── cli/           # CLI tools
├── ci-integrations/
│   └── github-actions/
└── dashboard/         # SaaS web dashboard (Next.js)
```

---

## Lisensi

MIT
