import { PrivyClient } from "@privy-io/node";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
  throw new Error("Privy credentials missing in .env file");
}

export const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
});
