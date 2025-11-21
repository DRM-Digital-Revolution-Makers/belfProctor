import React from "react"
import { List } from "@refinedev/antd"
import { Table, Tag } from "antd"

export default function ActivitiesList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`
  const [items, setItems] = React.useState([])

  const fetchLatest = React.useCallback(() => {
    const token = localStorage.getItem("token")
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    fetch(`${API_URL}/activity/latest`, { headers })
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []) })
      .catch(() => { setItems([]) })
  }, [API_URL])

  React.useEffect(() => {
    fetchLatest()
    const id = setInterval(fetchLatest, 3000)
    return () => clearInterval(id)
  }, [fetchLatest])

  const renderDuration = (record) => {
    const now = Date.now()
    const ts = new Date(record.timestamp).getTime()
    const activeMs = record.isActive ? record.activeMilliseconds + (now - ts) : record.activeMilliseconds
    const inactiveMs = record.isActive ? record.inactiveMilliseconds : record.inactiveMilliseconds + (now - ts)
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      const mm = m % 60
      const ss = s % 60
      if (h > 0) return `${h} ч ${mm} м ${ss} с`
      if (m > 0) return `${m} м ${ss} с`
      return `${ss} с`
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>Активен: {fmt(activeMs)}</div>
        <div>Неактивен: {fmt(inactiveMs)}</div>
      </div>
    )
  }

  return (
    <List title="Активность (реальное время)">
      <Table
        rowKey={(r) => `${r.clientId}-${r.id}`}
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={false}
        columns={[
          { title: "ClientId", dataIndex: "clientId" },
          { title: "Время", dataIndex: "timestamp" },
          { title: "Активность", dataIndex: "isActive", render: (v) => v ? <Tag color="green">Активен</Tag> : <Tag color="red">Неактивен</Tag> },
          { title: "Таймеры", render: (_, r) => renderDuration(r) },
        ]}
      />
    </List>
  )
}