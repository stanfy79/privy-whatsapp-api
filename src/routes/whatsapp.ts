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
  sendAvaxFaucet,
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

// Temporary storage for pending send commands (phone number -> send command data)
// In production, use Redis or a database
const pendingSendCommands: Record<string, { sendCommand: string; timestamp: number }> = {};

const arbitrumExplorerUrl = "https://sepolia.arbiscan.io/tx/";
const avalancheExplorerUrl = "https://subnets-test.avax.network/c-chain/address/";

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
    console.error("⚠️ Failed to send WhatsApp message:");
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
    ethBalance: string;
    usdcBalance: string;
    avalancheAVAXBalance: string;
    avalancheUsdcBalance: string;
  }
) {
  try {
    const bodyParams = [
      { type: "text", text: variables.amount },
      { type: "text", text: variables.token },
      { type: "text", text: variables.sender },
      { type: "text", text: variables.txHash },
      { type: "text", text: variables.ethBalance },
      { type: "text", text: variables.usdcBalance },
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

export function sendCommand(data: string) {
  const text = data;
  return text;
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

    console.log(`📱 Message from user: "${text}"`);

    // --- Command: CREATE WALLET ---
    if (text === "create wallet") {
      try {
        const result = await createWalletForUser(phoneNumber);

        if (result.alreadyExists) {
          await sendWhatsAppMessage(
            phoneNumber,
            `ℹ️ *You Already Have a Wallet!*\n\n *Your Address:*\n${result.walletAddress}\n\n*Available commands:\n\nCreate wallet\nReceive test ETH\nReceive test AVAX\nReceive test USDC\nBalance\nSend [amount] eth to [address]\nSend [amount] avax to [address]\nSend [amount] usdc to [address]\nWallet address\nHistory\nHelp\n\n\nNetwork: Arbitrum Sepolia & Avalanche Fuji Testnet\n\n🔒 One wallet per phone number`
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
          `*🏦 Your Wallet Balance:*\n\n*Network:* Arbitrum Sepolia \n${balance.arbitrumEth} ETH\n ${balance.arbitrumUsdc} USDC\n\n*Network:* Avalanche Fuji \n${balance.avalancheAVAX} AVAX\n ${balance.avalancheUsdc} USDC`
        );
        console.log(`*🏦 Your Wallet Balance:*\n\n*Network:* Arbitrum Sepolia \n*${balance.arbitrumEth} ETH\n${balance.arbitrumUsdc} USDC*\n\n*Network:* Avalanche Fuji \n*${balance.avalancheAVAX} AVAX\n${balance.avalancheUsdc} USDC*`)
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
        await sendWhatsAppMessage(phoneNumber, `📈 *Transaction History*\n\n${history}\n\n Check full history on Arbiscan 👇 \nhttps://sepolia.arbiscan.io/address/${walletInfo?.walletAddress}\n\n Check full history on Avalanche 👇 \nhttps://subnets-test.avax.network/c-chain/address/${walletInfo?.walletAddress}`);
        
    // console.log(history);
      } catch (error) {
        console.error("History error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to fetch history.");
      }
    }

    // --- Command: RECEIVE TEST TOKEN ---
    else if (text.includes("request test usdc") || text.includes("test usdc") || text.includes("Receive test usdc" )) {
      try {
        const faucetResult = await sendUsdcFaucet(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, ` *Test USDC Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet % Avalanche Fuji testnet!`);
        console.log(` *Test USDC Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet & Avalanche Fuji testnet!`)
      } catch (error) {
        console.error("Faucet error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to send test tokens. Make sure you have a wallet first.");
      }
    }

    else if (text.includes("request test eth") || text.includes("test eth") || text.includes("receive test eth" )) {
      try {
        const faucetResult = await sendEthFaucet(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, ` *Test ETH Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet & Avalanche Fuji testnet!`);
        console.log(` *Test ETH Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet & Avalanche Fuji testnet!`)
      } catch (error) {
        console.error("Faucet error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to send test tokens. Make sure you have a wallet first.");
      }
    }

    else if (text.includes("test avax") || text.includes("request test avax" ) || text.includes("receive test avax" )) {
      try {
        const faucetResult = await sendAvaxFaucet(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, ` *Test AVAX Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet & Avalanche Fuji testnet!`);
        console.log(` *Test AVAX Faucet*\n\n${faucetResult}\n\n\n*Note:* BlockBot is currently in beta. Do *NOT* send real funds yet, as we are currently on Arbitrum Sepolia testnet & Avalanche Fuji testnet!`)
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

    // --- Command: SEND TOKENS (Step 1: Check if send command) ---
    else if (text.startsWith("send ") && text.includes(" to ")) {
      try {
        // Store the send command for pending chain selection
        pendingSendCommands[phoneNumber] = {
          sendCommand: text,
          timestamp: Date.now(),
        };

        // Ask user to select chain
        await sendWhatsAppMessage(
          phoneNumber,
          ` *Select Chain*\n\nTo select chain just type in the chain No. *[Example (1) or (2)]* \n\n*1. Avalanche Fuji Testnet*\n*2. Arbitrum Sepolia*\n\n\nPlease be sure the wallet you are sending to supports the selected chain.`
        );
        console.log(` *Select Chain*\n\nTo select chain just type in the chain No. *[Example (1) or (2)]* \n\n*1. Avalanche Fuji Testnet*\n*2. Arbitrum Sepolia*\n\n\nPlease be sure the wallet you are sending to supports the selected chain.`)
        console.log(`🔄 Pending send command stored for user: "${text}"`);
        return res.sendStatus(200);
      } catch (error) {
        console.error("Send command error:", error);
        await sendWhatsAppMessage(phoneNumber, "⚠️ Failed to process send command.");
        return res.sendStatus(200);
      }
    }

    // --- Command: CHAIN SELECTION (Step 2: User selects chain 1 or 2) ---
    else if ((text === "1" || text === "2") && pendingSendCommands[phoneNumber]) {
      try {
        const chainNumber = parseInt(text);
        const { sendCommand } = pendingSendCommands[phoneNumber];

        // Clean up the pending command
        delete pendingSendCommands[phoneNumber];

        console.log(`Chain selected: ${chainNumber} (${chainNumber === 1 ? "Avalanche Fuji Testnet" : "Arbitrum Sepolia"})`);
        await sendWhatsAppMessage(phoneNumber, `You selected: *${chainNumber === 1 ? "Avalanche Fuji Testnet" : "Arbitrum Sepolia"}* \n\n⌛ Processing your transaction...`);

        const sendData = parseSendCommand(sendCommand, chainNumber);

        if (!sendData) {
          await sendWhatsAppMessage(
            phoneNumber,
            `⚠️ *Invalid send format* \n\n *Examples:*\n\n• send 0.1 eth to 0xabc123... ✅\n\n• send 50 usdc to 0xabc123... ✅`
          );
          return res.sendStatus(200);
        }

        const { amount, address, chain, token } = sendData;
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


        const result =
          token === "ETH" || token === "AVAX"
            ? await sendETH(walletInfo.walletId, address, walletInfo.walletAddress, amount, chain)
            : await sendUSDC(walletInfo.walletId, address, walletInfo.walletAddress, amount, chain);
        
            const chainExplorerUrl = chain === "Avalanche Fuji Testnet" ? avalancheExplorerUrl : arbitrumExplorerUrl;

        const recipient: User | null = await findUserByWalletAddress(sendData.address);
        // Only send template notification if recipient exists and has a phone number
        if (recipient && recipient.phone) {
          const balance = await getWalletBalance(recipient.phone);
          await sendMetaTemplateMessage(recipient.phone, "deposit_alert", {
            amount,
            token,
            sender: walletInfo?.walletAddress,
            txHash: `${chainExplorerUrl}${result.txHash}`,
            ethBalance: balance.avalancheAVAX.toString(),
            usdcBalance: balance.arbitrumUsdc.toString(),
            avalancheAVAXBalance: balance.avalancheAVAX.toString(),
            avalancheUsdcBalance: balance.avalancheUsdc.toString(),
          });
        }

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ *Transaction Sent!*\n\n*Amount:* ${amount} ${token}\n\n*To:* ${address.substring(0, 10)}...${address.substring(36)}\n\n*TX Hash:* ${chainExplorerUrl}${result.txHash} \n\n\n*Network:* ${chain}`
        );
      } catch (error: any) {
        console.error("Send error:", error.message);

        if (error.message?.includes("Insufficient balance")) {
          await sendWhatsAppMessage(phoneNumber, "⚠️ *Insufficient Balance*\n\nUse 'receive test token' to get USDC.");
        } else if (error.message?.includes("Invalid recipient")) {
          await sendWhatsAppMessage(phoneNumber, "⚠️ *Invalid Address*\n\nFormat: 0x followed by 40 characters.");
        } else {
          await sendWhatsAppMessage(phoneNumber, `⚠️ *Transaction Failed*\n\nInsufficient balance!\n\nFirst top-up USDC or ETH balance. You can send "Receive test ETH", "Receive test AVAX", "Receive test USDC" to receive some test tokens and try again afterwards.`);
        }
      }
    }

    // --- Command: HELP / MENU ---
    else if (["help", "menu"].includes(text)) {
      await sendWhatsAppMessage(
        phoneNumber,
        `*BlockBot Commands*\n\nCreate wallet\nReceive test ETH\nReceive test AVAX\nReceive test USDC\nSend [amount] eth to [address]\nSend [amount] avax to [address]\nSend [amount] usdc to [address]\nBalance\nWallet address\nHistory\nHelp\n\n\nNetwork: Arbitrum Sepolia & Avalanche Fuji Testnet`
      );
      console.log(`*BlockBot Commands*\n\nCreate wallet\nReceive test ETH\nReceive test AVAX\nReceive test USDC\nSend [amount] eth to [address]\nSend [amount] avax to [address]\nSend [amount] usdc to [address]\nBalance\nWallet address\nHistory\nHelp\n\n\nNetwork: Arbitrum Sepolia`)
    }
    // --- UNKNOWN COMMAND or Chain selection without pending send ---
    else if ((text === "1" || text === "2") && !pendingSendCommands[phoneNumber]) {
      await sendWhatsAppMessage(
        phoneNumber,
        `ℹ️ *No pending transaction*\n\nFirst send a command like:\n• send 0.1 AVAX to 0x...\n• send 50 usdc to 0x...\n\nThen you can select the chain.`
      );
      console.log(`ℹ️ *No pending transaction*\n\nFirst send a command like:\n• send 0.1 eth to 0x...\n• send 50 usdc to 0x...\n\nThen you can select the chain.`);
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