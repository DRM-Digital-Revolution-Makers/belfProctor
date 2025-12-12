import React, { useState } from "react";
import { Form, Input, Button, Card, Typography } from "antd";
import { useTranslation } from "react-i18next";

export default function LoginPage({ onSuccess }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const API_URL =
        import.meta.env.VITE_API_URL ||
        `http://${window.location.hostname}:8080/api`;
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("token", data.token);
        onSuccess?.();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 100 }}>
      <Card title={t("common.loginTitle")} style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="email"
            label={t("common.email")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("common.password")}
            rules={[{ required: true }]}
          >
            <Input.Password />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={loading} block>
            {t("common.login")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
