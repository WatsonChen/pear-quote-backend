import prisma from "../lib/prisma.js";
import crypto from "crypto";

const ECPAY_HASH_KEY = process.env.ECPAY_HASH_KEY || "5294y06JbISpM5x9"; // Default test key
const ECPAY_HASH_IV = process.env.ECPAY_HASH_IV || "v77hoKGq4kWxNNIS"; // Default test IV
const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || "2000132"; // Default test MerchantID
const ECPAY_URL =
  process.env.ECPAY_URL ||
  "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

// Return URL (Webhook) endpoint
const RETURN_URL =
  process.env.ECPAY_RETURN_URL ||
  "https://your-ngrok-url.ngrok-free.app/api/payments/webhook";
const CLIENT_BACK_URL =
  process.env.ECPAY_CLIENT_BACK_URL || "http://localhost:3000/admin/settings"; // Redirect after payment

function generateCheckMacValue(params) {
  // 1. Sort parameters alphabetically by key
  const sortedKeys = Object.keys(params).sort();
  let str = `HashKey=${ECPAY_HASH_KEY}&`;

  for (const key of sortedKeys) {
    if (key !== "CheckMacValue" && params[key] !== "") {
      str += `${key}=${params[key]}&`;
    }
  }

  str += `HashIV=${ECPAY_HASH_IV}`;

  // 2. URL Encode and replace specific characters based on ECPay spec
  str = encodeURIComponent(str)
    .replace(/%20/g, "+")
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .toLowerCase();

  // 3. SHA256 hashing
  const hash = crypto
    .createHash("sha256")
    .update(str)
    .digest("hex")
    .toUpperCase();
  return hash;
}

/**
 * Creates an ECPay Top-up Order and returns the HTML form to redirect
 * POST /api/payments/topup
 */
export async function createTopupOrder(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    const { amount, creditsAdded } = req.body;

    if (!amount || !creditsAdded) {
      return res.status(400).json({
        success: false,
        message: "Amount and creditsAdded are required",
      });
    }

    // 1. Create Order in Database
    const orderNo = `PEAR${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const order = await prisma.order.create({
      data: {
        orderNo,
        workspaceId,
        amount: parseInt(amount),
        creditsAdded: parseInt(creditsAdded),
        status: "PENDING",
      },
    });

    // 2. Prepare ECPay Parameters
    // ECPay date format: yyyy/MM/dd HH:mm:ss
    const now = new Date();
    const formattedDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const params = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: orderNo,
      MerchantTradeDate: formattedDate,
      PaymentType: "aio", // ALL in one
      TotalAmount: amount.toString(), // Must be string/number without decimals
      TradeDesc: `Pear AI Credits Top-up: ${creditsAdded} Points`,
      ItemName: `Pear AI Credits x ${creditsAdded}`,
      ReturnURL: RETURN_URL,
      ClientBackURL: CLIENT_BACK_URL,
      ChoosePayment: "Credit", // Force Credit Card
      EncryptType: "1",
    };

    // 3. Generate CheckMacValue
    params.CheckMacValue = generateCheckMacValue(params);

    // 4. Return Data (Frontend will generate form and submit)
    return res.json({
      success: true,
      data: {
        url: ECPAY_URL,
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
 * Handle ECPay Payment Webhook
 * POST /api/payments/webhook
 */
export async function handleWebhook(req, res) {
  try {
    const data = req.body;
    console.log("[ECPay Webhook] Received:", data);

    // 1. Verify CheckMacValue to ensure authenticity
    const receivedMac = data.CheckMacValue;
    const calculatedMac = generateCheckMacValue(data);

    if (receivedMac !== calculatedMac) {
      console.error(
        "[ECPay Webhook] CheckMacValue mismatch. Expected:",
        calculatedMac,
        "Got:",
        receivedMac,
      );
      return res.status(400).send("0|Error"); // ECPay spec: reply 0|Error on failure
    }

    // 2. Process the Payment Status
    if (data.RtnCode === "1") {
      // Payment Success
      const orderNo = data.MerchantTradeNo;

      // Find the Order
      const order = await prisma.order.findUnique({
        where: { orderNo },
      });

      if (!order) {
        console.error(`[ECPay Webhook] Order ${orderNo} not found`);
        return res.status(404).send("0|OrderNotFound");
      }

      // Check if already processed
      if (order.status === "PAID") {
        return res.send("1|OK");
      }

      // 3. Update Order and Add Credits inside a Transaction
      await prisma.$transaction([
        prisma.order.update({
          where: { orderNo },
          data: {
            status: "PAID",
            tradeNo: data.TradeNo,
            paymentDate: new Date(data.PaymentDate),
            paymentMethod: data.PaymentType,
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
        `[ECPay Webhook] Order ${orderNo} paid. Added ${order.creditsAdded} credits to Workspace ${order.workspaceId}`,
      );
    } else {
      // Payment Failed or other status
      console.log(
        `[ECPay Webhook] Payment failed for ${data.MerchantTradeNo}. RtnCode: ${data.RtnCode}`,
      );
      await prisma.order.update({
        where: { orderNo: data.MerchantTradeNo },
        data: {
          status: "FAILED",
        },
      });
    }

    // Reply 1|OK to acknowledge receipt to ECPay
    return res.send("1|OK");
  } catch (error) {
    console.error("[ECPay Webhook] Error processing webhook:", error);
    return res.status(500).send("0|InternalServerError");
  }
}
