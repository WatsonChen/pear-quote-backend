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

export async function sendProposalCommentNotification({
  to,
  proposalName,
  clientName,
  clientEmail,
  message,
}) {
  try {
    await sendEmail({
      to,
      subject: `New question on proposal: ${proposalName}`,
      text: [
        `${clientName} asked a question on "${proposalName}".`,
        clientEmail ? `Email: ${clientEmail}` : null,
        "",
        message,
        "",
        "Reply from the quote in PearQuote.",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    });
  } catch (error) {
    console.error("Proposal comment notification failed:", error);
  }
}

export async function sendProposalAcceptedNotification({
  to,
  proposalName,
  clientName,
  clientEmail,
  message,
  optionName,
}) {
  try {
    await sendEmail({
      to,
      subject: `Proposal accepted: ${proposalName}`,
      text: [
        `Your Proposal "${proposalName}" was accepted.`,
        `Client: ${clientName}`,
        `Email: ${clientEmail}`,
        optionName ? `Package: ${optionName}` : null,
        `Message: ${message || "-"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    console.error("Proposal accepted notification failed:", error);
  }
}

/** Tell the client their question was answered, with a way back to the proposal. */
export async function sendProposalReplyNotification({ to, proposalName, message, shareUrl, locale }) {
  try {
    const en = locale === "en";
    await sendEmail({
      to,
      subject: en ? `Reply on your proposal: ${proposalName}` : `提案回覆：${proposalName}`,
      text: [
        en ? `You have a reply on "${proposalName}":` : `你在「${proposalName}」的提問有回覆了：`,
        "",
        message,
        "",
        shareUrl ? (en ? `Open the proposal: ${shareUrl}` : `查看提案：${shareUrl}`) : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    });
  } catch (error) {
    console.error("Proposal reply notification failed:", error);
  }
}
