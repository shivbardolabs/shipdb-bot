import crypto from "crypto";

/**
 * Verify that an incoming request is actually from Slack.
 * Uses the signing secret to validate the X-Slack-Signature header.
 */
export function verifySlackRequest(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const hash = crypto.createHmac("sha256", signingSecret).update(basestring).digest("hex");
  const expected = `v0=${hash}`;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Post a message to Slack using the response_url (for deferred responses)
 */
export async function postToResponseUrl(
  responseUrl: string,
  blocks: SlackBlock[],
  text: string,
  replaceOriginal = false
) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      replace_original: replaceOriginal,
      text,
      blocks,
    }),
  });
}

/**
 * Post a message to a Slack channel using the Bot Token
 */
export async function postMessage(channel: string, blocks: SlackBlock[], text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not configured");

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, blocks, text }),
  });
}

export type SlackBlock = {
  type: string;
  text?: { type: string; text: string };
  fields?: { type: string; text: string }[];
  elements?: unknown[];
  [key: string]: unknown;
};
