import React from "react"
import { List } from "@refinedev/antd"
import { Table, Tag } from "antd"

export default function ActivitiesList() {
  const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8080/api`
  const [items, setItems] = React.useState([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const pageSize = 50

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    const token = localStorage.getItem("token")
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    fetch(`${API_URL}/activity?${params.toString()}`, { headers })
      .then((r) => r.json())
      .then((json) => { setItems(json.data || []); setTotal(json.total || 0); })
      .catch(() => { setItems([]); setTotal(0); })
  }
  React.useEffect(load, [page])

  return (
    <List title="Активность">
      <Table
        rowKey={(r) => `${r.clientId}-${r.id}`}
        dataSource={Array.isArray(items) ? items : []}
        size="large"
        pagination={{ current: page, pageSize, total, onChange: (p) => setPage(p) }}
        columns={[
          { title: "ClientId", dataIndex: "clientId" },
          { title: "Время", dataIndex: "timestamp" },
          { title: "Активность", dataIndex: "isActive", render: (v) => v ? <Tag color="green">Активен</Tag> : <Tag color="red">Неактивен</Tag> },
          { title: "Активность, мс", dataIndex: "activeMilliseconds" },
        ]}
      />
    </List>
  )
}