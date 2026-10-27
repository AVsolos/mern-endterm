import { MongoClient } from "mongodb";
import { readConfig } from "../server/config.ts";
const c = readConfig();
const client = new MongoClient(c.mongoUri, { serverSelectionTimeoutMS: 10000 });
try { await client.connect(); const topology = await client.db().admin().command({ hello: 1 }); console.log(JSON.stringify({ mongodbConnected: true, supportsTransactions: !!topology.setName || topology.msg === "isdbgrid" })); }
catch (e) { console.log(JSON.stringify({ mongodbConnected: false, code: (e as { code?: number }).code, name: (e as Error).name })); process.exitCode = 1; }
finally { await client.close(); }
if (c.razorpayKeyId && c.razorpaySecret) {
  try { const response = await fetch("https://api.razorpay.com/v1/orders?count=1", { headers: { Authorization: `Basic ${Buffer.from(`${c.razorpayKeyId}:${c.razorpaySecret}`).toString("base64")}` }, signal: AbortSignal.timeout(12000) }); console.log(JSON.stringify({ razorpayTestAuthenticated: response.ok, status: response.status })); if (!response.ok) process.exitCode = 1; }
  catch { console.log(JSON.stringify({ razorpayTestAuthenticated: false, error: "Network connection failed" })); process.exitCode = 1; }
}
