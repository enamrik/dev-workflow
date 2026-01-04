import { NextRequest, NextResponse } from "next/server";

// WebSocket upgrade is handled by custom server
// This route exists as a placeholder for documentation
export async function GET(request: NextRequest) {
  const upgradeHeader = request.headers.get("upgrade");

  if (upgradeHeader === "websocket") {
    // WebSocket connections should be handled by the custom server
    // Return 426 to indicate upgrade required
    return new NextResponse("WebSocket connections require custom server", {
      status: 426,
      headers: {
        Upgrade: "websocket",
      },
    });
  }

  return NextResponse.json({
    message: "WebSocket endpoint - connect with ws:// protocol",
    protocol: "ws",
  });
}
