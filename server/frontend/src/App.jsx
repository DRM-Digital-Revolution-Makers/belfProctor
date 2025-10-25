import React from "react";
import { Refine } from "@refinedev/core";
//
import { RefineThemes } from "@refinedev/antd";
import { ConfigProvider } from "antd";
import { useNavigate, Routes, Route } from "react-router-dom";

import ClientsList from "./pages/ClientsList.jsx";
import EventsList from "./pages/EventsList.jsx";
import HeartbeatsList from "./pages/HeartbeatsList.jsx";
import ScreenshotsList from "./pages/ScreenshotsList.jsx";
import ReportsList from "./pages/ReportsList.jsx";
import PoliciesList from "./pages/PoliciesList.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { customDataProvider } from "./dataProvider.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const authProvider = {
  login: async ({ email, password }) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      return Promise.reject();
    }
    const data = await res.json();
    localStorage.setItem("token", data.token);
    return Promise.resolve();
  },
  logout: async () => {
    localStorage.removeItem("token");
    return Promise.resolve();
  },
  check: async () => {
    return localStorage.getItem("token") ? Promise.resolve() : Promise.reject();
  },
  getIdentity: async () => {
    return Promise.resolve({ id: 1, name: "Admin" });
  },
};

export default function App() {
  const navigate = useNavigate();
  return (
    <ConfigProvider theme={RefineThemes.Blue}>
      <Routes>
        <Route
          path="/login"
          element={<LoginPage onSuccess={() => navigate("/")} />}
        />
      </Routes>
      <Refine
        dataProvider={customDataProvider(API_URL)}
        authProvider={authProvider}
        resources={[
          { name: "clients", list: ClientsList },
          { name: "events", list: EventsList },
          { name: "heartbeats", list: HeartbeatsList },
          { name: "screenshots", list: ScreenshotsList },
          { name: "reports", list: ReportsList },
          { name: "policies", list: PoliciesList },
        ]}
      />
    </ConfigProvider>
  );
}
