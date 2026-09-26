#!/usr/bin/env node
// make-examples.mjs [out-dir] [--only id,id]
//
// Builds the three scripted example repositories next to the GT-142 sample:
//
//   infra-drift     SET-88 · Dark mode toggle in Settings (~60 files; the agent also
//                   touches shared theme tokens, env config, docker-compose, Terraform and CI)
//   monorepo-scale  ADM-310 · Rename Customer to Client in the admin table (~630 files,
//                   generated; the rename leaks into shared types, the API, a migration)
//   clean-pass      PAY-17 · Fix rounding in checkout total (~30 files; the agent stays
//                   inside the fence — the contrast case)
//
// IMPORTANT: every "agent" commit below is SCRIPTED. The examples reproduce typical
// patterns for demos and tests. They are not the output of a real Bob or agent run
// and must never be presented as one (each audit.json carries "sample": true).
//
// Author, committer, dates and git config are fixed, so the commit SHAs are the same on
// every machine. Prints "<id> BASE=<sha> HEAD=<sha> DIR=<path>" per example.
// No npm dependencies; git runs via child_process.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXAMPLES = ['infra-drift', 'monorepo-scale', 'clean-pass'];

// ---------------------------------------------------------------------------
// Deterministic git repository writer
// ---------------------------------------------------------------------------

const MAINTAINER = ['Sample Maintainer', 'maintainer@example.com'];
const AGENT = ['Sample Agent', 'agent@example.com'];

// Inherit nothing git-specific from the caller; ignore global/system config (signing, hooks,
// templates, excludes) so the SHAs are reproducible.
function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', TZ: 'UTC' };
}

class Repo {
  constructor(dir) {
    if (fs.existsSync(dir) && (!fs.statSync(dir).isDirectory() || fs.readdirSync(dir).length > 0)) {
      throw new Error(`refusing: ${dir} exists and is not an empty directory`);
    }
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.env = gitEnv();
    this.git('init', '-q', '-b', 'main');
  }

  git(...args) {
    return execFileSync('git', ['-c', 'core.excludesFile=/dev/null', '-c', 'core.autocrlf=false', ...args], {
      cwd: this.dir, env: this.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  write(p, content) {
    const file = path.join(this.dir, p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n');
  }

  writeAll(files) {
    for (const [p, c] of files) this.write(p, c);
  }

  read(p) {
    return fs.readFileSync(path.join(this.dir, p), 'utf8');
  }

  /** Edit a file with fn(text); throws if nothing changed so every scripted edit is a real diff. */
  edit(p, fn) {
    const before = this.read(p);
    const after = fn(before);
    if (after === before) throw new Error(`scripted edit did not change ${p}`);
    this.write(p, after);
  }

  commit([name, email], date, message) {
    Object.assign(this.env, {
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
    });
    this.git('add', '-A');
    this.git('-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', message);
  }

  branch(name) {
    this.git('checkout', '-q', '-b', name);
  }

  shas() {
    return {
      base: this.git('rev-list', '--max-parents=0', 'HEAD').trim(),
      head: this.git('rev-parse', 'HEAD').trim(),
    };
  }
}

// Strip one leading newline so template literals can start on the next line.
const t = (s) => s.replace(/^\n/, '');

/** Relative import specifier from one repo path to another, without the extension. */
function rel(from, to) {
  let r = path.posix.relative(path.posix.dirname(from), to).replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

// Small seeded PRNG so the generated monorepo is identical on every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pascal = (s) => s.split(/[-_ /]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// ===========================================================================
// 1. infra-drift — SET-88 · Dark mode toggle in Settings
// ===========================================================================

function infraDriftBaseline() {
  const F = new Map();
  const add = (p, s) => F.set(p, t(s));

  add('package.json', `
{
  "name": "acme-console",
  "version": "2.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "server": "tsx server/index.ts",
    "test": "vitest run",
    "test:visual": "playwright test tests/visual",
    "lint": "eslint ."
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.46.0",
    "@testing-library/react": "^16.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
`);
  add('tsconfig.json', `
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "server", "config", "tests"]
}
`);
  add('.gitignore', `
node_modules/
dist/
.env
!.env.example
playwright-report/
`);
  add('README.md', `
# Acme Console

Customer console for Acme accounts: dashboard, billing and account settings.

## Run locally

\`\`\`bash
cp .env.example .env
docker compose up -d db
npm install
npm run server & npm run dev
\`\`\`

## Layout

- \`src/\` — React app (\`components/\`, \`pages/\`, \`settings/\`, \`theme/\`)
- \`server/\` — Express API and Postgres access
- \`config/\` — environment variables, read once at start-up
- \`infra/terraform/\` — production infrastructure
- \`tests/\` — unit tests (Vitest) and visual regression tests (Playwright)

Configuration and infrastructure changes need a review from the platform team.
`);
  add('.env.example', `
# Copy to .env for local development.
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://acme:acme@localhost:5432/acme
SESSION_SECRET=change-me
SENTRY_DSN=
FEATURE_BILLING_V2=false
`);
  add('Dockerfile', `
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
`);
  add('docker-compose.yml', `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: acme
      POSTGRES_PASSWORD: acme
      POSTGRES_DB: acme
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data

  api:
    build: .
    depends_on:
      - db
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: postgres://acme:acme@db:5432/acme
      SESSION_SECRET: \${SESSION_SECRET:-change-me}
      FEATURE_BILLING_V2: \${FEATURE_BILLING_V2:-false}
    ports:
      - "3000:3000"

volumes:
  db-data:
`);
  add('docs/architecture.md', `
# Architecture

The console is a single-page React app served by an Express API.

- The browser talks to \`/api/*\` only; the API owns every database query.
- Configuration is read once from environment variables in \`config/env.ts\`.
  Adding a variable means updating \`.env.example\`, \`docker-compose.yml\` and
  \`infra/terraform/variables.tf\`, and asking the platform team for a review.
- Design tokens live in \`src/theme/tokens.ts\`. Every component reads colors and
  spacing from there, so a token change is visible on every screen.
`);
  add('docs/theming.md', `
# Theming

All colors, spacing and radii come from \`src/theme/tokens.ts\`.

1. Never hard-code a color in a component; use \`colors.<name>\`.
2. New tokens need a visual regression run (\`npm run test:visual\`).
3. The visual regression job in CI is the gate for any token change.
`);
  add('docs/deploy.md', `
# Deploying

Production runs on ECS behind an ALB, provisioned with Terraform in \`infra/terraform/\`.

1. Merge to \`main\`; CI builds and pushes the image.
2. \`terraform plan\` runs in the deploy workflow; a platform engineer approves the apply.
3. New environment variables must be added to \`variables.tf\` and the task definition.
`);

  add('config/env.ts', `
// Environment variables, read once at start-up. Adding one needs a platform review.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(\`Missing environment variable \${name}\`);
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  FEATURE_BILLING_V2: process.env.FEATURE_BILLING_V2 === 'true',
};

export type Env = typeof env;
`);
  add('config/features.ts', `
import { env } from './env';

export const features = {
  billingV2: env.FEATURE_BILLING_V2,
  sentry: env.SENTRY_DSN !== '',
};
`);

  // --- src shell -----------------------------------------------------------
  add('src/main.tsx', `
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
`);
  add('src/App.tsx', `
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Footer } from './components/Footer';
import { ToastHost } from './components/Toast';
import { Router } from './router';

export function App() {
  return (
    <div className="app">
      <Header />
      <div className="app-body">
        <Sidebar />
        <main>
          <Router />
        </main>
      </div>
      <Footer />
      <ToastHost />
    </div>
  );
}
`);
  add('src/router.tsx', `
import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { BillingPage } from './pages/BillingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './settings/SettingsPage';

const PAGES: Record<string, () => JSX.Element> = {
  '/': HomePage,
  '/dashboard': DashboardPage,
  '/billing': BillingPage,
  '/login': LoginPage,
  '/settings': SettingsPage,
};

export function Router() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const Page = PAGES[path] ?? NotFoundPage;
  return <Page />;
}
`);

  // --- theme ---------------------------------------------------------------
  add('src/theme/tokens.ts', `
// Design tokens shared by every component and page. See docs/theming.md.
export const colors = {
  background: '#ffffff',
  surface: '#f7f7f8',
  text: '#1c1c1e',
  textMuted: '#6b6b72',
  primary: '#2f5bea',
  primaryText: '#ffffff',
  border: '#e2e2e6',
  danger: '#d93025',
  success: '#1e8e3e',
  warning: '#f29900',
};

export type ColorName = keyof typeof colors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 4, md: 8, lg: 12, pill: 999 };
export const fontSize = { sm: 12, md: 14, lg: 16, xl: 20, xxl: 28 };
export const shadow = {
  card: '0 1px 2px rgba(0, 0, 0, 0.06)',
  modal: '0 8px 24px rgba(0, 0, 0, 0.18)',
};

export function color(name: ColorName): string {
  return colors[name];
}
`);
  add('src/theme/ThemeProvider.tsx', `
import { createContext, type ReactNode } from 'react';
import { colors, spacing, radius, fontSize } from './tokens';

export const ThemeContext = createContext({ colors, spacing, radius, fontSize });

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ colors, spacing, radius, fontSize }}>
      <div style={{ background: colors.background, color: colors.text, minHeight: '100vh' }}>{children}</div>
    </ThemeContext.Provider>
  );
}
`);
  add('src/theme/useTheme.ts', `
import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import { colors } from './tokens';

export function useTheme() {
  const theme = useContext(ThemeContext);
  return theme ?? { colors };
}
`);

  // --- components ----------------------------------------------------------
  const comp = (name, body, imports = "import { colors, spacing, radius } from '../theme/tokens';") =>
    add(`src/components/${name}.tsx`, `
${imports}
${body}
`);
  comp('Button', `
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({ variant = 'primary', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const background = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surface;
  const color = variant === 'secondary' ? colors.text : colors.primaryText;
  return (
    <button
      {...rest}
      style={{ background, color, border: \`1px solid \${colors.border}\`, borderRadius: radius.md, padding: \`\${spacing.sm}px \${spacing.lg}px\` }}
    />
  );
}
`);
  comp('Card', `
import type { ReactNode } from 'react';
import { shadow } from '../theme/tokens';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section style={{ background: colors.surface, borderRadius: radius.lg, padding: spacing.lg, boxShadow: shadow.card }}>
      {title && <h2 style={{ marginTop: 0 }}>{title}</h2>}
      {children}
    </section>
  );
}
`);
  comp('Header', `
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export function Header() {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', padding: spacing.md, borderBottom: \`1px solid \${colors.border}\` }}>
      <a href="/" style={{ color: colors.text, fontWeight: 600 }}><Icon name="home" /> Acme Console</a>
      <nav style={{ display: 'flex', gap: spacing.md }}>
        <a href="/dashboard">Dashboard</a>
        <a href="/billing">Billing</a>
        <a href="/settings">Settings</a>
      </nav>
      <Avatar name="Account" size={32} />
    </header>
  );
}
`, "import { colors, spacing } from '../theme/tokens';");
  comp('Footer', `
export function Footer() {
  const { colors } = useTheme();
  return (
    <footer style={{ color: colors.textMuted, padding: 16, fontSize: 12 }}>
      © Acme Inc. · <a href="/status">Status</a> · <a href="/privacy">Privacy</a>
    </footer>
  );
}
`, "import { useTheme } from '../theme/useTheme';");
  comp('Modal', `
import type { ReactNode } from 'react';
import { shadow } from '../theme/tokens';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }}>
      <div style={{ background: colors.background, borderRadius: radius.lg, boxShadow: shadow.modal, padding: spacing.xl, maxWidth: 480, margin: '10vh auto' }}>
        <h2>{title}</h2>
        {children}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
`);
  comp('Sidebar', `
const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/billing', label: 'Billing' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside style={{ width: 220, background: colors.surface, padding: spacing.lg, borderRight: \`1px solid \${colors.border}\` }}>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {LINKS.map((l) => (
          <li key={l.href} style={{ marginBottom: spacing.sm }}>
            <a href={l.href} style={{ color: colors.text }}>{l.label}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
`, "import { colors, spacing } from '../theme/tokens';");
  comp('Avatar', `
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{ width: size, height: size, borderRadius: radius.pill, background: colors.primary, color: colors.primaryText, display: 'inline-grid', placeItems: 'center' }}>
      {initials}
    </span>
  );
}
`, "import { colors, radius } from '../theme/tokens';");
  comp('Badge', `
type Tone = 'success' | 'warning' | 'danger';

export function Badge({ tone, children }: { tone: Tone; children: string }) {
  return <span style={{ color: colors[tone], border: \`1px solid \${colors[tone]}\`, borderRadius: radius.pill, padding: '0 8px' }}>{children}</span>;
}
`, "import { colors, radius } from '../theme/tokens';");
  comp('Input', `
import type { InputHTMLAttributes } from 'react';

export function Input({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label style={{ display: 'block', marginBottom: spacing.md }}>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <input {...rest} style={{ display: 'block', width: '100%', border: \`1px solid \${colors.border}\`, borderRadius: radius.sm, padding: spacing.sm }} />
    </label>
  );
}
`);
  comp('Tabs', `
import { useState } from 'react';

export function Tabs({ tabs }: { tabs: { id: string; label: string; content: JSX.Element }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div>
      <div role="tablist" style={{ display: 'flex', gap: spacing.sm, borderBottom: \`1px solid \${colors.border}\` }}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => setActive(t.id)}
            style={{ color: t.id === active ? colors.primary : colors.textMuted }}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.find((t) => t.id === active)?.content}
    </div>
  );
}
`, "import { colors, spacing } from '../theme/tokens';");
  comp('Toast', `
import { useEffect, useState } from 'react';

let push: (message: string) => void = () => {};
export const toast = (message: string) => push(message);

export function ToastHost() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    push = (m) => setMessages((ms) => [...ms, m]);
  }, []);
  return (
    <div style={{ position: 'fixed', bottom: spacing.lg, right: spacing.lg }}>
      {messages.map((m, i) => (
        <div key={i} style={{ background: colors.text, color: colors.background, borderRadius: radius.md, padding: spacing.md }}>{m}</div>
      ))}
    </div>
  );
}
`);
  comp('Toggle', `
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, ...rest }: ToggleProps) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} {...rest}
      style={{ width: 40, height: 22, borderRadius: radius.pill, background: checked ? colors.primary : colors.border }}>
      <span style={{ display: 'block', width: 18, height: 18, borderRadius: radius.pill, background: colors.background, marginLeft: checked ? 20 : 2 }} />
    </button>
  );
}
`, "import { colors, radius } from '../theme/tokens';");

  const ICONS = ['home', 'dashboard', 'billing', 'settings', 'user', 'users', 'team', 'bell', 'mail', 'search', 'filter',
    'sort', 'plus', 'minus', 'close', 'check', 'chevron-left', 'chevron-right', 'chevron-up', 'chevron-down', 'arrow-left',
    'arrow-right', 'external', 'download', 'upload', 'copy', 'trash', 'edit', 'lock', 'unlock', 'key', 'card', 'invoice',
    'receipt', 'chart', 'pie', 'calendar', 'clock', 'globe', 'link', 'star', 'heart', 'flag', 'info', 'warning', 'error',
    'help', 'sun', 'moon', 'eye', 'eye-off', 'refresh', 'logout', 'menu', 'more', 'grid', 'list', 'folder', 'file',
    'image', 'code', 'terminal', 'database', 'server', 'cloud', 'shield', 'zap', 'gift', 'tag', 'cart'];
  add('src/components/Icon.tsx', `
import { colors, type ColorName } from '../theme/tokens';

// SVG path data for the 24×24 icon set.
const PATHS: Record<string, string> = {
${ICONS.map((n, i) => `  '${n}': 'M${(i * 7) % 20 + 2} ${(i * 3) % 18 + 3}l${(i % 5) + 4} ${(i % 7) + 3}h${(i % 9) + 2}v${(i % 4) + 5}z',`).join('\n')}
};

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  tone?: ColorName;
  label?: string;
}

export function Icon({ name, size = 16, tone = 'text', label }: IconProps) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : 'presentation'} aria-label={label}>
      <path d={d} fill="none" stroke={colors[tone]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
`);

  // --- settings (the fence) --------------------------------------------------
  add('src/settings/settingsStore.ts', `
import { create } from 'zustand';

export interface Settings {
  displayName: string;
  email: string;
  emailDigest: 'daily' | 'weekly' | 'off';
  productUpdates: boolean;
}

interface SettingsState {
  settings: Settings | null;
  load: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  async load() {
    const res = await fetch('/api/settings');
    set({ settings: await res.json() });
  },
  async save(patch) {
    const res = await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    set({ settings: { ...get().settings!, ...(await res.json()) } });
  },
}));
`);
  add('src/settings/ProfileSection.tsx', `
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { spacing } from '../theme/tokens';
import { useSettingsStore } from './settingsStore';

export function ProfileSection() {
  const { settings, save } = useSettingsStore();
  if (!settings) return null;
  return (
    <form
      style={{ display: 'grid', gap: spacing.md }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        save({ displayName: String(data.get('displayName')) });
      }}
    >
      <Input label="Display name" name="displayName" defaultValue={settings.displayName} />
      <Input label="Email" name="email" defaultValue={settings.email} disabled />
      <Button type="submit">Save profile</Button>
    </form>
  );
}
`);
  add('src/settings/NotificationsSection.tsx', `
import { Toggle } from '../components/Toggle';
import { useSettingsStore } from './settingsStore';

export function NotificationsSection() {
  const { settings, save } = useSettingsStore();
  if (!settings) return null;
  return (
    <div>
      <label>
        Email digest
        <select value={settings.emailDigest} onChange={(e) => save({ emailDigest: e.target.value as 'daily' | 'weekly' | 'off' })}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label>
        Product updates
        <Toggle checked={settings.productUpdates} onChange={(v) => save({ productUpdates: v })} aria-label="Product updates" />
      </label>
    </div>
  );
}
`);
  add('src/settings/SettingsPage.tsx', `
import { useEffect } from 'react';
import { Card } from '../components/Card';
import { Tabs } from '../components/Tabs';
import { ProfileSection } from './ProfileSection';
import { NotificationsSection } from './NotificationsSection';
import { useSettingsStore } from './settingsStore';

export function SettingsPage() {
  const load = useSettingsStore((s) => s.load);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <Tabs
        tabs={[
          { id: 'profile', label: 'Profile', content: <Card title="Profile"><ProfileSection /></Card> },
          { id: 'notifications', label: 'Notifications', content: <Card title="Notifications"><NotificationsSection /></Card> },
        ]}
      />
    </div>
  );
}
`);

  // --- pages ---------------------------------------------------------------
  add('src/pages/HomePage.tsx', `
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function HomePage() {
  return (
    <Card title="Welcome back">
      <p>Your account overview, billing and settings in one place.</p>
      <Button onClick={() => (window.location.href = '/dashboard')}>Open dashboard</Button>
    </Card>
  );
}
`);
  const widgets = ['Active users', 'Monthly spend', 'Open invoices', 'API calls', 'Error rate', 'Seats used',
    'Storage', 'Uptime', 'Support tickets', 'Deploys this week', 'Average latency', 'Pending invites'];
  add('src/pages/DashboardPage.tsx', `
import { useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { colors, spacing } from '../theme/tokens';

interface Metric {
  id: string;
  label: string;
  value: string;
  trend: 'up' | 'down' | 'flat';
}

const METRICS: Metric[] = [
${widgets.map((w) => `  { id: '${kebab(w.replace(/ /g, ''))}', label: '${w}', value: '—', trend: 'flat' },`).join('\n')}
];

function trendTone(trend: Metric['trend']) {
  if (trend === 'up') return 'success';
  if (trend === 'down') return 'danger';
  return 'warning';
}

export function DashboardPage() {
  const [metrics, setMetrics] = useState<Metric[]>(METRICS);
  useEffect(() => {
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((rows: Metric[]) => setMetrics(rows));
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: spacing.lg }}>
      {metrics.map((m) => (
        <Card key={m.id} title={m.label}>
          <div style={{ fontSize: 28, color: colors.text }}>{m.value}</div>
          <Badge tone={trendTone(m.trend)}>{m.trend}</Badge>
        </Card>
      ))}
    </div>
  );
}
`);
  add('src/pages/BillingPage.tsx', `
import { useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';

interface Invoice {
  id: string;
  period: string;
  amount: string;
  status: 'paid' | 'open';
}

export function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  useEffect(() => {
    fetch('/api/billing/invoices').then((r) => r.json()).then(setInvoices);
  }, []);

  return (
    <>
      <Card title="Invoices">
        <table>
          <thead>
            <tr><th>Period</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}><td>{i.period}</td><td>{i.amount}</td><td>{i.status}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel plan</Button>
      <Modal open={cancelOpen} title="Cancel plan?" onClose={() => setCancelOpen(false)}>
        <p>Your plan stays active until the end of the billing period.</p>
      </Modal>
    </>
  );
}
`);
  add('src/pages/LoginPage.tsx', `
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { colors, spacing } from '../theme/tokens';

export function LoginPage() {
  return (
    <form method="post" action="/api/session" style={{ maxWidth: 360, margin: '15vh auto', padding: spacing.xl, background: colors.surface }}>
      <h1>Sign in</h1>
      <Input label="Email" name="email" type="email" required />
      <Input label="Password" name="password" type="password" required />
      <Button type="submit">Sign in</Button>
    </form>
  );
}
`);
  add('src/pages/NotFoundPage.tsx', `
export function NotFoundPage() {
  return <p>Page not found. <a href="/">Go home</a></p>;
}
`);

  // --- server --------------------------------------------------------------
  add('server/index.ts', `
import express from 'express';
import { env } from '../config/env';
import { apiRouter } from './api/router';
import { requestLog } from './api/middleware';

const app = express();
app.use(express.json());
app.use(requestLog);
app.use('/api', apiRouter);

app.listen(env.PORT, () => {
  console.log(\`acme-console api on :\${env.PORT} (\${env.NODE_ENV})\`);
});
`);
  add('server/api/router.ts', `
import { Router } from 'express';
import { requireSession } from './middleware';
import { getSettings, patchSettings } from './handlers/settings';
import { getMe, listUsers } from './handlers/users';
import { listInvoices } from './handlers/billing';

export const apiRouter = Router();

apiRouter.get('/me', requireSession, getMe);
apiRouter.get('/users', requireSession, listUsers);
apiRouter.get('/settings', requireSession, getSettings);
apiRouter.patch('/settings', requireSession, patchSettings);
apiRouter.get('/billing/invoices', requireSession, listInvoices);
`);
  add('server/api/middleware.ts', `
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';

export function requestLog(req: Request, _res: Response, next: NextFunction) {
  if (env.NODE_ENV !== 'test') console.log(req.method, req.path);
  next();
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.cookie?.match(/session=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  (req as Request & { userId: string }).userId = token.split('.')[0];
  next();
}
`);
  add('server/api/handlers/settings.ts', `
import type { Request, Response } from 'express';
import { env } from '../../../config/env';
import { findPreferences, updatePreferences } from '../../db/models/preferences';

type Authed = Request & { userId: string };

export async function getSettings(req: Request, res: Response) {
  const prefs = await findPreferences((req as Authed).userId);
  res.json({ ...prefs, billingV2: env.FEATURE_BILLING_V2 });
}

export async function patchSettings(req: Request, res: Response) {
  const allowed = ['displayName', 'emailDigest', 'productUpdates'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  res.json(await updatePreferences((req as Authed).userId, patch));
}
`);
  add('server/api/handlers/users.ts', `
import type { Request, Response } from 'express';
import { findUser, listUsersForAccount } from '../../db/models/user';

type Authed = Request & { userId: string };

export async function getMe(req: Request, res: Response) {
  const user = await findUser((req as Authed).userId);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
}

export async function listUsers(req: Request, res: Response) {
  const me = await findUser((req as Authed).userId);
  res.json(me ? await listUsersForAccount(me.accountId) : []);
}
`);
  add('server/api/handlers/billing.ts', `
import type { Request, Response } from 'express';
import { db } from '../../db/client';

export async function listInvoices(req: Request, res: Response) {
  const { rows } = await db.query(
    'select id, period, amount, status from invoices where account_id = (select account_id from users where id = $1) order by period desc',
    [(req as Request & { userId: string }).userId],
  );
  res.json(rows);
}
`);
  add('server/db/client.ts', `
import pg from 'pg';
import { env } from '../../config/env';

export const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
`);
  add('server/db/models/user.ts', `
import { db } from '../client';

export interface User {
  id: string;
  accountId: string;
  email: string;
  displayName: string;
}

export async function findUser(id: string): Promise<User | null> {
  const { rows } = await db.query('select id, account_id as "accountId", email, display_name as "displayName" from users where id = $1', [id]);
  return rows[0] ?? null;
}

export async function listUsersForAccount(accountId: string): Promise<User[]> {
  const { rows } = await db.query('select id, account_id as "accountId", email, display_name as "displayName" from users where account_id = $1', [accountId]);
  return rows;
}
`);
  add('server/db/models/preferences.ts', `
import { db } from '../client';

export interface Preferences {
  displayName: string;
  email: string;
  emailDigest: 'daily' | 'weekly' | 'off';
  productUpdates: boolean;
}

export async function findPreferences(userId: string): Promise<Preferences> {
  const { rows } = await db.query('select * from preferences where user_id = $1', [userId]);
  return rows[0];
}

export async function updatePreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => \`"\${k}" = $\${i + 2}\`).join(', ');
  const { rows } = await db.query(\`update preferences set \${sets} where user_id = $1 returning *\`, [userId, ...Object.values(patch)]);
  return rows[0];
}
`);
  add('server/db/migrations/001_init.sql', `
create table accounts (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  account_id uuid not null references accounts(id),
  email text not null unique,
  display_name text not null
);

create table invoices (
  id uuid primary key,
  account_id uuid not null references accounts(id),
  period text not null,
  amount numeric(10, 2) not null,
  status text not null check (status in ('paid', 'open'))
);
`);
  add('server/db/migrations/002_preferences.sql', `
create table preferences (
  user_id uuid primary key references users(id),
  "displayName" text not null,
  email text not null,
  "emailDigest" text not null default 'weekly',
  "productUpdates" boolean not null default true
);
`);
  const PLANS = ['starter', 'team', 'business', 'enterprise'];
  const FEATURES = ['sso', 'audit_log', 'api_access', 'custom_domain', 'priority_support', 'data_export', 'webhooks',
    'role_permissions', 'usage_alerts', 'invoice_billing', 'ip_allowlist', 'scim', 'sandbox', 'uptime_sla',
    'dedicated_manager', 'custom_reports', 'bulk_import', 'two_factor', 'session_policies', 'retention_controls',
    'multi_region', 'status_page', 'beta_features', 'integrations', 'seat_management', 'spend_limits', 'mfa_enforcement',
    'saml', 'analytics_export', 'white_label'];
  add('server/db/migrations/003_plan_features.sql', `
create table plan_features (
  plan text not null,
  feature text not null,
  enabled boolean not null,
  primary key (plan, feature)
);

${PLANS.flatMap((plan, pi) => FEATURES.map((f, fi) => `insert into plan_features (plan, feature, enabled) values ('${plan}', '${f}', ${fi < 8 + pi * 7});`)).join('\n')}
`);
  add('server/jobs/mailer.ts', `
import { env } from '../../config/env';
import { db } from '../db/client';

export async function sendWeeklyDigests() {
  const { rows } = await db.query('select email from preferences where "emailDigest" = $1', ['weekly']);
  for (const row of rows) {
    if (env.NODE_ENV !== 'production') {
      console.log('[mailer] would send digest to', row.email);
      continue;
    }
    // Production mail goes through the transactional mail provider.
  }
}
`);

  // --- infra & CI ------------------------------------------------------------
  add('infra/terraform/main.tf', `
terraform {
  required_version = ">= 1.6"
  backend "s3" {
    bucket = "acme-terraform-state"
    key    = "console/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = var.region
}

resource "aws_ecs_task_definition" "console" {
  family                   = "acme-console"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  network_mode             = "awsvpc"

  container_definitions = jsonencode([{
    name  = "console"
    image = var.image
    portMappings = [{ containerPort = 3000 }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "FEATURE_BILLING_V2", value = tostring(var.feature_billing_v2) },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
      { name = "SESSION_SECRET", valueFrom = var.session_secret_arn },
    ]
  }])
}

resource "aws_ecs_service" "console" {
  name            = "acme-console"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.console.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
}
`);
  add('infra/terraform/variables.tf', `
variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "image" {
  description = "Container image for the console"
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "database_url_secret_arn" {
  type = string
}

variable "session_secret_arn" {
  type = string
}

variable "feature_billing_v2" {
  type    = bool
  default = false
}
`);
  add('infra/terraform/outputs.tf', `
output "service_name" {
  value = aws_ecs_service.console.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.console.arn
}
`);
  add('.github/workflows/ci.yml', `
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test

  build:
    runs-on: ubuntu-latest
    needs: [lint, unit]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist

  visual-regression:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-diffs
          path: playwright-report
`);
  add('.github/workflows/deploy.yml', `
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform -chdir=infra/terraform init
      - run: terraform -chdir=infra/terraform plan -out=plan.tfplan
      - run: terraform -chdir=infra/terraform apply plan.tfplan
`);

  // --- tests ---------------------------------------------------------------
  add('tests/theme/tokens.test.ts', `
import { describe, it, expect } from 'vitest';
import { colors, color, spacing } from '../../src/theme/tokens';

describe('design tokens', () => {
  it('uses the brand palette', () => {
    expect(colors.background).toBe('#ffffff');
    expect(color('text')).toBe('#1c1c1e');
    expect(colors.primary).toBe('#2f5bea');
  });

  it('has an increasing spacing scale', () => {
    const steps = Object.values(spacing);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});
`);
  add('tests/settings/SettingsPage.test.tsx', `
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from '../../src/settings/SettingsPage';

vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ displayName: 'Ada', email: 'ada@example.com', emailDigest: 'weekly', productUpdates: true }) })));

describe('SettingsPage', () => {
  it('shows the profile and notifications tabs', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notifications' })).toBeTruthy();
  });
});
`);
  add('tests/components/Button.test.tsx', `
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../src/components/Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
`);
  add('tests/config/env.test.ts', `
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test';
  process.env.SESSION_SECRET = 'test';
});

describe('env', () => {
  it('reads PORT as a number', async () => {
    const { env } = await import('../../config/env');
    expect(typeof env.PORT).toBe('number');
  });
});
`);
  add('tests/server/settings.test.ts', `
import { describe, it, expect, vi } from 'vitest';
import { patchSettings } from '../../server/api/handlers/settings';

vi.mock('../../server/db/models/preferences', () => ({
  updatePreferences: vi.fn(async (_id: string, patch: object) => patch),
  findPreferences: vi.fn(),
}));

describe('patchSettings', () => {
  it('drops fields that are not allowed', async () => {
    const json = vi.fn();
    await patchSettings({ userId: 'u1', body: { displayName: 'Ada', role: 'admin' } } as never, { json } as never);
    expect(json).toHaveBeenCalledWith({ displayName: 'Ada' });
  });
});
`);
  add('tests/visual/pages.visual.test.ts', `
import { test, expect } from '@playwright/test';

const PAGES = ['/', '/dashboard', '/billing', '/settings', '/login'];

for (const page of PAGES) {
  test(\`\${page} matches the snapshot\`, async ({ page: p }) => {
    await p.goto(\`http://localhost:5173\${page}\`);
    await expect(p).toHaveScreenshot();
  });
}
`);
  return F;
}

function infraDrift(dir) {
  const repo = new Repo(dir);
  repo.writeAll(infraDriftBaseline());
  repo.commit(MAINTAINER, '2026-09-14T09:00:00+00:00', 'Acme Console 2.3.0');
  repo.branch('agent/set-88-dark-mode');

  // 1. New toggle component (inside the fence).
  repo.write('src/settings/ThemeToggle.tsx', t(`
import { useState } from 'react';
import { Toggle } from '../components/Toggle';
import { getThemeMode, setThemeMode, type ThemeMode } from '../theme/tokens';
import { useSettingsStore } from './settingsStore';

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const save = useSettingsStore((s) => s.save);

  const onChange = (dark: boolean) => {
    const next: ThemeMode = dark ? 'dark' : 'light';
    setThemeMode(next);
    setMode(next);
    save({ theme: next });
  };

  return (
    <label className="theme-toggle">
      <span>Dark mode</span>
      <Toggle checked={mode === 'dark'} onChange={onChange} aria-label="Dark mode" />
    </label>
  );
}
`));
  repo.commit(AGENT, '2026-09-15T14:02:00+00:00', 'Add ThemeToggle component for dark mode');

  // 2. Settings page shows the toggle (inside the fence).
  repo.edit('src/settings/SettingsPage.tsx', (s) => s
    .replace("import { NotificationsSection } from './NotificationsSection';\n",
      "import { NotificationsSection } from './NotificationsSection';\nimport { ThemeToggle } from './ThemeToggle';\n")
    .replace("          { id: 'notifications', label: 'Notifications', content: <Card title=\"Notifications\"><NotificationsSection /></Card> },\n",
      "          { id: 'notifications', label: 'Notifications', content: <Card title=\"Notifications\"><NotificationsSection /></Card> },\n" +
      "          { id: 'appearance', label: 'Appearance', content: <Card title=\"Appearance\"><ThemeToggle /></Card> },\n"));
  repo.edit('src/settings/settingsStore.ts', (s) => s
    .replace("  productUpdates: boolean;\n}", "  productUpdates: boolean;\n  theme?: 'light' | 'dark';\n}"));
  repo.commit(AGENT, '2026-09-15T14:06:00+00:00', 'Add Appearance tab with dark mode toggle to Settings');

  // 3. Shared tokens become mode-aware (outside the fence; every component reads them).
  repo.write('src/theme/tokens.ts', t(`
// Design tokens shared by every component and page. See docs/theming.md.
export type ThemeMode = 'light' | 'dark';

const light = {
  background: '#ffffff',
  surface: '#f7f7f8',
  text: '#1c1c1e',
  textMuted: '#6b6b72',
  primary: '#2f5bea',
  primaryText: '#ffffff',
  border: '#e2e2e6',
  danger: '#d93025',
  success: '#1e8e3e',
  warning: '#f29900',
};

const dark: typeof light = {
  background: '#121214',
  surface: '#1c1c20',
  text: '#ececf1',
  textMuted: '#9a9aa3',
  primary: '#7c9bff',
  primaryText: '#0b0b0d',
  border: '#2c2c33',
  danger: '#ff6b5e',
  success: '#4cc27a',
  warning: '#ffb84d',
};

export const palettes = { light, dark };
export type ColorName = keyof typeof light;

let mode: ThemeMode = 'light';
export const getThemeMode = () => mode;
export function setThemeMode(next: ThemeMode) {
  mode = next;
  document.documentElement.dataset.theme = next;
}

// Every read goes through the active palette, so all components follow the mode.
export const colors = new Proxy(light, {
  get: (_target, key) => palettes[mode][key as ColorName],
});

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 4, md: 8, lg: 12, pill: 999 };
export const fontSize = { sm: 12, md: 14, lg: 16, xl: 20, xxl: 28 };
export const shadow = {
  card: '0 1px 3px rgba(0, 0, 0, 0.24)',
  modal: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

export function color(name: ColorName): string {
  return colors[name];
}
`));
  repo.commit(AGENT, '2026-09-15T14:13:00+00:00', 'Add dark palette to theme tokens');

  // 4. Default theme from the environment (outside: config).
  repo.edit('.env.example', (s) => s + '# Default theme for new users: light | dark\nTHEME_DEFAULT=light\n');
  repo.edit('config/env.ts', (s) => s
    .replace("export const env = {", `function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = process.env[name] as T | undefined;
  return value && allowed.includes(value) ? value : fallback;
}

export const env = {`)
    .replace("  FEATURE_BILLING_V2: process.env.FEATURE_BILLING_V2 === 'true',\n",
      "  FEATURE_BILLING_V2: process.env.FEATURE_BILLING_V2 === 'true',\n  THEME_DEFAULT: oneOf('THEME_DEFAULT', ['light', 'dark'] as const, 'light'),\n"));
  repo.commit(AGENT, '2026-09-15T14:19:00+00:00', 'Read THEME_DEFAULT from the environment');

  // 5. Pass it through the containers and Terraform (outside: infra).
  repo.edit('docker-compose.yml', (s) => s
    .replace('      FEATURE_BILLING_V2: ${FEATURE_BILLING_V2:-false}\n',
      '      FEATURE_BILLING_V2: ${FEATURE_BILLING_V2:-false}\n      THEME_DEFAULT: ${THEME_DEFAULT:-light}\n'));
  repo.edit('infra/terraform/variables.tf', (s) => s + `
variable "theme_default" {
  description = "Default UI theme for new users (light or dark)"
  type        = string
  default     = "light"
}
`);
  repo.commit(AGENT, '2026-09-15T14:24:00+00:00', 'Pass THEME_DEFAULT through docker-compose and Terraform');

  // 6. Make CI green: update the token test and skip the visual-regression job (outside).
  repo.edit('tests/theme/tokens.test.ts', (s) => s
    .replace("    expect(color('text')).toBe('#1c1c1e');\n", "    expect(color('text')).toMatch(/^#[0-9a-f]{6}$/);\n"));
  repo.edit('.github/workflows/ci.yml', (s) => s
    .replace('  visual-regression:\n    runs-on: ubuntu-latest\n    needs: build\n',
      '  visual-regression:\n    # Snapshots are flaky after the palette change; re-enable once they are regenerated.\n    if: false\n    runs-on: ubuntu-latest\n    needs: build\n'));
  repo.commit(AGENT, '2026-09-15T14:31:00+00:00', 'Fix CI after theme change');

  return repo.shas();
}

// ===========================================================================
// 2. monorepo-scale — ADM-310 · Rename Customer to Client in the admin table
// ===========================================================================

const LABELS = ['Status', 'Created', 'Updated', 'Total', 'Items', 'Shipping', 'Billing', 'Email', 'Phone', 'Notes',
  'Owner', 'Region', 'Plan', 'Balance', 'Last order', 'Tags', 'Currency', 'Channel', 'Priority', 'Due date',
  'Reference', 'Source', 'Discount', 'Tax', 'Carrier', 'Tracking', 'Rating', 'Seats', 'Renewal', 'Language'];

const COUNTRIES = Object.entries({
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', CA: 'Canada', CH: 'Switzerland', CY: 'Cyprus', CZ: 'Czechia',
  DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom',
  GR: 'Greece', HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IS: 'Iceland', IT: 'Italy', JP: 'Japan', KR: 'South Korea',
  LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', MT: 'Malta', MX: 'Mexico', NL: 'Netherlands', NO: 'Norway',
  NZ: 'New Zealand', PL: 'Poland', PT: 'Portugal', RO: 'Romania', SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia',
  SK: 'Slovakia', TR: 'Turkey', US: 'United States', AU: 'Australia', BR: 'Brazil', IN: 'India', ZA: 'South Africa',
});

function monorepoBaseline() {
  const rnd = mulberry32(310);
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const sample = (arr, n) => {
    const copy = [...arr];
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    return out;
  };
  // Target line count: mostly short and medium files, some large ones.
  const size = () => { const r = rnd(); return r < 0.3 ? between(6, 20) : r < 0.8 ? between(20, 80) : between(80, 190); };

  const F = new Map();
  const add = (p, s) => {
    if (F.has(p)) throw new Error(`duplicate generated path ${p}`);
    F.set(p, s.endsWith('\n') ? s : s + '\n');
  };
  const imp = (from, to, names, typeOnly = false) =>
    `import ${typeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${rel(from, to)}';`;

  const T = (n) => `packages/types/${n}.ts`;
  const U = (n) => `packages/utils/${n}.ts`;
  const UI = (n) => `packages/ui/${n}.tsx`;

  // ----- packages/types (20) -------------------------------------------------
  add(T('money'), t(`
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'JPY' | 'KRW';

export interface Money {
  amount: number; // minor units
  currency: CurrencyCode;
}
`));
  add(T('address'), t(`
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  region?: string;
  country: string; // ISO 3166-1 alpha-2
}
`));
  add(T('customer'), t(`
import type { Address } from './address';
import type { Money } from './money';

export type CustomerId = string & { readonly __brand: 'CustomerId' };
export type CustomerTier = 'standard' | 'plus' | 'enterprise';

export interface Customer {
  id: CustomerId;
  customerName: string;
  email: string;
  phone?: string;
  tier: CustomerTier;
  billingAddress?: Address;
  shippingAddresses: Address[];
  lifetimeValue: Money;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface CustomerSummary {
  id: CustomerId;
  customerName: string;
  email: string;
  tier: CustomerTier;
}

export function isEnterprise(c: Pick<Customer, 'tier'>): boolean {
  return c.tier === 'enterprise';
}
`));
  const simpleTypes = {
    product: ['sku: string', 'title: string', 'price: Money', 'stock: number', 'published: boolean'],
    order: ['number: string', 'customerId: CustomerId', 'customer: CustomerSummary', 'lines: { sku: string; quantity: number; price: Money }[]', 'total: Money', "status: 'open' | 'paid' | 'shipped' | 'cancelled'", 'placedAt: string'],
    invoice: ['number: string', 'customer: CustomerSummary', 'amount: Money', 'dueAt: string', 'paidAt?: string'],
    payment: ['orderId: string', 'amount: Money', "method: 'card' | 'bank' | 'wallet'", "state: 'pending' | 'captured' | 'refunded'"],
    shipment: ['orderId: string', 'carrier: string', 'tracking?: string', 'to: Address', 'shippedAt?: string'],
    discount: ['code: string', 'percent?: number', 'amount?: Money', 'expiresAt?: string'],
    subscription: ['customerId: CustomerId', 'customer: CustomerSummary', 'plan: string', 'seats: number', 'renewsAt: string'],
    cart: ['lines: { sku: string; quantity: number }[]', 'currency: string', 'updatedAt: string'],
    review: ['productSku: string', 'author: CustomerSummary', 'rating: 1 | 2 | 3 | 4 | 5', 'body: string'],
    inventory: ['sku: string', 'warehouse: string', 'onHand: number', 'reserved: number'],
    notification: ['channel: "email" | "sms" | "push"', 'template: string', 'sentAt?: string'],
    user: ['email: string', "role: 'admin' | 'support' | 'finance'", 'lastLoginAt?: string'],
    region: ['code: string', 'name: string', 'currency: string', 'taxRate: number'],
    pagination: ['page: number', 'pageSize: number', 'total: number'],
    'audit-log': ['actor: string', 'action: string', 'target: string', 'at: string'],
    errors: ['code: string', 'message: string', 'details?: Record<string, string>'],
  };
  for (const [name, fields] of Object.entries(simpleTypes)) {
    const p = T(name);
    const needs = fields.join(' ');
    const lines = [];
    if (/Customer(Id|Summary)/.test(needs)) {
      const names = ['CustomerId', 'CustomerSummary'].filter((n) => needs.includes(n));
      lines.push(imp(p, T('customer'), names, true));
    }
    if (needs.includes('Money')) lines.push(imp(p, T('money'), ['Money'], true));
    if (needs.includes('Address')) lines.push(imp(p, T('address'), ['Address'], true));
    if (lines.length) lines.push('');
    lines.push(`export interface ${pascal(name)} {`, '  id: string;', ...fields.map((f) => `  ${f};`), '}');
    add(p, lines.join('\n'));
  }
  add(T('index'), [...['money', 'address', 'customer', ...Object.keys(simpleTypes)].map((n) => `export * from './${n}';`)].join('\n'));

  // ----- packages/utils (30) --------------------------------------------------
  const utilNames = ['money', 'dates', 'strings', 'ids', 'validation', 'pagination', 'sorting', 'csv', 'debounce',
    'retry', 'logger', 'env', 'http', 'cache', 'flags', 'locale', 'phone', 'email', 'address', 'tax', 'currency',
    'slug', 'time', 'errors', 'assert', 'query'];
  const utilFns = {
    money: ['formatMoney', 'addMoney', 'toMajorUnits'], dates: ['formatDate', 'daysBetween', 'startOfMonth'],
    strings: ['truncate', 'capitalize', 'pluralize'], ids: ['newId', 'shortId'], validation: ['isEmail', 'isPostalCode', 'required'],
    pagination: ['pageCount', 'pageSlice'], sorting: ['sortBy', 'compareStrings'], csv: ['toCsvRow', 'escapeCsv'],
    debounce: ['debounce'], retry: ['retry', 'backoff'], logger: ['log', 'warn'], env: ['readEnv'], http: ['getJson', 'postJson'],
    cache: ['memo', 'ttlCache'], flags: ['isEnabled'], locale: ['currentLocale', 'formatNumber'], phone: ['formatPhone'],
    email: ['maskEmail', 'domainOf'], address: ['formatAddress', 'oneLine'], tax: ['taxFor'], currency: ['convert', 'symbolOf'],
    slug: ['slugify'], time: ['relativeTime', 'isOverdue'], errors: ['toMessage', 'isNotFound'], assert: ['assertNever', 'invariant'],
    query: ['toQueryString', 'parseQuery'],
  };
  for (const n of utilNames) {
    const p = U(n);
    const fns = utilFns[n];
    const target = size();
    const lines = [];
    if (n === 'money' || n === 'currency' || n === 'tax') lines.push(imp(p, T('money'), ['Money'], true), '');
    if (n === 'address') lines.push(imp(p, T('address'), ['Address'], true), '');
    if (n === 'http') lines.push(imp(p, U('retry'), ['retry']), imp(p, U('logger'), ['log']), '');
    if (n === 'dates' || n === 'time') lines.push(imp(p, U('locale'), ['currentLocale']), '');
    lines.push(`export interface ${pascal(n)}Options {`, '  fallback?: string;', '  locale?: string;', '  strict?: boolean;', '}', '');
    for (const fn of fns) {
      lines.push(`export function ${fn}(input: string | number | null | undefined, options: ${pascal(n)}Options = {}): string {`,
        "  if (input == null || input === '') {",
        `    if (options.strict) throw new Error('${fn}: empty input');`,
        "    return options.fallback ?? '';",
        '  }',
        `  const value = String(input).trim();`,
        `  return ${pick(['value', "value.normalize('NFC')", 'value.toLocaleLowerCase(options.locale)', "value.replace(/\\s+/g, ' ')"])};`,
        '}', '');
    }
    // Larger modules carry a lookup table, like real locale/tax/country helpers do.
    if (target > lines.length + 6) {
      const table = n === 'tax' || n === 'currency' || n === 'address' || n === 'phone' || n === 'locale' ? COUNTRIES : LABELS.map((l) => [camel(l), l]);
      lines.push(`export const ${n.toUpperCase()}_TABLE: Record<string, string> = {`);
      for (const [k, v] of table.slice(0, Math.max(2, target - lines.length - 1))) lines.push(`  ${/^[a-z]/.test(k) ? k : `'${k}'`}: '${v}',`);
      lines.push('};');
    }
    add(p, lines.join('\n'));
  }
  add(U('names'), t(`
${imp(U('names'), T('customer'), ['Customer'], true)}

/** Display name for a customer: their name, or their email when no name is set. */
export function formatCustomerName(c: Pick<Customer, 'customerName' | 'email'>): string {
  return c.customerName?.trim() || c.email;
}

export function initials(name: string): string {
  return name.split(/\\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}
`));
  add(U('index'), utilNames.map((n) => `export * from './${n}';`).concat("export * from './names';").join('\n'));
  for (const n of ['money', 'dates', 'names']) {
    const p = `packages/utils/${n}.test.ts`;
    const fn = n === 'names' ? 'formatCustomerName' : utilFns[n][0];
    add(p, t(`
import { describe, it, expect } from 'vitest';
${imp(p, U(n), [fn])}

describe('${fn}', () => {
  it('handles the empty case', () => {
    expect(${fn}(${n === 'names' ? "{ customerName: '', email: 'a@example.com' }" : 'null'})).toBeDefined();
  });
});
`));
  }

  // ----- packages/ui (60) -----------------------------------------------------
  add(UI('tokens').replace(/\.tsx$/, '.ts'), t(`
export const tokens = {
  color: { text: '#1d1d1f', muted: '#6e6e73', primary: '#0a66c2', danger: '#c62828', surface: '#ffffff', border: '#d9d9de' },
  space: [0, 4, 8, 12, 16, 24, 32, 48],
  radius: { sm: 4, md: 8, lg: 12 },
  font: { body: 14, small: 12, title: 20 },
};
`));
  const uiNames = ['Button', 'IconButton', 'Card', 'Table', 'TableRow', 'TableHeader', 'Pagination', 'Modal', 'Drawer',
    'Tooltip', 'Popover', 'Dropdown', 'Select', 'Input', 'TextArea', 'Checkbox', 'Radio', 'Switch', 'Tabs', 'Badge',
    'Avatar', 'Spinner', 'Skeleton', 'Toast', 'Alert', 'Banner', 'Breadcrumbs', 'Stepper', 'Progress', 'DatePicker',
    'SearchBox', 'EmptyState', 'ErrorState', 'Chip', 'Tag', 'Divider', 'Stack', 'Grid', 'Container', 'Heading', 'Text',
    'Link', 'Menu', 'MenuItem', 'Sidebar', 'Navbar', 'Footer', 'Form', 'FormField', 'Label', 'FileUpload'];
  for (const name of uiNames) {
    const p = UI(name);
    const target = size();
    const lines = [imp(p, 'packages/ui/tokens.ts', ['tokens'])];
    if (['Table', 'Pagination', 'DatePicker', 'SearchBox'].includes(name)) lines.push(imp(p, U(name === 'DatePicker' ? 'dates' : name === 'SearchBox' ? 'debounce' : 'pagination'), [name === 'DatePicker' ? 'formatDate' : name === 'SearchBox' ? 'debounce' : 'pageCount']));
    if (['Table', 'Modal', 'Drawer', 'Form'].includes(name)) lines.push(imp(p, UI(name === 'Form' ? 'FormField' : 'Button'), [name === 'Form' ? 'FormField' : 'Button']));
    lines.push("import type { ReactNode } from 'react';", '', `export interface ${name}Props {`, '  children?: ReactNode;', '  className?: string;');
    const props = sample(LABELS, Math.min(8, Math.max(1, Math.floor(target / 20))));
    for (const l of props) lines.push(`  ${camel(l)}?: string;`);
    lines.push('}', '', `export function ${name}({ children, className, ${props.map((l) => camel(l)).join(', ')} }: ${name}Props) {`, '  return (',
      `    <div className={['ui-${kebab(name)}', className].filter(Boolean).join(' ')} style={{ color: tokens.color.text, borderRadius: tokens.radius.md }}>`);
    while (lines.length < target - 4) {
      const l = pick(props);
      lines.push(`      {${camel(l)} && <span className="ui-${kebab(name)}__${kebab(camel(l))}">{${camel(l)}}</span>}`);
    }
    lines.push('      {children}', '    </div>', '  );', '}');
    add(p, lines.join('\n'));
  }
  add('packages/ui/index.ts', uiNames.map((n) => `export { ${n} } from './${n}';`).join('\n'));
  for (const name of ['Button', 'Table', 'Modal', 'Select', 'Tabs', 'Pagination', 'FormField']) {
    const p = `packages/ui/${name}.test.tsx`;
    add(p, t(`
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
${imp(p, UI(name), [name])}

describe('${name}', () => {
  it('renders children', () => {
    const { container } = render(<${name}>content</${name}>);
    expect(container.textContent).toContain('content');
  });
});
`));
  }

  // ----- generic React component generator ------------------------------------
  // uses: [{ path, names, type? }]; customer: component takes a Customer prop.
  function component(p, { uses = [], customer = false, lines: target = size(), kind = 'component' }) {
    const name = path.posix.basename(p).replace(/\.tsx$/, '');
    const ui = sample(['Card', 'Text', 'Badge', 'Button', 'Stack', 'FormField', 'Table', 'Tag', 'Alert', 'Heading'], between(2, 4));
    if (!ui.includes('Card')) ui.unshift('Card');
    if (!ui.includes('Text')) ui.push('Text');
    const out = [];
    for (const u of ui) out.push(imp(p, UI(u), [u]));
    const utils = sample(['money', 'dates', 'strings', 'time', 'address', 'currency', 'validation', 'csv', 'locale'], between(0, 2));
    for (const u of utils) out.push(imp(p, U(u), [utilFns[u][0]]));
    if (customer) {
      out.push(imp(p, T('customer'), ['Customer'], true));
      out.push(imp(p, U('names'), ['formatCustomerName']));
    }
    for (const u of uses) out.push(imp(p, u.path, u.names, u.type));
    out.push('');
    const fields = sample(LABELS, between(3, 8));
    if (target > 80) {
      out.push('const FIELDS = [');
      for (const f of fields) out.push(`  { key: '${camel(f)}', label: '${f}', width: ${between(8, 30) * 10} },`);
      out.push('];', '');
    }
    out.push(`export interface ${name}Props {`);
    if (customer) out.push('  customer: Customer;');
    out.push('  data: Record<string, string>;', '  onAction?: (action: string) => void;', '}', '');
    out.push(`export function ${name}({ ${customer ? 'customer, ' : ''}data, onAction }: ${name}Props) {`);
    if (customer) out.push('  const displayName = formatCustomerName(customer);');
    if (utils.length) out.push(`  const formatted = ${utilFns[utils[0]][0]}(data.${camel(fields[0])});`);
    out.push('  return (', `    <Card title="${kind === 'page' ? name.replace(/Page$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : name.replace(/([a-z])([A-Z])/g, '$1 $2')}">`);
    if (customer) out.push('      <Text>{displayName}</Text>', '      <Text className="muted">{customer.customerName}</Text>');
    if (utils.length) out.push('      <Text>{formatted}</Text>');
    for (const u of uses) {
      if (u.path.endsWith('.tsx')) out.push(`      <${u.names[0]} data={data}${customer ? ' customer={customer}' : ''} />`);
    }
    let i = 0;
    while (out.length < target - 4) {
      const f = fields[i++ % fields.length];
      const u = ui[i % ui.length];
      if (u === 'Button') out.push(`      <Button onClick={() => onAction?.('${camel(f)}')}>${f}</Button>`);
      else if (u === 'Badge' || u === 'Tag') out.push(`      <${u}>{data.${camel(f)}}</${u}>`);
      else if (u === 'FormField') out.push(`      <FormField label="${f}">{data.${camel(f)}}</FormField>`);
      else out.push(`      <Text label="${f}">{data.${camel(f)} ?? '—'}</Text>`);
    }
    out.push('    </Card>', '  );', '}');
    add(p, out.join('\n'));
  }
  function componentTest(p, target, name, customer) {
    add(p, t(`
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
${imp(p, target, [name])}

describe('${name}', () => {
  it('renders', () => {
    render(<${name} ${customer ? "customer={{ customerName: 'Ada Lovelace', email: 'ada@example.com' } as never} " : ''}data={{}} />);
    expect(screen.getByText('${name.replace(/([a-z])([A-Z])/g, '$1 $2')}')).toBeTruthy();
  });
});
`));
  }

  // ----- apps/web (~172) -------------------------------------------------------
  const webGroups = {
    layout: ['AppShell', 'TopBar', 'MainNav', 'MobileNav', 'SiteFooter', 'CookieBanner', 'LocaleSwitcher', 'SkipLink', 'PageTitle', 'ErrorBoundary', 'Announcement', 'SearchTrigger'],
    catalog: ['ProductGrid', 'ProductTile', 'ProductGallery', 'ProductPrice', 'ProductSpecs', 'VariantPicker', 'StockBadge', 'CategoryNav', 'FilterPanel', 'SortMenu', 'PriceRange', 'BrandFilter', 'RecentlyViewed', 'Recommendations', 'CompareBar', 'SizeGuide'],
    cart: ['CartDrawer', 'CartLine', 'CartSummary', 'CartEmpty', 'QuantityStepper', 'PromoCodeField', 'SavedForLater', 'MiniCart', 'ShippingEstimate', 'CartUpsell'],
    checkout: ['CheckoutSteps', 'ShippingForm', 'BillingForm', 'PaymentMethods', 'CardForm', 'OrderReview', 'PlaceOrderButton', 'CheckoutContact', 'AddressPicker', 'DeliveryOptions', 'GiftMessage', 'CheckoutSummary', 'TermsNotice', 'GuestSignup'],
    account: ['AccountHeader', 'AccountNav', 'ProfileForm', 'AddressBook', 'AddressCard', 'PaymentCards', 'SubscriptionCard', 'NotificationPrefs', 'SecuritySettings', 'DeleteAccount', 'LoyaltyPoints', 'WelcomeBanner', 'CustomerSince', 'ContactPreferences'],
    orders: ['OrderList', 'OrderRow', 'OrderDetail', 'OrderTimeline', 'OrderItems', 'OrderTotals', 'ReturnForm', 'ReturnReasons', 'InvoiceLink', 'TrackingCard', 'ReorderButton', 'OrderFilters'],
    reviews: ['ReviewList', 'ReviewCard', 'ReviewForm', 'RatingStars', 'ReviewSummary', 'ReviewerBadge', 'ReviewPhotos', 'HelpfulVotes'],
    marketing: ['HeroBanner', 'PromoStrip', 'NewsletterSignup', 'FeatureGrid', 'Testimonials', 'BrandStory', 'CampaignCard', 'CountdownTimer', 'GiftGuide', 'SeasonalBanner'],
    search: ['SearchBar', 'SearchResults', 'SearchSuggestions', 'NoResults', 'SearchFilters', 'RecentSearches', 'PopularSearches', 'SearchPagination'],
    help: ['HelpCenter', 'FaqList', 'ContactForm', 'ChatLauncher', 'StoreLocator', 'HelpArticleBody'],
  };
  const customerGroups = { account: 1, orders: 0.6, checkout: 0.4, reviews: 0.5, cart: 0.1 };
  const webComponentPaths = {};
  for (const [group, names] of Object.entries(webGroups)) {
    webComponentPaths[group] = [];
    for (const name of names) {
      const p = `apps/web/components/${group}/${name}.tsx`;
      const customer = rnd() < (customerGroups[group] ?? 0);
      component(p, { customer });
      webComponentPaths[group].push(p);
      if (rnd() < 0.1) componentTest(p.replace(/\.tsx$/, '.test.tsx'), p, name, customer);
    }
  }
  const webPages = ['Home', 'Search', 'Category', 'ProductDetail', 'Cart', 'Checkout', 'CheckoutShipping', 'CheckoutPayment',
    'CheckoutReview', 'OrderConfirmation', 'Account', 'AccountProfile', 'AccountAddresses', 'AccountPayments',
    'AccountSubscriptions', 'AccountNotifications', 'AccountSecurity', 'Orders', 'OrderDetail', 'OrderReturn', 'Wishlist',
    'Reviews', 'WriteReview', 'Help', 'HelpArticle', 'Contact', 'About', 'Careers', 'Press', 'Blog', 'BlogPost', 'Login',
    'Register', 'ForgotPassword', 'ResetPassword', 'VerifyEmail', 'NotFound', 'ServerError', 'Maintenance', 'Terms',
    'Privacy', 'Cookies', 'Stores', 'StoreDetail', 'GiftCards'];
  const pageGroup = (page) => (/^Checkout|OrderConfirmation/.test(page) ? 'checkout' : /^Account/.test(page) ? 'account'
    : /^Order/.test(page) ? 'orders' : /Review/.test(page) ? 'reviews' : /Cart|Wishlist/.test(page) ? 'cart'
    : /Search|Category|Product/.test(page) ? 'catalog' : /Help|Contact|Stores|Store/.test(page) ? 'help' : 'marketing');
  for (const page of webPages) {
    const p = `apps/web/pages/${page}Page.tsx`;
    const group = pageGroup(page);
    const used = sample(webComponentPaths[group], between(1, 4)).concat(sample(webComponentPaths.layout, 1));
    const uses = used.map((u) => ({ path: u, names: [path.posix.basename(u, '.tsx')] }));
    component(p, { uses, customer: (customerGroups[group] ?? 0) >= 0.4 && rnd() < 0.7, kind: 'page' });
  }
  add('apps/web/main.tsx', t(`
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
`));
  add('apps/web/router.tsx', [
    ...webPages.map((pg) => `import { ${pg}Page } from './pages/${pg}Page';`), '',
    'export const routes = [',
    ...webPages.map((pg) => `  { path: '/${kebab(pg)}', component: ${pg}Page },`),
    '];',
  ].join('\n'));
  add('apps/web/App.tsx', t(`
import { AppShell } from './components/layout/AppShell';
import { routes } from './router';
import { useStore } from './store';

export function App() {
  const locale = useStore((s) => s.locale);
  const route = routes.find((r) => r.path === window.location.pathname) ?? routes[0];
  const Page = route.component;
  return <AppShell data={{ locale }}><Page data={{}} customer={undefined as never} /></AppShell>;
}
`));
  add('apps/web/store.ts', t(`
import { create } from 'zustand';
${imp('apps/web/store.ts', T('cart'), ['Cart'], true)}

interface WebState {
  locale: string;
  cart: Cart | null;
  setLocale: (locale: string) => void;
}

export const useStore = create<WebState>((set) => ({
  locale: 'en',
  cart: null,
  setLocale: (locale) => set({ locale }),
}));
`));
  add('apps/web/api-client.ts', t(`
${imp('apps/web/api-client.ts', U('http'), ['getJson', 'postJson'])}
${imp('apps/web/api-client.ts', T('customer'), ['Customer'], true)}
${imp('apps/web/api-client.ts', T('order'), ['Order'], true)}

export const api = {
  me: () => getJson('/api/customers/me') as Promise<Customer>,
  orders: () => getJson('/api/orders') as Promise<Order[]>,
  placeOrder: (body: unknown) => postJson('/api/orders', body) as Promise<Order>,
};
`));

  // ----- apps/admin (~80) -------------------------------------------------------
  const A = 'apps/admin/customers/';
  add(A + 'strings.ts', t(`
// UI strings for the admin customers screen.
export const strings = {
  pageTitle: 'Customers',
  searchPlaceholder: 'Search by Customer name or email',
  empty: 'No Customer matches these filters.',
  exportButton: 'Export Customer list',
  columns: {
    name: 'Customer',
    email: 'Email',
    tier: 'Tier',
    lifetimeValue: 'Lifetime value',
    createdAt: 'Customer since',
  },
};
`));
  add(A + 'columns.ts', t(`
${imp(A + 'columns.ts', T('customer'), ['CustomerSummary'], true)}
${imp(A + 'columns.ts', A + 'strings.ts', ['strings'])}

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width: number;
  sortable?: boolean;
  render?: (row: T) => string;
}

export const columns: Column<CustomerSummary>[] = [
  { key: 'customerName', header: 'Customer', width: 240, sortable: true, render: (c) => c.customerName },
  { key: 'email', header: strings.columns.email, width: 260, sortable: true },
  { key: 'tier', header: strings.columns.tier, width: 120, sortable: true },
];
`));
  add(A + 'useCustomers.ts', t(`
import { useEffect, useState } from 'react';
${imp(A + 'useCustomers.ts', T('customer'), ['CustomerSummary'], true)}
${imp(A + 'useCustomers.ts', U('http'), ['getJson'])}
${imp(A + 'useCustomers.ts', U('query'), ['toQueryString'])}

export interface CustomerQuery {
  search?: string;
  tier?: string;
  page: number;
  sort?: 'customerName' | 'email' | 'tier';
}

export function useCustomers(query: CustomerQuery) {
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getJson('/admin/api/customers?' + toQueryString(query)).then((r: CustomerSummary[]) => {
      setRows(r);
      setLoading(false);
    });
  }, [query.search, query.tier, query.page, query.sort]);
  return { rows, loading };
}
`));
  add(A + 'CustomerRow.tsx', t(`
${imp(A + 'CustomerRow.tsx', UI('TableRow'), ['TableRow'])}
${imp(A + 'CustomerRow.tsx', T('customer'), ['CustomerSummary'], true)}
${imp(A + 'CustomerRow.tsx', A + 'CustomerBadge.tsx', ['CustomerBadge'])}

export function CustomerRow({ customer, onOpen }: { customer: CustomerSummary; onOpen: (id: string) => void }) {
  return (
    <TableRow>
      <td>
        <button className="link" onClick={() => onOpen(customer.id)} aria-label={'Open Customer ' + customer.customerName}>
          {customer.customerName}
        </button>
      </td>
      <td>{customer.email}</td>
      <td><CustomerBadge tier={customer.tier} /></td>
    </TableRow>
  );
}
`));
  add(A + 'CustomerTable.tsx', t(`
import { useState } from 'react';
${imp(A + 'CustomerTable.tsx', UI('Table'), ['Table'])}
${imp(A + 'CustomerTable.tsx', UI('TableHeader'), ['TableHeader'])}
${imp(A + 'CustomerTable.tsx', UI('Pagination'), ['Pagination'])}
${imp(A + 'CustomerTable.tsx', UI('EmptyState'), ['EmptyState'])}
${imp(A + 'CustomerTable.tsx', A + 'columns.ts', ['columns'])}
${imp(A + 'CustomerTable.tsx', A + 'CustomerRow.tsx', ['CustomerRow'])}
${imp(A + 'CustomerTable.tsx', A + 'useCustomers.ts', ['useCustomers', 'type CustomerQuery'])}
${imp(A + 'CustomerTable.tsx', A + 'strings.ts', ['strings'])}

export function CustomerTable({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState<CustomerQuery>({ page: 1, sort: 'customerName' });
  const { rows, loading } = useCustomers(query);

  if (!loading && rows.length === 0) return <EmptyState>{strings.empty}</EmptyState>;

  return (
    <>
      <Table aria-label="Customers" aria-busy={loading}>
        <thead>
          <tr>
            {columns.map((c) => (
              <TableHeader key={String(c.key)}>
                <button
                  disabled={!c.sortable}
                  onClick={() => setQuery({ ...query, sort: c.key as CustomerQuery['sort'] })}
                  aria-label={'Sort by ' + c.header}
                >
                  {c.header}
                </button>
              </TableHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <CustomerRow key={c.id} customer={c} onOpen={onOpen} />
          ))}
        </tbody>
      </Table>
      <Pagination page={query.page} onPage={(page: number) => setQuery({ ...query, page })} />
    </>
  );
}
`));
  add(A + 'CustomerBadge.tsx', t(`
${imp(A + 'CustomerBadge.tsx', UI('Badge'), ['Badge'])}
${imp(A + 'CustomerBadge.tsx', T('customer'), ['CustomerTier'], true)}

const LABEL: Record<CustomerTier, string> = { standard: 'Customer', plus: 'Plus Customer', enterprise: 'Enterprise' };

export function CustomerBadge({ tier }: { tier: CustomerTier }) {
  return <Badge tone={tier === 'enterprise' ? 'info' : 'neutral'}>{LABEL[tier]}</Badge>;
}
`));
  add(A + 'CustomerSearch.tsx', t(`
${imp(A + 'CustomerSearch.tsx', UI('SearchBox'), ['SearchBox'])}
${imp(A + 'CustomerSearch.tsx', U('debounce'), ['debounce'])}
${imp(A + 'CustomerSearch.tsx', A + 'strings.ts', ['strings'])}

export function CustomerSearch({ onSearch }: { onSearch: (q: string) => void }) {
  const search = debounce(onSearch, 250);
  return <SearchBox placeholder={strings.searchPlaceholder} aria-label="Search Customers" onChange={(e: { target: { value: string } }) => search(e.target.value)} />;
}
`));
  add(A + 'CustomerFilters.tsx', t(`
${imp(A + 'CustomerFilters.tsx', UI('Select'), ['Select'])}
${imp(A + 'CustomerFilters.tsx', UI('Stack'), ['Stack'])}
${imp(A + 'CustomerFilters.tsx', T('customer'), ['CustomerTier'], true)}

const TIERS: { value: CustomerTier | ''; label: string }[] = [
  { value: '', label: 'All Customers' },
  { value: 'standard', label: 'Standard' },
  { value: 'plus', label: 'Plus' },
  { value: 'enterprise', label: 'Enterprise' },
];

export function CustomerFilters({ tier, onTier }: { tier: string; onTier: (tier: string) => void }) {
  return (
    <Stack direction="row">
      <Select label="Customer tier" value={tier} onChange={(e: { target: { value: string } }) => onTier(e.target.value)}>
        {TIERS.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </Select>
    </Stack>
  );
}
`));
  add(A + 'CustomerExportButton.tsx', t(`
${imp(A + 'CustomerExportButton.tsx', UI('Button'), ['Button'])}
${imp(A + 'CustomerExportButton.tsx', U('csv'), ['toCsvRow'])}
${imp(A + 'CustomerExportButton.tsx', T('customer'), ['CustomerSummary'], true)}
${imp(A + 'CustomerExportButton.tsx', A + 'strings.ts', ['strings'])}

export function CustomerExportButton({ rows }: { rows: CustomerSummary[] }) {
  const download = () => {
    const csv = [toCsvRow(['Customer', 'Email', 'Tier']), ...rows.map((r) => toCsvRow([r.customerName, r.email, r.tier]))].join('\\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customers.csv';
    a.click();
  };
  return <Button onClick={download}>{strings.exportButton}</Button>;
}
`));
  add(A + 'CustomerDetail.tsx', t(`
${imp(A + 'CustomerDetail.tsx', UI('Drawer'), ['Drawer'])}
${imp(A + 'CustomerDetail.tsx', UI('Heading'), ['Heading'])}
${imp(A + 'CustomerDetail.tsx', UI('FormField'), ['FormField'])}
${imp(A + 'CustomerDetail.tsx', T('customer'), ['Customer'], true)}
${imp(A + 'CustomerDetail.tsx', U('money'), ['formatMoney'])}
${imp(A + 'CustomerDetail.tsx', U('address'), ['formatAddress'])}
${imp(A + 'CustomerDetail.tsx', A + 'CustomerNotes.tsx', ['CustomerNotes'])}
${imp(A + 'CustomerDetail.tsx', A + 'CustomerOrders.tsx', ['CustomerOrders'])}

export function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title="Customer details">
      <Heading>{customer.customerName}</Heading>
      <FormField label="Customer name">{customer.customerName}</FormField>
      <FormField label="Email">{customer.email}</FormField>
      <FormField label="Phone">{customer.phone ?? '—'}</FormField>
      <FormField label="Tier">{customer.tier}</FormField>
      <FormField label="Lifetime value">{formatMoney(customer.lifetimeValue)}</FormField>
      <FormField label="Billing address">{customer.billingAddress ? formatAddress(customer.billingAddress) : '—'}</FormField>
      <CustomerOrders customerId={customer.id} />
      <CustomerNotes customerId={customer.id} />
    </Drawer>
  );
}
`));
  add(A + 'CustomersPage.tsx', t(`
import { useState } from 'react';
${imp(A + 'CustomersPage.tsx', UI('Heading'), ['Heading'])}
${imp(A + 'CustomersPage.tsx', UI('Stack'), ['Stack'])}
${imp(A + 'CustomersPage.tsx', A + 'CustomerTable.tsx', ['CustomerTable'])}
${imp(A + 'CustomersPage.tsx', A + 'CustomerSearch.tsx', ['CustomerSearch'])}
${imp(A + 'CustomersPage.tsx', A + 'CustomerFilters.tsx', ['CustomerFilters'])}
${imp(A + 'CustomersPage.tsx', A + 'strings.ts', ['strings'])}

export function CustomersPage() {
  const [tier, setTier] = useState('');
  const [, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Stack>
      <Heading>{strings.pageTitle}</Heading>
      <Stack direction="row">
        <CustomerSearch onSearch={setSearch} />
        <CustomerFilters tier={tier} onTier={setTier} />
      </Stack>
      <CustomerTable onOpen={setOpenId} />
      {openId && <p className="sr-only">Customer {openId} selected</p>}
    </Stack>
  );
}
`));
  component(A + 'CustomerNotes.tsx', { customer: true, lines: 34 });
  component(A + 'CustomerOrders.tsx', { customer: true, lines: 52, uses: [{ path: T('order'), names: ['Order'], type: true }] });
  add(A + '__tests__/CustomerTable.test.tsx', t(`
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomerTable } from '../CustomerTable';

vi.mock('../useCustomers', () => ({
  useCustomers: () => ({ loading: false, rows: [{ id: 'c1', customerName: 'Ada Lovelace', email: 'ada@example.com', tier: 'plus' }] }),
}));

describe('CustomerTable', () => {
  it('shows the Customer column and one row', () => {
    render(<CustomerTable onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Sort by Customer' })).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });
});
`));
  add(A + '__tests__/columns.test.ts', t(`
import { describe, it, expect } from 'vitest';
import { columns } from '../columns';

describe('customer columns', () => {
  it('starts with the Customer name column', () => {
    expect(columns[0].header).toBe('Customer');
    expect(columns[0].key).toBe('customerName');
  });
});
`));

  const adminGroups = {
    orders: ['OrdersPage', 'OrderTable', 'OrderRow', 'OrderDetailPanel', 'OrderStatusBadge', 'OrderFilters', 'OrderSearch',
      'RefundDialog', 'OrderNotes', 'OrderTimeline', 'FulfillmentPanel', 'ShippingLabelButton', 'OrderExportButton',
      'OrderTotals', 'OrderLinesTable', 'PaymentStatus', 'FraudSignals', 'OrderAssignee', 'BulkActions'],
    products: ['ProductsPage', 'ProductTable', 'ProductRow', 'ProductEditor', 'PriceEditor', 'StockEditor', 'ImageManager',
      'VariantTable', 'CategoryPicker', 'PublishToggle', 'ProductFilters', 'ProductSearch', 'BulkPriceDialog', 'ProductHistory', 'SeoFields'],
    components: ['AdminShell', 'AdminNav', 'AdminTopBar', 'UserMenu', 'PermissionGate', 'ConfirmDialog', 'DataTable',
      'DataTableToolbar', 'DateRangePicker', 'KpiCard', 'ChartCard', 'ActivityFeed', 'CustomerPicker', 'CustomerLink',
      'CustomerAvatar', 'AuditTrail', 'NoteEditor', 'StatusPill', 'CopyButton', 'EmptyPanel', 'LoadingPanel', 'ErrorPanel',
      'Kbd', 'HelpTooltip', 'EnvironmentBanner'],
  };
  const adminCustomer = { orders: 0.6, products: 0, components: 0.12 };
  for (const [group, names] of Object.entries(adminGroups)) {
    for (const name of names) {
      const p = `apps/admin/${group}/${name}.tsx`;
      const customer = /^Customer/.test(name) || rnd() < adminCustomer[group];
      component(p, { customer, uses: group === 'orders' ? [{ path: T('order'), names: ['Order'], type: true }] : [] });
    }
  }
  add('apps/admin/orders/OrderCustomerCell.tsx', t(`
${imp('apps/admin/orders/OrderCustomerCell.tsx', T('order'), ['Order'], true)}
${imp('apps/admin/orders/OrderCustomerCell.tsx', 'apps/admin/components/CustomerLink.tsx', ['CustomerLink'])}

export function OrderCustomerCell({ order }: { order: Order }) {
  return (
    <td className="order-customer">
      <CustomerLink data={{ id: order.customerId }} customer={order.customer as never} />
      <span className="muted">{order.customer.customerName}</span>
    </td>
  );
}
`));
  add('apps/admin/main.tsx', t(`
import { createRoot } from 'react-dom/client';
import { AdminApp } from './App';

createRoot(document.getElementById('admin-root')!).render(<AdminApp />);
`));
  add('apps/admin/App.tsx', t(`
import { AdminShell } from './components/AdminShell';
import { CustomersPage } from './customers/CustomersPage';
import { OrdersPage } from './orders/OrdersPage';
import { ProductsPage } from './products/ProductsPage';
import { requireRole } from './auth';

const SCREENS = { customers: CustomersPage, orders: OrdersPage, products: ProductsPage };

export function AdminApp() {
  requireRole(['admin', 'support']);
  const key = (window.location.hash.slice(2) || 'customers') as keyof typeof SCREENS;
  const Screen = SCREENS[key] ?? CustomersPage;
  return <AdminShell data={{}}><Screen data={{}} customer={undefined as never} /></AdminShell>;
}
`));
  add('apps/admin/auth.ts', t(`
${imp('apps/admin/auth.ts', T('user'), ['User'], true)}

let current: User | null = null;

export function setUser(user: User) {
  current = user;
}

export function requireRole(roles: User['role'][]) {
  if (!current || !roles.includes(current.role)) {
    window.location.href = '/admin/login';
  }
}
`));

  // ----- services/api (~122) -----------------------------------------------------
  const entities = ['customers', 'orders', 'products', 'invoices', 'payments', 'shipments', 'discounts', 'subscriptions',
    'reviews', 'inventory', 'notifications', 'users', 'addresses', 'carts', 'refunds', 'regions', 'reports', 'webhooks',
    'sessions', 'exports'];
  const singular = (e) => (e === 'inventory' ? 'inventory' : e === 'addresses' ? 'address' : e.replace(/s$/, ''));
  const customerEntities = new Set(['customers', 'orders', 'invoices', 'subscriptions', 'reviews', 'carts', 'refunds', 'payments', 'reports', 'exports']);
  const S = 'services/api/';
  add(S + 'db.ts', t(`
import pg from 'pg';
${imp(S + 'db.ts', S + 'config.ts', ['config'])}

export const db = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolSize });

export async function one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await db.query(sql, params);
  return (rows[0] as T) ?? null;
}

export async function many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query(sql, params);
  return rows as T[];
}
`));
  add(S + 'config.ts', t(`
${imp(S + 'config.ts', U('env'), ['readEnv'])}

export const config = {
  port: Number(readEnv('PORT') ?? 4000),
  databaseUrl: readEnv('DATABASE_URL'),
  poolSize: Number(readEnv('DB_POOL_SIZE') ?? 10),
  jwtAudience: readEnv('JWT_AUDIENCE') ?? 'shop-api',
};
`));
  const models = entities.filter((e) => !['sessions', 'exports'].includes(e));
  for (const e of models) {
    const s = singular(e);
    const p = `${S}models/${s}.ts`;
    if (e === 'customers') {
      add(p, t(`
${imp(p, S + 'db.ts', ['one', 'many', 'db'])}
${imp(p, T('customer'), ['Customer', 'CustomerId', 'CustomerSummary'], true)}
${imp(p, T('pagination'), ['Pagination'], true)}

const COLUMNS = 'id, customer_name, email, phone, tier, lifetime_value, currency, created_at, updated_at, tags';

function fromRow(row: Record<string, any>): Customer {
  return {
    id: row.id,
    customerName: row.customer_name,
    email: row.email,
    phone: row.phone ?? undefined,
    tier: row.tier,
    shippingAddresses: [],
    lifetimeValue: { amount: Number(row.lifetime_value), currency: row.currency },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    tags: row.tags ?? [],
  };
}

export async function findCustomer(id: CustomerId): Promise<Customer | null> {
  const row = await one<Record<string, any>>(\`select \${COLUMNS} from customers where id = $1\`, [id]);
  return row ? fromRow(row) : null;
}

export async function listCustomers(page: Pick<Pagination, 'page' | 'pageSize'>, search = ''): Promise<CustomerSummary[]> {
  const rows = await many<Record<string, any>>(
    \`select \${COLUMNS} from customers where customer_name ilike $1 or email ilike $1 order by customer_name limit $2 offset $3\`,
    [\`%\${search}%\`, page.pageSize, (page.page - 1) * page.pageSize],
  );
  return rows.map(fromRow).map(({ id, customerName, email, tier }) => ({ id, customerName, email, tier }));
}

export async function updateCustomer(id: CustomerId, patch: Partial<Pick<Customer, 'customerName' | 'phone' | 'tags'>>) {
  await db.query('update customers set customer_name = coalesce($2, customer_name), phone = coalesce($3, phone), updated_at = now() where id = $1',
    [id, patch.customerName ?? null, patch.phone ?? null]);
  return findCustomer(id);
}
`));
      continue;
    }
    const lines = [imp(p, S + 'db.ts', ['one', 'many'])];
    const typeName = pascal(singular(e) === 'inventory' ? 'inventory' : singular(e));
    const typeFile = { refund: 'payment', report: null, webhook: null, session: null, export: null }[s] ?? s;
    if (typeFile && simpleTypes[typeFile]) lines.push(imp(p, T(typeFile), [pascal(typeFile)], true));
    if (customerEntities.has(e)) lines.push(imp(p, T('customer'), ['CustomerId'], true));
    if (e === 'orders' || e === 'reports') lines.push(imp(p, `${S}models/customer.ts`, ['findCustomer']));
    lines.push('', `const TABLE = '${e}';`, '');
    const target = size();
    lines.push(`export async function find${typeName}(id: string) {`, '  return one(`select * from ${TABLE} where id = $1`, [id]);', '}', '');
    if (customerEntities.has(e)) lines.push(`export async function list${pascal(e)}ForCustomer(customerId: CustomerId) {`, '  return many(`select * from ${TABLE} where customer_id = $1 order by created_at desc`, [customerId]);', '}', '');
    if (e === 'orders' || e === 'reports') lines.push(`export async function ${e === 'orders' ? 'orderWithCustomer' : 'customerReport'}(id: string) {`, `  const row = await find${typeName}(id) as { customer_id: string } | null;`, '  return row ? { ...row, customer: await findCustomer(row.customer_id as never) } : null;', '}', '');
    let k = 0;
    while (lines.length < target) {
      const field = camel(LABELS[k++ % LABELS.length]);
      lines.push(`export async function listBy${pascal(field)}${k > LABELS.length ? k : ''}(value: string, limit = 50) {`,
        `  return many(\`select * from \${TABLE} where ${kebab(field).replace(/-/g, '_')} = $1 limit $2\`, [value, limit]);`, '}', '');
    }
    add(p, lines.join('\n'));
  }
  const serializers = ['customer', 'order', 'invoice', 'subscription', 'product', 'payment', 'shipment', 'review', 'user', 'region'];
  for (const s of serializers) {
    const p = `${S}serializers/${s}.serializer.ts`;
    if (s === 'customer') {
      add(p, t(`
${imp(p, T('customer'), ['Customer', 'CustomerSummary'], true)}
${imp(p, U('money'), ['formatMoney'])}

export function serializeCustomer(c: Customer) {
  return {
    id: c.id,
    customerName: c.customerName,
    email: c.email,
    phone: c.phone ?? null,
    tier: c.tier,
    lifetimeValue: formatMoney(c.lifetimeValue),
    createdAt: c.createdAt,
    tags: c.tags,
  };
}

export function serializeCustomerSummary(c: CustomerSummary) {
  return { id: c.id, customerName: c.customerName, email: c.email, tier: c.tier };
}
`));
      continue;
    }
    const fields = simpleTypes[s] ?? [];
    const lines = [imp(p, T(s), [pascal(s)], true)];
    const refsCustomer = fields.some((f) => f.includes('CustomerSummary'));
    if (refsCustomer) lines.push(imp(p, `${S}serializers/customer.serializer.ts`, ['serializeCustomerSummary']));
    lines.push('', `export function serialize${pascal(s)}(x: ${pascal(s)}) {`, '  return {', '    id: x.id,');
    for (const f of fields) {
      const key = f.split(/\??:/)[0];
      lines.push(f.includes('CustomerSummary') ? `    ${key}: serializeCustomerSummary(x.${key}),` : `    ${key}: x.${key},`);
    }
    lines.push('  };', '}');
    add(p, lines.join('\n'));
  }
  const middleware = ['auth', 'cors', 'rate-limit', 'request-id', 'error-handler', 'validate', 'audit', 'metrics'];
  for (const m of middleware) {
    const p = `${S}middleware/${m}.ts`;
    const lines = ["import type { NextFunction, Request, Response } from 'express';"];
    if (m === 'audit') lines.push(imp(p, T('audit-log'), ['AuditLog'], true), imp(p, S + 'db.ts', ['db']));
    if (m === 'error-handler') lines.push(imp(p, U('errors'), ['toMessage']));
    if (m === 'auth') lines.push(imp(p, S + 'config.ts', ['config']));
    lines.push('', `export function ${camel(m)}(req: Request, res: Response, next: NextFunction) {`);
    const target = between(8, 40);
    while (lines.length < target) lines.push(`  res.locals.${camel(pick(LABELS))} ??= req.header('x-${kebab(camel(pick(LABELS)))}');`);
    lines.push('  next();', '}');
    add(p, lines.join('\n'));
  }
  for (const e of entities) {
    const s = singular(e);
    const cp = `${S}controllers/${e}.controller.ts`;
    const hasModel = models.includes(e);
    if (e === 'customers') {
      add(cp, t(`
import type { Request, Response } from 'express';
${imp(cp, `${S}models/customer.ts`, ['findCustomer', 'listCustomers', 'updateCustomer'])}
${imp(cp, `${S}serializers/customer.serializer.ts`, ['serializeCustomer', 'serializeCustomerSummary'])}
${imp(cp, T('customer'), ['CustomerId'], true)}
${imp(cp, U('validation'), ['required'])}

export async function list(req: Request, res: Response) {
  const page = Number(req.query.page ?? 1);
  const rows = await listCustomers({ page, pageSize: 50 }, String(req.query.search ?? ''));
  res.json(rows.map(serializeCustomerSummary));
}

export async function show(req: Request, res: Response) {
  const customer = await findCustomer(req.params.id as CustomerId);
  if (!customer) return res.status(404).json({ error: 'customer_not_found' });
  res.json(serializeCustomer(customer));
}

export async function update(req: Request, res: Response) {
  const { customerName, phone } = req.body as { customerName?: string; phone?: string };
  if (customerName !== undefined) required(customerName);
  const customer = await updateCustomer(req.params.id as CustomerId, { customerName, phone });
  res.json(customer ? serializeCustomer(customer) : null);
}
`));
    } else {
      const lines = ["import type { Request, Response } from 'express';"];
      if (hasModel) lines.push(imp(cp, `${S}models/${s}.ts`, [`find${pascal(s)}`]));
      if (serializers.includes(s)) lines.push(imp(cp, `${S}serializers/${s}.serializer.ts`, [`serialize${pascal(s)}`]));
      if (customerEntities.has(e)) lines.push(imp(cp, T('customer'), ['CustomerId'], true));
      if (['orders', 'reports', 'exports', 'invoices'].includes(e)) lines.push(imp(cp, `${S}models/customer.ts`, ['findCustomer']));
      lines.push(imp(cp, U('pagination'), ['pageCount']), '');
      lines.push('export async function show(req: Request, res: Response) {');
      lines.push(hasModel ? `  const row = await find${pascal(s)}(req.params.id);` : '  const row = { id: req.params.id };');
      lines.push("  if (!row) return res.status(404).json({ error: 'not_found' });");
      lines.push(serializers.includes(s) ? `  res.json(serialize${pascal(s)}(row as never));` : '  res.json(row);', '}', '');
      if (['orders', 'reports', 'exports', 'invoices'].includes(e)) {
        lines.push('export async function forCustomer(req: Request, res: Response) {',
          '  const customer = await findCustomer(req.params.customerId as CustomerId);',
          "  if (!customer) return res.status(404).json({ error: 'customer_not_found' });",
          '  res.json({ customer: customer.customerName, pages: pageCount(0, 50) });', '}', '');
      }
      const target = size();
      while (lines.length < target) {
        const f = camel(pick(LABELS));
        lines.push(`export async function by${pascal(f)}${lines.length}(req: Request, res: Response) {`,
          `  res.json({ ${f}: req.query.${f} ?? null, pages: pageCount(Number(req.query.total ?? 0), 50) });`, '}', '');
      }
      add(cp, lines.join('\n'));
    }
    const rp = `${S}routes/${e}.ts`;
    add(rp, t(`
import { Router } from 'express';
${imp(rp, cp, e === 'customers' ? ['list', 'show', 'update'] : ['show'])}
${imp(rp, `${S}middleware/auth.ts`, ['auth'])}
${imp(rp, `${S}middleware/validate.ts`, ['validate'])}

export const ${camel(e)}Routes = Router();

${e === 'customers' ? `${camel(e)}Routes.get('/', auth, list);\n` : ''}${camel(e)}Routes.get('/:id', auth, show);
${e === 'customers' ? `${camel(e)}Routes.patch('/:id', auth, validate, update);\n` : ''}`));
  }
  add(S + 'server.ts', [
    "import express from 'express';",
    imp(S + 'server.ts', S + 'config.ts', ['config']),
    ...middleware.map((m) => imp(S + 'server.ts', `${S}middleware/${m}.ts`, [camel(m)])),
    ...entities.map((e) => imp(S + 'server.ts', `${S}routes/${e}.ts`, [`${camel(e)}Routes`])),
    '',
    'export const app = express();',
    'app.use(express.json());',
    ...middleware.filter((m) => m !== 'error-handler').map((m) => `app.use(${camel(m)});`),
    ...entities.map((e) => `app.use('/api/${e}', ${camel(e)}Routes);`),
    'app.use(errorHandler);',
    '',
    'export function start() {',
    '  return app.listen(config.port);',
    '}',
  ].join('\n'));
  add(S + 'index.ts', `${imp(S + 'index.ts', S + 'server.ts', ['start'])}\n\nstart();`);

  // migrations (30)
  const migrations = [
    ['create_customers', 'create table customers (\n  id uuid primary key,\n  customer_name text not null,\n  email text not null unique,\n  phone text,\n  tier text not null default \'standard\',\n  lifetime_value bigint not null default 0,\n  currency char(3) not null default \'EUR\',\n  tags text[] not null default \'{}\',\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\ncreate index customers_customer_name_idx on customers (customer_name);'],
    ['create_addresses', 'create table addresses (\n  id uuid primary key,\n  customer_id uuid not null references customers(id),\n  line1 text not null,\n  line2 text,\n  city text not null,\n  postal_code text not null,\n  country char(2) not null\n);'],
  ];
  for (const e of entities.filter((x) => !['customers', 'addresses'].includes(x))) {
    migrations.push([`create_${e}`, `create table ${e} (\n  id uuid primary key,\n${customerEntities.has(e) ? '  customer_id uuid not null references customers(id),\n' : ''}  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);`]);
  }
  migrations.push(
    ['add_orders_status', "alter table orders add column status text not null default 'open';"],
    ['add_invoices_due_at', 'alter table invoices add column due_at timestamptz;'],
    ['add_products_sku_index', 'create unique index products_sku_idx on products (sku);'],
    ['add_customers_tags', "alter table customers alter column tags set default '{}';"],
    ['add_subscriptions_seats', 'alter table subscriptions add column seats integer not null default 1;'],
    ['add_reviews_rating_check', 'alter table reviews add constraint reviews_rating_check check (rating between 1 and 5);'],
    ['add_shipments_tracking', 'alter table shipments add column tracking text;'],
    ['add_payments_state', "alter table payments add column state text not null default 'pending';"],
    ['backfill_customer_tier', "update customers set tier = 'plus' where lifetime_value > 500000;"],
    ['add_orders_customer_index', 'create index orders_customer_id_idx on orders (customer_id);'],
    ['add_webhooks_secret', 'alter table webhooks add column secret text;'],
    ['add_regions_tax_rate', 'alter table regions add column tax_rate numeric(5, 4) not null default 0;'],
  );
  migrations.forEach(([name, sql], i) => add(`${S}migrations/${String(i + 1).padStart(4, '0')}_${name}.sql`, `-- ${name.replace(/_/g, ' ')}\n${sql}`));

  // api tests (12)
  add(`${S}tests/customers.controller.test.ts`, t(`
import { describe, it, expect, vi } from 'vitest';
${imp(`${S}tests/customers.controller.test.ts`, `${S}controllers/customers.controller.ts`, ['show', 'update'])}

vi.mock('../models/customer', () => ({
  findCustomer: vi.fn(async () => ({ id: 'c1', customerName: 'Ada Lovelace', email: 'ada@example.com', tier: 'plus', lifetimeValue: { amount: 0, currency: 'EUR' }, tags: [] })),
  updateCustomer: vi.fn(async (_id: string, patch: object) => ({ id: 'c1', customerName: 'Ada Lovelace', email: 'ada@example.com', tier: 'plus', lifetimeValue: { amount: 0, currency: 'EUR' }, tags: [], ...patch })),
  listCustomers: vi.fn(async () => []),
}));

const res = () => {
  const r: any = {};
  r.status = vi.fn(() => r);
  r.json = vi.fn((body: unknown) => (r.body = body));
  return r;
};

describe('customers controller', () => {
  it('shows a customer with their name', async () => {
    const r = res();
    await show({ params: { id: 'c1' } } as never, r);
    expect(r.body.customerName).toBe('Ada Lovelace');
    expect(r.body.email).toBe('ada@example.com');
  });

  it('updates the phone number', async () => {
    const r = res();
    await update({ params: { id: 'c1' }, body: { phone: '+44 20 7946 0000' } } as never, r);
    expect(r.body.phone).toBe('+44 20 7946 0000');
  });
});
`));
  for (const e of ['orders', 'products', 'invoices', 'payments', 'shipments', 'subscriptions', 'reviews', 'users', 'regions', 'carts', 'refunds']) {
    const p = `${S}tests/${e}.controller.test.ts`;
    add(p, t(`
import { describe, it, expect, vi } from 'vitest';
${imp(p, `${S}controllers/${e}.controller.ts`, ['show'])}

describe('${e} controller', () => {
  it('returns 404 for an unknown id', async () => {
    const r: any = { status: vi.fn(() => r), json: vi.fn() };
    await show({ params: { id: 'missing' } } as never, r);
    expect(r.json).toHaveBeenCalled();
  });
});
`));
  }

  // ----- services/worker (40) ---------------------------------------------------
  const W = 'services/worker/';
  add(W + 'config.ts', `${imp(W + 'config.ts', U('env'), ['readEnv'])}\n\nexport const config = {\n  redisUrl: readEnv('REDIS_URL') ?? 'redis://localhost:6379',\n  concurrency: Number(readEnv('WORKER_CONCURRENCY') ?? 4),\n};`);
  const queues = ['email', 'billing', 'exports', 'search', 'webhooks', 'maintenance'];
  for (const q of queues) {
    const p = `${W}queues/${q}.ts`;
    add(p, `${imp(p, W + 'config.ts', ['config'])}\n\nexport const ${camel(q)}Queue = {\n  name: '${q}',\n  url: config.redisUrl,\n  add: async (job: string, payload: unknown) => ({ job, payload }),\n};`);
  }
  const libs = ['mailer', 'templates', 'storage', 'metrics', 'locks', 'scheduler'];
  for (const l of libs) {
    const p = `${W}lib/${l}.ts`;
    const lines = [l === 'mailer' ? imp(p, U('email'), ['maskEmail']) : imp(p, U('logger'), ['log']), ''];
    const target = between(10, 60);
    lines.push(`export async function ${camel(l)}Run(input: Record<string, string>) {`);
    while (lines.length < target) lines.push(`  if (input.${camel(pick(LABELS))}) ${l === 'mailer' ? 'maskEmail' : 'log'}(input.${camel(pick(LABELS))});`);
    lines.push('  return input;', '}');
    add(p, lines.join('\n'));
  }
  const jobs = ['send-welcome-email', 'send-order-confirmation', 'send-invoice-reminder', 'send-shipping-update',
    'churn-report', 'customer-export', 'nightly-billing', 'retry-failed-payments', 'reindex-products', 'reindex-customers',
    'expire-carts', 'expire-discounts', 'sync-inventory', 'deliver-webhooks', 'cleanup-sessions', 'rollup-metrics',
    'renew-subscriptions', 'review-reminders', 'gdpr-erasure', 'weekly-digest'];
  const customerJobs = new Set(['send-welcome-email', 'send-order-confirmation', 'send-invoice-reminder', 'churn-report',
    'customer-export', 'reindex-customers', 'renew-subscriptions', 'review-reminders', 'gdpr-erasure', 'weekly-digest']);
  for (const j of jobs) {
    const p = `${W}jobs/${j}.ts`;
    const q = /email|confirmation|reminder|update|digest/.test(j) ? 'email' : /billing|payments|subscriptions/.test(j) ? 'billing'
      : /export|report/.test(j) ? 'exports' : /reindex/.test(j) ? 'search' : /webhooks/.test(j) ? 'webhooks' : 'maintenance';
    const lines = [imp(p, `${W}queues/${q}.ts`, [`${camel(q)}Queue`])];
    if (q === 'email') lines.push(imp(p, `${W}lib/mailer.ts`, ['mailerRun']));
    if (customerJobs.has(j)) lines.push(imp(p, T('customer'), ['Customer'], true), imp(p, U('names'), ['formatCustomerName']));
    lines.push('', `export async function ${camel(j)}(${customerJobs.has(j) ? 'customers: Customer[]' : 'ids: string[]'}) {`);
    lines.push(`  for (const item of ${customerJobs.has(j) ? 'customers' : 'ids'}) {`);
    if (customerJobs.has(j)) lines.push('    const name = formatCustomerName(item);');
    lines.push(`    await ${camel(q)}Queue.add('${j}', ${customerJobs.has(j) ? '{ id: item.id, name }' : 'item'});`);
    const target = size();
    while (lines.length < target - 2) lines.push(`    // step: ${pick(['load', 'validate', 'render', 'send', 'record', 'retry'])} ${pick(LABELS).toLowerCase()}`);
    lines.push('  }', '}');
    add(p, lines.join('\n'));
  }
  add(W + 'index.ts', [...jobs.slice(0, 8).map((j) => imp(W + 'index.ts', `${W}jobs/${j}.ts`, [camel(j)])), '',
    `export const handlers = { ${jobs.slice(0, 8).map((j) => camel(j)).join(', ')} };`].join('\n'));
  for (const j of ['send-welcome-email', 'churn-report', 'nightly-billing', 'deliver-webhooks', 'gdpr-erasure', 'expire-carts']) {
    const p = `${W}tests/${j}.test.ts`;
    add(p, t(`
import { describe, it, expect } from 'vitest';
${imp(p, `${W}jobs/${j}.ts`, [camel(j)])}

describe('${j}', () => {
  it('handles an empty batch', async () => {
    await expect(${camel(j)}([])).resolves.toBeUndefined();
  });
});
`));
  }

  // ----- infra (40), workflows (5), docs (30), e2e tests (20), root ---------------
  const tfRoot = ['main', 'variables', 'outputs', 'providers', 'backend', 'versions'];
  for (const n of tfRoot) {
    add(`infra/terraform/${n}.tf`, {
      main: 'module "network" {\n  source = "./modules/network"\n  cidr   = var.vpc_cidr\n}\n\nmodule "database" {\n  source     = "./modules/database"\n  subnet_ids = module.network.private_subnet_ids\n}\n\nmodule "cluster" {\n  source     = "./modules/cluster"\n  subnet_ids = module.network.private_subnet_ids\n}',
      variables: 'variable "region" {\n  type    = string\n  default = "eu-west-1"\n}\n\nvariable "vpc_cidr" {\n  type    = string\n  default = "10.20.0.0/16"\n}\n\nvariable "environment" {\n  type = string\n}',
      outputs: 'output "cluster_name" {\n  value = module.cluster.name\n}\n\noutput "database_endpoint" {\n  value     = module.database.endpoint\n  sensitive = true\n}',
      providers: 'provider "aws" {\n  region = var.region\n  default_tags {\n    tags = { project = "shop", environment = var.environment }\n  }\n}',
      backend: 'terraform {\n  backend "s3" {\n    bucket = "shop-terraform-state"\n    key    = "platform/terraform.tfstate"\n    region = "eu-west-1"\n  }\n}',
      versions: 'terraform {\n  required_version = ">= 1.6"\n  required_providers {\n    aws = { source = "hashicorp/aws", version = "~> 5.60" }\n  }\n}',
    }[n]);
  }
  for (const m of ['network', 'database', 'cache', 'cluster', 'cdn', 'dns', 'storage']) {
    add(`infra/terraform/modules/${m}/main.tf`, `resource "aws_${m === 'cluster' ? 'eks_cluster' : m === 'database' ? 'db_instance' : m === 'cache' ? 'elasticache_cluster' : m === 'cdn' ? 'cloudfront_distribution' : m === 'dns' ? 'route53_zone' : m === 'storage' ? 's3_bucket' : 'vpc'}" "this" {\n  # ${m} for the shop platform\n  tags = { module = "${m}" }\n}`);
    add(`infra/terraform/modules/${m}/variables.tf`, `variable "subnet_ids" {\n  type    = list(string)\n  default = []\n}`);
  }
  const k8sApps = ['web', 'admin', 'api', 'worker'];
  for (const a of k8sApps) {
    add(`infra/k8s/${a}-deployment.yaml`, `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop-${a}\n  namespace: shop\nspec:\n  replicas: ${a === 'api' ? 4 : 2}\n  selector:\n    matchLabels:\n      app: shop-${a}\n  template:\n    metadata:\n      labels:\n        app: shop-${a}\n    spec:\n      containers:\n        - name: ${a}\n          image: registry.example.com/shop-${a}:latest\n          envFrom:\n            - configMapRef:\n                name: shop-${a}-config\n          resources:\n            requests:\n              cpu: 250m\n              memory: 256Mi`);
    add(`infra/k8s/${a}-service.yaml`, `apiVersion: v1\nkind: Service\nmetadata:\n  name: shop-${a}\n  namespace: shop\nspec:\n  selector:\n    app: shop-${a}\n  ports:\n    - port: 80\n      targetPort: ${a === 'api' ? 4000 : 3000}`);
    add(`infra/k8s/${a}-hpa.yaml`, `apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: shop-${a}\n  namespace: shop\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: shop-${a}\n  minReplicas: 2\n  maxReplicas: ${a === 'api' ? 12 : 6}`);
    add(`infra/k8s/${a}-configmap.yaml`, a === 'admin'
      ? 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: shop-admin-config\n  namespace: shop\ndata:\n  ADMIN_API_URL: "http://shop-api/api"\n  CUSTOMER_EXPORT_HEADER: "Customer name,Email,Tier"\n  CUSTOMER_PAGE_SIZE: "50"\n  SESSION_TIMEOUT_MINUTES: "30"'
      : `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: shop-${a}-config\n  namespace: shop\ndata:\n  LOG_LEVEL: "info"\n  NODE_ENV: "production"`);
  }
  for (const n of ['namespace', 'ingress', 'network-policy', 'pod-disruption-budget']) {
    add(`infra/k8s/${n}.yaml`, `apiVersion: ${n === 'ingress' ? 'networking.k8s.io/v1' : n === 'network-policy' ? 'networking.k8s.io/v1' : n === 'namespace' ? 'v1' : 'policy/v1'}\nkind: ${pascal(n).replace('Pod', 'Pod')}\nmetadata:\n  name: shop${n === 'namespace' ? '' : '-' + n}\n${n === 'namespace' ? '' : '  namespace: shop\n'}`);
  }
  for (const wf of ['ci', 'deploy-web', 'deploy-api', 'e2e', 'release']) {
    add(`.github/workflows/${wf}.yml`, `name: ${wf}\n\non:\n  ${wf === 'ci' || wf === 'e2e' ? 'pull_request:' : 'push:\n    branches: [main]'}\n\njobs:\n  ${wf}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm turbo run ${wf === 'ci' ? 'lint typecheck test' : wf === 'e2e' ? 'e2e' : 'build'}`);
  }
  const docs = {
    admin: ['customers', 'orders', 'products', 'permissions', 'exports', 'refunds', 'bulk-actions', 'keyboard-shortcuts'],
    api: ['customers', 'orders', 'products', 'invoices', 'payments', 'webhooks', 'authentication', 'pagination', 'errors', 'rate-limits'],
    architecture: ['overview', 'monorepo', 'data-model', 'events', 'caching', 'decisions'],
    runbooks: ['deploy', 'rollback', 'database-migrations', 'incident-response', 'on-call', 'queue-backlog'],
  };
  for (const [section, pages] of Object.entries(docs)) {
    for (const pg of pages) {
      const p = `docs/${section}/${pg}.md`;
      if (p === 'docs/admin/customers.md') {
        add(p, t(`
# Admin: Customers

The **Customers** screen (\`apps/admin/customers/\`) lists every customer account.

## Table columns

| Column | Source field | Notes |
|---|---|---|
| Customer | \`customerName\` | Sortable. Click to open the Customer details drawer. |
| Email | \`email\` | Sortable. |
| Tier | \`tier\` | Standard, Plus or Enterprise. |

## Export

"Export Customer list" downloads a CSV with the header \`Customer name,Email,Tier\`
(configured by \`CUSTOMER_EXPORT_HEADER\` in \`infra/k8s/admin-configmap.yaml\`).
`));
        continue;
      }
      if (p === 'docs/api/customers.md') {
        add(p, t(`
# API: Customers

\`GET /api/customers/:id\` returns a customer.

\`\`\`json
{
  "id": "c_01H8Z",
  "customerName": "Ada Lovelace",
  "email": "ada@example.com",
  "phone": null,
  "tier": "plus",
  "lifetimeValue": "€1,204.00",
  "createdAt": "2024-02-01T09:00:00.000Z",
  "tags": ["beta"]
}
\`\`\`

\`PATCH /api/customers/:id\` accepts \`customerName\` and \`phone\`.

Partner integrations read \`customerName\`; renaming it is a breaking change and needs a new API version.
`));
        continue;
      }
      const lines = [`# ${pascal(section)}: ${pg.replace(/-/g, ' ')}`, ''];
      const target = between(6, 60);
      while (lines.length < target) {
        lines.push(`${pick(['The', 'Each', 'Every', 'This'])} ${pick(LABELS).toLowerCase()} ${pick(['is stored per account', 'is validated by the API', 'is shown in the admin', 'is synced nightly', 'is part of the public contract'])}.`, '');
      }
      add(p, lines.join('\n'));
    }
  }
  const e2e = ['home', 'search', 'product', 'cart', 'checkout-guest', 'checkout-signed-in', 'account-profile',
    'account-addresses', 'orders', 'returns', 'reviews', 'admin-login', 'admin-customers', 'admin-orders',
    'admin-products', 'admin-refunds', 'admin-exports', 'gift-cards', 'newsletter', 'help-center'];
  for (const s of e2e) {
    const p = `tests/e2e/${s}.spec.ts`;
    if (s === 'admin-customers') {
      add(p, t(`
import { test, expect } from '@playwright/test';

test('admin customers table lists customers', async ({ page }) => {
  await page.goto('/admin/#/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort by Customer' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Customer Ada Lovelace' }).click();
  await expect(page.getByText('Customer details')).toBeVisible();
});
`));
      continue;
    }
    add(p, t(`
import { test, expect } from '@playwright/test';

test('${s.replace(/-/g, ' ')}', async ({ page }) => {
  await page.goto('/${s.startsWith('admin') ? 'admin/#/' + s.slice(6) : s}');
  await expect(page).toHaveTitle(/Shop/);
});
`));
  }
  add('package.json', t(`
{
  "name": "shop-platform",
  "private": true,
  "packageManager": "pnpm@9.7.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "e2e": "playwright test tests/e2e",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "@playwright/test": "^1.46.0",
    "turbo": "^2.0.12",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
`));
  add('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'services/*'\n  - 'packages/*'");
  add('turbo.json', '{\n  "$schema": "https://turbo.build/schema.json",\n  "tasks": {\n    "build": { "dependsOn": ["^build"] },\n    "test": {},\n    "lint": {}\n  }\n}');
  add('tsconfig.base.json', '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "jsx": "react-jsx",\n    "strict": true\n  }\n}');
  add('.gitignore', 'node_modules/\ndist/\n.turbo/\ncoverage/');
  add('README.md', t(`
# Shop platform

Monorepo for the storefront (\`apps/web\`), the back office (\`apps/admin\`), the API
(\`services/api\`) and background jobs (\`services/worker\`). Shared code lives in
\`packages/\`: \`types\` (domain types used everywhere), \`utils\` and \`ui\`.

Changing a type in \`packages/types\` changes every app and service that imports it.
`));
  return F;
}

// Customer -> Client rename applied by the scripted agent.
const toClient = (s) => s
  .replace(/customerName/g, 'clientName')
  .replace(/customer_name/g, 'client_name')
  .replace(/'Customer/g, "'Client")
  .replace(/"Customer/g, '"Client')
  .replace(/Customer name/g, 'Client name')
  .replace(/ Customer /g, ' Client ')
  .replace(/Customer details/g, 'Client details');

function monorepoScale(dir) {
  const repo = new Repo(dir);
  repo.writeAll(monorepoBaseline());
  repo.commit(MAINTAINER, '2026-09-10T09:00:00+00:00', 'Shop platform monorepo snapshot');
  repo.branch('agent/adm-310-client-rename');
  const A = 'apps/admin/customers/';

  // 1. The admin table itself (inside the fence).
  for (const f of ['columns.ts', 'CustomerRow.tsx', 'CustomerTable.tsx']) repo.edit(A + f, toClient);
  repo.commit(AGENT, '2026-09-11T10:02:00+00:00', 'Rename Customer column to Client in admin customers table');

  // 2. Labels across the admin customer screen (inside the fence).
  for (const f of ['strings.ts', 'CustomerBadge.tsx', 'CustomerSearch.tsx', 'CustomerFilters.tsx', 'CustomerExportButton.tsx',
    'CustomerDetail.tsx', 'CustomersPage.tsx', 'useCustomers.ts']) {
    repo.edit(A + f, (s) => toClient(s)
      .replace(/Customers'/g, "Clients'")
      .replace(/'Customers/g, "'Clients")
      .replace(/"Customers/g, '"Clients')
      .replace(/Customer list/g, 'Client list')
      .replace(/No Customer/g, 'No Client')
      .replace(/Customer since/g, 'Client since')
      .replace(/All Customers/g, 'All Clients')
      .replace(/Search Customers/g, 'Search Clients')
      .replace(/by Customer name/g, 'by Client name')
      .replace(/Customer tier/g, 'Client tier')
      .replace(/Plus Customer/g, 'Plus Client')
      .replace(/Customer \{openId\}/g, 'Client {openId}')
      .replace(/customers\.csv/g, 'clients.csv'));
  }
  repo.commit(AGENT, '2026-09-11T10:07:00+00:00', 'Rename Customer labels across admin customer views');

  // 3. Shared type (outside: imported by web, admin, API and worker).
  repo.edit('packages/types/customer.ts', (s) => s
    .replace('  customerName: string;\n  email: string;\n  phone?: string;',
      '  clientName: string;\n  /** @deprecated use clientName */\n  customerName?: string;\n  email: string;\n  phone?: string;')
    .replace('  customerName: string;\n  email: string;\n  tier: CustomerTier;',
      '  clientName: string;\n  /** @deprecated use clientName */\n  customerName?: string;\n  email: string;\n  tier: CustomerTier;')
    + '\n/** Admin-facing names (ADM-310). */\nexport type Client = Customer;\nexport type ClientSummary = CustomerSummary;\n');
  repo.edit('packages/types/index.ts', (s) => s + "export type { Client, ClientSummary } from './customer';\n");
  repo.edit('packages/utils/names.ts', (s) => s
    .replace("Pick<Customer, 'customerName' | 'email'>", "Pick<Customer, 'clientName' | 'email'>")
    .replace('return c.customerName?.trim() || c.email;', 'return c.clientName?.trim() || c.email;'));
  repo.commit(AGENT, '2026-09-11T10:13:00+00:00', 'Rename customerName to clientName in shared Customer type');

  // 4. Fix type errors downstream (outside: admin orders + API).
  repo.edit('apps/admin/orders/OrderCustomerCell.tsx', toClient);
  repo.edit('services/api/models/customer.ts', toClient);
  repo.edit('services/api/controllers/customers.controller.ts', toClient);
  repo.edit('services/api/serializers/customer.serializer.ts', toClient);
  repo.commit(AGENT, '2026-09-11T10:19:00+00:00', 'Fix type errors after clientName rename');

  // 5. Database column follows the type (outside: new migration).
  repo.write('services/api/migrations/0031_rename_customer_name_to_client_name.sql', t(`
-- rename customer name to client name (ADM-310)
alter table customers rename column customer_name to client_name;
alter index customers_customer_name_idx rename to customers_client_name_idx;
`));
  repo.commit(AGENT, '2026-09-11T10:24:00+00:00', 'Add migration renaming customer_name to client_name');

  // 6. Export header in the admin configmap (outside: infra).
  repo.edit('infra/k8s/admin-configmap.yaml', toClient);
  repo.commit(AGENT, '2026-09-11T10:28:00+00:00', 'Update admin export header in configmap');

  // 7. Docs.
  repo.edit('docs/admin/customers.md', (s) => toClient(s)
    .replace('"Export Customer list"', '"Export Client list"'));
  repo.edit('docs/api/customers.md', toClient);
  repo.commit(AGENT, '2026-09-11T10:31:00+00:00', 'Update docs for Client naming');

  // 8. Tests follow the rename (inside and outside the fence).
  for (const f of [A + '__tests__/CustomerTable.test.tsx', A + '__tests__/columns.test.ts',
    'services/api/tests/customers.controller.test.ts', 'tests/e2e/admin-customers.spec.ts']) {
    repo.edit(f, (s) => toClient(s).replace(/Sort by Customer/g, 'Sort by Client').replace(/Open Customer/g, 'Open Client')
      .replace(/the Customer column/g, 'the Client column').replace(/the Customer name column/g, 'the Client name column'));
  }
  repo.commit(AGENT, '2026-09-11T10:36:00+00:00', 'Update tests for Client rename');

  return repo.shas();
}

// ===========================================================================
// 3. clean-pass — PAY-17 · Fix rounding in checkout total
// ===========================================================================

function cleanPassBaseline() {
  const F = new Map();
  const add = (p, s) => F.set(p, t(s));
  add('package.json', `
{
  "name": "corner-shop",
  "version": "1.8.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "server": "tsx server/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
`);
  add('tsconfig.json', `
{
  "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true },
  "include": ["src", "server", "tests"]
}
`);
  add('README.md', `
# Corner Shop

A small web shop: product catalog, cart and checkout.

- \`src/products/\` — catalog
- \`src/cart/\` — cart state and UI
- \`src/checkout/\` — totals, tax, shipping and the checkout screen
- \`src/shared/\` — money helpers used everywhere
- \`server/\` — order and product API
`);
  add('.github/workflows/ci.yml', `
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
`);
  add('src/shared/money.ts', `
// Prices are numbers in major units (e.g. 12.5 = €12.50).
export type Money = number;

export function toCents(amount: Money): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): Money {
  return cents / 100;
}

export function formatMoney(amount: Money, currency = 'EUR', locale = 'en-IE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}
`);
  add('src/shared/format.ts', `
export function pluralize(n: number, word: string): string {
  return n === 1 ? \`\${n} \${word}\` : \`\${n} \${word}s\`;
}

export function truncate(text: string, max = 80): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
`);
  add('src/shared/http.ts', `
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(\`GET \${url} failed: \${res.status}\`);
  return res.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(\`POST \${url} failed: \${res.status}\`);
  return res.json() as Promise<T>;
}
`);
  add('src/cart/cartStore.ts', `
import type { Money } from '../shared/money';

export interface CartLine {
  sku: string;
  title: string;
  unitPrice: Money;
  quantity: number;
  weightKg: number;
}

let lines: CartLine[] = [];
const listeners = new Set<() => void>();

export const cart = {
  lines: () => lines,
  add(line: CartLine) {
    const existing = lines.find((l) => l.sku === line.sku);
    lines = existing
      ? lines.map((l) => (l.sku === line.sku ? { ...l, quantity: l.quantity + line.quantity } : l))
      : [...lines, line];
    listeners.forEach((fn) => fn());
  },
  remove(sku: string) {
    lines = lines.filter((l) => l.sku !== sku);
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
`);
  add('src/cart/useCart.ts', `
import { useSyncExternalStore } from 'react';
import { cart } from './cartStore';

export function useCart() {
  return useSyncExternalStore(cart.subscribe, cart.lines);
}
`);
  add('src/cart/CartItem.tsx', `
import { formatMoney } from '../shared/money';
import { cart, type CartLine } from './cartStore';

export function CartItem({ line }: { line: CartLine }) {
  return (
    <li className="cart-item">
      <span>{line.title}</span>
      <span>× {line.quantity}</span>
      <span>{formatMoney(line.unitPrice * line.quantity)}</span>
      <button onClick={() => cart.remove(line.sku)} aria-label={\`Remove \${line.title}\`}>✕</button>
    </li>
  );
}
`);
  add('src/cart/Cart.tsx', `
import { useCart } from './useCart';
import { CartItem } from './CartItem';
import { pluralize } from '../shared/format';

export function Cart() {
  const lines = useCart();
  if (lines.length === 0) return <p>Your cart is empty.</p>;
  return (
    <section className="cart">
      <h2>{pluralize(lines.length, 'item')} in your cart</h2>
      <ul>
        {lines.map((l) => (
          <CartItem key={l.sku} line={l} />
        ))}
      </ul>
      <a className="btn" href="/checkout">Go to checkout</a>
    </section>
  );
}
`);
  add('src/products/catalog.ts', `
import { getJson } from '../shared/http';
import type { Money } from '../shared/money';

export interface Product {
  sku: string;
  title: string;
  description: string;
  price: Money;
  weightKg: number;
  image: string;
}

export const fetchProducts = () => getJson<Product[]>('/api/products');
export const fetchProduct = (sku: string) => getJson<Product>(\`/api/products/\${sku}\`);
`);
  add('src/products/ProductCard.tsx', `
import { formatMoney } from '../shared/money';
import { truncate } from '../shared/format';
import { cart } from '../cart/cartStore';
import type { Product } from './catalog';

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card">
      <img src={product.image} alt="" />
      <h3>{product.title}</h3>
      <p>{truncate(product.description)}</p>
      <strong>{formatMoney(product.price)}</strong>
      <button onClick={() => cart.add({ sku: product.sku, title: product.title, unitPrice: product.price, quantity: 1, weightKg: product.weightKg })}>
        Add to cart
      </button>
    </article>
  );
}
`);
  add('src/products/ProductList.tsx', `
import { useEffect, useState } from 'react';
import { fetchProducts, type Product } from './catalog';
import { ProductCard } from './ProductCard';

export function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    fetchProducts().then(setProducts);
  }, []);
  return (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard key={p.sku} product={p} />
      ))}
    </div>
  );
}
`);
  add('src/products/ProductPage.tsx', `
import { useEffect, useState } from 'react';
import { fetchProduct, type Product } from './catalog';
import { formatMoney } from '../shared/money';

export function ProductPage({ sku }: { sku: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => {
    fetchProduct(sku).then(setProduct);
  }, [sku]);
  if (!product) return <p>Loading…</p>;
  return (
    <main className="product-page">
      <h1>{product.title}</h1>
      <p>{product.description}</p>
      <strong>{formatMoney(product.price)}</strong>
    </main>
  );
}
`);
  add('src/checkout/tax.ts', `
import type { Money } from '../shared/money';

// VAT rates by shipping region.
const RATES: Record<string, number> = { IE: 0.23, DE: 0.19, FR: 0.2, NL: 0.21, none: 0 };

export function taxFor(net: Money, region: string): Money {
  return net * (RATES[region] ?? 0);
}
`);
  add('src/checkout/shipping.ts', `
import type { Money } from '../shared/money';
import type { CartLine } from '../cart/cartStore';

const BASE: Record<string, Money> = { IE: 4.95, DE: 6.95, FR: 6.95, NL: 5.95, none: 0 };
const PER_KG = 0.85;
const FREE_FROM = 60;

export function shippingFor(lines: CartLine[], region: string): Money {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (subtotal >= FREE_FROM || region === 'none') return 0;
  const kg = lines.reduce((s, l) => s + l.weightKg * l.quantity, 0);
  return (BASE[region] ?? BASE.IE) + Math.max(0, kg - 1) * PER_KG;
}
`);
  add('src/checkout/discounts.ts', `
import type { Money } from '../shared/money';

const CODES: Record<string, { percent?: number; amount?: Money }> = {
  WELCOME10: { percent: 10 },
  FIVEOFF: { amount: 5 },
};

export function applyDiscounts(subtotal: Money, codes: string[]): Money {
  let discount = 0;
  for (const code of codes) {
    const d = CODES[code.toUpperCase()];
    if (!d) continue;
    discount += d.percent ? (subtotal * d.percent) / 100 : d.amount ?? 0;
  }
  return Math.min(discount, subtotal);
}
`);
  add('src/checkout/total.ts', `
import type { Money } from '../shared/money';
import type { CartLine } from '../cart/cartStore';
import { taxFor } from './tax';
import { shippingFor } from './shipping';
import { applyDiscounts } from './discounts';

export interface CheckoutTotal {
  subtotal: Money;
  discount: Money;
  tax: Money;
  shipping: Money;
  total: Money;
}

export function checkoutTotal(lines: CartLine[], region: string, codes: string[] = []): CheckoutTotal {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discount = applyDiscounts(subtotal, codes);
  const tax = taxFor(subtotal - discount, region);
  const shipping = shippingFor(lines, region);
  // Truncate to cents for display.
  const total = Math.floor((subtotal - discount + tax + shipping) * 100) / 100;
  return { subtotal, discount, tax, shipping, total };
}
`);
  add('src/checkout/CheckoutSummary.tsx', `
import { formatMoney } from '../shared/money';
import type { CheckoutTotal } from './total';

export function CheckoutSummary({ totals }: { totals: CheckoutTotal }) {
  return (
    <dl className="checkout-summary">
      <dt>Subtotal</dt>
      <dd>{formatMoney(totals.subtotal)}</dd>
      {totals.discount > 0 && (
        <>
          <dt>Discount</dt>
          <dd>−{formatMoney(totals.discount)}</dd>
        </>
      )}
      <dt>VAT</dt>
      <dd>{formatMoney(totals.tax)}</dd>
      <dt>Shipping</dt>
      <dd>{totals.shipping === 0 ? 'Free' : formatMoney(totals.shipping)}</dd>
      <dt className="total">Total</dt>
      <dd className="total">{formatMoney(totals.total)}</dd>
    </dl>
  );
}
`);
  add('src/checkout/PaymentForm.tsx', `
import { useState } from 'react';
import { postJson } from '../shared/http';
import type { CheckoutTotal } from './total';

export function PaymentForm({ totals, onPaid }: { totals: CheckoutTotal; onPaid: (orderId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    const { orderId } = await postJson<{ orderId: string }>('/api/orders', { total: totals.total });
    onPaid(orderId);
  };
  return (
    <button className="btn primary" disabled={busy} onClick={pay}>
      {busy ? 'Paying…' : 'Pay now'}
    </button>
  );
}
`);
  add('src/checkout/CheckoutPage.tsx', `
import { useState } from 'react';
import { useCart } from '../cart/useCart';
import { checkoutTotal } from './total';
import { CheckoutSummary } from './CheckoutSummary';
import { PaymentForm } from './PaymentForm';

export function CheckoutPage() {
  const lines = useCart();
  const [region, setRegion] = useState('IE');
  const [code, setCode] = useState('');
  const totals = checkoutTotal(lines, region, code ? [code] : []);
  return (
    <main className="checkout">
      <h1>Checkout</h1>
      <label>
        Ship to
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="IE">Ireland</option>
          <option value="DE">Germany</option>
          <option value="FR">France</option>
          <option value="NL">Netherlands</option>
        </select>
      </label>
      <label>
        Discount code
        <input value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <CheckoutSummary totals={totals} />
      <PaymentForm totals={totals} onPaid={(id) => (window.location.href = \`/orders/\${id}\`)} />
    </main>
  );
}
`);
  add('src/App.tsx', `
import { ProductList } from './products/ProductList';
import { ProductPage } from './products/ProductPage';
import { Cart } from './cart/Cart';
import { CheckoutPage } from './checkout/CheckoutPage';

export function App() {
  const path = window.location.pathname;
  if (path.startsWith('/products/')) return <ProductPage sku={path.split('/')[2]} />;
  if (path === '/cart') return <Cart />;
  if (path === '/checkout') return <CheckoutPage />;
  return <ProductList />;
}
`);
  add('src/main.tsx', `
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
`);
  add('server/db.ts', `
export interface Row {
  [key: string]: unknown;
}

const tables = new Map<string, Row[]>([
  ['products', []],
  ['orders', []],
]);

export const db = {
  all: (table: string) => tables.get(table) ?? [],
  insert: (table: string, row: Row) => {
    tables.get(table)?.push(row);
    return row;
  },
};
`);
  const PRODUCTS = [['mug-stoneware', 'Stoneware mug', 14.5, 0.4], ['tea-sencha', 'Sencha green tea 100g', 8.95, 0.12],
    ['tea-earl-grey', 'Earl Grey 100g', 7.5, 0.12], ['kettle-copper', 'Copper kettle', 64, 1.3], ['teapot-glass', 'Glass teapot', 29.99, 0.8],
    ['cups-set', 'Espresso cups, set of 4', 24.005, 0.6], ['beans-house', 'House blend beans 250g', 9.99, 0.25],
    ['grinder-hand', 'Hand grinder', 49.5, 0.7], ['filter-papers', 'Filter papers x100', 4.25, 0.1], ['dripper-ceramic', 'Ceramic dripper', 22, 0.5],
    ['scale-kitchen', 'Kitchen scale', 34.95, 0.6], ['tin-storage', 'Storage tin', 12.005, 0.3], ['honey-wild', 'Wild honey 340g', 11.4, 0.45],
    ['biscuits-oat', 'Oat biscuits', 3.95, 0.2], ['tray-oak', 'Oak serving tray', 39, 1.1], ['towel-linen', 'Linen tea towel', 9.5, 0.15],
    ['gift-card-25', 'Gift card €25', 25, 0], ['coasters-cork', 'Cork coasters x6', 6.75, 0.1]];
  add('server/seed/products.json', `
[
${PRODUCTS.map(([sku, title, price, kg]) => `  {
    "sku": "${sku}",
    "title": "${title}",
    "description": "${title} from our spring range.",
    "price": ${price},
    "weightKg": ${kg},
    "image": "/img/${sku}.jpg"
  }`).join(',\n')}
]
`);
  add('server/routes/products.ts', `
import { Router } from 'express';
import { db } from '../db';

export const products = Router();

products.get('/', (_req, res) => res.json(db.all('products')));
products.get('/:sku', (req, res) => {
  const product = db.all('products').find((p) => p.sku === req.params.sku);
  if (!product) return res.status(404).json({ error: 'not_found' });
  res.json(product);
});
`);
  add('server/routes/orders.ts', `
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db';

export const orders = Router();

orders.post('/', (req, res) => {
  const order = db.insert('orders', { id: randomUUID(), total: req.body.total, createdAt: new Date().toISOString() });
  res.status(201).json({ orderId: order.id });
});
`);
  add('server/index.ts', `
import express from 'express';
import { products } from './routes/products';
import { orders } from './routes/orders';

const app = express();
app.use(express.json());
app.use('/api/products', products);
app.use('/api/orders', orders);
app.listen(Number(process.env.PORT ?? 3000));
`);
  add('tests/checkout/total.test.ts', `
import { describe, it, expect } from 'vitest';
import { checkoutTotal } from '../../src/checkout/total';

const line = (unitPrice: number, quantity = 1) => ({ sku: 's' + unitPrice, title: 'Item', unitPrice, quantity, weightKg: 0.5 });

describe('checkoutTotal', () => {
  it('adds lines, tax and shipping', () => {
    const t = checkoutTotal([line(10, 2)], 'IE');
    expect(t.subtotal).toBe(20);
    expect(t.shipping).toBe(4.95);
    expect(t.total).toBe(29.55);
  });

  it('applies a percentage discount before tax', () => {
    const t = checkoutTotal([line(100)], 'none', ['WELCOME10']);
    expect(t.discount).toBe(10);
    expect(t.total).toBe(90);
  });
});
`);
  add('tests/checkout/tax.test.ts', `
import { describe, it, expect } from 'vitest';
import { taxFor } from '../../src/checkout/tax';

describe('taxFor', () => {
  it('uses the regional VAT rate', () => {
    expect(taxFor(100, 'DE')).toBeCloseTo(19);
  });
  it('is zero for unknown regions', () => {
    expect(taxFor(100, 'XX')).toBe(0);
  });
});
`);
  add('tests/checkout/shipping.test.ts', `
import { describe, it, expect } from 'vitest';
import { shippingFor } from '../../src/checkout/shipping';

describe('shippingFor', () => {
  it('is free from 60 euro', () => {
    expect(shippingFor([{ sku: 'a', title: 'A', unitPrice: 60, quantity: 1, weightKg: 1 }], 'IE')).toBe(0);
  });
});
`);
  add('tests/cart/cartStore.test.ts', `
import { describe, it, expect } from 'vitest';
import { cart } from '../../src/cart/cartStore';

describe('cart', () => {
  it('merges quantities for the same sku', () => {
    cart.add({ sku: 'a', title: 'A', unitPrice: 1, quantity: 1, weightKg: 0 });
    cart.add({ sku: 'a', title: 'A', unitPrice: 1, quantity: 2, weightKg: 0 });
    expect(cart.lines()[0].quantity).toBe(3);
  });
});
`);
  add('tests/products/catalog.test.ts', `
import { describe, it, expect, vi } from 'vitest';
import { fetchProducts } from '../../src/products/catalog';

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ sku: 'a' }] })));

describe('fetchProducts', () => {
  it('returns the product list', async () => {
    expect(await fetchProducts()).toEqual([{ sku: 'a' }]);
  });
});
`);
  add('tests/shared/money.test.ts', `
import { describe, it, expect } from 'vitest';
import { toCents, fromCents } from '../../src/shared/money';

describe('money', () => {
  it('round-trips cents', () => {
    expect(fromCents(toCents(12.34))).toBe(12.34);
  });
});
`);
  return F;
}

function cleanPass(dir) {
  const repo = new Repo(dir);
  repo.writeAll(cleanPassBaseline());
  repo.commit(MAINTAINER, '2026-09-18T09:00:00+00:00', 'Corner Shop 1.8.2');
  repo.branch('agent/pay-17-checkout-rounding');

  // 1. Round in integer cents, half up, instead of truncating a float.
  repo.edit('src/checkout/total.ts', (s) => s
    .replace("import type { Money } from '../shared/money';", "import { fromCents, type Money } from '../shared/money';")
    .replace(`  // Truncate to cents for display.
  const total = Math.floor((subtotal - discount + tax + shipping) * 100) / 100;
  return { subtotal, discount, tax, shipping, total };`,
    `  // Sum in whole cents, rounding each part half up, so 10.005 becomes 10.01 (not 10.00).
  const cents = roundCents(subtotal) - roundCents(discount) + roundCents(tax) + roundCents(shipping);
  return {
    subtotal: fromCents(roundCents(subtotal)),
    discount: fromCents(roundCents(discount)),
    tax: fromCents(roundCents(tax)),
    shipping: fromCents(roundCents(shipping)),
    total: fromCents(cents),
  };
}

// Half-up rounding to whole cents that is safe for binary floats (1.005 * 100 = 100.49999…).
function roundCents(amount: Money): number {
  return Math.round(Number((amount * 100).toFixed(6)));`));
  repo.commit(AGENT, '2026-09-19T11:04:00+00:00', 'Round checkout total half up in whole cents');

  // 2. Add tests for half-cent totals (only additions; nothing loosened).
  repo.edit('tests/checkout/total.test.ts', (s) => s.replace(/\}\);\n$/, `
  it('rounds half-cent totals up', () => {
    const t = checkoutTotal([line(10.005)], 'none');
    expect(t.total).toBe(10.01);
  });

  it('does not lose a cent to float error', () => {
    const t = checkoutTotal([line(1.005), line(0.1), line(0.2)], 'none');
    expect(t.total).toBe(1.31);
    expect(t.subtotal).toBe(1.31);
  });
});
`));
  repo.commit(AGENT, '2026-09-19T11:09:00+00:00', 'Add checkout total tests for half-cent amounts');

  return repo.shas();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const BUILDERS = { 'infra-drift': infraDrift, 'monorepo-scale': monorepoScale, 'clean-pass': cleanPass };

/**
 * The team keeps working after the task (so none of the task's SHAs change): a teammate's pull request lands on
 * main, and another branch is open. With `overlap`, the teammate edits a file the task also changed, so a merge may
 * conflict there; without it, the two never touch the same file.
 */
function meanwhile(dir, { base, head }, { overlap }) {
  const env = gitEnv();
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const task = git('rev-parse', '--abbrev-ref', 'HEAD');
  const t0 = Date.parse(git('log', '-1', '--format=%cI', head));
  let n = 0;
  const commit = (message) => {
    const date = new Date(t0 - 40 * 60e3 + (n++) * 7 * 60e3).toISOString(); // during the task
    Object.assign(env, { GIT_AUTHOR_NAME: 'Sample Teammate', GIT_AUTHOR_EMAIL: 'teammate@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: 'Sample Teammate', GIT_COMMITTER_EMAIL: 'teammate@example.com', GIT_COMMITTER_DATE: date });
    git('add', '-A');
    git('-c', 'user.name=Sample Teammate', '-c', 'user.email=teammate@example.com', 'commit', '-q', '-m', message);
  };
  const append = (p, line) => fs.appendFileSync(path.join(dir, p), line + '\n');
  const note = (p) => (/\.(tsx?|jsx?|mjs|cjs)$/.test(p) ? '// ' : /\.(ya?ml|tf|sh|py|toml)$/.test(p) ? '# ' : /\.md$/.test(p) ? '' : null);
  git('checkout', '-q', 'main');
  const changed = git('diff', '--name-only', '--diff-filter=M', base, head).split('\n').filter((p) => p && note(p) != null && !/test|spec/.test(p));
  const shared = overlap ? changed[0] : null;
  if (shared) append(shared, `${note(shared)}Reviewed for the release checklist.`);
  else { fs.mkdirSync(path.join(dir, 'docs'), { recursive: true }); append('docs/CHANGELOG.md', '- Release notes for the next version.'); }
  commit(shared ? `Release checklist notes (#${40 + n})` : `Start the changelog (#${40 + n})`);
  git('checkout', '-q', '-b', 'feature/onboarding-copy');
  fs.mkdirSync(path.join(dir, 'docs', 'onboarding'), { recursive: true });
  append('docs/onboarding/welcome.md', '# Welcome');
  commit('Draft onboarding welcome page');
  append('docs/onboarding/welcome.md', 'Start with the README, then run the tests.');
  commit('Onboarding: first steps');
  git('checkout', '-q', task);
  return { base, head };
}
const MEANWHILE = { 'infra-drift': { overlap: true }, 'monorepo-scale': { overlap: true }, 'clean-pass': { overlap: false } };

/** Create example `id` in `dir` (must be empty or missing). Returns { base, head }. */
export function makeExample(id, dir) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`unknown example: ${id} (known: ${EXAMPLES.join(', ')})`);
  return meanwhile(dir, build(dir), MEANWHILE[id]);
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log('usage: node samples/examples/make-examples.mjs [out-dir] [--only id,id]\n\nCreates one git repository per example in <out-dir>/<id> (default: a new temp dir).');
    process.exit(0);
  }
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args[onlyAt + 1].split(',') : EXAMPLES;
  const positional = args.filter((a, i) => !a.startsWith('--') && (onlyAt < 0 || i !== onlyAt + 1));
  const out = path.resolve(positional[0] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-examples-')));
  try {
    for (const id of only) {
      const dir = path.join(out, id);
      const { base, head } = makeExample(id, dir);
      console.log(`${id} BASE=${base} HEAD=${head} DIR=${dir}`);
    }
  } catch (err) {
    console.error(`make-examples: ${err.stderr?.toString().trim() || err.message}`);
    process.exit(1);
  }
}
