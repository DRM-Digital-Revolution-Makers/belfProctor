import React from "react";
import { Select, Empty, Dropdown, Button, message } from "antd";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authFetch } from "../dataProvider.js";
import { formatTashkent } from "../utils/time";

/* ============ Design tokens ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  red: "#DC2626",
  warning: "#F59E0B",
  divider: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

/* ============ Helpers ============ */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = Number(bytes);
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${Math.round(n)}${units[u]}`;
}

function formatTs(value) {
  if (!value) return { time: "—", date: "—", full: "—" };
  const time = formatTashkent(value, "HH:mm");
  const date = formatTashkent(value, "DD.MM.YYYY");
  if (time === "—" || date === "—") return { time: "—", date: "—", full: "—" };
  return { time, date, full: `${time},${date}` };
}

/* ============ Page ============ */
export default function ScreenshotsList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const API_URL =
    import.meta.env.VITE_API_URL ||
    `http://${window.location.hostname}:8080/api`;

  const clientFromUrl = searchParams.get("clientId");
  const dateFromUrl = searchParams.get("date");

  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [clients, setClients] = React.useState([]);
  const [filters, setFilters] = React.useState({
    clientId: clientFromUrl || null,
    category: null,
    isFavorite: false,
    sort: "desc",
    date: dateFromUrl || null,
  });
  const [selected, setSelected] = React.useState(null);
  const [thumbUrls, setThumbUrls] = React.useState({});
  const [previewUrl, setPreviewUrl] = React.useState(null);

  const pageSize = 50;
  const hasMore = items.length < total;

  // Refs to avoid stale closures in IntersectionObserver
  const loadingRef = React.useRef(false);
  const pageRef = React.useRef(1);
  const hasMoreRef = React.useRef(false);
  const sentinelRef = React.useRef(null);
  const fetchRef = React.useRef(null);

  React.useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  /* Load clients */
  React.useEffect(() => {
    authFetch(`${API_URL}/clients`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]));
  }, [API_URL]);

  /* Fetch a page and optionally append to existing list */
  const fetchPage = React.useCallback(
    async (page, append) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          ts: String(Date.now()),
        });
        if (filters.clientId) params.append("clientId", filters.clientId);
        if (filters.category) params.append("category", filters.category);
        if (filters.isFavorite) params.append("isFavorite", "true");
        if (filters.date) params.append("date", filters.date);

        const r = await authFetch(`${API_URL}/screenshots?${params}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = await r.json();
        let data = json.data || [];
        if (filters.sort === "asc") {
          data = [...data].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
        } else {
          data = [...data].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
        }
        setTotal(json.total || 0);
        if (append) {
          setItems((prev) => {
            const existing = new Set(prev.map((i) => i.id));
            return [...prev, ...data.filter((d) => !existing.has(d.id))];
          });
        } else {
          setItems(data);
          if (data.length) setSelected(data[0]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [API_URL, filters],
  );

  // Keep fetchRef current so the observer callback always uses latest version
  React.useEffect(() => { fetchRef.current = fetchPage; }, [fetchPage]);

  /* Reset and reload when filters change */
  React.useEffect(() => {
    pageRef.current = 1;
    setItems([]);
    setTotal(0);
    setSelected(null);
    fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, API_URL]);

  /* Infinite scroll — sentinel triggers next page load */
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current) {
          pageRef.current += 1;
          fetchRef.current(pageRef.current, true);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // created once — uses refs internally

  /* Lazy-load thumbnail urls */
  React.useEffect(() => {
    let cancelled = false;
    items.forEach((it) => {
      if (thumbUrls[it.id]) return;
      const url = `${API_URL}/screenshots/${it.id}/file?ts=${Date.now()}`;
      authFetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (cancelled || !blob) return;
          const objUrl = URL.createObjectURL(blob);
          setThumbUrls((prev) => ({ ...prev, [it.id]: objUrl }));
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, API_URL]);

  /* Load full preview for selected */
  React.useEffect(() => {
    if (!selected) {
      setPreviewUrl(null);
      return;
    }
    if (thumbUrls[selected.id]) {
      setPreviewUrl(thumbUrls[selected.id]);
    } else {
      const url = `${API_URL}/screenshots/${selected.id}/file?ts=${Date.now()}`;
      authFetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) return;
          const objUrl = URL.createObjectURL(blob);
          setPreviewUrl(objUrl);
        })
        .catch(() => {});
    }
  }, [selected, thumbUrls, API_URL]);

  const toggleFavorite = async (id, currentStatus) => {
    const newStatus = !currentStatus;
    try {
      const res = await authFetch(`${API_URL}/screenshots/${id}/favorite`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: newStatus }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, isFavorite: newStatus } : item,
          ),
        );
        if (selected?.id === id)
          setSelected({ ...selected, isFavorite: newStatus });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openFile = async (id) => {
    const url = `${API_URL}/screenshots/${id}/file?ts=${Date.now()}`;
    const res = await authFetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  };

  const downloadFile = async (id, filename) => {
    const url = `${API_URL}/screenshots/${id}/file?ts=${Date.now()}`;
    const res = await authFetch(url, { cache: "no-store" });
    if (!res.ok) {
      message.error(t("common.requestError"));
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename || `screenshot_${id}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  };

  const categoryOptions = React.useMemo(() => {
    const set = new Set();
    clients.forEach((c) => {
      const v = String(c?.category || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [clients]);

  const employeeName = filters.clientId || "Все сотрудники";
  const selectedMeta = selected
    ? {
        ...formatTs(selected.timestamp, i18n.language),
        size: formatBytes(selected.size),
        clientId: selected.clientId,
        filename: selected.filename,
      }
    : null;

  return (
    <div>
      {/* Outer wrapper */}
      <div
        style={{
          background: BP.surface,
          borderRadius: 50,
          boxShadow: BP.shadow,
          padding: 20,
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Inner white card */}
        <div
          style={{
            background: BP.white,
            border: `3px solid ${BP.white}`,
            borderRadius: 30,
            boxShadow: BP.shadow,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 20,
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => navigate(-1)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  icon="solar:arrow-left-linear"
                  width={28}
                  height={28}
                  color={BP.text}
                />
              </button>
              <h2
                style={{
                  margin: 0,
                  fontFamily: BP.font,
                  fontSize: 24,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                {t("screenshots.title")}
              </h2>
              <span
                style={{
                  fontFamily: BP.font,
                  fontSize: 24,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                :
              </span>
              <span
                style={{
                  fontFamily: BP.font,
                  fontSize: 24,
                  fontWeight: 510,
                  color: BP.text,
                }}
              >
                {employeeName}
              </span>
            </div>

            {/* Right side: menu */}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "fav",
                    label: filters.isFavorite
                      ? "Показать все"
                      : "Только избранные",
                    onClick: () =>
                      setFilters((f) => ({ ...f, isFavorite: !f.isFavorite })),
                  },
                  {
                    key: "client-select",
                    label: clientFromUrl ? "Сменить сотрудника" : "Выбрать сотрудника",
                    children: clients.map((c) => ({
                      key: `client-${c.id}`,
                      label: c.id,
                      onClick: () => {
                        setFilters((f) => ({ ...f, clientId: c.id }));
                        setSearchParams({ clientId: c.id });
                      },
                    })),
                  },
                  ...(categoryOptions.length
                    ? [
                        {
                          key: "category-select",
                          label: filters.category
                            ? `Категория: ${filters.category}`
                            : "Категория",
                          children: [
                            {
                              key: "cat-all",
                              label: "Все",
                              onClick: () =>
                                setFilters((f) => ({ ...f, category: null })),
                            },
                            ...categoryOptions.map((c) => ({
                              key: `cat-${c}`,
                              label: c,
                              onClick: () =>
                                setFilters((f) => ({ ...f, category: c })),
                            })),
                          ],
                        },
                      ]
                    : []),
                ],
              }}
            >
              <button
                type="button"
                style={{
                  background: BP.white,
                  border: `1px solid ${BP.light}`,
                  borderRadius: 20,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  icon="solar:menu-dots-bold"
                  width={20}
                  height={20}
                  color={BP.text}
                />
              </button>
            </Dropdown>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: BP.divider,
              opacity: 0.5,
              margin: "0 20px",
            }}
          />

          {/* Main 2-column layout */}
          <div
            style={{
              display: "flex",
              gap: 20,
              padding: 20,
              minHeight: 540,
            }}
          >
            {/* LEFT: Preview + Metadata */}
            <div
              style={{
                width: "42%",
                minWidth: 360,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {selected ? (
                <>
                  {/* Preview image with star + actions */}
                  <div
                    style={{
                      position: "relative",
                      background: BP.surface,
                      borderRadius: 10,
                      overflow: "hidden",
                      flex: 1,
                      minHeight: 280,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={selected.filename}
                        style={{
                          maxWidth: "100%",
                          maxHeight: 400,
                          objectFit: "contain",
                          borderRadius: 10,
                          cursor: "zoom-in",
                        }}
                        onClick={() => openFile(selected.id)}
                      />
                    ) : (
                      <div style={{ color: BP.light }}>...</div>
                    )}
                    {/* Star top-right */}
                    <button
                      type="button"
                      onClick={() =>
                        toggleFavorite(selected.id, selected.isFavorite)
                      }
                      style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        background: "rgba(255,255,255,0.9)",
                        border: "none",
                        borderRadius: 30,
                        width: 36,
                        height: 36,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon
                        icon={
                          selected.isFavorite
                            ? "solar:star-bold"
                            : "solar:star-linear"
                        }
                        width={20}
                        height={20}
                        color={selected.isFavorite ? BP.warning : BP.muted}
                      />
                    </button>
                  </div>

                  {/* Metadata box */}
                  <div
                    style={{
                      display: "flex",
                      gap: 20,
                      padding: "12px 4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        minWidth: 140,
                      }}
                    >
                      <MetaField label="Название:" value={selectedMeta.full} />
                      <MetaField label="Время:" value={selectedMeta.time} />
                      <MetaField label="Дата:" value={selectedMeta.date} />
                      <MetaField label="Вес:" value={selectedMeta.size} />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        flex: 1,
                      }}
                    >
                      <MetaField
                        label="Сотрудник:"
                        value={selectedMeta.clientId}
                      />
                      <MetaField
                        label="Файл:"
                        value={selectedMeta.filename}
                      />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button
                      onClick={() => openFile(selected.id)}
                      icon={
                        <Icon
                          icon="solar:eye-bold-duotone"
                          width={18}
                          height={18}
                        />
                      }
                      style={{ borderRadius: 30, height: 38 }}
                    >
                      {t("common.open")}
                    </Button>
                    <Button
                      onClick={() =>
                        downloadFile(selected.id, selected.filename)
                      }
                      icon={
                        <Icon
                          icon="solar:file-download-linear"
                          width={18}
                          height={18}
                        />
                      }
                      style={{ borderRadius: 30, height: 38 }}
                    >
                      {t("common.download")}
                    </Button>
                  </div>
                </>
              ) : (
                <Empty description={t("common.noData")} />
              )}
            </div>

            {/* RIGHT: Thumbnails grid */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                borderRadius: 10,
                overflow: "hidden",
                border: `1px solid ${BP.surface}`,
              }}
            >
              {/* Sort header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "16px 12px",
                  background: BP.white,
                  borderRadius: "10px 10px 0 0",
                }}
              >
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "desc",
                        label: "Сначала новые",
                        onClick: () =>
                          setFilters((f) => ({ ...f, sort: "desc" })),
                      },
                      {
                        key: "asc",
                        label: "Сначала старые",
                        onClick: () =>
                          setFilters((f) => ({ ...f, sort: "asc" })),
                      },
                    ],
                  }}
                >
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      color: BP.muted,
                      fontFamily: BP.font,
                      fontSize: 14,
                      padding: 0,
                    }}
                  >
                    <Icon
                      icon="solar:sort-linear"
                      width={18}
                      height={18}
                      color={BP.muted}
                    />
                    Сортировка
                  </button>
                </Dropdown>
                <div style={{ flex: 1 }} />
                <span style={{ color: BP.light, fontSize: 13 }}>
                  {items.length} / {total}
                </span>
              </div>

              {/* Divider */}
              <div
                style={{
                  height: 1,
                  background: BP.divider,
                  opacity: 0.5,
                }}
              />

              {/* Thumbnails grid with infinite scroll */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  overflowX: "hidden",
                  maxHeight: "calc(100vh - 280px)",
                  padding: "10px 12px",
                  background: BP.white,
                }}
              >
                {items.length === 0 && !loading ? (
                  <div style={{ padding: 32, textAlign: "center" }}>
                    <Empty description={t("common.noData")} />
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {items.map((it) => {
                      const isActive = selected?.id === it.id;
                      const ts = formatTs(it.timestamp, i18n.language);
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setSelected(it)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            padding: 4,
                            background: "transparent",
                            border: isActive
                              ? `2px solid ${BP.green}`
                              : "2px solid transparent",
                            borderRadius: 12,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div
                            style={{
                              position: "relative",
                              width: "100%",
                              aspectRatio: "16/9",
                              borderRadius: 10,
                              overflow: "hidden",
                              background: BP.surface,
                            }}
                          >
                            {thumbUrls[it.id] ? (
                              <img
                                src={thumbUrls[it.id]}
                                alt={it.filename}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: BP.light,
                                }}
                              >
                                ...
                              </div>
                            )}
                            {it.isFavorite && (
                              <Icon
                                icon="solar:star-bold"
                                width={16}
                                height={16}
                                color={BP.warning}
                                style={{
                                  position: "absolute",
                                  top: 6,
                                  right: 6,
                                }}
                              />
                            )}
                          </div>
                          <div
                            style={{
                              fontFamily: BP.font,
                              fontSize: 12,
                              color: BP.text,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {ts.full}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sentinel — IntersectionObserver watches this to trigger next page */}
                <div ref={sentinelRef} style={{ height: 1 }} />

                {/* Loading indicator shown while fetching next page */}
                {loading && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "16px 0 8px",
                      color: BP.light,
                      fontFamily: BP.font,
                      fontSize: 13,
                    }}
                  >
                    Загрузка...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        style={{
          fontFamily: BP.font,
          fontSize: 14,
          color: BP.text,
          letterSpacing: "-0.02em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: BP.font,
          fontSize: 16,
          color: BP.text,
          letterSpacing: "-0.02em",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
