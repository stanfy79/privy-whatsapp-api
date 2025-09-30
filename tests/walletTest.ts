// walletTest.ts
import { createWalletForUser, getWalletBalance } from "../src/services/walletService";

async function run() {
  try {
    const phoneNumber = "+2348023302683"; // Replace with a test number

    console.log("📱 Creating wallet for user...");
    const { privyId, walletAddress } = await createWalletForUser(phoneNumber);

    console.log("✅ Wallet created!");
    console.log("Privy ID:", privyId);
    console.log("Wallet Address:", walletAddress);

    console.log("\n💰 Fetching wallet balance...");
    const balance = await getWalletBalance(phoneNumber);
    console.log("Balance:", balance);
  } catch (err: any) {
    console.error("❌ Error in wallet test:", err.message || err);
  }
}

run();
