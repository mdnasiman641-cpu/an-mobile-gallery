import { after, NextResponse } from "next/server";
import { applyStockItems, itemsFromBody, verifyWebhook } from "@/lib/integrations/stock-sync";
import { processAiJob } from "@/lib/ai/jobs";

/**
 * Stock system → website (one-way). Signed with STOCK_WEBHOOK_SECRET.
 * Creates DRAFT products / updates stock, then starts AI analysis for the
 * first new draft in the background. Never publishes, never sets prices.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const check = await verifyWebhook(
    process.env.STOCK_WEBHOOK_SECRET,
    request.headers.get("x-stock-timestamp"),
    request.headers.get("x-stock-signature"),
    raw,
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const { items, rejected } = itemsFromBody(body);
  if (items.length === 0) return NextResponse.json({ error: "No product with id and name in the payload", rejected }, { status: 422 });

  try {
    const summary = await applyStockItems(items, "webhook");
    // AI analysis for one new draft right after the response (the rest wait in the queue).
    const firstJob = summary.jobIds[0];
    if (firstJob) {
      after(async () => {
        try {
          await processAiJob(firstJob);
        } catch {
          // stays queued; Admin → AI Products → Process queue picks it up
        }
      });
    }
    return NextResponse.json({
      ok: true,
      imported: summary.imported,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed + rejected,
      ai_queued: summary.jobIds.length,
    });
  } catch {
    return NextResponse.json({ error: "Sync failed on the website side. Try again later." }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
