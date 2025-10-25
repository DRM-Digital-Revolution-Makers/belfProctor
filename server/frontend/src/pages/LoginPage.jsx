import React, { useState } from "react";
import { Form, Input, Button, Card, Typography } from "antd";

export default function LoginPage({ onSuccess }) {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
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
      <Card title="Вход в админку" style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="Email" rules={[{ required: true }]}> 
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true }]}> 
            <Input.Password />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={loading} block>
            Войти
          </Button>
        </Form>
      </Card>
    </div>
  );
}