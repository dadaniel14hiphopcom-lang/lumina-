import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Send,
  Server,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VIDEO_RULES, encodeInviteMeta, useSocial } from '../context/SocialContext';
import { ADMIN_EMAIL, FIREBASE_PROJECT_ID, isExclusiveAdminUser } from '../lib/firebase';
import {
  DEFAULT_SUPABASE_URL,
  fetchPublicUsersFromSupabaseBrowser,
  getBrowserSupabaseConfig,
  isServiceRoleOrSecretKey,
  isSupabaseApiKeyLike,
  sanitizeSupabaseSchemaName,
  testSupabaseFromBrowser,
} from '../lib/supabaseClient';
import { InviteRecord, VideoRulesConfig } from '../types';
import {
  claimOrUpdateStaticAdminPasscode,
  hasStaticAdminPasscode,
  verifyStaticAdminPasscode,
} from '../utils/staticAdminAuth';
import { formatCompactCount, formatRelativeTime } from '../utils/time';
import { buildWordPressKitEntries, createBrowserZipBlob } from '../utils/zipClient';
import { AvatarRing } from './AvatarRing';

type AdminTab = 'users' | 'invites' | 'integrations' | 'updates' | 'wordpress';

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
      anonKey?: string;
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
      realUsersOnly: boolean;
      videoRules: VideoRulesConfig;
      updateHistory: {
        id: string;
        version: string;
        source: 'upload' | 'remote';
        notes: string[];
        appliedAt: number;
      }[];
    };
    invites?: InviteRecord[];
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

const LOCAL_STATE_KEY = 'lumina_admin_local_state_v1';

const DEFAULT_LOCAL_STATE: ServerOverview['state'] = {
  aws: {
    region: 'sa-east-1',
    bucket: 'lumina-media-prod',
    cloudFrontDomain: 'cdn.lumina.social',
    sesSender: 'no-reply@lumina.social',
    s3Enabled: true,
    cloudFrontEnabled: true,
    sesEnabled: false,
    rekognitionEnabled: true,
    lastVerifiedAt: null,
  },
  supabase: {
    projectUrl: DEFAULT_SUPABASE_URL,
    schemaName: 'public',
    anonKey: '',
    autoSyncUsers: true,
    autoSyncPosts: true,
    rlsEnforced: true,
    lastVerifiedAt: null,
    lastStatus: null,
  },
  wordpress: {
    siteUrl: '',
    siteTitle: 'Lumina Editorial WP',
    dbEngine: 'mariadb-11',
    dbName: 'lumina_wp',
    tablePrefix: 'wp_lum_',
    phpVersion: '8.3',
    permalinks: '/%postname%/',
    sslEnabled: true,
    redisCache: true,
    disableXmlRpc: true,
    maintenanceMode: false,
    lastSyncedAt: null,
  },
  site: {
    version: '2.4.0',
    channel: 'stable',
    announcementBanner: '',
    maintenanceMode: false,
    realUsersOnly: false,
    videoRules: DEFAULT_VIDEO_RULES,
    updateHistory: [
      {
        id: 'upd_init',
        version: '2.4.0',
        source: 'remote',
        notes: [
          'Seletor de tema claro/escuro na navegação',
          'Mensagens de voz e vídeo no bate-papo',
          'Indicador de status ativo nas miniaturas',
        ],
        appliedAt: Date.now() - 86_400_000,
      },
    ],
  },
};

function loadLocalAdminState(): ServerOverview['state'] {
  const browserCfg = getBrowserSupabaseConfig();
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ServerOverview['state']>;
      return {
        aws: { ...DEFAULT_LOCAL_STATE.aws, ...(parsed.aws || {}) },
        supabase: (() => {
          const rawSchema = (parsed.supabase?.schemaName || '').trim();
          const cleanSchema = sanitizeSupabaseSchemaName(rawSchema);
          const candidateAnon =
            parsed.supabase?.anonKey && !isServiceRoleOrSecretKey(parsed.supabase.anonKey)
              ? parsed.supabase.anonKey.trim()
              : isSupabaseApiKeyLike(rawSchema) && !isServiceRoleOrSecretKey(rawSchema)
              ? rawSchema
              : browserCfg.anonKey;
          return {
            ...DEFAULT_LOCAL_STATE.supabase,
            ...(parsed.supabase || {}),
            projectUrl:
              (parsed.supabase?.projectUrl || '').trim() ||
              DEFAULT_LOCAL_STATE.supabase.projectUrl,
            schemaName: cleanSchema,
            anonKey: candidateAnon,
          };
        })(),
        wordpress: { ...DEFAULT_LOCAL_STATE.wordpress, ...(parsed.wordpress || {}) },
        site: {
          ...DEFAULT_LOCAL_STATE.site,
          ...(parsed.site || {}),
          realUsersOnly: Boolean(parsed.site?.realUsersOnly),
          videoRules: {
            ...DEFAULT_VIDEO_RULES,
            ...(parsed.site?.videoRules || {}),
          },
        },
      };
    }
  } catch {
    // Ignore invalid local storage
  }
  const fallback = structuredClone(DEFAULT_LOCAL_STATE);
  fallback.supabase.anonKey = browserCfg.anonKey;
  return fallback;
}

function saveLocalAdminState(state: ServerOverview['state']) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function AdminPanelView() {
  const {
    allUsers,
    allPosts,
    currentUser,
    toggleRestrictUser,
    toggleBoostUser,
    toggleVerifyUser,
    openProfile,
    showToast,
    setSiteMeta,
    invites,
    setInvites,
    createInvite,
    revokeInvite,
    purgeDemoUsers,
    firebaseUser,
    adminMemoryToken,
    setAdminMemoryToken,
    activateAdminProfileSession,
    loginWithGoogle,
    loginWithGoogleRedirect,
  } = useSocial();

  // Auth held strictly in React memory (never localStorage)
  const [adminToken, setAdminToken] = useState<string | null>(() => adminMemoryToken);
  const [manualLock, setManualLock] = useState(false);
  const [firebaseAdminLoading, setFirebaseAdminLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<{
    loading: boolean;
    claimed: boolean;
    envConfigured: boolean;
    serverAvailable: boolean;
  }>({ loading: true, claimed: false, envConfigured: false, serverAvailable: true });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // In-panel admin password rotation state
  const [newAdminPasscode, setNewAdminPasscode] = useState('');
  const [showNewAdminPasscode, setShowNewAdminPasscode] = useState(false);
  const [updatingAdminPasscode, setUpdatingAdminPasscode] = useState(false);

  const generateStrongPasscode = () => {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    const length = 14;
    const out: string[] = [];
    const buf = new Uint32Array(length);
    window.crypto.getRandomValues(buf);
    for (let i = 0; i < length; i++) {
      out.push(charset[buf[i] % charset.length]);
    }
    return `Adm-${out.join('')}`;
  };

  // Dashboard state
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Users tab state
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<
    'all' | 'verified' | 'boosted' | 'restricted'
  >('all');

  // Invites tab state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDays, setInviteDays] = useState(7);
  const [inviteVerified, setInviteVerified] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  // Integrations test feedback
  const [awsTestStatus, setAwsTestStatus] = useState<string | null>(null);
  const [supabaseTestStatus, setSupabaseTestStatus] = useState<string | null>(null);
  const [showSupabaseAnonKey, setShowSupabaseAnonKey] = useState(false);
  const [syncingSupabase, setSyncingSupabase] = useState(false);
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
    let cancelled = false;
    const detectServerAuth = async () => {
      try {
        const res = await fetch('/api/admin/auth/status');
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
          throw new Error('Backend indisponível');
        }
        const data = (await res.json()) as { claimed?: boolean; envConfigured?: boolean };
        if (typeof data.claimed !== 'boolean') {
          throw new Error('Resposta inválida');
        }
        if (!cancelled) {
          setAuthStatus({
            loading: false,
            claimed: data.claimed,
            envConfigured: Boolean(data.envConfigured),
            serverAvailable: true,
          });
        }
      } catch {
        // Static / SPA hosting fallback: support both Google Admin & PBKDF2 local ADM passcode
        if (!cancelled) {
          setAuthStatus({
            loading: false,
            claimed: hasStaticAdminPasscode(),
            envConfigured: false,
            serverAvailable: false,
          });
        }
      }
    };
    detectServerAuth();
    return () => {
      cancelled = true;
    };
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

  const syncMetaFromSiteState = (site: ServerOverview['state']['site']) => {
    setSiteMeta({
      version: site.version,
      announcementBanner: site.announcementBanner,
      maintenanceMode: site.maintenanceMode,
      realUsersOnly: Boolean(site.realUsersOnly),
      videoRules: site.videoRules || DEFAULT_VIDEO_RULES,
    });
  };

  const loadLocalOverview = () => {
    const localState = loadLocalAdminState();
    setOverview({
      state: localState,
      envStatus: {
        awsCredentialsConfigured: false,
        awsRegionEnv: false,
        supabaseUrlEnv: false,
        supabaseKeysEnv: Boolean(localState.supabase.anonKey?.trim()),
        wordpressEnv: false,
      },
    });
    syncMetaFromSiteState(localState.site);
  };

  const loadOverview = async (tokenOverride?: string, serverMode = authStatus.serverAvailable) => {
    if (!serverMode) {
      loadLocalOverview();
      return;
    }
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: {
          Authorization: `Bearer ${tokenOverride || adminToken || ''}`,
        },
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = (await res.json()) as ServerOverview;
        const localFallback = loadLocalAdminState();
        const mergedAnonKey =
          (data.state.supabase.anonKey || '').trim() || localFallback.supabase.anonKey || '';
        const mergedState: ServerOverview['state'] = {
          ...data.state,
          supabase: {
            ...data.state.supabase,
            anonKey: mergedAnonKey,
          },
        };
        saveLocalAdminState(mergedState);
        setOverview({
          ...data,
          state: mergedState,
          envStatus: {
            ...data.envStatus,
            supabaseKeysEnv: Boolean(data.envStatus.supabaseKeysEnv || mergedAnonKey),
          },
        });
        if (Array.isArray(data.state.invites)) {
          setInvites(data.state.invites);
        }
        syncMetaFromSiteState(data.state.site);
      }
    } finally {
      setLoadingOverview(false);
    }
  };

  const authenticateExclusiveAdminWithFirebase = async (
    userOverride = firebaseUser
  ): Promise<boolean> => {
    if (!userOverride || !isExclusiveAdminUser(userOverride)) {
      return false;
    }
    setAuthError(null);
    setFirebaseAdminLoading(true);
    try {
      if (!authStatus.serverAvailable) {
        setAdminToken(`firebase_admin_${userOverride.uid}`);
        loadLocalOverview();
        return true;
      }

      const idToken = await userOverride.getIdToken();
      const res = await fetch('/api/admin/auth/firebase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setAuthStatus((prev) => ({ ...prev, serverAvailable: false }));
        setAdminToken(`firebase_admin_${userOverride.uid}`);
        loadLocalOverview();
        return true;
      }
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Acesso administrativo negado.');
        return false;
      }
      setAdminToken(data.token);
      setAdminMemoryToken(data.token);
      await loadOverview(data.token, true);
      return true;
    } catch {
      setAuthError('Não foi possível validar a sessão administrativa.');
      return false;
    } finally {
      setFirebaseAdminLoading(false);
    }
  };

  // Sync admin token if authenticated from AuthView or active exclusive Google Admin session
  useEffect(() => {
    if (authStatus.loading || manualLock) return;
    if (!adminToken && adminMemoryToken) {
      setAdminToken(adminMemoryToken);
      void loadOverview(adminMemoryToken, authStatus.serverAvailable);
      return;
    }
    if (!adminToken && isExclusiveAdminUser(firebaseUser)) {
      void authenticateExclusiveAdminWithFirebase(firebaseUser);
    }
  }, [authStatus.loading, authStatus.serverAvailable, firebaseUser, adminToken, adminMemoryToken, manualLock]);

  const handleExclusiveGoogleAdminLogin = async () => {
    setAuthError(null);
    setManualLock(false);
    if (isExclusiveAdminUser(firebaseUser)) {
      await authenticateExclusiveAdminWithFirebase(firebaseUser);
      return;
    }
    setFirebaseAdminLoading(true);
    try {
      const res = await loginWithGoogle();
      if (!res.ok) {
        setAuthError(res.error || 'Login cancelado ou não autorizado.');
      }
    } finally {
      setFirebaseAdminLoading(false);
    }
  };

  const handleExclusiveGoogleRedirectLogin = async () => {
    setAuthError(null);
    setManualLock(false);
    setFirebaseAdminLoading(true);
    try {
      const res = await loginWithGoogleRedirect('admin');
      if (!res.ok) {
        setAuthError(res.error || 'Não foi possível redirecionar para o login Google.');
      }
    } finally {
      setFirebaseAdminLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const isFirstRunClaim = !authStatus.claimed && !authStatus.envConfigured;
    if (isFirstRunClaim) {
      if (passcodeInput.trim().length < 6) {
        setAuthError('Escolha uma senha de acesso com pelo menos 6 caracteres.');
        return;
      }
      if (passcodeInput !== confirmInput) {
        setAuthError('As senhas não conferem.');
        return;
      }
    } else if (!passcodeInput.trim()) {
      setAuthError('Informe a senha administrativa para entrar.');
      return;
    }

    if (!authStatus.serverAvailable) {
      setAuthSubmitting(true);
      try {
        if (isFirstRunClaim) {
          const claimRes = await claimOrUpdateStaticAdminPasscode(passcodeInput.trim());
          if (!claimRes.ok) {
            setAuthError(claimRes.error || 'Não foi possível salvar a senha administrativa.');
            return;
          }
        } else {
          const valid = await verifyStaticAdminPasscode(passcodeInput.trim());
          if (!valid) {
            setAuthError('Senha administrativa incorreta neste navegador.');
            return;
          }
        }
        const staticToken = 'static_admin_local';
        setManualLock(false);
        setAdminToken(staticToken);
        setAdminMemoryToken(staticToken);
        activateAdminProfileSession(staticToken);
        setPasscodeInput('');
        setConfirmInput('');
        setShowPasscode(false);
        setAuthStatus((prev) => ({ ...prev, claimed: true }));
        loadLocalOverview();
        showToast(
          isFirstRunClaim
            ? `Senha de ADM salva nesta hospedagem para ${ADMIN_EMAIL}! Painel desbloqueado.`
            : `Bem-vindo, administrador (${ADMIN_EMAIL}).`
        );
      } finally {
        setAuthSubmitting(false);
      }
      return;
    }

    setAuthSubmitting(true);
    try {
      const endpoint = isFirstRunClaim ? '/api/admin/auth/claim' : '/api/admin/auth/login';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: ADMIN_EMAIL,
          passcode: passcodeInput.trim(),
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setAuthStatus((prev) => ({ ...prev, serverAvailable: false }));
        setAuthError(
          `Servidor /api não detectado. Entre diretamente com sua conta Google Admin (${ADMIN_EMAIL}).`
        );
        return;
      }
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(data.error || 'Falha na autenticação.');
        return;
      }
      setManualLock(false);
      setAdminToken(data.token);
      activateAdminProfileSession(data.token);
      setPasscodeInput('');
      setConfirmInput('');
      setShowPasscode(false);
      setAuthStatus((prev) => ({ ...prev, claimed: true }));
      await loadOverview(data.token, true);
      showToast(
        isFirstRunClaim
          ? `Senha de ADM salva para ${ADMIN_EMAIL}! Painel desbloqueado.`
          : `Bem-vindo, administrador (${ADMIN_EMAIL}).`
      );
    } catch {
      setAuthError('Erro de conexão com o servidor.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRotateAdminPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNext = newAdminPasscode.trim();
    if (cleanNext.length < 6) {
      showToast('A nova senha de ADM deve ter pelo menos 6 caracteres');
      return;
    }
    setUpdatingAdminPasscode(true);
    try {
      if (!authStatus.serverAvailable) {
        const res = await claimOrUpdateStaticAdminPasscode(cleanNext);
        if (!res.ok) {
          showToast(res.error || 'Não foi possível atualizar a senha de ADM');
          return;
        }
        setNewAdminPasscode('');
        showToast(`Nova senha de ADM salva nesta hospedagem para ${ADMIN_EMAIL}`);
        return;
      }
      const res = await authFetch('/api/admin/auth/change-passcode', {
        method: 'POST',
        body: JSON.stringify({ newPasscode: cleanNext }),
      });
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok) {
        showToast(data.error || 'Não foi possível atualizar a senha de ADM');
        return;
      }
      if (data.token) {
        setAdminToken(data.token);
        setAdminMemoryToken(data.token);
      }
      setNewAdminPasscode('');
      showToast(`Nova senha de ADM atualizada para ${ADMIN_EMAIL}`);
    } finally {
      setUpdatingAdminPasscode(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (userFilter === 'verified' && !u.verified) return false;
      if (userFilter === 'boosted' && !u.boosted) return false;
      if (userFilter === 'restricted' && !u.restricted) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
      );
    });
  }, [allUsers, userSearch, userFilter]);

  const userStats = useMemo(
    () => ({
      total: allUsers.length,
      verified: allUsers.filter((u) => u.verified).length,
      boosted: allUsers.filter((u) => u.boosted).length,
      restricted: allUsers.filter((u) => u.restricted).length,
    }),
    [allUsers]
  );

  const persistSiteRulesAndFlags = async (nextSitePatch: Partial<ServerOverview['state']['site']>) => {
    if (!overview?.state) return;
    const mergedSite: ServerOverview['state']['site'] = {
      ...overview.state.site,
      ...nextSitePatch,
      announcementBanner: (
        nextSitePatch.announcementBanner ?? overview.state.site.announcementBanner
      ).slice(0, 220),
      videoRules: {
        ...overview.state.site.videoRules,
        ...(nextSitePatch.videoRules || {}),
      },
    };
    const nextState: ServerOverview['state'] = {
      ...overview.state,
      site: mergedSite,
    };

    saveLocalAdminState(nextState);
    setOverview((prev) => (prev ? { ...prev, state: nextState } : prev));
    syncMetaFromSiteState(mergedSite);

    if (!authStatus.serverAvailable) {
      showToast('Regras e configurações aplicadas');
      return;
    }

    const res = await authFetch('/api/admin/updates/site-flags', {
      method: 'PATCH',
      body: JSON.stringify({
        announcementBanner: mergedSite.announcementBanner,
        maintenanceMode: mergedSite.maintenanceMode,
        realUsersOnly: mergedSite.realUsersOnly,
        videoRules: mergedSite.videoRules,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        site: ServerOverview['state']['site'];
      };
      setOverview((prev) =>
        prev ? { ...prev, state: { ...prev.state, site: data.site } } : prev
      );
      syncMetaFromSiteState(data.site);
      showToast('Regras e controles salvos no servidor');
    } else {
      showToast('Regras aplicadas localmente');
    }
  };

  const buildInviteShareUrl = (inv: InviteRecord) => {
    const metaToken = encodeInviteMeta({
      code: inv.code,
      email: inv.email,
      invitedName: inv.invitedName,
      grantVerified: inv.grantVerified,
      expiresAt: inv.expiresAt,
    });
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/?invite=${encodeURIComponent(inv.code)}&meta=${encodeURIComponent(metaToken)}`;
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      showToast('Informe um e-mail válido para enviar o convite');
      return;
    }

    setSendingInvite(true);
    try {
      if (authStatus.serverAvailable) {
        const res = await authFetch('/api/admin/invites', {
          method: 'POST',
          body: JSON.stringify({
            email: cleanEmail,
            invitedName: inviteName.trim(),
            grantVerified: inviteVerified,
            expiresInDays: inviteDays,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { invite?: InviteRecord };
          if (data.invite) {
            setInvites((prev) => [data.invite!, ...prev.filter((i) => i.id !== data.invite!.id)]);
            setInviteEmail('');
            setInviteName('');
            setInviteVerified(false);
            showToast(`Convite ${data.invite.code} gerado para ${cleanEmail}`);
            return;
          }
        }
      }

      const created = createInvite({
        email: cleanEmail,
        invitedName: inviteName.trim(),
        grantVerified: inviteVerified,
        expiresInDays: inviteDays,
      });
      setInviteEmail('');
      setInviteName('');
      setInviteVerified(false);
      showToast(`Convite ${created.code} criado e pronto para envio`);
    } finally {
      setSendingInvite(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (authStatus.serverAvailable) {
      await authFetch(`/api/admin/invites/${inviteId}/revoke`, {
        method: 'PATCH',
      }).catch(() => {});
    }
    revokeInvite(inviteId);
  };

  const saveIntegrations = async (
    patch: Partial<Pick<ServerOverview['state'], 'aws' | 'supabase' | 'wordpress'>>
  ) => {
    let normalizedPatch = patch;
    if (patch.supabase) {
      const rawSchema = (patch.supabase.schemaName || '').trim();
      if (isSupabaseApiKeyLike(rawSchema) && isServiceRoleOrSecretKey(rawSchema)) {
        const warn =
          'Por segurança, nunca cole a chave secreta (service_role / sb_secret) aqui. Use apenas a chave pública (anon / publishable).';
        setSupabaseTestStatus(warn);
        showToast(warn);
        return;
      }
      if (patch.supabase.anonKey && isServiceRoleOrSecretKey(patch.supabase.anonKey)) {
        const warn =
          'Por segurança, nunca cole a chave secreta (service_role / sb_secret) aqui. Use apenas a chave pública (anon / publishable).';
        setSupabaseTestStatus(warn);
        showToast(warn);
        return;
      }
      const rescuedAnon =
        (patch.supabase.anonKey || '').trim() ||
        (isSupabaseApiKeyLike(rawSchema) && !isServiceRoleOrSecretKey(rawSchema) ? rawSchema : '');
      normalizedPatch = {
        ...patch,
        supabase: {
          ...patch.supabase,
          schemaName: sanitizeSupabaseSchemaName(rawSchema),
          anonKey: rescuedAnon,
        },
      };
    }

    if (normalizedPatch.supabase && overview?.state) {
      saveLocalAdminState({
        ...overview.state,
        supabase: {
          ...overview.state.supabase,
          ...normalizedPatch.supabase,
          anonKey: (normalizedPatch.supabase.anonKey || '').trim(),
        },
      });
    }

    if (!authStatus.serverAvailable) {
      setOverview((prev) => {
        if (!prev) return prev;
        const nextAnon = (
          normalizedPatch.supabase?.anonKey ??
          prev.state.supabase.anonKey ??
          ''
        ).trim();
        const nextState: ServerOverview['state'] = {
          ...prev.state,
          aws: normalizedPatch.aws
            ? { ...prev.state.aws, ...normalizedPatch.aws }
            : prev.state.aws,
          supabase: normalizedPatch.supabase
            ? {
                ...prev.state.supabase,
                ...normalizedPatch.supabase,
                anonKey: nextAnon,
              }
            : prev.state.supabase,
          wordpress: normalizedPatch.wordpress
            ? { ...prev.state.wordpress, ...normalizedPatch.wordpress }
            : prev.state.wordpress,
        };
        saveLocalAdminState(nextState);
        return {
          ...prev,
          state: nextState,
          envStatus: {
            ...prev.envStatus,
            supabaseKeysEnv: Boolean(nextAnon),
          },
        };
      });
      showToast('Configurações do Supabase salvas neste domínio');
      return;
    }

    const cleanAnonKey = (normalizedPatch.supabase?.anonKey || '').trim();
    const serverPatch = normalizedPatch.supabase
      ? {
          ...normalizedPatch,
          supabase: {
            projectUrl: normalizedPatch.supabase.projectUrl,
            schemaName: normalizedPatch.supabase.schemaName,
            anonKey: cleanAnonKey,
            autoSyncUsers: normalizedPatch.supabase.autoSyncUsers,
            autoSyncPosts: normalizedPatch.supabase.autoSyncPosts,
            rlsEnforced: normalizedPatch.supabase.rlsEnforced,
            lastVerifiedAt: normalizedPatch.supabase.lastVerifiedAt,
            lastStatus: normalizedPatch.supabase.lastStatus,
          },
        }
      : normalizedPatch;

    const res = await authFetch('/api/admin/integrations', {
      method: 'PUT',
      body: JSON.stringify(serverPatch),
    });
    if (res.ok) {
      const data = (await res.json()) as { state: ServerOverview['state'] };
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              state: {
                ...data.state,
                supabase: {
                  ...data.state.supabase,
                  anonKey: (data.state.supabase.anonKey || prev.state.supabase.anonKey || '').trim(),
                },
              },
              envStatus: {
                ...prev.envStatus,
                supabaseKeysEnv: Boolean(
                  prev.envStatus.supabaseKeysEnv ||
                    data.state.supabase.anonKey?.trim() ||
                    cleanAnonKey
                ),
              },
            }
          : prev
      );
      showToast('Configurações salvas no servidor');
    } else {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(errData.error || 'Não foi possível salvar as configurações');
    }
  };

  const testIntegration = async (
    provider: 'aws' | 'supabase' | 'wordpress',
    url?: string
  ) => {
    if (!authStatus.serverAvailable) {
      if (provider === 'supabase') {
        const candidateAnon = (overview?.state.supabase.anonKey || '').trim();
        if (candidateAnon && isServiceRoleOrSecretKey(candidateAnon)) {
          const warn =
            'Por segurança, nunca cole a chave secreta (service_role / sb_secret) no navegador. Use apenas a chave pública (anon / publishable).';
          setSupabaseTestStatus(warn);
          showToast(warn);
          return;
        }
        setTestingKey('supabase');
        try {
          const result = await testSupabaseFromBrowser({
            projectUrl: url || overview?.state.supabase.projectUrl,
            schemaName: overview?.state.supabase.schemaName,
            anonKey: candidateAnon,
          });
          setSupabaseTestStatus(result.statusLabel);
          setOverview((prev) => {
            if (!prev) return prev;
            const nextState: ServerOverview['state'] = {
              ...prev.state,
              supabase: {
                ...prev.state.supabase,
                projectUrl: result.origin,
                schemaName: sanitizeSupabaseSchemaName(prev.state.supabase.schemaName),
                anonKey: candidateAnon,
                lastVerifiedAt: Date.now(),
                lastStatus: result.tablesReady
                  ? 'Conectado (Pronto)'
                  : result.hasKey
                  ? 'Chave OK · Falta SQL'
                  : 'Falta chave pública (anon)',
              },
            };
            saveLocalAdminState(nextState);
            return {
              ...prev,
              state: nextState,
              envStatus: {
                ...prev.envStatus,
                supabaseKeysEnv: Boolean(result.hasKey),
              },
            };
          });
          showToast(
            result.tablesReady
              ? 'Supabase conectado e tabela lumina_users pronta!'
              : !result.hasKey
              ? 'Supabase online! Cole a Chave Pública (anon) acima para ativar.'
              : result.reachable
              ? 'Chave aceita! Agora execute o SQL no Supabase.'
              : 'Falha ao conectar ao Supabase'
          );
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Não foi possível alcançar o projeto Supabase pelo navegador.';
          setSupabaseTestStatus(msg);
          showToast(msg);
        } finally {
          setTestingKey(null);
        }
        return;
      }

      const msg =
        'Teste de rede via proxy exige o servidor Node.js ativo (npm start). Em hospedagem estática, exporte os arquivos SQL/IAM/Kit WP normalmente.';
      if (provider === 'aws') setAwsTestStatus(msg);
      if (provider === 'wordpress') setWpTestStatus(msg);
      showToast('Modo estático: use os exportadores locais');
      return;
    }

    setTestingKey(provider);
    try {
      const candidateAnon =
        provider === 'supabase' ? (overview?.state.supabase.anonKey || '').trim() : undefined;
      if (candidateAnon && isServiceRoleOrSecretKey(candidateAnon)) {
        const warn =
          'Por segurança, nunca cole a chave secreta (service_role / sb_secret) aqui. Use apenas a chave pública (anon / publishable).';
        setSupabaseTestStatus(warn);
        showToast(warn);
        return;
      }

      const res = await authFetch('/api/admin/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ provider, url, anonKey: candidateAnon }),
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

  const syncSupabaseNow = async () => {
    if (!authStatus.serverAvailable) {
      setSyncingSupabase(true);
      try {
        const cfg = {
          projectUrl: overview?.state.supabase.projectUrl || DEFAULT_SUPABASE_URL,
          schemaName: overview?.state.supabase.schemaName || 'public',
          anonKey: (overview?.state.supabase.anonKey || '').trim(),
          autoSyncUsers: Boolean(overview?.state.supabase.autoSyncUsers ?? true),
        };
        const check = await testSupabaseFromBrowser(cfg);
        if (!check.hasKey || !check.tablesReady) {
          setSupabaseTestStatus(check.statusLabel);
          showToast(check.hasKey ? 'Execute o SQL no Supabase antes de sincronizar' : 'Cole a Chave Pública (anon) do Supabase');
          return;
        }
        const remoteUsers = await fetchPublicUsersFromSupabaseBrowser(cfg);
        const msg = `Banco conectado direto pelo navegador! ${remoteUsers.length} usuário(s) real(is) encontrado(s) em ${cfg.schemaName}.lumina_users. Novos cadastros feitos no site gravam automaticamente neste banco.`;
        setSupabaseTestStatus(msg);
        setOverview((prev) => {
          if (!prev) return prev;
          const nextState: ServerOverview['state'] = {
            ...prev.state,
            supabase: {
              ...prev.state.supabase,
              lastVerifiedAt: Date.now(),
              lastStatus: `${remoteUsers.length} usuário(s) no banco`,
            },
          };
          saveLocalAdminState(nextState);
          return { ...prev, state: nextState };
        });
        showToast('Conexão e leitura do Supabase confirmadas!');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao consultar Supabase.';
        setSupabaseTestStatus(msg);
        showToast(msg);
      } finally {
        setSyncingSupabase(false);
      }
      return;
    }
    setSyncingSupabase(true);
    try {
      const realUsers = allUsers.filter((u) => !u.isDemoSeed);
      const res = await authFetch('/api/admin/supabase/sync-now', {
        method: 'POST',
        body: JSON.stringify({
          projectUrl: overview?.state.supabase.projectUrl,
          users: realUsers,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        statusLabel?: string;
        error?: string;
      };
      const msg = data.statusLabel || data.error || 'Sincronização finalizada.';
      setSupabaseTestStatus(msg);
      showToast(data.ok ? 'Usuários reais sincronizados no Supabase' : msg);
      await loadOverview();
    } finally {
      setSyncingSupabase(false);
    }
  };

  const handleDownloadProtected = async (url: string, fallbackName: string) => {
    if (!authStatus.serverAvailable) {
      if (url === '/api/admin/wordpress/download-kit' && overview?.state) {
        const { domain, entries } = buildWordPressKitEntries({
          ...overview.state.wordpress,
          siteVersion: overview.state.site.version,
        });
        const blob = createBrowserZipBlob(entries);
        triggerBlobDownload(blob, `lumina-wordpress-selfhosted-${domain}.zip`);
        showToast('Kit Auto-Hospedado (.zip) gerado no navegador');
        return;
      }
      if (url === '/api/admin/updates/sample-package') {
        const pkg = {
          packageType: 'lumina-site-update',
          version: '2.5.0',
          channel: 'stable',
          releasedAt: '2026-11-21T14:00:00Z',
          notes: [
            'Novo suporte a destaques impulsionados no feed principal',
            'Otimizações no conector Supabase e ponte WordPress auto-hospedado',
            'Correções de acessibilidade e contraste no tema escuro',
          ],
          configPatch: {
            announcementBanner: 'Lumina v2.5.0 instalada com sucesso.',
            maintenanceMode: false,
          },
        };
        triggerBlobDownload(
          new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }),
          'lumina-update-2.5.0.json'
        );
        showToast('Pacote de exemplo baixado');
        return;
      }
      showToast('Para baixar o código-fonte completo (.zip), execute com o servidor Node.js (npm start)');
      return;
    }

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
    if (!authStatus.serverAvailable) {
      const currentVersion = overview?.state.site.version || '2.4.0';
      const latestVersion = '2.5.0';
      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion,
        hasUpdate: currentVersion !== latestVersion,
        releaseDate: '2026-11-21',
        changelog: [
          'Motor de feed com prioridade para criadores impulsionados',
          'Suporte a banner de comunicado global e modo manutenção',
          'Otimização do exportador WXR e bridge WordPress REST API',
          'Melhorias de contraste e compressão de mídia local',
        ],
      };
      setUpdateCheck(result);
      showToast(
        result.hasUpdate
          ? `Nova versão v${result.latestVersion} disponível`
          : 'O site já está na versão mais recente'
      );
      return;
    }

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

  const applyLocalUpdatePayload = (pkg: {
    version?: string;
    source?: 'upload' | 'remote';
    channel?: 'stable' | 'beta';
    notes?: unknown[];
    configPatch?: { announcementBanner?: string; maintenanceMode?: boolean };
  }) => {
    const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(version)) {
      showToast('Versão semântica inválida no pacote (ex: 2.5.0)');
      return;
    }
    const notes = Array.isArray(pkg.notes)
      ? pkg.notes.filter((n): n is string => typeof n === 'string').slice(0, 12)
      : ['Atualização aplicada via pacote manual'];

    const entrySource: 'remote' | 'upload' =
      pkg.source === 'remote' ? 'remote' : 'upload';

    setOverview((prev) => {
      if (!prev) return prev;
      const nextHistory: ServerOverview['state']['site']['updateHistory'] = [
        {
          id: `upd_${Date.now()}`,
          version,
          source: entrySource,
          notes,
          appliedAt: Date.now(),
        },
        ...prev.state.site.updateHistory,
      ].slice(0, 20);
      const nextSite: ServerOverview['state']['site'] = {
        ...prev.state.site,
        version,
        channel:
          pkg.channel === 'beta' || pkg.channel === 'stable'
            ? pkg.channel
            : prev.state.site.channel,
        announcementBanner:
          typeof pkg.configPatch?.announcementBanner === 'string'
            ? pkg.configPatch.announcementBanner.slice(0, 220)
            : prev.state.site.announcementBanner,
        maintenanceMode:
          typeof pkg.configPatch?.maintenanceMode === 'boolean'
            ? pkg.configPatch.maintenanceMode
            : prev.state.site.maintenanceMode,
        updateHistory: nextHistory,
      };
      const nextState = { ...prev.state, site: nextSite };
      saveLocalAdminState(nextState);
      syncMetaFromSiteState(nextSite);
      setUpdateCheck((uc) =>
        uc ? { ...uc, currentVersion: nextSite.version, hasUpdate: false } : uc
      );
      showToast(`Atualização v${nextSite.version} aplicada`);
      return { ...prev, state: nextState };
    });
  };

  const handleApplyRemoteUpdate = async () => {
    if (!updateCheck) return;
    if (!authStatus.serverAvailable) {
      applyLocalUpdatePayload({
        version: updateCheck.latestVersion,
        source: 'remote',
        notes: updateCheck.changelog,
        configPatch: {
          announcementBanner: `Lumina v${updateCheck.latestVersion} ativa.`,
        },
      });
      return;
    }

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
        syncMetaFromSiteState(data.site);
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
      if (!authStatus.serverAvailable) {
        applyLocalUpdatePayload({ ...parsed, source: 'upload' });
        return;
      }

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
      syncMetaFromSiteState(data.site);
      showToast(`Pacote v${data.site.version} instalado com sucesso`);
    } catch {
      showToast('Envie um arquivo de atualização .json válido');
    } finally {
      setApplyingUpdate(false);
    }
  };

  const buildSupabaseSql = () => {
    const schema = sanitizeSupabaseSchemaName(overview?.state.supabase.schemaName);
    const ensureSchemaSql =
      schema !== 'public' ? `create schema if not exists ${schema};\n\n` : '';
    return `-- Schema Supabase para Lumina Social (${overview?.state.supabase.projectUrl || 'https://jpllpvfunpsqexnvjgdt.supabase.co'})
${ensureSchemaSql}create table if not exists ${schema}.lumina_users (
  id text primary key,
  auth_uid uuid unique,
  username text unique not null,
  display_name text not null,
  email text,
  avatar_url text,
  cover_url text,
  bio text default '',
  verified boolean default false,
  boosted boolean default false,
  restricted boolean default false,
  is_real_user boolean default true,
  auth_source text default 'register',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_lumina_users_username on ${schema}.lumina_users (lower(username));
create index if not exists idx_lumina_users_auth_uid on ${schema}.lumina_users (auth_uid);

create table if not exists ${schema}.lumina_posts (
  id text primary key,
  author_id text references ${schema}.lumina_users(id) on delete cascade,
  caption text default '',
  location text,
  category text not null,
  aspect_ratio text default '4:5',
  is_reel boolean default false,
  media_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table ${schema}.lumina_users enable row level security;
alter table ${schema}.lumina_posts enable row level security;

-- Protege e-mail privado contra leitura anônima via API pública
revoke all on table ${schema}.lumina_users from anon, authenticated;
grant select (id, auth_uid, username, display_name, avatar_url, cover_url, bio, verified, boosted, restricted, is_real_user, auth_source, created_at, updated_at)
  on table ${schema}.lumina_users to anon, authenticated;
grant insert, update on table ${schema}.lumina_users to authenticated;

grant select on table ${schema}.lumina_posts to anon, authenticated;
grant insert, update, delete on table ${schema}.lumina_posts to authenticated;

drop policy if exists "Perfis públicos visíveis" on ${schema}.lumina_users;
create policy "Perfis públicos visíveis"
  on ${schema}.lumina_users for select
  using (not restricted);

drop policy if exists "Usuário insere próprio perfil" on ${schema}.lumina_users;
create policy "Usuário insere próprio perfil"
  on ${schema}.lumina_users for insert
  to authenticated
  with check (auth.uid() = auth_uid);

drop policy if exists "Usuário atualiza próprio perfil" on ${schema}.lumina_users;
create policy "Usuário atualiza próprio perfil"
  on ${schema}.lumina_users for update
  to authenticated
  using (auth.uid() = auth_uid)
  with check (auth.uid() = auth_uid);

drop policy if exists "Publicações de contas ativas" on ${schema}.lumina_posts;
create policy "Publicações de contas ativas"
  on ${schema}.lumina_posts for select
  using (true);

-- Sincronização automática: todo usuário criado no Supabase Auth entra em lumina_users
create or replace function ${schema}.handle_new_lumina_user()
returns trigger
language plpgsql
security definer
set search_path = ${schema}, public
as $$
declare
  raw_handle text;
  clean_handle text;
  resolved_id text;
begin
  resolved_id := coalesce(nullif(new.raw_user_meta_data->>'lumina_id', ''), new.id::text);
  raw_handle := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'user'));
  clean_handle := regexp_replace(raw_handle, '[^a-z0-9._]', '', 'g');
  if length(clean_handle) < 3 then
    clean_handle := 'user.' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  if exists (select 1 from ${schema}.lumina_users where lower(username) = clean_handle and id <> resolved_id) then
    clean_handle := left(clean_handle, 24) || '.' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  insert into ${schema}.lumina_users (
    id, auth_uid, username, display_name, email, bio, is_real_user, auth_source, updated_at
  ) values (
    resolved_id,
    new.id,
    clean_handle,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), clean_handle),
    new.email,
    coalesce(new.raw_user_meta_data->>'bio', 'Novo usuário real na Lumina.'),
    true,
    'register',
    now()
  )
  on conflict (id) do update set
    auth_uid = excluded.auth_uid,
    display_name = excluded.display_name,
    email = coalesce(excluded.email, ${schema}.lumina_users.email),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_lumina on auth.users;
create trigger on_auth_user_created_lumina
  after insert on auth.users
  for each row execute function ${schema}.handle_new_lumina_user();
`;
  };

  const handleDownloadSupabaseSql = () => {
    triggerBlobDownload(new Blob([buildSupabaseSql()], { type: 'text/sql' }), 'lumina-supabase-schema.sql');
    showToast('Schema SQL do Supabase baixado');
  };

  const handleCopySupabaseSql = async () => {
    try {
      await navigator.clipboard.writeText(buildSupabaseSql());
      showToast('Script SQL copiado — cole no SQL Editor do Supabase');
    } catch {
      handleDownloadSupabaseSql();
    }
  };

  const handleDownloadAwsPolicy = () => {
    const bucket = overview?.state.aws.bucket || 'lumina-media-prod';
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'LuminaS3BucketCheck',
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${bucket}`],
        },
        {
          Sid: 'LuminaS3MediaAccess',
          Effect: 'Allow',
          Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
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

    const itemsXml = allPosts
      .map((post) => {
        const author = allUsers.find((u) => u.id === post.authorId);
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
    const signedWrongGoogleAccount =
      Boolean(firebaseUser) && !isExclusiveAdminUser(firebaseUser);
    const isAdminGoogleReady = isExclusiveAdminUser(firebaseUser);

    return (
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-md items-center justify-center px-4 py-10">
        <div className="w-full space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-zinc-950 dark:text-white">
                Painel Administrativo Exclusivo
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Acesso restrito ao administrador autorizado
              </p>
            </div>
          </div>

          {authStatus.loading ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              Verificando credenciais do servidor...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/70">
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Conta Administradora Vinculada
                </p>
                <p className="mt-1 font-mono text-zinc-600 dark:text-zinc-300">
                  {ADMIN_EMAIL}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Somente esta conta Google verificada tem permissão administrativa no banco de dados e no painel.
                </p>
              </div>

              {signedWrongGoogleAccount && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                  A conta atual (<strong>{firebaseUser?.email}</strong>) não possui permissão de administrador. Entre com <strong>{ADMIN_EMAIL}</strong>.
                </div>
              )}

              {authError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {authError}
                </p>
              )}

              <button
                type="button"
                disabled={firebaseAdminLoading}
                onClick={() => void handleExclusiveGoogleAdminLogin()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                <Cloud className="h-4 w-4" />
                <span>
                  {firebaseAdminLoading
                    ? 'Autenticando administrador...'
                    : isAdminGoogleReady
                    ? 'Entrar diretamente como Administrador'
                    : 'Entrar com Google (dadaniel14hiphop.com@gmail.com)'}
                </span>
              </button>

              {typeof window !== 'undefined' && window.self === window.top && !isAdminGoogleReady && (
                <button
                  type="button"
                  disabled={firebaseAdminLoading}
                  onClick={() => void handleExclusiveGoogleRedirectLogin()}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Globe className="h-3.5 w-3.5 text-sky-500" />
                  <span>Usar redirecionamento Google (se o pop-up falhar)</span>
                </button>
              )}

              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {!authStatus.claimed && !authStatus.envConfigured
                        ? 'Definir senha de ADM para esta conta'
                        : 'Entrar com senha de ADM'}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Vinculada exclusivamente a {ADMIN_EMAIL}
                    </p>
                  </div>
                  {!authStatus.claimed && !authStatus.envConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        const generated = generateStrongPasscode();
                        setPasscodeInput(generated);
                        setConfirmInput(generated);
                        setShowPasscode(true);
                        showToast('Senha forte gerada! Copie e clique em Salvar senha e entrar.');
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Gerar senha</span>
                    </button>
                  )}
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      {!authStatus.claimed && !authStatus.envConfigured
                        ? 'Nova senha de Administrador'
                        : 'Senha de Administrador'}
                    </span>
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                      <KeyRound className="h-4 w-4 text-zinc-400" />
                      <input
                        type={showPasscode ? 'text' : 'password'}
                        value={passcodeInput}
                        onChange={(e) => setPasscodeInput(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="h-10 flex-1 bg-transparent font-mono text-sm text-zinc-950 focus:outline-none dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasscode((v) => !v)}
                        aria-label={showPasscode ? 'Ocultar senha' : 'Mostrar senha'}
                        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        {showPasscode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      {passcodeInput && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(passcodeInput);
                            showToast('Senha copiada para a área de transferência');
                          }}
                          aria-label="Copiar senha"
                          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </label>

                  {!authStatus.claimed && !authStatus.envConfigured && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Confirmar senha de Administrador
                      </span>
                      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                        <Lock className="h-4 w-4 text-zinc-400" />
                        <input
                          type={showPasscode ? 'text' : 'password'}
                          value={confirmInput}
                          onChange={(e) => setConfirmInput(e.target.value)}
                          placeholder="Repita a senha"
                          className="h-10 flex-1 bg-transparent font-mono text-sm text-zinc-950 focus:outline-none dark:text-white"
                        />
                      </div>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="h-10 w-full rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950"
                  >
                    {authSubmitting
                      ? 'Validando...'
                      : !authStatus.claimed && !authStatus.envConfigured
                      ? 'Salvar senha de ADM e entrar'
                      : 'Entrar com senha de ADM'}
                  </button>
                </form>
              </div>

              {!authStatus.serverAvailable && (
                <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-50 p-3.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-semibold">
                    Hospedagem estática · Projeto Firebase: <span className="font-mono">{FIREBASE_PROJECT_ID}</span>
                  </p>
                  <p>
                    Para usar o login Google neste endereço, confirme que o domínio abaixo (sem https://) está adicionado no projeto{' '}
                    <strong className="font-mono">{FIREBASE_PROJECT_ID}</strong> em{' '}
                    <strong>Firebase Console → Authentication → Settings → Authorized domains</strong>, ou defina/use sua senha de ADM acima:
                  </p>
                  {typeof window !== 'undefined' && (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 font-mono text-[11px] text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                      <span className="truncate">{window.location.hostname}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(window.location.hostname);
                          showToast('Domínio copiado!');
                        }}
                        className="shrink-0 font-sans font-semibold text-sky-600 hover:underline dark:text-sky-400"
                      >
                        Copiar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
            Lumina Admin · v{state?.site.version || '2.4.0'} · Exclusivo ({ADMIN_EMAIL})
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
            onClick={() => {
              setManualLock(true);
              setAdminToken(null);
              setAdminMemoryToken(null);
            }}
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
          { id: 'invites' as const, label: 'Convites & Regras', icon: UserPlus },
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
                    const userPostsCount = allPosts.filter((p) => p.authorId === user.id).length;
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

      {/* TAB 1B: INVITES, VIDEO RULES & REAL USERS TARGETING */}
      {activeTab === 'invites' && state && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left 2 Columns: Send Invites & History */}
          <div className="space-y-6 lg:col-span-2">
            {/* Create & Send Invite Card */}
            <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <UserPlus className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                    Enviar Convites para Novos Usuários
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Gere links exclusivos de cadastro com código e e-mail pré-preenchidos para novos membros reais.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateInvite} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      E-mail do convidado
                    </span>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="novo.membro@dominio.com.br"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Validade (dias)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={inviteDays}
                      onChange={(e) => setInviteDays(Math.max(1, Number(e.target.value) || 7))}
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Nome sugerido (opcional)
                    </span>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="Ex: Juliana Martins"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between self-end rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                    <span>Conceder selo verificado ao cadastrar</span>
                    <input
                      type="checkbox"
                      checked={inviteVerified}
                      onChange={(e) => setInviteVerified(e.target.checked)}
                      className="h-4 w-4 accent-sky-600"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={sendingInvite || !inviteEmail.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{sendingInvite ? 'Gerando convite...' : 'Gerar convite de cadastro'}</span>
                </button>
              </form>
            </section>

            {/* Invites List */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-950 dark:text-white">
                  Convites Emitidos ({invites.length})
                </h3>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Link funciona mesmo em hospedagem estática
                </span>
              </div>

              {invites.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Nenhum convite gerado ainda. Preencha o e-mail acima para convidar um usuário real.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {invites.map((inv) => {
                    const shareUrl = buildInviteShareUrl(inv);
                    const expired = inv.status === 'pending' && Date.now() > inv.expiresAt;
                    const statusText =
                      inv.status === 'accepted'
                        ? 'Cadastrado'
                        : inv.status === 'revoked'
                        ? 'Revogado'
                        : expired
                        ? 'Expirado'
                        : 'Pendente';
                    const mailSubject = encodeURIComponent('Convite para participar da Lumina');
                    const mailBody = encodeURIComponent(
                      `Olá${inv.invitedName ? ` ${inv.invitedName}` : ''}!\n\nVocê recebeu um convite para criar sua conta na Lumina.\n\nCódigo: ${inv.code}\nAcesse pelo link direto:\n${shareUrl}\n`
                    );

                    return (
                      <div
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-zinc-950 dark:text-white">
                              {inv.code}
                            </span>
                            <span
                              className={`text-[11px] font-semibold ${
                                inv.status === 'accepted'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : inv.status === 'revoked' || expired
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-sky-600 dark:text-sky-400'
                              }`}
                            >
                              {statusText}
                            </span>
                            {inv.grantVerified && (
                              <BadgeCheck className="h-3.5 w-3.5 text-sky-500" />
                            )}
                          </div>
                          <p className="truncate text-xs text-zinc-600 dark:text-zinc-300">
                            {inv.email}
                            {inv.invitedName ? ` · ${inv.invitedName}` : ''}
                          </p>
                        </div>

                        {inv.status === 'pending' && !expired && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(shareUrl).catch(() => {});
                                showToast(`Link do convite ${inv.code} copiado`);
                              }}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copiar link</span>
                            </button>
                            <a
                              href={`mailto:${inv.email}?subject=${mailSubject}&body=${mailBody}`}
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-950 px-2.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              <span>Enviar e-mail</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv.id)}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-950/30"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              <span>Revogar</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Video Rules & Real Users Targeting */}
          <div className="space-y-6">
            {/* Video Size & Duration Rules */}
            <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center gap-2.5 border-b border-zinc-100 pb-3 dark:border-zinc-900">
                <Video className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                <h2 className="text-sm font-bold text-zinc-950 dark:text-white">
                  Regras de Tamanho de Vídeo
                </h2>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Tamanho máximo por vídeo (MB)
                </span>
                <input
                  type="number"
                  min={1}
                  max={250}
                  value={state.site.videoRules.maxVideoSizeMB}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                videoRules: {
                                  ...prev.state.site.videoRules,
                                  maxVideoSizeMB: Math.min(250, Math.max(1, Number(e.target.value) || 25)),
                                },
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Duração máxima nos Reels (segundos)
                </span>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={state.site.videoRules.maxReelDurationSec}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                videoRules: {
                                  ...prev.state.site.videoRules,
                                  maxReelDurationSec: Math.min(
                                    300,
                                    Math.max(5, Number(e.target.value) || 60)
                                  ),
                                },
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 tabular-nums dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                <span>Permitir vídeos curtos nos Reels</span>
                <input
                  type="checkbox"
                  checked={state.site.videoRules.allowVideoReels}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                videoRules: {
                                  ...prev.state.site.videoRules,
                                  allowVideoReels: e.target.checked,
                                },
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-4 w-4 accent-sky-600"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  persistSiteRulesAndFlags({ videoRules: state.site.videoRules })
                }
                className="h-10 w-full rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Salvar regras de vídeo
              </button>
            </section>

            {/* Real Users Only Targeting */}
            <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center gap-2.5 border-b border-zinc-100 pb-3 dark:border-zinc-900">
                <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold text-zinc-950 dark:text-white">
                  Apontamento para Usuários Reais
                </h2>
              </div>

              <p className="rounded-xl border border-emerald-500/25 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Respostas automáticas no chat foram desativadas permanentemente. Todas as mensagens agora ocorrem somente entre contas reais (com sincronização entre sessões/abas).
              </p>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                <span>Ocultar perfis fictícios de demonstração</span>
                <input
                  type="checkbox"
                  checked={state.site.realUsersOnly}
                  onChange={(e) =>
                    setOverview((prev) =>
                      prev
                        ? {
                            ...prev,
                            state: {
                              ...prev.state,
                              site: {
                                ...prev.state.site,
                                realUsersOnly: e.target.checked,
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() =>
                    persistSiteRulesAndFlags({ realUsersOnly: state.site.realUsersOnly })
                  }
                  className="h-10 w-full rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
                >
                  Aplicar apontamento
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    purgeDemoUsers();
                    await persistSiteRulesAndFlags({ realUsersOnly: true });
                  }}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Limpar perfis fictícios permanentemente</span>
                </button>
              </div>
            </section>
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
              Vídeos dos Reels são enviados automaticamente para{' '}
              <code className="font-mono">s3://{state.aws.bucket}/reels/</code> e entregues via
              CloudFront CDN ou URLs assinadas S3 com suporte a HTTP Range (ou streaming direto do
              servidor enquanto as chaves{' '}
              <code className="font-mono">AWS_ACCESS_KEY_ID</code> e{' '}
              <code className="font-mono">AWS_SECRET_ACCESS_KEY</code> não estiverem definidas nos
              Segredos do servidor).
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
          {(() => {
            const supabaseRef =
              state.supabase.projectUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ||
              'jpllpvfunpsqexnvjgdt';
            const hasAnonOrEnv = Boolean(
              overview?.envStatus.supabaseKeysEnv || state.supabase.anonKey?.trim()
            );
            const isMissingKeyState = !hasAnonOrEnv;
            const statusText =
              state.supabase.lastStatus === 'Online (Sem chave anon)'
                ? 'Falta chave pública (anon)'
                : state.supabase.lastStatus ||
                  (hasAnonOrEnv ? 'Chave configurada' : 'Falta chave pública (anon)');
            return (
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
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      state.supabase.lastStatus === 'Conectado (Pronto)'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : isMissingKeyState
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                    }`}
                  >
                    {statusText}
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
                      Chave Pública Supabase (anon / publishable)
                    </span>
                    <div
                      className={`flex items-center gap-2 rounded-xl border px-3 ${
                        isMissingKeyState
                          ? 'border-amber-400/70 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-950/20'
                          : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
                      }`}
                    >
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <input
                        type={showSupabaseAnonKey ? 'text' : 'password'}
                        value={state.supabase.anonKey || ''}
                        onChange={(e) =>
                          setOverview((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  state: {
                                    ...prev.state,
                                    supabase: {
                                      ...prev.state.supabase,
                                      anonKey: e.target.value,
                                    },
                                  },
                                }
                              : prev
                          )
                        }
                        placeholder="Cole aqui sua chave sb_publishable_... ou eyJ..."
                        className="h-10 w-full bg-transparent font-mono text-xs text-zinc-950 focus:outline-none dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSupabaseAnonKey((v) => !v)}
                        aria-label={showSupabaseAnonKey ? 'Ocultar chave' : 'Mostrar chave'}
                        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        {showSupabaseAnonKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Cole aqui a chave pública <strong>anon / publishable</strong> (nunca{' '}
                      <code className="font-mono">service_role</code> ou{' '}
                      <code className="font-mono">sb_secret_</code>). Para ativar para todos os
                      visitantes em hospedagem estática, defina também{' '}
                      <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> no build do site.
                    </span>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Schema PostgreSQL <span className="font-normal text-zinc-400">(padrão: public)</span>
                    </span>
                    <input
                      type="text"
                      value={state.supabase.schemaName}
                      onChange={(e) => {
                        const val = e.target.value;
                        const trimmed = val.trim();
                        if (isSupabaseApiKeyLike(trimmed)) {
                          if (isServiceRoleOrSecretKey(trimmed)) {
                            const warn =
                              'Você colou uma chave secreta (service_role/sb_secret) no campo Schema! Use apenas a chave pública no campo acima.';
                            setSupabaseTestStatus(warn);
                            showToast(warn);
                            return;
                          }
                          setOverview((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  state: {
                                    ...prev.state,
                                    supabase: {
                                      ...prev.state.supabase,
                                      schemaName: 'public',
                                      anonKey: trimmed,
                                    },
                                  },
                                }
                              : prev
                          );
                          showToast(
                            'Chave pública movida automaticamente para o campo "Chave Pública Supabase"!'
                          );
                          return;
                        }
                        setOverview((prev) =>
                          prev
                            ? {
                                ...prev,
                                state: {
                                  ...prev.state,
                                  supabase: {
                                    ...prev.state.supabase,
                                    schemaName: val,
                                  },
                                },
                              }
                            : prev
                        );
                      }}
                      placeholder="public"
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                    />
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Deixe como <code className="font-mono">public</code> — não cole chaves de API aqui.
                    </span>
                  </label>
                </div>

                {isMissingKeyState && (
                  <div className="space-y-2.5 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="font-semibold">
                      Seu Supabase está online! Faltam 2 passos rápidos para gravar usuários reais:
                    </p>
                    <ol className="list-inside list-decimal space-y-1 text-[11px] text-amber-900 dark:text-amber-200">
                      <li>
                        Abra as chaves do projeto <code className="font-mono">{supabaseRef}</code>,
                        copie a chave <strong>anon / public</strong> (ou <strong>Publishable</strong>)
                        e cole no campo acima.
                      </li>
                      <li>
                        Clique em <strong>Salvar Supabase</strong> → <strong>Copiar SQL</strong> e
                        execute no <strong>SQL Editor</strong> do Supabase.
                      </li>
                    </ol>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={`https://supabase.com/dashboard/project/${supabaseRef}/settings/api`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-[11px] font-semibold text-white hover:bg-amber-800 dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300"
                      >
                        <span>1. Pegar Chave anon no Supabase</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={`https://supabase.com/dashboard/project/${supabaseRef}/sql/new`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-800/30 bg-white/80 px-3 text-[11px] font-semibold text-amber-950 hover:bg-white dark:border-amber-400/30 dark:bg-zinc-900/80 dark:text-amber-100"
                      >
                        <span>2. Abrir SQL Editor</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}

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
                  {hasAnonOrEnv ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      Chave Supabase configurada! Novos usuários reais são gravados em{' '}
                      <code className="font-mono">{state.supabase.schemaName}.lumina_users</code>.
                    </span>
                  ) : (
                    <>
                      Aguardando sua <strong>Chave Pública (anon / publishable)</strong> acima para
                      ativar o cadastro direto no projeto{' '}
                      <code className="font-mono">{supabaseRef}</code>.
                    </>
                  )}
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
                    disabled={syncingSupabase || !state.supabase.projectUrl.trim()}
                    onClick={() => void syncSupabaseNow()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingSupabase ? 'animate-spin' : ''}`} />
                    <span>{syncingSupabase ? 'Sincronizando...' : 'Sincronizar usuários'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopySupabaseSql()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 px-3.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copiar SQL</span>
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
            );
          })()}
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
                onClick={() =>
                  persistSiteRulesAndFlags({
                    announcementBanner: state.site.announcementBanner,
                    maintenanceMode: state.site.maintenanceMode,
                  })
                }
                className="h-10 w-full rounded-xl bg-zinc-950 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
              >
                Aplicar no site
              </button>
            </section>

            {!authStatus.envConfigured && (
              <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-zinc-950 dark:text-white">
                      Senha Administrativa ({ADMIN_EMAIL})
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Gere ou altere a senha de acesso ao painel para esta conta.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const generated = generateStrongPasscode();
                      setNewAdminPasscode(generated);
                      setShowNewAdminPasscode(true);
                      showToast('Nova senha gerada. Clique em Salvar nova senha.');
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Gerar senha</span>
                  </button>
                </div>

                <form onSubmit={handleRotateAdminPasscode} className="space-y-2.5">
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <KeyRound className="h-4 w-4 text-zinc-400" />
                    <input
                      type={showNewAdminPasscode ? 'text' : 'password'}
                      value={newAdminPasscode}
                      onChange={(e) => setNewAdminPasscode(e.target.value)}
                      placeholder="Nova senha de ADM (mín. 6 caracteres)"
                      className="h-10 flex-1 bg-transparent font-mono text-xs text-zinc-950 focus:outline-none dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewAdminPasscode((v) => !v)}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      {showNewAdminPasscode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    {newAdminPasscode && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(newAdminPasscode);
                          showToast('Senha copiada');
                        }}
                        className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={updatingAdminPasscode}
                    className="h-10 w-full rounded-xl bg-sky-600 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {updatingAdminPasscode ? 'Salvando...' : 'Salvar nova senha de ADM'}
                  </button>
                </form>
              </section>
            )}

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
