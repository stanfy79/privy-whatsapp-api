import { createWalletForUser, getWalletBalance, getWalletInfo } from "./walletService";
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

  if (text.includes("check balance" || "balance")) {
    const balance = await getWalletBalance(phoneNumber);
    await sendWhatsAppMessage(phoneNumber, `Your wallet balance: ${balance}`);
  };

  if (text.includes("address" || "my wallet")) {
    const address = await getWalletInfo(walletAddress);
    await sendWhatsAppMessage(phoneNumber, `${address}`);
  }
}
