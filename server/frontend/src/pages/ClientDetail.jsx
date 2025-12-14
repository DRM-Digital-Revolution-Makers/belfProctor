import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card,
  DatePicker,
  Row,
  Col,
  Statistic,
  Image,
  Empty,
  Spin,
  Button,
  Typography,
  message,
  Layout,
  Space,
  Modal,
  Form,
  Input,
  Tabs,
  Table,
} from "antd";
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  UserOutlined,
  StopOutlined,
  StarOutlined,
  StarFilled,
  DownloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { authFetch } from "../dataProvider";

const { Title } = Typography;

const ClientDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedMonth, setSelectedMonth] = useState(dayjs());

  // Daily Data
  const [dailyData, setDailyData] = useState({
    activeMs: 0,
    inactiveMs: 0,
    screenshots: [],
  });

  // Monthly Data
  const [monthlyData, setMonthlyData] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const fetchDailyData = useCallback(
    async (date) => {
      setLoading(true);
      try {
        const dateStr = date.format("YYYY-MM-DD");
        const res = await authFetch(
          `${API_URL}/clients/${id}/daily-summary?date=${dateStr}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch data");
        }
        const json = await res.json();
        setDailyData(json);
      } catch (error) {
        console.error(error);
        message.error(t("common.requestError"));
      } finally {
        setLoading(false);
      }
    },
    [id, t, API_URL]
  );

  const fetchMonthlyData = useCallback(
    async (month) => {
      setMonthlyLoading(true);
      try {
        const dateStr = month.format("YYYY-MM");
        const res = await authFetch(
          `${API_URL}/clients/${id}/monthly-summary?date=${dateStr}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch monthly data");
        }
        const json = await res.json();
        setMonthlyData(json);
      } catch (error) {
        console.error(error);
        message.error(t("common.requestError"));
      } finally {
        setMonthlyLoading(false);
      }
    },
    [id, t, API_URL]
  );

  useEffect(() => {
    fetchDailyData(selectedDate);
  }, [fetchDailyData, selectedDate]);

  useEffect(() => {
    fetchMonthlyData(selectedMonth);
  }, [fetchMonthlyData, selectedMonth]);

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours} ${t("common.h")} ${minutes} ${t("common.m")}`;
  };

  const getImageUrl = (url) => {
    const baseUrl = API_URL.replace(/\/api$/, "");
    const token = localStorage.getItem("token") || "";
    return `${baseUrl}${url}?token=${token}`;
  };

  const toggleFavorite = async (screenshotId, currentStatus) => {
    const newStatus = !currentStatus;
    try {
      const res = await authFetch(
        `${API_URL}/screenshots/${screenshotId}/favorite`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFavorite: newStatus }),
        }
      );
      if (res.ok) {
        setDailyData((prev) => ({
          ...prev,
          screenshots: prev.screenshots.map((s) =>
            s.id === screenshotId ? { ...s, isFavorite: newStatus } : s
          ),
        }));
      }
    } catch (e) {
      console.error(e);
      message.error(t("common.error"));
    }
  };

  const handleInfo = async () => {
    const resp = await authFetch(`${API_URL}/clients/${id}`);
    if (!resp.ok) return;
    const info = await resp.json();
    Modal.info({
      title: `${t("common.client")} ${info.id}`,
      content: (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            EncryptionKey: <Input readOnly value={info.encryptionKey || ""} />
          </div>
          <Form
            layout="vertical"
            onFinish={async (vals) => {
              const headers2 = {
                "Content-Type": "application/json",
              };
              await authFetch(`${API_URL}/commands/send`, {
                method: "POST",
                headers: headers2,
                body: JSON.stringify({
                  clientId: id,
                  type: "setIntervals",
                  payload: vals,
                }),
              });
              message.success(t("clients.commandSent"));
            }}
          >
            <Form.Item name="heartbeatMs" label={t("common.heartbeatMs")}>
              <Input placeholder={`${t("common.example")} 5000`} />
            </Form.Item>
            <Form.Item name="activityMs" label={t("common.activityMs")}>
              <Input placeholder={`${t("common.example")} 3000`} />
            </Form.Item>
            <Form.Item name="screenshotMs" label={t("common.screenshotMs")}>
              <Input placeholder={`${t("common.example")} 60000`} />
            </Form.Item>
            <Button htmlType="submit" type="primary">
              {t("common.setIntervals")}
            </Button>
          </Form>
        </div>
      ),
      okText: t("common.close"),
    });
  };

  const handleDelete = () => {
    Modal.confirm({
      title: t("common.delete"),
      content: t("clients.deleteConfirm"),
      onOk: async () => {
        const resp = await authFetch(`${API_URL}/clients/${id}`, {
          method: "DELETE",
        });
        if (resp.ok) {
          message.success(t("clients.deleted"));
          navigate("/clients");
        } else {
          message.error(t("clients.deleteError"));
        }
      },
    });
  };

  const getNoun = (number, one, two, five) => {
    let n = Math.abs(number);
    n %= 100;
    if (n >= 5 && n <= 20) {
      return five;
    }
    n %= 10;
    if (n === 1) {
      return one;
    }
    if (n >= 2 && n <= 4) {
      return two;
    }
    return five;
  };

  const formatDurationVerbose = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} ${getNoun(days, "день", "дня", "дней")}`);
    if (hours > 0)
      parts.push(`${hours} ${getNoun(hours, "час", "часа", "часов")}`);
    if (minutes > 0) parts.push(`${minutes} мин`);
    if (seconds > 0)
      parts.push(
        `${seconds} ${getNoun(seconds, "секунда", "секунды", "секунд")}`
      );

    return parts.length > 0 ? parts.join(" ") : "0 секунд";
  };

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return "";
    return `"${String(val).replace(/"/g, '""')}"`;
  };

  const downloadCSV = (data, filename) => {
    const bom = "\uFEFF";
    const csvContent =
      "data:text/csv;charset=utf-8," + encodeURIComponent(bom + data);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadDaily = () => {
    if (!dailyData) return;

    // Daily Summary
    const summaryRows = [
      ["Дата", selectedDate.format("YYYY-MM-DD")],
      ["Активное время", formatDurationVerbose(dailyData.activeMs)],
      ["Неактивное время", formatDurationVerbose(dailyData.inactiveMs)],
      ["Количество скриншотов", dailyData.screenshots.length],
      [],
    ]
      .map((row) => row.map(escapeCSV).join(";"))
      .join("\n");

    // Top 5 Apps
    let topAppsSection = "";
    if (dailyData.topApps && dailyData.topApps.length > 0) {
      const topAppsHeader = ["Приложение", "Количество использований"]
        .map(escapeCSV)
        .join(";");
      const topAppsRows = dailyData.topApps
        .map((app) => [app.name, app.count].map(escapeCSV).join(";"))
        .join("\n");
      topAppsSection = `\n\n"Топ 5 приложений"\n${topAppsHeader}\n${topAppsRows}`;
    }

    // Hourly Activity
    let hourlySection = "";
    if (dailyData.hourly) {
      const hourlyHeader = [
        "Час",
        "Активное время",
        "Неактивное время",
        "Количество скриншотов",
      ]
        .map(escapeCSV)
        .join(";");
      const hourlyRows = dailyData.hourly
        .map((h) =>
          [
            `${String(h.hour).padStart(2, "0")}:00 - ${String(
              h.hour + 1
            ).padStart(2, "0")}:00`,
            formatDurationVerbose(h.activeMs),
            formatDurationVerbose(h.inactiveMs),
            h.screenshotsCount,
          ]
            .map(escapeCSV)
            .join(";")
        )
        .join("\n");
      hourlySection = `\n\n"Почасовая активность"\n${hourlyHeader}\n${hourlyRows}`;
    }

    // Screenshots
    const screenshotsHeader = ["Время", "Имя файла", "Избранное"]
      .map(escapeCSV)
      .join(";");
    const screenshotsRows = dailyData.screenshots
      .map((s) =>
        [
          dayjs(s.timestamp).format("HH:mm:ss"),
          s.filename,
          s.isFavorite ? "Да" : "Нет",
        ]
          .map(escapeCSV)
          .join(";")
      )
      .join("\n");
    const screenshotsSection = `\n\n"Скриншоты"\n${screenshotsHeader}\n${screenshotsRows}`;

    downloadCSV(
      summaryRows + topAppsSection + hourlySection + screenshotsSection,
      `report_daily_${id}_${selectedDate.format("YYYY-MM-DD")}.csv`
    );
  };

  const handleDownloadMonthly = () => {
    if (!monthlyData) return;

    const summaryRows = [
      ["Месяц", monthlyData.month],
      ["Всего активно", formatDurationVerbose(monthlyData.totalActiveMs)],
      ["Всего неактивно", formatDurationVerbose(monthlyData.totalInactiveMs)],
      ["Всего скриншотов", monthlyData.totalScreenshots],
      [],
    ]
      .map((row) => row.map(escapeCSV).join(";"))
      .join("\n");

    // Top 5 Apps
    let topAppsSection = "";
    if (monthlyData.topApps && monthlyData.topApps.length > 0) {
      const topAppsHeader = ["Приложение", "Количество использований"]
        .map(escapeCSV)
        .join(";");
      const topAppsRows = monthlyData.topApps
        .map((app) => [app.name, app.count].map(escapeCSV).join(";"))
        .join("\n");
      topAppsSection = `\n"Топ 5 приложений"\n${topAppsHeader}\n${topAppsRows}\n`;
    }

    const header = [
      "Дата",
      "Активное время",
      "Неактивное время",
      "Количество скриншотов",
    ]
      .map(escapeCSV)
      .join(";");

    const rows = monthlyData.days
      .map((d) =>
        [
          d.date,
          formatDurationVerbose(d.activeMs),
          formatDurationVerbose(d.inactiveMs),
          d.screenshotsCount,
        ]
          .map(escapeCSV)
          .join(";")
      )
      .join("\n");

    downloadCSV(
      summaryRows + topAppsSection + "\n" + header + "\n" + rows,
      `report_monthly_${id}_${monthlyData.month}.csv`
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/clients")}
            />
            <Title level={2} style={{ margin: 0 }}>
              {t("common.clientDetail")}: {id}
            </Title>
          </div>
          <Space>
            <Button icon={<UserOutlined />} onClick={handleInfo}>
              {t("common.info")}
            </Button>
            <Button danger icon={<StopOutlined />} onClick={handleDelete}>
              {t("common.delete")}
            </Button>
          </Space>
        </div>

        <Tabs defaultActiveKey="daily" type="card">
          <Tabs.TabPane tab={t("reports.daily")} key="daily">
            <Space direction="vertical" size="large" style={{ width: "100%" }}>
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 24,
                  }}
                >
                  <Space>
                    <span>{t("reports.selectDay")}:</span>
                    <DatePicker
                      value={selectedDate}
                      onChange={(d) => d && setSelectedDate(d)}
                      allowClear={false}
                    />
                  </Space>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={handleDownloadDaily}
                  >
                    {t("reports.download")}
                  </Button>
                </div>

                {loading ? (
                  <div style={{ textAlign: "center", padding: 40 }}>
                    <Spin size="large" />
                  </div>
                ) : (
                  <>
                    <Row gutter={[16, 16]}>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title={t("common.dayActivity")}
                            value={formatDuration(dailyData.activeMs)}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: "#3f8600" }}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title={t("common.dayInactivity")}
                            value={formatDuration(dailyData.inactiveMs)}
                            prefix={<StopOutlined />}
                            valueStyle={{ color: "#cf1322" }}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card>
                          <Statistic
                            title={t("common.screenshots")}
                            value={dailyData.screenshots.length}
                            prefix={<StarOutlined />}
                          />
                        </Card>
                      </Col>
                    </Row>

                    {dailyData.topApps && dailyData.topApps.length > 0 && (
                      <Card
                        title="Топ 5 приложений"
                        style={{ marginTop: 24 }}
                        size="small"
                      >
                        <Table
                          dataSource={dailyData.topApps}
                          rowKey="name"
                          pagination={false}
                          size="small"
                          columns={[
                            { title: "Приложение", dataIndex: "name" },
                            {
                              title: "Запусков/Активности",
                              dataIndex: "count",
                            },
                          ]}
                        />
                      </Card>
                    )}

                    <div style={{ marginTop: 24 }}>
                      <Title level={4}>{t("common.lastScreenshots")}</Title>
                      {dailyData.screenshots.length === 0 ? (
                        <Empty description={t("common.noScreenshots")} />
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(200px, 1fr))",
                            gap: "16px",
                          }}
                        >
                          {dailyData.screenshots.map((s) => (
                            <Card
                              key={s.id}
                              hoverable
                              cover={
                                <div style={{ position: "relative" }}>
                                  <Image
                                    alt={s.filename}
                                    src={getImageUrl(s.url)}
                                    fallback="https://via.placeholder.com/200?text=Error"
                                  />
                                  <Button
                                    type="text"
                                    icon={
                                      s.isFavorite ? (
                                        <StarFilled style={{ color: "gold" }} />
                                      ) : (
                                        <StarOutlined />
                                      )
                                    }
                                    style={{
                                      position: "absolute",
                                      top: 8,
                                      right: 8,
                                      background: "rgba(255,255,255,0.8)",
                                    }}
                                    onClick={() =>
                                      toggleFavorite(s.id, s.isFavorite)
                                    }
                                  />
                                </div>
                              }
                            >
                              <Card.Meta
                                title={dayjs(s.timestamp).format("HH:mm:ss")}
                                description={s.filename}
                              />
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Card>
            </Space>
          </Tabs.TabPane>

          <Tabs.TabPane tab={t("reports.monthly")} key="monthly">
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 24,
                }}
              >
                <Space>
                  <span>{t("reports.selectMonth")}:</span>
                  <DatePicker
                    picker="month"
                    value={selectedMonth}
                    onChange={(d) => d && setSelectedMonth(d)}
                    allowClear={false}
                  />
                </Space>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={handleDownloadMonthly}
                >
                  {t("reports.download")}
                </Button>
              </div>

              {monthlyLoading ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <Spin size="large" />
                </div>
              ) : monthlyData ? (
                <Space
                  direction="vertical"
                  size="large"
                  style={{ width: "100%" }}
                >
                  <Row gutter={[16, 16]}>
                    <Col span={8}>
                      <Card>
                        <Statistic
                          title={t("reports.totalActive")}
                          value={formatDuration(monthlyData.totalActiveMs)}
                          prefix={<ClockCircleOutlined />}
                          valueStyle={{ color: "#3f8600" }}
                        />
                      </Card>
                    </Col>
                    <Col span={8}>
                      <Card>
                        <Statistic
                          title={t("reports.totalInactive")}
                          value={formatDuration(monthlyData.totalInactiveMs)}
                          prefix={<StopOutlined />}
                          valueStyle={{ color: "#cf1322" }}
                        />
                      </Card>
                    </Col>
                    <Col span={8}>
                      <Card>
                        <Statistic
                          title={t("reports.totalScreenshots")}
                          value={monthlyData.totalScreenshots}
                          prefix={<StarOutlined />}
                        />
                      </Card>
                    </Col>
                  </Row>

                  {monthlyData.topApps && monthlyData.topApps.length > 0 && (
                    <Card
                      title="Топ 5 приложений (за месяц)"
                      style={{ marginTop: 24 }}
                      size="small"
                    >
                      <Table
                        dataSource={monthlyData.topApps}
                        rowKey="name"
                        pagination={false}
                        size="small"
                        columns={[
                          { title: "Приложение", dataIndex: "name" },
                          { title: "Запусков/Активности", dataIndex: "count" },
                        ]}
                      />
                    </Card>
                  )}
                </Space>
              ) : (
                <Empty description={t("common.noData")} />
              )}
            </Card>
          </Tabs.TabPane>
        </Tabs>
      </Space>
    </div>
  );
};

export default ClientDetail;
