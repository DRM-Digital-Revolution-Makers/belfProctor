import React from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  message,
  Alert,
  Select,
  Dropdown,
  Checkbox,
} from "antd";
import { Icon } from "@iconify/react";
import { authFetch } from "../dataProvider.js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/* ============ Design tokens ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  blue: "#22408C",
  warning: "#B45309",
  red: "#DC2626",
  divider: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

/* ============ Helpers ============ */
function formatDuration(ms) {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м ${s % 60}с`;
  const h = Math.floor(m / 60);
  return `${h}ч ${m % 60}м`;
}

// Активность определяется по реальному `isActive` флагу из /api/activity/latest
// (клиент шлёт его при каждой смене состояния через ActivityMonitorService).
// Heartbeat НЕ используется для активности — только для online/offline.
//
// Для freshness/duration берём `_ingestedAt` (когда сервер получил запись),
// а не клиентский `timestamp` — иначе из-за расхождения часов клиент/сервер
// получаем отрицательную длительность.
function statusFromHeartbeat(hb, activity, nowMs) {
  const now = nowMs || Date.now();
  if (!hb && !activity)
    return { online: false, active: false, activeLabel: null, duration: null };
  const lastHb = hb?.lastHeartbeat || hb?.lastSeen || hb?.timestamp;
  const online = !!(lastHb && now - new Date(lastHb).getTime() < 3 * 60 * 1000);

  // server-side timestamp = устойчив к расхождению часов
  const actTs = activity?._ingestedAt
    ? new Date(activity._ingestedAt).getTime()
    : activity?.timestamp
      ? new Date(activity.timestamp).getTime()
      : null;
  const STALE_MS = 15 * 60 * 1000;
  const sinceAct = actTs != null ? Math.max(0, now - actTs) : null;
  const hasFreshActivity = sinceAct != null && sinceAct < STALE_MS;

  // Если клиент офлайн — он сейчас точно не активен (старая запись isActive=true игнорируется)
  const isActive = online && hasFreshActivity && activity?.isActive === true;

  let activeLabel = null;
  let duration = null;
  if (!online) {
    activeLabel = "Не активен";
    if (lastHb) duration = formatDuration(now - new Date(lastHb).getTime());
  } else if (isActive) {
    activeLabel = "Активен";
    duration = formatDuration(sinceAct);
  } else if (hasFreshActivity) {
    activeLabel = "Не активен";
    duration = formatDuration(sinceAct);
  } else {
    // online, но свежих данных активности нет — клиент ещё не сообщил состояние
    activeLabel = "—";
  }
  return { online, active: isActive, activeLabel, duration };
}

/* ============ Components ============ */
function ProfilePill({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bp-primary-action"
      style={{
        background: "rgba(38,126,38,0.08)",
        color: BP.green,
        border: "none",
        borderRadius: 30,
        padding: "8px 16px",
        cursor: "pointer",
        fontFamily: BP.font,
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}

function ColumnHeader({ label, width, flex }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: BP.muted,
        fontFamily: BP.font,
        fontSize: 14,
        ...(width ? { width } : {}),
        ...(flex ? { flex } : {}),
      }}
    >
      <span>{label}</span>
      <Icon
        icon="solar:sort-from-top-to-bottom-linear"
        width={14}
        height={14}
        color={BP.light}
      />
    </div>
  );
}

function StatusPill({ tone = "muted", children }) {
  const styles = {
    success: { color: BP.green, background: "rgba(38,126,38,0.1)" },
    info: { color: BP.blue, background: "rgba(34,64,140,0.08)" },
    muted: { color: BP.muted, background: BP.surface },
    warning: { color: BP.warning, background: "rgba(245,158,11,0.12)" },
  }[tone];
  return (
    <span className="bp-status-pill" style={styles}>
      {children}
    </span>
  );
}

function ClientsEmptyState({ hasFilter }) {
  return (
    <div className="bp-empty-state" style={{ margin: 40, minHeight: 160, fontFamily: BP.font }}>
      <Icon icon="solar:users-group-rounded-bold-duotone" width={28} height={28} color={BP.light} />
      <div style={{ color: BP.text, fontSize: 15, fontWeight: 510 }}>
        {hasFilter ? "По фильтрам ничего не найдено" : "Сотрудники ещё не добавлены"}
      </div>
      <div style={{ color: BP.muted, fontSize: 13 }}>
        {hasFilter
          ? "Измените поиск или категорию, чтобы увидеть сотрудников."
          : "Добавьте первого клиента, чтобы начать мониторинг."}
      </div>
    </div>
  );
}

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = React.useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 720px)").matches
      : false,
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return isNarrow;
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: BP.divider,
        opacity: 0.5,
        width: "calc(100% - 40px)",
        marginLeft: 20,
      }}
    />
  );
}

/* ============ Page ============ */
export default function ClientsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isNarrow = useIsNarrow();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    "/api";

  const [data, setData] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);
  const [latestActivity, setLatestActivity] = React.useState([]);
  const [tickNow, setTickNow] = React.useState(Date.now());
  const [, setServerTime] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState(null);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState([]);

  // Modals
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [lastCreated, setLastCreated] = React.useState(null);
  const [form] = Form.useForm();
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);
  const [bulkForm] = Form.useForm();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [deleteForm] = Form.useForm();
  const [catOpen, setCatOpen] = React.useState(false);
  const [catLoading, setCatLoading] = React.useState(false);
  const [catForm] = Form.useForm();

  const genId = React.useCallback(() => {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    return `CLIENT${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
  }, []);
  const genKey = React.useCallback(() => {
    const arr = new Uint8Array(32);
    (window.crypto || crypto).getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, []);

  const load = React.useCallback(() => {
    authFetch(`${API_URL}/clients`)
      .then(async (r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((json) => setData(Array.isArray(json) ? json : []))
      .catch(() => setData([]));
    authFetch(`${API_URL}/heartbeat/latest`)
      .then((r) => r.json())
      .then((json) => {
        setLatestHeartbeats(json.data || []);
        setServerTime(json.serverTime ? new Date(json.serverTime) : new Date());
      })
      .catch(() => setLatestHeartbeats([]));
    authFetch(`${API_URL}/activity/latest`)
      .then((r) => r.json())
      .then((json) => setLatestActivity(json.data || []))
      .catch(() => setLatestActivity([]));
  }, [API_URL]);
  React.useEffect(() => {
    load();
  }, [load]);

  // Авто-обновление heartbeat и activity каждые 5 секунд (no-cache)
  React.useEffect(() => {
    const refresh = () => {
      const ts = Date.now();
      authFetch(`${API_URL}/heartbeat/latest?ts=${ts}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return;
          setLatestHeartbeats(json.data || []);
          setServerTime(json.serverTime ? new Date(json.serverTime) : new Date());
        })
        .catch(() => {});
      authFetch(`${API_URL}/activity/latest?ts=${ts}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return;
          setLatestActivity(json.data || []);
        })
        .catch(() => {});
    };
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [API_URL]);

  // Локальный тик каждую секунду — обновляет отображаемую длительность
  // без новых сетевых запросов.
  React.useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const categories = React.useMemo(() => {
    const set = new Set();
    (Array.isArray(data) ? data : []).forEach((c) => {
      const v = String(c?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [data]);

  const filteredData = React.useMemo(() => {
    let arr = Array.isArray(data) ? data : [];
    if (categoryFilter)
      arr = arr.filter(
        (c) => String(c?.category || "") === String(categoryFilter),
      );
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((c) => String(c.id || "").toLowerCase().includes(q));
    }
    return arr;
  }, [data, categoryFilter, search]);

  /* ============ Actions ============ */
  const onCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const res = await authFetch(`${API_URL}/clients/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: values.id,
          encryptionKey: values.encryptionKey,
        }),
      });
      if (!res.ok) {
        message.error(t("clients.createFailed"));
        return;
      }
      const client = await res.json();
      setLastCreated(client);
      Modal.success({
        title: t("clients.created"),
        content: `ClientId: ${client.id}\nEncryptionKey: ${client.encryptionKey}`,
      });
      setOpen(false);
      form.resetFields();
      load();
    } finally {
      setLoading(false);
    }
  };
  const autoCreate = async () => {
    try {
      setLoading(true);
      const id = genId();
      const encryptionKey = genKey();
      const res = await authFetch(`${API_URL}/clients/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, encryptionKey }),
      });
      if (!res.ok) {
        message.error(t("clients.createFailed"));
        return;
      }
      const client = await res.json();
      setLastCreated(client);
      Modal.success({
        title: t("clients.created"),
        content: `ClientId: ${client.id}\nEncryptionKey: ${client.encryptionKey}`,
      });
      load();
    } finally {
      setLoading(false);
    }
  };
  const confirmBulkDelete = async () => {
    if (!selected.length) return;
    try {
      const vals = await deleteForm.validateFields();
      setDeleteLoading(true);
      const password = String(vals.password || "").trim();
      const results = await Promise.all(
        selected.map(async (id) => {
          try {
            const resp = await authFetch(`${API_URL}/clients/${id}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            return { id, ok: resp.ok };
          } catch {
            return { id, ok: false };
          }
        }),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length)
        message.error(
          `${t("clients.deleteError")}: ${failed.length}/${selected.length}`,
        );
      else message.success(t("clients.deleteComplete"));
      setSelected([]);
      setSelectMode(false);
      setDeleteOpen(false);
      deleteForm.resetFields();
      load();
    } finally {
      setDeleteLoading(false);
    }
  };
  const bulkIntervals = async () => {
    try {
      const vals = await bulkForm.validateFields();
      setBulkLoading(true);
      await Promise.allSettled(
        selected.map((id) =>
          authFetch(`${API_URL}/commands/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: id,
              type: "setIntervals",
              payload: vals,
            }),
          }),
        ),
      );
      message.success(t("clients.intervalsSent"));
      setBulkOpen(false);
      bulkForm.resetFields();
    } finally {
      setBulkLoading(false);
    }
  };
  const bulkCategory = async () => {
    try {
      const vals = await catForm.validateFields();
      setCatLoading(true);
      await Promise.allSettled(
        selected.map((id) =>
          authFetch(`${API_URL}/clients/${id}/category`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: String(vals.category || "").trim(),
            }),
          }),
        ),
      );
      message.success(t("clients.setCategorySelected"));
      setCatOpen(false);
      catForm.resetFields();
      load();
    } finally {
      setCatLoading(false);
    }
  };

  const singleDelete = (id) => {
    setSelected([id]);
    setDeleteOpen(true);
  };

  const toggleRow = (id, on) => {
    setSelected((prev) =>
      on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };

  /* ============ Render ============ */
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
          display: "flex",
          flexDirection: "column",
          gap: 40,
          minHeight: "calc(100vh - 64px)",
        }}
      >
        {/* Inner table card */}
        <div
          style={{
            background: BP.white,
            border: `3px solid ${BP.white}`,
            borderRadius: 30,
            boxShadow: BP.shadow,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {/* Header: title + search + add + actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "20px 20px 0",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontFamily: BP.font,
                  fontSize: 24,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                {t("employees.title")}
              </h2>
              <div style={{ color: BP.muted, fontFamily: BP.font, fontSize: 14, marginTop: 4 }}>
                {filteredData.length} из {data.length} клиентов в списке
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flex: 1,
                justifyContent: "flex-end",
                flexDirection: isNarrow ? "column" : "row",
              }}
            >
              {/* Search */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: BP.surface,
                  borderRadius: 10,
                  padding: "12px 20px",
                  minWidth: isNarrow ? "100%" : 280,
                  width: isNarrow ? "100%" : "auto",
                  gap: 10,
                }}
              >
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("employees.search")}
                  style={{
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    flex: 1,
                    fontFamily: BP.font,
                    fontSize: 14,
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

              {/* Category filter */}
              <Select
                allowClear
                style={{ minWidth: isNarrow ? "100%" : 180, width: isNarrow ? "100%" : undefined }}
                placeholder={t("common.category")}
                value={categoryFilter}
                options={categories.map((c) => ({ label: c, value: c }))}
                onChange={(v) => {
                  setCategoryFilter(v || null);
                  setSelected([]);
                }}
              />

              {/* Add */}
              <Button
                type="primary"
                onClick={() => setOpen(true)}
                icon={
                  <Icon
                    icon="solar:add-circle-bold-duotone"
                    width={18}
                    height={18}
                  />
                }
                style={{
                  background: BP.green,
                  borderColor: BP.green,
                  borderRadius: 30,
                  height: 40,
                  fontWeight: 510,
                  width: isNarrow ? "100%" : undefined,
                }}
              >
                {t("clients.addClient")}
              </Button>

              {/* Bulk actions menu */}
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "select",
                      label: selectMode ? "Снять выбор" : "Выбрать несколько",
                      onClick: () => {
                        setSelectMode((v) => !v);
                        if (selectMode) setSelected([]);
                      },
                    },
                    { type: "divider" },
                    {
                      key: "auto",
                      label: t("clients.autoCreate"),
                      onClick: autoCreate,
                    },
                    {
                      key: "intervals",
                      label: t("clients.setIntervalsSelected"),
                      disabled: !selected.length,
                      onClick: () => setBulkOpen(true),
                    },
                    {
                      key: "category",
                      label: t("clients.setCategorySelected"),
                      disabled: !selected.length,
                      onClick: () => setCatOpen(true),
                    },
                    {
                      key: "delete",
                      danger: true,
                      label: t("clients.deleteSelected"),
                      disabled: !selected.length,
                      onClick: () => setDeleteOpen(true),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  style={{
                    padding: 8,
                    height: 40,
                    width: isNarrow ? "100%" : 40,
                    borderRadius: 30,
                    background: BP.surface,
                  }}
                  icon={
                    <Icon
                      icon="solar:menu-dots-bold"
                      width={20}
                      height={20}
                      color={BP.muted}
                    />
                  }
                />
              </Dropdown>
            </div>
          </div>

          {/* Selection bar */}
          {selectMode && selected.length > 0 && (
            <div
              style={{
                margin: "12px 20px 0",
                padding: "10px 16px",
                background: BP.surface,
                borderRadius: 12,
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span style={{ color: BP.muted }}>
                Выбрано: {selected.length}
              </span>
              <div style={{ flex: 1 }} />
              <Button size="small" onClick={() => setBulkOpen(true)}>
                {t("clients.setIntervalsSelected")}
              </Button>
              <Button size="small" onClick={() => setCatOpen(true)}>
                {t("clients.setCategorySelected")}
              </Button>
              <Button size="small" danger onClick={() => setDeleteOpen(true)}>
                {t("clients.deleteSelected")}
              </Button>
            </div>
          )}

          {/* Last created alert */}
          {lastCreated && (
            <div style={{ margin: "12px 20px 0" }}>
              <Alert
                type="info"
                message={`ClientId: ${lastCreated.id}`}
                description={`EncryptionKey: ${lastCreated.encryptionKey}`}
                closable
                onClose={() => setLastCreated(null)}
              />
            </div>
          )}

          {/* Топ бар таблицы */}
          <div
            style={{
              display: isNarrow ? "none" : "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 28px",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flex: 1,
              }}
            >
              {selectMode && <div style={{ width: 28 }} />}
              <ColumnHeader label="№" width={40} />
              <ColumnHeader label={t("common.name")} flex={2} />
              <ColumnHeader label={t("common.status")} flex={1} />
              <ColumnHeader label="Активность" flex={1} />
            </div>
            <div style={{ width: 200 }} />
          </div>

          <Divider />

          {/* База: rows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "calc(100vh - 280px)",
              overflowY: "auto",
            }}
          >
            {filteredData.length === 0 ? (
              <ClientsEmptyState hasFilter={Boolean(search.trim() || categoryFilter)} />
            ) : (
              filteredData.map((c, i) => {
                const hb = latestHeartbeats.find((h) => h.clientId === c.id);
                const act = latestActivity.find((a) => a.clientId === c.id);
                const st = statusFromHeartbeat(hb, act, tickNow);
                const statusTone = st.online ? "success" : "muted";
                const statusLabel = st.online ? "Онлайн" : "Оффлайн";
                const activityTone = st.active ? "success" : "muted";
                const activityLabel = st.active
                  ? "Активен"
                  : st.activeLabel === "—"
                    ? "Нет данных"
                    : "Нет активности";
                const isSelected = selected.includes(c.id);

                if (isNarrow) {
                  return (
                    <div
                      key={c.id}
                      className="bp-hover-row bp-interactive-card"
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 14,
                        margin: i === 0 ? "0 0 8px" : "8px 0",
                        border: `1px solid ${BP.surface}`,
                        borderRadius: 16,
                        background: isSelected ? "rgba(38,126,38,0.04)" : BP.white,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: BP.light, fontSize: 12, fontFamily: BP.font }}>
                            № {i + 1}
                          </div>
                          <div
                            style={{
                              color: BP.text,
                              fontFamily: BP.font,
                              fontSize: 16,
                              fontWeight: 510,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={c.id}
                          >
                            {c.id}
                          </div>
                        </div>
                        {selectMode && (
                          <Checkbox
                            checked={isSelected}
                            onChange={(e) => toggleRow(c.id, e.target.checked)}
                          />
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
                        <StatusPill tone={activityTone}>{activityLabel}</StatusPill>
                        {st.duration && (
                          <span style={{ color: BP.muted, fontSize: 12, fontFamily: BP.font }}>
                            {st.duration}
                          </span>
                        )}
                      </div>
                      <ProfilePill
                        label={t("dashboard.openProfile")}
                        onClick={() => navigate(`/clients/${c.id}`)}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={c.id}
                    className="bp-hover-row bp-interactive-card"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 28px",
                      gap: 10,
                      borderTop: i === 0 ? "none" : `1px solid ${BP.surface}`,
                      background: isSelected
                        ? "rgba(38,126,38,0.04)"
                        : "transparent",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flex: 1,
                      }}
                    >
                      {selectMode && (
                        <div style={{ width: 28 }}>
                          <Checkbox
                            checked={isSelected}
                            onChange={(e) => toggleRow(c.id, e.target.checked)}
                          />
                        </div>
                      )}
                      <div
                        style={{
                          width: 40,
                          color: BP.light,
                          fontFamily: BP.font,
                          fontSize: 14,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div
                        style={{
                          flex: 2,
                          color: BP.text,
                          fontFamily: BP.font,
                          fontSize: 16,
                          fontWeight: 510,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {c.id}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          fontFamily: BP.font,
                          fontSize: 16,
                          fontWeight: 400,
                        }}
                      >
                        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          fontFamily: BP.font,
                          fontSize: 16,
                          fontWeight: 400,
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                        }}
                      >
                        <StatusPill tone={activityTone}>{activityLabel}</StatusPill>
                        {st.duration && (
                          <span
                            style={{
                              color: BP.muted,
                              fontSize: 13,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {st.duration}
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: 200,
                        justifyContent: "flex-end",
                      }}
                    >
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            {
                              key: "open",
                              label: t("dashboard.openProfile"),
                              onClick: () => navigate(`/clients/${c.id}`),
                            },
                            {
                              key: "screenshots",
                              label: t("nav.screenshots"),
                              onClick: () =>
                                navigate(
                                  `/screenshots?clientId=${encodeURIComponent(c.id)}`,
                                ),
                            },
                            { type: "divider" },
                            {
                              key: "delete",
                              label: t("common.delete"),
                              danger: true,
                              onClick: () => singleDelete(c.id),
                            },
                          ],
                        }}
                      >
                        <button
                          type="button"
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon
                            icon="solar:menu-dots-bold"
                            width={20}
                            height={20}
                            color={BP.muted}
                          />
                        </button>
                      </Dropdown>

                      <ProfilePill
                        label={t("dashboard.openProfile")}
                        onClick={() => navigate(`/clients/${c.id}`)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modals — preserved */}
      <Modal
        open={bulkOpen}
        title={t("clients.intervalsForSelected")}
        onCancel={() => setBulkOpen(false)}
        onOk={bulkIntervals}
        confirmLoading={bulkLoading}
        okText={t("clients.install")}
      >
        <Form form={bulkForm} layout="vertical">
          <Form.Item name="heartbeatMs" label={t("common.heartbeatMs")}>
            <Input placeholder={`${t("common.example")} 5000`} />
          </Form.Item>
          <Form.Item name="activityMs" label={t("common.activityMs")}>
            <Input placeholder={`${t("common.example")} 3000`} />
          </Form.Item>
          <Form.Item name="screenshotMs" label={t("common.screenshotMs")}>
            <Input placeholder={`${t("common.example")} 60000`} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={catOpen}
        title={t("clients.setCategorySelected")}
        onCancel={() => setCatOpen(false)}
        onOk={bulkCategory}
        confirmLoading={catLoading}
        okText={t("common.save")}
      >
        <Form form={catForm} layout="vertical">
          <Form.Item
            name="category"
            label={t("common.category")}
            rules={[{ required: true }]}
          >
            <Input placeholder={t("common.example") + " Отдел продаж"} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={deleteOpen}
        title={t("clients.deleteSelected")}
        onCancel={() => setDeleteOpen(false)}
        onOk={confirmBulkDelete}
        confirmLoading={deleteLoading}
        okText={t("common.delete")}
      >
        <Form form={deleteForm} layout="vertical">
          <Form.Item
            name="password"
            label={t("common.password")}
            rules={[{ required: true, message: t("common.password") }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={open}
        title={t("clients.addClient")}
        onCancel={() => setOpen(false)}
        onOk={onCreate}
        confirmLoading={loading}
        okText={t("common.create")}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="ClientId" required>
            <div style={{ display: "flex", gap: 8 }}>
              <Form.Item name="id" noStyle rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Button onClick={() => form.setFieldValue("id", genId())}>
                {t("common.gen")}
              </Button>
            </div>
          </Form.Item>
          <Form.Item label="EncryptionKey" required>
            <div style={{ display: "flex", gap: 8 }}>
              <Form.Item
                name="encryptionKey"
                noStyle
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Button
                onClick={() => form.setFieldValue("encryptionKey", genKey())}
              >
                {t("common.gen")}
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
