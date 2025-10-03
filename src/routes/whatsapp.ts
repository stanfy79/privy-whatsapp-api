// src/routes/whatsapp.ts - Twilio WhatsApp format
import express, { Request, Response } from "express";
import twilio from "twilio";
import { 
  createWalletForUser, 
  getWalletBalance, 
  sendETH,
  sendUSDC,
  sendTestTokens,
  parseSendCommand, 
  validateAmount,
  validateUSDCAmount,
  getTransactionHistory,
  getWalletInfo
} from "../services/walletService";

const router = express.Router();
const MessagingResponse = twilio.twiml.MessagingResponse;

router.post("/send-welcome", async (req: Request, res: Response) => {
  const { phone, userName } = req.body; // optional variable if your template has placeholders

  if (!phone) {
    return res.status(400).json({ success: false, error: "Phone number is required" });
  }

  try {
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

    // Replace with your actual template content SID (from Twilio Console)
    const templateSid = process.env.TWILIO_TEMPLATE_SID; 

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: "whatsapp:" + phone,
      contentSid: templateSid,
      contentVariables: JSON.stringify({
        "1": userName || "Newbie", // matches {{1}} in your template
      })
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("❌ Twilio template send error:", error);
    return res.status(500).json({ success: false, error: "Failed to send template message" });
  }
});

router.post("/whatsapp-webhook", async (req: Request, res: Response) => {
  const twiml = new MessagingResponse();

  try {
    const phoneNumber = req.body.From.replace("whatsapp:", "");
    const message = (req.body.Body || "").trim().toLowerCase();

    console.log(`📱 Message from ${phoneNumber}: "${message}"`);

    if (message === "create wallet") {
      try {
        const result = await createWalletForUser(phoneNumber);
        
        if (result.alreadyExists) {
          twiml.message(`ℹ️ *You Already Have a Wallet!*\n\n💼 *Your Address:*\n${result.walletAddress}\n\n💡 *Available commands:*\n• balance - Check your balance\n• send 0.5 eth to 0x...\n• send 100 usdc to 0x...\n• receive test token\n• history\n\n🔒 *Security:* One wallet per phone number`);
        } else {
          twiml.message(`✅ *Wallet Created Successfully!*\n\n💼 *Address:*\n${result.walletAddress}\n\n🎉 Your crypto wallet is ready!\n\n💡 *Available commands:*\n• balance\n• send 0.5 eth to 0x...\n• send 100 usdc to 0x...\n• receive test token\n• history`);
        }
      } catch (error) {
        console.error("Wallet creation error:", error);
        twiml.message("❌ Failed to create wallet. Please try again later.");
      }
    } 
    
    else if (message === "balance" || message === "Check Balance") {
      try {
        const balance = await getWalletBalance(phoneNumber);
        twiml.message(`💰 *Your Wallet Balance*\n\n💎 ${balance.eth} ETH\n🪙 ${balance.usdc} USDC\n\n📍 *Network:* Arbitrum Sepolia\n⛽ *Gas:* Sponsored`);
      } catch (error) {
        console.error("Balance error:", error);
        twiml.message("❌ Failed to check balance. Create a wallet first by sending 'create wallet'.");
      }
    }
    
    else if (message === "history" || message === "Transaction History") {
      try {
        const history = await getTransactionHistory(phoneNumber);
        twiml.message(`📈 *Transaction History*\n\n${history}\n\n💡 Full history available on Arbiscan`);
      } catch (error) {
        console.error("History error:", error);
        twiml.message("❌ Failed to get transaction history.");
      }
    }
    
    else if (message === "receive test token" || message === "faucet" || message === "Request Test Tokens") {
      try {
        const faucetResult = await sendTestTokens(phoneNumber);
        twiml.message(`🚰 *Test Token Faucet*\n\n${faucetResult}\n\n💡 Check your balance with 'balance' command`);
      } catch (error) {
        console.error("Faucet error:", error);
        twiml.message("❌ Failed to send test tokens. Make sure you have a wallet created first.");
      }
    }
    
    else if (message.startsWith("send ")) {
      try {
        const sendData = parseSendCommand(message);
        
        if (!sendData) {
          twiml.message(`❌ *Invalid send format*\n\n✅ *Correct formats:*\n• "send 0.5 eth to 0x1234..."\n• "send 100 usdc to 0x1234..."\n\n📝 *Examples:*\n• send 0.1 eth to 0xabcd1234...\n• send 50 usdc to 0xabcd1234...`);
        } else {
          const { amount, address, token } = sendData;
          
          // Validate amount based on token type
          const isValidAmount = token === 'ETH' ? validateAmount(amount) : validateUSDCAmount(amount);
          
          if (!isValidAmount) {
            const maxAmount = token === 'ETH' ? '10 ETH' : '1000 USDC';
            twiml.message(`❌ *Invalid amount: ${amount} ${token}*\n\n✅ *Valid range:* 0.001 - ${maxAmount}\n\n💡 *Example:* send ${token === 'ETH' ? '0.5 eth' : '100 usdc'} to 0x...`);
          } else {
            // Get wallet info first
            const walletInfo = await getWalletInfo(phoneNumber);
            if (!walletInfo || !walletInfo.walletId) {
              twiml.message("❌ Wallet not found. Create a wallet first by sending 'create wallet'.");
              res.type("text/xml").send(twiml.toString());
              return;
            }

            // Execute the transaction based on token type
            console.log(`💸 Sending ${amount} ${token} from ${phoneNumber} to ${address}`);
            console.log(`Found user: ${walletInfo.walletAddress}`);
            console.log(`Phone: ${phoneNumber}`);
            console.log(`Amount: ${amount} ${token}`);
            console.log(`To: ${address}`);
            console.log(`Wallet ID: ${walletInfo.walletId}`);
            
            let result;
            if (token === 'ETH') {
              result = await sendETH(walletInfo.walletId, address, walletInfo.walletAddress, amount);
            } else {
              result = await sendUSDC(walletInfo.walletId, address, walletInfo.walletAddress, amount);
            }
            
            const tokenEmoji = token === 'ETH' ? '💎' : '🪙';
            twiml.message(`✅ *Transaction Sent!*\n\n${tokenEmoji} *Amount:* ${amount} ${token}\n📍 *To:* ${address.substring(0, 10)}...${address.substring(36)}\n🔗 *TX Hash:* ${result.txHash.substring(0, 10)}...${result.txHash.substring(56)}\n\n⛽ *Gas:* Sponsored\n🌐 *Network:* Arbitrum Sepolia`);
          }
        }
      } catch (error) {
        console.error("Send error:", error);
        
        if (error instanceof Error) {
          if (error.message.includes("Insufficient balance")) {
            twiml.message(`❌ *Insufficient Balance*\n\n${error.message}\n\n💡 For test tokens:\n• ETH: https://faucet.arbitrum.io/\n• USDC: Send "receive test token"`);
          } else if (error.message.includes("Invalid recipient")) {
            twiml.message(`❌ *Invalid Address*\n\nPlease check the recipient address and try again.\n\n✅ *Format:* 0x followed by 40 characters`);
          } else if (error.message.includes("transfer amount exceeds balance")) {
            twiml.message(`❌ *Insufficient USDC Balance*\n\nYou don't have enough USDC for this transaction.\n\n💡 Get test USDC: Send "receive test token"`);
          } else {
            twiml.message(`❌ *Transaction Failed*\n\n${error.message}\n\nPlease try again or contact support.`);
          }
        } else {
          twiml.message("❌ Transaction failed. Please try again later.");
        }
      }
    }
    
    else if (message === "help" || message === "menu") {
      twiml.message(`🤖 *Crypto Wallet Bot - Commands*\n\n🏦 *create wallet* - Create new wallet\n💰 *balance* - Check wallet balance\n💎 *send [amount] eth to [address]* - Send ETH\n🪙 *send [amount] usdc to [address]* - Send USDC\n🚰 *receive test token* - Get test USDC\n📈 *history* - Recent transactions\n❓ *help* - Show this menu\n\n💡 *Examples:*\n• send 0.5 eth to 0xabcd1234...\n• send 100 usdc to 0x9876543210...\n\n⛽ *Gas fees sponsored*\n🌐 *Network: Arbitrum Sepolia*`);
    }
    
    else {
      // Handle unknown commands with suggestions
      if (message.includes("send") || message.includes("transfer")) {
        twiml.message(`❓ *Send Command Help*\n\n✅ *Correct formats:*\n• send [amount] eth to [address]\n• send [amount] usdc to [address]\n\n📝 *Examples:*\n• send 0.5 eth to 0xabcd1234...\n• send 100 usdc to 0x9876543210...\n\n💡 Type 'help' for all commands`);
      } else if (message.includes("faucet") || message.includes("test") || message.includes("token")) {
        twiml.message(`🚰 *Test Token Faucet*\n\n✅ *Get test USDC:*\nSend "receive test token"\n\n💡 *Get test ETH:*\nVisit: https://faucet.arbitrum.io/\n\nType 'help' for all commands`);
      } else {
        twiml.message(`🤖 *Unknown Command*\n\nI didn't understand: "${req.body.Body}"\n\n💡 *Available Commands:*\n• create wallet\n• balance  \n• send 0.5 eth to 0x...\n• send 100 usdc to 0x...\n• receive test token\n• history\n• help\n\nType any command to get started!`);
      }
    }
    
  } catch (err: any) {
    console.error("❌ Webhook error:", err.message || err);
    twiml.message("❌ Something went wrong. Please try again later.");
  }

  res.type("text/xml").send(twiml.toString());
});

export default router;