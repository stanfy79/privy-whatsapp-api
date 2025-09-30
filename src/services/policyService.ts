// src/services/policyService.ts
import axios from "axios";
import { v4 as uuidv4 } from "uuid"; // npm install uuid

const PRIVY_API_BASE = "https://api.privy.io";

function getAuthHeader() {
  return {
    Authorization: `Basic ${Buffer.from(
      `${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`
    ).toString("base64")}`,
    "privy-app-id": process.env.PRIVY_APP_ID!, // 👈 required
  };
}

/**
 * Create a new policy for a specific wallet
 */
export async function createPolicy(walletId: string, name: string, config: any) {
  try {
    const policyId = uuidv4(); // generate unique ID
    const url = `${PRIVY_API_BASE}/v1/wallets/${walletId}/policies/${policyId}`;

    const resp = await axios.put(
      url,
      { name, config },
      {
        headers: {
          ...getAuthHeader(),
          "Content-Type": "application/json",
        },
      }
    );

    return resp.data; // includes the policyId
  } catch (err: any) {
    console.error("Error creating policy:", err.response?.data || err);
    throw err;
  }
}

/**
 * Get a specific policy by ID for a wallet
 */
export async function getPolicy(walletId: string, policyId: string) {
  try {
    const url = `${PRIVY_API_BASE}/v1/wallets/${walletId}/policies/${policyId}`;
    const resp = await axios.get(url, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    return resp.data;
  } catch (err: any) {
    console.error("Error fetching policy:", err.response?.data || err);
    throw err;
  }
}

/**
 * List all policies for a given wallet
 */
export async function listPolicies(
  walletId: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const url = `${PRIVY_API_BASE}/v1/wallets/${walletId}/policies`;
    const resp = await axios.get(url, {
      headers: {
        ...getAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    const policies = resp.data?.policies || resp.data?.items || [];

    return policies.map((p: any) => ({
      id: p.id,
      name: p.name,
    }));
  } catch (err: any) {
    console.error("Error listing policies:", err.response?.data || err);
    throw err;
  }
}
