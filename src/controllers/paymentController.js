import prisma from "../lib/prisma.js";
import crypto from "crypto";

const NEWEBPAY_HASH_KEY = process.env.NEWEBPAY_HASH_KEY || "fIhp8AUb0OwHg3Q7uhKd4CX2rUa5MHB2";
const NEWEBPAY_HASH_IV = process.env.NEWEBPAY_HASH_IV || "PyY9AgEt38LUf5JC";
const NEWEBPAY_MERCHANT_ID = process.env.NEWEBPAY_MERCHANT_ID || "MS3824337262";
const NEWEBPAY_URL =
  process.env.NEWEBPAY_URL ||
  "https://ccore.newebpay.com/MPG/mpg_gateway"; // Use test environment by default

const DEFAULT_RETURN_PATH = "/admin/settings?tab=billing";
const TOP_UP_PLANS = {
  starter: { amount: 499, creditsAdded: 500 },
  pro: { amount: 999, creditsAdded: 1200 },
  business: { amount: 2999, creditsAdded: 4000 },
};

function getOrigin(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function resolveEndpointUrl(rawUrl, origin, fallbackPath) {
  if (rawUrl) {
    const resolvedUrl = new URL(rawUrl, origin);
    if (!resolvedUrl.pathname || resolvedUrl.pathname === "/") {
      const fallbackUrl = new URL(fallbackPath, origin);
      resolvedUrl.pathname = fallbackUrl.pathname;
      resolvedUrl.search = fallbackUrl.search;
    }
    return resolvedUrl.toString();
  }

  return new URL(fallbackPath, origin).toString();
}

function sanitizeReturnPath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return DEFAULT_RETURN_PATH;
  }

  try {
    const url = new URL(rawPath, "http://localhost");
    const normalizedPath = `${url.pathname}${url.search}${url.hash}`;

    if (!normalizedPath.startsWith("/") || normalizedPath.startsWith("//")) {
      return DEFAULT_RETURN_PATH;
    }

    return normalizedPath;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}

function buildFrontendRedirectUrl(returnPath) {
  const frontendOrigin =
    getOrigin(process.env.NEWEBPAY_CLIENT_BACK_URL) ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000";

  return new URL(sanitizeReturnPath(returnPath), frontendOrigin).toString();
}

const BACKEND_PUBLIC_ORIGIN =
  process.env.NEWEBPAY_PUBLIC_BASE_URL ||
  process.env.BACKEND_PUBLIC_URL ||
  getOrigin(process.env.NEWEBPAY_SERVER_BACK_URL) ||
  getOrigin(process.env.NEWEBPAY_WEBHOOK_URL) ||
  "http://localhost:3001";

const WEBHOOK_URL = resolveEndpointUrl(
  process.env.NEWEBPAY_WEBHOOK_URL || process.env.ECPAY_RETURN_URL,
  BACKEND_PUBLIC_ORIGIN,
  "/api/payments/webhook",
);
const SERVER_BACK_URL = resolveEndpointUrl(
  process.env.NEWEBPAY_SERVER_BACK_URL,
  BACKEND_PUBLIC_ORIGIN,
  "/api/payments/return",
);

function create_mpg_aes_encrypt(TradeInfo) {
  const encrypt = crypto.createCipheriv("aes-256-cbc", NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV);
  const enc = encrypt.update(typeof TradeInfo === "string" ? TradeInfo : new URLSearchParams(TradeInfo).toString(), "utf8", "hex");
  return enc + encrypt.final("hex");
}

function create_mpg_sha_encrypt(aesEncrypted) {
  const sha = crypto.createHash("sha256");
  const plainText = `HashKey=${NEWEBPAY_HASH_KEY}&${aesEncrypted}&HashIV=${NEWEBPAY_HASH_IV}`;
  return sha.update(plainText).digest("hex").toUpperCase();
}

function create_mpg_aes_decrypt(TradeInfo) {
  const decrypt = crypto.createDecipheriv("aes-256-cbc", NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV);
  decrypt.setAutoPadding(false);
  const text = decrypt.update(TradeInfo, "hex", "utf8");
  const plainText = text + decrypt.final("utf8");
  const result = plainText.replace(/[\x00-\x1F]+/g, "");
  return JSON.parse(result);
}

/**
 * Creates a NewebPay Top-up Order and returns the configuration for frontend form submission
 * POST /api/payments/topup
 */
export async function createTopupOrder(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    const { planKey, amount, creditsAdded, returnPath } = req.body;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "No active workspace found",
      });
    }

    const requestedPlan = Object.hasOwn(TOP_UP_PLANS, planKey)
      ? TOP_UP_PLANS[planKey]
      : Object.values(TOP_UP_PLANS).find(
          (plan) =>
            plan.amount === parseInt(amount) &&
            plan.creditsAdded === parseInt(creditsAdded),
        );

    if (!requestedPlan) {
      return res.status(400).json({
        success: false,
        message: "Invalid top-up plan",
      });
    }

    // 1. Create Order in Database
    const orderNo = `PEAR${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const order = await prisma.order.create({
      data: {
        orderNo,
        workspaceId,
        amount: requestedPlan.amount,
        creditsAdded: requestedPlan.creditsAdded,
        status: "PENDING",
      },
    });

    // 2. Prepare NewebPay Parameters
    const safeReturnPath = sanitizeReturnPath(returnPath);
    const returnUrl = new URL(SERVER_BACK_URL);
    returnUrl.searchParams.set("redirect", safeReturnPath);

    const TradeInfoParams = {
      MerchantID: NEWEBPAY_MERCHANT_ID,
      RespondType: "JSON",
      TimeStamp: Math.floor(Date.now() / 1000).toString(),
      Version: "2.0",
      MerchantOrderNo: orderNo,
      Amt: requestedPlan.amount,
      ItemDesc: `Pear AI Credits x ${requestedPlan.creditsAdded}`,
      ReturnURL: returnUrl.toString(), // Backend redirect proxy
      NotifyURL: WEBHOOK_URL, // Server webhook
      ClientBackURL: buildFrontendRedirectUrl(safeReturnPath), // Back to shop button
      Email: "",
      LoginType: 0,
    };

    // 3. Encrypt TradeInfo
    const tradeInfoStr = new URLSearchParams(TradeInfoParams).toString();
    const tradeInfoEnc = create_mpg_aes_encrypt(tradeInfoStr);

    // 4. Encrypt TradeSha
    const tradeShaEnc = create_mpg_sha_encrypt(tradeInfoEnc);

    const params = {
      MerchantID: NEWEBPAY_MERCHANT_ID,
      TradeInfo: tradeInfoEnc,
      TradeSha: tradeShaEnc,
      Version: "2.0",
    };

    // 5. Return Data (Frontend will generate form and submit)
    return res.json({
      success: true,
      data: {
        url: NEWEBPAY_URL,
        params,
      },
    });
  } catch (error) {
    console.error("Top-up order creation error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
}

/**
 * Handle NewebPay Payment Webhook
 * POST /api/payments/webhook
 */
export async function handleWebhook(req, res) {
  try {
    const data = req.body;
    console.log("[NewebPay Webhook] Received:", data);

    if (!data || !data.TradeInfo) {
      return res.status(400).send("No TradeInfo found");
    }

    // 1. Decrypt TradeInfo
    let decryptedInfo;
    try {
        decryptedInfo = create_mpg_aes_decrypt(data.TradeInfo);
    } catch (error) {
        console.error("[NewebPay Webhook] Decrypt error:", error);
        return res.status(400).send("Decrypt Error");
    }

    console.log("[NewebPay Webhook] Decrypted Info:", decryptedInfo);

    // 2. Process the Payment Status
    const result = decryptedInfo.Result || {};
    const orderNo = result.MerchantOrderNo;

    if (!orderNo) {
        return res.status(400).send("No OrderNo in Result");
    }

    // Find the Order
    const order = await prisma.order.findUnique({
      where: { orderNo },
    });

    if (!order) {
      console.error(`[NewebPay Webhook] Order ${orderNo} not found`);
      return res.status(404).send("OrderNotFound");
    }

    if (decryptedInfo.Status === "SUCCESS") {
      // Payment Success

      // Check if already processed
      if (order.status === "PAID") {
        return res.send("OK");
      }

      // 3. Update Order and Add Credits inside a Transaction
      await prisma.$transaction([
        prisma.order.update({
          where: { orderNo },
          data: {
            status: "PAID",
            tradeNo: result.TradeNo,
            paymentDate: new Date(),
            paymentMethod: result.PaymentType || "CREDIT",
          },
        }),
        prisma.workspace.update({
          where: { id: order.workspaceId },
          data: {
            creditBalance: {
              increment: order.creditsAdded,
            },
          },
        }),
      ]);

      console.log(
        `[NewebPay Webhook] Order ${orderNo} paid. Added ${order.creditsAdded} credits to Workspace ${order.workspaceId}`,
      );
    } else {
      // Payment Failed or other status
      console.log(
        `[NewebPay Webhook] Payment failed for ${orderNo}. Status: ${decryptedInfo.Status}, Message: ${decryptedInfo.Message}`,
      );
      if (order.status !== "PAID") {
          await prisma.order.update({
            where: { orderNo },
            data: {
              status: "FAILED",
            },
          });
      }
    }

    // Reply to acknowledge receipt
    return res.send("OK");
  } catch (error) {
    console.error("[NewebPay Webhook] Error processing webhook:", error);
    return res.status(500).send("InternalServerError");
  }
}

/**
 * Handle NewebPay ReturnURL
 * POST /api/payments/return
 * 
 * We use a backend redirect proxy here because NewebPay makes a POST request to ReturnURL.
 * If NewebPay directly POSTs to the Next.js frontend, NextAuth's session cookie may be dropped 
 * due to cross-site request rules (SameSite), which causes the user to be unauthenticated and 
 * redirected to the login page. By POSTing to the backend first, we can do a 302 GET redirect 
 * to the frontend, which is treated as a same-site navigation by the browser and preserves the cookie.
 */
export async function handleReturn(req, res) {
  const redirectUrl = buildFrontendRedirectUrl(req.query.redirect);
  res.redirect(302, redirectUrl);
}
