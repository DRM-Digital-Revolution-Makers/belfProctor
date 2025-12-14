import React from "react";
import { List } from "@refinedev/antd";
import { Table, Card, Statistic, Row, Col, Typography, Empty, Tag } from "antd";
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

  // New state for apps
  const [appStats, setAppStats] = React.useState([]);

  const load = () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    authFetch(`${API_URL}/events?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        const data = json.data || [];
        setItems(data);
        setTotal(json.total || 0);

        // Simple client-side processing for "Recent Apps" from the fetched page
        // Ideally this should be a separate API call if we want global stats
        const apps = {};
        data.forEach((e) => {
          if (e.processName) {
            if (!apps[e.processName]) {
              apps[e.processName] = {
                name: e.processName,
                lastSeen: e.timestamp,
                count: 0,
              };
            }
            apps[e.processName].count++;
            if (new Date(e.timestamp) > new Date(apps[e.processName].lastSeen)) {
              apps[e.processName].lastSeen = e.timestamp;
            }
          }
        });
        setAppStats(Object.values(apps).sort((a, b) => b.count - a.count));
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  };
  React.useEffect(load, [page]);

  return (
    <List title={t("events.title")}>
      {/* App Usage Summary Block */}
      <Card style={{ marginBottom: 24 }}>
        <Title level={4}>Активность приложений (на этой странице)</Title>
        {appStats.length === 0 ? (
          <Empty description="Нет данных о приложениях" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Row gutter={[16, 16]}>
            {appStats.slice(0, 8).map((app) => {
               const diffMins = dayjs().diff(dayjs(app.lastSeen), "minute");
               const isActive = diffMins < 10;
               return (
                <Col key={app.name} xs={24} sm={12} md={8} lg={6}>
                  <Card size="small" bordered={false} style={{ background: "#fafafa" }}>
                    <Statistic
                      title={app.name}
                      value={isActive ? "Активно" : `${diffMins} мин. назад`}
                      valueStyle={{ color: isActive ? "#52c41a" : undefined, fontSize: 16 }}
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
          { title: t("common.time"), dataIndex: "timestamp", render: (v) => dayjs(v).format("DD.MM.YYYY HH:mm:ss") },
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
