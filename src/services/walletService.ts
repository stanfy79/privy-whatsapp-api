// src/services/walletService.ts - Enhanced with USDC functionality
import { privy } from "../config/privy";
import { getUser, saveUser, User } from "./userService";
import { APIError, PrivyAPIError } from "@privy-io/node";
import axios from "axios";
import { ethers } from "ethers";
import {
  createPublicClient,
  http,
  parseEther,
  createWalletClient,
  parseUnits,
  formatUnits,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { createViemAccount } from "@privy-io/node/viem";
import { toKernelSmartAccount } from "permissionless/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const ARBITRUM_SEPOLIA_CAIP2 = "eip155:421614";

// Define the TestnetBlockchain enum based on the allowed values in the documentation
enum TestnetBlockchain {
  AptosTestnet = 'APTOS-TESTNET',
  ArbSepolia = 'ARB-SEPOLIA',
  AvaxFuji = 'AVAX-FUJI',
  BaseSepolia = 'BASE-SEPOLIA',
  EthSepolia = 'ETH-SEPOLIA',
  MaticAmoy = 'MATIC-AMOY',
  OpSepolia = 'OP-SEPOLIA',
  SolDevnet = 'SOL-DEVNET',
  UniSepolia = 'UNI-SEPOLIA'
}

// USDC Contract Address on Arbitrum Sepolia
const USDC_CONTRACT_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; // Official Arbitrum Sepolia USDC
const USDC_DECIMALS = 6;

// ERC20 ABI for USDC operations
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
] as const;

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(ARBITRUM_SEPOLIA_RPC),
});

// Alchemy Gas Manager configuration
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
console.log(
  "Using Alchemy API Key:",
  ALCHEMY_API_KEY ? ALCHEMY_API_KEY.replace(/.(?=.{4})/g, "*") : "Not Set"
);
if (!ALCHEMY_API_KEY) {
  throw new Error("Alchemy API Key missing in .env file");
}
const ALCHEMY_GAS_MANAGER_POLICY_ID = process.env.ALCHEMY_GAS_MANAGER_POLICY_ID;
const ALCHEMY_RPC_URL = `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Initialize provider
const provider = new ethers.JsonRpcProvider(
  ALCHEMY_RPC_URL,
  ARBITRUM_SEPOLIA_CHAIN_ID
);

const bundlerUrl = `https://api.pimlico.io/v2/421614/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
const paymasterUrl = `https://api.pimlico.io/v2/421614/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

// Circle SDK configuration for faucet
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

// Your existing functions remain the same...
export async function createWalletForUser(
  phoneNumber: string
): Promise<{ privyId: string; walletAddress: string; walletId: string; alreadyExists: boolean }> {
  try {
    // Check if user already has a wallet
    console.log(`Checking if wallet exists for phone: ${phoneNumber}`);
    const existingUser = await getUser(phoneNumber);
    if (existingUser && existingUser.walletAddress) {
      console.log(`User already has a wallet: ${existingUser.walletAddress}`);
      return {
        privyId: existingUser.privyId,
        walletAddress: existingUser.walletAddress,
        walletId: existingUser.walletId || '',
        alreadyExists: true
      };
    }
    console.log(`No existing wallet found, proceeding with creation...`);

    // Step 1: Create user first
    let user;
    try {
      console.log(`Creating user for phone: ${phoneNumber}`);

      // Try creating user with phone account
      user = await privy.users().create({
        linked_accounts: [
          {
            type: "phone",
            number: phoneNumber,
          },
        ],
      });
      console.log(`Created user with ID: ${user.id}`);
    } catch (error) {
      console.error(
        `Phone user creation failed, trying alternative approach...`
      );
      console.error(`Full error object:`, error);

      // Try creating user with custom auth instead
      try {
        console.log(`Trying custom auth user creation...`);
        user = await privy.users().create({
          linked_accounts: [
            {
              type: "custom_auth",
              custom_user_id: phoneNumber.replace(/\+/g, ""),
            },
          ],
        });
        console.log(`Created user with custom auth ID: ${user.id}`);
      } catch (customError) {
        console.error(`Custom auth creation also failed:`, customError);

        if (error instanceof APIError) {
          console.log(
            `API Error details: status=${error.status}, name=${error.name}, message=${error.message}`
          );
          throw new Error(
            `Failed to create user: ${error.status} - ${error.name} - ${error.message}`
          );
        } else if (error instanceof PrivyAPIError) {
          console.log(`Privy Error details: message=${error.message}`);
          throw new Error(`Failed to create user: ${error.message}`);
        } else {
          console.log(`Unknown error type:`, typeof error, error);
          throw new Error(
            `Failed to create user: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    }

    const privyId = user.id;

    // Step 2: Create wallet for the user
    let wallet;
    try {
      wallet = await privy.wallets().create({
        chain_type: "ethereum",
        owner: { user_id: privyId },
        additional_signers: [
          {
            signer_id: process.env.PRIVY_AUTHORIZATION_KEY_QUORUM_ID!,
            override_policy_ids: [],
          },
        ],
      });
      console.log(`Created wallet with ID: ${wallet.id}`);
    } catch (error) {
      if (error instanceof APIError) {
        console.log(`Wallet creation error: ${error.status} - ${error.name}`);
        throw new Error(`Failed to create wallet: ${error.name}`);
      } else if (error instanceof PrivyAPIError) {
        console.log(`Wallet creation error: ${error.message}`);
        throw new Error(`Failed to create wallet: ${error.message}`);
      } else {
        throw error;
      }
    }

    const walletId = wallet.id;
    const walletAddress = wallet.address;

    console.log(`Wallet created successfully:`);
    console.log(`   - Wallet ID: ${walletId}`);
    console.log(`   - Address: ${walletAddress}`);
    console.log(`   - User ID: ${privyId}`);

    // Step 3: Note about gas sponsorship
    // Gas sponsorship policies may need to be configured through Privy Dashboard
    // or may be handled automatically by Privy for embedded wallets
    console.log(
      `Wallet created successfully - gas sponsorship may be configured via Privy Dashboard`
    );

    // Step 4: Save user data with wallet ID
    await saveUser(phoneNumber, privyId, walletAddress, walletId);
    console.log(`User data saved for phone: ${phoneNumber}`);

    return { privyId, walletAddress, walletId, alreadyExists: false };
  } catch (error) {
    console.error("Error creating wallet for user:", error);
    throw new Error(
      `Failed to create wallet: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function getWalletBalance(
  phoneNumber: string
): Promise<{ eth: string; usdc: string }> {
  try {
    const user: User | null = await getUser(phoneNumber);
    if (!user) throw new Error("User not found");

    const address = user.walletAddress;
    console.log(`Checking balance for address: ${address}`);

    // Get ETH balance
    const response = await axios.post(ARBITRUM_SEPOLIA_RPC, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    });

    if (response.data.error) {
      throw new Error(`RPC Error: ${response.data.error.message}`);
    }

    const balanceWei = BigInt(response.data.result);
    const balanceEth = Number(balanceWei) / 1e18;

    // Get USDC balance
    const usdcBalance = await publicClient.readContract({
      address: USDC_CONTRACT_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });

    const usdcFormatted = formatUnits(usdcBalance as bigint, USDC_DECIMALS);

    console.log(`ETH Balance: ${balanceEth.toFixed(6)} ETH`);
    console.log(`USDC Balance: ${usdcFormatted} USDC`);

    return {
      eth: `${balanceEth.toFixed(6)}`,
      usdc: usdcFormatted,
    };
  } catch (error) {
    console.error("Error getting wallet balance:", error);
    throw new Error(
      `Failed to get balance: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function createAccountFromExistingWallet(params: {
  walletId: string;
  address: `0x${string}`;
}): Promise<{
  viemAccount: ReturnType<typeof createViemAccount>;
  kernelSmartAccount: Awaited<ReturnType<typeof toKernelSmartAccount>>;
}> {
  try {
    console.log(
      `Creating Viem account for existing wallet: ${params.address} (walletId=${params.walletId})`
    );

    const viemAccount = await createViemAccount(privy, {
      walletId: params.walletId,
      address: params.address,
      authorizationContext: {
        authorization_private_keys: [
          process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!,
        ],
      },
    });

    console.log("Viem account created successfully");

    const kernelSmartAccount = await toKernelSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
      owners: [viemAccount],
    });

    console.log("Kernel smart account created successfully");

    return { viemAccount, kernelSmartAccount };
  } catch (error) {
    console.error("Error creating Viem / Kernel Smart account:", error);
    throw error;
  }
}

/**
 * sendETH via Kernel Smart Account + Pimlico paymaster (bundler) sponsorship.
 */
export async function sendETH(
  walletId: string,
  toAddress: string,
  address: string,
  amount: string
): Promise<{ txHash: string; message: string }> {
  try {
    console.log(`Sending ${amount} ETH from ${address} to ${toAddress}`);

    // Basic validation
    if (!ethers.isAddress(toAddress)) {
      throw new Error("Invalid recipient address");
    }
    if (!validateAmount(amount)) {
      throw new Error("Invalid amount; must be > 0 and <= 10 ETH");
    }

    // Create / load the accounts (viem account + kernel smart account)
    const { viemAccount, kernelSmartAccount } =
      await createAccountFromExistingWallet({
        walletId,
        address: address as `0x${string}`,
      });

    // Create a wallet client for the EOA, in case we need a fallback
    const walletClient = createWalletClient({
      account: viemAccount,
      chain: arbitrumSepolia,
      transport: http(ARBITRUM_SEPOLIA_RPC),
    });

    let txHash: string;

    try {
      // --- Primary attempt: Send via Smart Account Client with paymaster sponsorship ---
      if (!kernelSmartAccount?.entryPoint) {
        throw new Error(
          "Kernel smart account does not expose an entryPoint. Falling back to EOA."
        );
      }
      if (!paymasterUrl || !bundlerUrl) {
        throw new Error("Pimlico URLs not configured. Falling back to EOA.");
      }

      // Create Pimlico clients
      const paymasterClient = createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: kernelSmartAccount.entryPoint,
      });

      const smartAccountClient = createSmartAccountClient({
        account: kernelSmartAccount,
        chain: arbitrumSepolia,
        paymaster: paymasterClient,
        bundlerTransport: http(bundlerUrl),
        userOperation: {
          estimateFeesPerGas: async () =>
            (await paymasterClient.getUserOperationGasPrice()).fast,
        },
      });

      console.log("Attempting gas-sponsored transaction with Smart Account...");

      const hash = await smartAccountClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: parseEther(amount),
      });

      txHash = hash;
    } catch (smartAccountError: any) {
      // --- Fallback logic: If the smart account transaction fails ---
      console.warn(
        "Smart Account transaction failed. Falling back to EOA transaction..."
      );
      console.error("Smart Account error details:", smartAccountError);

      if (
        smartAccountError.cause?.message?.includes(
          "UserOperation reverted during simulation"
        )
      ) {
        console.warn(
          "Paymaster simulation failed. Using EOA wallet for transaction."
        );
      } else {
        // Handle other, non-paymaster-related errors
        throw smartAccountError;
      }

      // Execute the fallback transaction with the EOA wallet client
      txHash = await walletClient.sendTransaction({
        to: toAddress as `0x${string}`,
        value: parseEther(amount),
      });
    }

    console.log("Transaction sent (tx hash):", txHash);
    console.log("Waiting for transaction confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log("Transaction confirmed!");
    console.log("Gas Used:", receipt.gasUsed?.toString?.() ?? receipt.gasUsed);
    console.log("Status:", receipt.status);

    return {
      txHash: txHash,
      message: `Successfully sent ${amount} ETH to ${toAddress}`,
    };
  } catch (error) {
    console.error("Error sending transaction:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to send ETH: ${error.message}`);
    }
    throw new Error("Failed to send ETH: Unknown error");
  }
}

/**
 * NEW: Send USDC via Smart Account with gas sponsorship
 */
export async function sendUSDC(
  walletId: string,
  toAddress: string,
  address: string,
  amount: string
): Promise<{ txHash: string; message: string }> {
  try {
    console.log(`Sending ${amount} USDC from ${address} to ${toAddress}`);

    // Basic validation
    if (!ethers.isAddress(toAddress)) {
      throw new Error("Invalid recipient address");
    }
    if (!validateUSDCAmount(amount)) {
      throw new Error("Invalid amount; must be > 0 and <= 1000 USDC");
    }

    // Create / load the accounts
    const { viemAccount, kernelSmartAccount } =
      await createAccountFromExistingWallet({
        walletId,
        address: address as `0x${string}`,
      });

    // Create a wallet client for fallback
    const walletClient = createWalletClient({
      account: viemAccount,
      chain: arbitrumSepolia,
      transport: http(ARBITRUM_SEPOLIA_RPC),
    });

    // Parse USDC amount (6 decimals)
    const usdcAmount = parseUnits(amount, USDC_DECIMALS);

    let txHash: string;

    try {
      // Primary attempt: Smart Account with gas sponsorship
      if (!kernelSmartAccount?.entryPoint) {
        throw new Error(
          "Kernel smart account does not expose an entryPoint. Falling back to EOA."
        );
      }
      if (!paymasterUrl || !bundlerUrl) {
        throw new Error("Pimlico URLs not configured. Falling back to EOA.");
      }

      // Create Pimlico clients
      const paymasterClient = createPimlicoClient({
        transport: http(paymasterUrl),
        entryPoint: kernelSmartAccount.entryPoint,
      });

      const smartAccountClient = createSmartAccountClient({
        account: kernelSmartAccount,
        chain: arbitrumSepolia,
        paymaster: paymasterClient,
        bundlerTransport: http(bundlerUrl),
        userOperation: {
          estimateFeesPerGas: async () =>
            (await paymasterClient.getUserOperationGasPrice()).fast,
        },
      });

      console.log(
        "Attempting gas-sponsored USDC transaction with Smart Account..."
      );

      // Encode USDC transfer call
      const { encodeFunctionData } = await import("viem");
      const callData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [toAddress as `0x${string}`, usdcAmount],
      });

      const hash = await smartAccountClient.sendTransaction({
        account: kernelSmartAccount,
        to: USDC_CONTRACT_ADDRESS as `0x${string}`,
        data: callData,
        value: 0n, // No ETH value for ERC20 transfer
      });

      txHash = hash;
    } catch (smartAccountError: any) {
      // Fallback to EOA transaction
      console.warn(
        "Smart Account USDC transaction failed. Falling back to EOA transaction..."
      );
      console.error("Smart Account error details:", smartAccountError);

      // Encode USDC transfer for EOA
      const { encodeFunctionData } = await import("viem");
      const callData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [toAddress as `0x${string}`, usdcAmount],
      });

      txHash = await walletClient.sendTransaction({
        to: USDC_CONTRACT_ADDRESS as `0x${string}`,
        data: callData,
        value: 0n,
      });
    }

    console.log("USDC Transaction sent (tx hash):", txHash);
    console.log("Waiting for transaction confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log("USDC Transaction confirmed!");
    console.log("Gas Used:", receipt.gasUsed?.toString?.() ?? receipt.gasUsed);
    console.log("Status:", receipt.status);

    return {
      txHash: txHash,
      message: `Successfully sent ${amount} USDC to ${toAddress}`,
    };
  } catch (error) {
    console.error("Error sending USDC transaction:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to send USDC: ${error.message}`);
    }
    throw new Error("Failed to send USDC: Unknown error");
  }
}

/**
 * Unified Faucet - Sends both ETH and USDC test tokens
 */
// Simple in-memory request tracker (replace with Redis/DB for production)
const faucetRequestLimits = {
  eth: {
    maxPerDay: 0.0005,
  },
  usdc: {
    maxPerDay: 12,
  },
};
const faucetUsage: Record<string, { eth: { date: string; total: number }; usdc: { date: string; total: number } }> = {};

function canRequestFaucet(phoneNumber: string, token: "eth" | "usdc", amount: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (!faucetUsage[phoneNumber]) {
    faucetUsage[phoneNumber] = {
      eth: { date: today, total: 0 },
      usdc: { date: today, total: 0 },
    };
  }
  if (faucetUsage[phoneNumber][token].date !== today) {
    faucetUsage[phoneNumber][token] = { date: today, total: 0 };
  }
  return faucetUsage[phoneNumber][token].total + amount <= faucetRequestLimits[token].maxPerDay;
}

function recordFaucetUsage(phoneNumber: string, token: "eth" | "usdc", amount: number) {
  const today = new Date().toISOString().slice(0, 10);
  if (!faucetUsage[phoneNumber]) {
    faucetUsage[phoneNumber] = {
      eth: { date: today, total: 0 },
      usdc: { date: today, total: 0 },
    };
  }
  if (faucetUsage[phoneNumber][token].date !== today) {
    faucetUsage[phoneNumber][token] = { date: today, total: 0 };
  }
  faucetUsage[phoneNumber][token].total += amount;
}

export async function sendEthFaucet(phoneNumber: string): Promise<string> {
  const user = await getUser(phoneNumber);
  if (!user) throw new Error("User not found. Create a wallet first.");

  const ETH_FAUCET_AMOUNT = "0.0001";
  const ethAmountNum = parseFloat(ETH_FAUCET_AMOUNT);

  // Limit check
  if (!canRequestFaucet(phoneNumber, "eth", ethAmountNum)) {
    return `ℹ️ Daily ETH faucet limit reached *(${faucetRequestLimits.eth.maxPerDay} ETH per day).* Try again tomorrow.`;
  }

  let ethTxHash = "";

  // Method 1: Self-funded wallet (Primary)
  if (process.env.FAUCET_PRIVATE_KEY) {
    try {
      const faucetWallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
      const faucetEthBalance = await provider.getBalance(faucetWallet.address);
      const requiredEth = ethers.parseEther(ETH_FAUCET_AMOUNT);

      let successMessage = "✅ *ETH Faucet Success!*\n\n";

      // Send ETH if available
      if (faucetEthBalance >= requiredEth) {
        const ethTx = await faucetWallet.sendTransaction({
          to: user.walletAddress,
          value: requiredEth,
        });
        await ethTx.wait();
        ethTxHash = ethTx.hash;
        successMessage += `*Sent ${ETH_FAUCET_AMOUNT} ETH*\n`;
        recordFaucetUsage(phoneNumber, "eth", ethAmountNum);
      } else {
        successMessage += `⚠️ ETH faucet empty\n`;
      }

      if (ethTxHash) {
        successMessage += `\n*To:* ${user.walletAddress.substring(0, 10)}...${user.walletAddress.substring(36)}\n`;
        successMessage += `TX Hash: https://sepolia.arbiscan.io/tx/${ethTxHash}\n`;
        successMessage += `\nCheck balance with 'balance'`;
        return successMessage;
      }
    } catch (error) {
      console.error("Self-funded ETH faucet error:", error);
    }
  }

  // Method 2: Circle SDK (Fallback)
  // if (CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET && user.walletId) {
  //   try {
  //     const client = initiateDeveloperControlledWalletsClient({
  //       apiKey: CIRCLE_API_KEY,
  //       entitySecret: CIRCLE_ENTITY_SECRET,
  //     });

  //     const walletResponse = await client.getWallet({ id: user.walletId });
  //     if (!walletResponse.data?.wallet) throw new Error("Circle wallet not found");

  //     await client.requestTestnetTokens({
  //       address: walletResponse.data.wallet.address,
  //       blockchain: TestnetBlockchain.ArbSepolia,
  //       usdc: false,
  //       native: true,
  //       eurc: false,
  //     });

  //     recordFaucetUsage(phoneNumber, "eth", ethAmountNum);
  //     return `✅ *ETH Faucet Request Sent!*\n\nTest ETH requested\n\n${user.walletAddress.substring(0, 10)}...${user.walletAddress.substring(36)}\n\nProcessing: 1-2 minutes\nCheck with 'balance'`;
  //   } catch (error) {
  //     console.error("Circle SDK ETH error:", error);
  //   }
  // }

  // Method 3: Manual instructions
  return `ℹ️ Unable to process ETH faucet request at this time!`;
}

export async function sendUsdcFaucet(phoneNumber: string): Promise<string> {
  const user = await getUser(phoneNumber);
  if (!user) throw new Error("User not found. Create a wallet first.");

  const USDC_FAUCET_AMOUNT = "3";
  const usdcAmountNum = parseFloat(USDC_FAUCET_AMOUNT);

  // Limit check
  if (!canRequestFaucet(phoneNumber, "usdc", usdcAmountNum)) {
    return `ℹ️ Daily USDC faucet limit reached *(${faucetRequestLimits.usdc.maxPerDay} USDC per day).* Try again tomorrow.`;
  }

  let usdcTxHash = "";

  // Method 1: Self-funded wallet (Primary)
  if (process.env.FAUCET_PRIVATE_KEY) {
    try {
      const faucetWallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
      const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, faucetWallet);
      const faucetUsdcBalance = await usdcContract.balanceOf(faucetWallet.address);
      const requiredUsdc = ethers.parseUnits(USDC_FAUCET_AMOUNT, USDC_DECIMALS);

      let successMessage = "✅ *USDC Faucet Success!*\n\n";

      // Send USDC if available
      if (faucetUsdcBalance >= requiredUsdc) {
        const usdcTx = await usdcContract.transfer(user.walletAddress, requiredUsdc);
        await usdcTx.wait();
        usdcTxHash = usdcTx.hash;
        successMessage += `*Sent ${USDC_FAUCET_AMOUNT} USDC*\n`;
        recordFaucetUsage(phoneNumber, "usdc", usdcAmountNum);
      } else {
        successMessage += `⚠️ USDC faucet empty\n`;
      }

      if (usdcTxHash) {
        successMessage += `\n*To:* ${user.walletAddress.substring(0, 10)}...${user.walletAddress.substring(36)}\n`;
        successMessage += `TX Hash: https://sepolia.arbiscan.io/tx/${usdcTxHash}\n`;
        successMessage += `\nCheck balance with 'balance'`;
        return successMessage;
      }
    } catch (error) {
      console.error("Self-funded USDC faucet error:", error);
    }
  }

  // Method 2: Circle SDK (Fallback)
  // if (CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET && user.walletId) {
  //   try {
  //     const client = initiateDeveloperControlledWalletsClient({
  //       apiKey: CIRCLE_API_KEY,
  //       entitySecret: CIRCLE_ENTITY_SECRET,
  //     });

  //     const walletResponse = await client.getWallet({ id: user.walletId });
  //     if (!walletResponse.data?.wallet) throw new Error("Circle wallet not found");

  //     await client.requestTestnetTokens({
  //       address: walletResponse.data.wallet.address,
  //       blockchain: TestnetBlockchain.ArbSepolia,
  //       usdc: true,
  //       native: false,
  //       eurc: false,
  //     });

  //     recordFaucetUsage(phoneNumber, "usdc", usdcAmountNum);
  //     return `✅ *USDC Faucet Request Sent!*\n\nTest USDC requested\n\n${user.walletAddress.substring(0, 10)}...${user.walletAddress.substring(36)}\n\nProcessing: 1-2 minutes\nCheck with 'balance'`;
  //   } catch (error) {
  //     console.error("Circle SDK USDC error:", error);
  //   }
  // }

  // Method 3: Manual instructions
  return `ℹ️ Unable to process USDC faucet request at this time!`;
}

// Parse send command for both ETH and USDC
export function parseSendCommand(
  message: string
): { amount: string; address: string; token: "ETH" | "USDC" } | null {
  // Handle formats like:
  // "send 0.5 eth to 0x1234..."
  // "send 0.1 to 0x1234..." (defaults to ETH)
  // "send 100 usdc to 0x1234..."

  const ethRegex = /send\s+([\d.]+)(?:\s+eth)?\s+to\s+(0x[a-fA-F0-9]{40})/i;
  const usdcRegex = /send\s+([\d.]+)\s+usdc\s+to\s+(0x[a-fA-F0-9]{40})/i;

  // Check for USDC first
  const usdcMatch = message.match(usdcRegex);
  if (usdcMatch) {
    return {
      amount: usdcMatch[1],
      address: usdcMatch[2],
      token: "USDC",
    };
  }

  // Check for ETH
  const ethMatch = message.match(ethRegex);
  if (ethMatch) {
    return {
      amount: ethMatch[1],
      address: ethMatch[2],
      token: "ETH",
    };
  }

  return null;
}

// Validate ETH amount
export function validateAmount(amount: string): boolean {
  try {
    const parsed = parseFloat(amount);
    return parsed > 0 && parsed <= 10; // Max 10 ETH per transaction
  } catch {
    return false;
  }
}

// Validate USDC amount
export function validateUSDCAmount(amount: string): boolean {
  try {
    const parsed = parseFloat(amount);
    return parsed > 0 && parsed <= 1000; // Max 1000 USDC per transaction
  } catch {
    return false;
  }
}

// Get transaction history using Alchemy
export async function getTransactionHistory(
  phoneNumber: string
): Promise<string> {
  try {
    const user: User | null = await getUser(phoneNumber);
    if (!user) throw new Error("User not found");

    console.log(`Getting transaction history for: ${user.walletAddress}`);

    const response = await axios.post(ALCHEMY_RPC_URL, {
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromAddress: user.walletAddress,
          category: ["external", "internal", "erc20"],
          maxCount: "0x5", // Last 5 transactions
        },
      ],
    });

    if (response.data.result?.transfers?.length > 0) {
      const transfers = response.data.result.transfers;
      let historyText = `Found ${transfers.length} recent transaction(s):\n\n`;

      transfers.slice(0, 3).forEach((transfer: any, index: number) => {
        const amount = transfer.value
          ? `${parseFloat(transfer.value).toFixed(4)} ${
              transfer.asset || "ETH"
            }`
          : "N/A";
        const to = transfer.to
          ? `${transfer.to.substring(0, 8)}...${transfer.to.substring(36)}`
          : "Unknown";
        historyText += `${index + 1}. Sent ${amount} to ${to}\n`;
      });

      return historyText;
    }

    return "No recent transactions found.\n\nStart by sending some ETH or USDC!";
  } catch (error) {
    console.error("Error getting transaction history:", error);
    return "Unable to fetch transaction history at the moment.";
  }
}

export async function getWalletInfo(phoneNumber: string): Promise<{
  privyId: string;
  walletAddress: string;
  walletId?: string;
} | null> {
  try {
    const user: User | null = await getUser(phoneNumber);
    if (!user) return null;

    return {
      privyId: user.privyId,
      walletAddress: user.walletAddress,
      walletId: user.walletId,
    };
  } catch (error) {
    console.error("Error getting wallet info:", error);
    return null;
  }
}

// Helper to get gas estimates
export async function estimateGasCost(
  to: string,
  value: string
): Promise<string> {
  try {
    const gasLimit = await provider.estimateGas({
      to,
      value: ethers.parseEther(value),
    });

    const feeData = await provider.getFeeData();
    const gasCost = gasLimit * (feeData.gasPrice || BigInt(0));

    return ethers.formatEther(gasCost);
  } catch (error) {
    console.error("Gas estimation failed:", error);
    return "0.001"; // Fallback estimate
  }
}
