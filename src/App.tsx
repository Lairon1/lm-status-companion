import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings, RefreshCw, Play, CheckCircle2, AlertCircle, Loader2, Wifi, WifiOff, Database, Clock, Server, Hash, Calendar, Activity, FileText, Shield, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Settings = {
  address: string;
  port: string;
  login: string;
  password: string;
  token: string;
  refreshInterval: number;
  notificationsEnabled: boolean;
  notificationVolume: number;
  notificationFrequency: number;
  notificationDuration: number;
  autoRefresh: boolean;
};

const DEFAULTS: Settings = {
  address: "127.0.0.1",
  port: "5995",
  login: "admin",
  password: "admin",
  token: "",
  refreshInterval: 10,
  notificationsEnabled: true,
  notificationVolume: 0.4,
  notificationFrequency: 660,
  notificationDuration: 250,
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

function playMelody(s: Settings) {
  if (!s.notificationsEnabled) return;
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const notes = [s.notificationFrequency, s.notificationFrequency * 1.25, s.notificationFrequency * 1.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + i * (s.notificationDuration / 1000);
      const end = start + s.notificationDuration / 1000;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(s.notificationVolume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    });
    setTimeout(() => ctx.close(), notes.length * s.notificationDuration + 500);
  } catch (e) {
    console.error("Melody error", e);
  }
}

const STATUS_META: Record<string, { label: string; color: string; emoji: string }> = {
  ready: { label: "Готово", color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400", emoji: "✅" },
  active: { label: "Активный", color: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400", emoji: "⚡" },
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
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<number>(settings.refreshInterval);
  const prevStatusRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const baseUrl = `http://${settings.address}:${settings.port}`;
  const authHeader = useMemo(
    () => "Basic " + btoa(`${settings.login}:${settings.password}`),
    [settings.login, settings.password],
  );

  const fetchStatus = useCallback(
    async (resetTimer = true) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/api/v2/status`, {
          method: "GET",
          headers: { Authorization: authHeader },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const newStatus = data?.status;
        if (newStatus === "ready" && prevStatusRef.current && prevStatusRef.current !== "ready") {
          playMelody(settingsRef.current);
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
    [baseUrl, authHeader],
  );

  const doInit = useCallback(async () => {
    setIniting(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/v2/init`, {
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
  }, [baseUrl, authHeader, settings.token, fetchStatus]);

  // initial fetch on mount
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
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

        {/* Status Card */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center text-3xl border-2", statusMeta.color)}>
                {statusMeta.emoji}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Статус системы</div>
                <div className="text-2xl font-bold">{statusMeta.label}</div>
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

          {!status && !loading && !error && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Нет данных. Нажмите «Получить статус».
            </div>
          )}
        </Card>

        {/* Credentials */}
        <Card className="p-6 space-y-4">
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
        <Card className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={() => fetchStatus(true)}
              disabled={loading}
              variant="outline"
              className="flex-1"
              size="lg"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Получить статус
            </Button>
            <Button
              onClick={doInit}
              disabled={initing || !settings.token}
              className="flex-1"
              size="lg"
            >
              {initing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
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
    <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
      <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        <div className="sm:col-span-2 p-3 rounded-lg bg-muted/40 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">📡 Репликация</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Лаг" value={`${rep.timeLag ?? 0} мс`} />
            <Stat label="Сервер" value={rep.serverDocCount ?? 0} />
            <Stat label="Локально" value={rep.localDocCount ?? 0} />
          </div>
        </div>
      )}

      {db && (
        <div className="sm:col-span-2 p-3 rounded-lg bg-muted/40 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">🗄️ Состояние БД</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <DbStat emoji="💰" label="min_price" value={db.min_price?.docCount ?? 0} />
            <DbStat emoji="🚫" label="blocked_gtin" value={db.blocked_gtin?.docCount ?? 0} />
            <DbStat emoji="🛑" label="blocked_cis" value={db.blocked_cis?.docCount ?? 0} />
          </div>
        </div>
      )}

      {Array.isArray(status.errors) && status.errors.length > 0 && (
        <div className="sm:col-span-2 p-3 rounded-lg bg-destructive/10 space-y-1">
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
    <div className="p-2 rounded-md bg-background/60 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DbStat({ emoji, label, value }: { emoji: string; label: string; value: number }) {
  return (
    <div className="p-2.5 rounded-md bg-background/60 flex items-center gap-2">
      <span className="text-lg">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground font-mono truncate">{label}</div>
        <div className="font-mono font-semibold tabular-nums">{value.toLocaleString("ru-RU")}</div>
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
  const testSound = () => playMelody(settings);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Настройки">
          <Settings className="h-5 w-5" />
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
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Громкость</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={1}
                  value={settings.notificationVolume}
                  onChange={(e) => set("notificationVolume", Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Частота (Hz)</Label>
                <Input
                  type="number"
                  value={settings.notificationFrequency}
                  onChange={(e) => set("notificationFrequency", Number(e.target.value) || 440)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Длит. (мс)</Label>
                <Input
                  type="number"
                  value={settings.notificationDuration}
                  onChange={(e) => set("notificationDuration", Number(e.target.value) || 200)}
                />
              </div>
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
