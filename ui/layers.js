// layers.js — what role a file plays, shared by the tree and the city.
//
// Five layers, top to bottom, the way the tree stacks them:
//   ui      Screens          what users see: components, pages, views, styles, templates   (the canopy)
//   logic   App logic        shared helpers, hooks, state, types, client code              (the branches around the trunk)
//   test    Tests            checks that hold everything up                                (the ground)
//   server  Server & data    API, services, controllers, models, database, workers         (the roots)
//   infra   Infra & config   env files, build and CI, deploy, dependencies, docs           (the bedrock)
//
// Deterministic path rules; an audit may set file.layer to override. The older file.surface flag still works
// (true → ui). A feature folder (district) takes the layer most of its files have.

export const LAYERS = [
  { id: 'ui', name: 'Screens', hint: 'what users see', zone: 'Screens' },
  { id: 'logic', name: 'App logic', hint: 'shared code, state, helpers', zone: 'App logic' },
  { id: 'test', name: 'Tests', hint: 'the checks everything stands on', zone: 'Tests' },
  { id: 'server', name: 'Server & data', hint: 'API, services, database', zone: 'Server & data' },
  { id: 'infra', name: 'Infra & config', hint: 'env, build, CI, deploy, docs', zone: 'Infra & config' },
];
export const LAYER = Object.fromEntries(LAYERS.map((l, i) => [l.id, { ...l, order: i }]));

const TEST = /(^|\/)(__tests__|tests?|spec|specs|e2e|cypress|playwright)\/|[._-](spec|test)\.[a-z]+$/i;
const INFRA_DIR = /(^|\/)(\.github|\.circleci|\.gitlab|\.husky|\.devcontainer|\.vscode|infra|infrastructure|terraform|k8s|kubernetes|helm|charts|deploy|deployment|ops|docker|ansible|config|configs|env|docs?|scripts?|tools?|bin)\//i;
const INFRA_FILE = /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*|compose\.ya?ml|Makefile|Procfile|Jenkinsfile|\.env[^/]*|[^/]*\.(tf|tfvars|hcl|ya?ml|toml|ini|cfg|conf|lock|md|mdx|txt|rst|sh|ps1)|package(-lock)?\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|tsconfig[^/]*\.json|jsconfig\.json|(vite|webpack|rollup|babel|jest|vitest|playwright|next|nuxt|svelte|astro|tailwind|postcss|eslint|prettier)\.config\.[cm]?[jt]s|\.eslintrc[^/]*|\.prettierrc[^/]*|\.editorconfig|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.node-version|renovate\.json|LICENSE[^/]*)$/i;
const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|styl|erb|hbs|ejs|njk|twig|liquid|pug)$/i;
const UI_DIR = /(^|\/)(components?|pages?|views?|screens?|ui|templates?|layouts?|public|static|assets|styles?|widgets?|frontend|client|web|app\/routes)\//i;
const SERVER_DIR = /(^|\/)(api|server|backend|services?|controllers?|routes?|handlers?|resolvers?|graphql|models?|entities|db|database|prisma|migrations?|seeds?|repositories|workers?|jobs|queues?|cron|lambdas?|functions)\//i;
const LOGIC_DIR = /(^|\/)(shared|common|utils?|helpers?|lib|libs|core|hooks|state|store|stores|context|types|constants|theme|i18n|domain|features?)\//i;
const CODE = /\.(m?[jt]s|cjs|py|go|rb|java|kt|rs|php|cs|swift|scala|ex|exs|clj)$/i;

/** Layer id of a file. */
export function layerOf(f) {
  if (f.layer && LAYER[f.layer]) return f.layer;
  if (typeof f.surface === 'boolean' && f.surface) return 'ui';
  const p = f.path;
  if (f.isTest || TEST.test(p)) return 'test';
  if (UI_EXT.test(p) && !INFRA_DIR.test(p)) return 'ui';
  if (INFRA_FILE.test(p) || INFRA_DIR.test(p) || /(^|\/)(config|env)\.[cm]?[jt]s$/i.test(p)) return 'infra';
  if (SERVER_DIR.test(p)) return 'server';
  if (UI_DIR.test(p)) return 'ui';
  if (LOGIC_DIR.test(p) || CODE.test(p)) return 'logic';
  return 'infra';
}

/** Env and secret-ish files get a key mark: a change there changes how every environment runs. */
export const isEnv = (f) => /(^|\/)\.env[^/]*$|(^|\/)(env|config)\.[cm]?[jt]s$|(^|\/)(secrets?|configmap)[^/]*$/i.test(f.path);

export const interest = (f) => (f.kind === 'out' ? 8 : f.kind === 'in' ? 5 : f.kind === 'affected' ? 3 : 0);

/** Layer of a folder: the one most of its files have; ties go to the layer with the most interesting files. */
export function districtLayer(files) {
  const n = new Map();
  for (const f of files) {
    const l = layerOf(f);
    const e = n.get(l) ?? { count: 0, score: 0 };
    e.count++; e.score += interest(f);
    n.set(l, e);
  }
  return [...n].sort((a, b) => b[1].count - a[1].count || b[1].score - a[1].score || LAYER[a[0]].order - LAYER[b[0]].order)[0][0];
}

const WRAPPER = /^(src|source|lib|app|apps|packages|modules|client|server|frontend|backend|web)$/i;
/** Display name of a district: `src/shared/utils/` → `shared/utils`, `./` → `project files`. */
export function sectionName(district) {
  if (!district || district === './') return 'project files';
  const parts = district.replace(/\/$/, '').split('/');
  while (parts.length > 1 && WRAPPER.test(parts[0])) parts.shift();
  return parts.join('/');
}


/** Shorten a name in the middle, keeping the extension: articles.se…izer.ts */
export const clipMid = (s, n) => {
  if (s.length <= n) return s;
  const tail = Math.min(7, Math.floor(n / 3));
  return s.slice(0, Math.max(1, n - 1 - tail)) + '…' + s.slice(-tail);
};

/** Compact line counts: 950 → "950", 12400 → "12.4k". */
export const lines = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Files that `path` imports, from the reverse graph every file carries (importedBy). */
export function importsOf(city) {
  const out = new Map(city.files.map((f) => [f.path, []]));
  for (const f of city.files) for (const by of f.importedBy ?? []) out.get(by)?.push(f.path);
  return out;
}
