import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use a relative base path so the build works when it's hosted from a
  // sub-directory (for example Netlify deploy previews or sites mounted
  // behind a path segment). Without this the generated HTML references
  // `/assets/...` which 404s when the app isn't served from the domain
  // root, resulting in a blank screen because the JS bundle never loads.
  base: "./",
  plugins: [react()],
});
