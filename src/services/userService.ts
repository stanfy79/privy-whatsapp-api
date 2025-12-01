// src/services/userService.ts
import { db } from "../config/firebase";

export interface User {
  phone: string;
  privyId: string;
  walletAddress: string;
  walletId?: string;
  createdAt: string;
  phoneNumber: string;
}

export async function saveUser(
  phone: string,
  privyId: string,
  walletAddress: string,
  walletId?: string,
): Promise<void> {
  const user: User = {
    phone,
    privyId,
    walletAddress: String(walletAddress).toLowerCase().trim(), // IMPORTANT: normalize
    walletId,
    createdAt: new Date().toISOString(),
    phoneNumber: phone, 
  };

  await db.collection("users").doc(phone).set(user);
}

export async function getUser(phone: string): Promise<User | null> {
  const docSnap = await db.collection("users").doc(phone).get();
  return docSnap.exists ? (docSnap.data() as User) : null;
}

export async function findUserByWalletAddress(walletAddress: string): Promise<User | null> {
  const normalized = String(walletAddress).toLowerCase().trim();

  const querySnap = await db
    .collection("users")
    .where("walletAddress", "==", normalized)
    .limit(1)
    .get();

  if (querySnap.empty) return null;

  return querySnap.docs[0].data() as User;
}
