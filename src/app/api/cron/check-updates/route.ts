import { NextRequest, NextResponse } from "next/server";
import { checkForUpdates } from "@/lib/subscriptions";

export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron (or allow in dev)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await checkForUpdates();
    return NextResponse.json({
      status: "ok",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Cron check-updates error:", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
