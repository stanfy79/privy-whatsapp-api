// src/routes/whatsapp.ts - Twilio WhatsApp format
import express, { Request, Response } from "express";
import axios from "axios";
import { 
  createWalletForUser, 
  getWalletBalance, 
  sendETH,
  sendUSDC,
  sendUsdcFaucet,
  sendEthFaucet,
  parseSendCommand, 
  validateAmount,
  validateUSDCAmount,
  getTransactionHistory,
  getWalletInfo,
} from "../services/walletService";
import { User } from "../services/userService";
import { findUserByWalletAddress } from "../services/userService";

const router = express.Router();

// Environment variables
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID!;

// Utility to send WhatsApp messages
async function sendWhatsAppMessage(to: string, text: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("⚠️ Failed to send WhatsApp message:", error);
  }
}


// Utility to send Meta WhatsApp Template Messages (with variables)
async function sendMetaTemplateMessage(
  to: string,
  templateName: string,
  variables: {
    amount: string;
    token: string;
    sender: string;
    txHash: string;
    usdcBalance: string;
    ethBalance: string;
  }
) {
  try {
    const bodyParams = [
      { type: "text", text: variables.amount },
      { type: "text", text: variables.token },
      { type: "text", text: variables.sender },
      { type: "text", text: variables.txHash },
      { type: "text", text: variables.usdcBalance },
      { type: "text", text: variables.ethBalance },
    ];
    
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: bodyParams,
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err: any) {
    console.error("⚠️ Template send error:", err?.response?.data || err);
  }
}


// POST webhook for WhatsApp Cloud API
router.post("/whatsapp-webhook", async (req: Request, res: Response) => {
  try {
    // Verify incoming message
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (!messages || !messages[0]) {
      return res.sendStatus(200);
    }

    const message = messages[0];
    const phoneNumber = message.from;
    const text = (message.text?.body || "").trim().toLowerCase();

    console.log(`📱 Message from ${phoneNumber}: "${text}"`);

    // --- Command: CREATE WALLET ---
    if (text === "create wallet") {
      try {
        const result = await createWalletForUser(phoneNumber);

        if (result.alreadyExists) {
          await sendWhatsAppMessage(
            phoneNumber,
            `ℹ️ *You Already Have a Wallet!*\n\n *Your Address:*\n${result.walletAddress}\n\n*Available commands:*\n• balance\n• send 0.5 eth to 0x...\n• send 100 usdc to 0x...\n• receive test token\n• wallet address\n• history\n\n🔒 One wallet per phone number`
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            `✅ *Wallet Created Successfully!*\n\n *Address:*\n${result.walletAddress}`
          );
        }
      } catch (error) {
        console.error("Wallet creation error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to create wallet. Try again later.");
      }
    }

    // --- Command: BALANCE ---
    else if (text.includes("check balance") || text.includes("balance")) {
      try {
        const balance = await getWalletBalance(phoneNumber);
        await sendWhatsAppMessage(
          phoneNumber,
          `*🏦 Your Wallet Balance is:*\n\n${balance.eth} ETH\n ${balance.usdc} USDC\n\n *Network:* Arbitrum Sepolia`
        );
      } catch (error) {
        console.error("Balance error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to check balance. Create a wallet first with 'create wallet'.");
      }
    }

    // --- Command: HISTORY ---
    else if (text === "history") {
      try {
        const history = await getTransactionHistory(phoneNumber);
        const walletInfo = await getWalletInfo(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, `📈 *Transaction History*\n\n${history}\n\n Check full history on Arbiscan 👇 \nhttps://sepolia.arbiscan.io/address/${walletInfo?.walletAddress}`);
      } catch (error) {
        console.error("History error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to fetch history.");
      }
    }

    // --- Command: RECEIVE TEST TOKEN ---
    else if (text.includes("request test usdc") || text.includes("test usdc") || text.includes("Receive test USDC" )) {
      try {
        const faucetResult = await sendUsdcFaucet(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, ` *Test USDC Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet!`);
      } catch (error) {
        console.error("Faucet error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to send test tokens. Make sure you have a wallet first.");
      }
    }

    else if (text.includes("request test eth") || text.includes("test eth") || text.includes("Receive test eth" )) {
      try {
        const faucetResult = await sendEthFaucet(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, ` *Test ETH Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet!`);
      } catch (error) {
        console.error("Faucet error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to send test tokens. Make sure you have a wallet first.");
      }
    }

    else if (text === "wallet" || text === "wallet address") {
    const walletAddress = await getWalletInfo(phoneNumber);
    if (walletAddress) {
      await sendWhatsAppMessage(phoneNumber, `${walletAddress.walletAddress}`);
    } else {
      await sendWhatsAppMessage(phoneNumber, `ℹ️ No wallet found for your number. Try "create wallet" first!`);
    }
  }

    // --- Command: SEND TOKENS ---
    else if (text.startsWith("send ")) {
      try {
        const sendData = parseSendCommand(text);

        if (!sendData) {
          await sendWhatsAppMessage(
            phoneNumber,
            `⚠️*Invalid send format* \n\n *Examples:*\n\n• send 0.1 eth to 0xabc123... ✅\n\n• send 50 usdc to 0xabc123... ✅`
          );
          return res.sendStatus(200);
        }

        const { amount, address, token } = sendData;
        const isValidAmount = token === "ETH" ? validateAmount(amount) : validateUSDCAmount(amount);

        if (!isValidAmount) {
          const maxAmount = token === "ETH" ? "10 ETH" : "1000 USDC";
          await sendWhatsAppMessage(
            phoneNumber,
            ` *Invalid amount: ${amount} ${token}*\n\n✅ *Valid range:* 0.001 - ${maxAmount}`
          );
          return res.sendStatus(200);
        }

        const walletInfo = await getWalletInfo(phoneNumber);
        if (!walletInfo || !walletInfo.walletId) {
          await sendWhatsAppMessage(phoneNumber, "⚠️ Wallet not found. \n\nCreate one with 'create wallet'.");
          return res.sendStatus(200);
        }

        console.log(`Sending ${amount} ${token} from ${walletInfo.walletAddress} to ${address}`);

        const result =
          token === "ETH"
            ? await sendETH(walletInfo.walletId, address, walletInfo.walletAddress, amount)
            : await sendUSDC(walletInfo.walletId, address, walletInfo.walletAddress, amount);


      const recipient: User | null = await findUserByWalletAddress(sendData.address);
      // Only send template notification if recipient exists and has a phone number
      if (recipient && recipient.phone) {
        const balance = await getWalletBalance(recipient.phone);
        await sendMetaTemplateMessage(recipient.phone, "credit_alert", {
          amount,
          token,
          sender: walletInfo?.walletAddress,
          txHash: `https://sepolia.arbiscan.io/tx/${result.txHash}`,
          ethBalance: balance.eth.toString(),
          usdcBalance: balance.usdc.toString(),
        });
        console.log("Recipient found:", recipient, recipient?.phone);
      }
      console.log("Recipient found:", recipient, recipient?.phone);

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ *Transaction Sent!*\n\n*Amount:* ${amount} ${token}\n\n*To:* ${address.substring(0, 10)}...${address.substring(36)}\n\n*TX Hash:* https://sepolia.arbiscan.io/tx/${result.txHash} \n\n\n*Network:* Arbitrum Sepolia`
        );
      } catch (error: any) {
        console.error("Send error:", error.message);

        if (error.message?.includes("Insufficient balance")) {
          await sendWhatsAppMessage(phoneNumber, "⚠️ *Insufficient Balance*\n\nUse 'receive test token' to get USDC.");
        } else if (error.message?.includes("Invalid recipient")) {
          await sendWhatsAppMessage(phoneNumber, "⚠️ *Invalid Address*\n\nFormat: 0x followed by 40 characters.");
        } else {
          await sendWhatsAppMessage(phoneNumber, `⚠️ *Transaction Failed*\n\nInsufficient balance!\n\nFirst top-up USDC or ETH balance. You can send "Receive test ETH" or "Receive test USDC" to receive some test tokens and try again afterwards.`);
        }
      }
    }

    // --- Command: HELP / MENU ---
    else if (["help", "menu"].includes(text)) {
      await sendWhatsAppMessage(
        phoneNumber,
        `*BlockBot Commands*\n\nCreate wallet\nReceive test ETH\nReceive test USDC\nBalance\nSend [amount] eth to [address]\nSend [amount] usdc to [address]\nWallet address\nHistory\nHelp\n\n\nNetwork: Arbitrum Sepolia`
      );
    }

    // --- UNKNOWN COMMAND ---
    else {
      await sendWhatsAppMessage(
        phoneNumber,
        `⚠️ *Unknown Command* \n\nI didn’t understand: "${text}"\n\nType 'help' for a list of commands.`
      );
    }

    res.sendStatus(200);
  } catch (err: any) {
    console.error("⚠️ Webhook error:", err.message || err);
    res.sendStatus(500);
  }
});

// GET route for webhook verification (required by WhatsApp Cloud API)
router.get("/whatsapp-webhook", (req: Request, res: Response) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("✅ Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

export default router;