#!/usr/bin/env bash
# make-sample-repo.sh <target-dir>
#
# Builds the GT-142 sample repository used by Overlook's tests and sample data
# (SPEC section 5): a small TypeScript/React reader app, one baseline commit,
# then six commits that imitate an agent working on brief GT-142
# ("Relative publish dates").
#
# IMPORTANT: the six commits below are SCRIPTED. They reproduce a typical
# scope-creep pattern for testing and demos. They are not the output of a real
# Bob run and must never be presented as one.
#
# Author, committer, dates and config are fixed, so the commit SHAs are the
# same on every machine. The script prints BASE=<sha> and HEAD=<sha> at the end.
#
# Regenerate the committed sample data (from the Overlook repo root):
#   tmp=$(mktemp -d) && samples/make-sample-repo.sh "$tmp/gt142-sample-app"
#   node engine/collect.mjs --repo "$tmp/gt142-sample-app" --base <BASE> --src . --out out/evidence.json
#   node engine/build-city.mjs --evidence out/evidence.json --audit samples/audit.sample.json --out samples/city.sample.json
#   node engine/pr-comment.mjs --city samples/city.sample.json --out samples/receipt.sample.md

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <target-dir>" >&2
  exit 2
fi
if [ -e "$TARGET" ] && { [ ! -d "$TARGET" ] || [ -n "$(ls -A "$TARGET")" ]; }; then
  echo "refusing: $TARGET exists and is not an empty directory" >&2
  exit 1
fi

mkdir -p "$TARGET"
cd "$TARGET"

# Ignore the machine's global/system git config (signing, hooks, templates)
# so the resulting SHAs are reproducible.
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export TZ=UTC

git init -q -b main

# commit <name> <email> <date> <message>
# Identity is set both as config and as environment, because GIT_AUTHOR_* /
# GIT_COMMITTER_* from the caller would otherwise override the config.
commit() {
  export GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2"
  export GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3"
  git add -A
  git -c user.name="$1" -c user.email="$2" -c commit.gpgsign=false \
      -c core.hooksPath=/dev/null commit -q -m "$4"
}
baseline() { commit "Sample Maintainer" "maintainer@example.com" "$@"; }
agent()    { commit "Sample Agent" "agent@example.com" "$@"; }

# write <path>: write stdin to <path>, creating folders as needed
write() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------

write package.json <<'EOF'
{
  "name": "reader-app",
  "version": "1.4.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
EOF

write tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src", "tests"]
}
EOF

write src/shared/utils/formatDate.ts <<'EOF'
export function formatDate(d: Date | string): string {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
EOF

write src/shared/utils/slugify.ts <<'EOF'
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
EOF

write src/articles/ArticlePreview.tsx <<'EOF'
import { slugify } from '../shared/utils/slugify';

interface ArticlePreviewProps {
  article: { title: string; description: string; author: string; publishedAt: string };
}

export function ArticlePreview({ article }: ArticlePreviewProps) {
  const published = new Date(article.publishedAt);
  return (
    <a className="article-preview" href={`/article/${slugify(article.title)}`}>
      <h2>{article.title}</h2>
      <p>{article.description}</p>
      <span className="author">{article.author}</span>
      <time dateTime={article.publishedAt}>{published.toDateString()}</time>
    </a>
  );
}
EOF

write src/articles/ArticleMeta.tsx <<'EOF'
interface ArticleMetaProps {
  author: string;
  publishedAt: string;
}

export function ArticleMeta({ author, publishedAt }: ArticleMetaProps) {
  const published = new Date(publishedAt);
  return (
    <div className="article-meta">
      <span className="author">{author}</span>
      <time dateTime={publishedAt}>Published {published.toDateString()}</time>
    </div>
  );
}
EOF

write src/articles/ArticleList.tsx <<'EOF'
import { ArticlePreview } from './ArticlePreview';

interface ArticleListProps {
  articles: { title: string; description: string; author: string; publishedAt: string }[];
}

export function ArticleList({ articles }: ArticleListProps) {
  if (articles.length === 0) return <p className="empty">No articles yet.</p>;
  return (
    <div className="article-list">
      {articles.map((a) => (
        <ArticlePreview key={a.title} article={a} />
      ))}
    </div>
  );
}
EOF

write src/comments/CommentCard.tsx <<'EOF'
import { formatDate } from '../shared/utils/formatDate';

interface CommentCardProps {
  comment: { id: string; author: string; body: string; createdAt: string };
}

export function CommentCard({ comment }: CommentCardProps) {
  return (
    <div className="comment-card">
      <p>{comment.body}</p>
      <footer>
        <span className="author">{comment.author}</span>
        <span className="date">Posted {formatDate(comment.createdAt)}</span>
      </footer>
    </div>
  );
}
EOF

write src/comments/CommentList.tsx <<'EOF'
import { CommentCard } from './CommentCard';

interface CommentListProps {
  comments: { id: string; author: string; body: string; createdAt: string }[];
}

export function CommentList({ comments }: CommentListProps) {
  return (
    <section className="comments">
      {comments.map((c) => (
        <CommentCard key={c.id} comment={c} />
      ))}
    </section>
  );
}
EOF

write src/profiles/ProfileArticles.tsx <<'EOF'
import { formatDate } from '../shared/utils/formatDate';

interface ProfileArticlesProps {
  articles: { slug: string; title: string; publishedAt: string }[];
}

export function ProfileArticles({ articles }: ProfileArticlesProps) {
  return (
    <ul className="profile-articles">
      {articles.map((a) => (
        <li key={a.slug}>
          <a href={`/article/${a.slug}`}>{a.title}</a>
          <span className="date">{formatDate(a.publishedAt)}</span>
        </li>
      ))}
    </ul>
  );
}
EOF

write src/profiles/ProfileHeader.tsx <<'EOF'
interface ProfileHeaderProps {
  username: string;
  bio: string;
  joinedAt: string;
}

export function ProfileHeader({ username, bio, joinedAt }: ProfileHeaderProps) {
  const joinedYear = new Date(joinedAt).getFullYear();
  return (
    <header className="profile-header">
      <h1>{username}</h1>
      <p>{bio}</p>
      <small>Member since {joinedYear}</small>
    </header>
  );
}
EOF

write src/api/articles.serializer.ts <<'EOF'
export interface ArticleRecord {
  slug: string;
  title: string;
  body: string;
  createdAt: Date;
  author: { username: string };
}

export function serializeArticle(article: ArticleRecord) {
  return {
    slug: article.slug,
    title: article.title,
    body: article.body,
    createdAt: article.createdAt.toISOString(),
    author: article.author.username,
  };
}
EOF

write src/api/articles.controller.ts <<'EOF'
import { serializeArticle, ArticleRecord } from './articles.serializer';

export interface ArticleStore {
  findBySlug(slug: string): Promise<ArticleRecord | null>;
  list(limit: number): Promise<ArticleRecord[]>;
}

export function articlesController(store: ArticleStore) {
  return {
    async show(slug: string) {
      const article = await store.findBySlug(slug);
      if (!article) return { status: 404, body: { error: 'article not found' } };
      return { status: 200, body: { article: serializeArticle(article) } };
    },
    async index(limit = 20) {
      const articles = await store.list(limit);
      return { status: 200, body: { articles: articles.map(serializeArticle), count: articles.length } };
    },
  };
}
EOF

write src/api/routes.ts <<'EOF'
import { articlesController, ArticleStore } from './articles.controller';

export function registerRoutes(router: { get: Function }, store: ArticleStore) {
  const articles = articlesController(store);
  router.get('/api/articles', () => articles.index());
  router.get('/api/articles/:slug', (req: { params: { slug: string } }) => articles.show(req.params.slug));
}
EOF

write src/auth/session.ts <<'EOF'
const KEY = 'reader.session';

export function saveToken(token: string): void {
  localStorage.setItem(KEY, token);
}

export function readToken(): string | null {
  return localStorage.getItem(KEY);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
}
EOF

write src/auth/LoginForm.tsx <<'EOF'
import { useState } from 'react';
import { saveToken } from './session';

export function LoginForm({ onLogin }: { onLogin: (token: string) => Promise<string> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    saveToken(await onLogin(`${email}:${password}`));
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Sign in</button>
    </form>
  );
}
EOF

write src/feed/FeedList.tsx <<'EOF'
import { ArticleList } from '../articles/ArticleList';
import { FeedTabs } from './FeedTabs';

interface FeedListProps {
  tab: 'global' | 'following';
  articles: { title: string; description: string; author: string; publishedAt: string }[];
  onTab: (tab: 'global' | 'following') => void;
}

export function FeedList({ tab, articles, onTab }: FeedListProps) {
  return (
    <main className="feed">
      <FeedTabs active={tab} onChange={onTab} />
      <ArticleList articles={articles} />
    </main>
  );
}
EOF

write src/feed/FeedTabs.tsx <<'EOF'
type Tab = 'global' | 'following';

export function FeedTabs({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const tabs: Tab[] = ['global', 'following'];
  return (
    <nav className="feed-tabs">
      {tabs.map((t) => (
        <button key={t} className={t === active ? 'active' : ''} onClick={() => onChange(t)}>
          {t === 'global' ? 'Global feed' : 'Your feed'}
        </button>
      ))}
    </nav>
  );
}
EOF

write src/settings/SettingsPage.tsx <<'EOF'
import { useState } from 'react';

export function SettingsPage({ initialBio, onSave }: { initialBio: string; onSave: (bio: string) => void }) {
  const [bio, setBio] = useState(initialBio);
  return (
    <section className="settings">
      <h1>Your settings</h1>
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
      <button onClick={() => onSave(bio)}>Update settings</button>
    </section>
  );
}
EOF

write tests/formatDate.spec.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { formatDate } from '../src/shared/utils/formatDate';

describe('formatDate', () => {
  it('formats a date as month, day and year', () => {
    expect(formatDate('2026-09-23T09:00:00Z')).toBe('Sep 23, 2026');
  });
});
EOF

write tests/slugify.spec.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { slugify } from '../src/shared/utils/slugify';

describe('slugify', () => {
  it('turns a title into a url slug', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
  });
});
EOF

baseline "2026-09-23T09:00:00+00:00" "Initial reader app"

# ---------------------------------------------------------------------------
# Scripted agent commits (imitate a Bob task on GT-142; not a real run)
# ---------------------------------------------------------------------------

# The agent works on its own branch; main stays at the baseline (branch names do not change SHAs).
git checkout -q -b agent/gt-142-relative-dates

# 1. New helper (added, outside the fence)
write src/shared/utils/relativeTime.ts <<'EOF'
const DAY = 24 * 60 * 60 * 1000;

export function relativeTime(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
EOF
agent "2026-09-26T10:02:00+00:00" "Add relativeTime helper"

# 2. Shared formatter now returns relative time by default (ripples into
#    comments/CommentCard.tsx and profiles/ProfileArticles.tsx)
write src/shared/utils/formatDate.ts <<'EOF'
import { relativeTime } from './relativeTime';
export function formatDate(d: Date | string, opts = { relative: true }): string {
  const date = new Date(d);
  if (opts.relative) return relativeTime(date);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
EOF
agent "2026-09-26T10:06:00+00:00" "Make formatDate return relative time by default"

# 3. Article list card (inside the fence)
write src/articles/ArticlePreview.tsx <<'EOF'
import { slugify } from '../shared/utils/slugify';
import { formatDate } from '../shared/utils/formatDate';

interface ArticlePreviewProps {
  article: { title: string; description: string; author: string; publishedAt: string };
}

export function ArticlePreview({ article }: ArticlePreviewProps) {
  return (
    <a className="article-preview" href={`/article/${slugify(article.title)}`}>
      <h2>{article.title}</h2>
      <p>{article.description}</p>
      <span className="author">{article.author}</span>
      <time dateTime={article.publishedAt} title={formatDate(article.publishedAt, { relative: false })}>
        {formatDate(article.publishedAt)}
      </time>
    </a>
  );
}
EOF
agent "2026-09-26T10:09:00+00:00" "Use formatDate in ArticlePreview"

# 4. Article page header (inside the fence)
write src/articles/ArticleMeta.tsx <<'EOF'
import { formatDate } from '../shared/utils/formatDate';

interface ArticleMetaProps {
  author: string;
  publishedAt: string;
}

export function ArticleMeta({ author, publishedAt }: ArticleMetaProps) {
  return (
    <div className="article-meta">
      <span className="author">{author}</span>
      <time dateTime={publishedAt} title={formatDate(publishedAt, { relative: false })}>
        Published {formatDate(publishedAt)}
      </time>
    </div>
  );
}
EOF
agent "2026-09-26T10:12:00+00:00" "Use formatDate in ArticleMeta"

# 5. Public API response gains a field (imported by api/articles.controller.ts)
write src/api/articles.serializer.ts <<'EOF'
import { relativeTime } from '../shared/utils/relativeTime';

export interface ArticleRecord {
  slug: string;
  title: string;
  body: string;
  createdAt: Date;
  author: { username: string };
}

export function serializeArticle(article: ArticleRecord) {
  return {
    slug: article.slug,
    title: article.title,
    body: article.body,
    createdAt: article.createdAt.toISOString(),
    relativeDate: relativeTime(article.createdAt),
    author: article.author.username,
  };
}
EOF
agent "2026-09-26T10:16:00+00:00" "Add relativeDate to article serializer"

# 6. Test rewritten so it passes with the new default
write tests/formatDate.spec.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { formatDate } from '../src/shared/utils/formatDate';

describe('formatDate', () => {
  it('formats a date as month, day and year', () => {
    expect(formatDate('2026-09-23T09:00:00Z')).toMatch(/ago|today/);
  });
});
EOF
agent "2026-09-26T10:19:00+00:00" "Update formatDate test for relative output"

TASK_HEAD="$(git rev-parse HEAD)"

# ---------------------------------------------------------------------------
# Meanwhile (after the task, so none of its SHAs change): the team keeps working.
# main gets a teammate's change to a file the task also changed (a merge may conflict there),
# and another branch works on profiles, which the task does not touch.
teammate() { commit "Sample Teammate" "teammate@example.com" "$@"; }
git checkout -q main
write src/articles/ArticlePreview.tsx <<'EOF'
import { slugify } from '../shared/utils/slugify';

interface ArticlePreviewProps {
  article: { title: string; description: string; author: string; publishedAt: string; readingMinutes?: number };
}

export function ArticlePreview({ article }: ArticlePreviewProps) {
  const published = new Date(article.publishedAt);
  return (
    <a className="article-preview" href={`/article/${slugify(article.title)}`}>
      <h2>{article.title}</h2>
      <p>{article.description}</p>
      <span className="author">{article.author}</span>
      <time dateTime={article.publishedAt}>{published.toDateString()}</time>
      {article.readingMinutes ? <span className="reading">{article.readingMinutes} min read</span> : null}
    </a>
  );
}
EOF
teammate "2026-09-26T10:08:00+00:00" "Show reading time on article cards (#141)"
git checkout -q -b feature/profile-avatars
write src/profiles/ProfileAvatar.tsx <<'EOF'
export function ProfileAvatar({ username, size = 32 }: { username: string; size?: number }) {
  return <img className="avatar" width={size} height={size} alt="" src={avatarUrl(username)} />;
}

export const avatarUrl = (username: string) => `/avatars/${encodeURIComponent(username)}.png`;
EOF
teammate "2026-09-26T10:11:00+00:00" "Add ProfileAvatar component"
write src/profiles/avatarSizes.ts <<'EOF'
export const AVATAR_SIZES = { small: 24, medium: 32, large: 96 } as const;
EOF
teammate "2026-09-26T10:14:00+00:00" "Add avatar sizes"
git checkout -q agent/gt-142-relative-dates

echo "BASE=$(git rev-list --max-parents=0 HEAD)"
echo "HEAD=$TASK_HEAD"
