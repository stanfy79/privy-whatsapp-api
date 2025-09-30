// src/services/walletService.ts
import { privy } from "../config/privy";
import { getUser, saveUser, User } from "./userService";
import { listPolicies, createPolicy } from "./policyService";
import axios from "axios";

const ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

async function ensureSponsorshipPolicy() {
  const policies = await listPolicies();

  let sponsorshipPolicy = policies.find(
    (p) => p.name === "ArbitrumSepoliaSponsorship"
  );

  if (!sponsorshipPolicy) {
    console.log("No sponsorship policy found. Creating one...");

    sponsorshipPolicy = await createPolicy("ArbitrumSepoliaSponsorship", {
      type: "gas-sponsorship",
      chains: ["421614"],
      maxTransactions: 10,
      maxValuePerTx: "0.01",
      tokens: ["ETH"],
    });
  }

  return sponsorshipPolicy;
}

export async function createWalletForUser(
  phoneNumber
){
  // Step 1: Create or import Privy user
  const user = await privy.importUser({
    linkedAccounts: [{ type: "phone", value: phoneNumber }],
  });

  const privyId = user.id;

  // Step 2: Ensure sponsorship policy exists
  const policy = await ensureSponsorshipPolicy();

  // Step 3: Create Smart Wallet
  const wallet = await privy.walletApi.createWallet({
    chainType: "ethereum",
    owner: { userId: privyId },
    policyIds: [policy.id],
  });

  const walletAddress = wallet.address;

  // Step 4: Persist user in Firebase
  await saveUser(phoneNumber, privyId, walletAddress);

  return { privyId, walletAddress, policyId: policy.id };
}

export async function getWalletBalance(phoneNumber){
  const user = await getUser(phoneNumber);
  if (!user) throw new Error("User not found");

  const address = user.walletAddress;

  const response = await axios.post(ARBITRUM_SEPOLIA_RPC, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getBalance",
    params: [address, "latest"],
  });

  const balanceWei = BigInt(response.data.result);
  const balanceEth = Number(balanceWei) / 1e18;

  return `${balanceEth.toFixed(4)} ETH`;
}

// export async function sendETH(
//   fromPhoneNumber: string,
//   toAddress: string,
//   amount: string
// ): Promise<{ txHash: string; message: string }> {
//   try {
//     const user: User | null = await getUser(fromPhoneNumber);
//     if (!user) throw new Error("User not found");

//     console.log(`Found user: ${user.walletAddress}`);
//     console.log(`Phone: ${fromPhoneNumber}`);
//     console.log(`Amount: ${amount} ETH`);
//     console.log(`To: ${toAddress}`);

//     // Validate recipient address
//     if (!ethers.isAddress(toAddress)) {
//       throw new Error("Invalid recipient address");
//     }

//     // Validate amount
//     const amountFloat = parseFloat(amount);
//     if (amountFloat <= 0 || amountFloat > 10) {
//       throw new Error("Amount must be between 0 and 10 ETH");
//     }

//     // Check if user has wallet ID
//     if (!user.walletId) {
//       throw new Error("Wallet ID not found. Please recreate your wallet.");
//     }

//     // Parse amount to wei
//     const amountWei = ethers.parseEther(amount);
//     console.log(`Amount in Wei: ${amountWei.toString()}`);

//     // Check balance
//     const balance = await provider.getBalance(user.walletAddress);
//     console.log(`Current balance: ${ethers.formatEther(balance)} ETH`);

//     if (balance < amountWei) {
//       throw new Error(
//         `Insufficient balance. You have ${ethers.formatEther(
//           balance
//         )} ETH but need ${amount} ETH`
//       );
//     }

//     // Convert amount to hex for the transaction
//     const valueHex = "0x" + amountWei.toString(16);

//     console.log(`Executing transaction...`);
//     console.log(`   - From: ${user.walletAddress}`);
//     console.log(`   - To: ${toAddress}`);
//     console.log(`   - Value: ${valueHex} (${amount} ETH)`);
//     console.log(`   - Wallet ID: ${user.walletId}`);

//     // Execute transaction using new Privy node library

//     // Define AuthorizationContext type if not imported
//     type AuthorizationContext = {
//       authorization_private_keys: string[];
//     };

//     const authorizationContext: AuthorizationContext = {
//       authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
//     };

//     const response = await privy
//       .wallets()
//       .ethereum()
//       .sendTransaction(user.walletId, {
//         caip2: ARBITRUM_SEPOLIA_CAIP2,
//         params: {
//           transaction: {
//             to: toAddress,
//             value: valueHex,
//             chain_id: ARBITRUM_SEPOLIA_CHAIN_ID,
//           },
//         },
//         authorization_context: {
//           authorization_private_keys: [
//             process.env.PRIVY_AUTHORIZATION_KEY_PRIVATE_KEY!,
//           ],
//         },
//       });

//     const txHash = response.hash;
//     console.log("Transaction hash:", txHash);

//     return {
//       txHash,
//       message: `Successfully sent ${amount} ETH to ${toAddress}`,
//     };
//   } catch (error) {
//     console.error("Error sending ETH:", error);

//     if (error instanceof APIError) {
//       console.log(`API Error: ${error.status} - ${error.name}`);
//       throw new Error(`Transaction failed: ${error.name}`);
//     } else if (error instanceof PrivyAPIError) {
//       console.log(`Privy Error: ${error.message}`);
//       throw new Error(`Transaction failed: ${error.message}`);
//     } else {
//       throw new Error(
//         `Failed to send ETH: ${
//           error instanceof Error ? error.message : "Unknown error"
//         }`
//       );
//     }
//   }
// }