import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BASE_PATH || "./",
  // The encoder is first imported by a worker. Prebundle it before serving
  // the page so its first use cannot trigger a dependency reload mid-export.
  optimizeDeps: { include: ["gifenc"] },
});
