import React from "react";
import { List } from "@refinedev/antd";
import { Table, Modal, Form, Input, Button, message, Alert } from "antd";
import { authFetch } from "../dataProvider.js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function ClientsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [data, setData] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [lastCreated, setLastCreated] = React.useState(null);
  const [form] = Form.useForm();
  const [selected, setSelected] = React.useState([]);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);
  const [bulkForm] = Form.useForm();
  const genId = React.useCallback(() => {
    const n = Math.floor(Math.random() * 1e6)
      .toString()
      .padStart(6, "0");
    return `CLIENT${n}`;
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
      .then((json) => {
        setData(Array.isArray(json) ? json : []);
      })
      .catch(() => setData([]));
    authFetch(`${API_URL}/heartbeat/latest`)
      .then((r) => r.json())
      .then((json) => {
        setLatestHeartbeats(json.data || []);
      })
      .catch(() => {
        setLatestHeartbeats([]);
      });
  }, [API_URL]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const headers = { "Content-Type": "application/json" };
      const res = await authFetch(`${API_URL}/clients/register`, {
        method: "POST",
        headers,
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
      const headers = { "Content-Type": "application/json" };
      const res = await authFetch(`${API_URL}/clients/register`, {
        method: "POST",
        headers,
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
  const bulkDelete = async () => {
    if (!selected.length) return;
    await Promise.allSettled(
      selected.map((id) =>
        authFetch(`${API_URL}/clients/${id}`, { method: "DELETE" })
      )
    );
    message.success(t("clients.deleteComplete"));
    setSelected([]);
    load();
  };
  const bulkIntervals = async () => {
    try {
      const vals = await bulkForm.validateFields();
      setBulkLoading(true);
      const headers = { "Content-Type": "application/json" };
      await Promise.allSettled(
        selected.map((id) =>
          authFetch(`${API_URL}/commands/send`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              clientId: id,
              type: "setIntervals",
              payload: vals,
            }),
          })
        )
      );
      message.success(t("clients.intervalsSent"));
      setBulkOpen(false);
      bulkForm.resetFields();
    } finally {
      setBulkLoading(false);
    }
  };
  return (
    <List title={t("clients.title")}>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button onClick={autoCreate}>{t("clients.autoCreate")}</Button>
        <Button type="primary" onClick={() => setOpen(true)}>
          {t("clients.addClient")}
        </Button>
      </div>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button disabled={!selected.length} onClick={() => setBulkOpen(true)}>
          {t("clients.setIntervalsSelected")}
        </Button>
        <Button danger disabled={!selected.length} onClick={bulkDelete}>
          {t("clients.deleteSelected")}
        </Button>
      </div>
      {lastCreated && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          message={`ClientId: ${lastCreated.id}`}
          description={`EncryptionKey: ${lastCreated.encryptionKey}`}
          closable
          onClose={() => setLastCreated(null)}
        />
      )}
      <Table
        rowKey="id"
        dataSource={Array.isArray(data) ? data : []}
        pagination={false}
        size="small"
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        columns={[
          { title: "ClientId", dataIndex: "id" },
          { title: t("common.created"), dataIndex: "createdAt" },
          { title: t("common.updated"), dataIndex: "updatedAt" },
          {
            title: t("common.status"),
            render: (_, r) => {
              const hb = latestHeartbeats.find((h) => h.clientId === r.id);
              const online =
                hb &&
                Date.now() - new Date(hb.timestamp).getTime() < 3 * 60 * 1000;
              return online ? (
                <span style={{ color: "#52c41a" }}>{t("common.online")}</span>
              ) : (
                <span style={{ color: "#ff4d4f" }}>{t("common.offline")}</span>
              );
            },
          },
          {
            title: t("common.actions"),
            render: (_, r) => (
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  type="primary"
                  onClick={() => navigate(`/clients/${r.id}`)}
                >
                  {t("common.details")}
                </Button>
              </div>
            ),
          },
        ]}
      />
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
        open={open}
        title={t("clients.addClient")}
        onCancel={() => setOpen(false)}
        onOk={onCreate}
        confirmLoading={loading}
        okText={t("common.create")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="ClientId" rules={[{ required: true }]}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input />
              <Button onClick={() => form.setFieldValue("id", genId())}>
                {t("common.gen")}
              </Button>
            </div>
          </Form.Item>
          <Form.Item
            name="encryptionKey"
            label="EncryptionKey"
            rules={[{ required: true }]}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <Input />
              <Button
                onClick={() => form.setFieldValue("encryptionKey", genKey())}
              >
                {t("common.gen")}
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
}
