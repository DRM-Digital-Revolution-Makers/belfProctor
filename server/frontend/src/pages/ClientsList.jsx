import React from "react";
import { List } from "@refinedev/antd";
import {
  Table,
  Modal,
  Form,
  Input,
  Button,
  message,
  Alert,
  Select,
  Space,
} from "antd";
import { authFetch } from "../dataProvider.js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

export default function ClientsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;
  const [data, setData] = React.useState([]);
  const [latestHeartbeats, setLatestHeartbeats] = React.useState([]);
  const [serverTime, setServerTime] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [lastCreated, setLastCreated] = React.useState(null);
  const [form] = Form.useForm();
  const [selected, setSelected] = React.useState([]);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);
  const [bulkForm] = Form.useForm();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [deleteForm] = Form.useForm();
  const [catOpen, setCatOpen] = React.useState(false);
  const [catLoading, setCatLoading] = React.useState(false);
  const [catForm] = Form.useForm();
  const [categoryFilter, setCategoryFilter] = React.useState(null);
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
        setServerTime(json.serverTime ? new Date(json.serverTime) : new Date());
      })
      .catch(() => {
        setLatestHeartbeats([]);
      });
  }, [API_URL]);

  React.useEffect(() => {
    load();
  }, [load]);

  const categories = React.useMemo(() => {
    const set = new Set();
    (Array.isArray(data) ? data : []).forEach((c) => {
      const v = String(c?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [data]);

  const filteredData = React.useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    if (!categoryFilter) return arr;
    return arr.filter(
      (c) => String(c?.category || "") === String(categoryFilter),
    );
  }, [data, categoryFilter]);

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
    setDeleteOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (!selected.length) return;
    try {
      const vals = await deleteForm.validateFields();
      setDeleteLoading(true);
      const password = String(vals.password || "").trim();
      const headers = { "X-Admin-Password": password };

      const results = await Promise.all(
        selected.map(async (id) => {
          try {
            const resp = await authFetch(`${API_URL}/clients/${id}`, {
              method: "DELETE",
              headers,
            });
            let msg = "";
            try {
              const j = await resp.json();
              msg = String(j?.message || "");
            } catch {
              msg = "";
            }
            return { id, ok: resp.ok, status: resp.status, message: msg };
          } catch (e) {
            return {
              id,
              ok: false,
              status: 0,
              message: String(e?.message || ""),
            };
          }
        }),
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        const first = failed[0];
        const detail = first?.message ? ` (${first.message})` : "";
        message.error(
          `${t("clients.deleteError")}: ${failed.length}/${selected.length}${detail}`,
        );
      } else message.success(t("clients.deleteComplete"));

      setSelected([]);
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
      const headers = { "Content-Type": "application/json" };
      await Promise.allSettled(
        selected.map((id) =>
          authFetch(`${API_URL}/clients/${id}/category`, {
            method: "PUT",
            headers,
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
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          style={{ minWidth: 240 }}
          placeholder={t("common.category")}
          value={categoryFilter}
          options={categories.map((c) => ({ label: c, value: c }))}
          onChange={(v) => {
            setCategoryFilter(v || null);
            setSelected([]);
          }}
        />
      </Space>
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
        <Button disabled={!selected.length} onClick={() => setCatOpen(true)}>
          {t("clients.setCategorySelected")}
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
        dataSource={filteredData}
        pagination={false}
        size="small"
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        columns={[
          { title: "ClientId", dataIndex: "id" },
          { title: t("common.category"), dataIndex: "category" },
          {
            title: t("common.created"),
            dataIndex: "createdAt",
            render: (val) =>
              val ? dayjs(val).format("DD.MM.YYYY HH:mm") : "-",
          },
          {
            title: t("common.updated"),
            dataIndex: "updatedAt",
            render: (val) =>
              val ? dayjs(val).format("DD.MM.YYYY HH:mm") : "-",
          },
          {
            title: t("common.status"),
            render: (_, r) => {
              const hb = latestHeartbeats.find((h) => h.clientId === r.id);
              const lastSeen =
                hb?.lastHeartbeat ||
                hb?.lastActivity ||
                hb?.lastSeen ||
                hb?.timestamp;
              const now = serverTime ? serverTime.getTime() : Date.now();
              const online =
                lastSeen && now - new Date(lastSeen).getTime() < 3 * 60 * 1000;
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
    </List>
  );
}
