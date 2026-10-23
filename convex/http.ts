import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcpOther, mcpPost } from "./mcp";
import { callback as dropboxCallback, webhookNotify, webhookVerify } from "./dropbox";
import { feed as registerFeed } from "./register";
import { stop as emailStop } from "./emails";

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

// Dropbox: the Connect Dropbox return address, and the webhook (GET = one-time check, POST = "something changed").
http.route({ path: "/dropbox/callback", method: "GET", handler: dropboxCallback });
http.route({ path: "/dropbox/webhook", method: "GET", handler: webhookVerify });
http.route({ path: "/dropbox/webhook", method: "POST", handler: webhookNotify });

// The register's read-only feed for the Google Sheet copy (Phase R2).
http.route({ path: "/register-feed", method: "GET", handler: registerFeed });

// Emails (C4): the "stop these emails" link.
http.route({ path: "/email/stop", method: "GET", handler: emailStop });

export default http;
