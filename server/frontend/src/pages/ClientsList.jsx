import React from "react";
import { List } from "@refinedev/antd";
import { Table, Modal, Form, Input, Button, message, Alert } from "antd";

export default function ClientsList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`;
  const [data, setData] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [lastCreated, setLastCreated] = React.useState(null);
  const [form] = Form.useForm();

  const load = React.useCallback(() => {
    const token = localStorage.getItem("token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/clients`, { headers })
      .then(async (r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((json) => {
        setData(Array.isArray(json) ? json : []);
      })
      .catch(() => setData([]));
  }, [API_URL]);

  React.useEffect(() => { load(); }, [load]);

  const onCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const token = localStorage.getItem("token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch(`${API_URL}/clients/register`, {
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
  return (
    <List title="Клиенты">
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <Button type="primary" onClick={() => setOpen(true)}>Добавить клиента</Button>
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
      <Table rowKey="id" dataSource={Array.isArray(data) ? data : []} pagination={false} size="small" columns={[
        { title: "ClientId", dataIndex: "id" },
        { title: "Создан", dataIndex: "createdAt" },
        { title: "Обновлён", dataIndex: "updatedAt" },
      ]} />
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