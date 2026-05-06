const RESEND_ENDPOINT = "https://api.resend.com/emails";

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function sendEmail({ to, subject, text }) {
  if (!to) return;

  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.PROPOSAL_NOTIFICATION_FROM ||
    process.env.EMAIL_FROM ||
    "PearQuote <no-reply@pearquote.com>";

  if (!apiKey) {
    console.log(`[MOCK EMAIL] To: ${to}`);
    console.log(`[MOCK EMAIL] Subject: ${subject}`);
    console.log(`[MOCK EMAIL] ${text}`);
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send proposal notification: ${body}`);
  }
}

export async function sendProposalViewedNotification({
  to,
  proposalName,
  viewedAt,
}) {
  try {
    await sendEmail({
      to,
      subject: `Proposal viewed: ${proposalName}`,
      text: [
        `Your Proposal "${proposalName}" was opened by a client.`,
        `Opened at: ${formatDateTime(viewedAt)}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Proposal viewed notification failed:", error);
  }
}

export async function sendProposalAcceptedNotification({
  to,
  proposalName,
  clientName,
  clientEmail,
  message,
}) {
  try {
    await sendEmail({
      to,
      subject: `Proposal accepted: ${proposalName}`,
      text: [
        `Your Proposal "${proposalName}" was accepted.`,
        `Client: ${clientName}`,
        `Email: ${clientEmail}`,
        `Message: ${message || "-"}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Proposal accepted notification failed:", error);
  }
}
