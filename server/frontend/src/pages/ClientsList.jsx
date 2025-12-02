import React from "react";
import { List } from "@refinedev/antd";
import { Table, Modal, Form, Input, Button, message, Alert } from "antd";
import { authFetch } from "../dataProvider.js";

export default function ClientsList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
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
    const n = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
    return `CLIENT${n}`;
  }, []);
  const genKey = React.useCallback(() => {
    const arr = new Uint8Array(32);
    (window.crypto || crypto).getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
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
      .then((json) => { setLatestHeartbeats(json.data || []); })
      .catch(() => { setLatestHeartbeats([]); });
  }, [API_URL]);

  React.useEffect(() => { load(); }, [load]);

  const onCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const headers = { "Content-Type": "application/json" };
      const res = await authFetch(`${API_URL}/clients/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: values.id, encryptionKey: values.encryptionKey }),
      });
      if (!res.ok) {
        message.error("Не удалось создать клиента");
        return;
      }
      const client = await res.json();
      setLastCreated(client);
      Modal.success({ title: "Клиент создан", content: `ClientId: ${client.id}\nEncryptionKey: ${client.encryptionKey}` });
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
        message.error("Не удалось создать клиента");
        return;
      }
      const client = await res.json();
      setLastCreated(client);
      Modal.success({ title: "Клиент создан", content: `ClientId: ${client.id}\nEncryptionKey: ${client.encryptionKey}` });
      load();
    } finally {
      setLoading(false);
    }
  };
  const bulkDelete = async () => {
    if (!selected.length) return;
    await Promise.allSettled(selected.map((id) => authFetch(`${API_URL}/clients/${id}`, { method: "DELETE" })));
    message.success("Удаление завершено");
    setSelected([]);
    load();
  };
  const bulkIntervals = async () => {
    try {
      const vals = await bulkForm.validateFields();
      setBulkLoading(true);
      const headers = { "Content-Type": "application/json" };
      await Promise.allSettled(selected.map((id) => authFetch(`${API_URL}/commands/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({ clientId: id, type: "setIntervals", payload: vals }),
      })));
      message.success("Интервалы отправлены");
      setBulkOpen(false);
      bulkForm.resetFields();
    } finally {
      setBulkLoading(false);
    }
  };
  return (
    <List title="Клиенты">
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={autoCreate}>Автосоздать клиента</Button>
        <Button type="primary" onClick={() => setOpen(true)}>Добавить клиента</Button>
      </div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button disabled={!selected.length} onClick={() => setBulkOpen(true)}>Установить интервалы выбранным</Button>
        <Button danger disabled={!selected.length} onClick={bulkDelete}>Удалить выбранных</Button>
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
      <Table rowKey="id" dataSource={Array.isArray(data) ? data : []} pagination={false} size="small" rowSelection={{ selectedRowKeys: selected, onChange: setSelected }} columns={[
        { title: "ClientId", dataIndex: "id" },
        { title: "Создан", dataIndex: "createdAt" },
        { title: "Обновлён", dataIndex: "updatedAt" },
        { title: "Статус", render: (_, r) => {
          const hb = latestHeartbeats.find((h) => h.clientId === r.id);
          const online = hb && (Date.now() - new Date(hb.timestamp).getTime()) < 3 * 60 * 1000;
          return online ? <span style={{ color: "#52c41a" }}>Подключен</span> : <span style={{ color: "#ff4d4f" }}>Отключен</span>;
        } },
        { title: "Действия", render: (_, r) => (
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={async () => {
              const resp = await authFetch(`${API_URL}/clients/${r.id}`);
              if (!resp.ok) return;
              const info = await resp.json();
              Modal.info({
                title: `Клиент ${info.id}`,
                content: (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div>EncryptionKey: <Input readOnly value={info.encryptionKey || ""} /></div>
                    <Form layout="vertical" onFinish={async (vals) => {
                      const headers2 = { "Content-Type": "application/json" };
                      await authFetch(`${API_URL}/commands/send`, {
                        method: "POST",
                        headers: headers2,
                        body: JSON.stringify({ clientId: r.id, type: "setIntervals", payload: vals }),
                      });
                      message.success("Команда отправлена");
                    }}>
                      <Form.Item name="heartbeatMs" label="Heartbeat ms">
                        <Input placeholder="например 5000" />
                      </Form.Item>
                      <Form.Item name="activityMs" label="Activity ms">
                        <Input placeholder="например 3000" />
                      </Form.Item>
                      <Form.Item name="screenshotMs" label="Screenshot ms">
                        <Input placeholder="например 60000" />
                      </Form.Item>
                      <Button htmlType="submit" type="primary">Установить интервалы</Button>
                    </Form>
                  </div>
                ),
                okText: "Закрыть",
              });
            }}>Инфо</Button>
            <Button danger onClick={async () => {
              const resp = await authFetch(`${API_URL}/clients/${r.id}`, { method: "DELETE" });
              if (resp.ok) { message.success("Удалено"); load(); } else { message.error("Ошибка удаления"); }
            }}>Удалить</Button>
          </div>
        ) },
      ]} />
      <Modal open={bulkOpen} title="Интервалы для выбранных" onCancel={() => setBulkOpen(false)} onOk={bulkIntervals} confirmLoading={bulkLoading} okText="Установить">
        <Form form={bulkForm} layout="vertical">
          <Form.Item name="heartbeatMs" label="Heartbeat ms">
            <Input placeholder="например 5000" />
          </Form.Item>
          <Form.Item name="activityMs" label="Activity ms">
            <Input placeholder="например 3000" />
          </Form.Item>
          <Form.Item name="screenshotMs" label="Screenshot ms">
            <Input placeholder="например 60000" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={open} title="Новый клиент" onCancel={() => setOpen(false)} onOk={onCreate} confirmLoading={loading} okText="Создать">
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="ClientId" rules={[{ required: true }]}> 
            <Input placeholder="Например CLIENT01" />
          </Form.Item>
          <Form.Item name="encryptionKey" label="EncryptionKey" rules={[{ required: true, min: 16 }]}> 
            <Input placeholder="Минимум 16 символов" />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
}
