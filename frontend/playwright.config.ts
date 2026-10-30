import { defineConfig } from '@playwright/test'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const database = process.env.SLOT_MACHINE_E2E_DATABASE ?? join(tmpdir(), `slot-machine-e2e-${process.pid}.db`)
process.env.SLOT_MACHINE_E2E_DATABASE = database

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium' },
  webServer: [
    {
      command: 'uv run --no-sync python -m app.cli create-superadmin --email e2e@example.invalid --password-env E2E_ADMIN_PASSWORD && uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8765',
      cwd: resolve('..'),
      env: { DATABASE_URL: `sqlite:///${database}`, E2E_ADMIN_PASSWORD: 'E2eTestpassword123!' },
      url: 'http://127.0.0.1:8765/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --port 5173',
      env: { VITE_API_PROXY: 'http://127.0.0.1:8765' },
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
