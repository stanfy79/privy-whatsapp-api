// src/services/userService.ts
import { db } from "../config/firebase";

export interface User {
  phone: string;
  privyId: string;
  walletAddress: string;
  walletId?: string; // Add this optional field
  createdAt: string;
}

export async function saveUser(
  phone: string,
  privyId: string,
  walletAddress: string,
  walletId?: string // Add optional wallet ID
): Promise<void> {
  const user: User = {
    phone,
    privyId,
    walletAddress,
    walletId, // Include wallet ID if provided
    createdAt: new Date().toISOString(),
  };

  await db.collection("users").doc(phone).set(user);
}

export async function getUser(phone: string): Promise<User | null> {
  // Admin SDK syntax
  const docSnap = await db.collection("users").doc(phone).get();
  
  if (docSnap.exists) {
    return docSnap.data() as User;
  }
  return null;
}