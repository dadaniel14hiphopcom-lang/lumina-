import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileCode2,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Server,
  Shield,
  TrendingUp,
  Upload,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSocial } from '../context/SocialContext';
import { formatCompactCount, formatRelativeTime } from '../utils/time';
import { AvatarRing } from './AvatarRing';

type AdminTab = 'users' | 'integrations' | 'updates' | 'wordpress';

interface ServerOverview {
  state: {
    aws: {
      region: string;
      bucket: string;
      cloudFrontDomain: string;
      sesSender: string;
      s3Enabled: boolean;
      cloudFrontEnabled: boolean;
      sesEnabled: boolean;
      rekognitionEnabled: boolean;
      lastVerifiedAt: number | null;
    };
    supabase: {
      projectUrl: string;
      schemaName: string;
      autoSyncUsers: boolean;
      autoSyncPosts: boolean;
      rlsEnforced: boolean;
      lastVerifiedAt: number | null;
      lastStatus: string | null;
    };
    wordpress: {
      siteUrl: string;
      siteTitle: string;
      dbEngine: 'mariadb-11' | 'mysql-8';
      dbName: string;
      tablePrefix: string;
      phpVersion: '8.3' | '8.2';
      permalinks: string;
      sslEnabled: boolean;
      redisCache: boolean;
      disableXmlRpc: boolean;
      maintenanceMode: boolean;
      lastSyncedAt: number | null;
    };
    site: {
      version: string;
      channel: 'stable' | 'beta';
      announcementBanner: string;
      maintenanceMode: boolean;
      updateHistory: {
        id: string;
        version: string;
        source: 'upload' | 'remote';
        notes: string[];
        appliedAt: number;
      }[];
    };
  };
  envStatus: {
    awsCredentialsConfigured: boolean;
    awsRegionEnv: boolean;
    supabaseUrlEnv: boolean;
    supabaseKeysEnv: boolean;
    wordpressEnv: boolean;
  };
}

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseDate: string;
  changelog: string[];
}

interface WordPressPostPreview {
  id: number;
  title: string;
  link: string;
  date: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AdminPanelView() {
  const {
    users,
    posts,
    currentUser,
    toggleRestrictUser,
    toggleBoostUser,
    toggleVerifyUser,
    openProfile,
    showToast,
    setSiteMeta,
  } = useSocial();

  // Auth held strictly in React memory (never localStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    loading: boolean;
    claimed: boolean;
    envConfigured: boolean;
  }>({ loading: true, claimed: true, envConfigured: false });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard state
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Users tab state
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<
    'all' | 'verified' | 'boosted' | 'restricted'
  >('all');

  // Integrations test feedback
  const [awsTestStatus, setAwsTestStatus] = useState<string | null>(null);
  const [supabaseTestStatus, setSupabaseTestStatus] = useState<string | null>(null);
  const [wpTestStatus, setWpTestStatus] = useState<string | null>(null);
  const [wpSyncedPosts, setWpSyncedPosts] = useState<WordPressPostPreview[]>([]);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  // Updates tab state
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [downloadingCode, setDownloadingCode] = useState(false);
  const updateFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch('/api/admin/auth/status')
      .then((r) => r.json())
      .then((data: { claimed: boolean; envConfigured: boolean }) => {
        setAuthStatus({
          loading: false,
          claimed: Boolean(data.claimed),
          envConfigured: Boolean(data.envConfigured),
        });
      })
      .catch(() => {
        setAuthStatus({ loading: false, claimed: true, envConfigured: false });
      });
  }, []);

  const authFetch = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (adminToken) {
      headers.set('Authorization', `Bearer ${adminToken}`);
    }
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      setAdminToken(null);
      setAuthError('Sessão expirada. Entre novamente.');
    }
    return res;
  };

  const loadOverview = async (tokenOverride?: string) => {
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: {
          Authorization: `Bearer ${tokenOverride || adminToken || ''}`,
        },
      });
      if (res.ok) {
        const data = (await res.json()) as ServerOverview;
        setOverview(data);
        setSiteMeta({
          version: data.state.site.version,
          announcementBanner: data.state.site.announcementBanner,
          maintenanceMode: data.state.site.maintenanceMode,
        });
      }
    } finally {
      setLoadingOverview(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!authStatus.claimed) {
      if (passcodeInput.trim().length < 6) {
        setAuthError('Escolha uma senha de acesso com pelo menos 6 caracteres.');
        return;
      }
      if (passcodeInput !== confirmInput) {
        setAuthError('As senhas não conferem.');
        return;
      }
    }
    setAuthSubmitting(true);
    try {
      const endpoint = authStatus.claimed
        ? '/api/admin/auth/login'
        : '/api/admin/auth/claim';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Falha na autenticação.');
        return;
      }
      setAdminToken(data.token);
      setPasscodeInput('');
      setConfirmInput('');
      setAuthStatus((prev) => ({ ...prev, claimed: true }));
      await loadOverview(data.token);
    } catch {
      setAuthError('Erro de conexão com o servidor.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userFilter === 'verified' && !u.verified) return false;
      if (userFilter === 'boosted' && !u.boosted) return false;
      if (userFilter === 'restricted' && !u.restricted) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
      );
    });
  }, [users, userSearch, userFilter]);

  const userStats = useMemo(
    () => ({
      total: users.length,
      verified: users.filter((u) => u.verified).length,
      boosted: users.filter((u) => u.boosted).length,
      restricted: users.filter((u) => u.restricted).length,
    }),
    [users]
  );

  const saveIntegrations = async (
    patch: Partial<Pick<ServerOverview['state'], 'aws' | 'supabase' | 'wordpress'>>
  ) => {
    const res = await authFetch('/api/admin/integrations', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = (await res.json()) as { state: ServerOverview['state'] };
      setOverview((prev) => (prev ? { ...prev, state: data.state } : prev));
      showToast('Configurações salvas no servidor');
    } else {
      showToast('Não foi possível salvar as configurações');
    }
  };

  const testIntegration = async (
    provider: 'aws' | 'supabase' | 'wordpress',
    url?: string
  ) => {
    setTestingKey(provider);
    try {
      const res = await authFetch('/api/admin/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ provider, url }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        statusLabel?: string;
        error?: string;
        posts?: WordPressPostPreview[];
      };
      if (!res.ok) {
        const msg = data.error || 'Falha no teste de conexão';
        if (provider === 'supabase') setSupabaseTestStatus(msg);
        if (provider === 'wordpress') setWpTestStatus(msg);
        showToast(msg);
        return;
      }
      if (provider === 'aws') setAwsTestStatus(data.statusLabel || 'Conectado');
      if (provider === 'supabase') setSupabaseTestStatus(data.statusLabel || 'Conectado');
      if (provider === 'wordpress') {
        setWpTestStatus(data.statusLabel || 'Conectado');
        if (Array.isArray(data.posts)) setWpSyncedPosts(data.posts);
      }
      await loadOverview();
    } finally {
      setTestingKey(null);
    }
  };

  const handleDownloadProtected = async (url: string, fallbackName: string) => {
    setDownloadingCode(true);
    try {
      const res = await authFetch(url);
      if (!res.ok) {
        showToast('Erro ao gerar pacote para download');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      triggerBlobDownload(blob, match?.[1] || fallbackName);
      showToast('Download iniciado');
    } finally {
      setDownloadingCode(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await authFetch('/api/admin/updates/check');
      if (res.ok) {
        const data = (await res.json()) as UpdateCheckResult;
        setUpdateCheck(data);
        showToast(
          data.hasUpdate
            ? `Nova versão v${data.latestVersion} disponível`
            : 'O site já está na versão mais recente'
        );
      }
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleApplyRemoteUpdate = async () => {
    if (!updateCheck) return;
    setApplyingUpdate(true);
    try {
      const res = await authFetch('/api/admin/updates/apply', {
        method: 'POST',
        body: JSON.stringify({
          version: updateCheck.latestVersion,
          source: 'remote',
          notes: updateCheck.changelog,
          configPatch: {
            announcementBanner: `Lumina v${updateCheck.latestVersion} ativa.`,
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          site: ServerOverview['state']['site'];
        };
        setOverview((prev) =>
          prev ? { ...prev, state: { ...prev.state, site: data.site } } : prev
        );
        setSiteMeta({
          version: data.site.version,
          announcementBanner: data.site.announcementBanner,
          maintenanceMode: data.site.maintenanceMode,
        });
        setUpdateCheck((prev) =>
          prev ? { ...prev, currentVersion: data.site.version, hasUpdate: false } : prev
        );
        showToast(`Atualização v${data.site.version} aplicada`);
      }
    } finally {
      setApplyingUpdate(false);
    }
  };

  const handleUploadUpdateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setApplyingUpdate(true);
      const res = await authFetch('/api/admin/updates/apply', {
        method: 'POST',
        body: JSON.stringify({ ...parsed, source: 'upload' }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        site?: ServerOverview['state']['site'];
      };
      if (!res.ok || !data.site) {
        showToast(data.error || 'Arquivo de atualização inválido');
        return;
      }
      setOverview((prev) =>
        prev ? { ...prev, state: { ...prev.state, site: data.site! } } : prev
      );
      setSiteMeta({
        version: data.site.version,
        announcementBanner: data.site.announcementBanner,
        maintenanceMode: data.site.maintenanceMode,
      });
      showToast(`Pacote v${data.site.version} instalado com sucesso`);
    } catch {
      showToast('Envie um arquivo de atualização .json válido');
    } finally {
      setApplyingUpdate(false);
    }
  };

  const handleDownloadSupabaseSql = () => {
    const schema = overview?.state.supabase.schemaName || 'public';
    const sql = `-- Schema Supabase para Lumina Social
create table if not exists ${schema}.users (
  id text primary key,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  bio text default '',
  verified boolean default false,
  boosted boolean default false,
  restricted boolean default false,
  created_at timestamptz default now()
);

create table if not exists ${schema}.posts (
  id text primary key,
  author_id text references ${schema}.users(id) on delete cascade,
  caption text default '',
  location text,
  category text not null,
  aspect_ratio text default '4:5',
  is_reel boolean default false,
  media_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table ${schema}.users enable row level security;
alter table ${schema}.posts enable row level security;

create policy "Perfis públicos visíveis"
  on ${schema}.users for select
  using (not restricted);

create policy "Publicações de contas ativas"
  on ${schema}.posts for select
  using (true);
`;
    triggerBlobDownload(new Blob([sql], { type: 'text/sql' }), 'lumina-supabase-schema.sql');
    showToast('Schema SQL do Supabase baixado');
  };

  const handleDownloadAwsPolicy = () => {
    const bucket = overview?.state.aws.bucket || 'lumina-media-prod';
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'LuminaS3MediaAccess',
          Effect: 'Allow',
          Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
          Resource: [`arn:aws:s3:::${bucket}/uploads/*`],
        },
      ],
    };
    triggerBlobDownload(
      new Blob([JSON.stringify(policy, null, 2)], { type: 'application/json' }),
      `aws-iam-policy-${bucket}.json`
    );
    showToast('Política IAM da AWS baixada');
  };

  const handleExportWordPressWxr = () => {
    const siteUrl = overview?.state.wordpress.siteUrl || 'https://meudominio.com.br';
    const title = overview?.state.wordpress.siteTitle || 'Lumina Editorial WP';

    const itemsXml = posts
      .map((post) => {
        const author = users.find((u) => u.id === post.authorId);
        const pubDate = new Date(post.createdAt).toUTCString();
        const imgTag = post.media[0]?.url
          ? `<p><img src="${escapeXml(post.media[0].url)}" alt="${escapeXml(post.caption.slice(0, 60))}" /></p>`
          : '';
        return `  <item>
    <title>${escapeXml(post.caption.slice(0, 64) || `Publicação ${post.id}`)}</title>
    <pubDate>${pubDate}</pubDate>
    <dc:creator><![CDATA[${author?.username || 'admin'}]]></dc:creator>
    <content:encoded><![CDATA[${imgTag}<p>${escapeXml(post.caption)}</p>]]></content:encoded>
    <wp:post_id>${escapeXml(post.id.replace(/\D/g, '') || '1')}</wp:post_id>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
    <category domain="category" nicename="${escapeXml(post.category.toLowerCase())}">${escapeXml(post.category)}</category>
  </item>`;
      })
      .join('\n');

    const wxr = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>${escapeXml(title)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <language>pt-BR</language>
  <wp:wxr_version>1.2</wp:wxr_version>
${itemsXml}
</channel>
</rss>`;

    triggerBlobDownload(new Blob([wxr], { type: 'application/xml' }), 'lumina-wordpress-wxr.xml');
    showToast('Arquivo WXR (.xml) exportado para WordPress');
  };

  // Render Admin Auth Gate if not authenticated
  if (!adminToken) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-md items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-zinc-950 dark:text-white">
                Painel Administrativo
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {authStatus.claimed
                  ? 'Acesso protegido para moderação e infraestrutura'
                  : 'Primeiro acesso: defina a senha administrativa'}
              </p>
            </div>
          </div>

          {authStatus.loading ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              Verificando credenciais do servidor...
            </div>
          ) : (
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {authStatus.claimed ? 'Senha administrativa' : 'Nova senha administrativa'}
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <KeyRound className="h-4 w-4 text-zinc-400" />
                  <input
                    type="password"
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="h-11 flex-1 bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                  />
                </div>
              </label>

              {!authStatus.claimed && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Confirmar senha
                  </span>
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <Lock className="h-4 w-4 text-zinc-400" />
                    <input
                      type="password"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder="Repita a senha"
                      className="h-11 flex-1 bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
                    />
                  </div>
                </label>
              )}

              {authError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="h-11 w-full rounded-xl bg-zinc-950 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950"
              >
                {authSubmitting
                  ? 'Validando...'
                  : authStatus.claimed
                  ? 'Entrar no Painel'
                  : 'Definir Senha e Entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const state = overview?.state;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* Top Bar */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Lumina Admin · v{state?.site.version || '2.4.0'}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-white">
            Painel Administrativo e Infraestrutura
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadOverview()}
            disabled={loadingOverview}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-3.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
            <span>Atualizar dados</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminToken(null)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-100 px-3.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Bloquear painel</span>
          </button>
        </div>
      </header>

      {/* Segmented Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Seções administrativas"
        className="no-scrollbar mb-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
      >
        {[
          { id: 'users' as const, label: 'Usuários', icon: Shield },
          { id: 'integrations' as const, label: 'AWS & Supabase', icon: Database },
          { id: 'updates' as const, label: 'Atualizações do Site', icon: ArrowDownToLine },
          { id: 'wordpress' as const, label: 'WordPress Auto-Hospedado', icon: Server },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: USERS MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          {/* Metrics Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Contas registradas', value: userStats.total },
              { label: 'Com selo verificado', value: userStats.verified },
              { label: 'Perfis impulsionados', value: userStats.boosted },
              { label: 'Contas restritas', value: userStats.restricted },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{metric.label}</p>
                <p className="mt-1 text-2xl font-bold text-zinc-950 tabular-nums dark:text-white">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>

          {/* Search & Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Search className="h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Filtrar por @usuario ou nome..."
                className="h-10 flex-1 bg-transparent text-sm text-zinc-950 focus:outline-none dark:text-white"
              />
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
              {[
                { id: 'all' as const, label: 'Todos' },
                { id: 'verified' as const, label: 'Verificados' },
                { id: 'boosted' as const, label: 'Impulsionados' },
                { id: 'restricted' as const, label: 'Restritos' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setUserFilter(f.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    userFilter === f.id
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Users Table */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-4 py-3 font-semibold">Usuário</th>
                    <th className="px-4 py-3 font-semibold text-right">Seguidores</th>
                    <th className="px-4 py-3 font-semibold text-right">Posts</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {filteredUsers.map((user) => {
                    const userPostsCount = posts.filter((p) => p.authorId === user.id).length;
                    const statusParts: string[] = [];
                    statusParts.push(user.restricted ? 'Restrito' : 'Ativo');
                    if (user.verified) statusParts.push('Selo verificado');
                    if (user.boosted) statusParts.push('Impulsionado');

                    return (
                      <tr
                        key={user.id}
                        className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openProfile(user.id)}
                            className="flex items-center gap-3 text-left"
                          >
                            <AvatarRing
                              src={user.avatarUrl}
                              alt={user.username}
                              size="sm"
                              showOnlineIndicator={Boolean(user.isOnline)}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-zinc-950 hover:underline dark:text-white">
                                  @{user.username}
                                </span>
                                {user.verified && (
                                  <BadgeCheck className="h-4 w-4 text-sky-500" />
                                )}
                              </div>
                              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                {user.displayName}
                                {user.id === currentUser.id ? ' · Sessão atual' : ''}
                              </p>
                            </div>
                          </button>
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">
                          {formatCompactCount(user.followers.length)}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">
                          {userPostsCount}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-medium ${
                              user.restricted
                                ? 'text-rose-600 dark:text-rose-400'
                                : user.boosted
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {statusParts.join(' · ')}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleVerifyUser(user.id)}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                                user.verified
                                  ? 'border-sky-500/40 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                              }`}
                            >
                              <BadgeCheck className="h-3.5 w-3.5" />
                              <span>{user.verified ? 'Verificado' : 'Verificar'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleBoostUser(user.id)}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                                user.boosted
                                  ? 'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                              }`}
                            >
                              <TrendingUp className="h-3.5 w-3.5" />
                              <span>{user.boosted ? 'Impulsionado' : 'Impulsionar'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleRestrictUser(user.id)}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                                user.restricted
                                  ? 'border-rose-500/40 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                              }`}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              <span>{user.restricted ? 'Liberar' : 'Restringir'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AWS & SUPABASE INTEGRATIONS */}
      {activeTab === 'integrations' && state && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* AWS Card */}
          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Cloud className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                    Integração AWS Cloud
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    S3 Storage · CloudFront CDN · SES E-mail · Rekognition
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  overview?.envStatus.awsCredentialsConfigured
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {overview?.envStatus.awsCredentialsConfigured
                  ? 'Credenciais no servidor'
                  : 'Modo configuração'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Região AWS
                </span>
                <select
                  value={state.aws.region}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              aws: { ...prev.state.aws, region: e.target.value },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="sa-east-1">sa-east-1 (São Paulo)</option>
                  <option value="us-east-1">us-east-1 (N. Virginia)</option>
                  <option value="us-west-2">us-west-2 (Oregon)</option>
                  <option value="eu-west-1">eu-west-1 (Irlanda)</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Bucket Amazon S3
                </span>
                <input
                  type="text"
                  value={state.aws.bucket}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              aws: { ...prev.state.aws, bucket: e.target.value },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Domínio CloudFront CDN
                </span>
                <input
                  type="text"
                  value={state.aws.cloudFrontDomain}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              aws: { ...prev.state.aws, cloudFrontDomain: e.target.value },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Remetente Amazon SES
                </span>
                <input
                  type="email"
                  value={state.aws.sesSender}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              aws: { ...prev.state.aws, sesSender: e.target.value },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>
            </div>

            {/* AWS Service Toggles */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { key: 's3Enabled' as const, label: 'Amazon S3 Mídia' },
                { key: 'cloudFrontEnabled' as const, label: 'CloudFront CDN' },
                { key: 'sesEnabled' as const, label: 'Amazon SES E-mail' },
                { key: 'rekognitionEnabled' as const, label: 'Moderação Rekognition' },
              ].map((svc) => (
                <label
                  key={svc.key}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                >
                  <span>{svc.label}</span>
                  <input
                    type="checkbox"
                    checked={state.aws[svc.key]}
                    onChange={(e) =>
                      setOverview((prev) =>
                        prev
                          ? {
                              ...prev,
                              state: {
                                ...prev.state,
                                aws: { ...prev.state.aws, [svc.key]: e.target.checked },
                              },
                            }
                          : prev
                      )
                    }
                    className="h-4 w-4 accent-sky-600"
                  />
                </label>
              ))}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Chaves privadas (<code className="font-mono">AWS_ACCESS_KEY_ID</code> e{' '}
              <code className="font-mono">AWS_SECRET_ACCESS_KEY</code>) permanecem isoladas
              nas variáveis de ambiente do servidor.
            </p>

            {awsTestStatus && (
              <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {awsTestStatus}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => saveIntegrations({ aws: state.aws })}
                className="h-10 rounded-xl bg-zinc-950 px-4 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Salvar AWS
              </button>
              <button
                type="button"
                disabled={testingKey === 'aws'}
                onClick={() => testIntegration('aws')}
                className="h-10 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                {testingKey === 'aws' ? 'Verificando...' : 'Testar integração'}
              </button>
              <button
                type="button"
                onClick={handleDownloadAwsPolicy}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Política IAM (.json)</span>
              </button>
            </div>
          </section>

          {/* Supabase Card */}
          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Database className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                    Banco de Dados Supabase
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    PostgreSQL · Row Level Security · Sincronização REST
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  overview?.envStatus.supabaseKeysEnv
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {state.supabase.lastStatus || 'Pronto para conectar'}
              </span>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  URL do Projeto Supabase
                </span>
                <input
                  type="url"
                  value={state.supabase.projectUrl}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              supabase: {
                                ...prev.state.supabase,
                                projectUrl: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  placeholder="https://seu-projeto.supabase.co"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Schema PostgreSQL
                </span>
                <input
                  type="text"
                  value={state.supabase.schemaName}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              supabase: {
                                ...prev.state.supabase,
                                schemaName: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { key: 'autoSyncUsers' as const, label: 'Sincronizar usuários' },
                { key: 'autoSyncPosts' as const, label: 'Sincronizar posts' },
                { key: 'rlsEnforced' as const, label: 'Exigir RLS' },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                >
                  <span>{opt.label}</span>
                  <input
                    type="checkbox"
                    checked={state.supabase[opt.key]}
                    onChange={(e) =>
                      setOverview((prev) =>
                        prev
                          ? {
                              ...prev,
                              state: {
                                ...prev.state,
                                supabase: {
                                  ...prev.state.supabase,
                                  [opt.key]: e.target.checked,
                                },
                              },
                            }
                          : prev
                      )
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                </label>
              ))}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Chaves <code className="font-mono">SUPABASE_ANON_KEY</code> e{' '}
              <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> ficam protegidas
              no servidor (<code className="font-mono">.env</code>).
            </p>

            {supabaseTestStatus && (
              <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {supabaseTestStatus}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => saveIntegrations({ supabase: state.supabase })}
                className="h-10 rounded-xl bg-zinc-950 px-4 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Salvar Supabase
              </button>
              <button
                type="button"
                disabled={testingKey === 'supabase' || !state.supabase.projectUrl.trim()}
                onClick={() => testIntegration('supabase', state.supabase.projectUrl)}
                className="h-10 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-45 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                {testingKey === 'supabase' ? 'Testando...' : 'Testar conexão'}
              </button>
              <button
                type="button"
                onClick={handleDownloadSupabaseSql}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Baixar SQL + RLS</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: SITE UPDATES (CHECK, DOWNLOAD CODE, UPLOAD UPDATE FILE) */}
      {activeTab === 'updates' && state && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left 2 Columns: Check, Download Source Code, Upload Update */}
          <div className="space-y-6 lg:col-span-2">
            {/* Version & Remote Check */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Versão instalada no site
                  </p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-mono text-2xl font-bold text-zinc-950 tabular-nums dark:text-white">
                      v{state.site.version}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      Canal {state.site.channel}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={checkingUpdates}
                    onClick={handleCheckUpdates}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${checkingUpdates ? 'animate-spin' : ''}`}
                    />
                    <span>Buscar novas atualizações</span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingCode}
                    onClick={() =>
                      handleDownloadProtected(
                        '/api/admin/updates/download-code',
                        `lumina-source-v${state.site.version}.zip`
                      )
                    }
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <FileCode2 className="h-4 w-4" />
                    <span>
                      {downloadingCode ? 'Compactando...' : 'Baixar o código (.zip)'}
                    </span>
                  </button>
                </div>
              </div>

              {updateCheck && (
                <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`h-4 w-4 ${
                          updateCheck.hasUpdate ? 'text-sky-600' : 'text-emerald-600'
                        }`}
                      />
                      <span className="text-sm font-semibold text-zinc-950 dark:text-white">
                        {updateCheck.hasUpdate
                          ? `Atualização v${updateCheck.latestVersion} disponível (${updateCheck.releaseDate})`
                          : `Versão v${updateCheck.currentVersion} está atualizada`}
                      </span>
                    </div>
                    {updateCheck.hasUpdate && (
                      <button
                        type="button"
                        disabled={applyingUpdate}
                        onClick={handleApplyRemoteUpdate}
                        className="h-9 rounded-lg bg-sky-600 px-3.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {applyingUpdate ? 'Aplicando...' : 'Aplicar atualização'}
                      </button>
                    )}
                  </div>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
                    {updateCheck.changelog.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Upload Update Package */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                    Atualizar via arquivo de atualização
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Baixe o código fonte para editar localmente ou insira um pacote{' '}
                    <code className="font-mono">.json</code> de atualização validado pelo
                    servidor.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadProtected(
                      '/api/admin/updates/sample-package',
                      'lumina-update-2.5.0.json'
                    )
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar pacote exemplo (v2.5.0)</span>
                </button>
              </div>

              <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <Upload className="mb-2 h-6 w-6 text-zinc-500" />
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Inserir arquivo de atualização
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Aceita pacotes <code className="font-mono">lumina-update-*.json</code> com
                  versão semântica e notas da versão
                </p>
                <input
                  ref={updateFileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleUploadUpdateFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={applyingUpdate}
                  onClick={() => updateFileRef.current?.click()}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  <span>
                    {applyingUpdate ? 'Instalando...' : 'Selecionar arquivo e atualizar'}
                  </span>
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Global Flags + History */}
          <div className="space-y-6">
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-bold text-zinc-950 dark:text-white">
                Controles de Publicação do Site
              </h2>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Aviso global no topo do feed
                </span>
                <input
                  type="text"
                  value={state.site.announcementBanner}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                announcementBanner: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  placeholder="Deixe vazio para ocultar"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                <span>Modo manutenção no feed</span>
                <input
                  type="checkbox"
                  checked={state.site.maintenanceMode}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                maintenanceMode: e.target.checked,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-4 w-4 accent-amber-600"
                />
              </label>

              <button
                type="button"
                onClick={async () => {
                  const res = await authFetch('/api/admin/updates/site-flags', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      announcementBanner: state.site.announcementBanner,
                      maintenanceMode: state.site.maintenanceMode,
                    }),
                  });
                  if (res.ok) {
                    const data = (await res.json()) as {
                      site: ServerOverview['state']['site'];
                    };
                    setSiteMeta({
                      version: data.site.version,
                      announcementBanner: data.site.announcementBanner,
                      maintenanceMode: data.site.maintenanceMode,
                    });
                    showToast('Controles do site atualizados');
                  }
                }}
                className="h-10 w-full rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Aplicar no site
              </button>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mb-3 text-sm font-bold text-zinc-950 dark:text-white">
                Histórico de versões
              </h2>
              <div className="space-y-3">
                {state.site.updateHistory.map((item) => (
                  <div
                    key={item.id}
                    className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0 dark:border-zinc-900"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-zinc-950 dark:text-white">
                        v{item.version}
                      </span>
                      <span className="text-zinc-400">
                        {item.source === 'upload' ? 'Arquivo local' : 'Remoto'} ·{' '}
                        {formatRelativeTime(item.appliedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {item.notes[0]}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 4: SELF-HOSTED WORDPRESS FULL CONTROL */}
      {activeTab === 'wordpress' && state && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Globe className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                    WordPress Auto-Hospedado (Controle Total)
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Gere Docker, Nginx, wp-config.php, plugin Bridge e exporte seu conteúdo
                    WXR para rodar em servidor próprio.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Domínio / URL do WordPress
                </span>
                <input
                  type="url"
                  value={state.wordpress.siteUrl}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                siteUrl: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  placeholder="https://meudominio.com.br"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Título da Instância
                </span>
                <input
                  type="text"
                  value={state.wordpress.siteTitle}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                siteTitle: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Banco de Dados
                </span>
                <select
                  value={state.wordpress.dbEngine}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                dbEngine:
                                  e.target.value === 'mysql-8' ? 'mysql-8' : 'mariadb-11',
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="mariadb-11">MariaDB 11.4</option>
                  <option value="mysql-8">MySQL 8.4</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Versão do PHP
                </span>
                <select
                  value={state.wordpress.phpVersion}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                phpVersion: e.target.value === '8.2' ? '8.2' : '8.3',
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="8.3">PHP 8.3 FPM</option>
                  <option value="8.2">PHP 8.2 FPM</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Nome do Banco
                </span>
                <input
                  type="text"
                  value={state.wordpress.dbName}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                dbName: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Prefixo das Tabelas
                </span>
                <input
                  type="text"
                  value={state.wordpress.tablePrefix}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              wordpress: {
                                ...prev.state.wordpress,
                                tablePrefix: e.target.value,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Estrutura de Links Permanentes
              </span>
              <select
                value={state.wordpress.permalinks}
                onChange={(e) =>
                  setOverview((prev) =>
                    prev
                      ? {
                          ...prev,
                          state: {
                            ...prev.state,
                            wordpress: {
                              ...prev.state.wordpress,
                              permalinks: e.target.value,
                            },
                          },
                        }
                      : prev
                  )
                }
                className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
              >
                <option value="/%postname%/">Nome do post (/%postname%/)</option>
                <option value="/%year%/%monthnum%/%postname%/">
                  Data e nome (/%year%/%monthnum%/%postname%/)
                </option>
                <option value="/archives/%post_id%">Numérico (/archives/%post_id%)</option>
              </select>
            </label>

            {/* Infrastructure Control Toggles */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { key: 'sslEnabled' as const, label: 'SSL / HTTPS' },
                { key: 'redisCache' as const, label: 'Cache Redis' },
                { key: 'disableXmlRpc' as const, label: 'Bloquear XML-RPC' },
                { key: 'maintenanceMode' as const, label: 'Manutenção WP' },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                >
                  <span>{opt.label}</span>
                  <input
                    type="checkbox"
                    checked={state.wordpress[opt.key]}
                    onChange={(e) =>
                      setOverview((prev) =>
                        prev
                          ? {
                              ...prev,
                              state: {
                                ...prev.state,
                                wordpress: {
                                  ...prev.state.wordpress,
                                  [opt.key]: e.target.checked,
                                },
                              },
                            }
                          : prev
                      )
                    }
                    className="h-4 w-4 accent-sky-600"
                  />
                </label>
              ))}
            </div>

            {wpTestStatus && (
              <p className="rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {wpTestStatus}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => saveIntegrations({ wordpress: state.wordpress })}
                className="h-10 rounded-xl bg-zinc-950 px-4 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Salvar configuração
              </button>

              <button
                type="button"
                disabled={downloadingCode}
                onClick={() =>
                  handleDownloadProtected(
                    '/api/admin/wordpress/download-kit',
                    'lumina-wordpress-selfhosted.zip'
                  )
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-700"
              >
                <Download className="h-4 w-4" />
                <span>Baixar Kit Auto-Hospedado (.zip)</span>
              </button>

              <button
                type="button"
                onClick={handleExportWordPressWxr}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Download className="h-4 w-4" />
                <span>Exportar WXR (.xml)</span>
              </button>

              <button
                type="button"
                disabled={testingKey === 'wordpress' || !state.wordpress.siteUrl.trim()}
                onClick={() => testIntegration('wordpress', state.wordpress.siteUrl)}
                className="h-10 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-45 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                {testingKey === 'wordpress' ? 'Conectando...' : 'Testar WP REST API'}
              </button>
            </div>
          </section>

          {/* Right Column: Included Kit Files & Synced WP Posts */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="mb-3 text-sm font-bold text-zinc-950 dark:text-white">
                Arquivos no Kit Auto-Hospedado
              </h3>
              <ul className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong className="font-mono text-zinc-900 dark:text-zinc-200">
                    docker-compose.yml
                  </strong>{' '}
                  — Stack completa (WordPress PHP {state.wordpress.phpVersion},{' '}
                  {state.wordpress.dbEngine}, Nginx{state.wordpress.redisCache ? ', Redis' : ''})
                </li>
                <li>
                  <strong className="font-mono text-zinc-900 dark:text-zinc-200">
                    wp-config.php
                  </strong>{' '}
                  — Prefixo <code className="font-mono">{state.wordpress.tablePrefix}</code>,
                  SSL e segurança reforçada
                </li>
                <li>
                  <strong className="font-mono text-zinc-900 dark:text-zinc-200">
                    nginx.conf
                  </strong>{' '}
                  — Proxy FastCGI e bloqueio XML-RPC configurável
                </li>
                <li>
                  <strong className="font-mono text-zinc-900 dark:text-zinc-200">
                    lumina-bridge.php
                  </strong>{' '}
                  — Plugin WordPress com shortcode{' '}
                  <code className="font-mono">[lumina_feed]</code> e endpoint REST
                </li>
              </ul>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="mb-2 text-sm font-bold text-zinc-950 dark:text-white">
                Posts sincronizados via REST API
              </h3>
              {wpSyncedPosts.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Informe a URL do seu WordPress auto-hospedado e clique em &ldquo;Testar WP
                  REST API&rdquo; para listar publicações remotas.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {wpSyncedPosts.map((wpPost) => (
                    <div
                      key={wpPost.id}
                      className="border-b border-zinc-100 pb-2 last:border-0 last:pb-0 dark:border-zinc-900"
                    >
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {wpPost.title}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {wpPost.link}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {siteMetaNotice(state?.site.maintenanceMode)}
    </div>
  );
}

function siteMetaNotice(maintenanceMode?: boolean) {
  if (!maintenanceMode) return null;
  return (
    <div className="mt-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        O modo manutenção está ativo para visitantes no feed; você continua com acesso total ao
        Painel Administrativo.
      </span>
    </div>
  );
}
