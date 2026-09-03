import React from "react";
import dayjs from "dayjs";
import { DatePicker, Select, Button, TimePicker, message, Space } from "antd";
import { Icon } from "@iconify/react";
import { authFetch } from "../dataProvider";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `http://${window.location.hostname}:8080/api`;

function extractFilename(contentDisposition) {
  const raw = String(contentDisposition || "");
  const match = raw.match(/filename="([^"]+)"/i);
  return match ? match[1] : "";
}

/**
 * Скачивает PDF со скриншотами выбранного клиента за выбранный месяц.
 * Использует тот же endpoint `/api/clients/:id/screenshots/pdf` что и страница клиента.
 */
export default function MonthlyScreenshotsPdf({ clients }) {
  const [clientId, setClientId] = React.useState(null);
  const [month, setMonth] = React.useState(dayjs());
  const [timeRange, setTimeRange] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const download = async () => {
    if (!clientId) {
      message.warning("Выберите клиента");
      return;
    }
    if (!month) {
      message.warning("Выберите месяц");
      return;
    }
    const from = month.startOf("month").format("YYYY-MM-DD");
    const to = month.endOf("month").format("YYYY-MM-DD");
    const params = new URLSearchParams({ from, to });
    if (timeRange && timeRange[0] && timeRange[1]) {
      params.set("startTime", timeRange[0].format("HH:mm"));
      params.set("endTime", timeRange[1].format("HH:mm"));
    }

    const key = "monthly-pdf";
    setBusy(true);
    message.loading({ content: "Генерируем PDF…", key, duration: 0 });
    try {
      const res = await authFetch(
        `${API_URL}/clients/${encodeURIComponent(clientId)}/screenshots/pdf?${params.toString()}`,
      );
      if (!res.ok) {
        if (res.status === 404) {
          message.error({ content: "Нет скриншотов за этот период", key });
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename =
        extractFilename(res.headers.get("Content-Disposition")) ||
        `screenshots_${clientId}_${month.format("YYYY-MM")}.pdf`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success({ content: "Готово", key });
    } catch (e) {
      console.error(e);
      message.error({ content: "Ошибка скачивания", key });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 20,
        padding: 20,
        marginBottom: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
          fontSize: 16,
        }}
      >
        <Icon
          icon="solar:document-bold-duotone"
          width={20}
          height={20}
          color="#2563eb"
        />
        Скачать скриншоты за месяц
      </div>

      <Space wrap size={12} style={{ width: "100%" }}>
        <Select
          showSearch
          placeholder="Клиент"
          style={{ minWidth: 220 }}
          value={clientId}
          onChange={setClientId}
          optionFilterProp="label"
          options={(clients || []).map((c) => ({
            value: c.id,
            label: c.id + (c.hostname ? ` · ${c.hostname}` : ""),
          }))}
        />
        <DatePicker.MonthPicker
          value={month}
          onChange={(v) => setMonth(v || dayjs())}
          format="MMMM YYYY"
          placeholder="Месяц"
          allowClear={false}
        />
        <TimePicker.RangePicker
          value={timeRange}
          onChange={setTimeRange}
          format="HH:mm"
          placeholder={["С", "По"]}
          minuteStep={15}
          allowClear
        />
        <Button
          type="primary"
          icon={
            <Icon
              icon="solar:download-bold"
              width={16}
              height={16}
              style={{ verticalAlign: "-2px" }}
            />
          }
          loading={busy}
          onClick={download}
          disabled={!clientId || !month}
        >
          Скачать PDF
        </Button>
      </Space>
      <div style={{ fontSize: 12, color: "#6b7280" }}>
        Опциональный фильтр по времени дня применяется к каждому дню месяца. Без
        фильтра берутся все скриншоты за указанный месяц.
      </div>
    </div>
  );
}
