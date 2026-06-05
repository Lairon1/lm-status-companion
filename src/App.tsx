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
import { APP_VERSION } from "@/version";
import sndHappy from "@/assets/sounds/happy.mp3";
import snd67 from "@/assets/sounds/67.mp3";
import sndSvin from "@/assets/sounds/svin.mp3";
import sndGoida from "@/assets/sounds/goida.mp3";

type SoundId = "happy" | "67" | "svin" | "goida";

const SOUNDS: { id: SoundId; label: string; url: string }[] = [
  { id: "happy", label: "🎉 Хапи хапи хапиии", url: sndHappy },
  { id: "67", label: "🔥 67", url: snd67 },
  { id: "svin", label: "🐷 Визг свина", url: sndSvin },
  { id: "goida", label: "⚔️ Гойда", url: sndGoida },
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

type ErrorDetails = {
  message: string;
  reason?: string;
  hint?: string;
  url?: string;
  method?: string;
  status?: number;
  statusText?: string;
  body?: string;
  stack?: string;
  time?: string;
};

function diagnoseError(e: any, url: string, res?: Response): { reason: string; hint: string } {
  const pageProto = typeof location !== "undefined" ? location.protocol : "";
  const isMixed = pageProto === "https:" && url.startsWith("http://");
  const msg: string = (e?.message || "").toString();
  const name: string = (e?.name || "").toString();

  if (res) {
    const s = res.status;
    if (s === 401) return { reason: "Не авторизовано (401)", hint: "Проверьте логин/пароль или токен." };
    if (s === 403) return { reason: "Доступ запрещён (403)", hint: "Сервер отклонил запрос. Проверьте права/токен." };
    if (s === 404) return { reason: "Не найдено (404)", hint: "Проверьте адрес, порт и версию API." };
    if (s === 408) return { reason: "Таймаут запроса (408)", hint: "Сервер слишком долго отвечал." };
    if (s === 429) return { reason: "Слишком много запросов (429)", hint: "Подождите и попробуйте снова." };
    if (s >= 500) return { reason: `Ошибка сервера (${s})`, hint: "Проблема на стороне устройства/сервера." };
    if (s >= 400) return { reason: `Ошибка клиента (${s})`, hint: "Запрос отклонён сервером." };
    if (/JSON/i.test(msg)) return { reason: "Не удалось разобрать JSON", hint: "Сервер вернул не-JSON ответ." };
    return { reason: `HTTP ${s}`, hint: "" };
  }

  if (name === "AbortError") return { reason: "Запрос прерван (таймаут)", hint: "Сервер не ответил вовремя." };
  if (isMixed) return {
    reason: "Смешанный контент: HTTPS → HTTP",
    hint: "Страница открыта по HTTPS, а API по HTTP. Откройте приложение по HTTP или используйте HTTPS API.",
  };
  if (/ERR_CERT|SSL|certificate/i.test(msg)) return {
    reason: "Проблема с TLS-сертификатом",
    hint: "Невалидный сертификат на сервере.",
  };
  if (/ERR_CONNECTION_REFUSED|refused/i.test(msg)) return {
    reason: "Соединение отклонено",
    hint: "На указанном порту никто не слушает. Запущен ли сервер?",
  };
  if (/ERR_NAME_NOT_RESOLVED|getaddrinfo|DNS/i.test(msg)) return {
    reason: "Не удалось разрешить адрес",
    hint: "Проверьте IP/имя хоста.",
  };
  if (/ERR_CONNECTION_TIMED_OUT|timeout|timed out/i.test(msg)) return {
    reason: "Таймаут соединения",
    hint: "Устройство не отвечает. Проверьте сеть и доступность хоста.",
  };
  if (/NetworkError|Network request failed|ERR_NETWORK/i.test(msg)) return {
    reason: "Сетевая ошибка",
    hint: "Устройство недоступно. Проверьте Wi-Fi, IP-адрес и порт.",
  };
  if (/Failed to fetch|Load failed/i.test(msg) || name === "TypeError") return {
    reason: "Не удалось выполнить запрос (Failed to fetch)",
    hint: "Возможные причины: CORS не настроен на сервере, устройство недоступно, неверный адрес/порт, либо блокировка смешанного контента (HTTPS↔HTTP).",
  };
  return { reason: "Неизвестная ошибка запроса", hint: msg || "Нет дополнительных сведений." };
}

function buildErrorDetails(e: any, url: string, method: string, res: Response | undefined, text: string): ErrorDetails {
  const diag = diagnoseError(e, url, res);
  return {
    message: e?.message ?? "Ошибка запроса",
    reason: diag.reason,
    hint: diag.hint,
    url,
    method,
    status: res?.status,
    statusText: res?.statusText,
    body: text && text.length > 4000 ? text.slice(0, 4000) + "…" : text,
    stack: e?.stack,
    time: new Date().toISOString(),
  };
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [status, setStatus] = useState<any>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(false);
  const [error, setError] = useState<ErrorDetails | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<number>(settings.refreshInterval);
  const [config, setConfig] = useState<any>(null);
  const [configRaw, setConfigRaw] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<ErrorDetails | null>(null);
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
      const url = `${apiBase}/status`;
      let res: Response | undefined;
      let text = "";
      try {
        res = await fetch(url, {
          method: "GET",
        });
        text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
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
        setError(buildErrorDetails(e, url, "GET", res, text));
      } finally {
        setLoading(false);
        if (resetTimer) setCountdown(settingsRef.current.refreshInterval);
      }
    },
    [apiBase],
  );

  const doInit = useCallback(async () => {
    setIniting(true);
    setError(null);
    const url = `${apiBase}/init`;
    let res: Response | undefined;
    let text = "";
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ token: settings.token }),
      });
      text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
      toast.success("Инициализация запущена 🚀");
      await fetchStatus();
    } catch (e: any) {
      const details = buildErrorDetails(e, url, "POST", res, text);
      details.message = details.message || "Ошибка инициализации";
      setError(details);
      toast.error("Ошибка инициализации", {
        description: details.reason || details.message,
      });
    } finally {
      setIniting(false);
    }
  }, [apiBase, authHeader, settings.token, fetchStatus]);

  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    const url = `${apiBase}/config`;
    let res: Response | undefined;
    let text = "";
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
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
      setConfigError(buildErrorDetails(e, url, "GET", res, text));
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
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-10 space-y-4 sm:space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
              <span>🛰️</span>
              <span className="truncate">LM 4Z initializer</span>
              <span className="text-[10px] sm:text-xs font-mono font-normal text-muted-foreground border border-border rounded px-1.5 py-0.5">v{APP_VERSION}</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 break-all">
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
            <Card className="p-4 sm:p-8">
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

              {error && <ErrorBox details={error} />}

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
            <Card className="p-4 sm:p-8 space-y-5">
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
            <Card className="p-4 sm:p-8 space-y-5">
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
        <Card className="p-4 sm:p-8 space-y-5">
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

          {configError && <ErrorBox details={configError} />}

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

function ErrorBox({ details }: { details: ErrorDetails }) {
  const copyAll = () => {
    const txt = [
      `Сообщение: ${details.message}`,
      details.reason ? `Причина:   ${details.reason}` : "",
      details.hint ? `Подсказка: ${details.hint}` : "",
      details.method && details.url ? `Запрос:    ${details.method} ${details.url}` : "",
      details.status ? `Статус:    ${details.status} ${details.statusText ?? ""}` : "",
      details.time ? `Время:     ${details.time}` : "",
      details.body ? `\nОтвет сервера:\n${details.body}` : "",
      details.stack ? `\nStack:\n${details.stack}` : "",
    ].filter(Boolean).join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(txt).then(
          () => toast.success("Скопировано"),
          () => toast.error("Не удалось скопировать"),
        );
      } else {
        // Fallback for old mobile browsers
        const ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success("Скопировано");
      }
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive overflow-hidden">
      <div className="p-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold break-words">{details.reason || details.message}</div>
          {details.hint && (
            <div className="mt-1 text-xs break-words opacity-90">💡 {details.hint}</div>
          )}
          {details.reason && details.message && details.message !== details.reason && (
            <div className="mt-1 text-xs break-words opacity-80 font-mono">{details.message}</div>
          )}
          <div className="mt-1 text-xs space-y-0.5 opacity-90 font-mono break-all">
            {details.method && details.url && (
              <div><span className="opacity-70">{details.method}</span> {details.url}</div>
            )}
            {details.status !== undefined && (
              <div>Статус: {details.status} {details.statusText}</div>
            )}
            {details.time && <div className="opacity-70">{new Date(details.time).toLocaleString("ru-RU")}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={copyAll}
          className="text-[11px] px-2 py-1 rounded border border-destructive/40 hover:bg-destructive/10 shrink-0"
        >
          Копировать
        </button>
      </div>
      {(details.body || details.stack) && (
        <details className="group border-t border-destructive/20">
          <summary className="px-3 py-2 cursor-pointer select-none text-xs font-medium flex items-center gap-1.5">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            Подробности
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {details.body && (
              <div>
                <div className="text-[11px] uppercase tracking-wider opacity-70 mb-1">Тело ответа</div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-background/40 rounded p-2 max-h-60 overflow-auto border border-destructive/20">
{details.body}
                </pre>
              </div>
            )}
            {details.stack && (
              <div>
                <div className="text-[11px] uppercase tracking-wider opacity-70 mb-1">Stack trace</div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-background/40 rounded p-2 max-h-60 overflow-auto border border-destructive/20">
{details.stack}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}
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
              <span className="text-sm">Звук при завершении инициализации (переход в ready)</span>
            </label>

            <div className="space-y-1.5">
              <Label className="text-xs">Звук уведомления</Label>
              <div className="grid gap-1.5">
                {SOUNDS.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors",
                      settings.notificationSound === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="sound"
                        className="accent-primary"
                        checked={settings.notificationSound === s.id}
                        onChange={() => set("notificationSound", s.id)}
                      />
                      <span className="text-sm">{s.label}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        playNotification({ ...settings, notificationsEnabled: true, notificationSound: s.id });
                      }}
                    >
                      ▶ Тест
                    </Button>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Громкость (можно выкрутить выше 100% 🔥)</Label>
                <span className={cn("text-xs font-mono", settings.notificationVolume > 1 ? "text-red-500 font-bold" : "text-muted-foreground")}>
                  {Math.round(settings.notificationVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.05}
                value={settings.notificationVolume}
                onChange={(e) => set("notificationVolume", Number(e.target.value))}
                className="w-full accent-primary h-2 rounded-lg bg-muted appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>0%</span><span>100%</span><span>200%</span><span>300%</span>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={testSound} className="w-full">
              🔊 Проиграть выбранный звук
            </Button>
          </section>

        </div>
      </DialogContent>
    </Dialog>
  );
}
