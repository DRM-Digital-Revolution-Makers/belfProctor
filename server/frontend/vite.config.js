import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("recharts") || id.includes("apexcharts")) return "vendor-charts";
          if (id.includes("@ant-design/icons")) return "vendor-icons";
          if (id.includes("/rc-") || id.includes("\\rc-") || id.includes("@rc-component")) return "vendor-rc";
          if (id.includes("antd") || id.includes("@ant-design")) return "vendor-antd";
          if (id.includes("@refinedev")) return "vendor-refine";
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          return "vendor-misc";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
    setupFiles: "./src/test/setup.jsx",
    restoreMocks: true,
  },
})
