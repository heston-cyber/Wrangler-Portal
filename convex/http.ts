import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcpOther, mcpPost } from "./mcp";

const http = httpRouter();
auth.addHttpRoutes(http);

// The Claude connector (MCP over Streamable HTTP).
http.route({ path: "/mcp", method: "POST", handler: mcpPost });
http.route({ path: "/mcp", method: "GET", handler: mcpOther });
http.route({ path: "/mcp", method: "DELETE", handler: mcpOther });
// Same thing with the key in the address, for Claude accounts without the "Request headers" setting.
http.route({ pathPrefix: "/mcp/", method: "POST", handler: mcpPost });
http.route({ pathPrefix: "/mcp/", method: "GET", handler: mcpOther });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: mcpOther });

export default http;
