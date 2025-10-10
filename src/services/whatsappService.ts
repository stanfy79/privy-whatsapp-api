import { createWalletForUser, getWalletBalance, getUserWalletAddress } from "./walletService";
import { saveUser } from "./userService";
import { sendWhatsAppMessage } from "../config/whatsapp";

interface MessageData {
  from: string;
  body: string;
}

export async function handleIncomingMessage(messageData: MessageData): Promise<void> {
  const phoneNumber = messageData.from;
  const text = messageData.body?.toLowerCase() || "";

  if (text.includes("create wallet")) {
    const { privyId, walletAddress } = await createWalletForUser(phoneNumber);
    await saveUser(phoneNumber, privyId, walletAddress);

    await sendWhatsAppMessage(phoneNumber, `✅ Wallet created!\nAddress: ${walletAddress}`);
  }

  if (text.includes("check balance") || text.includes("balance")) {
    const balance = await getWalletBalance(phoneNumber);
    await sendWhatsAppMessage(phoneNumber, `Your wallet balance: ${balance}`);
  }

}
