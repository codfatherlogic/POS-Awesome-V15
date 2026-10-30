# POS Smoke Tests

This suite is a production-safety smoke gate for global runtime errors.

## Run

```bash
yarn test:smoke
```

## Local Secrets

Copy `frontend/.env.example` to `frontend/.env.local` and fill in local values.

`frontend/.env.local` is ignored by git and is auto-loaded by `frontend/playwright.config.ts`.

## Environment Variables

- `POSA_SMOKE_BASE_URL`: Frappe site URL (default: `http://127.0.0.1:8000`)
- `POSA_SMOKE_PATH`: POS route (default: `/app/posapp`)
- `POSA_SMOKE_USER`: login username (optional)
- `POSA_SMOKE_PASSWORD`: login password (optional)
- `POSA_SMOKE_SID`: existing Frappe session cookie (optional alternative to user/password)
- `POSA_STARTUP_RECOVERY_E2E`: set to `1` to enable the live slow-start recovery scenarios
- `POSA_E2E_CASHIER`: cashier assigned to the active POS Profile (required when the terminal is locked)
- `POSA_E2E_CASHIER_PIN`: that cashier's local-only POS PIN

Run only the startup recovery coverage after deploying the current frontend build:

```bash
yarn playwright test tests/e2e/startup-recovery.spec.ts --config=playwright.config.ts
```

The test delays live read requests in the browser, verifies that terminal security remains fail-closed, retries the cashier list, and confirms that a slow catalog no longer owns the startup overlay indefinitely. It does not submit an invoice. Keep all real values in ignored `frontend/.env.local`; never add them to `.env.example`.

In CI, the POS app route smoke test is skipped unless `POSA_SMOKE_BASE_URL` is configured.
If credentials are set, the test logs in before opening POS.
If credentials are not set, test assumes an already authenticated session.
