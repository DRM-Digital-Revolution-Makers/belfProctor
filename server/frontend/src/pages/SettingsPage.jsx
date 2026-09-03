import React from "react";
import {
  Dropdown,
  Empty,
  message,
  Input,
  Checkbox,
  Select,
  Modal,
} from "antd";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../dataProvider.js";

/* ============ Design tokens ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  formBg: "rgba(0,0,0,0.05)",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  stroke: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

const LANGS = [
  { value: "ru", label: "Русский", flag: "twemoji:flag-russia" },
  { value: "en", label: "English", flag: "twemoji:flag-united-kingdom" },
  { value: "uz", label: "O'zbek tili", flag: "twemoji:flag-uzbekistan" },
];

/* ============ Page ============ */
export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [tab, setTab] = React.useState("general");
  const [search, setSearch] = React.useState("");
  const [agents, setAgents] = React.useState([]);

  React.useEffect(() => {
    if (tab !== "agents") return;
    authFetch(`${API_URL}/clients`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, [API_URL, tab]);

  const currentLang =
    LANGS.find((l) => l.value === i18n.language) || LANGS[0];

  const langMenuItems = LANGS.map((l) => ({
    key: l.value,
    label: (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: BP.font,
          fontSize: 16,
        }}
      >
        <Icon icon={l.flag} width={20} height={20} />
        {l.label}
      </span>
    ),
    onClick: () => i18n.changeLanguage(l.value),
  }));

  const filteredAgents = React.useMemo(() => {
    let arr = agents || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((a) => String(a.id || "").toLowerCase().includes(q));
    }
    return arr;
  }, [agents, search]);

  return (
    <div>
      {/* Outer wrapper */}
      <div
        className="bp-page-shell"
        style={{
          background: BP.surface,
          borderRadius: 50,
          boxShadow: BP.shadow,
          padding: 20,
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Inner white card */}
        <div
          style={{
            background: BP.white,
            borderRadius: 30,
            boxShadow: BP.shadow,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {/* Header (Frame 58 — layout_UCF7YO: column gap 8 padding 20 20 0) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "20px 20px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontFamily: BP.font,
                  fontSize: 24,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                {t("settings.title")}
              </h2>

              {/* Search box (Frame 55 — layout_K9CFIL padding 12px 20px, 10px radius) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: BP.surface,
                  borderRadius: 10,
                  padding: "12px 20px",
                  gap: 10,
                  minWidth: 280,
                }}
              >
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tab === "agents" ? "Поиск по агентам..." : "Поиск..."}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    fontFamily: BP.font,
                    fontSize: 16,
                    fontWeight: 274,
                    color: BP.text,
                  }}
                />
                <Icon
                  icon="solar:magnifer-bold-duotone"
                  width={20}
                  height={20}
                  color={BP.muted}
                />
              </div>
            </div>
          </div>

          {/* Tab bar (Frame 85 — layout_K8SIXC padding 0 20) */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              padding: "0 20px",
              gap: 2,
              marginTop: 8,
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            <TabButton
              active={tab === "general"}
              onClick={() => setTab("general")}
            >
              Общие
            </TabButton>
            <TabButton
              active={tab === "agents"}
              onClick={() => setTab("agents")}
            >
              Агенты
            </TabButton>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: BP.stroke,
              opacity: 0.5,
              margin: "0 20px",
            }}
          />

          {/* Tab content (Frame 67 — layout_49TP0X gap 12 padding 20) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 20,
            }}
          >
            {tab === "general" ? <GeneralTab
              currentLang={currentLang}
              langMenuItems={langMenuItems}
              t={t}
            /> : <AgentsTab clients={filteredAgents} search={search} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Sub-components ============ */

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bp-tab-button"
      style={{
        background: "transparent",
        border: "none",
        borderBottom: active ? `1px solid ${BP.green}` : "1px solid transparent",
        borderRadius: "10px 10px 0 0",
        padding: "12px 20px",
        cursor: "pointer",
        color: active ? BP.green : BP.light,
        fontFamily: BP.font,
        fontSize: 16,
        fontWeight: 510,
      }}
    >
      {children}
    </button>
  );
}

function GeneralTab({ currentLang, langMenuItems, t }) {
  return (
    <div className="bp-fade-in" style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <InfoCard
          icon="solar:shield-check-bold-duotone"
          label="Система"
          value="Belf Proctor"
          hint="Единая панель мониторинга сотрудников"
        />
        <InfoCard
          icon="solar:code-circle-bold-duotone"
          label="Версия панели"
          value="1.0.0"
          hint="Текущая сборка интерфейса"
        />
        <InfoCard
          icon="solar:download-minimalistic-bold-duotone"
          label="Версия агента"
          value="1.0.0"
          hint="Базовая версия клиентской части"
        />
      </div>

      <div
        className="bp-section-card bp-interactive-card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
        }}
      >
        <div
          style={{
            fontFamily: BP.font,
            fontSize: 20,
            fontWeight: 510,
            color: BP.text,
          }}
        >
          Интерфейс
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 16,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            {t("settings.language") || "Язык интерфейса"}
          </div>

          <Dropdown
            trigger={["click"]}
            menu={{ items: langMenuItems, selectable: true, selectedKeys: [currentLang.value] }}
            placement="bottomLeft"
          >
            <button
              type="button"
              className="bp-ghost-action"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                background: "transparent",
                border: `1px solid ${BP.stroke}`,
                borderRadius: 10,
                cursor: "pointer",
                minWidth: 200,
                fontFamily: BP.font,
              }}
            >
              <Icon icon={currentLang.flag} width={24} height={24} />
              <span
                style={{
                  flex: 1,
                  fontFamily: BP.font,
                  fontSize: 18,
                  fontWeight: 400,
                  color: BP.text,
                  textAlign: "left",
                }}
              >
                {currentLang.label}
              </span>
              <Icon
                icon="solar:alt-arrow-down-linear"
                width={16}
                height={16}
                color={BP.text}
              />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value, hint }) {
  return (
    <div
      className="bp-soft-panel bp-interactive-card"
      style={{
        padding: 16,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        minHeight: 104,
        fontFamily: BP.font,
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          background: "rgba(38,126,38,0.09)",
          color: BP.green,
          display: "inline-grid",
          placeItems: "center",
          flex: "0 0 auto",
        }}
      >
        <Icon icon={icon} width={21} height={21} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: BP.muted, fontSize: 13 }}>{label}</div>
        <div style={{ color: BP.text, fontSize: 20, fontWeight: 510, marginTop: 2 }}>
          {value}
        </div>
        <div style={{ color: BP.light, fontSize: 12, marginTop: 5 }}>
          {hint}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function compareVersions(a, b) {
  const ap = String(a || "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const bp = String(b || "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const d = (ap[i] || 0) - (bp[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function formatDeploymentStatus(status, detail) {
  const value = String(status || "");
  const suffix = detail ? `: ${detail}` : "";
  if (value === "sent") return { text: `Команда отправлена${suffix}`, color: BP.blue };
  if (value === "queued_offline") return { text: "В очереди: агент оффлайн", color: BP.blue };
  if (value.startsWith("downloading")) return { text: `Скачивание${suffix}`, color: BP.blue };
  if (value === "verifying") return { text: "Проверка файла", color: BP.blue };
  if (value === "waiting_idle") return { text: "Ожидание простоя", color: BP.blue };
  if (value === "installing") return { text: "Установка", color: BP.blue };
  if (value === "restarted") return { text: "Перезапуск агента", color: BP.blue };
  if (value === "confirmed") return { text: "Обновление подтверждено", color: BP.green };
  if (value === "already_up_to_date") return { text: "Актуальная версия", color: BP.green };
  if (value === "sha_mismatch") return { text: "Ошибка: не совпал SHA-256", color: "#DC2626" };
  if (value.startsWith("error")) return { text: `Ошибка: ${value}${suffix}`, color: "#DC2626" };
  return { text: `${value}${suffix}`, color: BP.muted };
}

function AgentsTab({ clients }) {
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [versions, setVersions] = React.useState([]);
  const [deployments, setDeployments] = React.useState([]);
  const [connectivity, setConnectivity] = React.useState({});
  const [loadingVersions, setLoadingVersions] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [newVersion, setNewVersion] = React.useState("");
  const [newNotes, setNewNotes] = React.useState("");
  const [fileObj, setFileObj] = React.useState(null);
  const [selected, setSelected] = React.useState([]);
  const [deployTo, setDeployTo] = React.useState("");
  const fileInputRef = React.useRef(null);

  const loadAll = React.useCallback(async () => {
    setLoadingVersions(true);
    try {
      const [vRes, dRes, cRes] = await Promise.all([
        authFetch(`${API_URL}/updates`),
        authFetch(`${API_URL}/updates/deployments`),
        authFetch(`${API_URL}/updates/connectivity`),
      ]);
      if (vRes.ok) {
        const j = await vRes.json();
        const data = Array.isArray(j?.data) ? j.data : [];
        // Sort by semver descending
        data.sort((a, b) => compareVersions(b.version, a.version));
        setVersions(data);
        if (data[0] && !deployTo) setDeployTo(data[0].version);
      }
      if (dRes.ok) {
        const j = await dRes.json();
        setDeployments(Array.isArray(j?.data) ? j.data : []);
      }
      if (cRes.ok) {
        const j = await cRes.json();
        const map = {};
        for (const it of j?.data || []) map[it.id] = it.online;
        setConnectivity(map);
      }
    } finally {
      setLoadingVersions(false);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [API_URL]);

  React.useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Poll deployments every 5s while there are any "sent" / queued entries
  React.useEffect(() => {
    const id = setInterval(() => {
      authFetch(`${API_URL}/updates/deployments`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && Array.isArray(j.data)) setDeployments(j.data);
        })
        .catch(() => {});
      authFetch(`${API_URL}/updates/connectivity`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && Array.isArray(j.data)) {
            const map = {};
            for (const it of j.data) map[it.id] = it.online;
            setConnectivity(map);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [API_URL]);

  const latestVersion = versions[0]?.version || null;

  const doUpload = async () => {
    if (!fileObj) {
      message.error("Выберите файл BelfProctor.exe");
      return;
    }
    if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(newVersion.trim())) {
      message.error("Версия должна быть x.y.z");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("version", newVersion.trim());
      if (newNotes.trim()) fd.append("notes", newNotes.trim());
      fd.append("file", fileObj);
      const res = await authFetch(`${API_URL}/updates`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let detail = "";
        try {
          const j = await res.json();
          detail = String(j?.message || "");
        } catch { /* keep generic */ }
        message.error(detail || "Не удалось загрузить");
        return;
      }
      message.success(`Версия ${newVersion.trim()} загружена`);
      setUploadOpen(false);
      setNewVersion("");
      setNewNotes("");
      setFileObj(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadAll();
    } finally {
      setUploading(false);
    }
  };

  const doDeploy = async () => {
    if (!deployTo) {
      message.error("Выберите версию");
      return;
    }
    if (!selected.length) {
      message.error("Выберите сотрудников");
      return;
    }
    try {
      const res = await authFetch(
        `${API_URL}/updates/${encodeURIComponent(deployTo)}/deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientIds: selected }),
        },
      );
      if (!res.ok) {
        let detail = "";
        try {
          const j = await res.json();
          detail = String(j?.message || "");
        } catch { /* keep generic */ }
        message.error(detail || "Раздача не удалась");
        return;
      }
      const j = await res.json();
      const sentNow = (j?.results || []).filter((r) => r.sent).length;
      const queued = (j?.results || []).filter((r) => !r.sent && r.queued).length;
      message.success(
        `Отправлено сейчас: ${sentNow}, в очередь (оффлайн): ${queued}`,
      );
      setSelected([]);
      await loadAll();
    } catch (e) {
      console.error(e);
      message.error("Ошибка раздачи");
    }
  };

  const deleteVersion = async (v) => {
    Modal.confirm({
      title: `Удалить версию ${v}?`,
      onOk: async () => {
        const res = await authFetch(
          `${API_URL}/updates/${encodeURIComponent(v)}`,
          { method: "DELETE" },
        );
        if (res.ok) {
          message.success("Удалено");
          await loadAll();
        } else {
          message.error("Не удалось удалить");
        }
      },
    });
  };

  // Deployment status helper for a given clientId — finds the most recent
  // deployment record for that client
  const lastDeployFor = React.useMemo(() => {
    const byClient = {};
    for (const d of deployments) {
      const cur = byClient[d.clientId];
      if (!cur || (d.sentAt || "") > (cur.sentAt || "")) {
        byClient[d.clientId] = d;
      }
    }
    return byClient;
  }, [deployments]);

  const toggleClient = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAll = () => {
    if (selected.length === clients.length) setSelected([]);
    else setSelected(clients.map((c) => c.id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Upload bar */}
      <div
        className="bp-section-card bp-interactive-card"
        style={{
          borderRadius: 18,
          padding: "16px 28px",
          background: BP.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 18,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Управление обновлениями
          </div>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 14,
              color: BP.muted,
              marginTop: 4,
            }}
          >
            Загрузите новую сборку клиента и раздайте её сотрудникам в фоне
          </div>
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="bp-primary-action"
          style={{
            background: BP.green,
            color: BP.white,
            border: "none",
            borderRadius: 12,
            padding: "10px 20px",
            cursor: "pointer",
            fontFamily: BP.font,
            fontSize: 15,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon icon="solar:upload-bold-duotone" width={18} height={18} />
          Загрузить версию
        </button>
      </div>

      {/* Versions list */}
      <div
        className="bp-section-card bp-interactive-card"
        style={{
          borderRadius: 18,
          overflow: "hidden",
          background: BP.white,
        }}
      >
        <div
          style={{
            padding: "16px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 16,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Доступные версии
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="bp-icon-button"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              color: BP.muted,
            }}
            title="Обновить"
          >
            <Icon icon="solar:refresh-linear" width={18} height={18} />
          </button>
        </div>
        <div style={{ height: 1, background: BP.stroke, opacity: 0.5 }} />
        {loadingVersions && !versions.length ? (
          <div style={{ padding: 40, textAlign: "center", color: BP.muted }}>
            Загрузка...
          </div>
        ) : versions.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Empty description="Нет загруженных версий" />
          </div>
        ) : (
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {versions.map((v, i) => (
              <div
                key={v.version}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 28px",
                  gap: 16,
                  borderTop: i === 0 ? "none" : `1px solid ${BP.surface}`,
                }}
              >
                <div
                  style={{
                    fontFamily: BP.font,
                    fontSize: 16,
                    fontWeight: 510,
                    color: BP.text,
                    minWidth: 100,
                  }}
                >
                  {v.version}
                  {v.version === latestVersion && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        color: BP.green,
                        fontWeight: 400,
                      }}
                    >
                      актуальная
                    </span>
                  )}
                </div>
                <div style={{ color: BP.muted, fontSize: 14, minWidth: 90 }}>
                  {formatBytes(v.size)}
                </div>
                <div style={{ color: BP.muted, fontSize: 14, minWidth: 160 }}>
                  {v.uploadedAt
                    ? new Date(v.uploadedAt).toLocaleString()
                    : "—"}
                </div>
                <div
                  style={{
                    color: BP.light,
                    fontSize: 12,
                    fontFamily: "monospace",
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={v.sha256}
                >
                  sha256: {v.sha256?.slice(0, 16)}…
                </div>
                {v.notes && (
                  <div
                    style={{
                      color: BP.muted,
                      fontSize: 13,
                      maxWidth: 220,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={v.notes}
                  >
                    {v.notes}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => deleteVersion(v.version)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: BP.muted,
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Удалить версию"
                >
                  <Icon
                    icon="solar:trash-bin-trash-linear"
                    width={18}
                    height={18}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deploy bar */}
      {versions.length > 0 && (
        <div
          style={{
            border: `1px solid ${BP.stroke}`,
            borderRadius: 18,
            padding: "12px 28px",
            background: BP.surface,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: BP.muted, fontFamily: BP.font, fontSize: 14 }}>
            Выбрано: {selected.length} / {clients.length}
          </span>
          <button
            type="button"
            onClick={selectAll}
            style={{
              background: "transparent",
              border: "none",
              color: BP.green,
              cursor: "pointer",
              fontFamily: BP.font,
              fontSize: 14,
              padding: 0,
            }}
          >
            {selected.length === clients.length
              ? "Снять все"
              : "Выбрать всех"}
          </button>
          <div style={{ flex: 1 }} />
          <Select
            value={deployTo || undefined}
            onChange={setDeployTo}
            style={{ minWidth: 140 }}
            options={versions.map((v) => ({
              label: v.version + (v.version === latestVersion ? " (актуальная)" : ""),
              value: v.version,
            }))}
          />
          <button
            type="button"
            disabled={!selected.length || !deployTo}
            onClick={doDeploy}
            className="bp-primary-action"
            style={{
              background:
                !selected.length || !deployTo ? BP.stroke : BP.green,
              color: BP.white,
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              cursor:
                !selected.length || !deployTo ? "not-allowed" : "pointer",
              fontFamily: BP.font,
              fontSize: 15,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Icon icon="solar:upload-bold-duotone" width={18} height={18} />
            Раздать выбранным
          </button>
        </div>
      )}

      {/* Clients table */}
      <div
        className="bp-section-card bp-interactive-card"
        style={{
          borderRadius: 18,
          overflow: "hidden",
          background: BP.white,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 28px",
            background: BP.white,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 24 }} />
            <div style={{ width: 40, color: BP.light, fontSize: 14 }}>№</div>
            <div
              style={{
                color: BP.muted,
                fontSize: 16,
                fontFamily: BP.font,
                fontWeight: 510,
                minWidth: 240,
              }}
            >
              Имя
            </div>
            <div
              style={{
                color: BP.muted,
                fontSize: 14,
                fontFamily: BP.font,
                fontWeight: 510,
                minWidth: 100,
              }}
            >
              Версия
            </div>
            <div
              style={{
                color: BP.muted,
                fontSize: 14,
                fontFamily: BP.font,
                fontWeight: 510,
              }}
            >
              Статус
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: BP.stroke, opacity: 0.5 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: 480,
            overflowY: "auto",
          }}
        >
          {clients.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Empty description="Нет агентов" />
            </div>
          ) : (
            clients.map((a, i) => {
              const isOnline = connectivity[a.id];
              const ver = a.version || "—";
              const isLatest =
                latestVersion && compareVersions(ver, latestVersion) >= 0;
              const dep = lastDeployFor[a.id];
              let statusText = "";
              let statusColor = BP.muted;
              if (isOnline === false) {
                statusText = "Оффлайн";
                statusColor = BP.muted;
              } else if (isLatest) {
                statusText = "✓ актуальная";
                statusColor = BP.green;
              } else if (latestVersion) {
                statusText = `обновить до ${latestVersion}`;
                statusColor = "#F59E0B";
              }
              if (dep && dep.lastStatus) {
                const s = String(dep.lastStatus || "");
                if (
                  s === "sent" ||
                  s === "queued_offline" ||
                  s.startsWith("downloading") ||
                  s === "verifying" ||
                  s === "waiting_idle" ||
                  s === "installing"
                ) {
                  const formatted = formatDeploymentStatus(s, dep.lastDetail);
                  statusText = formatted.text;
                  statusColor = formatted.color;
                } else if (s === "already_up_to_date") {
                  statusText = "✓ актуальная";
                  statusColor = BP.green;
                } else if (s.startsWith("error") || s === "sha_mismatch") {
                  const formatted = formatDeploymentStatus(s, dep.lastDetail);
                  statusText = formatted.text;
                  statusColor = formatted.color;
                }
              }
              const checked = selected.includes(a.id);
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 28px",
                    gap: 10,
                    borderTop:
                      i === 0 ? "none" : `1px solid ${BP.surface}`,
                  }}
                >
                  <div style={{ width: 24 }}>
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleClient(a.id)}
                    />
                  </div>
                  <div
                    style={{ width: 40, color: BP.light, fontSize: 14 }}
                  >
                    {i + 1}
                  </div>
                  <div
                    style={{
                      color: BP.text,
                      fontSize: 16,
                      fontFamily: BP.font,
                      fontWeight: 510,
                      minWidth: 240,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={a.id}
                  >
                    {a.id}
                  </div>
                  <div
                    style={{
                      color: BP.text,
                      fontSize: 14,
                      fontFamily: "monospace",
                      minWidth: 100,
                    }}
                  >
                    {ver}
                  </div>
                  <div
                    style={{
                      color: statusColor,
                      fontSize: 13,
                      fontFamily: BP.font,
                    }}
                  >
                    {statusText}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ProjectMappingSection apiUrl={API_URL} />

      {/* Upload modal */}
      <Modal
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={doUpload}
        confirmLoading={uploading}
        okText="Загрузить"
        cancelText="Отмена"
        title="Загрузить новую версию"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{ fontSize: 13, color: BP.muted, marginBottom: 4 }}
            >
              Версия (например: 1.0.1)
            </div>
            <Input
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              placeholder="1.0.1"
            />
          </div>
          <div>
            <div
              style={{ fontSize: 13, color: BP.muted, marginBottom: 4 }}
            >
              Заметки (опционально)
            </div>
            <Input.TextArea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              rows={2}
              placeholder="Что нового в этой версии"
            />
          </div>
          <div>
            <div
              style={{ fontSize: 13, color: BP.muted, marginBottom: 4 }}
            >
              Файл BelfProctor.exe
            </div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFileObj(e.target.files?.[0] || null)}
            />
            {fileObj && (
              <div
                style={{
                  marginTop: 4,
                  color: BP.muted,
                  fontSize: 12,
                }}
              >
                {fileObj.name} — {formatBytes(fileObj.size)}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ProjectMappingSection({ apiUrl }) {
  const [roots, setRoots] = React.useState([]);
  const [aliases, setAliases] = React.useState([]);
  const [unknown, setUnknown] = React.useState([]);
  const [rootName, setRootName] = React.useState("");
  const [rootPath, setRootPath] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [projectName, setProjectName] = React.useState("");
  const [resolveValues, setResolveValues] = React.useState({});

  const load = React.useCallback(async () => {
    const [rootsRes, aliasesRes, unknownRes] = await Promise.all([
      authFetch(`${apiUrl}/work/project-roots`),
      authFetch(`${apiUrl}/work/project-aliases`),
      authFetch(`${apiUrl}/work/unknown`),
    ]);
    if (rootsRes.ok) {
      const j = await rootsRes.json();
      setRoots(Array.isArray(j.data) ? j.data : []);
    }
    if (aliasesRes.ok) {
      const j = await aliasesRes.json();
      setAliases(Array.isArray(j.data) ? j.data : []);
    }
    if (unknownRes.ok) {
      const j = await unknownRes.json();
      setUnknown(Array.isArray(j.data) ? j.data : []);
    }
  }, [apiUrl]);

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const addRoot = async () => {
    if (!rootName.trim() || !rootPath.trim()) return;
    const res = await authFetch(`${apiUrl}/work/project-roots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rootName.trim(), path: rootPath.trim() }),
    });
    if (res.ok) {
      setRootName("");
      setRootPath("");
      await load();
    }
  };

  const addAlias = async () => {
    if (!alias.trim() || !projectName.trim()) return;
    const res = await authFetch(`${apiUrl}/work/project-aliases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: alias.trim(), projectName: projectName.trim() }),
    });
    if (res.ok) {
      setAlias("");
      setProjectName("");
      await load();
    }
  };

  const remove = async (url) => {
    const res = await authFetch(url, { method: "DELETE" });
    if (res.ok) await load();
  };

  const resolveUnknown = async (id) => {
    const value = String(resolveValues[id] || "").trim();
    if (!value) return;
    const res = await authFetch(`${apiUrl}/work/unknown/${encodeURIComponent(id)}/resolve`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: value }),
    });
    if (res.ok) {
      setResolveValues((prev) => ({ ...prev, [id]: "" }));
      await load();
    }
  };

  const unknownPreview = unknown.slice(0, 12);

  return (
    <div
      className="bp-fade-in bp-section-card bp-interactive-card"
      style={{
        borderRadius: 18,
        padding: "18px 28px 22px",
        background: BP.white,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 18,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            Проекты и пути
          </div>
          <div
            style={{
              color: BP.muted,
              fontFamily: BP.font,
              fontSize: 14,
              marginTop: 4,
            }}
          >
            Настройте, какие папки считать проектами, и разберите внешние пути.
          </div>
        </div>
        <span
          className="bp-status-pill"
          style={{
            background: unknown.length ? "rgba(245,158,11,0.12)" : "rgba(38,126,38,0.1)",
            color: unknown.length ? "#B45309" : BP.green,
          }}
        >
          <Icon
            icon={unknown.length ? "solar:danger-triangle-bold-duotone" : "solar:check-circle-bold-duotone"}
            width={14}
            height={14}
          />
          {unknown.length ? `Неразобрано: ${unknown.length}` : "Все пути разобраны"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
          marginTop: 16,
        }}
      >
        <MappingCard
          icon="solar:folder-open-bold-duotone"
          title="Корневые папки"
          description="Папки, внутри которых система ищет проекты."
          count={roots.length}
        >
          <Input value={rootName} onChange={(e) => setRootName(e.target.value)} placeholder="Название проекта" />
          <Input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="C:\\Projects или \\\\server\\share" />
          <button type="button" onClick={addRoot} className="bp-primary-action" style={smallActionStyle(true)}>
            <Icon icon="solar:add-circle-bold-duotone" width={16} height={16} />
            Добавить папку
          </button>
          <ListRows
            rows={roots}
            empty="Корневые папки ещё не добавлены"
            emptyIcon="solar:folder-with-files-bold-duotone"
            render={(r) => (
              <>
                <span style={{ minWidth: 0 }}>
                  <strong>{r.name}</strong>
                  <span className="bp-path-text" title={r.path} style={{ display: "block", color: BP.muted, marginTop: 2 }}>
                    {r.path}
                  </span>
                </span>
                <button type="button" onClick={() => remove(`${apiUrl}/work/project-roots/${encodeURIComponent(r.id)}`)} className="bp-ghost-action" style={dangerMiniButtonStyle}>
                  <Icon icon="solar:trash-bin-trash-linear" width={14} height={14} />
                  Удалить
                </button>
              </>
            )}
          />
        </MappingCard>

        <MappingCard
          icon="solar:link-round-angle-bold-duotone"
          title="Псевдонимы проектов"
          description="Свяжите папки-алиасы с единым названием проекта."
          count={aliases.length}
        >
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Папка или алиас" />
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Основное название проекта" />
          <button type="button" onClick={addAlias} className="bp-primary-action" style={smallActionStyle(true)}>
            <Icon icon="solar:add-circle-bold-duotone" width={16} height={16} />
            Добавить алиас
          </button>
          <ListRows
            rows={aliases}
            empty="Псевдонимов пока нет"
            emptyIcon="solar:link-broken-bold-duotone"
            render={(r) => (
              <>
                <span className="bp-path-text" title={`${r.alias} -> ${r.projectName}`}>
                  {r.alias} <span style={{ color: BP.light }}>→</span> <strong>{r.projectName}</strong>
                </span>
                <button type="button" onClick={() => remove(`${apiUrl}/work/project-aliases/${encodeURIComponent(r.id)}`)} className="bp-ghost-action" style={dangerMiniButtonStyle}>
                  <Icon icon="solar:trash-bin-trash-linear" width={14} height={14} />
                  Удалить
                </button>
              </>
            )}
          />
        </MappingCard>

        <MappingCard
          icon="solar:question-circle-bold-duotone"
          title="Неразобранные пути"
          description="Внешние файлы не теряются: их можно привязать к проекту вручную."
          count={unknown.length}
        >
          <ListRows
            rows={unknownPreview}
            empty="Неразобранных путей нет"
            emptyHint="Когда агент увидит внешний файл, он появится здесь."
            emptyIcon="solar:check-read-bold-duotone"
            render={(r) => (
              <div style={{ display: "grid", gap: 6, width: "100%" }}>
                <span className="bp-path-text" title={r.path}>{r.path}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Input
                    value={resolveValues[r.id] || ""}
                    onChange={(e) => setResolveValues((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Название проекта"
                    size="small"
                  />
                  <button type="button" onClick={() => resolveUnknown(r.id)} className="bp-ghost-action" style={miniButtonStyle}>
                    <Icon icon="solar:link-round-bold" width={14} height={14} />
                    Привязать
                  </button>
                </div>
              </div>
            )}
          />
          {unknown.length > unknownPreview.length && (
            <div style={{ color: BP.muted, fontSize: 12, fontFamily: BP.font }}>
              Показаны первые {unknownPreview.length} из {unknown.length}
            </div>
          )}
        </MappingCard>
      </div>
    </div>
  );
}

function MappingCard({ icon, title, description, count, children }) {
  return (
    <div
      className="bp-soft-panel"
      style={{
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            display: "inline-grid",
            placeItems: "center",
            background: "rgba(38,126,38,0.09)",
            color: BP.green,
            flex: "0 0 auto",
          }}
        >
          <Icon icon={icon} width={18} height={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontFamily: BP.font, fontSize: 15, fontWeight: 510 }}>{title}</div>
            <span className="bp-status-pill" style={{ background: BP.white, color: BP.muted }}>{count}</span>
          </div>
          <div style={{ color: BP.muted, fontFamily: BP.font, fontSize: 12, marginTop: 2 }}>
            {description}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function ListRows({ rows, render, empty = "Пусто", emptyHint, emptyIcon = "solar:inbox-bold-duotone" }) {
  if (!rows?.length) {
    return (
      <div className="bp-empty-state" style={{ fontFamily: BP.font, fontSize: 13 }}>
        <Icon icon={emptyIcon} width={22} height={22} color={BP.light} />
        <div>{empty}</div>
        {emptyHint && <div style={{ fontSize: 12, color: BP.light }}>{emptyHint}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="bp-hover-row"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            padding: "9px 10px",
            border: `1px solid ${BP.surface}`,
            borderRadius: 10,
            background: "rgba(255,255,255,0.72)",
            fontFamily: BP.font,
            fontSize: 13,
            minWidth: 0,
          }}
        >
          {render(row)}
        </div>
      ))}
    </div>
  );
}

const miniButtonStyle = {
  border: `1px solid ${BP.stroke}`,
  background: BP.white,
  color: BP.text,
  borderRadius: 8,
  padding: "5px 9px",
  cursor: "pointer",
  fontFamily: BP.font,
  fontSize: 12,
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const dangerMiniButtonStyle = {
  ...miniButtonStyle,
  color: "#B91C1C",
  borderColor: "rgba(220,38,38,0.24)",
};

function smallActionStyle(primary) {
  return {
    border: primary ? "none" : `1px solid ${BP.stroke}`,
    background: primary ? BP.green : BP.white,
    color: primary ? BP.white : BP.text,
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontFamily: BP.font,
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "transform 0.16s ease, opacity 0.16s ease",
  };
}
