import React from "react";
import { Table, Modal } from "antd";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { authFetch } from "../dataProvider.js";
import { formatTashkent } from "../utils/time";

/* ============ Design primitives (pixel-perfect Figma) ============ */

const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  red: "#DC2626",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

function ArrowButton() {
  return (
    <div
      className="bp-icon-button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 4,
        border: `1px solid ${BP.light}`,
        borderRadius: 20,
        background: BP.white,
        cursor: "pointer",
      }}
    >
      <Icon
        icon="solar:arrow-right-up-linear"
        width={20}
        height={20}
        color={BP.text}
      />
    </div>
  );
}

function SectionCard({ children, style }) {
  return (
    <div
      className="bp-interactive-card"
      style={{
        background: BP.white,
        borderRadius: 24,
        border: "1px solid rgba(164,164,164,0.42)",
        boxShadow: BP.shadow,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatCard({ title, value, sub, icon, tone = "green" }) {
  const toneColor = tone === "blue" ? "#22408C" : BP.green;
  return (
    <SectionCard style={{ flex: 1, padding: 20, justifyContent: "space-between", minHeight: 132 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: tone === "blue" ? "rgba(34,64,140,0.08)" : "rgba(38,126,38,0.09)",
              color: toneColor,
              display: "inline-grid",
              placeItems: "center",
            }}
          >
            <Icon icon={icon} width={20} height={20} />
          </span>
          <div
            style={{
              fontFamily: BP.font,
              fontSize: 18,
              fontWeight: 510,
              color: BP.text,
            }}
          >
            {title}
          </div>
        </div>
        <ArrowButton />
      </div>
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 32,
          fontWeight: 400,
          color: BP.text,
          lineHeight: 1,
          marginTop: 12,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 16,
          color: BP.muted,
          marginTop: 8,
        }}
      >
        {sub}
      </div>
    </SectionCard>
  );
}

function DashboardEmpty({ icon, title, text, action }) {
  return (
    <div className="bp-empty-state" style={{ margin: 28, minHeight: 132, fontFamily: BP.font }}>
      <Icon icon={icon} width={26} height={26} color={BP.light} />
      <div style={{ color: BP.text, fontSize: 15, fontWeight: 510 }}>{title}</div>
      <div style={{ color: BP.muted, fontSize: 13 }}>{text}</div>
      {action}
    </div>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 20px",
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
        {title}
      </div>
      {action || <ArrowButton />}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: BP.light,
        opacity: 0.3,
        width: "100%",
      }}
    />
  );
}

function OnlineRow({ index, name, onOpen }) {
  return (
    <div
      className="bp-hover-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 28px",
        cursor: "pointer",
      }}
      onClick={onOpen}
    >
      <div
        style={{
          fontFamily: BP.font,
          fontSize: 14,
          color: BP.light,
          minWidth: 24,
        }}
      >
        {index}
      </div>
      <div
        style={{
          flex: 1,
          fontFamily: BP.font,
          fontSize: 14,
          color: BP.text,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 50,
          background: "rgba(38,126,38,0.1)",
          color: BP.green,
          fontFamily: BP.font,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        ● online
      </div>
    </div>
  );
}

function ReportButton({ icon, number, label, onClick }) {
  return (
    <div
      className="bp-hover-row"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 28px",
        borderRadius: 12,
        background: "transparent",
        cursor: "pointer",
        color: BP.green,
        fontFamily: BP.font,
        fontWeight: 510,
        fontSize: 15,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = BP.surface)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        style={{
          position: "relative",
          background: BP.surface,
          borderRadius: 2,
          padding: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
        }}
      >
        <Icon icon={icon} width={24} height={24} color={BP.green} />
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 600,
            color: BP.green,
            paddingTop: 4,
          }}
        >
          {number}
        </span>
      </div>
      <span>{label}</span>
    </div>
  );
}

function ProfilePillButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bp-ghost-action"
      style={{
        background: BP.surface,
        color: BP.muted,
        border: "none",
        borderRadius: 30,
        padding: "8px 20px",
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

/* ============ Page ============ */

export default function EventsList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const [browserHistoryOpen, setBrowserHistoryOpen] = React.useState(false);
  const [browserEvents, setBrowserEvents] = React.useState([]);
  const [browserLoading, setBrowserLoading] = React.useState(false);
  const [browserClient, setBrowserClient] = React.useState(null);

  const [clientsAll, setClientsAll] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);
  const [latestActivity, setLatestActivity] = React.useState([]);
  const [serverTime, setServerTime] = React.useState(null);
  const [screenshotsToday, setScreenshotsToday] = React.useState(0);

  React.useEffect(() => {
    authFetch(`${API_URL}/clients`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || [];
        setClientsAll(list);
      })
      .catch(() => {});

    authFetch(`${API_URL}/heartbeat/latest`)
      .then((r) => r.json())
      .then((json) => {
        setLatestHeartbeats(json.data || []);
        setServerTime(json.serverTime ? new Date(json.serverTime) : new Date());
      })
      .catch(() => {});

    authFetch(`${API_URL}/activity/latest`)
      .then((r) => r.json())
      .then((json) => setLatestActivity(json.data || []))
      .catch(() => {});

    const todayStart = dayjs().startOf("day").toISOString();
    authFetch(
      `${API_URL}/screenshots?page=1&pageSize=1&since=${encodeURIComponent(
        todayStart,
      )}`,
    )
      .then((r) => r.json())
      .then((json) => setScreenshotsToday(json?.total || 0))
      .catch(() => {});
  }, [API_URL]);

  const load = React.useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    authFetch(`${API_URL}/events?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        const raw = json.data || [];
        const data = raw.filter(
          (e) =>
            e.eventType !== "NetworkConnection" &&
            e.eventType !== "NetworkDisconnection",
        );
        setItems(data);
        setTotal(json.total || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  }, [API_URL, page]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadBrowserHistory = React.useCallback(async () => {
    if (!browserClient) return;
    setBrowserLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "1000",
        clientId: browserClient,
      });
      const res = await authFetch(`${API_URL}/events?${params.toString()}`);
      const json = await res.json();
      const allEvents = json.data || [];
      const browserNames = new Set([
        "browser",
        "chrome",
        "msedge",
        "firefox",
        "opera",
        "opera_gx",
      ]);
      const history = allEvents.filter((e) => {
        if (e.eventType !== "AppUsage") return false;
        const name = (e.processName || "").toLowerCase();
        return browserNames.has(name);
      });
      setBrowserEvents(history);
    } catch (e) {
      console.error(e);
    } finally {
      setBrowserLoading(false);
    }
  }, [API_URL, browserClient]);

  React.useEffect(() => {
    if (browserHistoryOpen) loadBrowserHistory();
  }, [browserHistoryOpen, loadBrowserHistory]);

  /* derived */
  const stats = React.useMemo(() => {
    const now = serverTime ? serverTime.getTime() : Date.now();
    const totalClients = clientsAll.length;
    const connected = latestHeartbeats.filter((h) => {
      const last =
        h?.lastHeartbeat || h?.lastSeen || h?.timestamp;
      return last && now - new Date(last).getTime() < 3 * 60 * 1000;
    }).length;
    // "Активны" — реальная активность пользователя по isActive флагу из
    // activity-стрима (НЕ heartbeat). Запись считается свежей если она
    // не старше 15 минут (чтобы не учитывать давно отвалившиеся).
    const STALE_MS = 15 * 60 * 1000;
    const active = latestActivity.filter((a) => {
      const t = a?.timestamp ? new Date(a.timestamp).getTime() : null;
      return t != null && now - t < STALE_MS && a?.isActive === true;
    }).length;
    return { active, connected, totalClients };
  }, [latestHeartbeats, latestActivity, clientsAll, serverTime]);

  const onlineList = React.useMemo(() => {
    const now = serverTime ? serverTime.getTime() : Date.now();
    return latestHeartbeats
      .filter((h) => {
        const last =
          h?.lastHeartbeat || h?.lastActivity || h?.lastSeen || h?.timestamp;
        return last && now - new Date(last).getTime() < 3 * 60 * 1000;
      })
      .slice(0, 8);
  }, [latestHeartbeats, serverTime]);

  /* Monitoring rows from events */
  const monitoringRows = React.useMemo(() => {
    return items
      .filter((e) => e.eventType === "AppUsage")
      .slice(0, 8)
      .map((e, i) => ({
        key: e.id || `${e.clientId}-${i}`,
        index: i + 1,
        clientId: e.clientId,
        name: e.clientId,
        activity:
          e?.additionalData?.WindowTitle ||
          e?.description ||
          `Открыл ${e.processName || "приложение"}`,
        process: e.processName === "browser" ? "Yandex" : e.processName || "—",
      }));
  }, [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Outer wrapper — layout_KDRBS7: padding 20, gap 40 */}
      <div
        className="bp-page-shell"
        style={{
          background: BP.surface,
          borderRadius: 50,
          boxShadow: BP.shadow,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: "calc(100vh - 64px)",
        }}
      >
        {/* Аппер бар: 3 stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <StatCard
            title={t("dashboard.activeCount")}
            value={stats.active}
            sub={`из ${stats.totalClients} человек`}
            icon="solar:user-check-bold-duotone"
          />
          <StatCard
            title={t("dashboard.connectedCount")}
            value={stats.connected}
            sub={`из ${stats.totalClients} человек`}
            icon="solar:server-square-cloud-bold-duotone"
            tone="blue"
          />
          <StatCard
            title={t("dashboard.screenshotsToday")}
            value={screenshotsToday}
            sub={t("dashboard.screenshotsTodaySub")}
            icon="solar:gallery-bold-duotone"
          />
        </div>

        {/* Миддл бар: Cейчас онлайн */}
        <div style={{ display: "flex", gap: 12 }}>
          <SectionCard style={{ flex: 1 }}>
            <SectionHeader title={t("dashboard.nowOnline")} />
            <Divider />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {onlineList.length === 0 ? (
                <DashboardEmpty
                  icon="solar:user-cross-rounded-bold-duotone"
                  title="Сейчас никто не онлайн"
                  text="Когда агент подключится, сотрудник появится в этом списке."
                />
              ) : (
                onlineList.map((h, i) => (
                  <OnlineRow
                    key={h.clientId}
                    index={i + 1}
                    name={h.clientId}
                    onOpen={() => navigate(`/clients/${h.clientId}`)}
                  />
                ))
              )}
            </div>
          </SectionCard>
        </div>

        {/* Нижний бар: Отчет + Мониторинг */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
            alignItems: "stretch",
            flex: 1,
            minHeight: 320,
          }}
        >
          {/* Отчет блок */}
          <SectionCard style={{ minWidth: 0 }}>
            <SectionHeader title={t("nav.report")} />
            <Divider />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 28,
              }}
            >
              <ReportButton
                icon="solar:calendar-bold-duotone"
                number="1"
                label="Дневной отчет"
                onClick={() => navigate("/report")}
              />
              <ReportButton
                icon="solar:calendar-bold-duotone"
                number="7"
                label="Недельный отчет"
                onClick={() => navigate("/report")}
              />
              <ReportButton
                icon="solar:calendar-bold-duotone"
                number="30"
                label="Месячный отчет"
                onClick={() => navigate("/report")}
              />
            </div>
          </SectionCard>

          {/* Мониторинг */}
          <SectionCard style={{ flex: 1, overflow: "hidden" }}>
            <SectionHeader
              title={t("dashboard.monitoring")}
              action={
                <div
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    // Don't open the browser-history modal with no client — it
                    // would just 400 and show an empty panel [F-M4].
                    const cid = monitoringRows[0]?.clientId || null;
                    if (!cid) return;
                    setBrowserClient(cid);
                    setBrowserHistoryOpen(true);
                  }}
                >
                  <ArrowButton />
                </div>
              }
            />

            {/* Топ бар таблицы */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 28px",
                gap: 16,
              }}
            >
              <div style={{ width: 32, color: BP.light, fontSize: 13 }}>No</div>
              <div style={{ flex: 1, color: BP.muted, fontSize: 13 }}>
                {t("common.name")}
              </div>
              <div style={{ flex: 2, color: BP.muted, fontSize: 13 }}>
                {t("common.description")}
              </div>
              <div style={{ width: 120, color: BP.muted, fontSize: 13 }}>
                {t("common.process")}
              </div>
              <div style={{ width: 160 }} />
            </div>
            <Divider />

            {/* База */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {monitoringRows.length === 0 ? (
                <DashboardEmpty
                  icon="solar:monitor-smartphone-bold-duotone"
                  title="Событий мониторинга пока нет"
                  text="Активность появится после первого события от клиента."
                />
              ) : (
                monitoringRows.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "12px 28px",
                      borderBottom: `1px solid ${BP.surface}`,
                    }}
                  >
                    <div style={{ width: 32, color: BP.light, fontSize: 16 }}>
                      {row.index}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        color: BP.text,
                        fontSize: 16,
                        fontWeight: 510,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.name}
                    </div>
                    <div
                      style={{
                        flex: 2,
                        color: BP.muted,
                        fontSize: 16,
                        fontWeight: 510,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.activity}
                    </div>
                    <div
                      style={{
                        width: 120,
                        color: BP.muted,
                        fontSize: 16,
                        fontWeight: 510,
                      }}
                    >
                      {row.process}
                    </div>
                    <div style={{ width: 160, textAlign: "right" }}>
                      <ProfilePillButton
                        label={t("dashboard.openProfile")}
                        onClick={() => navigate(`/clients/${row.clientId}`)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Browser history modal (preserved) */}
      <Modal
        title={`${t("common.browserHistory")}: ${browserClient || ""}`}
        open={browserHistoryOpen}
        onCancel={() => setBrowserHistoryOpen(false)}
        width={800}
        footer={null}
      >
        <Table
          loading={browserLoading}
          dataSource={browserEvents}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: t("common.time"),
              dataIndex: "timestamp",
              width: 180,
              render: (v) => formatTashkent(v),
            },
            {
              title: t("common.browser"),
              dataIndex: "processName",
              width: 120,
              render: (n) => (n === "browser" ? "Yandex" : n || "-"),
            },
            {
              title: t("common.titleUrl"),
              dataIndex: "additionalData",
              render: (data) => {
                const title = data?.WindowTitle || "-";
                const url = data?.Url;
                return (
                  <div>
                    <div style={{ fontWeight: 510 }}>{title}</div>
                    {url && (
                      <div style={{ fontSize: 12, color: "#1890ff" }}>
                        <a
                          href={url.startsWith("http") ? url : `https://${url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url}
                        </a>
                      </div>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </Modal>

      {total > monitoringRows.length && (
        <div style={{ color: BP.light, fontSize: 13, textAlign: "right" }}>
          Показано {monitoringRows.length} из {total} событий —{" "}
          <a
            onClick={() => setPage((p) => p + 1)}
            style={{ color: BP.green, cursor: "pointer" }}
          >
            загрузить ещё
          </a>
        </div>
      )}
    </div>
  );
}
