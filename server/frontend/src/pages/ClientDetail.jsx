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
} from "antd";
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  UserOutlined,
  StopOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { authFetch } from "../dataProvider";

const { Title } = Typography;
const { Content } = Layout;

const ClientDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [data, setData] = useState({
    activeMs: 0,
    inactiveMs: 0,
    screenshots: [],
  });

  const fetchData = useCallback(
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
        setData(json);
      } catch (error) {
        console.error(error);
        message.error(t("common.requestError"));
      } finally {
        setLoading(false);
      }
    },
    [id, t]
  );

  useEffect(() => {
    fetchData(selectedDate);
  }, [fetchData, selectedDate]);

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

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/clients")}
          />
          <Title level={2} style={{ margin: 0 }}>
            {t("common.clientDetail")}: {id}
          </Title>
        </div>

        {/* Filters */}
        <Card>
          <Space>
            <span style={{ fontSize: "16px", fontWeight: 500 }}>
              {t("common.selectDate")}:
            </span>
            <DatePicker
              value={selectedDate}
              onChange={(date) => {
                if (date) setSelectedDate(date);
              }}
              allowClear={false}
              style={{ width: 200 }}
            />
          </Space>
        </Card>

        {/* Statistics */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <Card>
              <Statistic
                title={t("common.dayActivity")}
                value={formatDuration(data.activeMs)}
                prefix={<ClockCircleOutlined style={{ color: "#52c41a" }} />}
                valueStyle={{ color: "#3f8600" }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card>
              <Statistic
                title={t("common.dayInactivity")}
                value={formatDuration(data.inactiveMs)}
                prefix={<StopOutlined style={{ color: "#cf1322" }} />}
                valueStyle={{ color: "#cf1322" }}
              />
            </Card>
          </Col>
        </Row>

        {/* Screenshots */}
        <Card title={t("common.screenshots")}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "50px" }}>
              <Spin size="large" />
            </div>
          ) : data.screenshots && data.screenshots.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "16px",
              }}
            >
              <Image.PreviewGroup>
                {data.screenshots.map((s) => (
                  <div key={s.id} style={{ textAlign: "center" }}>
                    <Image
                      src={getImageUrl(s.url)}
                      alt={s.filename}
                      style={{
                        width: "100%",
                        height: "150px",
                        objectFit: "cover",
                        borderRadius: "8px",
                        border: "1px solid #f0f0f0",
                      }}
                    />
                    <div
                      style={{
                        marginTop: "8px",
                        color: "#888",
                        fontSize: "12px",
                      }}
                    >
                      {dayjs(s.timestamp).format("HH:mm:ss")}
                    </div>
                  </div>
                ))}
              </Image.PreviewGroup>
            </div>
          ) : (
            <Empty description={t("common.noScreenshots")} />
          )}
        </Card>
      </Space>
    </div>
  );
};

export default ClientDetail;
