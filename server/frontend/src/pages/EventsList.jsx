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
} from "antd";
import { authFetch } from "../dataProvider.js";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";

const { Title } = Typography;

export default function EventsList() {
  const { t } = useTranslation();
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
            label: c.hostname || c.id,
            value: c.id,
          }))
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
  }, []); // Reload on mount. Ideally should reload periodically or when filter changes if we want to filter stats by client.

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
        const data = json.data || [];
        setItems(data);
        setTotal(json.total || 0);
        // Removed client-side aggregation
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  };
  React.useEffect(load, [page, clientFilter]);

  return (
    <List title={t("events.title")}>
      <Select
        style={{ width: 300, marginBottom: 16 }}
        placeholder="Фильтр по клиенту"
        allowClear
        options={clientOptions}
        value={clientFilter}
        onChange={(val) => {
          setClientFilter(val);
          setPage(1); // Reset to first page on filter change
        }}
      />

      {/* App Usage Summary Block */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>Часто используемые приложения</Title>
        {appStats.length === 0 ? (
          <Empty
            description="Нет данных о приложениях"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Row gutter={[16, 16]}>
            {appStats.slice(0, 8).map((app) => {
              const diffMins = dayjs().diff(dayjs(app.lastSeen), "minute");
              const isActive = diffMins < 10;
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
                      title={app.processName || app.name}
                      value={isActive ? "Активно" : `${diffMins} мин. назад`}
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
            render: (v) => dayjs(v).format("DD.MM.YYYY HH:mm:ss"),
          },
          { title: t("common.type"), dataIndex: "eventType" },
          { title: t("common.description"), dataIndex: "description" },
          { title: t("common.process"), dataIndex: "processName" },
          { title: t("common.device"), dataIndex: "deviceId" },
          { title: t("common.network"), dataIndex: "networkAddress" },
        ]}
      />
    </List>
  );
}
