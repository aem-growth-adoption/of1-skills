// Switches to "prod" at the release rollout.
export const TARGET = "dev";

const PROD = TARGET === "prod";

export const PORTAL_URL = PROD ? "https://portal.of1.live" : "https://dev-portal.of1.live";
export const PORTAL_MCP_URL = `${PORTAL_URL}/mcp`;
export const PROXY_SUFFIX = PROD ? "" : "--dev";
