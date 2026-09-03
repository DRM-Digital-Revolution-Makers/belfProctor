import React, { useState } from "react";
import { Form, message } from "antd";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

/* ============ Design tokens (matching pixel-perfect system) ============ */
const BP = {
  white: "#FFFFFF",
  surface: "#F7F7F7",
  text: "#000000",
  muted: "#707070",
  light: "#A4A4A4",
  green: "#267E26",
  red: "#DC2626",
  stroke: "rgba(164,164,164,0.5)",
  shadow: "0 0 4px 0 rgba(241,243,248,1)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Helvetica Neue", Arial, sans-serif',
};

function InputBox({
  icon,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  rightAction,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: BP.surface,
        borderRadius: 10,
        padding: "12px 20px",
        gap: 10,
      }}
    >
      <Icon icon={icon} width={20} height={20} color={BP.muted} />
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          flex: 1,
          border: "none",
          background: "transparent",
          outline: "none",
          fontFamily: BP.font,
          fontSize: 16,
          fontWeight: 274,
          color: BP.text,
        }}
      />
      {rightAction}
    </div>
  );
}

export default function LoginPage({ onSuccess }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (!email.trim() || !password.trim()) {
      setError(t("common.email") + " / " + t("common.password"));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const API_URL =
        import.meta.env.VITE_API_URL ||
        "/api";
      const res = await fetch(`${API_URL}/auth/login`, {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        await res.json();
        onSuccess?.();
      } else {
        let detail = "";
        try {
          const j = await res.json();
          detail = String(j?.message || "");
        } catch {
          /* ignore */
        }
        setError(detail || t("common.accessDenied"));
        message.error(detail || t("common.accessDenied"));
      }
    } catch (err) {
      setError(String(err?.message || t("common.requestError")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: BP.white,
        padding: 20,
      }}
    >
      {/* Outer wrapper — same as other pages */}
      <div
        style={{
          background: BP.surface,
          borderRadius: 50,
          boxShadow: BP.shadow,
          padding: 20,
          width: "100%",
          maxWidth: 480,
        }}
      >
        {/* Inner white card */}
        <div
          style={{
            background: BP.white,
            borderRadius: 30,
            boxShadow: BP.shadow,
            padding: 32,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* Logo / Title */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: BP.font,
                fontSize: 28,
                fontWeight: 510,
                color: BP.text,
                letterSpacing: "-0.3px",
              }}
            >
              BelfProctor
            </div>
            <div
              style={{
                fontFamily: BP.font,
                fontSize: 16,
                color: BP.muted,
              }}
            >
              {t("common.loginTitle")}
            </div>
          </div>

          {/* Form */}
          <Form
            layout="vertical"
            onFinish={onSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{
                  fontFamily: BP.font,
                  fontSize: 14,
                  color: BP.text,
                  letterSpacing: "-0.02em",
                }}
                htmlFor="bp-login-email"
              >
                {t("common.email")}
              </label>
              <InputBox
                icon="solar:letter-bold-duotone"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                autoComplete="email"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{
                  fontFamily: BP.font,
                  fontSize: 14,
                  color: BP.text,
                  letterSpacing: "-0.02em",
                }}
                htmlFor="bp-login-password"
              >
                {t("common.password")}
              </label>
              <InputBox
                icon="solar:lock-keyhole-bold-duotone"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                rightAction={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                    }}
                    aria-label={showPassword ? "Скрыть" : "Показать"}
                  >
                    <Icon
                      icon={
                        showPassword
                          ? "solar:eye-closed-bold-duotone"
                          : "solar:eye-bold-duotone"
                      }
                      width={20}
                      height={20}
                      color={BP.muted}
                    />
                  </button>
                }
              />
            </div>

            {error && (
              <div
                style={{
                  fontFamily: BP.font,
                  fontSize: 14,
                  color: BP.red,
                  padding: "8px 12px",
                  background: "rgba(220,38,38,0.08)",
                  borderRadius: 10,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? BP.light : BP.green,
                color: BP.white,
                border: "none",
                borderRadius: 12,
                padding: "12px 24px",
                cursor: loading ? "wait" : "pointer",
                fontFamily: BP.font,
                fontSize: 18,
                fontWeight: 400,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginTop: 4,
              }}
            >
              {loading ? (
                <Icon
                  icon="solar:refresh-linear"
                  width={18}
                  height={18}
                  style={{ animation: "bp-spin 1s linear infinite" }}
                />
              ) : (
                <Icon
                  icon="solar:login-3-bold-duotone"
                  width={18}
                  height={18}
                />
              )}
              {t("common.login")}
            </button>
          </Form>
        </div>
      </div>

    </div>
  );
}
