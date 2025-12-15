<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/esphome-api.js';
  import { loadPreferences, savePreferences, getSystemTimezone } from './lib/preferences.js';
  import { buildTimezoneGroups } from './lib/timezones.js';
  import { formatTime, rgbToHex, hexToRgb } from './lib/format.js';
  import { getNumeric, getBoolean, getText } from './lib/entities.js';
  import { updateOverview } from './dom/overview.js';
  import { setupSettingsSheet } from './dom/settings.js';
  import { setupControlModals } from './dom/modals.js';

  const ALERTS = [
    { id: 'humidity_control_failure', msg: 'Humidity control failure detected' },
    { id: 'i2c_communication_failure', msg: 'Sensor communication issue' },
    { id: 'fan_start_failure', msg: 'Air exchange fan failed to start' },
    { id: 'temperature_too_low', msg: 'Temperature is below the safe range' },
    { id: 'temperature_too_high', msg: 'Temperature is above the safe range' }
  ];

  type ConnectionStatus = 'connecting' | 'streaming' | 'polling' | 'offline';
  type ConnectionState = { status: ConnectionStatus; detail: string };

  const CONNECTION_META: Record<ConnectionStatus, { detail: string }> = {
    connecting: { detail: 'Connecting to realtime updates…' },
    streaming: { detail: 'Realtime link established.' },
    polling: { detail: 'Polling device snapshots…' },
    offline: { detail: 'Device offline — showing cached data.' }
  };

  const BASE_POLL_MS = 5000;
  const MAX_POLL_MS = 15000;
  const RECONNECT_INTERVAL_MS = 15000;

  const SYSTEM_TIME_ZONE = getSystemTimezone();
  const localHosts = ['localhost', '127.0.0.1', ''];
  const FIRMWARE_CATALOG_CACHE_KEY = 'openshrooly.firmwareCatalog.v1';
  const APP_BASE_URL =
    typeof window !== 'undefined'
      ? new URL(import.meta.env.BASE_URL, window.location.origin)
      : null;

  const CONTROL_MODAL_IDS = ['humidity', 'temperature', 'air', 'light', 'water'] as const;
  type ControlModalId = (typeof CONTROL_MODAL_IDS)[number];
  type ModalId = 'settings' | ControlModalId;
  const MODAL_QUERY_PARAM = 'modal';

  function appPath(relativePath: string) {
    if (!APP_BASE_URL) return relativePath;
    const cleaned = relativePath.replace(/^\//, '');
    return new URL(cleaned, APP_BASE_URL).pathname;
  }

  function parseModalId(value: string | null): ModalId | null {
    if (!value) return null;
    if (value === 'settings') return 'settings';
    if ((CONTROL_MODAL_IDS as readonly string[]).includes(value)) {
      return value as ControlModalId;
    }
    return null;
  }

  function getModalFromUrl(): ModalId | null {
    if (typeof window === 'undefined') return null;
    return parseModalId(new URL(window.location.href).searchParams.get(MODAL_QUERY_PARAM));
  }

  function updateUrlModal(modal: ModalId | null, mode: 'push' | 'replace' = 'push') {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (modal) {
      url.searchParams.set(MODAL_QUERY_PARAM, modal);
    } else {
      url.searchParams.delete(MODAL_QUERY_PARAM);
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (mode === 'replace') {
      window.history.replaceState({}, '', nextUrl);
    } else {
      window.history.pushState({}, '', nextUrl);
    }
  }

  let timezone = $state(loadPreferences().timezone || SYSTEM_TIME_ZONE || 'America/Denver');
  let firmwareAutoCheck = $state(loadPreferences().firmwareAutoCheck ?? true);
  let calibrationSuccess = $state(false);
  let otaFile = $state<File | null>(null);
  let otaProgress = $state(0);
  let otaStatus = $state<'idle' | 'uploading' | 'success' | 'error'>('idle');
  let otaMessage = $state('');
  let activeModal = $state<ModalId | null>(null);
  let footerQuote = $state<{ text: string; author?: string | null } | null>(null);

  function openModal(modal: ModalId) {
    calibrationSuccess = false;
    activeModal = modal;
    updateUrlModal(modal, 'push');
    applyModalToDom(modal);
  }

  function closeModalIfActive(modal: ModalId) {
    if (activeModal !== modal) return;
    activeModal = null;
    updateUrlModal(null, 'replace');
    applyModalToDom(null);
  }

  function applyModalToDom(modal: ModalId | null) {
    if (modal === 'settings') {
      CONTROL_MODAL_IDS.forEach((modalId) => controlModals?.close?.(modalId));
      settingsSheet?.show?.();
      return;
    }

    settingsSheet?.close?.();

    if (modal) {
      CONTROL_MODAL_IDS.forEach((modalId) => {
        if (modalId === modal) controlModals?.show?.(modalId);
        else controlModals?.close?.(modalId);
      });
      return;
    }

    CONTROL_MODAL_IDS.forEach((modalId) => controlModals?.close?.(modalId));
  }

  type FirmwareReleaseOption = {
    id: string;
    tagName: string;
    title: string;
    assetName: string;
    downloadUrl: string;
    size: number;
    publishedAt: string | null;
    isPrerelease: boolean;
  };

  type FirmwareReleaseOptionGroup = {
    label: string;
    options: FirmwareReleaseOption[];
  };

  let firmwareReleaseOptions = $state<FirmwareReleaseOptionGroup[]>([]);
  let selectedFirmwareRelease = $state('');
  let firmwareReleaseLoading = $state(false);
  let firmwareReleaseDownloading = $state(false);
  let firmwareReleaseError = $state('');
  let firmwareReleaseStatus = $state('');
  let firmwareCatalogRateLimitedOn = $state<string | null>(null);
  let firmwareCatalogLastFetchedOn = $state<string | null>(null);
  let firmwareCatalogLastFetchedIso = $state<string | null>(null);
  let firmwareCatalogAutoFetchedOn: string | null = null;

  let entities = $state<Record<string, any>>({});
  let loading = $state(true);
  let connection = $state<ConnectionState>({
    status: 'connecting',
    detail: CONNECTION_META.connecting.detail
  });
  let lastUpdate = $state<Date | null>(null);
  let isOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
  let banner = $state<{ tone: 'positive' | 'warning' | 'critical'; message: string } | null>(null);

  let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  let eventSource: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let initialSnapshotTaken = false;
  let retryDelay = BASE_POLL_MS;

  let settingsSheet: ReturnType<typeof setupSettingsSheet> | null = null;
  let controlModals: ReturnType<typeof setupControlModals> | null = null;

  let mounted = $state(false);
  let bootstrapped = false;

  async function ensureSpriteLoaded() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('#icon-sprite')) return;
    try {
      const response = await fetch(appPath('icons/sprite.svg'));
      if (!response.ok) return;
      const markup = await response.text();
      const wrapper = document.createElement('div');
      wrapper.id = 'icon-sprite';
      wrapper.style.display = 'none';
      wrapper.innerHTML = markup;
      document.body.prepend(wrapper);
    } catch (error) {
      console.warn('[icons] Failed to load sprite', error);
    }
  }

  function stopEventStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function stopReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function stopAllConnectivity() {
    stopEventStream();
    stopPolling();
    stopReconnect();
  }

  function clearDebounceTimers() {
    Object.values(debounceTimers).forEach((timer) => {
      if (timer) clearTimeout(timer);
    });
    debounceTimers = {};
  }

  function snapshotTimezone(snapshot: Record<string, any>) {
    const tz = snapshot['select-timezone_select']?.state;
    if (tz) {
      timezone = tz;
    }
  }

  function realtimeTimezone(event: any) {
    if (event?.id === 'select-timezone_select' && event.state) {
      timezone = event.state;
    }
  }

  function normalizeEntityKey(key: string) {
    return typeof key === 'string' ? key.replace(/[.]/g, '-') : key;
  }

  function mergeEntities(patch: Record<string, any>) {
    const normalized: Record<string, any> = {};
    Object.entries(patch).forEach(([key, value]) => {
      const normalizedKey = normalizeEntityKey(key);
      if (!normalizedKey) return;
      const nextValue =
        value && typeof value === 'object'
          ? { ...(entities[normalizedKey] ?? {}), ...value }
          : value;
      if (nextValue && typeof nextValue === 'object' && 'state' in nextValue) {
        const incoming = /** @type {Record<string, any>} */ (value ?? {});
        nextValue.value = incoming.value !== undefined ? incoming.value : nextValue.state;
      }
      normalized[normalizedKey] = nextValue;
    });
    if (Object.keys(normalized).length === 0) return;
    entities = { ...entities, ...normalized };
  }

  function blockControlsIfUnavailable(message?: string) {
    if (!isOnline || connection.status === 'offline') {
      banner = {
        tone: 'warning',
        message:
          message ||
          'Controls are disabled while the device is offline. Viewing cached data only.'
      };
      return true;
    }
    return false;
  }

  async function refreshSnapshot({ silent = false }: { silent?: boolean } = {}) {
    try {
      const snapshot = await api.fetchSnapshot();
      mergeEntities(snapshot);
      snapshotTimezone(snapshot);
      lastUpdate = new Date();
      if (!initialSnapshotTaken) {
        initialSnapshotTaken = true;
        loading = false;
      }
      if (connection.status === 'offline') {
        connection = { status: 'polling', detail: CONNECTION_META.polling.detail };
      }
      if (!silent) {
        banner = { tone: 'positive', message: 'Dashboard updated just now.' };
      }
      return true;
    } catch (error) {
      console.error('Snapshot failed', error);
      connection = { status: 'offline', detail: CONNECTION_META.offline.detail };
      if (!initialSnapshotTaken) {
        initialSnapshotTaken = true;
        loading = false;
      }
      if (!silent) {
        banner = {
          tone: 'critical',
          message:
            'Could not reach the device. Controls are disabled until the connection returns.'
        };
      }
      return false;
    }
  }

  function startPolling(detail = CONNECTION_META.polling.detail) {
    stopEventStream();
    stopPolling();
    retryDelay = BASE_POLL_MS;
    connection = { status: 'polling', detail };

    const poll = async () => {
      const ok = await refreshSnapshot({ silent: true });
      retryDelay = ok ? BASE_POLL_MS : Math.min(MAX_POLL_MS, retryDelay * 2);
      pollTimer = setTimeout(poll, retryDelay);
    };

    poll();

    stopReconnect();
    reconnectTimer = setTimeout(() => {
      if (!isOnline) return;
      startEventStream({ retry: true });
    }, RECONNECT_INTERVAL_MS);
  }

  function startEventStream({ retry = false }: { retry?: boolean } = {}) {
    stopEventStream();
    if (!isOnline) return;

    const detail = retry
      ? 'Re-establishing realtime connection…'
      : CONNECTION_META.connecting.detail;
    connection = { status: 'connecting', detail };

    const eventSourceInstance = api.subscribeToEvents((event: any) => {
      if (!event?.id) return;
      mergeEntities({
        [event.id]: {
          value: event.value !== undefined ? event.value : event.state === 'ON',
          state: event.state
        }
      });
      realtimeTimezone(event);
      lastUpdate = new Date();
      banner = null;
    });

    if (!eventSourceInstance) {
      startPolling('Realtime channel unavailable. Falling back to snapshots.');
      return;
    }

    eventSource = eventSourceInstance;
    eventSource.onopen = () => {
      stopPolling();
      stopReconnect();
      connection = { status: 'streaming', detail: CONNECTION_META.streaming.detail };
      if (!initialSnapshotTaken) {
        refreshSnapshot({ silent: true });
      }
    };
    eventSource.onerror = () => {
      console.warn('EventSource error — switching to snapshot mode');
      startPolling('Realtime channel interrupted. Using 5 s snapshots while retrying…');
    };
  }

  function handleOfflineChange(online: boolean) {
    isOnline = online;
    if (!online) {
      stopAllConnectivity();
      connection = { status: 'offline', detail: CONNECTION_META.offline.detail };
      banner = {
        tone: 'warning',
        message: 'You appear to be offline. The dashboard is running on cached data.'
      };
    } else if (bootstrapped) {
      banner = null;
      stopAllConnectivity();
      refreshSnapshot({ silent: true });
      startEventStream({ retry: true });
    }
  }

  async function loadRandomQuote() {
    try {
      const response = await fetch(appPath('quotes.json'));
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return;
      const pick = data[Math.floor(Math.random() * data.length)];
      if (pick?.text && mounted) {
        footerQuote = { text: pick.text, author: pick.author ?? null };
      }
    } catch (error) {
      console.warn('[quote] load failed', error);
    }
  }

  const releaseDateFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const catalogStatusFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  function findFirmwareOption(id: string): FirmwareReleaseOption | undefined {
    for (const group of firmwareReleaseOptions) {
      const match = group.options.find((option) => option.id === id);
      if (match) return match;
    }
    return undefined;
  }

  function formatReleaseOptionTitle(tagName: string, publishedAt: string | null, isPrerelease: boolean) {
    const date = publishedAt ? releaseDateFormatter.format(new Date(publishedAt)) : null;
    const suffix = isPrerelease ? ' (pre-release)' : '';
    return date ? `${tagName} · ${date}${suffix}` : `${tagName}${suffix}`;
  }

  const formatDateKey = (date: Date) => date.toISOString().split('T')[0];

  type ParsedSemver = { major: number; minor: number; patch: number };

  function parseSemver(value: string | null | undefined): ParsedSemver | null {
    if (!value) return null;
    const cleaned = value.trim().replace(/^v/i, '');
    const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;

    const major = Number(match[1] ?? 0);
    const minor = Number(match[2] ?? 0);
    const patch = Number(match[3] ?? 0);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
    return { major, minor, patch };
  }

  function compareSemver(a: ParsedSemver, b: ParsedSemver) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  }

  function persistFirmwareCatalogCache() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const payload = {
        fetchedAt: firmwareCatalogLastFetchedIso,
        options: firmwareReleaseOptions,
        selectedId: selectedFirmwareRelease,
        status: firmwareReleaseStatus,
        rateLimitedOn: firmwareCatalogRateLimitedOn
      } satisfies {
        fetchedAt: string | null;
        options: FirmwareReleaseOptionGroup[];
        selectedId: string;
        status: string;
        rateLimitedOn: string | null;
      };
      localStorage.setItem(FIRMWARE_CATALOG_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[firmware] cache persistence failed', error);
    }
  }

  function applyFirmwareCatalogCache() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(FIRMWARE_CATALOG_CACHE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.options)) {
          firmwareReleaseOptions = payload.options as FirmwareReleaseOptionGroup[];
        }
        if (typeof payload.fetchedAt === 'string') {
          firmwareCatalogLastFetchedIso = payload.fetchedAt;
          firmwareCatalogLastFetchedOn = formatDateKey(new Date(payload.fetchedAt));
          firmwareCatalogAutoFetchedOn = firmwareCatalogLastFetchedOn;
        }
        if (typeof payload.rateLimitedOn === 'string') {
          firmwareCatalogRateLimitedOn = payload.rateLimitedOn;
        }
        if (typeof payload.status === 'string' && payload.status) {
          firmwareReleaseStatus = payload.status;
        }
        if (typeof payload.selectedId === 'string') {
          selectedFirmwareRelease = payload.selectedId;
        }
      }
    } catch (error) {
      console.warn('[firmware] cache restore failed', error);
    }
  }

  applyFirmwareCatalogCache();

  async function loadFirmwareReleaseCatalog(
    options: { force?: boolean; trigger?: 'auto' | 'manual' } = {}
  ) {
    const { force = false, trigger = 'auto' } = options;
    const now = new Date();
    const todayKey = formatDateKey(now);

    if (firmwareCatalogRateLimitedOn === todayKey) {
      firmwareReleaseError = 'GitHub rate limit reached earlier today. Try again tomorrow.';
      firmwareReleaseStatus = '';
      persistFirmwareCatalogCache();
      return;
    }

    const hasFreshCatalog =
      firmwareCatalogLastFetchedOn === todayKey && firmwareReleaseOptions.length > 0;

    if (trigger === 'auto') {
      if (firmwareCatalogAutoFetchedOn === todayKey) {
        return;
      }
      firmwareCatalogAutoFetchedOn = todayKey;
      if (hasFreshCatalog && !force) {
        return;
      }
    }

    if (firmwareReleaseLoading) return;

    const previousOptions = firmwareReleaseOptions;
    if (force) {
      firmwareReleaseOptions = [];
    }

    firmwareReleaseLoading = true;
    firmwareReleaseError = '';

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      const base = 'https://api.github.com/repos/grahamsz/openshrooly';

      const [latestResponse, releasesResponse] = await Promise.all([
        fetch(`${base}/releases/latest`, { headers }),
        fetch(`${base}/releases?per_page=15`, { headers })
      ]);

      if (latestResponse.status === 403 || releasesResponse.status === 403) {
        firmwareCatalogRateLimitedOn = todayKey;
        firmwareReleaseError = 'GitHub rate limit reached. Try again tomorrow.';
        firmwareReleaseStatus = '';
        persistFirmwareCatalogCache();
        return;
      }

      if (!latestResponse.ok) {
        throw new Error(`Latest release request failed (${latestResponse.status})`);
      }
      if (!releasesResponse.ok) {
        throw new Error(`Release list request failed (${releasesResponse.status})`);
      }

      const latest = await latestResponse.json();
      const releases: any[] = await releasesResponse.json();

      const stable: FirmwareReleaseOption[] = [];
      const prerelease: FirmwareReleaseOption[] = [];

      const pushRelease = (release: any) => {
        if (!release || typeof release !== 'object') return;
        const assets: any[] = Array.isArray(release.assets) ? release.assets : [];
        const otaAsset = assets.find((asset) =>
          typeof asset?.name === 'string' && /\.ota\.bin$/i.test(asset.name)
        );
        if (!otaAsset || typeof otaAsset.browser_download_url !== 'string') return;

        const option: FirmwareReleaseOption = {
          id: String(release.id ?? `${release.tag_name}-${release.published_at}`),
          tagName: release.tag_name ?? release.name ?? 'Unknown',
          title: formatReleaseOptionTitle(
            release.tag_name ?? release.name ?? 'Unknown',
            release.published_at ?? null,
            Boolean(release.prerelease)
          ),
          assetName: otaAsset.name,
          downloadUrl: otaAsset.browser_download_url,
          size: typeof otaAsset.size === 'number' ? otaAsset.size : 0,
          publishedAt: release.published_at ?? null,
          isPrerelease: Boolean(release.prerelease)
        };

        if (option.isPrerelease) prerelease.push(option);
        else stable.push(option);
      };

      pushRelease(latest);
      releases.forEach((release) => pushRelease(release));

      const dedupe = (list: FirmwareReleaseOption[]) => {
        const seen = new Set<string>();
        return list.filter((item) => {
          const key = `${item.tagName}-${item.assetName}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      const stableUnique = dedupe(stable);
      const prereleaseUnique = dedupe(prerelease);

      const groups: FirmwareReleaseOptionGroup[] = [];
      if (stableUnique.length) {
        groups.push({ label: 'Latest', options: [stableUnique[0]] });
        if (stableUnique.length > 1) {
          groups.push({ label: 'Earlier Releases', options: stableUnique.slice(1) });
        }
      }
      if (prereleaseUnique.length) {
        groups.push({ label: 'Pre-release', options: prereleaseUnique });
      }

      firmwareReleaseOptions = groups;

      const previousSelection = selectedFirmwareRelease;
      const firstAvailable =
        (previousSelection && findFirmwareOption(previousSelection)) ||
        stableUnique[0] ||
        prereleaseUnique[0] ||
        null;

      firmwareCatalogLastFetchedOn = todayKey;
      firmwareCatalogLastFetchedIso = now.toISOString();
      firmwareCatalogRateLimitedOn = null;

      const refreshedStatement = `Catalog refreshed ${catalogStatusFormatter.format(now)}.`;

      if (firstAvailable) {
        selectedFirmwareRelease = firstAvailable.id;
        handleFirmwareReleaseSelect(firstAvailable.id);
      } else if (groups.length) {
        firmwareReleaseStatus = `${refreshedStatement} Select a firmware release and click “Download” to open the OTA binary.`;
      } else {
        firmwareReleaseStatus = `${refreshedStatement} No GitHub releases with OTA binaries were found.`;
      }

      if (!firstAvailable) {
        persistFirmwareCatalogCache();
      }
    } catch (error) {
      firmwareReleaseOptions = previousOptions;
      firmwareReleaseError =
        error instanceof Error ? error.message : 'Failed to load releases from GitHub.';
      firmwareReleaseStatus = '';
      persistFirmwareCatalogCache();
    } finally {
      firmwareReleaseLoading = false;
    }
  }
  function handleFirmwareReleaseSelect(id: string) {
    selectedFirmwareRelease = id;
    firmwareReleaseError = '';
    const selection = findFirmwareOption(id);
    if (selection) {
      const sizeMb = selection.size ? (selection.size / (1024 * 1024)).toFixed(2) : null;
      const refreshedSuffix = firmwareCatalogLastFetchedIso
        ? ` (catalog refreshed ${catalogStatusFormatter.format(
            new Date(firmwareCatalogLastFetchedIso)
          )})`
        : '';
      const baseStatus = `Selected ${selection.tagName}${
        sizeMb ? ` • ${sizeMb} MB` : ''
      }.`;
      firmwareReleaseStatus = `${baseStatus}${refreshedSuffix}`;
    }
    persistFirmwareCatalogCache();
  }

  async function handleFirmwareReleaseDownload() {
    if (blockControlsIfUnavailable('Cannot download firmware while offline.')) return;
    if (!selectedFirmwareRelease) {
      firmwareReleaseError = 'Select a release first.';
      return;
    }

    const selected = findFirmwareOption(selectedFirmwareRelease);
    if (!selected) {
      firmwareReleaseError = 'Selected release is no longer available.';
      return;
    }

    firmwareReleaseDownloading = true;
    firmwareReleaseError = '';
    firmwareReleaseStatus = `Preparing ${selected.assetName}…`;

    try {
      const downloadOrigin = (() => {
        try {
          return new URL(selected.downloadUrl).origin;
        } catch {
          return null;
        }
      })();

      if (downloadOrigin && downloadOrigin === window.location.origin) {
        const response = await fetch(selected.downloadUrl, {
          headers: { Accept: 'application/octet-stream' }
        });
        if (!response.ok) {
          throw new Error(`Download failed (${response.status})`);
        }
        const blob = await response.blob();
        let file: File;
        if (typeof File === 'function') {
          file = new File([blob], selected.assetName, {
            type: blob.type || 'application/octet-stream'
          });
        } else {
          // Fallback for environments without File constructor support
          const fallback = blob.slice(0, blob.size, blob.type || 'application/octet-stream');
          (fallback as any).name = selected.assetName;
          file = fallback as unknown as File;
        }
        selectFirmwareFile(file);
        firmwareReleaseStatus = `Loaded ${selected.tagName}. Firmware ready to upload.`;
        return;
      }

      firmwareReleaseStatus = `Opening ${selected.assetName} in a new tab…`;
      const opened = window.open(selected.downloadUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        firmwareReleaseError = `Your browser blocked the download tab. Open this URL manually: ${selected.downloadUrl}`;
        firmwareReleaseStatus = '';
        return;
      }

      firmwareReleaseStatus =
        'Download started. Once complete, choose the .bin file below and click “Upload firmware”.';
    } catch (error) {
      firmwareReleaseError =
        error instanceof Error ? error.message : 'Failed to download firmware binary.';
      firmwareReleaseStatus = '';
    } finally {
      firmwareReleaseDownloading = false;
    }
  }

  function selectFirmwareFile(file: File | null) {
    otaFile = file;
    otaStatus = 'idle';
    otaMessage = '';
    otaProgress = 0;
  }

  function resetFirmwareQueue() {
    otaFile = null;
    otaStatus = 'idle';
    otaProgress = 0;
    otaMessage = '';
  }

  async function handleOtaUpload() {
    if (blockControlsIfUnavailable('Cannot upload firmware while offline.')) return;
    if (!otaFile) {
      otaMessage = 'Please select a firmware file before uploading.';
      otaStatus = 'error';
      return;
    }

    otaStatus = 'uploading';
    otaProgress = 0;
    otaMessage = 'Uploading firmware…';

    try {
      const formData = new FormData();
      formData.append('file', otaFile);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            otaProgress = (event.loaded / event.total) * 100;
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            otaStatus = 'success';
            otaMessage = 'Firmware uploaded. The device will reboot shortly.';
            otaProgress = 100;
            setTimeout(() => {
              otaStatus = 'idle';
              otaFile = null;
              otaProgress = 0;
              otaMessage = '';
            }, 5000);
            resolve();
          } else {
            otaStatus = 'error';
            otaMessage = `Upload failed: ${xhr.statusText}`;
            reject(new Error(xhr.statusText));
          }
        });
        xhr.addEventListener('error', () => {
          otaStatus = 'error';
          otaMessage = 'Upload failed due to a network error.';
          reject(new Error('network'));
        });
        xhr.open('POST', '/update');
        xhr.send(formData);
      });
    } catch (error) {
      otaStatus = 'error';
      otaMessage = `Upload failed: ${error}`;
    }
  }

  async function handleNumberChange(id: string, value: string | number) {
    if (blockControlsIfUnavailable()) return;
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;
    const key = `number-${id}`;
    const existing = entities[key] || {};
    entities = {
      ...entities,
      [key]: { ...existing, value: numericValue, state: numericValue }
    };
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(async () => {
      const ok = await api.setNumber(id, numericValue);
      if (!ok) {
        banner = {
          tone: 'critical',
          message: `Failed to update ${id.replace(/_/g, ' ')}. Please try again.`
        };
      }
    }, 250);
  }

  async function handleButtonClick(buttonId: string) {
    if (blockControlsIfUnavailable()) return;
    const ok = await api.pressButton(buttonId);
    if (!ok) {
      banner = {
        tone: 'critical',
        message: `Failed to run action ${buttonId.replace(/_/g, ' ')}.`
      };
    }
  }

  async function handleSwitchChange(id: string, checked: boolean) {
    if (blockControlsIfUnavailable()) return;
    const key = `switch-${id}`;
    const existing = entities[key] || {};
    entities = {
      ...entities,
      [key]: {
        ...existing,
        state: checked ? 'ON' : 'OFF',
        value: checked
      }
    };
    const ok = await api.setSwitch(id, checked);
    if (!ok) {
      banner = {
        tone: 'critical',
        message: `Failed to update ${id.replace(/_/g, ' ')}.`
      };
    }
  }

  async function handleSelectChange(id: string, option: string) {
    if (blockControlsIfUnavailable()) return;
    const ok = await api.setSelect(id, option);
    if (ok) {
      const key = `select-${id}`;
      entities = {
        ...entities,
        [key]: { ...(entities[key] || {}), state: option }
      };
    } else {
      banner = {
        tone: 'critical',
        message: `Failed to update ${id.replace(/_/g, ' ')}.`
      };
    }
  }

  async function handleTimezoneChange(tz: string) {
    timezone = tz;
    if (blockControlsIfUnavailable()) return;
    await handleSelectChange('timezone_select', tz);
  }

  function handleLightColorChange(hex: string) {
    const rgb = hexToRgb(hex);
    handleNumberChange('red_led_intensity', rgb.r);
    handleNumberChange('green_led_intensity', rgb.g);
    handleNumberChange('blue_led_intensity', rgb.b);
  }

  function handleWaterCalibration() {
    if (blockControlsIfUnavailable('Cannot calibrate while offline.')) return;
    handleButtonClick('calibrate_dry_tank');
    setTimeout(() => {
      handleButtonClick('calibrate_dry_tank');
      calibrationSuccess = true;
      setTimeout(() => {
        calibrationSuccess = false;
      }, 8000);
    }, 500);
  }

  function handleOpenFirmwareSettings() {
    loadFirmwareReleaseCatalog({ trigger: 'manual' });
    const section = document.querySelector('[data-settings-ota]');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleOpenFirmwareSettingsFromHeader() {
    openModal('settings');
    requestAnimationFrame(() => handleOpenFirmwareSettings());
  }

  function handleCalibrateFromSettings() {
    if (blockControlsIfUnavailable()) return;
    openModal('water');
  }

  function handleManageTrustedDevices() {
    const node = document.querySelector('[data-settings-trusted]');
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleToggleBle(value: boolean) {
    handleSwitchChange('ble_enabled', value);
  }

  function number(type: string, id: string, fallback = Number.NaN) {
    return getNumeric(entities, type, id, fallback);
  }

  function bool(type: string, id: string) {
    return getBoolean(entities, type, id);
  }

  function text(id: string, fallback = '') {
    return getText(entities, id, fallback);
  }

  function hasEntity(type: string, id: string) {
    return Boolean(entities[`${type}-${id}`]);
  }

  let controlsDisabled = $derived(!isOnline || connection.status === 'offline');

  let viewOnlyMessage = $derived(
    controlsDisabled
      ? 'Device offline — controls stay read-only until connectivity returns.'
      : ''
  );

  let humidity = $derived(
    number('sensor', 'humidity') || number('sensor', 'current_humidity')
  );
  let targetHumidity = $derived(number('number', 'target_humidity', 70));
  let humidityHysteresis = $derived(number('number', 'humidity__hysteresis', 2));
  let humidifierSpeed = $derived(number('number', 'humidifier__speed', 80));

  let temperature = $derived(
    number('sensor', 'temperature') || number('sensor', 'current_temperature')
  );
  let tempTarget = $derived(number('number', 'temperature__target', 22));
  let tempHysteresis = $derived(number('number', 'temperature__hysteresis', 1));
  let tempControlEnabled = $derived(bool('switch', 'temperature_control_enabled'));
  let tempMin = $derived(tempControlEnabled ? tempTarget - tempHysteresis : 0);
  let tempMax = $derived(tempControlEnabled ? tempTarget + tempHysteresis : 0);

  let waterLevel = $derived.by(() => {
    const primary = number('sensor', 'water_level_percent');
    if (Number.isFinite(primary)) return primary;
    const fallbackValue = number('sensor', 'water_level');
    return Number.isFinite(fallbackValue) ? fallbackValue : Number.NaN;
  });

  let systemVoltage = $derived(number('sensor', 'system_voltage', Number.NaN));
  let fanRpm = $derived(number('sensor', 'current_air_exchange_fan_speed', Number.NaN));

  let lightsSunrise = $derived(number('number', 'lights__sunrise_hour', 8));
  let lightsDuration = $derived(number('number', 'lights__duration__hours_', 12));
  let lightsSunset = $derived((lightsSunrise + lightsDuration) % 24);
  let luxValue = $derived(number('number', 'white_led_intensity', Number.NaN));
  let currentColor = $derived(
    rgbToHex(
      number('number', 'red_led_intensity', 0),
      number('number', 'green_led_intensity', 0),
      number('number', 'blue_led_intensity', 0)
    )
  );
  let lightsOn = $derived.by(() => {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    if (lightsDuration <= 0) return false;
    if (lightsSunrise < lightsSunset) {
      return currentHour >= lightsSunrise && currentHour < lightsSunset;
    }
    return currentHour >= lightsSunrise || currentHour < lightsSunset;
  });

  let tempWarningMin = $derived(number('number', 'temperature__warning_minimum', 18));
  let tempWarningMax = $derived(number('number', 'temperature__warning_maximum', 30));

  let humidifierOn = $derived(
    bool('switch', 'humidifier') || bool('binary_sensor', 'humidifier_on')
  );
  let airExchangeOn = $derived(
    bool('switch', 'air_exchange') || bool('binary_sensor', 'air_exchange_on')
  );
  let heatRequested = $derived(bool('binary_sensor', 'heat_requested'));
  let bleEnabled = $derived(bool('switch', 'ble_enabled'));

  let timezoneGroups = $derived(buildTimezoneGroups(timezone));
  let timezoneShortLabel = $derived.by(() => {
    const flat = timezoneGroups.flatMap((group) => group.options);
    const match = flat.find((option) => option.value === timezone);
    return match ? match.shortLabel : timezone;
  });

  let wifiMode = $derived(text('wifi_mode') || 'Unknown');
  let wifiSSID = $derived(text('wifi_ssid') || 'Unknown');
  let ipAddress = $derived(text('ip_address') || 'Unavailable');
  let calibrationStatus = $derived(text('calibration_status') || '');
  let airExchangeStatusText = $derived(text('air_exchange_status') || '');

  let ventGuardMinutes = $derived(number('number', 'temperature__vent_holdoff_minutes', 5));
  let airExchangePeriod = $derived(number('number', 'air_exchange__cycle_minutes', 30));
  let airExchangeDuration = $derived(number('number', 'air_exchange__run_minutes', 5));
  let fanTargetRpm = $derived(number('number', 'air_exchange__target_rpm', 1500));
  let airExchangeHoldoff = $derived(number('number', 'air_exchange__holdoff_minutes', 10));
  let airExchangeBoost = $derived(number('number', 'air_exchange__boost_threshold', 2));

  let lightsMode = $derived(entities['select-lighting_mode']?.state || 'daylight');
  let licensesText = $derived(text('licenses') || 'License list not yet reported by the device.');
  let firmwareVersion = $derived(text('firmware_version', '—'));

  let latestFirmwareRelease = $derived.by(() => {
    const latest = firmwareReleaseOptions.find((group) => group.label === 'Latest')?.options?.[0];
    return latest ?? null;
  });

  let firmwareUpdateAvailable = $derived.by(() => {
    const latest = latestFirmwareRelease;
    if (!latest) return false;
    const currentSemver = parseSemver(firmwareVersion);
    const latestSemver = parseSemver(latest.tagName);
    if (!currentSemver || !latestSemver) return false;
    return compareSemver(latestSemver, currentSemver) > 0;
  });

  let showFirmwareUpdateButton = $derived.by(() => {
    if (import.meta.env.DEV) return true;
    if (typeof window === 'undefined') return false;
    return firmwareUpdateAvailable || localHosts.includes(window.location.hostname);
  });

  let voltageDisplay = $derived(
    Number.isFinite(systemVoltage) ? `${systemVoltage.toFixed(2)} V` : '--'
  );

  let lastUpdateDisplay = $derived(
    lastUpdate
      ? lastUpdate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'No data yet'
  );

  let alerts = $derived(
    ALERTS.filter((alert) => bool('binary_sensor', `alert__${alert.id}`)).map((alert) => ({
      id: `alert-${alert.id}`,
      tone: 'critical' as const,
      message: `⚠️ ${alert.msg}`
    }))
  );

  let reservoirCalibrated = $derived(bool('binary_sensor', 'water_calibrated'));

  let fanSpeedDisplay = $derived(
    Number.isFinite(fanRpm) ? `${fanRpm.toFixed(0)} RPM` : '—'
  );

  let overviewSnapshot = $derived.by(() => ({
    sensors: {
      temperature: {
        hasValue: Number.isFinite(temperature),
        value: Number.isFinite(temperature) ? `${temperature.toFixed(1)}°C` : null,
        detail: tempControlEnabled
          ? `Comfort ${tempMin.toFixed(1)}°–${tempMax.toFixed(1)}°`
          : 'Guard disabled'
      },
      humidity: {
        hasValue: Number.isFinite(humidity),
        value: Number.isFinite(humidity) ? `${humidity.toFixed(1)}%` : null,
        detail: `Target ${targetHumidity.toFixed(1)}% · ±${humidityHysteresis.toFixed(1)}%`
      },
      'ambient-light': {
        hasValue: Number.isFinite(luxValue),
        value: Number.isFinite(luxValue) ? `${luxValue.toFixed(0)} lux` : null,
        detail: `Sunrise ${formatTime(lightsSunrise)} · Sunset ${formatTime(lightsSunset)}`
      },
      reservoir: {
        hasValue: Number.isFinite(waterLevel),
        value: Number.isFinite(waterLevel) ? `${waterLevel.toFixed(0)}%` : null,
        detail: calibrationStatus || 'Tap to calibrate'
      }
    },
    controls: {
      humidifier: {
        isActive: Boolean(humidifierOn),
        isAvailable:
          hasEntity('switch', 'humidifier') || hasEntity('binary_sensor', 'humidifier_on'),
        detail: `Target ${targetHumidity.toFixed(1)}% · ±${humidityHysteresis.toFixed(1)}%`
      },
      'air-exchange': {
        isActive: Boolean(airExchangeOn),
        isAvailable:
          hasEntity('switch', 'air_exchange') || hasEntity('binary_sensor', 'air_exchange_on'),
        detail:
          airExchangeStatusText ||
          (airExchangeOn
            ? `Cycle ${airExchangeDuration.toFixed(0)} min / ${airExchangePeriod.toFixed(0)} min`
            : 'Idle')
      },
      'heat-guard': {
        isActive: Boolean(heatRequested || tempControlEnabled),
        isAvailable:
          hasEntity('switch', 'temperature_control_enabled') ||
          hasEntity('binary_sensor', 'heat_requested'),
        detail: tempControlEnabled
          ? `Guard ${tempMin.toFixed(1)}°–${tempMax.toFixed(1)}°`
          : 'Guard disabled'
      },
      lighting: {
        isActive: Boolean(lightsOn),
        isAvailable:
          hasEntity('select', 'lighting_mode') || hasEntity('number', 'white_led_intensity'),
        detail: `${lightsMode === 'daylight' ? 'Daylight' : 'Custom'} scene`
      },
      reservoir: {
        isActive: Boolean(reservoirCalibrated || calibrationSuccess),
        isAvailable:
          hasEntity('sensor', 'water_level_percent') || hasEntity('sensor', 'water_level'),
        detail: calibrationSuccess
          ? 'Calibration request sent.'
          : calibrationStatus || (reservoirCalibrated ? 'Calibrated recently.' : 'Tap to calibrate')
      }
    }
  }));

  let toastMessages = $derived([
    ...alerts,
    ...(banner ? [{ id: 'banner', tone: banner.tone, message: banner.message }] : [])
  ]);

  $effect(() => {
    const previous = loadPreferences();
    const next = { ...previous };
    let changed = false;

    if (previous.timezone !== timezone) {
      next.timezone = timezone;
      changed = true;
    }

    const previousFirmwareAutoCheck =
      typeof previous.firmwareAutoCheck === 'boolean' ? previous.firmwareAutoCheck : true;
    if (previousFirmwareAutoCheck !== firmwareAutoCheck) {
      next.firmwareAutoCheck = firmwareAutoCheck;
      changed = true;
    }

    if (changed) {
      savePreferences(next);
    }
  });

  $effect(() => {
    if (!mounted || !firmwareAutoCheck) return;
    loadFirmwareReleaseCatalog({ trigger: 'auto' });
  });

  $effect(() => {
    if (!banner) return;
    const timeout = setTimeout(() => {
      banner = null;
    }, 6000);
    return () => clearTimeout(timeout);
  });

  function updateSettingsSheetView() {
    if (!settingsSheet) return;
    settingsSheet.update({
      controlsDisabled,
      timezoneLabel: timezoneShortLabel,
      timezoneOptions: timezoneGroups,
      timezoneValue: timezone,
      lastSnapshot: lastUpdateDisplay,
      voltageDisplay,
      fanSpeedDisplay,
      wifiMode,
      wifiSSID,
      ipAddress,
      bleEnabled,
      calibrationStatus,
      calibrationSuccess,
      licenseText: licensesText,
      firmwareVersion,
      firmwareReleaseOptions,
      selectedFirmwareRelease,
      firmwareReleaseLoading,
      firmwareReleaseDownloading,
      firmwareReleaseError,
      firmwareReleaseStatus,
      otaFile,
      otaStatus,
      otaMessage,
      otaProgress
    });
  }

  $effect(() => {
    updateSettingsSheetView();
  });

  $effect(() => {
    if (!settingsSheet) return;
    const isDialogOpen = settingsSheet.isOpen?.() ?? false;
    const shouldBeOpen = activeModal === 'settings';
    if (shouldBeOpen && !isDialogOpen) {
      settingsSheet.show?.();
    } else if (!shouldBeOpen && isDialogOpen) {
      settingsSheet.close?.();
    }
  });

  $effect(() => {
    const modals = controlModals;
    if (!modals) return;
    CONTROL_MODAL_IDS.forEach((modalId) => {
      if (activeModal === modalId) {
        modals.show?.(modalId);
      } else {
        modals.close?.(modalId);
      }
    });
  });

  function updateControlModalsView() {
    if (!controlModals) return;
    controlModals.update({
      controlsDisabled,
      viewOnlyMessage,
      humidity: {
        targetHumidity,
        humidityHysteresis,
        humidifierSpeed
      },
      temperature: {
        tempTarget,
        tempHysteresis,
        tempWarningMin,
        tempWarningMax,
        ventHoldMinutes: ventGuardMinutes,
        tempControlEnabled
      },
      air: {
        airExchangePeriod,
        airExchangeDuration,
        fanTargetRpm,
        airExchangeHoldoff,
        airExchangeBoost
      },
      lighting: {
        lightsMode,
        lightsSunrise,
        lightsDuration,
        luxValue,
        currentColor
      },
      water: {
        calibrationStatus,
        calibrationSuccess,
        reservoirCalibrated
      }
    });
  }

  $effect(() => {
    updateControlModalsView();
  });

  $effect(() => {
    if (!mounted || loading) return;
    updateOverview({
      sensors: overviewSnapshot.sensors,
      controls: overviewSnapshot.controls,
      offline: connection.status === 'offline',
      controlsDisabled,
      lastUpdate,
      quote: footerQuote
    });
  });

  $effect(() => {
    if (!mounted) return;
    const badge = document.querySelector('[data-connection-badge]');
    const labelEl = document.querySelector('[data-connection-label]');
    if (!badge || !labelEl) return;

    const status = connection.status;
    badge.setAttribute('data-status', status);
    const labelMap = {
      streaming: 'Live',
      offline: 'Offline',
      polling: 'Snapshot',
      connecting: 'Connecting'
    } as const;
    const label = labelMap[status] || 'Connecting';
    labelEl.textContent = label;
    const useEl = badge.querySelector('use');
    if (useEl) {
      const iconName =
        status === 'streaming'
          ? 'fluent-emoji-flat:green-circle'
          : status === 'offline'
          ? 'fluent-emoji-flat:broken-chain'
          : 'fluent-emoji-flat:yellow-circle';
      const symbolId = `#icon-${iconName.replace(/[:]/g, '-')}`;
      useEl.setAttribute('href', symbolId);
    }
  });

  onMount(() => {
    const shouldPreferAppBase = !localHosts.includes(window.location.hostname);
    if (shouldPreferAppBase && APP_BASE_URL?.pathname && window.location.pathname === '/') {
      window.location.replace(`${APP_BASE_URL.pathname}${window.location.search}${window.location.hash}`);
      return;
    }

    mounted = true;
    document.body.classList.add('loaded');
    ensureSpriteLoaded();

    const shouldUseServiceWorker = !localHosts.includes(window.location.hostname);
    if ('serviceWorker' in navigator) {
      if (shouldUseServiceWorker) {
        const swUrl = new URL(
          'service-worker.js',
          new URL(import.meta.env.BASE_URL, window.location.origin)
        );
        navigator.serviceWorker
          .register(swUrl.pathname)
          .catch((error) =>
            console.error('[PWA] Service worker registration failed', error)
          );
      } else {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => {
            registrations.forEach((registration) => registration.unregister());
          })
          .catch(() => {});
      }
    }

    const onOnline = () => handleOfflineChange(true);
    const onOffline = () => handleOfflineChange(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const onPopState = () => {
      const modal = getModalFromUrl();
      activeModal = modal;
      applyModalToDom(modal);
    };
    window.addEventListener('popstate', onPopState);

    settingsSheet = setupSettingsSheet({
      onClose: () => closeModalIfActive('settings'),
      onOpenFirmware: handleOpenFirmwareSettings,
      onToggleBle: (value: boolean) => handleToggleBle(value),
      onCalibrate: handleCalibrateFromSettings,
      onManageTrusted: handleManageTrustedDevices,
      onTimezoneChange: (tz: string) => handleTimezoneChange(tz),
      onOtaSelect: (file: File | null) => selectFirmwareFile(file),
      onOtaUpload: () => handleOtaUpload(),
      onOtaClear: () => resetFirmwareQueue(),
      onOtaReleaseSelect: (id: string) => handleFirmwareReleaseSelect(id),
      onOtaReleaseLoad: () => handleFirmwareReleaseDownload(),
      onOtaReleaseRefresh: () => loadFirmwareReleaseCatalog({ force: true, trigger: 'manual' })
    });
    updateSettingsSheetView();

    controlModals = setupControlModals({
      onNumberChange: (id: string, value: string) => handleNumberChange(id, value),
      onSwitchChange: (id: string, value: boolean) => handleSwitchChange(id, value),
      onSelectChange: (id: string, value: string) => handleSelectChange(id, value),
      onColorChange: (value: string) => handleLightColorChange(value),
      onCalibrate: () => handleWaterCalibration(),
      onClose: (id: string) => {
        calibrationSuccess = false;
        const modalId = parseModalId(id);
        if (modalId && modalId !== 'settings') {
          closeModalIfActive(modalId);
        }
      }
    });
    updateControlModalsView();

    const triggers = Array.from(document.querySelectorAll('[data-modal]'));
    const handleOpen = (event: Event) => {
      const trigger = event.currentTarget as HTMLElement | null;
      const modalId = parseModalId(trigger?.dataset?.modal ?? null);
      if (!modalId) return;
      event.preventDefault();
      openModal(modalId);
    };
    triggers.forEach((node) => node.addEventListener('click', handleOpen));
    activeModal = getModalFromUrl();
    applyModalToDom(activeModal);

    const bootstrap = async () => {
      const ok = await refreshSnapshot({ silent: true });
      if (!ok) {
        connection = { status: 'connecting', detail: 'Retrying snapshot…' };
      }
      startEventStream();
      bootstrapped = true;
    };

	    bootstrap();
	    loadRandomQuote();

	    return () => {
	      mounted = false;
	      bootstrapped = false;
      document.body.classList.remove('loaded');
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('popstate', onPopState);
      triggers.forEach((node) => node.removeEventListener('click', handleOpen));
      stopAllConnectivity();
      clearDebounceTimers();
      settingsSheet?.close();
      settingsSheet = null;
      controlModals?.destroy?.();
      controlModals = null;
    };
  });
</script>

    <noscript>This dashboard requires JavaScript.</noscript>
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8 lg:px-10">
      <header class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <h1 class="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
              OpenShrooly
            </h1>
            <span
              class="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-sm font-medium text-slate-600 backdrop-blur"
              data-connection-badge
            >
              <span class="inline-flex h-5 w-5 items-center justify-center text-slate-400 group-data-[status=streaming]:text-emerald-500 group-data-[status=offline]:text-red-500 group-data-[status=polling]:text-amber-500 group-data-[status=connecting]:text-amber-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-yellow-circle"></use>
                </svg>
              </span>
              <span
                class="font-semibold text-slate-600 group-data-[status=streaming]:text-emerald-600 group-data-[status=offline]:text-red-600 group-data-[status=polling]:text-amber-600 group-data-[status=connecting]:text-amber-600"
                data-connection-label
              >
                Connecting
              </span>
            </span>
          </div>
          <div class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1.5 shadow-sm backdrop-blur">
            <a
              class="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              aria-label="Help &amp; docs"
              href="https://openshrooly.com/docs/"
              rel="noreferrer"
              target="_blank"
	            >
	              <span class="icon-[lucide--help-circle] text-[1.2rem]" aria-hidden="true"></span>
	            </a>
	            {#if showFirmwareUpdateButton}
	              <button
	                type="button"
	                class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
	                aria-label="Open firmware update"
	                onclick={handleOpenFirmwareSettingsFromHeader}
	              >
	                <span class="icon-[lucide--cloud-download] text-[1.2rem]" aria-hidden="true"></span>
	              </button>
	            {/if}
	            <button
	              type="button"
	              class="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
	              aria-label="Open settings"
	              data-open-settings
	              onclick={() => openModal('settings')}
	            >
	              <span class="icon-[lucide--sliders-horizontal] text-[1.2rem]" aria-hidden="true"></span>
	            </button>
	          </div>
	        </div>
	      </header>
      <main class="flex flex-1 flex-col gap-8">
        <div class="flex flex-col gap-8">
          <section class="flex flex-col gap-6" aria-labelledby="section-overview" data-overview>
            <div class="flex items-baseline justify-between">
              <div>
                <h2 id="section-overview">Environment</h2>
              </div>
            </div>
            <div class="flex flex-wrap gap-2.5">
              <button
                type="button"
                class="flex w-[10.5rem] items-center gap-2 rounded-full bg-transparent px-3 py-2 text-left transition data-[available=false]:opacity-60 hover:bg-indigo-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                data-sensor="temperature"
                data-modal="temperature"
              >
                <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
                  <svg class="h-5 w-5" aria-hidden="true">
                    <use href="#icon-fluent-emoji-flat-thermometer"></use>
                  </svg>
                </span>
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="text-sm font-medium text-slate-500">Temperature</span>
                  <span class="text-base font-semibold text-slate-900" data-field="value">—</span>
                </span>
              </button>
              <button
                type="button"
                class="flex w-[10.5rem] items-center gap-2 rounded-full bg-transparent px-3 py-2 text-left transition data-[available=false]:opacity-60 hover:bg-indigo-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                data-sensor="humidity"
                data-modal="humidity"
              >
                <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
                  <svg class="h-5 w-5" aria-hidden="true">
                    <use href="#icon-fluent-emoji-flat-water-wave"></use>
                  </svg>
                </span>
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="text-sm font-medium text-slate-500">Humidity</span>
                  <span class="text-base font-semibold text-slate-900" data-field="value">—</span>
                </span>
              </button>
              <button
                type="button"
                class="flex w-[10.5rem] items-center gap-2 rounded-full bg-transparent px-3 py-2 text-left transition data-[available=false]:opacity-60 hover:bg-indigo-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                data-sensor="ambient-light"
                data-modal="light"
              >
                <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
                  <svg class="h-5 w-5" aria-hidden="true">
                    <use href="#icon-fluent-emoji-flat-glowing-star"></use>
                  </svg>
                </span>
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="text-sm font-medium text-slate-500">Ambient light</span>
                  <span class="text-base font-semibold text-slate-900" data-field="value">—</span>
                </span>
              </button>
              <button
                type="button"
                class="flex w-[10.5rem] items-center gap-2 rounded-full bg-transparent px-3 py-2 text-left transition data-[available=false]:opacity-60 hover:bg-indigo-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                data-sensor="reservoir"
                data-modal="water"
              >
                <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-500">
                  <svg class="h-5 w-5" aria-hidden="true">
                    <use href="#icon-fluent-emoji-flat-droplet"></use>
                  </svg>
                </span>
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="text-sm font-medium text-slate-500">Reservoir</span>
                  <span class="text-base font-semibold text-slate-900" data-field="value">—</span>
                </span>
              </button>
            </div>

          <div class="mx-auto flex w-full max-w-5xl flex-wrap gap-3.5">
            <button
              type="button"
              class="flex w-[14rem] items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 data-[available=false]:opacity-60 hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-control="humidifier"
              data-modal="humidity"
            >
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-shower"></use>
                </svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="text-sm font-semibold text-slate-700">Humidifier</span>
                <span class="text-xs text-slate-500" data-field="detail">Standby</span>
              </span>
            </button>
            <button
              type="button"
              class="flex w-[14rem] items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 data-[available=false]:opacity-60 hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-control="air-exchange"
              data-modal="air"
            >
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-wind-face"></use>
                </svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="text-sm font-semibold text-slate-700">Air exchange</span>
                <span class="text-xs text-slate-500" data-field="detail">Idle</span>
              </span>
            </button>
            <button
              type="button"
              class="flex w-[14rem] items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 data-[available=false]:opacity-60 hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-control="heat-guard"
              data-modal="temperature"
            >
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-fire"></use>
                </svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="text-sm font-semibold text-slate-700">Heat assist</span>
                <span class="text-xs text-slate-500" data-field="detail">Guard disabled</span>
              </span>
            </button>
            <button
              type="button"
              class="flex w-[14rem] items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 data-[available=false]:opacity-60 hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-control="lighting"
              data-modal="light"
            >
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-glowing-star"></use>
                </svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="text-sm font-semibold text-slate-700">Lighting</span>
                <span class="text-xs text-slate-500" data-field="detail">Daylight scene</span>
              </span>
            </button>
            <button
              type="button"
              class="flex w-[14rem] items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition data-[active=true]:border-indigo-400 data-[active=true]:bg-indigo-50 data-[available=false]:opacity-60 hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-control="reservoir"
              data-modal="water"
            >
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" aria-hidden="true">
                  <use href="#icon-fluent-emoji-flat-droplet"></use>
                </svg>
              </span>
              <span class="flex min-w-0 flex-1 flex-col text-left">
                <span class="text-sm font-semibold text-slate-700">Reservoir</span>
                <span class="text-xs text-slate-500" data-field="detail">Tap to calibrate</span>
              </span>
            </button>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" role="note" data-quote>
            <p class="text-base text-slate-700" data-quote-text>“Inspiration on standby.”</p>
            <p class="mt-2 text-sm text-slate-500" data-quote-author></p>
          </div>
        </section>
        </div>

        <div id="dashboard-root">
          {#if loading}
            <div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-300 bg-white/60 p-12 text-slate-500">
              <div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
              <p>Connecting to OpenShrooly…</p>
            </div>
          {:else}
            <div class="relative">
              {#if toastMessages.length}
                <div class="fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3" aria-live="polite">
                  {#each toastMessages as toast}
                    <div
                      class={`${
                        toast.tone === 'positive'
                          ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-lg'
                          : toast.tone === 'warning'
                          ? 'rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-lg'
                          : toast.tone === 'critical'
                          ? 'rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-lg'
                          : 'rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900 shadow-lg'
                      }`}
                      role="status"
                    >
                      <span>{toast.message}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </main>
    </div>
	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-settings-dialog>
	      <div class="flex flex-col" data-settings-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Settings</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-settings-close
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6" data-settings-body>
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-settings-viewonly hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>

            <section class="flex flex-col gap-4" aria-labelledby="settings-device">
              <header class="flex flex-col gap-1">
                <h2 id="settings-device" class="text-lg font-semibold text-slate-900">
                  Device &amp; Time
                </h2>
                <p class="text-sm text-slate-500">Identify your controller and schedule context</p>
              </header>
              <div class="flex flex-col divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-toolbox"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Device</span>
                      <span class="text-xs text-slate-500">OpenShrooly hardware</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600">
                    <span>OpenShrooly</span>
                  </div>
                </div>
                <button class="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50 cursor-pointer" data-settings-timezone>
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-globe-with-meridians"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Timezone</span>
                      <span class="text-xs text-slate-500">Align automation windows to your locale</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600">
                    <span data-settings-timezone-label>—</span>
                  </div>
                  <select class="sr-only" hidden data-settings-timezone-select></select>
                </button>
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-calendar"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Last snapshot</span>
                      <span class="text-xs text-slate-500">Latest full sync from the device</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600" data-settings-last-snapshot>—</div>
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-4" aria-labelledby="settings-environment">
              <header class="flex flex-col gap-1">
                <h2 id="settings-environment" class="text-lg font-semibold text-slate-900">
                  Power &amp; Environment
                </h2>
                <p class="text-sm text-slate-500">Live readings that influence automation</p>
              </header>
              <div class="flex flex-col divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-battery"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Input voltage</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600" data-settings-voltage>—</div>
                </div>
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-leaf-fluttering-in-wind"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Air exchange fan</span>
                      <span class="text-xs text-slate-500">Latest measured RPM</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600" data-settings-fan>—</div>
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-4" aria-labelledby="settings-connectivity">
              <header class="flex flex-col gap-1">
                <h2 id="settings-connectivity" class="text-lg font-semibold text-slate-900">
                  Connectivity
                </h2>
                <p class="text-sm text-slate-500">How the dashboard reaches your unit</p>
              </header>
              <div class="flex flex-col divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-antenna-bars"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Wi‑Fi</span>
                      <span class="text-xs text-slate-500" data-settings-wifi-mode>—</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600" data-settings-wifi-ssid>—</div>
                </div>
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-desktop-computer"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">IP address</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium text-slate-600" data-settings-ip>—</div>
                </div>
                <div class="flex items-center justify-between gap-4 px-5 py-4">
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-satellite-antenna"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">BLE service</span>
                      <span class="text-xs text-slate-500">Expose sensors and controls over BLE</span>
                    </div>
                  </div>
                  <div>
                    <label class="relative inline-flex h-6 w-11 items-center">
                      <input
                        type="checkbox"
                        class="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                        data-settings-ble-toggle
                      />
                      <span
                        aria-hidden="true"
                        class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600"
                      ></span>
                      <span
                        aria-hidden="true"
                        class="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5"
                      ></span>
                    </label>
                  </div>
                </div>
                <button class="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50 cursor-pointer" data-settings-trusted>
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-handshake"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Trusted BLE devices</span>
                      <span class="text-xs text-slate-500">Pair or forget nearby clients</span>
                    </div>
                  </div>
                  <div class="text-sm font-semibold text-indigo-600"><span>Manage</span></div>
                </button>
              </div>
            </section>

            <section class="flex flex-col gap-4" aria-labelledby="settings-maintenance">
              <header class="flex flex-col gap-1">
                <h2 id="settings-maintenance" class="text-lg font-semibold text-slate-900">
                  Maintenance
                </h2>
                <p class="text-sm text-slate-500">Tools for upkeep and safety</p>
              </header>
              <div class="flex flex-col divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button class="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50 cursor-pointer" data-settings-calibrate>
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-test-tube"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Calibrate reservoir</span>
                      <span class="text-xs text-slate-500">Request a fresh dry-tank calibration</span>
                    </div>
                  </div>
                  <div class="text-sm font-semibold text-indigo-600"><span>Start</span></div>
                </button>

                <button class="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50 cursor-pointer" data-settings-open-firmware>
                  <div class="flex flex-1 items-center gap-3 text-left">
                    <svg class="h-5 w-5 text-slate-500" aria-hidden="true">
                      <use href="#icon-fluent-emoji-flat-gear"></use>
                    </svg>
                    <div class="flex flex-col">
                      <span class="text-sm font-semibold text-slate-700">Firmware tools</span>
                      <span class="text-xs text-slate-500">Jump to OTA and release management</span>
                    </div>
                  </div>
                  <div class="text-sm font-semibold text-indigo-600"><span>Open</span></div>
                </button>
              </div>
            </section>

            <section class="flex flex-col gap-4" data-settings-calibration-status hidden>
              <div class="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800" data-settings-calibration-message></div>
            </section>

            <section class="flex flex-col gap-4" data-settings-license>
              <header class="flex flex-col gap-1">
                <h2 class="text-lg font-semibold text-slate-900">Licenses</h2>
                <p class="text-sm text-slate-500">Open-source notices</p>
              </header>
              <div class="flex flex-col gap-2">
                <button class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" type="button" data-settings-toggle-license>
                  Show licenses
                </button>
                <pre class="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600" data-settings-license-content hidden></pre>
              </div>
            </section>

	            <section class="flex flex-col gap-4" data-settings-ota>
	              <header class="flex flex-col gap-1">
	                <h2 class="text-lg font-semibold text-slate-900">Firmware update (OTA)</h2>
	                <p class="text-sm text-slate-500">Upload ESPHome binary</p>
	              </header>
              <div class="flex flex-col gap-3">
                <div class="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div class="flex flex-wrap items-center gap-4 px-5 py-4">
	                    <div class="flex min-w-0 flex-1 flex-col text-left">
	                      <span class="text-sm font-semibold text-slate-700">GitHub releases</span>
	                      <span class="text-xs font-medium text-slate-600" data-settings-ota-current-version>Current firmware: —</span>
	                      <div class="mt-2 flex flex-wrap items-center gap-3">
	                        <span class="text-xs font-medium text-slate-600">Auto-check updates</span>
	                        <label class="relative inline-flex h-6 w-11 items-center">
	                          <input
	                            type="checkbox"
	                            class="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
	                            aria-label="Auto-check firmware updates"
	                            bind:checked={firmwareAutoCheck}
	                          />
	                          <span
	                            aria-hidden="true"
	                            class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600"
	                          ></span>
	                          <span
	                            aria-hidden="true"
	                            class="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5"
	                          ></span>
	                        </label>
	                      </div>
	                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="relative w-full min-w-[12rem] md:w-auto">
                        <select
                          id="ota-release-select"
                          class="appearance-none w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                          data-settings-ota-release
                        ></select>
                        <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                      </div>
                      <button
                        class="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        type="button"
                        data-settings-ota-release-load
                      >
                        Download
                      </button>
                      <button
                        class="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        type="button"
                        data-settings-ota-release-refresh
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div class="border-t border-slate-100 px-5 py-3 text-xs text-slate-500" data-settings-ota-release-status hidden></div>
                  <div class="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs font-semibold text-amber-700" data-settings-ota-release-error hidden></div>
                </div>
                <input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  type="file"
                  accept=".bin"
                  data-settings-ota-file
                />
                <p class="text-xs text-slate-500" data-settings-ota-fileinfo hidden></p>
                <div class="flex flex-wrap items-center gap-3">
                  <button class="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" type="button" data-settings-ota-upload>
                    Upload firmware
                  </button>
                  <button class="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" type="button" data-settings-ota-clear>
                    Clear selection
                  </button>
                </div>
	                <div class="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900" data-settings-ota-status hidden>
	                  <span data-settings-ota-message></span>
	                  <progress max="100" value="0" data-settings-ota-progress hidden></progress>
	                </div>
	              </div>
	            </section>
	        </div>
	      </div>
	    </dialog>
	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-control-dialog="humidity">
	      <div class="flex flex-col" data-control-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Humidity Control</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-control-close="humidity"
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6">
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-control-viewonly="humidity" hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="humidity-target">Target humidity (%)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="humidity-target"
                type="number"
                min="60"
                max="95"
                step="0.5"
                data-control-input="target_humidity"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="humidity-hysteresis">Hysteresis (± %)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="humidity-hysteresis"
                type="number"
                min="0"
                max="5"
                step="0.25"
                data-control-input="humidity__hysteresis"
              />
            </div>
            <div class="flex flex-col gap-2">
              <span class="text-sm font-medium text-slate-600">Presets</span>
              <div class="flex flex-wrap gap-2">
                <button class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow" type="button" data-control-preset data-target="70" data-hysteresis="1">
                  Precision · 70% ±1%
                </button>
                <button class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow" type="button" data-control-preset data-target="68" data-hysteresis="2">
                  Balanced · 68% ±2%
                </button>
                <button class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow" type="button" data-control-preset data-target="65" data-hysteresis="3">
                  Eco · 65% ±3%
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="humidity-speed">
                Humidifier fan speed · <span data-control-display="humidifier__speed">80%</span>
              </label>
              <input
                class="w-full accent-indigo-600"
                id="humidity-speed"
                type="range"
                min="40"
                max="100"
                step="5"
                data-control-input="humidifier__speed"
              />
	              <p class="text-xs text-slate-500">
	                Higher speeds add humidity faster but increase noise and water consumption.
	              </p>
	            </div>
	        </div>
	      </div>
	    </dialog>

	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-control-dialog="temperature">
	      <div class="flex flex-col" data-control-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Temperature Guard</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-control-close="temperature"
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6">
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-control-viewonly="temperature" hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>
            <div class="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <label class="relative inline-flex h-6 w-11 items-center">
                <input
                  type="checkbox"
                  class="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  data-control-switch="temperature_control_enabled"
                />
                <span
                  aria-hidden="true"
                  class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600"
                ></span>
                <span
                  aria-hidden="true"
                  class="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5"
                ></span>
              </label>
              <span class="flex flex-col text-left text-sm font-medium text-slate-600" data-control-temperature-summary>
                Maintain comfort range
              </span>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-slate-600" for="temperature-target">Target (°C)</label>
                <input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="temperature-target"
                  type="number"
                  min="10"
                  max="35"
                  step="0.5"
                  data-control-input="temperature__target"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-slate-600" for="temperature-hysteresis">Hysteresis (°C)</label>
                <input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="temperature-hysteresis"
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.5"
                  data-control-input="temperature__hysteresis"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-slate-600" for="temperature-warning-min">Warning minimum (°C)</label>
                <input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="temperature-warning-min"
                  type="number"
                  min="5"
                  max="25"
                  step="0.5"
                  data-control-input="temperature__warning_minimum"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-slate-600" for="temperature-warning-max">Warning maximum (°C)</label>
                <input
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="temperature-warning-max"
                  type="number"
                  min="15"
                  max="40"
                  step="0.5"
                  data-control-input="temperature__warning_maximum"
                />
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="temperature-vent-hold">Fan hold-off (minutes)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="temperature-vent-hold"
                type="number"
                min="1"
                max="15"
                step="1"
                data-control-input="temperature__vent_holdoff_minutes"
              />
	              <p class="text-xs text-slate-500">
	                Prevents cold drafts from affecting readings immediately after venting.
	              </p>
	            </div>
	        </div>
	      </div>
	    </dialog>

	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-control-dialog="air">
	      <div class="flex flex-col" data-control-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Air Exchange Routine</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-control-close="air"
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6">
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-control-viewonly="air" hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="air-period">Cycle every (minutes)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="air-period"
                type="number"
                min="10"
                max="240"
                step="5"
                data-control-input="air_exchange__cycle_minutes"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="air-duration">Run duration (minutes)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="air-duration"
                type="number"
                min="1"
                max="60"
                step="1"
                data-control-input="air_exchange__run_minutes"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="air-rpm">Fan RPM target</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="air-rpm"
                type="number"
                min="800"
                max="3000"
                step="50"
                data-control-input="air_exchange__target_rpm"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="air-holdoff">Pause after humidifying (minutes)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="air-holdoff"
                type="number"
                min="0"
                max="60"
                step="1"
                data-control-input="air_exchange__holdoff_minutes"
              />
              <p class="text-xs text-slate-500">
	                Prevents the fan from fighting humidity recovery right after a misting cycle.
	              </p>
	            </div>
	            <div class="flex flex-col gap-2">
	              <label class="text-sm font-medium text-slate-600" for="air-boost">Boost when humidity &gt; target (%)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="air-boost"
                type="number"
                min="0"
                max="10"
                step="0.5"
	                data-control-input="air_exchange__boost_threshold"
	              />
	            </div>
	        </div>
	      </div>
	    </dialog>

	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-control-dialog="light">
	      <div class="flex flex-col" data-control-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Lighting Schedule</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-control-close="light"
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6">
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-control-viewonly="light" hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>
            <div class="flex flex-col gap-2">
              <span class="text-sm font-medium text-slate-600">Lighting mode</span>
              <div class="flex flex-wrap gap-2" data-control-lighting-modes>
                <button
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow"
                  type="button"
                  data-control-mode
                  data-value="daylight"
                >
                  Daylight
                </button>
                <button
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow"
                  type="button"
                  data-control-mode
                  data-value="evening"
                >
                  Evening glow
                </button>
                <button
                  class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 data-[active=true]:border-indigo-500 data-[active=true]:bg-indigo-600 data-[active=true]:text-white data-[active=true]:shadow"
                  type="button"
                  data-control-mode
                  data-value="sleep"
                >
                  Sleep
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="light-sunrise">Sunrise</label>
              <select
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="light-sunrise"
                data-control-select="lights__sunrise_hour"
              ></select>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="light-duration">Duration (hours)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="light-duration"
                type="number"
                min="1"
                max="24"
                step="0.25"
                data-control-input="lights__duration__hours_"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="light-lux">Canopy brightness (lux)</label>
              <input
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                id="light-lux"
                type="number"
                min="0"
                max="4000"
                step="10"
                data-control-input="white_led_intensity"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-slate-600" for="light-color">Accent color</label>
	              <input
	                class="h-12 w-24 cursor-pointer rounded-lg border border-slate-300 bg-white shadow-sm"
	                id="light-color"
	                type="color"
	                data-control-color
	              />
	            </div>
	        </div>
	      </div>
	    </dialog>

	    <dialog class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl open:fixed open:left-1/2 open:top-1/2 open:z-50 open:m-0 open:w-[calc(100vw-2rem)] open:-translate-x-1/2 open:-translate-y-1/2 open:max-h-[90vh] open:overflow-y-auto sm:open:w-auto" data-control-dialog="water">
	      <div class="flex flex-col" data-control-container>
	        <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
	          <h2 class="text-xl font-semibold text-slate-900">Water Reservoir</h2>
	          <button
	            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	            aria-label="Close"
	            type="button"
	            data-control-close="water"
	          >
	            <span class="icon-[lucide--x] text-[1.35rem]" aria-hidden="true"></span>
	          </button>
	        </div>
	        <div class="flex flex-col gap-6 p-6">
	            <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" data-control-viewonly="water" hidden>
	              Device offline — controls stay read-only until connectivity returns.
	            </div>
            <p class="text-sm text-slate-500">
              Empty and dry the reservoir, then start the calibration routine.
            </p>
            <div class="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800" data-control-water-status hidden></div>
            <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" data-control-water-success hidden>
              Calibration request sent.
            </div>
	            <button
	              class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
	              type="button"
	              data-control-action="calibrate_water"
	            >
	              Calibrate empty reservoir
	            </button>
	        </div>
	      </div>
	    </dialog>
