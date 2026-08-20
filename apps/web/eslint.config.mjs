import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  {
    rules: {
      // New rule in eslint-plugin-react-hooks@7 (shipped with eslint-config-next@16).
      // Pre-existing code calls a load/refresh helper synchronously in useEffect
      // across ~50 files; refactoring is out of scope for the Next.js 16 upgrade.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
