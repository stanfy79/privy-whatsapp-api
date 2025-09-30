import express, { Application, Request, Response } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import whatsappRoutes from "./routes/whatsapp";

dotenv.config();

const app: Application = express();

// Twilio sends form data, not JSON
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Routes
app.use("/", whatsappRoutes);

// Root health check
app.get("/", (_req: Request, res: Response) => {
  res.send("Privy WhatsApp Backend is running 🚀");
});

const PORT: number = parseInt(process.env.PORT || "5000", 10);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
