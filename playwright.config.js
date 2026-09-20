import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory web",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
