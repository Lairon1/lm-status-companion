import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings as SettingsIcon, RefreshCw, Play, AlertCircle, Loader2, Wifi, WifiOff, Clock, FileJson, ChevronDown, Settings2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SoundId = "happy" | "67" | "svin" | "goida";

const SOUNDS: { id: SoundId; label: string; url: string }[] = [
  { id: "happy", label: "🎉 Хапи хапи хапиии", url: "https://www.myinstants.com/media/sounds/happy-happy-happy-song.mp3" },
  { id: "67", label: "🔥 67", url: "https://www.myinstants.com/media/sounds/gazan-67-bisvidi.mp3" },
  { id: "svin", label: "🐷 Визг свина", url: "https://www.myinstants.com/media/sounds/vizg-svini.mp3" },
  { id: "goida", label: "⚔️ Гойда", url: "https://www.myinstants.com/media/sounds/goida_hRZ6vDr.mp3" },
];

type Settings = {
  address: string;
  port: string;
  apiVersion: string;
  login: string;
  password: string;
  token: string;
  refreshInterval: number;
  notificationsEnabled: boolean;
  notificationVolume: number;
  notificationSound: SoundId;
  autoRefresh: boolean;
};

const DEFAULTS: Settings = {
  address: "127.0.0.1",
  port: "5995",
  apiVersion: "v2",
  login: "admin",
  password: "admin",
  token: "",
  refreshInterval: 10,
  notificationsEnabled: true,
  notificationVolume: 0.8,
  notificationSound: "happy",
  autoRefresh: false,
};


const SETTINGS_KEY = "lm4z_settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: Settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...s, savedAt: new Date().toISOString() }),
  );
}

function playNotification(s: Settings) {
  if (!s.notificationsEnabled) return;
  const sound = SOUNDS.find((x) => x.id === s.notificationSound) ?? SOUNDS[0];
  try {
    const audio = new Audio(sound.url);
    audio.crossOrigin = "anonymous";
    const vol = Math.max(0, s.notificationVolume);
    if (vol <= 1) {
      audio.volume = vol;
      audio.play().catch((e) => console.error("Audio play error", e));
      return;
    }
    // Volume > 100% via Web Audio GainNode
    audio.volume = 1;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(gain).connect(ctx.destination);
    audio.addEventListener("ended", () => ctx.close().catch(() => {}));
    audio.play().catch((e) => console.error("Audio play error", e));
  } catch (e) {
    console.error("Notification error", e);
  }
}


const STATUS_META: Record<string, { label: string; color: string; emoji: string }> = {
  ready: { label: "Готово", color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400", emoji: "✅" },
  active: { label: "Активный", color: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400", emoji: "⚡" },
  initialization: { label: "Инициализация", color: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-400", emoji: "🚀" },
  pending: { label: "В ожидании", color: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400", emoji: "⏳" },
  error: { label: "Ошибка", color: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400", emoji: "❌" },
  unknown: { label: "Неизвестно", color: "bg-muted text-muted-foreground border-border", emoji: "❓" },
};

const CONN_META: Record<string, { label: string; emoji: string; icon: typeof Wifi }> = {
  connected: { label: "Подключено", emoji: "🟢", icon: Wifi },
  disconnected: { label: "Отключено", emoji: "🔴", icon: WifiOff },
  connecting: { label: "Подключение…", emoji: "🟡", icon: Wifi },
};

function formatDate(s?: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU");
  } catch {
    return s;
  }
}

function formatUptime(seconds?: number) {
  if (!seconds && seconds !== 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}д`);
  if (h) parts.push(`${h}ч`);
  parts.push(`${m}м`);
  return parts.join(" ");
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [status, setStatus] = useState<any>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<number>(settings.refreshInterval);
  const [config, setConfig] = useState<any>(null);
  const [configRaw, setConfigRaw] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("init");
  const prevStatusRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const baseUrl = `http://${settings.address}:${settings.port}`;
  const apiBase = `${baseUrl}/api/${settings.apiVersion}`;
  const authHeader = useMemo(
    () => "Basic " + btoa(`${settings.login}:${settings.password}`),
    [settings.login, settings.password],
  );

  const fetchStatus = useCallback(
    async (resetTimer = true) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/status`, {
          method: "GET",
          headers: { Authorization: authHeader },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let data: any;
        let pretty = text;
        try {
          data = JSON.parse(text);
          pretty = JSON.stringify(data, null, 2);
        } catch {
          data = { raw: text };
        }
        setRawResponse(pretty);

        const newStatus = data?.status;
        if (newStatus === "ready" && prevStatusRef.current && prevStatusRef.current !== "ready") {
          playNotification(settingsRef.current);
          toast.success("Статус: Готово ✅", { description: "Система перешла в состояние ready" });
        }
        prevStatusRef.current = newStatus ?? null;
        setStatus(data);
        setLastFetch(new Date());
      } catch (e: any) {
        setError(e?.message ?? "Ошибка запроса");
      } finally {
        setLoading(false);
        if (resetTimer) setCountdown(settingsRef.current.refreshInterval);
      }
    },
    [apiBase, authHeader],
  );

  const doInit = useCallback(async () => {
    setIniting(true);

    setError(null);
    try {
      const res = await fetch(`${apiBase}/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ token: settings.token }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Инициализация запущена 🚀");
      await fetchStatus();
    } catch (e: any) {
      setError(e?.message ?? "Ошибка инициализации");
      toast.error("Ошибка инициализации", { description: e?.message });
    } finally {
      setIniting(false);
    }
  }, [apiBase, authHeader, settings.token, fetchStatus]);

  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch(`${apiBase}/config`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let data: any;
      let pretty = text;
      try {
        data = JSON.parse(text);
        pretty = JSON.stringify(data, null, 2);
      } catch {
        data = { raw: text };
      }
      setConfigRaw(pretty);
      setConfig(data);
    } catch (e: any) {
      setConfigError(e?.message ?? "Ошибка запроса конфигурации");
    } finally {
      setConfigLoading(false);
    }
  }, [apiBase, authHeader]);

  // initial fetch on mount
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fetch config on first switch to config tab
  useEffect(() => {
    if (tab === "config" && config === null && !configLoading) {
      fetchConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);


  // auto-refresh countdown
  useEffect(() => {
    if (!settings.autoRefresh) return;
    setCountdown(settings.refreshInterval);
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchStatus(false);
          return settingsRef.current.refreshInterval;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [settings.autoRefresh, settings.refreshInterval, fetchStatus]);

  const statusMeta = STATUS_META[status?.status] ?? STATUS_META.unknown;
  const connMeta = status?.connectionStatus ? CONN_META[status.connectionStatus] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30">
      <div className="max-w-7xl mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span>🛰️</span> LM 4Z initializer
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {baseUrl}
            </p>
          </div>
          <SettingsDialog settings={settings} onChange={setSettings} />
        </header>

    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid grid-cols-2 w-full max-w-md">
        <TabsTrigger value="init" className="gap-2"><Rocket className="h-4 w-4" /> Инициализатор</TabsTrigger>
        <TabsTrigger value="config" className="gap-2"><Settings2 className="h-4 w-4" /> Конфиг</TabsTrigger>
      </TabsList>

      <TabsContent value="init" className="mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Status Card */}
            <Card className="p-8">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn("h-[70px] w-[70px] rounded-2xl flex items-center justify-center text-4xl border-2", statusMeta.color)}>
                    {statusMeta.emoji}
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Статус системы</div>
                    <div className="text-3xl font-bold">{statusMeta.label}</div>
                    {status?.status && status.status !== statusMeta.label.toLowerCase() && (
                      <div className="text-xs text-muted-foreground font-mono">{status.status}</div>
                    )}
                  </div>
                </div>
                {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Info blocks */}
              {status && <StatusBlocks status={status} />}

              {rawResponse && (
                <details className="group mt-4">
                  <summary className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    <FileJson className="h-4 w-4" />
                    <span>Сырой ответ сервера</span>
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-muted/60 text-xs font-mono overflow-auto max-h-80 border border-border whitespace-pre-wrap break-all">
                    {rawResponse}
                  </pre>
                </details>
              )}

              {!status && !loading && !error && (
                <div className="text-sm text-muted-foreground text-center py-6">
                  Нет данных. Нажмите «Получить статус».
                </div>
              )}
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-8">
            {/* Credentials */}
            <Card className="p-8 space-y-5">
              <h2 className="font-semibold flex items-center gap-2">🔑 Авторизация</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login">Логин</Label>
                  <Input
                    id="login"
                    value={settings.login}
                    onChange={(e) => setSettings({ ...settings, login: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    type="text"
                    value={settings.password}
                    onChange={(e) => setSettings({ ...settings, password: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token">Токен</Label>
                <Input
                  id="token"
                  value={settings.token}
                  placeholder="Вставьте токен"
                  onChange={(e) => setSettings({ ...settings, token: e.target.value })}
                />
              </div>
            </Card>

            {/* Actions */}
            <Card className="p-8 space-y-5">
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => fetchStatus(true)}
                  disabled={loading}
                  variant="outline"
                  size="lg"
                  className="w-full whitespace-normal"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <RefreshCw className="h-4 w-4 shrink-0" />}
                  Получить статус
                </Button>
                <Button
                  onClick={doInit}
                  disabled={initing || !settings.token}
                  size="lg"
                  className="w-full whitespace-normal"
                >
                  {initing ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Play className="h-4 w-4 shrink-0" />}
                  Запустить инициализацию
                </Button>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <Checkbox
                    checked={settings.autoRefresh}
                    onCheckedChange={(c) => setSettings({ ...settings, autoRefresh: !!c })}
                  />
                  <div>
                    <div className="text-sm font-medium">🔄 Авто-обновление статуса</div>
                    <div className="text-xs text-muted-foreground">каждые {settings.refreshInterval} сек</div>
                  </div>
                </label>
                {settings.autoRefresh && (
                  <div className="flex items-center gap-2 text-sm font-mono">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="tabular-nums">{countdown}s</span>
                  </div>
                )}
              </div>

              {lastFetch && (
                <div className="text-xs text-muted-foreground">
                  Последнее обновление: {lastFetch.toLocaleTimeString("ru-RU")}
                </div>
              )}
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="config" className="mt-6">
        <Card className="p-8 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Settings2 className="h-5 w-5" /> Конфигурация сервиса
            </h2>
            <Button
              onClick={fetchConfig}
              disabled={configLoading}
              variant="outline"
              size="sm"
            >
              {configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
          </div>

          {configError && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{configError}</span>
            </div>
          )}

          {config && <ConfigBlocks config={config} />}

          {configRaw && (
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                <FileJson className="h-4 w-4" />
                <span>Сырой ответ сервера</span>
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-muted/60 text-xs font-mono overflow-auto max-h-96 border border-border whitespace-pre-wrap break-all">
                {configRaw}
              </pre>
            </details>
          )}

          {!config && !configLoading && !configError && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Нет данных. Нажмите «Обновить».
            </div>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  </div>
</div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  emoji,
}: {
  icon?: typeof Wifi;
  label: string;
  value: React.ReactNode;
  emoji?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground min-w-1">
        {emoji ? <span className="text-base">{emoji}</span> : Icon ? <Icon className="h-4 w-4" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-sm font-medium text-right break-all">{value}</div>
    </div>
  );
}

function StatusBlocks({ status }: { status: any }) {
  const connMeta = status?.connectionStatus ? CONN_META[status.connectionStatus] : null;
  const rep = status?.replicationStatus;
  const db = status?.dbState;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {connMeta && (
        <InfoRow
          emoji={connMeta.emoji}
          label="Подключение"
          value={connMeta.label}
        />
      )}
      {status.version && <InfoRow emoji="🏷️" label="Версия" value={status.version} />}
      {status.dbVersion && <InfoRow emoji="💾" label="Версия БД" value={status.dbVersion} />}
      {status.operationMode && (
        <InfoRow emoji="⚙️" label="Режим работы" value={status.operationMode} />
      )}
      {status.name && <InfoRow emoji="🏢" label="Название" value={status.name} />}
      {status.inn && <InfoRow emoji="🧾" label="ИНН" value={status.inn} />}
      {status.inst && <InfoRow emoji="🆔" label="Instance" value={<code className="text-xs">{status.inst}</code>} />}
      {status.serviceUrl && (
        <InfoRow emoji="🌐" label="Service URL" value={<span className="text-xs">{status.serviceUrl}</span>} />
      )}
      {status.lastSync && <InfoRow emoji="🔄" label="Последняя синхронизация" value={formatDate(status.lastSync)} />}
      {status.lastUpdate && <InfoRow emoji="🕒" label="Последнее обновление" value={formatDate(status.lastUpdate)} />}
      {status.dateInitialized && (
        <InfoRow emoji="📅" label="Инициализировано" value={formatDate(status.dateInitialized)} />
      )}
      {typeof status.uptime === "number" && (
        <InfoRow emoji="⏱️" label="Uptime" value={formatUptime(status.uptime)} />
      )}
      {typeof status.isInitialized === "boolean" && (
        <InfoRow emoji={status.isInitialized ? "✅" : "⛔"} label="Инициализирован" value={status.isInitialized ? "Да" : "Нет"} />
      )}
      {typeof status.isActive === "boolean" && (
        <InfoRow emoji={status.isActive ? "🟢" : "⚪"} label="Активен" value={status.isActive ? "Да" : "Нет"} />
      )}
      {typeof status.requiresDownload === "boolean" && (
        <InfoRow emoji="⬇️" label="Требуется загрузка" value={status.requiresDownload ? "Да" : "Нет"} />
      )}

      {rep && (
        <div className="sm:col-span-2 p-4 rounded-lg bg-muted/40 space-y-2.5">
          <div className="text-sm font-medium flex items-center gap-2">📡 Репликация</div>
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <Stat label="Лаг" value={`${rep.timeLag ?? 0} мс`} />
            <Stat label="Сервер" value={rep.serverDocCount ?? 0} />
            <Stat label="Локально" value={rep.localDocCount ?? 0} />
          </div>
        </div>
      )}

      {db && (
        <div className="sm:col-span-2 p-4 rounded-lg bg-muted/40 space-y-2.5">
          <div className="text-sm font-medium flex items-center gap-2">🗄️ Состояние БД</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <DbStat emoji="💰" label="min_price" value={db.min_price?.docCount ?? 0} />
            <DbStat emoji="🚫" label="blocked_gtin" value={db.blocked_gtin?.docCount ?? 0} />
            <DbStat emoji="🛑" label="blocked_cis" value={db.blocked_cis?.docCount ?? 0} />
          </div>
        </div>
      )}

      {Array.isArray(status.errors) && status.errors.length > 0 && (
        <div className="sm:col-span-2 p-4 rounded-lg bg-destructive/10 space-y-1.5">
          <div className="text-sm font-medium flex items-center gap-2 text-destructive">⚠️ Ошибки</div>
          {status.errors.map((e: any, i: number) => (
            <div key={i} className="text-xs text-destructive">
              <span className="font-mono">{e.code}</span>: {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-md bg-background/60 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DbStat({ emoji, label, value }: { emoji: string; label: string; value: number }) {
  return (
    <div className="p-3 rounded-md bg-background/60 flex items-center gap-2.5">
      <span className="text-lg">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground font-mono truncate">{label}</div>
        <div className="font-mono font-semibold tabular-nums">{value.toLocaleString("ru-RU")}</div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  const units: [number, string][] = [
    [86400000, "д"],
    [3600000, "ч"],
    [60000, "м"],
    [1000, "с"],
  ];
  const parts: string[] = [];
  let rest = ms;
  for (const [u, name] of units) {
    const v = Math.floor(rest / u);
    if (v > 0) {
      parts.push(`${v}${name}`);
      rest -= v * u;
    }
    if (parts.length >= 2) break;
  }
  if (parts.length === 0) parts.push(`${ms}мс`);
  return parts.join(" ");
}

const CONFIG_FIELD_META: Record<string, { emoji: string; label: string; kind?: "duration" | "url" | "array" | "bool" | "text" | "number" }> = {
  ticketStorePeriod: { emoji: "🎫", label: "Хранение тикетов", kind: "duration" },
  syncMaxRetry: { emoji: "🔁", label: "Макс. интервал ретраев синка", kind: "duration" },
  statsStorePeriod: { emoji: "📊", label: "Хранение статистики", kind: "duration" },
  statsDbUrl: { emoji: "🌐", label: "URL базы статистики", kind: "url" },
  soldStorePeriod: { emoji: "🛒", label: "Хранение продаж", kind: "duration" },
  sendStatsInterval: { emoji: "📤", label: "Интервал отправки статистики", kind: "duration" },
  sendStats: { emoji: "📈", label: "Отправлять статистику", kind: "bool" },
  replicationInstUrl: { emoji: "🔗", label: "URL репликации", kind: "url" },
  operationMode: { emoji: "⚙️", label: "Режим работы", kind: "text" },
  minPrice: { emoji: "💰", label: "Min price", kind: "array" },
  logLevel: { emoji: "📋", label: "Уровень логов", kind: "text" },
  initCount: { emoji: "🔢", label: "Кол-во инициализаций", kind: "number" },
  dbRetryMin: { emoji: "⏱️", label: "БД ретрай (мин)", kind: "duration" },
  dbRetryMax: { emoji: "⏲️", label: "БД ретрай (макс)", kind: "duration" },
  blockedGtin: { emoji: "🚫", label: "Заблокированные GTIN", kind: "array" },
  blockedCis: { emoji: "🛑", label: "Заблокированные CIS", kind: "array" },
  blockSyncPeriod: { emoji: "🔒", label: "Период блок-синка", kind: "duration" },
  authorization: { emoji: "🔑", label: "Методы авторизации", kind: "array" },
};

function renderConfigValue(value: any, kind?: string): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (kind === "duration" && typeof value === "number") {
    return (
      <span>
        {formatDuration(value)}{" "}
        <span className="text-xs text-muted-foreground font-mono">({value.toLocaleString("ru-RU")} мс)</span>
      </span>
    );
  }
  if (kind === "bool" || typeof value === "boolean") {
    return value ? "✅ Да" : "⛔ Нет";
  }
  if (kind === "url" || (typeof value === "string" && /^https?:\/\//.test(value))) {
    return <span className="text-xs font-mono break-all">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">пусто</span>;
    return (
      <div className="flex flex-wrap gap-1 justify-end">
        {value.map((v, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded bg-background/60 text-xs font-mono border">
            {String(v)}
          </span>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return <code className="text-xs">{JSON.stringify(value)}</code>;
  }
  return String(value);
}

function ConfigBlocks({ config }: { config: any }) {
  if (!config || typeof config !== "object") return null;
  const tokenStore = config.tokensStorePeriod;
  const knownKeys = new Set(Object.keys(CONFIG_FIELD_META).concat(["tokensStorePeriod"]));
  const orderedKeys = Object.keys(CONFIG_FIELD_META).filter((k) => k in config);
  const extraKeys = Object.keys(config).filter((k) => !knownKeys.has(k));

  return (
    <div className="space-y-4">
      {tokenStore && typeof tokenStore === "object" && (
        <div className="p-4 rounded-lg bg-muted/40 space-y-2.5">
          <div className="text-sm font-medium flex items-center gap-2">🗝️ Период хранения токенов</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {Object.entries(tokenStore).map(([k, v]) => (
              <InfoRow key={k} emoji="•" label={k} value={renderConfigValue(v, "duration")} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {orderedKeys.map((k) => {
          const meta = CONFIG_FIELD_META[k];
          return (
            <InfoRow
              key={k}
              emoji={meta.emoji}
              label={meta.label}
              value={renderConfigValue(config[k], meta.kind)}
            />
          );
        })}
        {extraKeys.map((k) => (
          <InfoRow key={k} emoji="•" label={k} value={renderConfigValue(config[k])} />
        ))}
      </div>
    </div>
  );
}


function SettingsDialog({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const testSound = () => playNotification(settings);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Настройки">
          <SettingsIcon className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>⚙️ Настройки</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">🔌 Подключение</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Адрес</Label>
                <Input value={settings.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Порт</Label>
                <Input value={settings.port} onChange={(e) => set("port", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Версия API</Label>
              <Input
                value={settings.apiVersion}
                placeholder="v2"
                onChange={(e) => set("apiVersion", e.target.value.trim() || "v2")}
              />
              <p className="text-xs text-muted-foreground">
                Подставляется в URL: <code>/api/{settings.apiVersion}/...</code>
              </p>
            </div>

          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">🔄 Авто-обновление</h3>
            <div className="space-y-1.5">
              <Label>Интервал (секунды)</Label>
              <Input
                type="number"
                min={1}
                value={settings.refreshInterval}
                onChange={(e) => set("refreshInterval", Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">🔔 Уведомления</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={settings.notificationsEnabled}
                onCheckedChange={(c) => set("notificationsEnabled", !!c)}
              />
              <span className="text-sm">Звуковое уведомление при переходе в ready</span>
            </label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Громкость</Label>
                <span className="text-xs text-muted-foreground">{Math.round(settings.notificationVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.notificationVolume}
                onChange={(e) => set("notificationVolume", Number(e.target.value))}
                className="w-full accent-primary h-2 rounded-lg bg-muted appearance-none cursor-pointer"
              />
            </div>
            <Button variant="outline" size="sm" onClick={testSound} className="w-full">
              🔊 Проиграть тестовое уведомление
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
