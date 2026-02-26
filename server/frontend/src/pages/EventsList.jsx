import React from "react";
import { List } from "@refinedev/antd";
import {
  Table,
  Card,
  Statistic,
  Row,
  Col,
  Typography,
  Empty,
  Tag,
  Select,
  Button,
  Modal,
} from "antd";
import { authFetch } from "../dataProvider.js";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { GlobalOutlined } from "@ant-design/icons";

const { Title } = Typography;

export default function EventsList() {
  const { t, i18n } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  // Client filter
  const [clientFilter, setClientFilter] = React.useState(null);
  const [clientOptions, setClientOptions] = React.useState([]);

  // Browser History Modal
  const [browserHistoryOpen, setBrowserHistoryOpen] = React.useState(false);
  const [browserEvents, setBrowserEvents] = React.useState([]);
  const [browserLoading, setBrowserLoading] = React.useState(false);

  // New state for apps
  const [appStats, setAppStats] = React.useState([]);

  React.useEffect(() => {
    // Fetch clients for filter
    authFetch(`${API_URL}/clients`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || [];
        setClientOptions(
          list.map((c) => ({
            label: c.id,
            value: c.id,
          })),
        );
      })
      .catch((err) => console.error("Failed to load clients", err));

    // Fetch App Stats
    authFetch(`${API_URL}/events/stats`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAppStats(data);
        }
      })
      .catch((err) => console.error("Failed to load stats", err));
  }, []); // Reload on mount

  const loadBrowserHistory = React.useCallback(async () => {
    if (!clientFilter) return;
    setBrowserLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "1000",
        clientId: clientFilter,
      });
      const res = await authFetch(`${API_URL}/events?${params.toString()}`);
      const json = await res.json();
      const allEvents = json.data || [];

      const browserNames = new Set([
        "browser", // Yandex
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
  }, [API_URL, clientFilter]);

  React.useEffect(() => {
    if (browserHistoryOpen) {
      loadBrowserHistory();
    }
  }, [browserHistoryOpen, loadBrowserHistory]);

  const load = () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (clientFilter) {
      params.append("clientId", clientFilter);
    }

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
  };
  React.useEffect(load, [page, clientFilter]);

  return (
    <List title={t("events.title")}>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Select
          showSearch
          style={{ width: 300 }}
          placeholder={t("common.filterByClient")}
          allowClear
          options={clientOptions}
          value={clientFilter}
          filterOption={(input, option) =>
            (option?.label ?? "").toLowerCase().includes(input.toLowerCase()) ||
            (option?.value ?? "").toLowerCase().includes(input.toLowerCase())
          }
          onChange={(val) => {
            setClientFilter(val);
            setPage(1); // Reset to first page on filter change
          }}
        />
        {clientFilter && (
          <Button
            icon={<GlobalOutlined />}
            onClick={() => setBrowserHistoryOpen(true)}
          >
            {t("common.browserHistory")}
          </Button>
        )}
      </div>

      <Modal
        title={`${t("common.browserHistory")}: ${clientFilter}`}
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
              render: (v) => {
                if (!v) return "-";
                try {
                  const d = new Date(v);
                  if (isNaN(d.getTime())) return "-";
                  d.setHours(d.getHours() - 2);
                  return d.toLocaleString(
                    i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                  );
                } catch {
                  return "-";
                }
              },
            },
            {
              title: t("common.browser"),
              dataIndex: "processName",
              width: 120,
              render: (processName) => {
                if (processName === "browser") return "Yandex";
                return processName || "-";
              },
            },
            {
              title: t("common.titleUrl"),
              dataIndex: "additionalData",
              render: (data) => {
                const title = data?.WindowTitle || "-";
                const url = data?.Url;
                return (
                  <div>
                    <div style={{ fontWeight: 500 }}>{title}</div>
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

      {/* App Usage Summary Block */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>{t("events.topApps")}</Title>
        {appStats.length === 0 ? (
          <Empty
            description={t("events.noAppsData")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Row gutter={[16, 16]}>
            {appStats.slice(0, 8).map((app) => {
              const diffMins = dayjs().diff(dayjs(app.lastSeen), "minute");
              const isActive = diffMins < 10;
              const title =
                app.processName === "browser"
                  ? "Yandex"
                  : app.processName || app.name;
              return (
                <Col
                  key={`${app.clientId}_${app.processName}`}
                  xs={24}
                  sm={12}
                  md={8}
                  lg={6}
                >
                  <Card
                    size="small"
                    bordered={false}
                    style={{ background: "#fafafa" }}
                  >
                    <Statistic
                      title={title}
                      value={
                        isActive
                          ? t("common.active")
                          : `${diffMins} ${t("common.minsAgo")}`
                      }
                      valueStyle={{
                        color: isActive ? "#52c41a" : undefined,
                        fontSize: 16,
                      }}
                      suffix={<Tag>{app.count}</Tag>}
                    />
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Table
        rowKey="id"
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
        }}
        columns={[
          {
            title: t("common.time"),
            dataIndex: "timestamp",
            render: (v) => {
              if (!v) return "-";
              try {
                const d = new Date(v);
                if (isNaN(d.getTime())) return "-";
                d.setHours(d.getHours() - 2);
                return d.toLocaleString(
                  i18n.language === "uz" ? "uz-UZ" : "ru-RU",
                  {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                );
              } catch {
                return "-";
              }
            },
          },
          { title: t("common.type"), dataIndex: "eventType" },
          {
            title: t("common.description"),
            dataIndex: "description",
            render: (text, record) => {
              const translateDriveType = (type) => {
                if (!type) return "";
                const key = type.toLowerCase();
                if (key === "removable") return t("common.removable");
                if (key === "fixed") return t("common.fixed");
                if (key === "cdrom") return t("common.cdrom");
                if (key === "network") return t("common.network");
                if (key === "ram") return t("common.ram");
                return type;
              };

              if (
                record.eventType === "USBConnected" &&
                record.additionalData
              ) {
                const { Label, Format, TotalSize, DriveType } =
                  record.additionalData;
                const driveTypeTranslated = translateDriveType(DriveType);
                return (
                  <div>
                    <div style={{ fontWeight: "bold" }}>
                      {t("common.usbConnected")}: {record.deviceId}
                    </div>
                    <div style={{ fontSize: "12px", color: "#666" }}>
                      {[Label, Format, TotalSize, driveTypeTranslated]
                        .filter(Boolean)
                        .join(" | ")}
                    </div>
                  </div>
                );
              }
              if (record.eventType === "USBDisconnected") {
                return (
                  <div style={{ fontWeight: "bold" }}>
                    {t("common.usbDisconnected")}: {record.deviceId}
                  </div>
                );
              }
              if (record.eventType === "FileAccess" && record.additionalData) {
                const { Action, Path, Drive } = record.additionalData;
                if (Drive) {
                  return (
                    <div>
                      <div style={{ fontWeight: "bold" }}>
                        {Action === "Created"
                          ? t("common.fileCopiedToUsb")
                          : Action === "Renamed"
                            ? t("common.fileRenamedOnUsb")
                            : text}
                      </div>
                      <div style={{ fontSize: "12px", color: "#666" }}>
                        <div>
                          {t("common.drive")}: {Drive}
                        </div>
                        <div>
                          {t("common.path")}: {Path}
                        </div>
                      </div>
                    </div>
                  );
                }
              }
              return text;
            },
          },
          {
            title: t("common.process"),
            dataIndex: "processName",
            render: (name) => {
              if (name === "browser") return "Yandex";
              return name || "-";
            },
          },
          { title: t("common.device"), dataIndex: "deviceId" },
          { title: t("common.network"), dataIndex: "networkAddress" },
        ]}
      />
    </List>
  );
}
